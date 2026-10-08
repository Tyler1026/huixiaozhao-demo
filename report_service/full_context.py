"""Pure task-specific views of persisted report facts.

Every included record and source excerpt is preserved in full. Choosing the
claims that a named substep must process does not alter the persisted report
or turn a transport character limit into a truncation policy.
"""
from __future__ import annotations

import copy

from .full_contract import canonical_url


def _metadata(value):
    metadata = value.get('metadata') if isinstance(value, dict) else None
    return metadata if isinstance(metadata, dict) else {}


def _records(values):
    return values if isinstance(values, list) else []


def _related_evidence(metadata, records, fields=('url', 'evidence_ref')):
    refs = {canonical_url(record.get(field)) for record in records
            for field in fields if isinstance(record, dict)}
    refs.discard('')
    return copy.deepcopy([item for item in _records(metadata.get('evidence'))
                          if isinstance(item, dict) and canonical_url(item.get('url')) in refs])


def _direction_view(prior):
    metadata = _metadata(prior.get('industry'))
    directions = _records(metadata.get('directions'))
    return {
        'text': '本子步骤使用的已确定产业方向，完整方向记录及其检索来源如下。',
        'metadata': {
            'directions': copy.deepcopy(directions),
            'evidence': _related_evidence(metadata, directions, fields=('evidence_ref',)),
        },
    }


def _selected(prior):
    """Stable unique (name, direction) identities, retaining full raw records."""
    result = []
    for number in (1, 2, 3):
        stage_id = f'enterprises_{number}'
        metadata = _metadata(prior.get(stage_id))
        seen = set()
        for company in _records(metadata.get('selected')):
            if not isinstance(company, dict) or not isinstance(company.get('name'), str):
                continue
            name = company['name'].strip()
            if not name or name in seen:
                continue
            seen.add(name)
            result.append((stage_id, company))
    return result


def _enterprise_views(prior, selected, explanation):
    views = {}
    for number in (1, 2, 3):
        stage_id = f'enterprises_{number}'
        companies = [company for source_stage, company in selected if source_stage == stage_id]
        views[stage_id] = {
            'text': f'{explanation} 当前dir{number}完整目标记录共{len(companies)}家；'
                    '其他企业正文和候选池继续保存在原报告中。',
            'metadata': {
                'selected': copy.deepcopy(companies),
                'evidence': _related_evidence(_metadata(prior.get(stage_id)), companies),
            },
        }
    return views


def _keep(view, prior, *stage_ids):
    for stage_id in stage_ids:
        if stage_id in prior:
            view[stage_id] = copy.deepcopy(prior[stage_id])


def scoped_prior(prior, stage_id, part):
    """Return the full facts required by one fact-check or scoring substep.

    Other stages retain their existing dependency handling. Scoring is split
    into the stable first/second halves of all unique selected identities;
    no record field, excerpt or chosen dependency is clipped.
    """
    if stage_id not in {'fact_check', 'scoring'}:
        return prior
    if prior is None:
        prior = {}
    if not isinstance(prior, dict):
        raise TypeError('scoped report context requires a stage mapping')
    if stage_id == 'fact_check':
        if part in {'经济关键数字', '政策金额'}:
            view = {}
            _keep(view, prior, 'economy' if part == '经济关键数字' else 'policy', 'fact_check')
            return view
        if part != '五星企业信号':
            raise ValueError('unsupported fact-check context part')
        selected, all_selected = [], _selected(prior)
        for number in (1, 2, 3):
            selected.extend([item for item in all_selected
                             if item[0] == f'enterprises_{number}'][:3])
        view = {'industry': _direction_view(prior)}
        view.update(_enterprise_views(prior, selected,
                    '当前事实核验子步骤逐方向核验前三家不重复已精选企业的完整扩产或投资信号。'))
        _keep(view, prior, 'fact_check')
        return view
    if part not in {'评分维度与权重', '加权计算'}:
        raise ValueError('unsupported scoring context part')
    selected = _selected(prior)
    split = (len(selected) + 1) // 2
    start, end = (0, split) if part == '评分维度与权重' else (split, len(selected))
    batch = selected[start:end]
    explanation = (f'当前评分子步骤{part}处理稳定精选名单第{start + 1}至{end}项，'
                   f'全部{len(selected)}项中的本批{len(batch)}项；只评分本批完整记录。'
                   if batch else f'当前评分子步骤{part}没有待评分目标；全部精选名单共{len(selected)}项。')
    view = {'industry': _direction_view(prior)}
    view.update(_enterprise_views(prior, batch, explanation))
    _keep(view, prior, 'chain', 'policy')
    if 'fact_check' in prior:
        view['fact_check'] = {
            'text': '评分使用的完整事实核验结构化记录及来源如下，核验正文保留在原报告中。',
            'metadata': copy.deepcopy(_metadata(prior['fact_check'])),
        }
    _keep(view, prior, 'scoring')
    return view
