FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir psycopg2-binary esprima pdfplumber python-docx

# Railway 会注入 $PORT；本地默认 5050
COPY server.py index.html ops.html ./
COPY scripts/check_inline_js.py ./scripts/check_inline_js.py

# 语法门禁：ops.html/index.html 内联<script>语法错误直接fail build，
# 防止2026-08-07那次白屏事故（重复粘贴+误插入闭合标签）再次上线。
RUN python3 scripts/check_inline_js.py ops.html index.html

ENV PORT=5050
EXPOSE 5050

CMD ["python", "server.py"]
