"""Retain original statements independently of a chain strength judgment.

These records establish what a source says, not whether the local industry is
strong, weak, producing at scale, or linked to another node. Later research is
allowed to add a statement without rewriting the earlier node's status.
"""
from __future__ import annotations

import copy

from .chain_assessment import _literal_span
from .topic_chain import chain_source_catalog, _topic_supports


def attach_source_statements(result, findings, context):
    """Attach only hash-validated, exact-product statements to existing nodes.

    Never use model-proposed fact text, aliases, policy-derived ratings or an
    unsupported company relationship. Full quotes and dates stay intact so a
    user can inspect scope, plans and counterevidence in the original wording.
    """
    catalog = chain_source_catalog(findings, context, limit=192)
    used = {row['id']: row for row in result.get('sources', [])}
    nodes = [node for group in result.get('chain', []) for node in group.get('nodes', [])]
    nodes += result.get('unclassified', [])
    for node in nodes:
        name = node.get('name')
        if not isinstance(name, str) or not name.strip():
            continue
        statements = [row for row in catalog.values()
                      if _literal_span(name, row['quote'])
                      and _topic_supports(name, row['quote'], context.get('topic'))]
        # Rebuild from the current original catalog; an earlier supplied facts
        # array is not an authority and cannot bypass the source checks.
        node['facts'] = [dict(kind='source_statement', evidence_id=row['id'],
                              statement=row['quote'], published_at=row.get('published_at', ''),
                              scope='source_statement_only') for row in statements]
        # Existing node sources were validated during normalization and remain
        # subject to the route's final archive validation. Do not discard them
        # merely because a bounded supplemental catalog did not select them.
        bound = {row['id']: row for row in node.get('sources', []) if row.get('id')}
        for row in statements:
            bound[row['id']] = copy.deepcopy(row)
            used[row['id']] = copy.deepcopy(row)
        node['sources'] = list(bound.values())
    result['sources'] = list(used.values())
    return result
