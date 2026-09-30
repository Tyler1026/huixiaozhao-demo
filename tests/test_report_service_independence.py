"""Architectural boundary: report execution must not depend on the desktop runtime."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class IndependenceTests(unittest.TestCase):
    def test_service_exists_with_standalone_entrypoint(self):
        self.assertTrue((ROOT / 'report_service' / '__main__.py').is_file())

    def test_no_violoop_or_legacy_runtime_imports(self):
        modules = list((ROOT / 'report_service').glob('*.py'))
        self.assertTrue(modules, 'standalone report modules are missing')
        forbidden = {'violoop', 'agenda', 'identity', 'server', 'orchestrator'}
        for path in modules:
            tree = ast.parse(path.read_text(), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [node.module or '']
                else:
                    continue
                for name in names:
                    self.assertNotIn(name.split('.')[0], forbidden,
                                     f'{path.name} imports legacy runtime {name}')


if __name__ == '__main__':
    unittest.main()
