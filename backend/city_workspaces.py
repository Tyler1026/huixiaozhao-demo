"""Server-owned city workspace registry; no storage or network at import time."""
import math
import unicodedata
from datetime import datetime, timedelta, timezone


_SHANGHAI = timezone(timedelta(hours=8), 'Asia/Shanghai')


def _invalid():
    from .auth import AuthError
    raise AuthError(503, 'city_workspace_unavailable', '城市工作区配置暂不可用')


def next_month_report_at(now_seconds):
    """Next calendar month's first day at 09:00 Asia/Shanghai, in epoch ms."""
    if type(now_seconds) not in (int, float) or not math.isfinite(now_seconds):
        raise ValueError('invalid schedule time')
    current = datetime.fromtimestamp(now_seconds, _SHANGHAI)
    year, month = (current.year + 1, 1) if current.month == 12 else (current.year, current.month + 1)
    return int(datetime(year, month, 1, 9, tzinfo=_SHANGHAI).timestamp() * 1000)


def get_city_workspace(state, city):
    """Read one exact city binding. Never infer ownership from a city label."""
    registry = state.get('CITY_WORKSPACES', {})
    if not isinstance(registry, dict):
        _invalid()
    if city not in registry:
        return None
    record = registry[city]
    if (not isinstance(record, dict)
            or any(not isinstance(record.get(field), str) or not record[field].strip()
                   for field in ('projectKey', 'inviteCode'))
            or not isinstance(record.get('province'), str)
            or record.get('ownerUser') is not None and (
                not isinstance(record['ownerUser'], str) or not record['ownerUser'].strip())
            or type(record.get('monthlyEnabled')) is not bool
            or any(type(record.get(field)) not in (int, float)
                   or not math.isfinite(record[field]) or record[field] < 0
                   for field in ('createdAt', 'nextReportAt'))):
        _invalid()
    projects = state.get('PROJECTS')
    if not isinstance(projects, dict):
        _invalid()
    project = projects.get(record['projectKey'])
    if (not isinstance(project, dict) or project.get('city') != city or project.get('isDemand') is True
            or project.get('workspaceId') != record['projectKey']):
        _invalid()
    return record


def _region_text(value, suffixes):
    value = unicodedata.normalize('NFKC', value or '').strip()
    return value[:-1] if len(value) > 1 and value[-1] in suffixes else value


def resolve_city_workspace(state, city, province='', *, project_key=None):
    """Resolve display aliases within a province while preserving workspace IDs."""
    from .auth import AuthError

    registry = state.get('CITY_WORKSPACES', {})
    if not isinstance(registry, dict):
        _invalid()
    city_name = _region_text(city, '市')
    province_name = _region_text(province, '省市')
    matches = []
    exact_mismatch = False
    for label in registry:
        if _region_text(label, '市') != city_name:
            continue
        binding = get_city_workspace(state, label)
        saved_province = _region_text(binding['province'], '省市')
        if province_name and saved_province and province_name != saved_province:
            exact_mismatch |= label == city
            continue
        if project_key is None or binding['projectKey'] == project_key:
            matches.append((label, binding))
    if project_key is not None and len(matches) != 1:
        raise AuthError(409, 'city_workspace_changed', '指定的地区主工作区已变化，请刷新后重试')
    if len(matches) > 1:
        # A previously published primary can absorb a naming alias only
        # when the other binding has no published report or active members.
        from .auth import _memberships

        projects = state.get('PROJECTS') or {}
        published = [match for match in matches if projects[match[1]['projectKey']].get('baseReportVersion')]
        if len(published) == 1:
            other_keys = {binding['projectKey'] for _, binding in matches
                          if binding['projectKey'] != published[0][1]['projectKey']}
            active_keys = {key for table in ('USER_PROFILES', 'CITY_ACCOUNTS')
                           for record in (state.get(table) or {}).values() if isinstance(record, dict)
                           for key in _memberships(record)}
            if not (other_keys & active_keys):
                return published[0]
        exact = next((match for match in matches if match[0] == city), None)
        if exact is not None:
            return exact
        raise AuthError(409, 'city_workspace_ambiguous', '存在多个同名地区，请填写主工作区显示的准确地区名称')
    if not matches and exact_mismatch:
        raise AuthError(409, 'city_workspace_province_mismatch', '地区名称已绑定其他省份，请核对工作区')
    return matches[0] if matches else (city, None)


def canonical_invitation(state, city, code, project_key):
    """Legacy invitations remain compatible only while no city binding exists."""
    record = get_city_workspace(state, city)
    if record is not None and (record['inviteCode'] != code or record['projectKey'] != project_key):
        from .auth import AuthError
        raise AuthError(400, 'invalid_invite', '邀请码不存在或已失效')
    return record


def membership_role(state, city, code, project_key, username, legacy_role):
    """Caller holds the serialized auth transaction; first enrollment owns it."""
    record = canonical_invitation(state, city, code, project_key)
    if record is None:
        return legacy_role
    if record['ownerUser'] is None:
        record['ownerUser'] = username
    return 'owner' if record['ownerUser'] == username else 'member'


