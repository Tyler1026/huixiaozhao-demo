"""Narrow, fail-closed legacy-shape adapter; not a full frontend contract."""
FIELDS = {'PROJECTS': ('projects', dict), 'REPORTSTATE': ('reports', dict),
          'KB': ('knowledge', dict), 'DEMANDS': ('demands', list)}
BLOCKED_ROUTES = {'/api/sync-history', '/api/report-file', '/rag-log', '/api/kb-summary',
                  '/api/admin-reset', '/api/kb-clean', '/api/extract-text', '/api/kb-upload',
                  '/api/kb-version', '/api/report-push-request'}


def read(store, principal):
    state = store.get_state(principal, principal['org_id'])
    result = {key: state['data'].get(target, kind()) for key, (target, kind) in FIELDS.items()}
    result['_version'] = state['version']
    return result


def write(store, principal, payload):
    if set(payload) - (set(FIELDS) | {'_version'}) or '_version' not in payload:
        raise ValueError('unsupported sync fields or missing version')
    # Partial updates merge only within authenticated organization's current state.
    current = store.get_state(principal, principal['org_id'])
    data = dict(current['data'])
    for key, (target, kind) in FIELDS.items():
        if key in payload:
            if not isinstance(payload[key], kind):
                raise ValueError('invalid sync field type')
            data[target] = payload[key]
    version = store.put_state(principal, principal['org_id'], data, payload['_version'])
    return {'ok': True, '_version': version}
