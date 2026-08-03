FROM python:3.12-slim

WORKDIR /app

# 仅需标准库，无第三方依赖
COPY server.py index.html ops.html ./

# Railway 会注入 $PORT；本地默认 5050
ENV PORT=5050
EXPOSE 5050

CMD ["python", "server.py"]