def protect_city_sync(incoming, state):
    """Defense in depth for callers bypassing the normal authenticated guard."""
    from .auth import AuthError
    if 'KB_EDITS' in incoming:
        raise AuthError(403, 'protected_field', '资料修订只能通过专用接口修改')
    if 'CITY_WORKSPACES' in incoming:
        raise AuthError(403, 'protected_field', '城市工作区只能通过专用接口修改')
    if ('RESET_GEN' in incoming and incoming['RESET_GEN'] != state.get('RESET_GEN')
            or state.get('CITY_WORKSPACES') and incoming.get('RESET_GEN') != state.get('RESET_GEN')):
        raise AuthError(403, 'stale_generation', '数据已更新，请刷新后重试')
    if 'REPORT_PUBLICATIONS' in incoming:
        raise AuthError(403, 'protected_field', '发布回执只能由报告服务修改')
    registry = state.get('CITY_WORKSPACES', {})
    if not isinstance(registry, dict):
        _invalid()
    if registry:
        for field in ('PROJECTS', 'REPORTSTATE', 'KB_ITEM_TOMBS', 'CITY_BASE_PACKAGES'):
            if field in incoming and not isinstance(incoming[field], dict):
                raise AuthError(403, 'invalid_sync', '同步数据格式不正确')
        if 'DELETED_PROJECTS' in incoming and not isinstance(incoming['DELETED_PROJECTS'], list):
            raise AuthError(403, 'invalid_sync', '同步数据格式不正确')
    for city in registry:
        record = get_city_workspace(state, city)
        key = record['projectKey']
        if key in (incoming.get('DELETED_PROJECTS') or []):
            raise AuthError(403, 'protected_field', '不能删除城市主工作区')
        change = (incoming.get('PROJECTS') or {}).get(key)
        if (key in incoming.get('PROJECTS', {}) and not isinstance(change, dict)
                or key in incoming.get('REPORTSTATE', {}) and not isinstance(incoming['REPORTSTATE'][key], dict)):
            raise AuthError(403, 'protected_field', '不能替换城市主工作区')
        if isinstance(change, dict) and any(field in change and change[field] != expected
                                            for field, expected in (('id', key), ('workspaceId', key), ('city', city), ('isDemand', False))):
            raise AuthError(403, 'protected_field', '不能更改城市主工作区归属')
        packages = incoming.get('CITY_BASE_PACKAGES')
        saved_packages = state.get('CITY_BASE_PACKAGES') or {}
        if (isinstance(packages, dict) and city in packages
                and packages[city] != saved_packages.get(city)):
            raise AuthError(403, 'protected_field', '城市基础包指向只能由报告服务修改')
        project = state['PROJECTS'][key]
        if not isinstance(project.get('baseReportVersion'), dict):
            continue
        if isinstance(change, dict):
            for field in ('baseReportVersion', 'baseReportTopic', 'reportRequestId', 'reportFiles'):
                if field in change and change[field] != project.get(field):
                    raise AuthError(403, 'protected_field', '报告基础版本已更新，请刷新后重试')
            if 'kb' in change and _base_items(change['kb']) != _base_items(project.get('kb')):
                raise AuthError(403, 'protected_field', '报告基础材料只能由报告服务修改')
        report = (state.get('REPORTSTATE') or {}).get(key) or {}
        report_change = (incoming.get('REPORTSTATE') or {}).get(key)
        if isinstance(report_change, dict):
            for field in ('sourceReportId', 'baseReportVersion'):
                if field in report_change and report_change[field] != report.get(field):
                    raise AuthError(403, 'protected_field', '基础报告已更新，请刷新后重试')
            base_topic = project.get('baseReportTopic') or project['baseReportVersion'].get('topic')
            if not isinstance(base_topic, str) or not base_topic.strip():
                _invalid()
            for field in ('aiReportByTopic', 'phaseByTopic', 'tsByTopic'):
                if field in report_change:
                    value = report_change[field]
                    if (not isinstance(value, dict)
                            or value.get(base_topic) != (report.get(field) or {}).get(base_topic)):
                        raise AuthError(403, 'protected_field', '基础报告已更新，请刷新后重试')
        tombs = (incoming.get('KB_ITEM_TOMBS') or {}).get(key) or {}
        if not isinstance(tombs, dict):
            raise AuthError(403, 'invalid_sync', '同步数据格式不正确')
        if tombs:
            from .sync_merge import _kb_item_fp
            for index, section in enumerate(project.get('kb') or []):
                removed = tombs.get(str(index), tombs.get(index, {})) or {}
                for item in section.get('known', []):
                    if isinstance(item, dict) and item.get('nature') == 'base' and _kb_item_fp(item) in removed:
                        raise AuthError(403, 'protected_field', '不能删除报告基础材料')


def _base_items(sections):
    if not isinstance(sections, list):
        return None
    if any(not isinstance(section, dict) or not isinstance(section.get('known', []), list)
           for section in sections):
        return None
    return [(section.get('t'), [item for item in section.get('known', [])
                               if isinstance(item, dict) and item.get('nature') == 'base'])
            for section in sections if isinstance(section, dict)
            and any(isinstance(item, dict) and item.get('nature') == 'base'
                    for item in section.get('known', []))]
