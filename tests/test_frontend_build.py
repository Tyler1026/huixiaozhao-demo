import hashlib
import json
import re
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
    def test_client_brand_adapter_runs_outside_external_script_tags(self):
        page=(ROOT/'index.html').read_text()
        scripts=re.findall(r'<script\b([^>]*)>(.*?)</script\s*>',page,re.S|re.I)
        inline='\n'.join(body for attributes,body in scripts if not re.search(r'\bsrc\s*=',attributes,re.I))
        self.assertIn('window.hxzClientIcons = Object.freeze',inline)
        self.assertIn('var HXZ_CARD_ART = Object.freeze',inline)
        self.assertNotIn('const previewState',page)
        self.assertNotIn('Local design fixture',page)
