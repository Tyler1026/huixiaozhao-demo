"""Complete input identity for server-owned interactive chain diagrams.

This is a cache/version boundary, never a client authorization credential.
Only the generation route writes graph content to authoritative storage.
"""
from __future__ import annotations

import hashlib
import json


def chain_report_text(state, key, topic):
    record = (state.get('REPORTSTATE') or {}).get(key) or {}
    return ((record.get('aiReportByTopic') or {}).get(topic)
            or (record.get('text') if record.get('topic') == topic else '') or '')


def chain_input_identity(state, key, topic):
    projects = state.get('PROJECTS') or {}
    project = projects.get(key) or {}
    report = (state.get('REPORTSTATE') or {}).get(key) or {}
    root = project.get('workspaceId') or key
    keys = [root, key] if root != key else [key]

    def rows(name, empty):
        table = state.get(name) or {}
        return [table.get(k) or empty for k in keys]

    uploads = []
    for values in rows('UPLOADS', []):
        uploads.append([{field: value for field, value in row.items() if field != 'dataUrl'}
                        if isinstance(row, dict) else row for row in values])
    tombs = {k: value for k, value in (state.get('UPLOAD_TOMBS') or {}).items()
             if any(k.startswith(item + '::') for item in keys)}
    return {
        'schema': 'saved-evidence-v2', 'workspace': root,
        'city': project.get('city') or '', 'topic': topic,
        'requestId': project.get('reportRequestId') or report.get('reportRequestId') or '',
        'keys': keys,
        'kb': [(projects.get(k) or {}).get('kb') or [] for k in keys],
        'onboarding': [(projects.get(k) or {}).get('onboarding') or {} for k in keys],
        'baseReportVersion': [(projects.get(k) or {}).get('baseReportVersion') for k in keys],
        'report': chain_report_text(state, key, topic),
        # These are fields of a scoped identity, not embedded snapshot tables.
        # Distinct names preserve the normal nested-state redaction boundary.
        'state': {'kbEdits': rows('KB_EDITS', {}),
                  'kbConfirms': rows('KB_CONFIRMS', {}),
                  'kbConfirmTombs': rows('KB_CONFIRM_TOMBS', {}),
                  'kbItemTombs': rows('KB_ITEM_TOMBS', {}),
                  'uploads': uploads, 'fileChunks': rows('KB_FILE_CHUNKS', []),
                  'uploadTombs': tombs}}


def identity_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def identity_matches(supplied, expected):
    if not isinstance(supplied, str):
        return False
    try:
        value = json.loads(supplied, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        # Keep bool distinct from a JSON number; numeric 1 and 1.0 have the
        # same JS representation and are harmless version equivalents.
        def same(a, b):
            if isinstance(a, bool) or isinstance(b, bool):
                return type(a) is type(b) and a == b
            if isinstance(a, (float, int)) and isinstance(b, (float, int)):
                return a == b
            if type(a) is not type(b):
                return False
            if isinstance(a, dict):
                return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
            if isinstance(a, list):
                return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
            return a == b
        return same(value, expected)
    except (TypeError, ValueError):
        return False


def chain_input_fingerprint(context, identity):
    return hashlib.sha256(identity_json({'effectiveSources': context['sourceFingerprint'],
                                        'input': identity}).encode()).hexdigest()
