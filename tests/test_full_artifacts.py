import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from report_service.full_artifacts import (
    REQUIRED_FILES, build_bundle, verify_bundle, read_artifact,
)


class FullArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve() / 'bundles'
        self.id = hashlib.sha256(b'report').hexdigest()
        self.outputs = {n: {'text': '# 标题\n正文 ' + n + '\n|企业|评分|\n|---|---|\n|甲|9|',
                            'metadata': {'sources': ['https://example.invalid'], 'stage': n}}
                        for n in REQUIRED_FILES}

    def build(self, **kwargs):
        return build_bundle(self.root, self.id, kwargs.get('city', '测试'),
                            kwargs.get('outputs', self.outputs), kwargs.get('synthetic', True))

    def test_valid_bundle_and_word_format(self):
        m = self.build()
        self.assertTrue(verify_bundle(self.root, self.id, m))
        self.assertEqual(m['version'], 'full-v1')
        self.assertEqual(len(m['files']), 19)
        self.assertEqual(set(p.name for p in (self.root / self.id).iterdir()),
                         set(REQUIRED_FILES) | {'full.docx', 'compact.docx', 'evidence.json', 'manifest.json'})
        for n in REQUIRED_FILES:
            self.assertIn(b'SYNTHETIC TEST', read_artifact(self.root, self.id, n, m))
        evidence = json.loads(read_artifact(self.root, self.id, 'evidence.json', m))
        self.assertEqual(evidence['stages'], {n: v['metadata'] for n, v in self.outputs.items()})
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        for name in ('full.docx', 'compact.docx'):
            with ZipFile(self.root / self.id / name) as z:
                self.assertIsNone(z.testzip())
                xml = z.read('word/document.xml')
            self.assertIn(b'SYNTHETIC TEST', xml)
            tree = ET.fromstring(xml)
            fonts = tree.findall('.//w:rFonts', ns)
            self.assertTrue(any(f.get('{%s}ascii' % ns['w']) == 'FangSong' and
                                f.get('{%s}eastAsia' % ns['w']) == '仿宋' for f in fonts))
            sizes = {e.get('{%s}val' % ns['w']) for e in tree.findall('.//w:sz', ns)}
            self.assertTrue({'24', '21'} <= sizes)
            margin = tree.find('.//w:pgMar', ns)
            self.assertEqual(margin.get('{%s}top' % ns['w']), '1440')
            self.assertEqual(margin.get('{%s}left' % ns['w']), '1797')
            self.assertTrue(any(e.get('{%s}line' % ns['w']) == '360'
                                for e in tree.findall('.//w:spacing', ns)))
            if name == 'full.docx':
                self.assertIn(b'06b_fact_check.md', xml)

    def test_each_missing_or_empty_input(self):
        for n in REQUIRED_FILES:
            for empty in (False, True):
                with self.subTest(name=n, empty=empty):
                    outputs = copy.deepcopy(self.outputs)
                    if empty:
                        outputs[n]['text'] = ' \n'
                    else:
                        del outputs[n]
                    with self.assertRaises(ValueError):
                        self.build(outputs=outputs)
        self.assertFalse((self.root / self.id).exists())

    def test_unsafe_names_and_ids(self):
        for n in ('../escape.md', '/absolute.md', 'a/b.md', 'a\\b.md', 'unknown.md', ''):
            outputs = dict(self.outputs, **{n: {'text': 'x', 'metadata': {}}})
            with self.assertRaises(ValueError):
                self.build(outputs=outputs)
        for report_id in ('../escape', '', 'xyz', '/tmp/test', 'a' * 63):
            with self.assertRaises(ValueError):
                build_bundle(self.root, report_id, 'city', self.outputs, True)

    def test_idempotence_and_conflicts(self):
        m = self.build()
        self.assertEqual(m, self.build())
        for field in ('text', 'metadata'):
            outputs = copy.deepcopy(self.outputs)
            outputs[REQUIRED_FILES[0]][field] = 'changed' if field == 'text' else {'changed': True}
            with self.assertRaises(ValueError):
                self.build(outputs=outputs)
        for kw in ({'city': '另一城市'}, {'synthetic': False}):
            with self.assertRaises(ValueError):
                self.build(**kw)
        self.assertTrue(verify_bundle(self.root, self.id, m))

    def test_each_missing_artifact_and_tamper(self):
        m = self.build()
        for name in [f['name'] for f in m['files']] + ['manifest.json']:
            p = self.root / self.id / name
            content = p.read_bytes()
            p.unlink()
            self.assertFalse(verify_bundle(self.root, self.id, m), name)
            p.write_bytes(content + b'corruption')
            self.assertFalse(verify_bundle(self.root, self.id, m), name)
            p.write_bytes(content)
        p = self.root / self.id / REQUIRED_FILES[0]
        p.write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            read_artifact(self.root, self.id, p.name, m)
        with self.assertRaises(ValueError):
            self.build()

    def test_duplicate_manifest_and_unlisted_names(self):
        m = self.build()
        bad = copy.deepcopy(m)
        bad['files'][-1] = bad['files'][0]
        self.assertFalse(verify_bundle(self.root, self.id, bad))
        for name in ('../manifest.json', '/etc/passwd', 'unknown.md', 'manifest.json'):
            with self.assertRaises(ValueError):
                read_artifact(self.root, self.id, name, m)
        (self.root / self.id / 'extra').write_text('x')
        self.assertFalse(verify_bundle(self.root, self.id, m))

    def test_symlinks(self):
        m = self.build()
        p = self.root / self.id / REQUIRED_FILES[0]
        outside = Path(self.tmp.name).resolve() / 'outside'
        outside.write_bytes(p.read_bytes())
        p.unlink()
        p.symlink_to(outside)
        self.assertFalse(verify_bundle(self.root, self.id, m))
        with self.assertRaises(ValueError):
            read_artifact(self.root, self.id, p.name, m)
        alias = Path(self.tmp.name).resolve() / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.assertFalse(verify_bundle(alias, self.id, m))
        with self.assertRaises(ValueError):
            build_bundle(alias, 'b' * 64, 'city', self.outputs, True)

    def test_invalid_docx_even_with_matching_hash(self):
        m = self.build()
        p = self.root / self.id / 'full.docx'
        p.write_bytes(b'not a zip')
        entry = next(f for f in m['files'] if f['name'] == p.name)
        entry.update(bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        (p.parent / 'manifest.json').write_text(
            json.dumps(m, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
        self.assertFalse(verify_bundle(self.root, self.id, m))

    def test_concurrent_identical_publish(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.build(), range(2)))
        self.assertEqual(results[0], results[1])
        self.assertTrue(verify_bundle(self.root, self.id, results[0]))
        self.assertEqual([p.name for p in self.root.iterdir()], [self.id])

    def test_existing_empty_directory_and_report_symlink_not_overwritten(self):
        target = self.root / self.id
        target.mkdir(parents=True)
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual(list(target.iterdir()), [])
        target.rmdir()
        outside = Path(self.tmp.name).resolve() / 'outside-dir'
        outside.mkdir()
        target.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.build()
        self.assertTrue(target.is_symlink())
        self.assertEqual(list(outside.iterdir()), [])

    def test_each_artifact_symlink_and_empty(self):
        m = self.build()
        outside = Path(self.tmp.name).resolve() / 'outside'
        for name in [f['name'] for f in m['files']] + ['manifest.json']:
            p = self.root / self.id / name
            content = p.read_bytes()
            p.write_bytes(b'')
            self.assertFalse(verify_bundle(self.root, self.id, m), name)
            outside.write_bytes(content)
            p.unlink()
            p.symlink_to(outside)
            self.assertFalse(verify_bundle(self.root, self.id, m), name)
            p.unlink()
            p.write_bytes(content)

    def test_non_synthetic_bundle(self):
        m = self.build(synthetic=False)
        self.assertFalse(m['synthetic'])
        self.assertTrue(verify_bundle(self.root, self.id, m))
        for name in REQUIRED_FILES:
            self.assertEqual(read_artifact(self.root, self.id, name, m),
                             self.outputs[name]['text'].encode())

    def test_failure_cleanup_and_other_report_preserved(self):
        self.root.mkdir()
        other = self.root / ('c' * 64)
        other.mkdir()
        (other / 'keep').write_text('untouched')
        with patch('report_service.full_artifacts.md_to_docx', side_effect=RuntimeError('fail')):
            with self.assertRaises(RuntimeError):
                self.build()
        self.assertEqual(list(self.root.iterdir()), [other])
        self.assertEqual((other / 'keep').read_text(), 'untouched')


if __name__ == '__main__':
    unittest.main()
