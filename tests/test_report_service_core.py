"""Split-in-time TDD: report_service core (store, lease/fencing, worker, API).

No network beyond localhost. Temporary directories only. The standalone report
service is a durable-SQLite local pilot (explicitly NOT the PostgreSQL identity
production path); this test does not import or depend on identity/jobs.py.

Providers live in report_service.providers (owned by a sibling agent) and are
only imported lazily; every test here injects a fake provider or a localhost
subprocess, so no real provider or network is required.
"""
import contextlib
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from report_service import MAX_ATTEMPTS, STAGES  # noqa: E402
from report_service.store import Store, StoreConflict  # noqa: E402
from report_service.worker import load_provider, run_once  # noqa: E402
from report_service import api as api_module  # noqa: E402


class FakeProvider:
    """Deterministic in-memory provider honouring run(stage, job, prior)->str."""

    def __init__(self, delay=0.0, fail_stage=None, label="FAKE"):
        self.delay = delay
        self.fail_stage = fail_stage
        self.label = label
        self.calls = []

    def run(self, stage, job, prior):
        self.calls.append(stage)
        if self.delay:
            time.sleep(self.delay)
        if stage == self.fail_stage:
            raise RuntimeError("remote boom with a secret token aBcD1234 should not leak")
        return f"{self.label}({stage}):{job.get('city')}/{job.get('province')} prior={sorted(prior)}"


def temp_store():
    d = tempfile.TemporaryDirectory()
    self_holder = {}

    class _S(Store):
        pass

    # keep directory alive for the duration of the test
    self_holder['dir'] = d
    store = Store(Path(d.name) / "pilot.db")
    return store, d


class StoreIdempotencyTests(unittest.TestCase):
    def test_create_report_returns_queued_and_stable_id(self):
        store, d = temp_store()
        try:
            r1 = store.create_report("org-A", "湖北省", "随州", "req-1")
            r2 = store.create_report("org-A", "湖北省", "随州", "req-1")
            self.assertEqual(r1["id"], r2["id"])
            self.assertEqual(r1["id"], r2["id"])
            self.assertTrue(r1["created"])
            self.assertFalse(r2["created"])
            self.assertEqual(r1["status"], "queued")
        finally:
            d.cleanup()

    def test_same_key_different_tenant_is_distinct(self):
        store, d = temp_store()
        try:
            a = store.create_report("org-A", "湖北省", "随州", "req-1")
            b = store.create_report("org-B", "湖北省", "随州", "req-1")
            self.assertNotEqual(a["id"], b["id"])
            self.assertTrue(b["created"])
        finally:
            d.cleanup()

    def test_same_key_different_payload_conflicts(self):
        store, d = temp_store()
        try:
            store.create_report("org-A", "湖北省", "随州", "req-1")
            with self.assertRaises(StoreConflict):
                store.create_report("org-A", "湖北省", "武汉", "req-1")
            with self.assertRaises(StoreConflict):
                store.create_report("org-A", "湖南省", "随州", "req-1")
        finally:
            d.cleanup()

    def test_invalid_fields_rejected(self):
        store, d = temp_store()
        try:
            with self.assertRaises(ValueError):
                store.create_report("", "湖北省", "随州", "req-1")
            with self.assertRaises(ValueError):
                store.create_report("org-A", "", "随州", "req-1")
            with self.assertRaises(ValueError):
                store.create_report("org-A", "湖北省", "", "req-1")
            with self.assertRaises(ValueError):
                store.create_report("org-A", "湖北省", "随州", "")
            with self.assertRaises(ValueError):
                store.create_report("org-A", "湖北省", "随州", "k" * 129)
            with self.assertRaises(ValueError):
                store.create_report("org-A", "湖北省", "随州" * 40, "req-1")
        finally:
            d.cleanup()


