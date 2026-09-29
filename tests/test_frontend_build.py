import hashlib
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class FrontendBuildTests(unittest.TestCase):
    def test_all_parts_reproduce_published_pages_byte_for_byte(self):
        manifest=json.loads((ROOT/'frontend/manifest.json').read_text())
        for name,entry in manifest.items():
            with self.subTest(page=name):
                body=b''.join((ROOT/part).read_bytes() for part in entry['parts'])
                self.assertEqual(body,(ROOT/name).read_bytes())
                self.assertEqual(hashlib.sha256(body).hexdigest(),entry['sha256'])
    def test_javascript_and_css_are_separate_sources(self):
        for page in ('index','ops'):
            self.assertTrue(list((ROOT/'frontend'/page).glob('*.js')))
            self.assertTrue(list((ROOT/'frontend'/page).glob('*.css')))
