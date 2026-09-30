"""Black-box acceptance uses the real CLI and shipped synthetic provider only."""
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CliAcceptance(unittest.TestCase):
    def test_report_survives_api_restart_and_needs_no_desktop(self):
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / 'acceptance.db')
            token = secrets.token_hex(24)
            # Deliberately discard inherited model keys and all desktop configuration.
            env = {'PATH': os.environ.get('PATH', ''),
                   'PYTHONPATH': str(ROOT),
                   'HXZ_REPORT_SERVICE_TOKEN': token}
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]

            def request(method, route, body=None, authorized=True):
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                headers = {'Content-Type': 'application/json'}
                if authorized:
                    headers['Authorization'] = 'Bearer ' + token
                data = None if body is None else json.dumps(body).encode()
                try:
                    conn.request(method, route, data, headers)
                    response = conn.getresponse()
                    return response.status, json.loads(response.read())
                finally:
                    conn.close()

            def start():
                proc = subprocess.Popen(
                    [sys.executable, '-m', 'report_service', 'api', '--db', db,
                     '--host', '127.0.0.1', '--port', str(port)],
                    cwd=ROOT, env=env, stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE)
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if proc.poll() is not None:
                        self.fail('API startup failed: ' + proc.stderr.read().decode())
                    try:
                        status, _ = request('GET', '/healthz', authorized=False)
                        if status == 200:
                            return proc
                    except OSError:
                        time.sleep(.05)
                stop(proc)
                self.fail('API did not become healthy')

            def stop(proc):
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(5)
                proc.stderr.close()

            proc = start()
            try:
                payload = {'province': '上海', 'city': '松江区',
                           'idempotency_key': 'synthetic-acceptance'}
                status, _ = request('POST', '/reports', payload, authorized=False)
                self.assertEqual(status, 401)
                status, created = request('POST', '/reports', payload)
                self.assertIn(status, (200, 201))
                self.assertEqual(created['status'], 'queued')
                _, duplicate = request('POST', '/reports', payload)
                self.assertEqual(duplicate['id'], created['id'])
                rid = created['id']
                worker = subprocess.run(
                    [sys.executable, '-m', 'report_service', 'worker', '--db', db,
                     '--once', '--provider', 'synthetic'],
                    cwd=ROOT, env=env, capture_output=True, timeout=30)
                self.assertEqual(worker.returncode, 0, worker.stderr.decode())
                status, result = request('GET', '/reports/' + rid)
                self.assertEqual(status, 200)
                self.assertEqual(result['status'], 'completed', result)
                self.assertIn('SYNTHETIC', result['result'])
                self.assertNotIn('lease', result)
            finally:
                stop(proc)

            # A fresh API process must serve the persisted result, not process memory.
            proc = start()
            try:
                status, restored = request('GET', '/reports/' + rid)
                self.assertEqual(status, 200)
                self.assertEqual(restored['status'], 'completed')
                self.assertEqual(restored['result'], result['result'])
            finally:
                stop(proc)


if __name__ == '__main__':
    unittest.main()
