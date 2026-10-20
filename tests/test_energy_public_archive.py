"""Real energy archives retain originals, counterevidence and publisher scope."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from backend.public_research import (
    academic_primary_source_type, enrich_public_research, load_public_research,
)
from report_service.full_contract import canonical_url


ARCHIVE = Path(__file__).resolve().parents[1] / 'data/public-research/energy-demand-and-validation.json'


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def document(url, text, source_type='government'):
    sid = 'source_' + digest(canonical_url(url) + '\0' + text)[:20]
    common = {'url': url, 'title': '原始研究', 'retrieved_at': '2026-10-20T11:00:00+00:00',
              'published_at': '2026-04-22', 'retrieval': 'fetched'}
    return {'sources': {sid: dict(common, id=sid, fulltext=text,
                fulltext_sha256=digest(text), source_type=source_type)},
            'evidence': [dict(common, source_id=sid, quote=text,
                id='tr_' + digest(url + '\0' + text)[:20])]}


class EnergyArchiveTests(unittest.TestCase):
    def test_inspected_academic_publication_paths_have_a_separate_research_type(self):
        for url in (
            'https://news.sjtu.edu.cn/jdzh/20241024/203192.html',
            'https://www.engineering.org.cn/sscae/CN/10.15302/J-SSCAE-2025.10.021',
            'https://www.engineering.org.cn/sscae/CN/1250436416866628403',
            'https://ipe.cas.cn/cgzh/xmk/202604/t20260422_8189597.html',
        ):
            with self.subTest(url=url):
                self.assertEqual(academic_primary_source_type(url), 'research')

    def test_university_name_or_org_suffix_does_not_authorize_other_content(self):
        for url in (
            'https://example.org/paper',
            'https://unknown.edu.cn/research',
            'https://news.sjtu.edu.cn/user/20241024/203192.html',
            'https://fake.news.sjtu.edu.cn/jdzh/20241024/203192.html',
            'https://news.sjtu.edu.cn.evil.com/jdzh/20241024/203192.html',
            'https://www.engineering.org.cn/forum/10.15302/J-SSCAE-2025.10.021',
            'https://news.ecust.edu.cn/2025/0725/c160a192193/pagem.htm',
            'https://user:password@news.sjtu.edu.cn/jdzh/20241024/203192.html',
            'http://news.sjtu.edu.cn/jdzh/20241024/203192.html',
        ):
            with self.subTest(url=url):
                self.assertIsNone(academic_primary_source_type(url))

    def test_real_archive_has_complete_hash_bound_originals_and_exact_excerpts(self):
        data = json.loads(ARCHIVE.read_text())
        self.assertEqual(len(data['sources']), 6)
        self.assertEqual(len(data['evidence']), 17)
        for sid, source in data['sources'].items():
            with self.subTest(source=source['url']):
                self.assertEqual(source['id'], sid)
                self.assertEqual(sid, 'source_' + digest(canonical_url(source['url']) + '\0' + source['fulltext'])[:20])
                self.assertEqual(source['fulltext_sha256'], digest(source['fulltext']))
                self.assertEqual(source['retrieval'], 'fetched')
                self.assertTrue(source['retrieved_at'].startswith('2026-10-20T'))
                self.assertIn('Complete visible text', source['fulltext_scope'])
                self.assertNotIn('要查看并下载全文', source['fulltext'])
                self.assertNotIn('touch.shio.gov.cn', source['url'])
        for row in data['evidence']:
            source = data['sources'][row['source_id']]
            self.assertIn(row['quote'], source['fulltext'])
            self.assertEqual(row['id'], 'tr_' + digest(row['url'] + '\0' + row['quote'])[:20])
            self.assertEqual(row['retrieved_at'], source['retrieved_at'])
            self.assertEqual(row['url'], source['url'])

    def test_energy_originals_keep_constraints_existing_supply_and_resolved_history(self):
        data = json.loads(ARCHIVE.read_text())
        quotes = '\n'.join(row['quote'] for row in data['evidence'])
        for text in ('非氟离子膜的长期化学稳定性仍需大量工程实践验证',
                     '我国已实现全钒电解液的自主可控与规模化生产',
                     '上海电气', '并网性能测试', '中试阶段',
                     '生产所在地（位于江苏宜兴）', '目前，该企业已经拿到了归类预裁定'):
            self.assertIn(text, quotes)
        customs = [row for row in data['evidence'] if 'fgw.sh.gov.cn' in row['url']]
        self.assertEqual(len(customs), 1)
        # The reported old difficulty must travel with both identity and its resolution.
        self.assertIn('上海氢枫能源技术有限公司', customs[0]['quote'])
        self.assertIn('遇到了不小的困难', customs[0]['quote'])
        self.assertIn('已经拿到了归类预裁定', customs[0]['quote'])

    def test_loader_does_not_promote_research_to_government_or_corporate_identity(self):
        loaded = load_public_research()
        self.assertEqual(loaded['rejected_count'], 0)
        rows = [row for row in loaded['evidence'] if row['archive_file'] == ARCHIVE.name]
        self.assertEqual(len(rows), 17)
        for row in rows:
            if any(host in row['url'] for host in ('sjtu.edu.cn', 'engineering.org.cn', 'ipe.cas.cn')):
                self.assertEqual(row['source_type'], 'research')
                self.assertNotIn('website_attestation', row)
            if 'news.sjtu.edu.cn' in row['url']:
                self.assertEqual(row['publisher_id'], 'sjtu.edu.cn')
        self.assertNotIn('engineering.org.cn', loaded['trusted_company_domains'])
        self.assertNotIn('sjtu.edu.cn', loaded['trusted_company_domains'])

    def test_research_cannot_attest_a_company_website_even_with_a_website_field(self):
        research = document('https://news.sjtu.edu.cn/jdzh/20241024/203192.html',
            '本校团队研究液流电池长期稳定性。公司网址 www.example.com')
        company = document('https://www.example.com/product',
            '该企业生产液流电池隔膜，并开展长期稳定性验证测试。')
        data = {'sources': {**research['sources'], **company['sources']},
                'evidence': research['evidence'] + company['evidence']}
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'public.json').write_text(json.dumps(data, ensure_ascii=False))
            loaded = load_public_research(folder)
        self.assertEqual(loaded['trusted_company_domains'], [])
        self.assertEqual(len(loaded['evidence']), 1)
        self.assertEqual(loaded['evidence'][0]['source_type'], 'research')

    def test_corrupt_real_hash_or_nonoriginal_quote_is_rejected(self):
        for mutation in ('hash', 'quote'):
            data = json.loads(ARCHIVE.read_text())
            first = data['evidence'][0]
            if mutation == 'hash':
                data['sources'][first['source_id']]['fulltext_sha256'] = '0' * 64
            else:
                first['quote'] = '闵行区没有任何储能供应商，此句是篡改文本，不属于原文。'
                first['id'] = 'tr_' + digest(first['url'] + '\0' + first['quote'])[:20]
            with tempfile.TemporaryDirectory() as folder:
                Path(folder, 'public.json').write_text(json.dumps(data, ensure_ascii=False))
                loaded = load_public_research(folder)
            self.assertGreater(loaded['rejected_count'], 0)
            self.assertNotIn(first['id'], {row['id'] for row in loaded['evidence']})

    def test_enrichment_preserves_live_research_status_and_original_text(self):
        base = {'city': '闵行区', 'topic': '氢基能源与长时储能装备补链',
                'status': 'pending', 'errors': [{'code': 'search_incomplete'}], 'sources': {}, 'evidence': []}
        original = copy.deepcopy(base)
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, ARCHIVE.name).write_text(ARCHIVE.read_text())
            out = enrich_public_research(base, base['city'], base['topic'], folder)
        self.assertEqual(base, original)
        self.assertEqual(out['status'], 'pending')
        self.assertEqual(out['errors'], base['errors'])
        self.assertTrue(any(row['source_type'] == 'research' for row in out['evidence']))
        for row in out['evidence']:
            self.assertIn(row['quote'], out['sources'][row['source_id']]['fulltext'])


if __name__ == '__main__':
    unittest.main()
