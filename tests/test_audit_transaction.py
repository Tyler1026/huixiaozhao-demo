"""Audit writes must not overwrite concurrently saved report/demand state."""
import ast
import contextlib
import datetime
import io
import json
from pathlib import Path
import unittest


class AuditTransactionTests(unittest.TestCase):
    def load(self, transaction):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'audit_log')
        namespace = {'datetime': datetime, 'json': json, 'LOG_PATH': '/dev/null',
                     '_PG_AVAIL': True, 'DATABASE_URL': 'test', '_sync_transaction': transaction,
                     '_db_get': lambda: self.fail('an unlocked store read can lose concurrent updates'),
                     '_db_set': lambda value: self.fail('an unlocked whole-store write is forbidden')}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<audit function>', 'exec'), namespace)
        return namespace['audit_log']

    def test_reads_latest_store_after_acquiring_lock_and_keeps_report_and_demand(self):
        data = {'REPORTSTATE': {'p': {'text': 'initial'}}, 'DEMANDS': [],
                'RAG_AUDIT': [{'i': i} for i in range(200)]}
        events = []
        @contextlib.contextmanager
        def transaction():
            events.append('lock')
            # Another completed request committed immediately before our lock.
            data['REPORTSTATE']['p']['text'] = 'concurrently committed report'
            data['DEMANDS'].append({'id': 'concurrent-demand'})
            class Session:
                def read(self): events.append('read'); return json.dumps(data)
                def write(self, value):
                    events.append('write'); data.clear(); data.update(json.loads(value)); return True
            yield Session()
            events.append('unlock')
        with contextlib.redirect_stdout(io.StringIO()):
            self.load(transaction)({'purpose': 'report_priorities'})
        self.assertEqual(events, ['lock', 'read', 'write', 'unlock'])
        self.assertEqual(data['REPORTSTATE']['p']['text'], 'concurrently committed report')
        self.assertEqual(data['DEMANDS'], [{'id': 'concurrent-demand'}])
        self.assertEqual(len(data['RAG_AUDIT']), 200)
        self.assertEqual(data['RAG_AUDIT'][-1]['purpose'], 'report_priorities')

    def test_failed_audit_commit_does_not_claim_success_or_break_report_response(self):
        @contextlib.contextmanager
        def transaction():
            class Session:
                def read(self): return '{}'
                def write(self, value): return False
            yield Session()
        output = io.StringIO()
        with contextlib.redirect_stdout(output): self.load(transaction)({'purpose': 'report_priorities'})
        self.assertIn('audit write not committed', output.getvalue())


if __name__ == '__main__': unittest.main()
