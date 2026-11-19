"""Regression tests for one-step builds and real Git-index synchronization."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('frontend_builder_pipeline', ROOT / 'scripts/build_frontend.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def fixture(root):
    (root / 'frontend').mkdir()
    (root / 'frontend/index.js').write_bytes(b'const value = "$&";\r\n')
    (root / 'frontend/ops.js').write_bytes('const city = "苏州";\n'.encode())
    manifest = {
        'index.html': {'parts': ['frontend/index.js'], 'sha256': 'old'},
        'ops.html': {'parts': ['frontend/ops.js'], 'sha256': 'old'},
    }
    (root / builder.MANIFEST).write_text(json.dumps(manifest) + '\n', encoding='utf-8')
    (root / 'index.html').write_bytes(b'old index')
    (root / 'ops.html').write_bytes(b'old ops')


def quiet_build(root, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()):
        return builder.build(root=root, **kwargs)


class FrontendBuildPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture(self.root)

    def test_one_build_updates_both_pages_and_checksums_without_reinterpreting_source_bytes(self):
        quiet_build(self.root)
        quiet_build(self.root, check=True)
        self.assertEqual((self.root / 'index.html').read_bytes(), b'const value = "$&";\r\n')
        self.assertIn('苏州'.encode(), (self.root / 'ops.html').read_bytes())

    def test_check_reports_stale_page_and_hash_without_modifying_any_artifact(self):
        quiet_build(self.root)
        (self.root / 'ops.html').write_bytes(b'outdated')
        path = self.root / builder.MANIFEST
        manifest = json.loads(path.read_text())
        manifest['index.html']['sha256'] = 'stale-checksum'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        before = {p: (self.root / p).read_bytes() for p in (*builder.PAGES, builder.MANIFEST)}
        with self.assertRaisesRegex(ValueError, r'ops.html.*frontend/manifest.json.*python scripts/build_frontend.py'):
            quiet_build(self.root, check=True)
        self.assertEqual(before, {p: (self.root / p).read_bytes() for p in before})

    def test_second_build_is_idempotent_and_does_not_touch_timestamps(self):
        quiet_build(self.root)
        times = {p: (self.root / p).stat().st_mtime_ns for p in (*builder.PAGES, builder.MANIFEST)}
        quiet_build(self.root)
        self.assertEqual(times, {p: (self.root / p).stat().st_mtime_ns for p in times})

    def test_late_missing_source_does_not_partially_rewrite_an_earlier_page(self):
        before = {p: (self.root / p).read_bytes() for p in (*builder.PAGES, builder.MANIFEST)}
        (self.root / 'frontend/ops.js').unlink()
        with self.assertRaisesRegex(ValueError, 'missing or outside'):
            quiet_build(self.root)
        self.assertEqual(before, {p: (self.root / p).read_bytes() for p in before})

    def test_invalid_paths_empty_parts_and_duplicate_parts_are_rejected(self):
        for parts in ([], ['frontend/../secret'], ['/etc/passwd'], ['frontend//index.js'],
                      ['frontend/index.js', 'frontend/index.js'], ['frontend\\index.js']):
            with self.subTest(parts=parts):
                manifest = {'index.html': {'parts': parts},
                            'ops.html': {'parts': ['frontend/ops.js']}}
                (self.root / builder.MANIFEST).write_text(json.dumps(manifest), encoding='utf-8')
                with self.assertRaises(ValueError):
                    quiet_build(self.root)
                self.assertEqual((self.root / 'index.html').read_bytes(), b'old index')

    def test_prepare_failure_leaves_all_outputs_untouched_and_cleans_temporaries(self):
        from unittest.mock import patch
        real_create = builder.tempfile.NamedTemporaryFile
        calls = []
        def create(*args, **kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise OSError('simulated unavailable disk')
            return real_create(*args, **kwargs)
        before = (self.root / 'index.html').read_bytes()
        with patch.object(builder.tempfile, 'NamedTemporaryFile', side_effect=create):
            with self.assertRaises(OSError):
                quiet_build(self.root)
        self.assertEqual((self.root / 'index.html').read_bytes(), before)
        self.assertFalse(list(self.root.rglob('*.tmp')))


@unittest.skipUnless(shutil.which('git'), 'isolated Git integration needs git')
class FrontendGitPipelineTests(unittest.TestCase):
    def git(self, *args, check=True):
        result = subprocess.run(['git', *args], cwd=self.root, env=self.env,
                                capture_output=True)
        if check and result.returncode:
            self.fail(result.stderr.decode('utf-8', errors='replace'))
        return result

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = dict(os.environ, PYTHONUTF8='1')
        fixture(self.root)
        (self.root / 'scripts').mkdir()
        (self.root / '.githooks').mkdir()
        for name in ('build_frontend.py', 'frontend_git_hook.py', 'install_frontend_hooks.py'):
            shutil.copyfile(ROOT / 'scripts' / name, self.root / 'scripts' / name)
        shutil.copyfile(ROOT / '.githooks/pre-commit', self.root / '.githooks/pre-commit')
        os.chmod(self.root / '.githooks/pre-commit', 0o755)
        shutil.copyfile(ROOT / '.gitattributes', self.root / '.gitattributes')
        (self.root / '.gitignore').write_text('__pycache__/\n', encoding='utf-8')
        (self.root / 'README.md').write_text('fixture\n', encoding='utf-8')
        quiet_build(self.root)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Isolated build test')
        self.git('config', 'user.email', 'build-test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'core.autocrlf', 'false')
        self.git('config', 'core.hooksPath', '')
        self.git('add', '.')
        self.git('update-index', '--chmod=+x', '.githooks/pre-commit')
        self.git('-c', 'core.hooksPath=.disabled-hooks', 'commit', '-qm', 'isolated baseline')

    def run_hook(self, check=True):
        result = subprocess.run([sys.executable, 'scripts/frontend_git_hook.py'],
                                cwd=self.root, env=self.env, capture_output=True)
        if check and result.returncode:
            self.fail(result.stderr.decode('utf-8', errors='replace'))
        return result

    def test_real_commit_automatically_stages_generated_pages_and_manifest(self):
        result = subprocess.run([sys.executable, 'scripts/install_frontend_hooks.py'],
                                cwd=self.root, env=self.env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        changed = b'const changed = "$&";\r\n'
        (self.root / 'frontend/index.js').write_bytes(changed)
        self.git('add', 'frontend/index.js')
        self.git('commit', '-qm', 'source only; hook builds generated artifacts')
        self.assertEqual(self.git('show', 'HEAD:index.html').stdout, changed)
        self.assertEqual(self.git('diff', '--cached', '--name-only').stdout, b'')
        quiet_build(self.root, check=True)

    def test_partial_source_staging_uses_only_index_and_preserves_working_source(self):
        staged = b'const revision = "staged";\n'
        working = b'const revision = "not staged";\n'
        path = self.root / 'frontend/index.js'
        path.write_bytes(staged)
        self.git('add', 'frontend/index.js')
        path.write_bytes(working)
        self.run_hook()
        self.assertEqual(self.git('show', ':index.html').stdout, staged)
        self.assertEqual(self.git('show', ':frontend/index.js').stdout, staged)
        self.assertEqual(path.read_bytes(), working)

    def test_manual_unstaged_page_edit_is_preserved_and_index_is_unchanged(self):
        (self.root / 'frontend/index.js').write_bytes(b'const revised = true;\n')
        self.git('add', 'frontend/index.js')
        (self.root / 'ops.html').write_bytes(b'important unstaged HTML edit')
        before = self.git('write-tree').stdout
        result = self.run_hook(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'unstaged changes in ops.html', result.stderr)
        self.assertEqual(self.git('write-tree').stdout, before)
        self.assertEqual((self.root / 'ops.html').read_bytes(), b'important unstaged HTML edit')

    def test_manual_staged_page_edit_is_preserved_even_when_sources_are_staged(self):
        (self.root / 'frontend/index.js').write_bytes(b'const revised = true;\n')
        (self.root / 'ops.html').write_bytes(b'important staged HTML edit')
        self.git('add', 'frontend/index.js', 'ops.html')
        before = self.git('write-tree').stdout
        result = self.run_hook(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'staged generated page edits in ops.html', result.stderr)
        self.assertEqual(self.git('write-tree').stdout, before)
        self.assertEqual((self.root / 'ops.html').read_bytes(), b'important staged HTML edit')

    def test_unstaged_manifest_edit_is_not_accidentally_included(self):
        path = self.root / builder.MANIFEST
        manifest = json.loads(path.read_text())
        manifest['index.html']['note'] = 'staged metadata'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        self.git('add', builder.MANIFEST)
        manifest['index.html']['note'] = 'private unstaged metadata'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        before = self.git('write-tree').stdout
        result = self.run_hook(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git('write-tree').stdout, before)
        self.assertIn('private unstaged metadata', path.read_text())

    def test_already_built_unstaged_artifacts_are_safely_staged(self):
        (self.root / 'frontend/ops.js').write_bytes(b'const fresh = true;\r\n')
        quiet_build(self.root)
        self.git('add', 'frontend/ops.js')
        self.run_hook()
        quiet_build(self.root, check=True)
        for name in (*builder.PAGES, builder.MANIFEST):
            self.assertEqual(self.git('show', ':' + name).stdout, (self.root / name).read_bytes())

    def test_unrelated_commit_does_not_include_frontend_work_in_progress(self):
        (self.root / 'index.html').write_bytes(b'not part of this commit')
        (self.root / 'README.md').write_text('unrelated edit\n', encoding='utf-8')
        self.git('add', 'README.md')
        before = self.git('write-tree').stdout
        self.run_hook()
        self.assertEqual(self.git('write-tree').stdout, before)

    def test_windows_autocrlf_does_not_change_frontend_input_or_output_bytes(self):
        self.git('config', 'core.autocrlf', 'true')
        body = b'const endings = "$&";\r\nconst second = 2;\n'
        (self.root / 'frontend/index.js').write_bytes(body)
        self.git('add', 'frontend/index.js')
        self.assertEqual(self.git('show', ':frontend/index.js').stdout, body)
        self.run_hook()
        self.assertEqual(self.git('show', ':index.html').stdout, body)

    def test_existing_custom_hooks_configuration_is_preserved(self):
        self.git('config', 'core.hooksPath', '.my-existing-hooks')
        result = subprocess.run([sys.executable, 'scripts/install_frontend_hooks.py'],
                                cwd=self.root, env=self.env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git('config', '--get', 'core.hooksPath').stdout.strip(),
                         b'.my-existing-hooks')


if __name__ == '__main__':
    unittest.main()
