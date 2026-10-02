import io
import json
import unittest
from unittest.mock import Mock

class SyncRouteTests(unittest.TestCase):
    def test_extracted_body_is_baseline_ast_with_only_dependency_substitution(self):
        import ast,subprocess
        from pathlib import Path
        from backend import sync_route
        root=Path(__file__).resolve().parents[1]
        baseline=ast.parse(subprocess.check_output(['git','show','21baa54:server.py'],cwd=root,text=True))
        handler=next(n for n in baseline.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        post=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='do_POST')
        branch=next(n for n in post.body if isinstance(n,ast.If))
        original=ast.Module(body=branch.body,type_ignores=[])
        class Dependencies(ast.NodeTransformer):
            def visit_BoolOp(self,node):
                if ast.dump(node)==ast.dump(ast.parse('_PG_AVAIL and DATABASE_URL',mode='eval').body):
                    return ast.parse('deps.use_database',mode='eval').body
                return self.generic_visit(node)
            def visit_Name(self,node):
                mapping={'_db_get':'read','_db_set':'write','_file_snapshot':'snapshot_file','SYNC_PATH':'file_path','_clean_sync_data':'clean'}
                if node.id in mapping:return ast.Attribute(value=ast.Name(id='deps',ctx=ast.Load()),attr=mapping[node.id],ctx=node.ctx)
                return node
        expected=Dependencies().visit(original)
        extracted_fn=next(n for n in ast.parse(Path(sync_route.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='handle_sync')
        # 【2026-09-29】邀请码功能与城市基础包指针表带来两类偏移，均不存在于旧基线
        # 21baa54:server.py 里：
        # (1) `_protected` 列表字面量新增 'INVITE_CODES' / 'CITY_BASE_PACKAGES' 两个元素
        #     （分别防止空值裸覆盖邀请码库 / 城市基础包指针表）；
        # (2) `for k,v in incoming.items():` 循环体里新增
        #     `if k == 'INVITE_CODES': ... continue` 分支（改走专用合并函数）。
        #     CITY_BASE_PACKAGES 走默认的逐key覆盖分支，不需要单独的if分支。
        # 这条门禁的职责是"证明继承自旧版的逐字段合并逻辑一字未改"，不是"禁止任何新字段
        # 类型"——所以用 NodeTransformer 把这些新增内容从树里物理还原后再比较，而不是
        # 放宽比较标准去容纳它们。新增行为由下面 test_invite_codes_branch_* 单独验证。
        NEW_KEYS = {'INVITE_CODES', 'CITY_BASE_PACKAGES'}
        class StripInviteCodesAdditions(ast.NodeTransformer):
            def visit_If(self,node):
                self.generic_visit(node)
                test=node.test
                if (isinstance(test,ast.Compare) and isinstance(test.left,ast.Name) and test.left.id=='k'
                        and any(isinstance(c,ast.Constant) and c.value in NEW_KEYS for c in test.comparators)):
                    return None
                return node
            def visit_List(self,node):
                self.generic_visit(node)
                if any(isinstance(e,ast.Constant) and e.value in NEW_KEYS for e in node.elts):
                    node.elts=[e for e in node.elts if not (isinstance(e,ast.Constant) and e.value in NEW_KEYS)]
                return node
        extracted=StripInviteCodesAdditions().visit(extracted_fn)
        # 【2026-09-30】空写保护误杀 REPORT_REQUESTS 等局部更新的修复带来两处偏移，
        # 同样不存在于旧基线里：
        # (1) 新增 `_protected_incoming = any(...)` 赋值语句，判断 incoming 是否
        #     带了任一受保护字段的非空值；
        #     (2) 原有 `if _core_had and not _core_incoming:` 追加一个
        #     `and not _protected_incoming` 操作数，让"带受保护字段"的局部更新
        #     豁免空写拒绝。此门禁同样只证明"未改动的部分一字未改"，新增行为由
        #     test_report_requests_only_update_* / test_genuinely_empty_write_*
        #     单独验证。
        class StripEmptyWriteFix(ast.NodeTransformer):
            def visit_Assign(self,node):
                self.generic_visit(node)
                if (len(node.targets)==1 and isinstance(node.targets[0],ast.Name)
                        and node.targets[0].id=='_protected_incoming'):
                    return None
                return node
            def visit_BoolOp(self,node):
                self.generic_visit(node)
                if isinstance(node.op,ast.And):
                    kept=[v for v in node.values if not (isinstance(v,ast.UnaryOp)
                        and isinstance(v.op,ast.Not) and isinstance(v.operand,ast.Name)
                        and v.operand.id=='_protected_incoming')]
                    if len(kept)!=len(node.values):
                        return kept[0] if len(kept)==1 else ast.BoolOp(op=node.op,values=kept)
                return node
        extracted=StripEmptyWriteFix().visit(extracted)
        # 【2026-09-30】卡死任务手动取消功能：_rr_rank 状态排序字典新增
        # 'cancelled': 4 键值对，让 cancelled 排在最高、任何调度回写都覆盖不了它。
        # 同样只剔除新增的键值对，不放宽比较标准。
        class StripCancelledRank(ast.NodeTransformer):
            def visit_Dict(self,node):
                self.generic_visit(node)
                pairs=list(zip(node.keys,node.values))
                kept=[(k,v) for k,v in pairs if not (isinstance(k,ast.Constant) and k.value=='cancelled'
                        and isinstance(v,ast.Constant) and v.value==4)]
                if len(kept)!=len(pairs):
                    node.keys=[k for k,v in kept];node.values=[v for k,v in kept]
                return node
        extracted=StripCancelledRank().visit(extracted)
        ast.fix_missing_locations(extracted)
        self.assertEqual(ast.dump(expected),ast.dump(ast.Module(body=extracted.body,type_ignores=[])))

    def test_invite_codes_branch_merges_not_overwrites(self):
        # 邀请码新增分支的行为契约：走 _merge_invite_codes，不是裸覆盖——
        # 已有邀请码在增量同步(不带该码)时必须原样保留，不能被覆盖删除。
        from backend.sync_route import handle_sync, SyncDependencies
        writes=[]
        existing='{"PROJECTS":{"p":{"city":"随州"}},"INVITE_CODES":{"ABC12345":{"city":"随州","projKey":"p","usedBy":[]}}}'
        deps=SyncDependencies(True,lambda:existing,lambda value:writes.append(value) or True,'unused',lambda:None,lambda x:x)
        responder=Mock();responder.wfile=io.BytesIO()
        # 增量同步：不带 INVITE_CODES 字段，已有码必须原样保留
        handle_sync(responder,b'{"PROJECTS":{"p":{"city":"\xe9\x9a\x8f\xe5\xb7\x9e"}}}',deps)
        self.assertIn('ABC12345',json.loads(writes[0])['INVITE_CODES'])

    def test_file_store_snapshots_old_bytes_before_write(self):
        import tempfile
        from pathlib import Path
        from backend.sync_route import handle_sync,SyncDependencies
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'state.json';path.write_text('{"PROJECTS":{"old":{"city":"A"}}}')
            snapshots=[]
            deps=SyncDependencies(False,lambda:None,lambda v:False,str(path),lambda:snapshots.append(path.read_text()),lambda x:x)
            responder=Mock();responder.wfile=io.BytesIO()
            handle_sync(responder,b'{"PROJECTS":{"new":{"city":"B"}}}',deps)
            self.assertEqual(len(snapshots),1)
            self.assertEqual(set(json.loads(snapshots[0])['PROJECTS']),{'old'})
            self.assertEqual(set(json.loads(path.read_text())['PROJECTS']),{'old','new'})
            self.assertTrue(json.loads(responder.wfile.getvalue())['ok'])

    def test_explicit_store_preserves_existing_project(self):
        from backend.sync_route import handle_sync, SyncDependencies
        writes=[]
        deps=SyncDependencies(True,lambda:'{"PROJECTS":{"old":{"city":"A"}}}',lambda value:writes.append(value) or True,'unused',lambda:None,lambda x:x)
        responder=Mock();responder.wfile=io.BytesIO()
        handle_sync(responder,b'{"PROJECTS":{"new":{"city":"B"}}}',deps)
        self.assertEqual(json.loads(responder.wfile.getvalue()),{'ok':True})
        self.assertEqual(set(json.loads(writes[0])['PROJECTS']),{'old','new'})
    def test_read_failure_refuses_write(self):
        from backend.sync_route import handle_sync, SyncDependencies
        write=Mock();responder=Mock();responder.wfile=io.BytesIO()
        deps=SyncDependencies(True,lambda:None,write,'unused',lambda:None,lambda x:x)
        handle_sync(responder,b'{"PROJECTS":{"p":{}}}',deps)
        write.assert_not_called();self.assertFalse(json.loads(responder.wfile.getvalue())['ok'])

    def test_report_requests_only_update_is_not_treated_as_empty_write(self):
        # 回归：check_requests.py 的 claim/fail 只 PUT {REPORT_REQUESTS, syncTs}，
        # 不带 PROJECTS/USER_PROFILES/OPS_ENT。旧的空写保护把这种合法的局部更新
        # 误判为"整库被清空"而拒绝（rejected: empty-payload），claim 永远无法成功。
        # 只要 incoming 里带了任一受保护字段（_protected 列表，REPORT_REQUESTS 在内）
        # 且其值非空，就不该被判定为空写。
        from backend.sync_route import handle_sync, SyncDependencies
        existing = json.dumps({
            'PROJECTS': {'p': {'city': '\u677e\u6c5f\u533a'}},
            'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'pending'}],
        })
        writes = []
        deps = SyncDependencies(True, lambda: existing, lambda v: writes.append(v) or True,
                                 'unused', lambda: None, lambda x: x)
        responder = Mock(); responder.wfile = io.BytesIO()
        incoming = json.dumps({
            'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'running'}],
            'syncTs': 1,
        }).encode()
        handle_sync(responder, incoming, deps)
        body = json.loads(responder.wfile.getvalue())
        self.assertTrue(body.get('ok'), msg=body)
        self.assertEqual(len(writes), 1)
        saved = json.loads(writes[0])
        self.assertEqual(saved['REPORT_REQUESTS'][0]['status'], 'running')
        # PROJECTS 未在 incoming 里出现，必须原样保留，不能被清空。
        self.assertEqual(saved['PROJECTS']['p']['city'], '\u677e\u6c5f\u533a')

    def test_genuinely_empty_write_is_still_rejected(self):
        # 回归防线：修复不能把保护本身削弱到"什么都不带也放行"的地步——
        # 真正的空载荷（既无核心字段也无任何受保护字段）必须仍然拒绝。
        from backend.sync_route import handle_sync, SyncDependencies
        existing = json.dumps({'PROJECTS': {'p': {'city': '\u677e\u6c5f\u533a'}}})
        write = Mock(); responder = Mock(); responder.wfile = io.BytesIO()
        deps = SyncDependencies(True, lambda: existing, write, 'unused', lambda: None, lambda x: x)
        handle_sync(responder, b'{}', deps)
        write.assert_not_called()
        body = json.loads(responder.wfile.getvalue())
        self.assertFalse(body['ok'])
        self.assertEqual(body.get('rejected'), 'empty-payload')

    def test_cancelled_report_request_cannot_be_reverted_by_stale_scheduler_write(self):
        # 卡死任务手动取消：用户点击取消把某条 running 申请标 cancelled 后，
        # 后台调度脚本（此刻还拿着旧快照、以为它还是 running）如果稍后回写
        # 一次"仍是 running"的更新，绝不能把用户的取消决定覆盖回去。
        from backend.sync_route import handle_sync, SyncDependencies
        existing = json.dumps({
            'PROJECTS': {'p': {'city': '\u677e\u6c5f\u533a'}},
            'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'cancelled', 'ts': 1}],
        })
        writes = []
        deps = SyncDependencies(True, lambda: existing, lambda v: writes.append(v) or True,
                                 'unused', lambda: None, lambda x: x)
        responder = Mock(); responder.wfile = io.BytesIO()
        stale_scheduler_write = json.dumps({
            'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'running', 'ts': 1, 'claimTs': 999}],
            'syncTs': 2,
        }).encode()
        handle_sync(responder, stale_scheduler_write, deps)
        saved = json.loads(writes[0])
        self.assertEqual(saved['REPORT_REQUESTS'][0]['status'], 'cancelled')

    def test_user_can_cancel_a_running_request_via_sync(self):
        # 管理端点击"取消"按钮走的也是标准 /api/sync 局部更新路径；running -> cancelled
        # 是状态前进（rank 4 > rank 1），必须被接受写入。
        from backend.sync_route import handle_sync, SyncDependencies
        existing = json.dumps({
            'PROJECTS': {'p': {'city': '\u677e\u6c5f\u533a'}},
            'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'running', 'ts': 1}],
        })
        writes = []
        deps = SyncDependencies(True, lambda: existing, lambda v: writes.append(v) or True,
                                 'unused', lambda: None, lambda x: x)
        responder = Mock(); responder.wfile = io.BytesIO()
        cancel_write = json.dumps({
            'REPORT_REQUESTS': [{'id': 'rr1', 'status': 'cancelled', 'ts': 1}],
            'syncTs': 2,
        }).encode()
        handle_sync(responder, cancel_write, deps)
        body = json.loads(responder.wfile.getvalue())
        self.assertTrue(body.get('ok'), msg=body)
        self.assertEqual(json.loads(writes[0])['REPORT_REQUESTS'][0]['status'], 'cancelled')
