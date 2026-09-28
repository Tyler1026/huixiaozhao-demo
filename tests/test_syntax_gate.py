"""Regression coverage for the build gate; never touches application state."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('syntax_gate', ROOT / 'scripts/check_inline_js.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SyntaxGateTests(unittest.TestCase):
    def check_html(self, content):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'page.html'
            path.write_text(content)
            return gate.check_file(str(path))

    def test_missing_required_page_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(gate.check_file(str(Path(directory) / 'missing.html')))

    def test_no_inline_script_fails(self):
        self.assertFalse(self.check_html('<html><body>broken package</body></html>'))

    def test_valid_script_passes(self):
        self.assertTrue(self.check_html('<script>var value = 1;</script>'))

    def test_invalid_script_fails(self):
        self.assertFalse(self.check_html('<script>var = ;</script>'))

    def test_duplicate_script_blocks_fail(self):
        self.assertFalse(self.check_html('<script>var a=1;</script>' * 3))


if __name__ == '__main__':
    unittest.main()
