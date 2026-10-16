"""Offline archive, trust-chain and honest-enrichment contracts."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.public_research import enrich_public_research, load_public_research
from backend.topic_chain import chain_source_catalog
from report_service.full_contract import canonical_url


STAMP = '2026-10-16T08:00:00+00:00'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def document(url, text, *, quote=None, title='公开原文'):
    quote = text if quote is None else quote
    sid = 'source_' + digest(canonical_url(url) + '\0' + text)[:20]
    eid = 'tr_' + digest(url + '\0' + quote)[:20]
    common = {'url': url, 'title': title, 'retrieved_at': STAMP,
              'published_at': '2026-01-01', 'retrieval': 'fetched'}
    return {'sources': {sid: dict(common, id=sid, fulltext=text, fulltext_sha256=digest(text))},
            'evidence': [dict(common, id=eid, source_id=sid, quote=quote)]}


def combine(*documents):
    return {'sources': {key: value for item in documents for key, value in item['sources'].items()},
            'evidence': [row for item in documents for row in item['evidence']]}


def identity(domain='www.example.com', **kwargs):
    return document('https://static.cninfo.com.cn/finalpage/2026-04-29/1234567890.PDF',
                    '公司名称 示例装备有限公司\n办公地址 闵行区示例路1号\n公司网址 ' + domain,
                    title='示例装备年度报告', **kwargs)


def product(url='https://example.com/product?id=3'):
    return document(url, '该企业生产生物制药一次性无菌袋，采用进口膜材，并开展材料验证和产品性能测试。')


class PublicResearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, data, name='public.json'):
        (self.root / name).write_text(json.dumps(data, ensure_ascii=False))

    def enrich(self, base=None, topic='生物医药'):
        return enrich_public_research(base or {'city': '闵行区', 'topic': topic},
                                      '闵行区', topic, self.root)

    def test_seed_data_are_only_verifiable_original_sources_and_work_in_chain_catalog(self):
        loaded = load_public_research()
        self.assertEqual(loaded['rejected_count'], 0)
        self.assertEqual(len(loaded['evidence']), 5)
        self.assertIn('tofflon.com', loaded['trusted_company_domains'])
        out = enrich_public_research({'city': '闵行区', 'topic': '生物医药'}, '闵行区', '生物医药')
        self.assertEqual(len(chain_source_catalog(out, {'city': '闵行区', 'topic': '生物医药'})), 5)
        filter_quote = next(row['quote'] for row in out['evidence'] if '1225360022' in row['url'])
        self.assertTrue(filter_quote.strip().endswith('需求。'))
        for path in Path(__file__).resolve().parents[1].joinpath('data/public-research').glob('*.json'):
            value = json.loads(path.read_text())
            self.assertEqual(set(value), {'schema', 'sources', 'evidence'})
            for text in ('claim_links', 'candidate_links', 'numeric_scope_notes', 'judgment'):
                self.assertNotIn(text, json.dumps(value))

    def test_enrichment_is_deep_copy_preserves_fetch_time_and_live_status(self):
        self.write(combine(identity(), product()))
        original = {'city': '闵行区', 'topic': '生物医药', 'status': 'unavailable',
                    'automatic_research': False, 'automatic_cross_check': False,
                    'errors': [{'code': 'live_failed'}], 'queries': ['public query']}
        before = copy.deepcopy(original)
        with patch('urllib.request.urlopen', side_effect=AssertionError('no network')):
            out = self.enrich(original)
        self.assertEqual(original, before)
        self.assertEqual(out['status'], 'unavailable')
        self.assertFalse(out['automatic_research'])
        self.assertFalse(out['automatic_cross_check'])
        self.assertFalse(out['public_research']['network_requested'])
        self.assertEqual(len(out['evidence']), 2)
        for row in out['evidence']:
            self.assertTrue(row['archived'])
            self.assertEqual(row['retrieved_at'], STAMP)
            self.assertEqual(row['archive_retrieved_at'], STAMP)
        out['errors'][0]['code'] = 'changed'
        self.assertEqual(original, before)

    def test_disclosure_website_attestation_is_added_even_without_topic_match(self):
        proof, item = identity(), product()
        self.write(combine(proof, item))
        out = self.enrich()
        self.assertEqual({r['id'] for r in out['evidence']},
                         {proof['evidence'][0]['id'], item['evidence'][0]['id']})
        self.assertEqual(out['public_research']['trusted_company_domains'], ['example.com'])

    def test_unrelated_topic_does_not_import_company_or_identity(self):
        self.write(combine(identity(), product()))
        out = self.enrich(topic='商业火箭卫星')
        self.assertEqual(out['evidence'], [])
        self.assertEqual(out['public_research']['status'], 'no_match')

    def test_company_cannot_self_authorize_or_spoof_authority_field(self):
        item = product()
        source = next(iter(item['sources'].values()))
        source['source_type'] = 'government'
        source['fulltext'] += '\n公司网址 www.example.com'
        source['fulltext_sha256'] = digest(source['fulltext'])
        # A validly hashed company record still lacks disclosure authority.
        item = document(source['url'], source['fulltext'])
        next(iter(item['sources'].values()))['source_type'] = 'government'
        self.write(item)
        self.assertEqual(load_public_research(self.root)['evidence'], [])

    def test_user_posts_and_questions_cannot_attest_company_websites(self):
        for url in ('https://caifuhao.eastmoney.com/news/example',
                    'https://irm.cninfo.com.cn/ircs/question/example',
                    'https://www.cninfo.com.cn/user/example'):
            self.write(combine(document(url,
                '公司信息由用户提交，这不是发行人正式披露。公司网址 www.example.com'), product()))
            loaded = load_public_research(self.root)
            self.assertEqual(loaded['trusted_company_domains'], [])
            self.assertFalse(any(r['source_type'] == 'company' for r in loaded['evidence']))

    def test_corrupt_disclosure_cannot_authorize_valid_company(self):
        proof = identity()
        next(iter(proof['sources'].values()))['fulltext_sha256'] = '0' * 64
        self.write(combine(proof, product()))
        self.assertEqual(load_public_research(self.root)['evidence'], [])

    def test_website_must_be_adjacent_and_in_validated_disclosure_excerpt(self):
        for text in ('公司网址 尚待确认；其他参考网址 www.example.com',
                     '公司信息与联系方式。网址 www.example.com（其他机构）'):
            self.write(combine(document('https://static.cninfo.com.cn/a.pdf', text), product()))
            self.assertNotIn('example.com', load_public_research(self.root)['trusted_company_domains'])
        proof = document('https://static.cninfo.com.cn/a.pdf',
                         '公司信息仅供查阅，不包含网站归属证据。\n公司网址 www.example.com',
                         quote='公司信息仅供查阅，不包含网站归属证据。')
        self.write(combine(proof, product()))
        self.assertNotIn('example.com', load_public_research(self.root)['trusted_company_domains'])

    def test_public_suffix_and_deceptive_host_do_not_gain_trust(self):
        for domain in ('www.com', 'www.co.uk', 'www.gov.cn'):
            self.write(combine(identity(domain), product()))
            self.assertEqual(load_public_research(self.root)['trusted_company_domains'], [])
        self.write(combine(identity(), product('https://example.com.evil.test/product')))
        loaded = load_public_research(self.root)
        self.assertEqual(len(loaded['evidence']), 1)
        self.assertEqual(loaded['evidence'][0]['source_type'], 'disclosure')

    def test_private_http_credentials_fragments_ports_and_fake_gov_are_rejected(self):
        urls = ['http://www.shanghai.gov.cn/a', 'https://127.0.0.1/a',
                'https://localhost/a', 'https://foo.local/a',
                'https://user:pass@www.shanghai.gov.cn/a',
                'https://www.shanghai.gov.cn/a#fake', 'https://www.shanghai.gov.cn:8443/a',
                'https://www.shanghai.gov.cn.evil.test/a']
        for url in urls:
            with self.subTest(url=url):
                self.write(document(url, '生物医药公开记录明确描述产品的验证与生产情况。'))
                self.assertEqual(load_public_research(self.root)['evidence'], [])

    def test_quote_id_url_and_content_tampering_are_rejected(self):
        valid = document('https://www.shanghai.gov.cn/a', '生物医药产业公开资料，描述真实的设备与供应链情况。')
        for mutate in (lambda d: d['evidence'][0].update(quote='并非原文中的生物医药观点，不能作为有效证据。'),
                       lambda d: d['evidence'][0].update(id='tr_' + '0' * 20),
                       lambda d: d['evidence'][0].update(url='https://www.shanghai.gov.cn/b'),
                       lambda d: next(iter(d['sources'].values())).update(fulltext='替换后的不一致原文不能通过哈希校验。')):
            item = copy.deepcopy(valid)
            mutate(item)
            self.write(item)
            self.assertEqual(load_public_research(self.root)['evidence'], [])

    def test_national_original_scope_and_all_qualifications_are_kept(self):
        quote = '2024年中国生物医药滤器国产化率为29.6%，该统计不构成任何单个地区的调查。'
        self.write(document('https://static.sse.com.cn/a.pdf', quote))
        out = self.enrich()
        self.assertEqual(out['evidence'][0]['quote'], quote)
        self.assertNotIn('search_place', out['evidence'][0])
        self.assertNotIn('claim_scope', out['evidence'][0])
        self.assertEqual(out['evidence'][0]['source_type'], 'disclosure')

    def test_arbitrary_authored_fields_and_analysis_do_not_survive(self):
        data = document('https://www.shanghai.gov.cn/a', '生物医药已有真实产品的公开记录，包含足够长度的来源原句。')
        data['claim_links'] = [{'judgment': 'weak'}]
        data['evidence'][0].update(judgment='strong', chain_facets=['约束'], claim_scope='local')
        next(iter(data['sources'].values()))['summary'] = '人工结论'
        self.write(data)
        out = self.enrich()
        for key in ('claim_links', 'judgment', 'claim_scope', 'chain_facets', '人工结论'):
            self.assertNotIn(key, json.dumps(out, ensure_ascii=False))

    def test_existing_live_rows_are_kept_and_duplicate_enrichment_is_idempotent(self):
        self.write(combine(identity(), product()))
        first = self.enrich()
        second = self.enrich(first)
        self.assertEqual(second['evidence'], first['evidence'])
        self.assertEqual(second['sources'], first['sources'])
        self.assertEqual(second['public_research']['added_evidence_ids'], [])

    def test_forged_existing_attestation_cannot_authorize_company_merge(self):
        proof = identity()
        self.write(combine(proof, product()))
        base = {'city': '闵行区', 'topic': '生物医药',
                'evidence': [{'id': proof['evidence'][0]['id'], 'quote': '伪造的占位行'}], 'sources': {}}
        out = self.enrich(base)
        self.assertEqual(out['evidence'], base['evidence'])
        self.assertTrue(out['public_research']['rejected_count'])

    def test_malformed_existing_source_is_not_overwritten_or_crashing(self):
        data = document('https://www.shanghai.gov.cn/a', '生物医药产业原文明确记录科研与产品验证进展，供后续核查。')
        self.write(data)
        sid = next(iter(data['sources']))
        base = {'city': '闵行区', 'topic': '生物医药', 'sources': {sid: None}, 'evidence': []}
        out = self.enrich(base)
        self.assertEqual(out['sources'], {sid: None})
        self.assertEqual(out['evidence'], [])

    def test_company_is_skipped_when_no_room_for_its_attestation(self):
        self.write(combine(identity(), product()))
        with patch('backend.public_research.MAX_ARCHIVE_ROWS', 1):
            self.assertEqual(self.enrich()['evidence'], [])

    def test_invalid_file_does_not_hide_valid_record(self):
        (self.root / 'a.json').write_text('{broken json')
        self.write(document('https://www.shanghai.gov.cn/b', '生物医药公开原句，描述产业供应以及验证能力。'), 'b.json')
        loaded = load_public_research(self.root)
        self.assertEqual(len(loaded['evidence']), 1)
        self.assertEqual(loaded['rejected_count'], 1)

    def test_malformed_display_metadata_is_skipped_independently(self):
        for field in ('title', 'published_at', 'published', 'extraction', 'fulltext_scope'):
            with self.subTest(field=field):
                data = document('https://www.shanghai.gov.cn/a', '生物医药公开原文提供产业供给与相关产品的真实情况。')
                next(iter(data['sources'].values()))[field] = []
                self.write(data)
                self.assertEqual(self.enrich()['evidence'], [])

    def test_connected_mirror_pages_share_one_origin(self):
        text_x = '生物医药第一份原文内容，介绍产业链和科研平台的具体情况。'
        text_y = '生物医药第二份原文内容，保留同一公开文件的其他段落。'
        a = document('https://www.shanghai.gov.cn/a', text_x)
        b = document('https://www.shanghai.gov.cn/b', text_y)
        c = document('https://www.shanghai.gov.cn/b', text_x)
        self.write(combine(a, b, c))
        loaded = load_public_research(self.root)
        self.assertEqual(len(loaded['evidence']), 3)
        self.assertEqual(len({r['origin_id'] for r in loaded['evidence']}), 1)

    def test_archive_can_join_existing_mirror_components_without_mutating_input(self):
        text_x = '生物医药第一份原文内容，介绍产业链和科研平台的具体情况。'
        text_y = '生物医药第二份原文内容，保留同一公开文件的其他段落。'
        a = document('https://www.shanghai.gov.cn/a', text_x)
        b = document('https://www.shanghai.gov.cn/b', text_y)
        c = document('https://www.shanghai.gov.cn/b', text_x)
        base = dict(combine(a, b), city='闵行区', topic='生物医药')
        for index, row in enumerate(base['evidence']):
            row['origin_id'] = 'original_' + str(index)
        before = copy.deepcopy(base)
        self.write(c)
        merged = self.enrich(base)
        self.assertEqual(base, before)
        self.assertEqual(len({r['origin_id'] for r in merged['evidence']}), 1)

    def test_previously_detected_nonidentical_mirrors_are_never_split(self):
        a = document('https://www.shanghai.gov.cn/a', '生物医药原文第一版已经由在线流程确认与另一稿件同源。')
        b = document('https://www.shanghai.gov.cn/b', '生物医药原文转载版有细小文字差异，但在线流程已确认同源。')
        base = dict(combine(a, b), city='闵行区', topic='生物医药')
        for source in base['sources'].values():
            source['origin_id'] = 'origin_live_detected_mirror'
        for row in base['evidence']:
            row['origin_id'] = 'origin_live_detected_mirror'
        before = copy.deepcopy(base)
        # Even an unrelated/no-match archive must leave live provenance alone.
        no_match = self.enrich(base)
        self.assertEqual(no_match['evidence'], before['evidence'])
        self.write(document('https://www.shanghai.gov.cn/c', '生物医药新补充资料，包含另外一个需要核验的公开来源。'))
        out = self.enrich(base)
        self.assertEqual(base, before)
        self.assertEqual({r['origin_id'] for r in out['evidence'][:2]}, {'origin_live_detected_mirror'})

    def test_publisher_subdomains_do_not_claim_independent_publishers(self):
        self.write(combine(
            document('https://static.cninfo.com.cn/a.pdf', '生物医药第一份真实公开原文及产业供应资料。'),
            document('https://www.cninfo.com.cn/b.pdf', '生物医药第二份真实公开原文及产业供应资料。')))
        loaded = load_public_research(self.root)
        self.assertEqual({r['publisher_id'] for r in loaded['evidence']}, {'cninfo.com.cn'})

    def test_multiple_company_pages_share_one_attestation(self):
        second = document('https://example.com/product2', '生物医药公司另一个产品采用不同的生产验证流程，并有公开说明。')
        self.write(combine(identity(), product(), second))
        merged = self.enrich()
        self.assertEqual(len(merged['evidence']), 3)
        self.assertEqual(merged['public_research']['trusted_company_domains'], ['example.com'])

    def test_scope_mismatch_is_rejected(self):
        with self.assertRaises(ValueError):
            self.enrich({'city': '其他地区', 'topic': '生物医药'})


if __name__ == '__main__':
    unittest.main()
