"""Immutable full-v1 delivery bundles. The storage root must be service-owned.

Only the selected directory is inspected (never a recursive storage scan).
Manifest lists payloads, not itself: its canonical bytes are checked separately.
Publication uses an exclusive atomic directory rename on macOS/Linux.
"""
from contextlib import contextmanager
import ctypes
from datetime import datetime, timezone
import errno
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree

from .word_export import CHAPTER_ORDER, md_to_docx, build_compact_docx

REQUIRED_FILES = tuple(CHAPTER_ORDER) + ('09_compact_report.md',)
DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
MEDIA_TYPES = {**{n: 'text/markdown; charset=utf-8' for n in REQUIRED_FILES},
               'full.docx': DOCX_TYPE, 'compact.docx': DOCX_TYPE,
               'evidence.json': 'application/json'}
MARKER = 'SYNTHETIC TEST — 合成测试，非真实研究\n\n'


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + '\n').encode('utf-8')


def _id(report_id):
    if not isinstance(report_id, str) or not re.fullmatch(r'[0-9a-f]{64}', report_id):
        raise ValueError('report_id must be a lowercase SHA256 hex digest')


def _root(root, create=False):
    root = Path(os.path.abspath(root))
    # Reject symlinks at every ancestor, including an alias of the storage root.
    for p in reversed((root, *root.parents)):
        if p.is_symlink():
            raise ValueError('Symlink storage path')
        if p.exists() and not p.is_dir():
            raise ValueError('Storage path is not a directory')
    if create:
        root.mkdir(parents=True, exist_ok=True)
    return root


@contextmanager
def _bundle_fd(root, report_id):
    _id(report_id)
    root = _root(root)
    rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(report_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=rfd)
        try:
            yield fd
        finally:
            os.close(fd)
    finally:
        os.close(rfd)


def _read(fd, name):
    f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        if not stat.S_ISREG(os.fstat(f).st_mode):
            raise ValueError('Not a regular artifact')
        with os.fdopen(f, 'rb', closefd=False) as stream:
            return stream.read()
    finally:
        os.close(f)


def _entry(name, data):
    return {'name': name, 'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data), 'media_type': MEDIA_TYPES[name]}


def _valid_docx(data):
    with ZipFile(BytesIO(data)) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or z.testzip() is not None:
            raise ValueError('Corrupt DOCX')
        for name in ('[Content_Types].xml', '_rels/.rels', 'word/document.xml'):
            ElementTree.fromstring(z.read(name))


def _verify(fd, report_id, manifest):
    if not isinstance(manifest, dict) or set(manifest) != {
            'version', 'report_id', 'synthetic', 'files', 'created_at'}:
        raise ValueError('Invalid manifest fields')
    if (manifest['version'] != 'full-v1' or manifest['report_id'] != report_id
            or type(manifest['synthetic']) is not bool):
        raise ValueError('Invalid manifest identity')
    date = datetime.fromisoformat(manifest['created_at'])
    if date.tzinfo is None:
        raise ValueError('Manifest time requires timezone')
    entries = manifest['files']
    if not isinstance(entries, list) or len(entries) != len(MEDIA_TYPES):
        raise ValueError('Incomplete manifest')
    names = [e['name'] for e in entries]
    if len(set(names)) != len(names) or set(names) != set(MEDIA_TYPES):
        raise ValueError('Duplicate or unsafe artifact name')
    if set(os.listdir(fd)) != set(MEDIA_TYPES) | {'manifest.json'}:
        raise ValueError('Unexpected directory contents')
    if _read(fd, 'manifest.json') != _json(manifest):
        raise ValueError('Manifest mismatch')
    contents = {}
    for entry in entries:
        name = entry['name']
        data = _read(fd, name)
        if not data or type(entry['bytes']) is not int or entry != _entry(name, data):
            raise ValueError('Artifact checksum mismatch')
        if name.endswith('.docx'):
            _valid_docx(data)
        elif name.endswith('.md'):
            if not data.decode('utf-8').strip():
                raise ValueError('Empty markdown')
            if manifest['synthetic'] and b'SYNTHETIC TEST' not in data:
                raise ValueError('Missing synthetic marker')
        contents[name] = data
    evidence = json.loads(contents['evidence.json'])
    if set(evidence['stages']) != set(REQUIRED_FILES):
        raise ValueError('Incomplete evidence')
    return contents


def verify_bundle(root: Path, report_id: str, manifest: dict) -> bool:
    """Fail closed on invalid, missing, unlisted, symlinked or altered artifacts."""
    try:
        with _bundle_fd(root, report_id) as fd:
            _verify(fd, report_id, manifest)
        return True
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError,
            ElementTree.ParseError):
        return False
    except Exception as exc:
        # zipfile errors (including unsupported compression) are invalid artifacts.
        from zipfile import BadZipFile, LargeZipFile
        if isinstance(exc, (BadZipFile, LargeZipFile, RuntimeError, NotImplementedError)):
            return False
        raise


