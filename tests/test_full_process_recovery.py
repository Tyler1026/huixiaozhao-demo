import hashlib
import json
import multiprocessing
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from report_service.full_store import FullStore
from report_service.full_worker import run_once

ROOT = Path(__file__).resolve().parents[1]
STAGES = ({'id': 'one', 'filename': 'one.md', 'parts': ('part',)},)


class HungPIDProvider:
    def __init__(self, pidfile): self.pidfile = pidfile
    def run_part(self, *args):
        Path(self.pidfile).write_text(str(os.getpid()))
        while True: time.sleep(.1)


def run_hanging(db, pidfile):
    store = FullStore(db, stages=STAGES, backoff=(0, 0))
    run_once(store, HungPIDProvider(pidfile), ttl=1, timeout=20)


def alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False


class ProcessRecoveryTests(unittest.TestCase):
    def test_killed_worker_does_not_leave_provider_running(self):
        with tempfile.TemporaryDirectory() as d:
            db = str(Path(d) / 'db'); pidfile = str(Path(d) / 'child.pid')
            s = FullStore(db, stages=STAGES, backoff=(0, 0))
            r = s.create('org', 'p', 'c', 'orphan', True)
            p = multiprocessing.get_context('spawn').Process(target=run_hanging, args=(db, pidfile))
            p.start(); child = None
            try:
                deadline = time.monotonic() + 5
                while not Path(pidfile).exists() and time.monotonic() < deadline: time.sleep(.02)
                self.assertTrue(Path(pidfile).exists())
                child = int(Path(pidfile).read_text())
                p.kill(); p.join(timeout=2)
                deadline = time.monotonic() + 3
                while alive(child) and time.monotonic() < deadline: time.sleep(.05)
                self.assertFalse(alive(child), 'provider survived its killed worker')
                time.sleep(1.05)
                s.get('org', r['id'])
                recovered = s.claim(ttl=1, timeout=2)
                self.assertIsNotNone(recovered)
                self.assertEqual(recovered['attempts'], 2)
            finally:
                if p.is_alive(): p.kill(); p.join()
                if child and alive(child): os.kill(child, signal.SIGKILL)
                p.close()

    def test_cli_kill_after_eight_stages_preserves_exact_checkpoints(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); db = root / 'db'; artifacts = root / 'artifacts'
            s = FullStore(db, artifact_root=artifacts)
            r = s.create('test-org', '合成省', '合成区', 'kill-resume', True)
            cmd = [sys.executable, '-m', 'report_service.full_cli', 'worker', '--db', str(db), '--artifacts', str(artifacts), '--provider', 'synthetic', '--ttl', '1', '--run-limit', '60']
            env = dict(os.environ)
            p = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                reached = False
                for line in p.stdout:
                    result = json.loads(line)
                    if result.get('stage') == 'chain' and result.get('status') == 'checkpoint':
                        public = s.get('test-org', r['id'])
                        if public['stages_done'] >= 8:
                            reached = True; p.kill(); break
                self.assertTrue(reached, 'worker did not complete first eight stages')
                p.communicate(timeout=5)
                first = {k: v for k, v in s.parts(r['id']).items() if k in ('economy','population','transport','life','industry','competition','policy','chain')}
                digest = hashlib.sha256(json.dumps(first, sort_keys=True).encode()).hexdigest()
                time.sleep(1.1)
                reopened = FullStore(db, artifact_root=artifacts, backoff=(0, 0))
                reopened.get('test-org', r['id'])
                # Complete the next durable part in a distinct CLI process.
                q = subprocess.run(cmd + ['--once'], cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(q.returncode, 0, q.stderr)
                after = {k: reopened.parts(r['id'])[k] for k in first}
                self.assertEqual(hashlib.sha256(json.dumps(after, sort_keys=True).encode()).hexdigest(), digest)
            finally:
                if p.poll() is None: p.kill()
                p.communicate(timeout=5)


if __name__ == '__main__': unittest.main()
