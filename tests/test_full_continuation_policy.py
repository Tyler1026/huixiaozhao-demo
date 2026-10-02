"""User policy: unlimited aggregate attempts/time; bounded individual calls."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from report_service.full_store import FullStore
from report_service import full_cli

STAGES = ({'id':'one','filename':'one.md','parts':('body',)},)


class Clock:
    def __init__(self): self.now=1000.
    def __call__(self): return self.now


class ContinuationPolicyTests(unittest.TestCase):
    def test_default_survives_many_attempts_and_over_two_hours_work(self):
        with tempfile.TemporaryDirectory() as d:
            clock=Clock(); db=Path(d)/'db'
            store=FullStore(db,stages=STAGES,clock=clock,backoff=(0,0))
            r=store.create('org','p','city','resume',True)
            for attempt in range(30):
                job=store.claim(ttl=600,timeout=600)
                self.assertIsNotNone(job, f'stopped at attempt {attempt+1}')
                self.assertEqual(job['attempts'],attempt+1)
                clock.now += 300
                self.assertTrue(store.fail_part(job['step_id'],job['token'],'upstream',True))
                store=FullStore(db,stages=STAGES,clock=clock,backoff=(0,0))
            self.assertEqual(store.get('org',r['id'])['status'],'retry_wait')
            self.assertEqual(store.claim()['attempts'],31)

    def test_explicit_attempt_limit_remains_opt_in(self):
        with tempfile.TemporaryDirectory() as d:
            s=FullStore(Path(d)/'db',stages=STAGES,max_attempts=2,backoff=(0,0))
            r=s.create('org','p','c','bounded',True)
            for _ in range(2):
                j=s.claim();s.fail_part(j['step_id'],j['token'],'timeout',True)
            self.assertEqual(s.get('org',r['id'])['status'],'failed')

    def test_default_still_has_a_single_call_hard_deadline(self):
        with tempfile.TemporaryDirectory() as d:
            clock=Clock();s=FullStore(Path(d)/'db',stages=STAGES,clock=clock,backoff=(0,0))
            s.create('org','p','c','deadline',True)
            j=s.claim(ttl=10,timeout=20);clock.now+=21
            self.assertFalse(s.heartbeat(j['step_id'],j['token']))
            self.assertEqual(s.claim()['attempts'],2)

    def test_worker_default_does_not_exit_at_two_hours(self):
        with tempfile.TemporaryDirectory() as d:
            args=['worker','--db',str(Path(d)/'db'),'--artifacts',str(Path(d)/'artifacts')]
            self.assertIsNone(full_cli.parse(args).run_limit)
            with patch('report_service.full_cli.time.monotonic', side_effect=[0.,7201.,7202.,7203.,7204.]), patch('report_service.full_cli.time.sleep'), patch('report_service.full_worker.run_once',side_effect=[None,KeyboardInterrupt]) as run:
                self.assertEqual(full_cli.main(args),130)
                self.assertEqual(run.call_count,2)

    def test_explicit_cli_timebox_is_preserved(self):
        a=full_cli.parse(['worker','--db','/tmp/test.db','--artifacts','/tmp/test-artifacts','--run-limit','30'])
        self.assertEqual(a.run_limit,30)


if __name__=='__main__':unittest.main()
