"""Bounded supplementary research selected from server-grounded chain nodes."""
from __future__ import annotations

import copy
import re

MAX_MERGED_EVIDENCE = 192


def select_node_targets(chain, assessment, limit=6, include_supported=False):
    ratings = assessment.get('node_assessments') or {}
    groups = []
    for segment in list(chain.get('chain', [])) + [{'nodes': chain.get('unclassified', [])}]:
        candidates = []
        for node in segment.get('nodes', []):
            name = node.get('name')
            if not isinstance(name, str) or not name.strip() or len(name) > 100:
                continue
            judgment = (ratings.get(node.get('id')) or {}).get('judgment') or {}
            if judgment.get('level') == 'strong' and not include_supported:
                continue
            # Search specific products before generic category labels.
            generic = bool(re.fullmatch(r'(?:关键|重要|高端)?(?:原材料|材料|耗材|试剂|设备|装备)', name))
            candidates.append((generic, judgment.get('level') != 'unknown', node))
        groups.append([row[2] for row in sorted(candidates, key=lambda row: row[:2])])
    selected, seen = [], set()
    while any(groups) and len(selected) < min(30, max(0, limit)):
        for group in groups:
            if not group or len(selected) >= min(30, max(0, limit)):
                continue
            node = group.pop(0)
            if node['name'] not in seen:
                seen.add(node['name'])
                selected.append({'id': node.get('id'), 'name': node['name']})
    return selected


def merge_node_research(base, extra, targets):
    """Keep original graph evidence even if the supplement fails or changes."""
    merged = copy.deepcopy(base)
    previous = merged.get('node_research') or {}
    target_map = {x['id']: x for x in previous.get('targets', []) + targets}
    batches = copy.deepcopy(previous.get('batches') or [])
    # Preserve failures from the previous, summary-only shape as well. This is
    # not a new search and must not be represented as one with invented counts.
    if not batches and previous.get('status'):
        batches.append({'index': 0, 'legacy_summary': True,
                        'targets': copy.deepcopy(previous.get('targets') or []),
                        'status': previous['status'],
                        'errors': copy.deepcopy(previous.get('errors') or []),
                        'discarded_evidence_count': 0})
    same_scope = extra.get('city') == base.get('city') and extra.get('topic') == base.get('topic')
    batch = {'index': sum(not item.get('legacy_summary') for item in batches) + 1,
             'targets': copy.deepcopy(targets),
             'status': extra.get('status', 'unavailable') if same_scope else 'scope_mismatch',
             'errors': copy.deepcopy(extra.get('errors') or []),
             'queries': copy.deepcopy(extra.get('queries') or []),
             'received_evidence_count': sum(isinstance(row, dict) and bool(row.get('id'))
                                            for row in extra.get('evidence', [])),
             'new_evidence_count': 0, 'retained_new_evidence_count': 0,
             'discarded_evidence_count': 0}
    if same_scope:
        rows = {row['id']: row for row in merged.get('evidence', []) if isinstance(row, dict) and row.get('id')}
        old_ids = set(rows)
        for row in extra.get('evidence', []):
            if isinstance(row, dict) and row.get('id'):
                rows.setdefault(row['id'], copy.deepcopy(row))
        retained = list(rows.values())[:MAX_MERGED_EVIDENCE]
        batch['new_evidence_count'] = len(set(rows) - old_ids)
        batch['retained_new_evidence_count'] = sum(row['id'] not in old_ids for row in retained)
        batch['discarded_evidence_count'] = max(0, len(rows) - len(retained))
        merged['evidence'] = retained
        archives = merged.setdefault('sources', {})
        archives.update(copy.deepcopy(extra.get('sources') or {}))
        merged['queries'] = list(dict.fromkeys((merged.get('queries') or []) + (extra.get('queries') or [])))
    batches.append(batch)
    errors = [copy.deepcopy(error) for item in batches for error in item.get('errors', [])]
    truncated = [item for item in batches if item.get('discarded_evidence_count', 0)]
    statuses = [item['status'] for item in batches]
    if all(status == 'ready' for status in statuses) and not errors and not truncated:
        status = 'ready'
    elif all(status == 'scope_mismatch' for status in statuses):
        status = 'scope_mismatch'
    elif all(status == 'unavailable' for status in statuses):
        status = 'unavailable'
    else:
        status = 'partial'
    merged['node_research'] = {
        'targets': copy.deepcopy(list(target_map.values())), 'status': status,
        'errors': errors, 'batches': batches,
        'truncation': {'evidence_limit': MAX_MERGED_EVIDENCE,
                       'events': len(truncated),
                       # Cumulative discarded rows per merge, not distinct
                       # source identities (a later retry can return one again).
                       'discarded_evidence_count': sum(item['discarded_evidence_count'] for item in truncated)}}
    return merged
