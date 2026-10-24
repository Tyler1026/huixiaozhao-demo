"""Deletion intent for the administrator's enterprise resource library."""
import math


def _enterprise_id(value):
    """Match legacy numeric IDs and current string IDs without accepting containers."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    value = str(value)
    if (not value or value != value.strip() or len(value) > 256
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        return None
    return value


def merge_ops_enterprise_tombs(existing, incoming):
    """Validate the new field and retain deletions omitted by older snapshots."""
    if 'OPS_ENT' in incoming:
        rows = incoming['OPS_ENT']
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError('OPS_ENT must be a list of enterprise objects')
    tombs = set()
    for state in (existing, incoming):
        value = state.get('DELETED_OPS_ENT', [])
        if not isinstance(value, list):
            raise ValueError('DELETED_OPS_ENT must be a list of enterprise IDs')
        for key in value:
            if not isinstance(key, str) or _enterprise_id(key) is None:
                raise ValueError('invalid enterprise deletion ID')
            tombs.add(key)
    return sorted(tombs)


def apply_ops_enterprise_tombs(state, tombs):
    """Filter after normal merging so even stale administrator tabs cannot revive IDs."""
    if not tombs:
        return
    deleted = set(tombs)
    rows = state.get('OPS_ENT', [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError('stored OPS_ENT must be a list of enterprise objects')
    state['OPS_ENT'] = [row for row in rows if _enterprise_id(row.get('id')) not in deleted]
    state['DELETED_OPS_ENT'] = tombs
