import multiprocessing
import os
import tempfile
import time
import unittest
from pathlib import Path

from report_service.full_store import FullStore
from report_service.full_worker import run_once, run_loop

STAGES = tuple({'id': f's{i}', 'filename': f'{i}.md', 'parts': ('body',)} for i in range(10))


class TinyContract:
    @staticmethod
    def assemble(stage, parts):
        return {'text': '\n'.join(p['text'] for p in parts), 'metadata': {}}
    @staticmethod
    def validate(stage, text, metadata, synthetic=False):
        return [] if text.strip() else ['empty']


class SlowContract(TinyContract):
    @staticmethod
    def validate(*args, **kwargs):
        time.sleep(2)
        return []


class GoodProvider:
    def run_part(self, stage, part, job, prior):
        return {'text': 'SYNTHETIC TEST ' + stage, 'metadata': {}}


class HungProvider:
    def run_part(self, stage, part, job, prior):
        while True: time.sleep(1)


class CrashProvider:
    def run_part(self, stage, part, job, prior): os._exit(7)


class FailOneProvider:
    def run_part(self, stage, part, job, prior):
        if job['city'] == 'bad': raise PermissionError('do not expose secret123')
        return {'text': 'SYNTHETIC TEST ' + stage, 'metadata': {}}


class FullWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.db'
        self.store = FullStore(self.path, stages=STAGES, backoff=(0, 0))
    def tearDown(self): self.tmp.cleanup()

    def test_hung_child_is_reaped_and_budget_exhausts(self):
        # A deliberately bounded test fixture, never the default service policy.
        self.store = FullStore(self.path, stages=STAGES, backoff=(0, 0), max_attempts=3)
        r = self.store.create('a', 'p', 'hang', 'h', True)
        before = {p.pid for p in multiprocessing.active_children()}
        started = time.monotonic()
        for _ in range(3):
            run_once(self.store, HungProvider(), ttl=1, timeout=.4, contract=TinyContract)
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(self.store.get('a', r['id'])['status'], 'failed')
        self.assertEqual(self.store.get('a', r['id'])['failure_code'], 'timeout')
        self.assertEqual({p.pid for p in multiprocessing.active_children()}, before)

    def test_crash_becomes_retry_not_infinite_running(self):
        r = self.store.create('a', 'p', 'crash', 'c', True)
        run_once(self.store, CrashProvider(), ttl=1, timeout=2, contract=TinyContract)
        public = self.store.get('a', r['id'])
        self.assertEqual(public['status'], 'retry_wait')
        self.assertEqual(public['failure_code'], 'worker_crash')

    def test_restart_keeps_first_eight_stage_bytes(self):
        r = self.store.create('a', 'p', 'resume', 'r', True)
        for _ in range(8):
            run_once(self.store, GoodProvider(), ttl=2, timeout=3, contract=TinyContract)
        first = self.store.parts(r['id'])
        self.assertEqual(len(first), 8)
        reopened = FullStore(self.path, stages=STAGES, backoff=(0, 0))
        run_once(reopened, GoodProvider(), ttl=2, timeout=3, contract=TinyContract)
        after = reopened.parts(r['id'])
        self.assertEqual({k: after[k] for k in first}, first)
        self.assertIn('s8', after)

    def test_loop_continues_after_permanent_job_failure(self):
        bad = self.store.create('a', 'p', 'bad', 'bad', True)
        good = self.store.create('a', 'p', 'good', 'good', True)
        run_loop(self.store, FailOneProvider(), max_steps=2, ttl=2, timeout=3, contract=TinyContract)
        b = self.store.get('a', bad['id'])
        self.assertEqual(b['status'], 'failed')
        self.assertEqual(b['failure_code'], 'configuration')
        self.assertNotIn('secret123', str(b))
        self.assertEqual(self.store.get('a', good['id'])['parts_done'], 1)

    def test_synthetic_worker_cannot_execute_live_job(self):
        r = self.store.create('a', 'p', 'live', 'live', False)
        run_once(self.store, GoodProvider(), contract=TinyContract, synthetic=True)
        self.assertEqual(self.store.get('a', r['id'])['status'], 'queued')
        self.assertEqual(self.store.get('a', r['id'])['parts_done'], 0)
        self.assertEqual(self.store.get('a', r['id'])['current']['attempts'], 0)

    def test_slow_validation_is_inside_hard_deadline(self):
        single = FullStore(self.path, stages=({'id':'one','filename':'one.md','parts':('body',)},), backoff=(0,0))
        single.create('a','p','slow','slow',True)
        start = time.monotonic()
        run_once(single, GoodProvider(), ttl=1, timeout=.4, contract=SlowContract)
        self.assertLess(time.monotonic()-start, 1.5)


if __name__ == '__main__': unittest.main()
