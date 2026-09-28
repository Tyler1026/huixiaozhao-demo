"""Explicit synthetic-only manual browser server; cleans its temporary database on exit."""
import pathlib
import sys
import tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from identity.store import Store
from identity.http import make_server

with tempfile.TemporaryDirectory() as d:
    store = Store(pathlib.Path(d) / 'synthetic.db')
    store.create_customer('test-a', 'Synthetic-Test-A-2026')
    store.create_customer('test-b', 'Synthetic-Test-B-2026')
    p = store.authenticate(store.login('test-a', 'Synthetic-Test-A-2026')[0])
    store.put_state(p, p['org_id'], {
        'projects': {'synthetic': {'city': '合成测试城市', 'internalNote': '初始备注',
                                   'kb': [{'topic': '产业测试', 'known': ['合成知识条目，仅供组织隔离验收。']}]}},
        'reports': {'synthetic': {'text': '合成报告正文：本报告仅供权限验收，不用于招商决策。'}}
    }, 0)
    server = make_server(store, 5062)
    print('Synthetic loopback server ready on 5062', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
