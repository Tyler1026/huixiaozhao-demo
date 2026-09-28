"""Project-scoped operations. Ownership comes only from authenticated scoped state."""
import copy


def project_state(store, principal, project_id):
    state = store.get_state(principal, principal['org_id'])
    projects = state['data'].get('projects', {})
    if not isinstance(projects, dict) or project_id not in projects:
        raise LookupError('project not found')
    project = projects[project_id]
    if not isinstance(project, dict):
        raise ValueError('invalid project state')
    return state, project


def read_knowledge(store, principal, project_id):
    state, project = project_state(store, principal, project_id)
    return {'kb': project.get('kb', []), 'version': state['version']}


def update_knowledge(store, principal, project_id, body):
    state, _ = project_state(store, principal, project_id)
    if set(body) != {'version', 'kb'} or not isinstance(body['kb'], list) or len(body['kb']) > 100:
        raise ValueError('invalid knowledge payload')
    for group in body['kb']:
        if not isinstance(group, dict) or set(group) - {'topic', 'known'}:
            raise ValueError('invalid knowledge group')
        if not isinstance(group.get('topic'), str) or len(group['topic']) > 200:
            raise ValueError('invalid topic')
        known = group.get('known')
        if not isinstance(known, list) or len(known) > 1000:
            raise ValueError('invalid knowledge items')
        if any(not isinstance(item, str) or len(item) > 10000 for item in known):
            raise ValueError('invalid knowledge text')
    data = copy.deepcopy(state['data'])
    data['projects'][project_id]['kb'] = body['kb']
    version = store.put_state(principal, principal['org_id'], data, body['version'])
    return {'ok': True, 'version': version}


def read_report(store, principal, project_id):
    state, _ = project_state(store, principal, project_id)
    reports = state['data'].get('reports', {})
    report = reports.get(project_id) if isinstance(reports, dict) else None
    if report is None:
        raise LookupError('report not found')
    return {'report': report, 'version': state['version']}
