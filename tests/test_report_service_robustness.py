"""Regression checks found during parent review of the standalone pilot."""
import concurrent.futures
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from report_service import STAGES
from report_service.store import Store, StoreConflict
from report_service.worker import run_once
from report_service.__main__ import main


class RobustnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'reports.db')

    def test_concurrent_duplicate_creation_is_idempotent(self):
        barrier = threading.Barrier(8)
        def create(_):
            barrier.wait()
            return self.store.create_report('tenant', '上海', '松江区', 'duplicate')
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(create, range(8)))
        self.assertEqual(len({r['id'] for r in results}), 1)
        self.assertEqual(sum(r['created'] for r in results), 1)

    def test_parallel_claims_only_one_owner(self):
        self.store.create_report('tenant', '上海', '松江区', 'claim')
        barrier = threading.Barrier(8)
        def claim(_):
            barrier.wait()
            return self.store.claim()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(claim, range(8)))
        self.assertEqual(sum(r is not None for r in results), 1)

    def test_failed_job_retry_is_scoped_bounded_and_preserves_checkpoint(self):
        created = self.store.create_report('tenant', '上海', '松江区', 'retry')
        job = self.store.claim()
        self.store.checkpoint(job['id'], job['lease'], STAGES[0], 'saved')
        self.store.fail(job['id'], job['lease'], 'provider_error', 'safe')
        self.assertTrue(callable(getattr(self.store, 'retry_failed', None)), 'retry boundary missing')
        self.assertIsNone(self.store.retry_failed('other', job['id']))
        self.store.retry_failed('tenant', job['id'])
        second = self.store.claim()
        self.assertEqual(second['checkpoints'], {STAGES[0]: 'saved'})
        self.store.fail(job['id'], second['lease'], 'provider_error', 'safe')
        self.store.retry_failed('tenant', job['id'])
        third = self.store.claim()
        self.store.fail(job['id'], third['lease'], 'provider_error', 'safe')
        with self.assertRaises(StoreConflict):
            self.store.retry_failed('tenant', job['id'])

    def test_worker_failure_returns_nonzero_cli_status(self):
        with patch('report_service.worker.load_provider', return_value=object()), \
             patch('report_service.worker.run_loop', return_value={'status': 'failed'}):
            result = main(['worker', '--db', self.store.path, '--provider', 'synthetic', '--once'])
        self.assertEqual(result, 1)

    def test_api_negative_content_length_rejected_without_read(self):
        from report_service.api import ReportServiceHandler
        handler = object.__new__(ReportServiceHandler)
        handler.headers = {'Content-Length': '-1'}
        class Trap:
            def read(self, count):
                raise AssertionError('negative length must not reach read()')
        handler.rfile = Trap()
        self.assertIsNone(handler._read_body())

    def test_schema_has_no_force_expire_runtime_escape_hatch(self):
        self.assertFalse(hasattr(self.store, '_force_expire'))


if __name__ == '__main__':
    unittest.main()
