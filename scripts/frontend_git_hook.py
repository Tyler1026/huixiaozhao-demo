"""Synchronize generated frontend artifacts from Git's index, never unstaged sources."""
from pathlib import Path
import subprocess
import sys

from build_frontend import MANIFEST, PAGES, compile_frontend, write_plan


def git(root, *arguments, data=None):
    result = subprocess.run(['git', *arguments], cwd=root, input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError('git ' + arguments[0] + ' failed: ' +
                         result.stderr.decode('utf-8', errors='replace').strip())
    return result.stdout


def read_index(root, path):
    meta = git(root, 'ls-files', '--stage', '-z', '--', path)
    if not meta.startswith(b'100644 ') and not meta.startswith(b'100755 '):
        raise ValueError('source is missing from the index or is a symlink: ' + path)
    return git(root, 'show', ':' + path)


def synchronize(root):
    root = Path(root).resolve()
    names = git(root, 'diff', '--cached', '--name-only', '-z').decode('utf-8').split('\0')
    relevant = any(name.startswith('frontend/') or name in PAGES or
                   name in ('scripts/build_frontend.py', 'scripts/frontend_git_hook.py')
                   for name in names if name)
    if not relevant:
        return []
    tools_changed = git(root, 'diff', '--name-only', '--',
                        'scripts/build_frontend.py', 'scripts/frontend_git_hook.py')
    if tools_changed:
        raise ValueError('stage frontend build-tool changes before committing frontend sources')
    plan = compile_frontend(read_index(root, MANIFEST), lambda name: read_index(root, name))
    # Never overwrite unrelated edits to generated files or a partially staged manifest.
    for name, expected in plan.items():
        path = root / name
        indexed = git(root, 'show', ':' + name)
        if name in PAGES and name in names and indexed != expected:
            previous = subprocess.run(['git', 'show', 'HEAD:' + name], cwd=root,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if previous.returncode or previous.stdout != indexed:
                raise ValueError('staged generated page edits in ' + name +
                                 '; preserve/move them to frontend sources before committing')
        working = path.read_bytes() if path.is_file() else None
        if path.is_symlink() or (working != indexed and working != expected):
            raise ValueError('unstaged changes in ' + name +
                             '; preserve/move them to frontend sources before committing')
    entries = []
    for name, body in plan.items():
        oid = git(root, 'hash-object', '-w', '--stdin', data=body).strip()
        entries.append(b'100644 ' + oid + b'\t' + name.encode('utf-8') + b'\0')
    # One update-index process replaces the index atomically; source entries are untouched.
    git(root, 'update-index', '-z', '--index-info', data=b''.join(entries))
    changed = write_plan(root, plan)
    if changed:
        print('Frontend synchronized from staged sources: ' + ', '.join(changed))
    return changed


def main():
    try:
        root = git(Path.cwd(), 'rev-parse', '--show-toplevel').decode('utf-8').strip()
        synchronize(root)
    except (OSError, ValueError) as error:
        print('Frontend pre-commit stopped: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
