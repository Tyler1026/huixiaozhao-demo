FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir psycopg2-binary

# Railway 会注入 $PORT；本地默认 5050
COPY server.py index.html ops.html deepseek_key.txt ./

ENV PORT=5050
EXPOSE 5050

CMD ["python", "server.py"]
