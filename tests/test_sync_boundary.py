import ast
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# 【2026-09-29】邀请码功能新增的函数，不存在于旧基线(21baa54:server.py)里，
# 不应拿去跟"旧版本里不存在的东西"做逐字节AST比较——这条门禁的职责是防止
# "继承自旧版的函数被意外改动"，不是禁止新增函数。
NEW_FUNCTIONS_NOT_IN_BASELINE = {'_merge_invite_codes'}
class SyncBoundaryTests(unittest.TestCase):
    def test_pure_merge_module_matches_original_definitions(self):
        from backend import sync_merge
        original=subprocess.check_output(['git','show','21baa54:server.py'],cwd=ROOT,text=True)
        new=ast.parse(Path(sync_merge.__file__).read_text())
        functions={n.name:ast.dump(n) for n in new.body if isinstance(n,ast.FunctionDef) and n.name not in NEW_FUNCTIONS_NOT_IN_BASELINE}
        old={n.name:ast.dump(n) for n in ast.parse(original).body if isinstance(n,ast.FunctionDef) and n.name in functions}
        self.assertEqual(old,functions)
        self.assertEqual(sync_merge._keep_nonempty('retain',''),'retain')
