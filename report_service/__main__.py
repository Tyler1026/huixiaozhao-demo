"""CLI entry point: ``python -m report_service {api|worker}``.

Subcommands share ``--db ABS_PATH --host --port``; ``worker`` additionally
requires ``--provider {synthetic|live}`` (or ``module:func`` for tests/pilots)
and supports ``--once``.
"""

from __future__ import annotations

import argparse
import sys

from .store import Store


def _parse(argv):
    parser = argparse.ArgumentParser(prog="report_service", description="Standalone report service pilot")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--db", required=True, help="absolute path to SQLite file")
    common.add_argument("--host", default="127.0.0.1")
    common.add_argument("--port", type=int, default=8797)

    api = sub.add_parser("api", parents=[common], help="run the HTTP API server")
    api.set_defaults(func=_run_api)

    worker = sub.add_parser("worker", parents=[common], help="run the report worker")
    worker.add_argument("--provider", required=True, help="synthetic | live | module:func")
    worker.add_argument("--once", action="store_true", help="process a single job then exit")
    worker.add_argument("--ttl", type=float, default=120.0, help="lease TTL in seconds")
    worker.add_argument("--poll", type=float, default=1.0, help="poll interval when idle")
    worker.set_defaults(func=_run_worker)

    return parser.parse_args(argv)


def _run_api(args):
    from . import api as api_module

    store = Store(args.db)
    token_map = api_module.config_from_env()
    print(f"report_service api listening on {args.host}:{args.port} db={args.db}", flush=True)
    api_module.serve(store, args.host, args.port, token_map=token_map)


def _run_worker(args):
    from .worker import load_provider, run_loop

    store = Store(args.db)
    provider = load_provider(args.provider)
    summary = run_loop(store, provider, ttl=args.ttl, once=args.once, poll_interval=args.poll)
    if summary is not None:
        print(f"worker result: {summary}", flush=True)
        return 0 if summary['status'] == 'completed' else 1
    return 0


def main(argv=None):
    args = _parse(sys.argv[1:] if argv is None else argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