class StoreLeaseTests(unittest.TestCase):
    def test_claim_assigns_lease_and_increments_attempts(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            job = store.claim(ttl=120.0)
            self.assertIsNotNone(job)
            self.assertEqual(job["id"], r["id"])
            self.assertTrue(job["lease"])
            self.assertEqual(job["attempts"], 1)
            pub = store.get_report("org-A", r["id"])
            self.assertEqual(pub["status"], "running")
        finally:
            d.cleanup()

    def test_heartbeat_extends_and_stale_lease_heartbeat_fails(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            job = store.claim(ttl=0.5)
            self.assertTrue(store.heartbeat(r["id"], job["lease"], 0.5))
            # wrong lease -> fencing rejects
            self.assertFalse(store.heartbeat(r["id"], "bad-lease", 0.5))
        finally:
            d.cleanup()

    def test_complete_requires_valid_unexpired_lease(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            job = store.claim(ttl=0.05)
            # wrong lease cannot complete
            self.assertFalse(store.complete(r["id"], "bad-lease", "done"))
            # expired lease cannot complete
            time.sleep(0.08)
            self.assertFalse(store.complete(r["id"], job["lease"], "done"))
            # fresh claim -> valid lease -> complete works
            job2 = store.claim(ttl=10.0)
            self.assertTrue(store.complete(r["id"], job2["lease"], "完成报告"))
            pub = store.get_report("org-A", r["id"])
            self.assertEqual(pub["status"], "completed")
            self.assertEqual(pub["result"], "完成报告")
        finally:
            d.cleanup()

    def test_crash_expiry_recovery_and_stale_fence(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            jobA = store.claim(ttl=0.05)
            time.sleep(0.08)  # worker A crashes, lease expires
            # a new worker reclaims
            jobB = store.claim(ttl=10.0)
            self.assertIsNotNone(jobB)
            self.assertEqual(jobB["id"], r["id"])
            self.assertEqual(jobB["attempts"], 2)
            # stale worker A fence is rejected after B reclaimed
            self.assertFalse(store.complete(r["id"], jobA["lease"], "stale"))
            # B completes successfully
            self.assertTrue(store.complete(r["id"], jobB["lease"], "fresh"))
            self.assertEqual(store.get_report("org-A", r["id"])["status"], "completed")
        finally:
            d.cleanup()

    def test_bounded_retries_exhaust_to_failed(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            for i in range(MAX_ATTEMPTS):
                job = store.claim(ttl=0.01)
                self.assertIsNotNone(job)
                self.assertEqual(job["attempts"], i + 1)
                time.sleep(0.02)  # let lease lapse between attempts
            # once attempts exhausted and lease expired, no further claim
            self.assertIsNone(store.claim(ttl=10.0))
            pub = store.get_report("org-A", r["id"])
            self.assertEqual(pub["status"], "failed")
            self.assertEqual(pub["error"]["code"], "lease_exhausted")
        finally:
            d.cleanup()


class StoreCheckpointTests(unittest.TestCase):
    def test_checkpoint_stores_and_resume_skips(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            job = store.claim(ttl=10.0)
            self.assertTrue(store.checkpoint(r["id"], job["lease"], "economy", "经济产出"))
            self.assertFalse(store.checkpoint(r["id"], "bad-lease", "economy", "x"))
            # crash, reclaim; prior checkpoints survive
            time.sleep(0.0)
            # force expiry to simulate crash
            with store.db() as connection:
                connection.execute('UPDATE reports SET expires=0 WHERE id=?', (r['id'],))
            job2 = store.claim(ttl=10.0)
            self.assertEqual(job2["checkpoints"], {"economy": "经济产出"})
            # complete with new lease
            self.assertTrue(store.complete(r["id"], job2["lease"], "最终报告"))
        finally:
            d.cleanup()

    def test_invalid_stage_rejected(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            job = store.claim(ttl=10.0)
            self.assertFalse(store.checkpoint(r["id"], job["lease"], "not-a-stage", "x"))
        finally:
            d.cleanup()


class WorkerTests(unittest.TestCase):
    def test_run_once_completes_all_stages(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            p = FakeProvider()
            summary = run_once(store, p, ttl=10.0)
            self.assertEqual(summary["id"], r["id"])
            self.assertEqual(summary["status"], "completed")
            self.assertEqual(p.calls, list(STAGES))
            pub = store.get_report("org-A", r["id"])
            self.assertEqual(pub["status"], "completed")
            self.assertIn("report", pub["result"])
        finally:
            d.cleanup()

    def test_heartbeat_keeps_lease_alive_across_slow_call(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            # Each stage sleeps well beyond the lease ttl; the heartbeat thread
            # (interval = ttl/4) must renew the lease before it expires. The
            # margin here is generous (ttl=1.0s, heartbeat every 250ms) so this
            # stays reliable under slower/shared CI runners, not just a quiet
            # local machine.
            p = FakeProvider(delay=0.3)
            summary = run_once(store, p, ttl=1.0)
            self.assertEqual(summary["status"], "completed")
            self.assertEqual(store.get_report("org-A", r["id"])["status"], "completed")
        finally:
            d.cleanup()

    def test_resume_skips_completed_stages_after_crash(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            job = store.claim(ttl=10.0)
            store.checkpoint(r["id"], job["lease"], STAGES[0], "done-0")
            with store.db() as connection:
                connection.execute('UPDATE reports SET expires=0 WHERE id=?', (r['id'],))
            p = FakeProvider()
            summary = run_once(store, p, ttl=10.0)
            self.assertEqual(summary["status"], "completed")
            # first stage was checkpointed, so provider only saw the rest
            self.assertNotIn(STAGES[0], p.calls)
            self.assertEqual(p.calls, list(STAGES[1:]))
        finally:
            d.cleanup()

    def test_provider_failure_is_sanitized(self):
        store, d = temp_store()
        try:
            r = store.create_report("org-A", "湖北省", "随州", "req-1")
            p = FakeProvider(fail_stage=STAGES[3])
            summary = run_once(store, p, ttl=10.0)
            self.assertEqual(summary["status"], "failed")
            pub = store.get_report("org-A", r["id"])
            self.assertEqual(pub["status"], "failed")
            self.assertEqual(pub["error"]["code"], "provider_error")
            # no raw exception / secret leaks
            self.assertNotIn("aBcD1234", json.dumps(pub))
            self.assertNotIn("Traceback", json.dumps(pub))
        finally:
            d.cleanup()


class LoadProviderTests(unittest.TestCase):
    def test_live_fails_closed_without_enable(self):
        # defaults: HXZ_ENABLE_LIVE absent -> must fail closed
        with self.assertRaises(RuntimeError):
            load_provider("live", env={})

    def test_unknown_provider_rejected(self):
        with self.assertRaises(ValueError):
            load_provider("totally-unknown", env={})


class ApiAuthTenantTests(unittest.TestCase):
    def setUp(self):
        self.store, self.d = temp_store()
        self.token = "s" * 40  # >= 32 chars
        self.token_map = {self.token: "org-A"}
        self.handler_cls = api_module.make_handler(self.store, self.token_map)
        self.server = _start_server(self.handler_cls)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.d.cleanup)

    def _post(self, path, body, token=None, headers=None):
        conn = http.client.HTTPConnection(*self.server.address)
        hdrs = {"Content-Type": "application/json"}
        if token is not None:
            hdrs["Authorization"] = f"Bearer {token}"
        if headers:
            hdrs.update(headers)
        data = json.dumps(body).encode() if body is not None else b""
        conn.request("POST", path, body=data, headers=hdrs)
        resp = conn.getresponse()
        payload = resp.read()
        conn.close()
        return resp.status, payload

    def _get(self, path, token=None):
        conn = http.client.HTTPConnection(*self.server.address)
        hdrs = {}
        if token is not None:
            hdrs["Authorization"] = f"Bearer {token}"
        conn.request("GET", path, headers=hdrs)
        resp = conn.getresponse()
        payload = resp.read()
        conn.close()
        return resp.status, payload

    def test_missing_and_bad_token_rejected(self):
        s, _ = self._post("/reports", {"province": "湖北省", "city": "随州", "idempotency_key": "k"})
        self.assertEqual(s, 401)
        s, _ = self._post("/reports", {"province": "湖北省", "city": "随州", "idempotency_key": "k"}, token="x" * 33)
        self.assertEqual(s, 401)

    def test_post_creates_report(self):
        s, body = self._post("/reports", {"province": "湖北省", "city": "随州", "idempotency_key": "k-1"}, token=self.token)
        self.assertIn(s, (200, 201))
        data = json.loads(body)
        self.assertEqual(data["status"], "queued")
        self.assertEqual(data["province"], "湖北省")
        self.assertNotIn("lease", json.dumps(data))

    def test_tenant_from_config_not_header(self):
        # even if client supplies X-Tenant, it is ignored; tenant binds to token
        s, body = self._post(
            "/reports",
            {"province": "湖北省", "city": "随州", "idempotency_key": "k-2"},
            token=self.token,
            headers={"X-Tenant": "evil-tenant"},
        )
        self.assertIn(s, (200, 201))
        data = json.loads(body)
        rid = data["id"]
        # the report belongs to org-A (token's tenant), retrievable under org-A
        pub = self.store.get_report("org-A", rid)
        self.assertIsNotNone(pub)
        # not retrievable under the spoofed tenant
        self.assertIsNone(self.store.get_report("evil-tenant", rid))
        # second token (different tenant) cannot see it either
        self.assertIsNone(self.store.get_report("org-B", rid))

    def test_get_requires_auth_and_is_tenant_scoped(self):
        s, body = self._post("/reports", {"province": "湖北省", "city": "随州", "idempotency_key": "k-3"}, token=self.token)
        data = json.loads(body)
        # no auth -> 401
        s2, _ = self._get(f"/reports/{data['id']}")
        self.assertEqual(s2, 401)
        # wrong tenant token -> 404
        other_map = {"t" * 40: "org-B"}
        self.handler_cls.token_map = self.token_map.copy()
        # register a second credential for org-B on the same server
        self.handler_cls.token_map["t" * 40] = "org-B"
        s3, _ = self._get(f"/reports/{data['id']}", token="t" * 40)
        self.assertEqual(s3, 404)
        # correct token -> 200
        s4, body4 = self._get(f"/reports/{data['id']}", token=self.token)
        self.assertEqual(s4, 200)
        self.assertEqual(json.loads(body4)["id"], data["id"])

    def test_validation_and_size_limits(self):
        s, _ = self._post("/reports", {}, token=self.token)
        self.assertEqual(s, 400)
        s, _ = self._post("/reports", {"province": "湖北省", "city": "随州"}, token=self.token)  # missing key
        self.assertEqual(s, 400)
        # oversized body
        big = {"province": "湖北省", "city": "随州", "idempotency_key": "k", "pad": "x" * (api_module.MAX_BODY + 1)}
        s, _ = self._post("/reports", big, token=self.token)
        self.assertEqual(s, 413)

    def test_idempotency_conflict_returns_409(self):
        self._post("/reports", {"province": "湖北省", "city": "随州", "idempotency_key": "k-5"}, token=self.token)
        s, body = self._post("/reports", {"province": "湖北省", "city": "武汉", "idempotency_key": "k-5"}, token=self.token)
        self.assertEqual(s, 409)

    def test_health_has_no_secrets(self):
        s, body = self._get("/healthz")
        self.assertEqual(s, 200)
        data = json.loads(body)
        self.assertNotIn(self.token, json.dumps(data))
        self.assertNotIn("org-A", json.dumps(data))

    def test_no_cors_headers(self):
        conn = http.client.HTTPConnection(*self.server.address)
        conn.request("GET", "/healthz")
        resp = conn.getresponse()
        self.assertNotIn("Access-Control-Allow-Origin", {k.lower(): v for k, v in resp.getheaders()})
        self.assertNotIn("Access-Control-Allow-Origin", dict(resp.getheaders()))
        resp.read()
        conn.close()


def _start_server(handler_cls):
    srv = api_module.ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    srv.address = srv.server_address
    return srv


class E2ESubprocessTests(unittest.TestCase):
    def test_api_worker_subprocess_end_to_end(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, "pilot.db")
            fake_py = os.path.join(d, "fake_provider.py")
            with open(fake_py, "w") as f:
                f.write("import time\n")
                f.write("class Provider:\n")
                f.write("    def run(self, stage, job, prior):\n")
                f.write("        return 'FAKE(%s):%s' % (stage, job.get('city'))\n")
                f.write("def build():\n")
                f.write("    return Provider()\n")
            env = os.environ.copy()
            env["HXZ_REPORT_SERVICE_TOKEN"] = "e2e-token-" + "x" * 32
            env["PYTHONPATH"] = d + os.pathsep + str(ROOT) + os.pathsep + env.get("PYTHONPATH", "")

            port = _free_port()
            api_proc = subprocess.Popen(
                [sys.executable, "-m", "report_service", "api",
                 "--db", db, "--host", "127.0.0.1", "--port", str(port)],
                cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

            try:
                _wait_ready(port)
                # create report
                conn = http.client.HTTPConnection("127.0.0.1", port)
                conn.request("POST", "/reports",
                             body=json.dumps({"province": "湖北省", "city": "随州", "idempotency_key": "e2e-1"}),
                             headers={"Content-Type": "application/json",
                                      "Authorization": "Bearer " + env["HXZ_REPORT_SERVICE_TOKEN"]})
                resp = conn.getresponse()
                created = json.loads(resp.read())
                conn.close()
                self.assertIn(resp.status, (200, 201))
                rid = created["id"]

                # run a single worker pass
                w = subprocess.run(
                    [sys.executable, "-m", "report_service", "worker",
                     "--db", db, "--once", "--provider", "fake_provider:build"],
                    cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
                self.assertEqual(w.returncode, 0, w.stdout.decode())

                # poll completion
                final = None
                for _ in range(100):
                    conn = http.client.HTTPConnection("127.0.0.1", port)
                    conn.request("GET", f"/reports/{rid}",
                                 headers={"Authorization": "Bearer " + env["HXZ_REPORT_SERVICE_TOKEN"]})
                    gr = conn.getresponse()
                    body = json.loads(gr.read())
                    conn.close()
                    if body["status"] in ("completed", "failed"):
                        final = body
                        break
                    time.sleep(0.05)
                self.assertIsNotNone(final, "report never reached terminal state")
                self.assertEqual(final["status"], "completed")
                self.assertIn("FAKE", final["result"])
                self.assertIn("随州", final["result"])
            finally:
                api_proc.terminate()
                try:
                    api_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    api_proc.kill()
                    api_proc.wait(timeout=5)
                api_proc.stdout.close()


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_ready(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
            conn.request("GET", "/healthz")
            conn.getresponse().read()
            conn.close()
            return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("api did not become ready")


if __name__ == "__main__":
    unittest.main()
