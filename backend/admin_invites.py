"""Transactional invitation management; no network or storage at import time."""
import copy
import json
import re
import secrets
import time
import unicodedata

from .auth import AuthError, require_session


def _text(value, name, limit=128, optional=False):
    if not isinstance(value, str):
        if optional and value is None:
            return ''
        raise AuthError(400, 'invalid_input', name + '格式不正确')
    value = value.strip()
    if (not value and not optional) or len(value) > limit or any(unicodedata.category(c).startswith('C') or c in '<>' for c in value):
        raise AuthError(400, 'invalid_input', name + '格式不正确')
    return value


def _load(session):
    try:
        value = json.loads(session.read())
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except Exception:
        raise AuthError(503, 'storage_unavailable', '账户服务暂不可用') from None


def _save(session, state):
    try:
        ok = session.write(json.dumps(state, ensure_ascii=False))
    except Exception:
        ok = False
    if ok is not True:
        raise AuthError(503, 'storage_unavailable', '尚未保存，请重试')


def _project(state, city, key):
    sections = [dict(icon=icon, t=title, sub='待补充材料', tag='公开信息', known=[], calls=calls)
                for icon, title, calls in (
                    ('🏭', '主导产业与产业链', ['城市公开信息', '产业链图谱']),
                    ('🏢', '园区与承载条件', ['园区基础资料', '政府官网']),
                    ('🏗️', '链主与存量企业', ['企业名录', '工商信息']),
                    ('📜', '政策、规划与领导关注', ['政府工作报告', '领导发言']))]
    packages = state.get('CITY_BASE_PACKAGES') or {}
    source_key = packages.get(city) if isinstance(packages, dict) else None
    source = (state.get('PROJECTS') or {}).get(source_key)
    if isinstance(source, dict) and isinstance(source.get('kb'), list):
        # A city's shared base never includes another team's interviews,
        # uploads, custom topics, section metadata or private supplements.
        for section in sections:
            for original in source['kb']:
                if not isinstance(original, dict) or original.get('t') != section['t']:
                    continue
                for item in original.get('known', []):
                    if not isinstance(item, dict) or item.get('nature') != 'base' or not isinstance(item.get('text'), str):
                        continue
                    public_item = {'text': item['text'], 'nature': 'base'}
                    for field in ('src', 'origin'):
                        if isinstance(item.get(field), str):
                            public_item[field] = item[field]
                    section['known'].append(public_item)
            if section['known']:
                section['sub'] = str(len(section['known'])) + ' 条公共基础资料'
    return dict(id=key, workspaceId=key, city=city, org=city + '招商局', who='负责人',
                topic=city + '产业链招引', stage=1, kb=sections, report=None, clues=[])


def manage_invite(body, session, *, headers=None, token=None, admin_config=None, now=None):
    if not isinstance(body, dict):
        raise AuthError(400, 'invalid_input', '请求格式不正确')
    state = _load(session)
    actor = require_session(headers or {}, state, token=token, admin_config=admin_config, now=now)
    if actor.get('scope') != 'admin':
        raise AuthError(403, 'admin_required', '请使用管理端账号登录')
    invitations = state.setdefault('INVITE_CODES', {})
    projects = state.setdefault('PROJECTS', {})
    if not isinstance(invitations, dict) or not isinstance(projects, dict):
        raise AuthError(503, 'storage_unavailable', '邀请码数据暂不可用')
    action = body.get('action')
    result = {}
    if action == 'create':
        city = _text(body.get('city'), '城市', 128)
        email = _text(body.get('distributedEmail'), '分发邮箱', 254, optional=True)
        if email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise AuthError(400, 'invalid_email', '请填写有效邮箱')
        while True:
            code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(10))
            if code not in invitations:
                break
        key = 'p' + secrets.token_hex(12)
        while key in projects:
            key = 'p' + secrets.token_hex(12)
        project = _project(state, city, key)
        projects[key] = project
        invite = dict(city=city, projKey=key, role='member', createdBy=actor['user'],
                      createdAt=int((time.time() if now is None else now) * 1000),
                      revoked=False, usedBy=[], distributed=bool(email), distributedEmail=email)
        invitations[code] = invite
        result['project'] = copy.deepcopy(project)
    else:
        code = _text(body.get('code'), '邀请码', 128).upper()
        invite = invitations.get(code)
        if not isinstance(invite, dict):
            raise AuthError(404, 'invite_not_found', '邀请码不存在')
        if action == 'revoke':
            invite['revoked'] = True
        elif action == 'distribution':
            if type(body.get('distributed')) is not bool:
                raise AuthError(400, 'invalid_input', '分发状态格式不正确')
            email = _text(body.get('distributedEmail'), '分发邮箱', 254, optional=True)
            if body['distributed'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
                raise AuthError(400, 'invalid_email', '请填写有效邮箱')
            invite['distributed'] = body['distributed']
            invite['distributedEmail'] = email if body['distributed'] else ''
        else:
            raise AuthError(400, 'invalid_action', '不支持的操作')
    _save(session, state)
    result.update(ok=True, invite=dict(copy.deepcopy(invite), code=code))
    return result


def remove_member(body, session, *, headers=None, token=None, admin_config=None, now=None):
    if not isinstance(body, dict) or body.get('action') != 'remove':
        raise AuthError(400, 'invalid_action', '不支持的成员操作')
    state = _load(session)
    actor = require_session(headers or {}, state, token=token, admin_config=admin_config, now=now)
    key = _text(body.get('projKey'), '工作区', 256)
    user = _text(body.get('user'), '账号', 128).casefold()
    if user == actor['user'].strip().casefold():
        raise AuthError(400, 'cannot_remove_self', '不能在此移除自己')
    if actor.get('scope') != 'admin':
        if key != actor.get('projKey') or key not in actor.get('projectKeys', []):
            raise AuthError(403, 'workspace_forbidden', '无权管理此工作区')
        if actor.get('role') != 'owner':
            raise AuthError(403, 'owner_required', '仅工作区管理员可以移除成员')
    matches = [(field, k, v) for field in ('USER_PROFILES', 'CITY_ACCOUNTS')
               for k, v in (state.get(field) or {}).items()
               if isinstance(k, str) and k.strip().casefold() == user and isinstance(v, dict)]
    if len(matches) != 1:
        raise AuthError(404, 'member_not_found', '未找到该成员')
    field, account_key, profile = matches[0]
    memberships = profile.get('memberships')
    if memberships is None:
        memberships = ({profile['projKey']: dict(role=profile.get('role', 'member'),
                                                joinedAt=profile.get('ts', 0), city=profile.get('city'))}
                       if profile.get('projKey') else {})
    if not isinstance(memberships, dict) or key not in memberships:
        raise AuthError(404, 'member_not_found', '未找到该工作区成员')
    memberships = copy.deepcopy(memberships)
    removed = dict(memberships[key]) if isinstance(memberships[key], dict) else {}
    removed.update(active=False, removedAt=int((time.time() if now is None else now) * 1000))
    memberships[key] = removed
    profile['memberships'] = memberships
    state[field][account_key] = profile
    _save(session, state)
    return {'ok': True}
