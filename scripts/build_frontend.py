"""Rebuild both frontend pages and their checksums from ordered source bytes."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PAGES = ('index.html', 'ops.html')
MANIFEST = 'frontend/manifest.json'


def compile_frontend(manifest_bytes, read_source):
    """Read and validate every part before producing any output."""
    manifest = json.loads(manifest_bytes.decode('utf-8'))
    if not isinstance(manifest, dict) or set(manifest) != set(PAGES):
        raise ValueError('manifest must contain exactly index.html and ops.html')
    updated = copy.deepcopy(manifest)
    plan = {}
    for name in PAGES:
        entry = manifest[name]
        if not isinstance(entry, dict) or not isinstance(entry.get('parts'), list) or not entry['parts']:
            raise ValueError(name + ': parts must be a nonempty list')
        seen, chunks = set(), []
        for part in entry['parts']:
            if (not isinstance(part, str) or '\\' in part or ':' in part
                    or PurePosixPath(part).as_posix() != part
                    or not part.startswith('frontend/') or '..' in PurePosixPath(part).parts
                    or part in seen):
                raise ValueError(name + ': invalid or duplicate source path: ' + str(part))
            seen.add(part)
            chunks.append(read_source(part))
        plan[name] = b''.join(chunks)
        updated[name]['sha256'] = hashlib.sha256(plan[name]).hexdigest()
    plan[MANIFEST] = (manifest_bytes if updated == manifest else
                      (json.dumps(updated, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    return plan


def disk_plan(root):
    root = Path(root).resolve()
    frontend = root / 'frontend'
    if frontend.is_symlink() or (frontend / 'manifest.json').is_symlink():
        raise ValueError('frontend and its manifest must be local files')
    def read_source(part):
        path = (root / part).resolve()
        if frontend not in path.parents or not path.is_file():
            raise ValueError('missing or outside frontend source: ' + part)
        return path.read_bytes()
    return compile_frontend((root / MANIFEST).read_bytes(), read_source)


def write_plan(root, plan):
    """Prepare all replacement files first; unchanged files keep their timestamps."""
    root = Path(root).resolve()
    prepared = []
    try:
        for name, body in plan.items():
            path = root / name
            if path.is_symlink():
                raise ValueError('refusing generated output symlink: ' + name)
            if path.exists() and path.read_bytes() == body:
                continue
            with tempfile.NamedTemporaryFile(prefix='.' + path.name + '.', suffix='.tmp',
                                             dir=path.parent, delete=False) as handle:
                prepared.append((Path(handle.name), path))
                handle.write(body)
            if path.exists():
                os.chmod(prepared[-1][0], path.stat().st_mode & 0o777)
            else:
                os.chmod(prepared[-1][0], 0o644)
        for temporary, target in prepared:
            os.replace(temporary, target)
        return [str(path.relative_to(root)) for _, path in prepared]
    finally:
        for temporary, _ in prepared:
            temporary.unlink(missing_ok=True)


def build(check=False, *, root=None):
    root = Path(root or ROOT).resolve()
    plan = disk_plan(root)
    if check:
        stale = [name for name, body in plan.items()
                 if (root / name).is_symlink() or not (root / name).is_file()
                 or (root / name).read_bytes() != body]
        if stale:
            raise ValueError('Frontend artifacts out of sync: ' + ', '.join(stale) +
                             '. Run: python scripts/build_frontend.py')
    else:
        changed = write_plan(root, plan)
        print('Frontend synchronized: ' + (', '.join(changed) if changed else 'already current'))
    for name in PAGES:
        print(name, hashlib.sha256(plan[name]).hexdigest())
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true',
                        help='verify both generated pages and manifest checksums without writing')
    args = parser.parse_args()
    try:
        build(args.check)
    except (ValueError, OSError, KeyError) as error:
        print('Frontend build failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
