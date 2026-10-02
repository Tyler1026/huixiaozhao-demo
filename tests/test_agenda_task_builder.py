import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest

PATH=pathlib.Path(__file__).resolve().parents[1]/'scripts/build_agenda_task.py'

class BuilderTests(unittest.TestCase):
    def load(self):
        self.assertTrue(PATH.exists(), 'deterministic task builder missing')
        spec=importlib.util.spec_from_file_location('task_builder',PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
    def test_each_child_has_future_utc_schedule_and_explicit_request_identity(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'pipeline_config.json'
            p.write_text(json.dumps({'city':'闵行区','province':'上海市','waves':{'wave1':{'agents':[{'id':'economic_profiler','prompt':'research','gate_cmd':'gate','output_file':str(pathlib.Path(d)/'economy.md')}]}}}))
            now=dt.datetime(2026,10,2,3,30,tzinfo=dt.timezone.utc)
            task=m.build(p,'rr_test','economic_profiler',now=now)
            self.assertEqual(task['action'],'create');self.assertEqual(task['taskType'],'generative')
            self.assertGreater(dt.datetime.fromisoformat(task['runAt'].replace('Z','+00:00')),now)
            self.assertEqual(task['name'],'慧小招-rr_test-economic_profiler')
            self.assertNotIn('cron',task);self.assertIsInstance(task['taskConfig'],dict)
            self.assertIn(str(p),task['taskConfig']['prompt']);self.assertIn('rr_test',task['taskConfig']['prompt'])
    def test_invalid_agent_request_or_relative_path_rejected(self):
        m=self.load()
        with self.assertRaises(ValueError):m.build(pathlib.Path('relative.json'),'rr_test','economic_profiler')
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'config.json';p.write_text('{"waves":{}}')
            with self.assertRaises(ValueError):m.build(p,'../escape','economic_profiler')
            with self.assertRaises(ValueError):m.build(p,'rr_test','missing')
    def test_old_template_without_schedule_fails_preflight(self):
        m=self.load()
        with self.assertRaises(ValueError):m.validate({'name':'old','taskType':'generative','taskConfig':{'prompt':'x'}})
    def test_expired_schedule_and_string_config_rejected(self):
        m=self.load()
        for payload in [ {'runAt':'2020-01-01T00:00:00Z','taskConfig':{'prompt':'x'}}, {'runAt':'2099-01-01T00:00:00Z','taskConfig':'{}'} ]:
            with self.assertRaises(ValueError):m.validate(payload)

if __name__=='__main__':unittest.main()
