"""Lossless, compact decision-stage entity serialization for model input.

This changes only the representation of persisted records. Equal field sets
share one ``fields`` header and store values in ordered ``rows``. Different
field sets or non-dictionary records keep the exact original ``records`` list,
so absent fields remain distinct from fields whose value is ``null``. Source
records and their nested values are never modified, shortened or selected here.
"""
from __future__ import annotations

import json


_ENTITY_LABELS = (
    ('directions', '已确定产业方向'),
    ('candidates', '候选池'),
    ('selected', '精选企业'),
    ('checks', '核验条目'),
    ('scores', '评分记录'),
)


def render_structured(metadata):
    """Render every supported entity-list record without repeating its keys.

    ``fields`` follows the first record's field order; each row retains the
    original record-list order and every field value, including unknown fields
    and nested data. ``records`` is the lossless fallback for heterogeneous
    shapes. Compact JSON punctuation removes only insignificant whitespace.
    """
    if not isinstance(metadata, dict):
        return ''
    lines = []
    for key, label in _ENTITY_LABELS:
        records = metadata.get(key)
        if not isinstance(records, list):
            continue
        if records and all(isinstance(record, dict) for record in records):
            fields = list(records[0])
            if all(set(record) == set(fields) for record in records):
                payload = {'fields': fields,
                           'rows': [[record[field] for field in fields] for record in records]}
            else:
                payload = {'records': records}
        else:
            payload = {'records': records}
        lines.append(f'- {label}: ' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return '\n'.join(lines)


__all__ = ['render_structured']
