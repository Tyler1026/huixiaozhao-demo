#!/usr/bin/env python3
"""
慧小招 KB Chat Server — localhost:5050
- GET  /            → 返回 HTML demo 文件
- GET  /health      → 健康检查
- POST /api/kb-chat → RAG 问答，流式调用 DeepSeek API
"""
import json, os, urllib.request, urllib.error, time, datetime
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler

LOG_PATH    = os.path.expanduser("~/.violoop/services/kb-server/rag-audit.log")

def _is_upload_chunk(c):
    """判断一个知识片段是否来自用户上传的文件。"""
    cid  = str(c.get("id", ""))
    cite = str(c.get("cite", ""))
    tags = c.get("tags", []) or []
    if cid.startswith("file:"):
        return True
    if any(t in ("上传", "材料") for t in tags):
        return True
    # cite 带常见文件扩展名 → 视为上传文件
    if any(cite.lower().endswith(ext) for ext in
           (".txt", ".md", ".csv", ".json", ".pdf", ".doc", ".docx", ".xls", ".xlsx")):
        return True
    return False

def audit_log(entry):
    """把一条 RAG 调用审计记录追加进 JSONL 日志，并打印人类可读摘要。"""
    entry["ts"] = datetime.datetime.now().isoformat(timespec="seconds")
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[audit] write failed: {e}")
    up = entry.get("upload_chunks", 0)
    tot = entry.get("total_chunks", 0)
    print(f"[audit] {entry['ts']} city={entry.get('city','')} mode={entry.get('mode','')} "
          f"chunks={tot} (上传={up}) q=\"{entry.get('question','')[:40]}\"")
    if entry.get("upload_samples"):
        for s in entry["upload_samples"]:
            print(f"[audit]   📎 来自上传《{s['cite']}》: {s['text'][:60]}")

# HTML 与 server.py 同目录（云端部署打包在一起）
_BASE       = os.path.dirname(os.path.abspath(__file__))
HTML_GOV    = os.path.join(_BASE, "index.html")
HTML_OPS    = os.path.join(_BASE, "ops.html")
DS_URL      = "https://api.deepseek.com/v1/chat/completions"
# 直连 DeepSeek，绕过系统代理(Clash 7897)——否则请求会挂死
DS_OPENER   = urllib.request.build_opener(urllib.request.ProxyHandler({}))
DS_KEY      = os.environ.get("DEEPSEEK_API_KEY", "").strip().strip('"').strip("'").strip()
MODEL       = "deepseek-chat"
MAX_TOKENS_DRAFT = 800
MAX_TOKENS_FULL  = 3000
MAX_TOKENS_CHAT  = 400
# 云端：单端口读 $PORT（Railway 注入）；本地默认 5050。政府端/管理端同端口，ops 走 /ops 路由
PORT_GOV    = int(os.environ.get("PORT", "5050"))
PORT_OPS    = 5051

SYSTEM_DRAFT = """你是慧小招AI招商助手，负责在10秒内完成快速初步分析。
基于提供的城市智库数据，输出以下结构化内容（务必简洁、结构清晰）：

①待确认事项清单
②初步判断的3个研判方向（含方向类型：补链/承接转移/精深加工/协同枢纽）
③每个方向的核心缺口（1-2句）
④数据可靠性评估

要求：引用具体数字支撑判断；无数据支撑的判断用⚠️标注；使用中文，语言精炼，整体控制在300字以内。"""

SYSTEM_CHAT = """你是慧小招城市智库的AI问答助手，在招商问答对话框中与政府干部自然对话。

要求：
- 像聊天一样简短直接地回答，控制在150字以内。
- 只回答用户当前问的这一个问题，不要输出报告结构、不要分章节、不要生成表格。
- 优先引用提供的城市智库数据与用户上传材料中的具体数字。
- 无数据支撑的判断用⚠️标注。
- 如果用户只是补充/更新了一条数据，简短确认已收到并说明它对研判的意义即可，不要展开长篇分析。
- 使用中文，口语化、精炼。"""

