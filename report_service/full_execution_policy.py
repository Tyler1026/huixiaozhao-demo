"""Pure, versioned execution limits; these are work limits, not money limits."""
from __future__ import annotations

import copy
import math

POLICY_VERSION = 'standard-live-v1'
DEFAULT_LIMITS = {
    'step_max_attempts': 3, 'report_max_retries': 24,
    'same_quality_failures': 2, 'attempt_deadline_seconds': 300,
    'task_work_seconds': 14400, 'stage_work_seconds': 3600,
    'wall_seconds': 86400,
}
GRANT_MAXIMA = {
    'extra_attempts': 3, 'extra_retries': 24,
    'extra_task_seconds': 14400, 'extra_stage_seconds': 3600,
    'extra_wall_seconds': 86400,
}


def default_limits():
    return dict(DEFAULT_LIMITS)


def empty_grants():
    return {'step_attempts': {}, 'stage_work_seconds': {}, 'report_retries': 0,
            'task_work_seconds': 0, 'wall_seconds': 0}


def validate_grant(grant=None):
    if grant is None:
        grant = {}
    if not isinstance(grant, dict) or set(grant) - set(GRANT_MAXIMA):
        raise ValueError('invalid grant fields')
    result = {}
    for key, maximum in GRANT_MAXIMA.items():
        value = grant.get(key, 0)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not 0 <= value <= maximum
                or (key in ('extra_attempts', 'extra_retries') and not isinstance(value, int))):
            raise ValueError('invalid finite grant')
        result[key] = value
    return result


def apply_grant(grants, grant, step_id, stage):
    result = copy.deepcopy(grants)
    result['step_attempts'][step_id] = result['step_attempts'].get(step_id, 0) + grant['extra_attempts']
    result['stage_work_seconds'][stage] = result['stage_work_seconds'].get(stage, 0) + grant['extra_stage_seconds']
    for source, target in (('extra_retries', 'report_retries'),
                           ('extra_task_seconds', 'task_work_seconds'),
                           ('extra_wall_seconds', 'wall_seconds')):
        result[target] += grant[source]
    return result


def effective_limits(limits, grants, step_id, stage):
    result = dict(limits)
    result['step_max_attempts'] += grants['step_attempts'].get(step_id, 0)
    result['report_max_retries'] += grants['report_retries']
    result['stage_work_seconds'] += grants['stage_work_seconds'].get(stage, 0)
    result['task_work_seconds'] += grants['task_work_seconds']
    result['wall_seconds'] += grants['wall_seconds']
    return result


def stop_reason(limits, *, attempts, retries, task_used, stage_used,
                created_at, now, quality_since_ack):
    """Gate the NEXT claim; the first attempt of another step is not a retry."""
    for exhausted, reason in (
        (now - created_at >= limits['wall_seconds'], 'wall_time_exhausted'),
        (task_used >= limits['task_work_seconds'], 'task_work_exhausted'),
        (stage_used >= limits['stage_work_seconds'], 'stage_work_exhausted'),
        (quality_since_ack >= limits['same_quality_failures'], 'quality_repeated'),
        (attempts >= limits['step_max_attempts'], 'step_attempts_exhausted'),
        (attempts > 0 and retries >= limits['report_max_retries'], 'report_retries_exhausted'),
    ):
        if exhausted:
            return reason
    return None
