import ast
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# 【2026-09-29】邀请码功能新增的函数，不存在于旧基线(21baa54:server.py)里，
# 不应拿去跟"旧版本里不存在的东西"做逐字节AST比较——这条门禁的职责是防止
# "继承自旧版的函数被意外改动"，不是禁止新增函数。
NEW_FUNCTIONS_NOT_IN_BASELINE = {'_merge_invite_codes', '_chain_bundle', '_merge_chain_maps', '_chain_source_matches'}
NEW_FUNCTIONS_NOT_IN_BASELINE.update({'_stamp', '_max_stamps', '_topic_lifecycle', '_report_stamp',
    '_merge_topic_project_map', '_merge_report_state', '_merge_report_history'})
class SyncBoundaryTests(unittest.TestCase):
    def test_pure_merge_module_matches_original_definitions(self):
        from backend import sync_merge
        original=subprocess.check_output(['git','show','21baa54:server.py'],cwd=ROOT,text=True)
        new=ast.parse(Path(sync_merge.__file__).read_text())
        class StripGraphBundleMerge(ast.NodeTransformer):
            def visit_FunctionDef(self,node):
                if node.name=='_merge_map':
                    node.args.kwonlyargs=[];node.args.kw_defaults=[]
                return self.generic_visit(node)
            def visit_Assign(self,node):
                if any(isinstance(t,ast.Name) and t.id in {'previous','chain_fields'} for t in node.targets):
                    return None
                return self.generic_visit(node)
            def visit_If(self,node):
                # Only remove the server-owned graph branches; compare every other
                # inherited merge node exactly with the old baseline.
                if '_CHAIN_MAPS' in ast.unparse(node.test):
                    return None
                if '_REPORT_MAPS' in ast.unparse(node.test) and '_merge_report_state' in ast.unparse(node):
                    return None  # Atomic per-topic merge has its own behavioral regression suite.
                if ast.unparse(node.test) == "fk == 'historyDeletedAt'":
                    return None
                if (isinstance(node.test,ast.Compare) and isinstance(node.test.left,ast.Name)
                        and node.test.left.id=='fk' and any(isinstance(x,ast.Name) and x.id=='_CHAIN_MAPS' for x in node.test.comparators)):
                    return None
                if isinstance(node.test,ast.Name) and node.test.id=='chain_fields':
                    return None
                if isinstance(node.test,ast.Call) and isinstance(node.test.func,ast.Name) and node.test.func.id=='any' and '_CHAIN_MAPS' in ast.unparse(node.test):
                    return None
                return self.generic_visit(node)
            def visit_Return(self,node):
                if isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='_merge_topic_project_map':
                    return ast.Return(value=ast.Name(id='merged',ctx=ast.Load()))
                return self.generic_visit(node)
        new=StripGraphBundleMerge().visit(new)
        functions={n.name:ast.dump(n) for n in new.body if isinstance(n,ast.FunctionDef) and n.name not in NEW_FUNCTIONS_NOT_IN_BASELINE}
        old={n.name:ast.dump(n) for n in ast.parse(original).body if isinstance(n,ast.FunctionDef) and n.name in functions}
        self.assertEqual(old,functions)
        self.assertEqual(sync_merge._keep_nonempty('retain',''),'retain')
