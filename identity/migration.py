"""Read-only, redacted legacy ownership preview. Never migrates passwords or data."""
import argparse
import hashlib
import json
from collections import defaultdict


def preview(snapshot, builtin=None):
    if not isinstance(snapshot, dict):
        raise ValueError('snapshot must be an object')
    projects = snapshot.get('PROJECTS') or {}
    if not isinstance(projects, dict):
        raise ValueError('PROJECTS must be an object')
    accounts = defaultdict(list)
    for source, values in [('builtin', builtin or {}), ('CITY_ACCOUNTS', snapshot.get('CITY_ACCOUNTS') or {}),
                           ('USER_PROFILES', snapshot.get('USER_PROFILES') or {})]:
        if not isinstance(values, dict):
            raise ValueError('account source must be an object')
        for login, record in values.items():
            if not isinstance(login, str) or not login.strip() or not isinstance(record, dict):
                raise ValueError('invalid account record')
            accounts[login.strip().casefold()].append(record)
    orgs, issues, owners, blocked = {}, [], defaultdict(set), set()
    for login, rows in sorted(accounts.items()):
        org = 'org_' + hashlib.sha256(login.encode()).hexdigest()[:24]
        orgs[org] = {'account_ref': hashlib.sha256(login.encode()).hexdigest()}
        bindings = {r['projKey'] for r in rows if isinstance(r.get('projKey'), str) and r['projKey']}
        # Conflicting passwords/profile source fields require reconciliation, never silent precedence.
        conflict = len(bindings) > 1 or any(len({str(r[k]) for r in rows if r.get(k)}) > 1
                                           for k in ('pwd', 'org', 'city'))
        if conflict:
            issues.append({'organization': org, 'reason': 'conflicting_account_sources'})
            blocked.update(bindings)
        for key in bindings:
            owners[key].add(org)
            if key not in projects:
                issues.append({'organization': org, 'reason': 'dangling_project_binding', 'project': key})
        if not bindings:
            issues.append({'organization': org, 'reason': 'no_explicit_project'})
    assignments = {}
    for key in sorted(projects):
        if len(owners[key]) == 1 and key not in blocked:
            assignments[key] = next(iter(owners[key]))
        elif len(owners[key]) > 1:
            issues.append({'project': key, 'reason': 'shared_project_binding'})
    return {'organizations': orgs, 'assignments': assignments,
            'unassigned': sorted(set(projects) - set(assignments)), 'issues': issues,
            'note': 'Preview only. Related records and builtin accounts need explicit review; no city inference.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot')
    parser.add_argument('--builtin', help='explicit JSON account map, never parsed from JavaScript')
    args = parser.parse_args()
    with open(args.snapshot, encoding='utf-8') as f:
        snapshot = json.load(f)
    builtin = None
    if args.builtin:
        with open(args.builtin, encoding='utf-8') as f:
            builtin = json.load(f)
    print(json.dumps(preview(snapshot, builtin), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
