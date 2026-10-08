"""Independent website report worker using the existing PostgreSQL service.

The website always owns new reports. Enable paid research with HXZ_ENABLE_LIVE=1.
There is no synthetic production mode and no persistent-volume/new-service
requirement. Credentials remain environment-only, never command arguments.
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time

_supervisor_lock = threading.Lock()
_supervisor_state = None


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
    parser = argparse.ArgumentParser(description='Independent production report worker')
    parser.add_argument('--check', action='store_true', help='read configuration names only, no connections or research')
    parser.add_argument('--resume-request', help='explicitly resume a configuration-blocked request after repair')
    args = parser.parse_args(argv)
    env = configured_environment(os.environ)
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
            result = run_once(store, provider, synthetic=False,
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
