"""Bounded supplementary research selected from server-grounded chain nodes."""
from __future__ import annotations

import copy
import re


def select_node_targets(chain, assessment, limit=6):
    ratings = assessment.get('node_assessments') or {}
    groups = []
    for segment in chain.get('chain', []):
        candidates = []
        for node in segment.get('nodes', []):
            name = node.get('name')
            if not isinstance(name, str) or not name.strip() or len(name) > 100:
                continue
            judgment = (ratings.get(node.get('id')) or {}).get('judgment') or {}
            if judgment.get('level') == 'strong':
                continue
            # Search specific products before generic category labels.
            generic = bool(re.fullmatch(r'(?:关键|重要|高端)?(?:原材料|材料|耗材|试剂|设备|装备)', name))
            candidates.append((generic, judgment.get('level') != 'unknown', node))
        groups.append([row[2] for row in sorted(candidates, key=lambda row: row[:2])])
    selected, seen = [], set()
    while any(groups) and len(selected) < min(6, max(0, limit)):
        for group in groups:
            if not group or len(selected) >= min(6, max(0, limit)):
                continue
            node = group.pop(0)
            if node['name'] not in seen:
                seen.add(node['name'])
                selected.append({'id': node.get('id'), 'name': node['name']})
    return selected


def merge_node_research(base, extra, targets):
    """Keep original graph evidence even if the supplement fails or changes."""
    merged = copy.deepcopy(base)
    merged['node_research'] = {'targets': copy.deepcopy(targets),
                               'status': extra.get('status', 'unavailable'),
                               'errors': copy.deepcopy(extra.get('errors') or [])}
    if extra.get('city') != base.get('city') or extra.get('topic') != base.get('topic'):
        merged['node_research']['status'] = 'scope_mismatch'
        return merged
    rows = {row['id']: row for row in merged.get('evidence', []) if isinstance(row, dict) and row.get('id')}
    for row in extra.get('evidence', []):
        if isinstance(row, dict) and row.get('id'):
            rows.setdefault(row['id'], copy.deepcopy(row))
    merged['evidence'] = list(rows.values())[:96]
    archives = merged.setdefault('sources', {})
    archives.update(copy.deepcopy(extra.get('sources') or {}))
    merged['queries'] = list(dict.fromkeys((merged.get('queries') or []) + (extra.get('queries') or [])))
    return merged
