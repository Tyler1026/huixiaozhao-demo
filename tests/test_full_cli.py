import hashlib
import json
import os
import select
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

from report_service.full_store import FullStore

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'synthetic-only-' + 'q' * 40


class FullCLITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.db = self.root / 'jobs.db'
        self.artifacts = self.root / 'artifacts'
        self.env = {k: v for k, v in os.environ.items() if not any(x in k.upper() for x in ('API_KEY', 'MODEL_KEY', 'SEARCH_KEY', 'TOKEN'))}
        self.env['HXZ_FULL_TOKENS_JSON'] = json.dumps({TOKEN: 'test-org'})
        self.api = None
    def tearDown(self):
        self.stop_api(); self.tmp.cleanup()
    def command(self, mode):
        return [sys.executable, '-m', 'report_service.full_cli', mode, '--db', str(self.db), '--artifacts', str(self.artifacts)]
    def start_api(self):
        self.api = subprocess.Popen(self.command('api') + ['--port', '0'], cwd=ROOT, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        ready, _, _ = select.select([self.api.stdout], [], [], 5)
        self.assertTrue(ready, 'API did not announce readiness')
        line = self.api.stdout.readline()
        self.assertTrue(line, self.api.stderr.read() if self.api.poll() is not None else 'no startup line')
        port = json.loads(line)['listen_port']
        self.base = 'http://127.0.0.1:' + str(port)
    def stop_api(self):
        if self.api:
            self.api.terminate()
            try: self.api.communicate(timeout=5)
            except subprocess.TimeoutExpired: self.api.kill(); self.api.communicate()
            self.api = None
    def http(self, path, data=None):
        req = urllib.request.Request(self.base + path, headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'}, data=json.dumps(data).encode() if data is not None else None)
        with urllib.request.urlopen(req, timeout=5) as r: return r.read()

    def test_full_api_worker_restart_download(self):
        self.start_api()
        report = json.loads(self.http('/v1/reports', {'city': '合成验证区', 'province': '合成省', 'idempotency_key': 'full-acceptance', 'synthetic': True}))
        worker = subprocess.run(self.command('worker') + ['--provider', 'synthetic', '--until-id', report['id'], '--tenant', 'test-org', '--run-limit', '90'], cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=100)
        self.assertEqual(worker.returncode, 0, worker.stdout + worker.stderr)
        self.stop_api(); self.start_api()
        public = json.loads(self.http('/v1/reports/' + report['id']))
        self.assertEqual(public['status'], 'completed', public)
        self.assertEqual(public['stages_done'], 16)
        self.assertEqual(public['publication_status'], 'unpublished')
        files = public['manifest']['files']
        self.assertEqual(sum(x['name'].endswith('.md') for x in files), 16)
        self.assertEqual(sum(x['name'].endswith('.docx') for x in files), 2)
        for item in files:
            body = self.http('/v1/reports/' + report['id'] + '/artifacts/' + item['name'])
            self.assertEqual(hashlib.sha256(body).hexdigest(), item['sha256'])
        store = FullStore(self.db, artifact_root=self.artifacts)
        self.assertEqual(len(store.parts(report['id'])), 16)

    def test_worker_requires_explicit_live_enable(self):
        result = subprocess.run(self.command('worker') + ['--provider', 'live', '--once'], cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__': unittest.main()
