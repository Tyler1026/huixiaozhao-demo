"""Full-v1 entrypoint: python -m report_service.full_cli {api|worker}.

One host, persistent local database and artifacts. Production integration is
separate and disabled by default. --once processes one durable substep, not an
entire report; --until-id is the bounded acceptance/operations mode.
"""
import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path

from .full_store import FullStore


def parse(argv):
    p = argparse.ArgumentParser(description='Durable full report service')
    p.add_argument('mode', choices=('api', 'worker'))
    p.add_argument('--db', required=True)
    p.add_argument('--artifacts', required=True)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8798)
    p.add_argument('--allow-live', action='store_true')
    p.add_argument('--provider', choices=('synthetic', 'live'), default='synthetic')
    p.add_argument('--once', action='store_true')
    p.add_argument('--until-id')
    p.add_argument('--tenant')
    p.add_argument('--run-limit', type=float, default=None, help='optional acceptance timebox; default runs continuously')
    p.add_argument('--ttl', type=float, default=120)
    p.add_argument('--timeout', type=float, default=180)
    p.add_argument('--poll', type=float, default=.5)
    a = p.parse_args(argv)
    if not Path(a.db).is_absolute() or not Path(a.artifacts).is_absolute():
        p.error('database and artifact paths must be absolute')
    if a.until_id and not a.tenant:
        p.error('--until-id requires --tenant')
    if (a.run_limit is not None and not 0 < a.run_limit <= 86400) or not 0 < a.poll <= 60:
        p.error('invalid run or polling budget')
    if not 0 < a.ttl <= 600 or not 0 < a.timeout <= 900:
        p.error('invalid lease or substep timeout')
    return a


def _terminate(signum, frame):
    # Worker run_once finally reaps its child; the persisted lease then expires
    # and another process resumes. Do not reset state to pending on shutdown.
    raise SystemExit(128 + signum)


def main(argv=None):
    args = parse(sys.argv[1:] if argv is None else argv)
    signal.signal(signal.SIGTERM, _terminate)
    try:
        if args.mode == 'worker' and args.provider == 'live' and os.environ.get('HXZ_ENABLE_LIVE') != '1':
            raise ValueError('live research is disabled')
        if args.mode == 'api':
            from .full_api import make_handler, ThreadingHTTPServer, validate_tokens
            tokens = validate_tokens(json.loads(os.environ.get('HXZ_FULL_TOKENS_JSON', '{}')))
            if args.allow_live and os.environ.get('HXZ_ENABLE_LIVE') != '1':
                raise ValueError('live research is disabled')
        db = Path(args.db).resolve()
        root = Path(args.artifacts).resolve()
        db.parent.mkdir(parents=True, exist_ok=True)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        store = FullStore(db, artifact_root=root)
        if args.mode == 'api':
            server = ThreadingHTTPServer((args.host, args.port), make_handler(store, tokens, allow_live=args.allow_live))
            print(json.dumps({'listen_port': server.server_port, 'version': 'full-v1'}), flush=True)
            try:
                server.serve_forever()
            finally:
                server.server_close()
            return 0
        from .full_provider import FullLiveProvider, FullSyntheticProvider
        from .full_worker import run_once
        provider = FullSyntheticProvider() if args.provider == 'synthetic' else FullLiveProvider.from_env()
        deadline = time.monotonic() + args.run_limit if args.run_limit is not None else float('inf')
        while True:
            if args.until_id:
                report = store.get(args.tenant, args.until_id)
                if report is None:
                    raise ValueError('unknown report')
                if report['status'] in ('completed', 'failed'):
                    print(json.dumps({'id': report['id'], 'status': report['status'], 'code': report['failure_code']}), flush=True)
                    return 0 if report['status'] == 'completed' else 1
            if time.monotonic() >= deadline:
                print(json.dumps({'status': 'run_limit', 'note': 'durable work remains resumable'}), flush=True)
                return 2
            result = run_once(store, provider, ttl=args.ttl, timeout=min(args.timeout, max(.001, deadline-time.monotonic())), synthetic=args.provider == 'synthetic')
            if result:
                print(json.dumps(result, ensure_ascii=False), flush=True)
            if args.once:
                return 1 if result and result['status'] == 'failed' else 0
            if result is None:
                time.sleep(min(args.poll, max(0, deadline-time.monotonic())))
    except KeyboardInterrupt:
        return 130
    except Exception:
        # No traceback or credential-containing exception in public CLI output.
        print('full report service failed: configuration or storage unavailable', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
