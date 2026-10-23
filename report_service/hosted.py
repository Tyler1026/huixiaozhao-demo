"""Independent website report worker using the existing PostgreSQL service.

The website always owns new reports. Enable paid research with HXZ_ENABLE_LIVE=1.
There is no synthetic production mode and no persistent-volume/new-service
requirement. Credentials remain environment-only, never command arguments.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import threading
import time

_supervisor_lock = threading.Lock()
_supervisor_state = None


class _ArgumentsInvalid(ValueError):
    pass


class _WorkerParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default error includes the supplied value. Operator input
        # and connection strings must never be copied to logs.
        raise _ArgumentsInvalid()


def _integer(value):
    if not re.fullmatch(r'[0-9]+', value):
        raise argparse.ArgumentTypeError('invalid integer')
    return int(value)


def _seconds(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError('invalid seconds') from None
    if not math.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError('invalid seconds')
    return number


def _operator_text(value, maximum):
    return (isinstance(value, str) and bool(value.strip()) and len(value) <= maximum
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def _policy_projection(result):
    """Render a strict operational whitelist, never report payloads or errors."""
    projection = result['policy_projection']
    if not isinstance(projection, dict):
        raise ValueError('invalid policy projection')
    allowed = {
        'limits': ('step_max_attempts', 'report_max_retries', 'same_quality_failures',
                   'attempt_deadline_seconds', 'task_work_seconds', 'stage_work_seconds', 'wall_seconds'),
        'usage': ('attempts_total', 'retries', 'work_seconds', 'current_stage_work_seconds',
                  'current_step_attempts', 'quality_failures', 'quality_since_ack'),
        'remaining': ('task_seconds', 'stage_seconds', 'wall_seconds', 'step_attempts', 'retries'),
    }
    safe = {}
    for name, keys in allowed.items():
        values = projection.get(name)
        if values is None:
            safe[name] = None
            continue
        if not isinstance(values, dict):
            raise ValueError('invalid numeric projection')
        safe[name] = {}
        for key in keys:
            value = values.get(key)
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or value < 0):
                raise ValueError('invalid numeric projection')
            safe[name][key] = value
    enums = {
        'policy_version': {None, 'standard-live-v1'},
        'state': {'active', 'pause_requested', 'paused', 'legacy'},
        'applicability': {'standard_live', 'legacy', 'not_applied'},
        'pause_reason': {None, 'manual', 'wall_time_exhausted', 'task_work_exhausted',
                         'stage_work_exhausted', 'quality_repeated', 'step_attempts_exhausted',
                         'report_retries_exhausted', 'timeout', 'worker_crash', 'upstream',
                         'rate_limit', 'quality', 'configuration', 'budget_exhausted',
                         'artifact', 'cancelled'},
    }
    for key, choices in enums.items():
        value = projection.get(key)
        if not (value is None or isinstance(value, str)) or value not in choices:
            raise ValueError('invalid policy state')
        safe[key] = value
    blocked = projection.get('next_claim_blocked_reason')
    if blocked not in enums['pause_reason']:
        raise ValueError('invalid blocked reason')
    safe['next_claim_blocked_reason'] = blocked
    step = projection.get('current_step_id')
    if step is not None and (not isinstance(step, str)
                             or not re.fullmatch(re.escape(result['id']) + r':[0-9]+', step)):
        raise ValueError('invalid step identity')
    safe['current_step_id'] = step
    version = projection.get('version')
    if version is not None and (type(version) is not int or version < 1):
        raise ValueError('invalid policy version')
    safe['version'] = version
    for key in ('can_pause', 'can_continue', 'money_hard_limit', 'token_hard_limit', 'search_hard_limit'):
        value = projection.get(key)
        if type(value) is not bool:
            raise ValueError('invalid policy flag')
        safe[key] = value
    return safe


def _policy_command(args, env):
    """Server-local operator path. It never starts a provider or queue worker."""
    from .full_store import Conflict
    from .full_postgres import PostgresFullStore
    from .website_queue import TENANT, report_id

    request = args.policy_status or args.pause_request or args.continue_request
    if not env.get('DATABASE_URL'):
        print('{"report_engine":"policy_configuration_required","missing":["DATABASE_URL"]}', flush=True)
        return 2
    try:
        store = PostgresFullStore(env['DATABASE_URL'])
        rid = report_id(request)
        if args.policy_status:
            result = store.policy_status(TENANT, rid)
        else:
            options = dict(expected_version=args.expected_version,
                           idempotency_key=args.idempotency_key.strip(),
                           actor=args.actor.strip(), reason=args.reason.strip())
            if args.pause_request:
                result = store.pause_report(TENANT, rid, **options)
            else:
                grant = {name: getattr(args, name) for name in (
                    'extra_attempts', 'extra_retries', 'extra_task_seconds',
                    'extra_stage_seconds', 'extra_wall_seconds') if getattr(args, name) is not None}
                result = store.continue_report(TENANT, rid, grant=grant, **options)
        if result is None:
            print('{"report_engine":"policy_not_found"}', flush=True)
            return 3
        if (result.get('id') != rid or result.get('status') not in
                {'queued', 'running', 'retry_wait', 'pause_requested', 'paused', 'completed', 'cancelled', 'failed'}):
            raise ValueError('invalid result identity')
        output = {'report_engine': 'policy_status' if args.policy_status else 'policy_control_applied',
                  'request_id': request, 'report_id': rid, 'status': result['status'],
                  'policy_projection': _policy_projection(result)}
        print(json.dumps(output, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except Conflict:
        print('{"report_engine":"policy_conflict"}', flush=True)
        return 4
    except ValueError:
        print('{"report_engine":"policy_invalid_operation"}', flush=True)
        return 2
    except Exception:
        print('{"report_engine":"policy_storage_unavailable"}', flush=True)
        return 1


def configured_environment(environ):
    env = dict(environ)
    if not env.get('HXZ_MODEL_KEY') and env.get('DEEPSEEK_API_KEY'):
        env['HXZ_MODEL_KEY'] = env['DEEPSEEK_API_KEY']
        env['HXZ_MODEL_URL'] = env.get('HXZ_MODEL_URL') or 'https://api.deepseek.com/v1/chat/completions'
        env['HXZ_MODEL_NAME'] = env.get('HXZ_MODEL_NAME') or 'deepseek-chat'
    if not env.get('HXZ_SEARCH_KEY') and env.get('EXA_API_KEY'):
        env['HXZ_SEARCH_KEY'] = env['EXA_API_KEY']
        env['HXZ_SEARCH_PROVIDER'] = env.get('HXZ_SEARCH_PROVIDER') or 'exa'
    return env


def readiness(environ):
    env = configured_environment(environ)
    missing = [name for name in ('DATABASE_URL', 'HXZ_MODEL_KEY', 'HXZ_MODEL_URL',
                                'HXZ_MODEL_NAME', 'HXZ_SEARCH_KEY') if not env.get(name)]
    if env.get('HXZ_ENABLE_LIVE') != '1':
        missing.append('HXZ_ENABLE_LIVE=1')
    if env.get('HXZ_REPORT_ENGINE', 'standalone') != 'standalone':
        missing.append('HXZ_REPORT_ENGINE=standalone')
    from .providers import SEARCH_PROVIDERS, validate_https_url
    invalid = []
    for name in ('HXZ_MODEL_URL', 'HXZ_SEARCH_URL'):
        if env.get(name):
            try:
                validate_https_url(env[name])
            except ValueError:
                invalid.append(name)
    if (env.get('HXZ_SEARCH_PROVIDER') or 'brave').strip().lower() not in SEARCH_PROVIDERS:
        invalid.append('HXZ_SEARCH_PROVIDER')
    return {'ready': not missing and not invalid, 'missing': missing, 'invalid': invalid}


def engine_status(environ=None):
    """Safe process/configuration status; does not claim successful research."""
    env = os.environ if environ is None else environ
    config = readiness(env)
    with _supervisor_lock:
        state = _supervisor_state
        active = bool(state and state['thread'].is_alive()
                      and not state['stop'].is_set())
        process = state['process'] if active else None
        worker = bool(process is not None and process.poll() is None)
    return {'engine': 'standalone',
            'configured': config['ready'], 'missing': config['missing'],
            'invalid': config['invalid'],
            'supervisor_running': active, 'worker_running': worker,
            'scope': 'process_and_configuration_only'}


def start_supervisor(environ=None, *, stop=None):
    """Website owns the worker lifetime; crash recovery retains DB checkpoints."""
    env = os.environ if environ is None else environ
    stop = stop or threading.Event()
    state = {'thread': None, 'stop': stop, 'process': None}
    def supervise():
        process = None
        try:
            while not stop.is_set():
                config = readiness(env)
                if not config['ready']:
                    print(json.dumps({'report_engine': 'configuration_required', **config}), flush=True)
                    stop.wait(60)
                    continue
                process = subprocess.Popen([sys.executable, '-m', 'report_service.hosted'],
                                           env=dict(env), close_fds=True)
                with _supervisor_lock:
                    state['process'] = process
                while process.poll() is None and not stop.wait(1):
                    pass
                if not stop.is_set():
                    print('{"report_engine":"worker_restart"}', flush=True)
                    stop.wait(30)
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
            with _supervisor_lock:
                state['process'] = None
    thread = threading.Thread(target=supervise, name='report-supervisor', daemon=True)
    state['thread'] = thread
    global _supervisor_state
    with _supervisor_lock:
        _supervisor_state = state
    thread.start()
    return stop


def main(argv=None):
    parser = _WorkerParser(description='Independent production report worker', allow_abbrev=False)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--check', action='store_true', help='read configuration names only, no connections or research')
    actions.add_argument('--resume-request', help='explicitly resume a configuration-blocked request after repair')
    actions.add_argument('--policy-status', metavar='REQUEST_ID', help='inspect execution policy without claiming or recovering a report')
    actions.add_argument('--pause-request', metavar='REQUEST_ID', help='request a pause at the current step boundary')
    actions.add_argument('--continue-request', metavar='REQUEST_ID', help='continue a paused v1 report with explicit finite allowance')
    parser.add_argument('--expected-version', type=_integer)
    parser.add_argument('--idempotency-key')
    parser.add_argument('--actor')
    parser.add_argument('--reason')
    parser.add_argument('--extra-attempts', type=_integer, help='additional current-step starts, at most 3')
    parser.add_argument('--extra-retries', type=_integer, help='additional report retries, at most 24')
    parser.add_argument('--extra-task-seconds', type=_seconds, help='additional work seconds, at most 14400')
    parser.add_argument('--extra-stage-seconds', type=_seconds, help='additional current-stage seconds, at most 3600')
    parser.add_argument('--extra-wall-seconds', type=_seconds, help='additional lifecycle seconds, at most 86400')
    try:
        args = parser.parse_args(argv)
        request = args.policy_status or args.pause_request or args.continue_request
        controls = (args.expected_version, args.idempotency_key, args.actor, args.reason)
        grants = {name: getattr(args, name) for name in (
            'extra_attempts', 'extra_retries', 'extra_task_seconds',
            'extra_stage_seconds', 'extra_wall_seconds') if getattr(args, name) is not None}
        if request and not re.fullmatch(r'rr[A-Za-z0-9_-]{1,64}', request):
            raise _ArgumentsInvalid()
        if args.pause_request or args.continue_request:
            if (args.expected_version is None or args.expected_version < 1
                    or not _operator_text(args.idempotency_key, 128)
                    or not _operator_text(args.actor, 128) or not _operator_text(args.reason, 1000)):
                raise _ArgumentsInvalid()
        elif any(value is not None for value in controls):
            raise _ArgumentsInvalid()
        if grants and not args.continue_request:
            raise _ArgumentsInvalid()
        if args.continue_request:
            from .full_execution_policy import validate_grant
            validate_grant(grants)
    except ValueError:
        print('{"report_engine":"policy_arguments_invalid"}', flush=True)
        return 2
    env = configured_environment(os.environ)
    if request:
        return _policy_command(args, env)
    if args.check:
        state = readiness(env)
        print(json.dumps(state), flush=True)
        return 0 if state['ready'] else 2
    if not readiness(env)['ready']:
        print(json.dumps({'report_engine': 'configuration_required', **readiness(env)}), flush=True)
        return 2
    from .full_postgres import PostgresFullStore
    from .full_provider import FullLiveProvider
    from .full_worker import run_once
    from .website_queue import WebsiteQueue
    from backend.sync_transaction import postgres_session, report_request_active
    from .website_queue import ENGINE
    provider = FullLiveProvider.from_env(env)
    scratch = os.path.realpath(env.get('HXZ_ARTIFACT_SCRATCH', '/tmp/hxz-full-artifacts'))
    store = PostgresFullStore(env['DATABASE_URL'], artifact_root=scratch)
    queue = WebsiteQueue(store, postgres_session)
    if args.resume_request:
        from .website_queue import TENANT, report_id, valid_request
        with postgres_session() as session:
            state = json.loads(session.read())
            target = next((r for r in state.get('REPORT_REQUESTS') or []
                           if r.get('id') == args.resume_request and r.get('engine') == ENGINE), None)
            if not target or not valid_request(target) or target.get('status') == 'cancelled':
                raise ValueError('invalid resume request')
            rid = report_id(args.resume_request)
            resumed = store.resume_configuration(TENANT, rid)
            job = store.get(TENANT, rid)
            if not resumed and (not job or job['status'] not in ('queued', 'running', 'retry_wait')):
                raise ValueError('report is not configuration-blocked')
            target.update(status='running', failureCode=None)
            if not session.write(json.dumps(state, ensure_ascii=False)):
                raise OSError('website storage unavailable')
        print('{"report_engine":"configuration_resumed"}', flush=True)
        return 0
    parent = os.getppid()
    def watch_parent():
        while os.getppid() == parent:
            time.sleep(.1)
        # Research children independently detect this process disappearing.
        os._exit(71)
    threading.Thread(target=watch_parent, daemon=True).start()
    while True:
        phase = 'ingest'
        try:
            queue.ingest()
            phase = 'mirror'
            queue.mirror(continue_on_error=True)
            phase = 'worker'
            # Two bounded candidate-completion rounds can each include a
            # 30-second parallel search wave and a 90-second chat. Leave
            # room for that repair; durable task policy may shorten the lease.
            result = run_once(store, provider, synthetic=False, timeout=300,
                              stop_job=lambda job: not report_request_active(
                                  job['request_key'], ENGINE))
            if result:
                print(json.dumps(result, ensure_ascii=False), flush=True)
            else:
                time.sleep(2)
        except Exception as error:
            # Do not log SQL, upstream response bodies or environment values.
            diagnostic = {'report_engine': 'storage_or_delivery_retry',
                          'phase': phase, 'error_type': type(error).__name__}
            code = getattr(error, 'pgcode', None)
            if isinstance(code, str) and len(code) == 5 and code.isascii() and code.isalnum():
                diagnostic['sqlstate'] = code
            print(json.dumps(diagnostic), flush=True)
            time.sleep(30)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('{"report_engine":"configuration_or_storage_unavailable"}', flush=True)
        raise SystemExit(1)