SYSTEM_FULL = """你是慧小招产业链研判师，结合城市智库数据完成完整的招商研判报告。

## 报告结构（严格按此输出）

### 一、产业基础判断
基于知识片段，描述城市产业现状（产值/规模/配套率等具体数字）。

### 二、产业链缺口分析（核心）
对每个研判方向，逐环节标注状态：
- ✅ 已有：[企业名] 承担 [环节]，规模/能力说明
- ⚠️ 薄弱：[环节]，现状说明，不足在哪
- ❌ 缺失：[环节]，占整体成本/价值XX%，全部外购自[地区/企业]

对缺失/薄弱环节标注本地化属性：
A=必须本地化（依赖原料/链主/物流）
B=可跨区域（技术密集型）
C=优先本地化（有协同但不硬依赖）

### 三、补链优先级清单（TOP 5）
| 排名 | 缺口节点 | 本地化属性 | 经济拉动★ | 招引可行性★ | 综合优先级 |

### 四、目标企业画像（每个优先缺口）
对每个TOP缺口描述：
- 目标企业类型（规模/技术路线/上市/非上市）
- 核心诉求（为什么要来这里）
- 开口话术：「[城市]的[不可复制资产]正是您最需要的[企业具体需求]，落地即能锁定[链主名]的[XX亿]采购订单。」

### 五、待确认事项
列出需要领导确认的关键事项（专项资金/园区地块/政策口径）。
⚠️ 标注每条待确认项。

要求：引用具体数字支撑每个判断；企业名和数据来自知识片段；无数据支撑的判断用⚠️标注。

## 企业推荐严格标准（必须同时满足）
1. 补链匹配：企业产品直接填补报告中标注的❌缺失环节
2. 扩张信号（必须有其中一项可查证信号）：
   - 新建/扩建工厂的公开公告或政府签约
   - 在目标区域的招聘岗位或调研记录
   - 融资公告明确注明产能扩张用途
   - 与当地政府/园区签署合作备忘录
   ⚠️ 仅因企业优秀/行业领先但无扩张信号，禁止列入候选
3. 信号来源：每条必须标注（公告编号/媒体名称/日期）；
   查不到来源须标注「（未获公开来源，待核实）」，禁止虚构"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[kb] {self.address_string()} {fmt % args}")

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200); self.cors(); self.end_headers()

    def do_GET(self):
        # /ops 和 /ops.html 路径在两个端口都服务管理端
        # 5051 访问 / 也直接服务管理端（和 5050/ops 共享 origin→不行，但5050/ops 共享 origin 可以）
        path = self.path.split('?')[0]
        port = self.server.server_address[1]
        if path in ("/", "/index.html"):
            # 本地 5051 端口访问 / → 重定向到同 origin 的 /ops（云端单端口不触发）
            if port == PORT_OPS:
                self.send_response(302)
                self.send_header("Location", "/ops")
                self.cors(); self.end_headers(); return
            html_path = HTML_GOV
        elif path in ("/ops", "/ops.html"):
            html_path = HTML_OPS  # 从 5050/ops 提供，共享 origin
        elif path == "/rag-log":
            # RAG 审计日志：JSON（?format=json）或纯文本（默认）
            fmt = "json" if "format=json" in (self.path.split("?")[1] if "?" in self.path else "") else "text"
            try:
                lines = open(LOG_PATH, encoding="utf-8").read().splitlines()
            except FileNotFoundError:
                lines = []
            recs = [json.loads(l) for l in lines if l.strip()]
            if fmt == "json":
                out = json.dumps(recs, ensure_ascii=False, indent=2).encode()
                ctype = "application/json; charset=utf-8"
            else:
                rows = []
                tot_up = sum(r.get("upload_chunks", 0) for r in recs)
                rows.append(f"慧小招 RAG 审计日志 — 共 {len(recs)} 次 AI 分析调用，累计吃进上传片段 {tot_up} 个")
                rows.append("=" * 72)
                for r in recs:
                    rows.append(f"[{r.get('ts','')}] 城市={r.get('city','')} 模式={r.get('mode','')}")
                    rows.append(f"  问题: {r.get('question','')}")
                    rows.append(f"  数据块: 共{r.get('total_chunks',0)} 个 "
                                f"(智库{r.get('kb_chunks',0)} + 上传{r.get('upload_chunks',0)})")
                    rows.append(f"  来源: {'、'.join(r.get('all_cites',[]))}")
                    for s in r.get("upload_samples", []):
                        rows.append(f"    📎 来自上传《{s.get('cite','')}》: {s.get('text','')[:80]}")
                    rows.append("-" * 72)
                out = ("\n".join(rows) + "\n").encode()
                ctype = "text/plain; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(out)))
            self.cors(); self.end_headers(); self.wfile.write(out)
            return
        else:
            if path == "/health":
                pass  # handled below
            else:
                self.send_error(404); return
        if path not in ("/health",):
            try:
                data = open(html_path, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.cors(); self.end_headers(); self.wfile.write(data)
            except FileNotFoundError:
                self.send_error(404, "HTML not found")
        elif self.path == "/health":
            port = self.server.server_address[1]
            role = "ops" if port == PORT_OPS else "gov"
            body = json.dumps({"ok": True, "model": MODEL, "key": bool(DS_KEY),
                               "key_len": len(DS_KEY),
                               "key_prefix": (DS_KEY[:5]+"…"+DS_KEY[-3:]) if DS_KEY else "",
                               "role": role, "port": port}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.cors(); self.end_headers(); self.wfile.write(body)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/api/kb-chat":
            self.send_error(404); return

        body   = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        q      = body.get("question", "").strip()
        chunks = body.get("chunks", [])
        city   = body.get("city", "")
        stream = body.get("stream", True)
        mode   = body.get("mode", "full")

        if mode not in ("chat", "draft", "full"):
            mode = "full"

        if not q:
            self.send_error(400, "question required"); return

        # 拼 RAG context
        used = chunks[:6]
        ctx = "\n\n".join(
            f"[{c.get('cite','')}·{c.get('topic','')}]\n{c.get('text','')}"
            for c in used
        ) or "暂无检索到相关内容，请基于通用招商知识回答。"

        # —— RAG 审计日志：证明本次分析实际吃进了哪些数据、其中多少来自用户上传 ——
        upload_used = [c for c in used if _is_upload_chunk(c)]
        audit_log({
            "city": city,
            "mode": mode,
            "question": q,
            "total_chunks": len(used),
            "upload_chunks": len(upload_used),
            "kb_chunks": len(used) - len(upload_used),
            "all_cites": [c.get("cite", "") for c in used],
            "upload_samples": [
                {"cite": c.get("cite", ""), "id": c.get("id", ""),
                 "text": c.get("text", "")[:120]}
                for c in upload_used
            ],
        })

        if mode == "chat":
            system_prompt = SYSTEM_CHAT
            max_tokens    = MAX_TOKENS_CHAT
        elif mode == "draft":
            system_prompt = SYSTEM_DRAFT
            max_tokens    = MAX_TOKENS_DRAFT
        else:
            system_prompt = SYSTEM_FULL
            max_tokens    = MAX_TOKENS_FULL

        payload = json.dumps({
            "model": MODEL,
            "max_tokens": max_tokens,
            "stream": stream,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"城市：{city}\n\n知识片段：\n{ctx}\n\n问题：{q}"}
            ]
        }).encode()

        req = urllib.request.Request(
            DS_URL, data=payload, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {DS_KEY}"}
        )

        try:
            with DS_OPENER.open(req, timeout=60) as resp:
                if stream:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.cors(); self.end_headers()
                    while True:
                        line = resp.readline()
                        if not line: break
                        self.wfile.write(line); self.wfile.flush()
                else:
                    data = resp.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.cors(); self.end_headers(); self.wfile.write(data)

        except urllib.error.HTTPError as e:
            err = e.read().decode(errors="replace")
            print(f"[kb] upstream {e.code}: {err[:200]}")
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.cors(); self.end_headers()
            self.wfile.write(json.dumps({"error": err[:400]}).encode())
        except Exception as e:
            print(f"[kb] error: {e}")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.cors(); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())


if __name__ == "__main__":
    if not DS_KEY:
        print("[kb] WARN: DEEPSEEK_API_KEY 未设置 — 页面可访问，但 AI 问答/报告会报错。请在 Railway Variables 里配置 DEEPSEEK_API_KEY。")
    import threading

    # 云端(Railway)：单端口，绑 0.0.0.0；政府端=/，管理端=/ops（同一端口路由）
    IS_CLOUD = bool(os.environ.get("PORT"))
    HOST = "0.0.0.0" if IS_CLOUD else "127.0.0.1"

    if not IS_CLOUD:
        # 本地开发：额外起 5051 兼容旧用法
        ops_server = ThreadingHTTPServer((HOST, PORT_OPS), Handler)
        threading.Thread(target=ops_server.serve_forever, daemon=True).start()
        print(f"[kb] 管理端(本地) http://localhost:{PORT_OPS}  (ops)")

    print(f"[kb] 服务启动 http://{HOST}:{PORT_GOV}  政府端=/  管理端=/ops")
    gov_server = ThreadingHTTPServer((HOST, PORT_GOV), Handler)
    gov_server.serve_forever()
