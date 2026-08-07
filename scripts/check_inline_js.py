#!/usr/bin/env python3
"""
校验 ops.html / index.html 内联<script>语法。
Docker构建阶段调用：语法错误直接 fail build，Railway 不会把坏代码部署上线。
2026-08-07 添加（ops.html 白屏事故后）。
"""
import re
import sys

try:
    import esprima
except ImportError:
    print("esprima not installed, run: pip install esprima")
    sys.exit(1)


def check_file(path):
    try:
        html = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"[check] {path}: 文件不存在，跳过")
        return True

    # 只取没有 src= 的内联 <script>...</script> 块（跳过外部CDN引入）
    blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    if not blocks:
        print(f"[check] {path}: 未找到内联<script>块，跳过")
        return True

    if len(blocks) > 2:
        print(
            f"[check] FAIL {path}: 检测到 {len(blocks)} 个内联<script>块，"
            f"超过预期(<=2)，可能存在重复粘贴/误插入闭合标签"
        )
        return False

    ok = True
    for i, js in enumerate(blocks):
        try:
            esprima.parseScript(js)
        except Exception as e:
            print(f"[check] FAIL {path}: 第 {i + 1} 个<script>块语法错误: {e}")
            ok = False
    if ok:
        print(f"[check] OK {path}: {len(blocks)} 个内联<script>块语法均合法")
    return ok


if __name__ == "__main__":
    targets = sys.argv[1:] or ["ops.html", "index.html"]
    results = [check_file(t) for t in targets]
    sys.exit(0 if all(results) else 1)
