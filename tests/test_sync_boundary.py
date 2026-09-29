import ast
import subprocess
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class SyncBoundaryTests(unittest.TestCase):
    def test_pure_merge_module_matches_original_definitions(self):
        from backend import sync_merge
        original=subprocess.check_output(['git','show','21baa54:server.py'],cwd=ROOT,text=True)
        new=ast.parse(Path(sync_merge.__file__).read_text())
        functions={n.name:ast.dump(n) for n in new.body if isinstance(n,ast.FunctionDef)}
        old={n.name:ast.dump(n) for n in ast.parse(original).body if isinstance(n,ast.FunctionDef) and n.name in functions}
        self.assertEqual(old,functions)
        self.assertEqual(sync_merge._keep_nonempty('retain',''),'retain')
