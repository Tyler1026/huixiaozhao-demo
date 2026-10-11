"""Offline monthly scheduling and canonical report publication regressions."""
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from backend.auth import AuthError
from backend.city_workspaces import next_month_report_at
from backend.sync_transaction import file_session
from report_service.website_queue import (
    ENGINE, TOPICS, WebsiteQueue, _monthly_request_id, fence_updates, report_id, request_publication,
)
from test_website_report_engine import MemoryStore


SHANGHAI = timezone(timedelta(hours=8))


def timestamp(value):
    return datetime.fromisoformat(value).replace(tzinfo=SHANGHAI).timestamp()


class MonthlyReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'monthly.json'
        self.store = MemoryStore()
        self.queue = WebsiteQueue(self.store, lambda: file_session(str(self.path), lambda: None))
        self.city, self.key = '离线测试区', 'p_offline_canonical'
        self.now = timestamp('2026-10-01T09:00:00')
        self.initial = {
            'CITY_WORKSPACES': {self.city: {'projectKey': self.key, 'inviteCode': 'OFFLINETEST',
                'ownerUser': None, 'province': '离线测试省', 'createdAt': 1,
                'monthlyEnabled': True, 'nextReportAt': int(self.now * 1000)}},
            'PROJECTS': {self.key: {'id': self.key, 'workspaceId': self.key, 'city': self.city,
                'province': '离线测试省', 'topic': self.city + '产业链招引',
                'org': '保留机构', 'who': '保留联系人', 'stage': 4, 'kb': [],
                'clues': [{'id': 'existing-clue', 'text': '保留线索'}]}},
            'REPORT_REQUESTS': [],
        }
        self.write(self.initial)

    def write(self, state):
        self.path.write_text(json.dumps(state, ensure_ascii=False))

    def read(self):
        return json.loads(self.path.read_text())

    def request(self, name='rrmanual', **extra):
        result = dict(id=name, city=self.city, province='离线测试省', mode='standard',
                      status='pending', ts=1, projectKey=self.key)
        result.update(extra)
        return result

    def complete(self, request):
        state = self.read()
        state['REPORT_REQUESTS'].append(request)
        self.write(state)
        with patch('report_service.website_queue.time.time', return_value=self.now):
            self.queue.ingest()
        self.store.jobs[report_id(request['id'])].update(
            status='completed', stages_done=16, parts_done=80, current=None)
        self.queue.mirror()

    def test_schedule_uses_shanghai_calendar_month_at_boundary(self):
        before = timestamp('2026-09-30T23:59:59')
        self.assertEqual(self.queue.schedule_monthly(before), 0)
        self.assertEqual(self.queue.schedule_monthly(self.now), 1)
        state = self.read()
        request = state['REPORT_REQUESTS'][0]
        self.assertEqual(request['scheduledMonth'], '2026-10')
        self.assertEqual(request['id'], _monthly_request_id(self.city, self.key, '2026-10'))
        self.assertEqual(request['projectKey'], self.key)
        self.assertEqual(request['engine'], ENGINE)
        self.assertEqual(request['mode'], 'standard')
        self.assertIs(request['autoPublish'], True)
        self.assertEqual(request['by'], '每月自动更新')
        self.assertEqual(state['CITY_WORKSPACES'][self.city]['nextReportAt'],
                         int(timestamp('2026-11-01T09:00:00') * 1000))
        self.assertEqual(self.store.calls, [])

    def test_next_calendar_month_handles_leap_and_year_rollover(self):
        for current, expected in [('2024-01-31T23:59:00', '2024-02-01T09:00:00'),
                                  ('2024-02-29T23:59:00', '2024-03-01T09:00:00'),
                                  ('2026-12-31T23:59:00', '2027-01-01T09:00:00')]:
            with self.subTest(current=current):
                self.assertEqual(next_month_report_at(timestamp(current)), int(timestamp(expected) * 1000))

    def test_concurrent_schedule_is_atomic_and_idempotent(self):
        with ThreadPoolExecutor(max_workers=6) as executor:
            created = list(executor.map(self.queue.schedule_monthly, [self.now] * 12))
        self.assertEqual(sum(created), 1)
        self.assertEqual(len(self.read()['REPORT_REQUESTS']), 1)
        self.assertEqual(self.queue.schedule_monthly(self.now + 60), 0)

    def test_missed_months_schedule_only_current_month(self):
        state = self.read()
        state['CITY_WORKSPACES'][self.city]['nextReportAt'] = int(timestamp('2024-01-01T09:00:00') * 1000)
        self.write(state)
        self.assertEqual(self.queue.schedule_monthly(self.now), 1)
        self.assertEqual([r['scheduledMonth'] for r in self.read()['REPORT_REQUESTS']], ['2026-10'])

    def test_overdue_previous_month_waits_until_this_months_nine_am_release(self):
        state = self.read()
        due = int(timestamp('2026-09-01T09:00:00') * 1000)
        state['CITY_WORKSPACES'][self.city]['nextReportAt'] = due
        state['REPORT_REQUESTS'] = [self.request('rroverduerunning', status='running')]
        self.write(state)
        self.assertEqual(self.queue.schedule_monthly(timestamp('2026-09-30T23:59:59')), 0)
        state['REPORT_REQUESTS'][0]['status'] = 'done'
        self.write(state)
        for before in ('2026-10-01T00:00:00', '2026-10-01T08:59:59'):
            with self.subTest(before=before):
                self.assertEqual(self.queue.schedule_monthly(timestamp(before)), 0)
                self.assertEqual(len(self.read()['REPORT_REQUESTS']), 1)
                self.assertEqual(self.read()['CITY_WORKSPACES'][self.city]['nextReportAt'], due)
        self.assertEqual(self.queue.schedule_monthly(self.now), 1)
        self.assertEqual(self.queue.schedule_monthly(self.now), 0)
        final = self.read()
        self.assertEqual(len(final['REPORT_REQUESTS']), 2)
        self.assertEqual(final['REPORT_REQUESTS'][1]['scheduledMonth'], '2026-10')
        self.assertEqual(final['CITY_WORKSPACES'][self.city]['nextReportAt'], next_month_report_at(self.now))

    def test_all_unfinished_city_jobs_suppress_new_request_including_configuration_failure(self):
        for status in ('pending', 'running', 'failed', 'blocked', 'retry_wait', 'unknown'):
            with self.subTest(status=status):
                state = copy.deepcopy(self.initial)
                state['REPORT_REQUESTS'] = [self.request(status=status, failureCode='configuration')]
                self.write(state)
                self.assertEqual(self.queue.schedule_monthly(self.now), 0)
                self.assertEqual(len(self.read()['REPORT_REQUESTS']), 1)
                self.assertEqual(self.read()['CITY_WORKSPACES'][self.city]['nextReportAt'], int(self.now * 1000))

    def test_done_cancelled_and_other_city_do_not_block_current_city(self):
        state = self.read()
        state['REPORT_REQUESTS'] = [self.request('rrdone', status='done'),
                                    self.request('rrcancel', status='cancelled'),
                                    self.request('rrother', city='另一离线区', status='running')]
        self.write(state)
        self.assertEqual(self.queue.schedule_monthly(self.now), 1)
        self.assertEqual(len(self.read()['REPORT_REQUESTS']), 4)

    def test_existing_current_month_even_cancelled_is_never_recreated(self):
        state = self.read()
        state['REPORT_REQUESTS'] = [self.request(_monthly_request_id(self.city, self.key, '2026-10'),
                                                status='cancelled')]
        self.write(state)
        self.assertEqual(self.queue.schedule_monthly(self.now), 0)
        self.assertEqual(len(self.read()['REPORT_REQUESTS']), 1)
        self.assertEqual(self.read()['CITY_WORKSPACES'][self.city]['nextReportAt'], next_month_report_at(self.now))

    def test_invalid_disabled_and_unconfigured_bindings_are_not_scheduled(self):
        for field, value in [('province', ''), ('monthlyEnabled', False), ('projectKey', 'missing')]:
            with self.subTest(field=field):
                state = copy.deepcopy(self.initial)
                state['CITY_WORKSPACES'][self.city][field] = value
                self.write(state)
                self.assertEqual(self.queue.schedule_monthly(self.now), 0)
                self.assertEqual(self.read()['REPORT_REQUESTS'], [])
        state = copy.deepcopy(self.initial)
        state['PROJECTS'][self.key]['isDemand'] = True
        self.write(state)
        self.assertEqual(self.queue.schedule_monthly(self.now), 0)

    def test_schedule_failure_rolls_back_request_and_due_date(self):
        before = self.path.read_bytes()
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('offline write failure')):
            with self.assertRaises(OSError):
                self.queue.schedule_monthly(self.now)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.queue.schedule_monthly(self.now), 1)

    def test_ingest_schedules_and_hands_off_once_without_retry_limit_changes(self):
        with patch('report_service.website_queue.time.time', return_value=self.now):
            self.queue.ingest()
            self.queue.ingest()
        row = self.read()['REPORT_REQUESTS'][0]
        self.assertEqual(row['status'], 'running')
        self.assertEqual(len(self.store.calls), 1)
        self.store.jobs[report_id(row['id'])].update(status='retry_wait', failure_code='upstream',
            current={'stage': 'economy', 'attempts': 10001, 'next_at': self.now + 30})
        self.queue.mirror()
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['attempts'], 10001)
        self.assertEqual(self.read()['REPORT_REQUESTS'][0]['status'], 'running')

    def test_browser_cannot_forge_auto_publication_or_monthly_metadata(self):
        row = self.request(autoPublish=True, scheduledMonth='2026-10', pushed=True)
        result = json.loads(fence_updates(json.dumps({'REPORT_REQUESTS': [row]}), {}))['REPORT_REQUESTS'][0]
        self.assertNotIn('autoPublish', result)
        self.assertNotIn('scheduledMonth', result)
        self.assertNotIn('pushed', result)
        saved = self.request(engine=ENGINE, autoPublish=True, scheduledMonth='2026-10')
        result = json.loads(fence_updates(json.dumps({'REPORT_REQUESTS': [dict(saved, autoPublish=False,
            projectKey='different', scheduledMonth='2027-01')]}), {'REPORT_REQUESTS': [saved]}))
        self.assertEqual(result['REPORT_REQUESTS'], [saved])

    def test_monthly_completed_report_auto_publishes_only_to_existing_root(self):
        with patch('report_service.website_queue.time.time', return_value=self.now):
            self.queue.ingest()
        row = self.read()['REPORT_REQUESTS'][0]
        self.store.jobs[report_id(row['id'])].update(status='completed', stages_done=16, parts_done=80, current=None)
        self.queue.mirror()
        state = self.read()
        self.assertTrue(state['REPORT_REQUESTS'][0]['pushed'])
        self.assertEqual(set(state['PROJECTS']), {self.key})
        self.assertEqual(state['CITY_BASE_PACKAGES'], {self.city: self.key})
        self.assertEqual(state['REPORT_PUBLICATIONS'][row['id']]['projectKey'], self.key)
        self.assertEqual(state['REPORTSTATE'][self.key]['sourceReportId'], row['id'])
        saved = self.path.read_bytes()
        self.queue.mirror()
        self.assertEqual(self.path.read_bytes(), saved)

    def test_manual_report_still_requires_explicit_push_request(self):
        self.complete(self.request())
        self.assertNotIn('REPORTSTATE', self.read())
        state = self.read()
        state['REPORT_REQUESTS'][0]['pushRequested'] = True
        self.write(state)
        self.queue.mirror()
        self.assertTrue(self.read()['REPORT_REQUESTS'][0]['pushed'])
        self.assertEqual(set(self.read()['PROJECTS']), {self.key})

    def test_refresh_replaces_only_report_base_material_and_current_topic(self):
        state = self.read()
        sections = []
        for icon, title, _ in TOPICS:
            sections.append({'t': title, 'icon': icon, 'customMetadata': '保留', 'calls': ['保留访谈'],
                'known': [{'nature': 'base', 'text': '过期基础'}, {'nature': 'supplement', 'text': '保留补充'},
                          {'nature': 'fix', 'text': '保留修正'}, '保留旧文本']})
        custom = {'t': '用户自定义方向', 'known': [{'nature': 'base', 'text': '保留自定义基础'}]}
        sections.append(custom)
        state['PROJECTS'][self.key]['kb'] = sections
        state['REPORTSTATE'] = {self.key: {'aiReportByTopic': {'其他方向': '保留报告'},
            'phaseByTopic': {'其他方向': 1}, 'tsByTopic': {'其他方向': 123},
            'actionItemsByTopic': {'其他方向': ['保留行动']}, 'custom': '保留'}}
        self.write(state)
        self.complete(self.request(pushRequested=True))
        state = self.read()
        project = state['PROJECTS'][self.key]
        for field in ('org', 'who', 'stage', 'clues'):
            self.assertEqual(project[field], self.initial['PROJECTS'][self.key][field])
        self.assertEqual(project['kb'][-1], custom)
        for topic in project['kb'][:-1]:
            self.assertEqual(topic['calls'], ['保留访谈'])
            self.assertEqual(topic['customMetadata'], '保留')
            self.assertIn({'nature': 'supplement', 'text': '保留补充'}, topic['known'])
            self.assertIn({'nature': 'fix', 'text': '保留修正'}, topic['known'])
            self.assertIn('保留旧文本', topic['known'])
            self.assertNotIn({'nature': 'base', 'text': '过期基础'}, topic['known'])
        report = state['REPORTSTATE'][self.key]
        self.assertEqual(report['aiReportByTopic']['其他方向'], '保留报告')
        self.assertEqual(report['phaseByTopic']['其他方向'], 1)
        self.assertEqual(report['tsByTopic']['其他方向'], 123)
        self.assertEqual(report['actionItemsByTopic'], {'其他方向': ['保留行动']})
        self.assertEqual(report['custom'], '保留')
        self.assertEqual(report['aiReportByTopic'][project['topic']], self.store.payloads['09_compact_report.md'].decode())

    def test_monthly_base_report_never_overwrites_the_selected_custom_direction(self):
        state = self.read()
        state['PROJECTS'][self.key]['topic'] = '用户正在查看的自定义方向'
        state['REPORTSTATE'] = {self.key: {'aiReportByTopic': {'用户正在查看的自定义方向': '保留方向报告'},
            'phaseByTopic': {'用户正在查看的自定义方向': 1}, 'tsByTopic': {'用户正在查看的自定义方向': 42}}}
        self.write(state)
        self.complete(self.request(pushRequested=True))
        state = self.read()
        project, report = state['PROJECTS'][self.key], state['REPORTSTATE'][self.key]
        self.assertEqual(project['topic'], '用户正在查看的自定义方向')
        self.assertEqual(project['baseReportTopic'], self.city + '产业链招引')
        self.assertEqual(report['aiReportByTopic']['用户正在查看的自定义方向'], '保留方向报告')
        self.assertEqual(report['phaseByTopic']['用户正在查看的自定义方向'], 1)
        self.assertEqual(report['tsByTopic']['用户正在查看的自定义方向'], 42)
        self.assertEqual(report['aiReportByTopic'][project['baseReportTopic']], self.store.payloads['09_compact_report.md'].decode())

    def test_newer_report_stays_current_when_older_job_finishes_late(self):
        self.complete(self.request('rrnewer', ts=999, claimTs=20, pushRequested=True))
        newer_project = copy.deepcopy(self.read()['PROJECTS'][self.key])
        newer_report = copy.deepcopy(self.read()['REPORTSTATE'][self.key])
        self.complete(self.request('rrolder', ts=9999999999999, claimTs=10, pushRequested=True))
        state = self.read()
        self.assertEqual(state['PROJECTS'][self.key], newer_project)
        self.assertEqual(state['REPORTSTATE'][self.key], newer_report)
        self.assertEqual(set(state['REPORT_PUBLICATIONS']), {'rrnewer', 'rrolder'})
        self.assertEqual(state['REPORT_PUBLICATIONS']['rrolder']['status'], 'superseded')
        self.assertEqual(state['REPORT_REQUESTS'][-1]['publicationSkipped'], 'newer-report-already-published')
        self.assertFalse(state['REPORT_REQUESTS'][-1]['pushed'])
        snapshot = self.path.read_bytes()
        self.queue.mirror()
        self.assertEqual(self.path.read_bytes(), snapshot)
        handler = Mock()
        handler.wfile = io.BytesIO()
        request_publication(handler, json.dumps({'city': self.city, 'requestId': 'rrolder'}), self.queue.session)
        body = json.loads(handler.wfile.getvalue())
        self.assertEqual(body['publicationSkipped'], 'newer-report-already-published')
        self.assertTrue(body['alreadyRequested'])
        self.assertEqual(self.path.read_bytes(), snapshot)

    def test_duplicate_old_topic_does_not_keep_stale_base_or_duplicate_new_base(self):
        state = self.read()
        title = TOPICS[0][1]
        state['PROJECTS'][self.key]['kb'] = [
            {'t': title, 'known': [{'nature': 'base', 'text': '旧一'}]},
            {'t': title, 'known': [{'nature': 'base', 'text': '旧二'},
                                   {'nature': 'supplement', 'text': '保留二'}]}]
        self.write(state)
        self.complete(self.request(pushRequested=True))
        topics = [topic for topic in self.read()['PROJECTS'][self.key]['kb'] if topic['t'] == title]
        self.assertTrue(any(item.get('nature') == 'base' for item in topics[0]['known']))
        self.assertEqual(topics[1]['known'], [{'nature': 'supplement', 'text': '保留二'}])

    def test_fixed_root_publication_write_failure_does_not_partially_replace_material(self):
        self.complete(self.request())
        state = self.read()
        state['REPORT_REQUESTS'][0]['pushRequested'] = True
        self.write(state)
        before = self.path.read_bytes()
        with patch('backend.sync_transaction.os.replace', side_effect=OSError('offline write failure')):
            with self.assertRaises(OSError):
                self.queue.mirror()
        self.assertEqual(self.path.read_bytes(), before)
        self.queue.mirror()
        self.assertTrue(self.read()['REPORT_REQUESTS'][0]['pushed'])

    def test_newer_version_reuses_root_and_keeps_old_receipt(self):
        self.complete(self.request('rrfirst', claimTs=10, pushRequested=True))
        first_receipt = copy.deepcopy(self.read()['REPORT_PUBLICATIONS']['rrfirst'])
        self.complete(self.request('rrsecond', claimTs=20, pushRequested=True))
        state = self.read()
        self.assertEqual(set(state['PROJECTS']), {self.key})
        self.assertEqual(state['PROJECTS'][self.key]['reportRequestId'], 'rrsecond')
        self.assertEqual(state['REPORT_PUBLICATIONS']['rrfirst'], first_receipt)
        self.assertEqual(state['REPORTSTATE'][self.key]['baseReportVersion']['requestId'], 'rrsecond')

    def test_invalid_canonical_never_falls_back_to_new_report_project(self):
        self.complete(self.request())
        state = self.read()
        state['CITY_WORKSPACES'][self.city]['projectKey'] = 'missing-root'
        state['REPORT_REQUESTS'][0]['pushRequested'] = True
        self.write(state)
        before = self.path.read_bytes()
        with self.assertRaises(AuthError):
            self.queue.mirror()
        self.assertEqual(self.path.read_bytes(), before)
        self.assertNotIn('report_rrmanual', self.read()['PROJECTS'])

    def test_cancelled_monthly_report_is_never_published(self):
        with patch('report_service.website_queue.time.time', return_value=self.now):
            self.queue.ingest()
        state = self.read()
        row = state['REPORT_REQUESTS'][0]
        row['status'] = 'cancelled'
        self.write(state)
        self.store.jobs[report_id(row['id'])].update(status='completed')
        self.queue.mirror()
        self.assertNotIn('REPORT_PUBLICATIONS', self.read())


if __name__ == '__main__':
    unittest.main()
