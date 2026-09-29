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
        extracted=next(n for n in ast.parse(Path(sync_route.__file__).read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='handle_sync')
        self.assertEqual(ast.dump(expected),ast.dump(ast.Module(body=extracted.body,type_ignores=[])))

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
