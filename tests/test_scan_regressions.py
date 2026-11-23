"""Scanner regressions: bounded reminder work and immutable source presentation."""
import contextlib
import copy
import json
import unittest
from unittest.mock import patch
from backend import reminders as r
from backend.source_article import source_article_body, source_article_spans, source_publication_date
from test_reminders import fixture, principal, get, event, NOW

class ScannerSourceTests(unittest.TestCase):
    def test_split_and_combined_breadcrumbs_keep_article_and_source_spans(self):
        fact = '该政策仅适用于2025年7月1日至2027年12月31日期间符合资质的企业。'
        for chrome in (
            '当前位置：首页 / > 要闻动态 / > 地方动态 / 字号：默认 小大',
            '当前位置：首页\n&gt; 要闻动态 &gt; 地方动态\n字号：默认 小 大',
            '当前位置：首页\n>新闻中心>文件通知\n【字体：大 中 小】\n打印',
            '当前位置：\n首页 &amp;gt; 要闻动态 &gt; 地方动态\n字体大小：放大 正常 缩小',
        ):
            with self.subTest(chrome=chrome):
                original = '政策名称\n'+chrome+'\n'+fact
                clean = source_article_body(original)
                self.assertEqual(clean, '政策名称\n\n'+fact)
                self.assertTrue(all(part in original for part in source_article_spans(original)))
                self.assertEqual(source_article_body(clean), clean)
        prose = '企业按产品字号区分规格，默认小型企业也可申报。\n## 政务公开\n政务公开\n保留政策条件。'
        self.assertEqual(source_article_body(prose), prose)

    def test_duplicate_portal_title_is_removed_only_when_article_title_matches(self):
        title='苏州出台20条新政推动智能车联网和新能源汽车产业发展'
        original='江苏省人民政府 地方动态 '+title+'\n当前位置：首页\n> 要闻动态 > 地方动态\n'+title+'\n政策条件仍须核实。'
        self.assertEqual(source_article_body(original),title+'\n政策条件仍须核实。')
        self.assertEqual(source_article_body('江苏省人民政府 地方动态 '+title),'江苏省人民政府 地方动态 '+title)

    def test_date_is_valid_metadata_or_labelled_original_not_effective_date_or_url(self):
        self.assertEqual(source_publication_date('时间：2025-05-21 16:49\n政策自2025年7月1日起施行。','发布日期未知'),'2025-05-21')
        self.assertEqual(source_publication_date('来源：官网\n日期：2026-09-17'),'2026-09-17')
        self.assertEqual(source_publication_date('发布时间：\n2026年2月3日'),'2026-02-03')
        self.assertEqual(source_publication_date('发布日期：2026-04-08','2026-04-09T10:00:00Z'),'2026-04-09')
        for original in ('https://example.gov.cn/2025/5/21/a.html','政策自2025年7月1日起施行。','截至2026年6月1日项目在建。','更新时间：2026-04-08','发布日期：2026-02-30'):
            self.assertEqual(source_publication_date(original,'发布日期未知'),'')
        self.assertEqual(source_publication_date('发布时间：2026-04-08','2026-02-30'),'2026-04-08')

class ReminderWorkTests(unittest.TestCase):
    def test_workspace_resolution_does_not_grow_per_notification(self):
        state = fixture()
        get(state)
        for i in range(500):
            event(state, eid='event-'+str(i), ts=NOW+1)
        first = get(state, now=NOW+2)
        self.assertEqual(len(first['notifications']),500)
        with patch.object(r, '_project_roots', wraps=r._project_roots) as roots, patch.object(r, '_workspace_keys', wraps=r._workspace_keys) as scopes:
            result = get(state, now=NOW+2)
        self.assertEqual(result,first)
        self.assertEqual(roots.call_count,1)
        self.assertEqual(scopes.call_count,0)
        self.assertTrue(all(row['workspaceId']=='a' for row in result['notifications']))

    def test_request_and_tick_snapshot_only_reminders_not_business_payloads(self):
        for worker in (False,True):
            state=fixture()
            get(state)
            state['REPORTSTATE']={'a':{'largeArchive':'x'*1_000_000}}
            raw=json.dumps(state)
            writes=[];copied=[]
            @contextlib.contextmanager
            def factory():
                class Session:
                    def read(self):return raw
                    def write(self,value):writes.append(value);return True
                yield Session()
            original_copy=copy.deepcopy
            def tracked(value,*args,**kwargs):
                copied.append(value)
                return original_copy(value,*args,**kwargs)
            with patch.object(r.copy,'deepcopy',side_effect=tracked),patch.object(r,'require_session',return_value=principal()),patch.object(r,'respond') as respond:
                if worker:
                    r.run_once(factory,now=NOW)
                else:
                    handler=type('Handler',(),{'path':'/api/reminders?projectKey=a&requestId=test-read','headers':{}})()
                    r.handle_request(handler,None,factory,now=NOW)
                    self.assertEqual(respond.call_args.args[1],200)
            self.assertFalse(any(isinstance(value,dict) and 'PROJECTS' in value for value in copied))
            self.assertTrue(any(isinstance(value,dict) and any(isinstance(account,dict) and account.get('user')=='alice' for account in value.values()) for value in copied))
            self.assertEqual(writes,[])

if __name__=='__main__':
    unittest.main()
