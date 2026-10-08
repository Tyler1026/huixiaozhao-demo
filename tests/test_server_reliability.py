"""Exercise real request handler without importing service credentials or networking."""
import ast
import io
import json
from pathlib import Path
import unittest
from http.server import BaseHTTPRequestHandler

ROOT = Path(__file__).resolve().parents[1]


def environment(raw, store='{}', write_ok=True, path='/api/sync'):
    tree = ast.parse((ROOT / 'server.py').read_text())
    names = {'Handler', '_keep_nonempty', '_kb_material_count', '_merge_map', '_is_noise_chunk', '_merge_kb_item_tombs', '_apply_kb_item_tombs', '_kb_item_fp', '_clean_sync_data'}
    nodes = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in names]
    writes = []
    ns = dict(BaseHTTPRequestHandler=BaseHTTPRequestHandler, json=json,
              _PG_AVAIL=True, DATABASE_URL='synthetic', _NOISE_RE=[],
              SYNC_PATH='unused', _file_snapshot=lambda:None,
              _db_get=lambda: store)
    def save(value):
        writes.append(value)
        return write_ok
    from backend import sync_merge
    for name in names:
        if hasattr(sync_merge,name):ns[name]=getattr(sync_merge,name)
    ns['_db_set'] = save
    from contextlib import contextmanager
    @contextmanager
    def transaction():
        from types import SimpleNamespace
        yield SimpleNamespace(read=lambda: store, write=save)
    ns['_sync_transaction'] = transaction
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'server.py', 'exec'), ns)
    handler = object.__new__(ns['Handler'])
    handler.path = path
    handler.headers = {'Content-Length': str(len(raw))}
    handler.rfile = io.BytesIO(raw)
    handler.wfile = io.BytesIO()
    handler.send_response = lambda code: None
    handler.send_header = lambda *args: None
    handler.end_headers = lambda: None
    handler.do_POST()
    return json.loads(handler.wfile.getvalue()), writes


class ServerReliabilityTests(unittest.TestCase):
    def test_invalid_json_never_writes(self):
        result, writes = environment(b'{broken')
        self.assertFalse(result['ok'])
        self.assertEqual(writes, [])

    def test_nonobject_never_writes(self):
        for raw in [b'[]', b'null', b'42']:
            result, writes = environment(raw)
            self.assertFalse(result['ok'])
            self.assertEqual(writes, [])

    def test_failed_read_never_writes(self):
        result, writes = environment(b'{"PROJECTS":{"p":{}}}', store=None)
        self.assertFalse(result['ok'])
        self.assertEqual(writes, [])

    def test_invalid_existing_state_never_writes(self):
        result, writes = environment(b'{"PROJECTS":{"p":{}}}', store='[]')
        self.assertFalse(result['ok'])
        self.assertEqual(writes, [])

    def test_success_preserves_existing(self):
        result, writes = environment(b'{"PROJECTS":{"new":{"city":"B"}}}', store='{"PROJECTS":{"old":{"city":"A"}}}')
        self.assertTrue(result['ok'])
        self.assertEqual(set(json.loads(writes[0])['PROJECTS']), {'old', 'new'})

    def test_sync_failed_write_reported(self):
        result, _ = environment(b'{"PROJECTS":{"p":{}}}', write_ok=False)
        self.assertFalse(result['ok'])

    def test_upload_write_failure_reported(self):
        data = {'projectKey': 'p', 'topic': 'industry', 'text': '', 'mode': 'append'}
        result, writes = environment(json.dumps(data).encode(),
            store='{"PROJECTS":{"p":{"kb":[]}}}', write_ok=False, path='/api/kb-upload')
        self.assertEqual(len(writes), 1)
        self.assertFalse(result['ok'])


if __name__ == '__main__':
    unittest.main()