def read_artifact(root: Path, report_id: str, name: str, manifest: dict) -> bytes:
    """Read a listed payload only after verifying the complete bundle."""
    if not isinstance(name, str) or name not in MEDIA_TYPES:
        raise ValueError('Unlisted artifact')
    try:
        with _bundle_fd(root, report_id) as fd:
            return _verify(fd, report_id, manifest)[name]
    except Exception as exc:
        raise ValueError('Invalid bundle or artifact') from exc


def _normalize_docx(path):
    # ZIP timestamps otherwise make identical requests differ across retries.
    with ZipFile(path) as source:
        parts = {n: source.read(n) for n in source.namelist()}
    with ZipFile(path, 'w', compression=ZIP_DEFLATED) as dest:
        for name in sorted(parts):
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            dest.writestr(info, parts[name])


def _publish(stage, target):
    """No-replace rename: even a preexisting empty destination is never removed."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        fn = libc.renamex_np
        fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        result = fn(os.fsencode(stage), os.fsencode(target), 4)  # RENAME_EXCL
    elif sys.platform.startswith('linux'):
        fn = libc.renameat2
        fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                       ctypes.c_char_p, ctypes.c_uint]
        result = fn(-100, os.fsencode(stage), -100, os.fsencode(target), 1)
    else:
        raise RuntimeError('Exclusive directory publication requires macOS/Linux')
    if result:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(target))


def build_bundle(root: Path, report_id: str, city: str,
                 outputs: dict[str, dict], synthetic: bool) -> dict:
    """Stage privately, validate, and atomically publish an immutable report.

    Existing reports are reused only when every newly generated payload matches.
    Structure validation is here; research quality gates belong to contracts.
    """
    _id(report_id)
    if not isinstance(city, str) or not city.strip() or type(synthetic) is not bool:
        raise ValueError('Invalid city or synthetic flag')
    if not isinstance(outputs, dict) or set(outputs) != set(REQUIRED_FILES):
        raise ValueError('Exactly the 16 required markdown filenames are required')
    texts, metadata = {}, {}
    for name in REQUIRED_FILES:
        value = outputs[name]
        if (not isinstance(value, dict) or not isinstance(value.get('text'), str)
                or not value['text'].strip() or not isinstance(value.get('metadata'), dict)):
            raise ValueError('Each output requires nonempty text and metadata object')
        texts[name] = ((MARKER if synthetic else '') + value['text']).encode('utf-8')
        metadata[name] = value['metadata']
    evidence = _json({'version': 'full-v1', 'city': city, 'synthetic': synthetic,
                      'stages': metadata})
    root = _root(root, create=True)
    target = root / report_id
    stage = Path(tempfile.mkdtemp(prefix=f'.{report_id}-', dir=root))
    try:
        for name, data in texts.items():
            (stage / name).write_bytes(data)
        (stage / 'evidence.json').write_bytes(evidence)
        md_to_docx(stage, stage / 'full.docx', city, synthetic=synthetic)
        build_compact_docx(city, stage, stage / 'compact.docx', synthetic=synthetic)
        for name in ('full.docx', 'compact.docx'):
            _normalize_docx(stage / name)
        manifest = {'version': 'full-v1', 'report_id': report_id, 'synthetic': synthetic,
                    'files': [_entry(n, (stage / n).read_bytes()) for n in MEDIA_TYPES],
                    'created_at': datetime.now(timezone.utc).isoformat()}
        (stage / 'manifest.json').write_bytes(_json(manifest))
        fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            _verify(fd, report_id, manifest)
            for name in (*MEDIA_TYPES, 'manifest.json'):
                with (stage / name).open('rb') as stream:
                    os.fsync(stream.fileno())
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            _publish(stage, target)
        except OSError as exc:
            if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                raise
            try:
                with _bundle_fd(root, report_id) as fd:
                    old = json.loads(_read(fd, 'manifest.json'))
                    _verify(fd, report_id, old)
                if old['files'] != manifest['files'] or old['synthetic'] != synthetic:
                    raise ValueError('Report already exists with different contents')
                return old
            except Exception as conflict:
                raise ValueError('Existing report conflicts or is invalid') from conflict
        rfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(rfd)
        finally:
            os.close(rfd)
        return manifest
    finally:
        if stage.exists():
            shutil.rmtree(stage)
