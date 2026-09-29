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
