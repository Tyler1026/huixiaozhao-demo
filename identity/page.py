"""Reuse the legacy login function only, never serve its credential-bearing program."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def page():
    source = (ROOT / 'index.html').read_text()
    start = source.index('function loginPage(){')
    end = source.index('\nfunction gotoRegister()', start)
    login = source[start:end]
    # Explicit anchors: fail closed if the original layout changes.
    registration = "        '<button onclick=\"gotoRegister()\""
    a = login.index(registration)
    b = login.index('\n', a)
    login = login[:a] + login[b:]
    a = login.index("      '<div style=\"margin-top:20px;padding-top:16px;")
    b = login.index("    '</div></div>';", a)
    login = login[:a] + login[b:]
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>慧小招 · 组织隔离测试</title><body><main id="root"></main>'
            '<script>' + login + '</script>'
            '<script src="/identity/client.js"></script>'
            '<script src="/identity/tenant-page.js"></script></body></html>').encode()
