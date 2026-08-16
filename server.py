#!/usr/bin/env python3
"""
慧小招 KB Chat Server — localhost:5050
- GET  /            → 返回 HTML demo 文件
- GET  /health      → 健康检查
- POST /api/kb-chat → RAG 问答，流式调用 DeepSeek API
"""
import json, os, urllib.request, urllib.error, time, datetime
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler
try:
    import psycopg2
    _PG_AVAIL = True
except ImportError:
    _PG_AVAIL = False

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
SYNC_PATH    = os.environ.get("SYNC_PATH", "/tmp/sync_data.json")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

def _db_conn():
    return psycopg2.connect(DATABASE_URL)

def _init_db():
    if not (_PG_AVAIL and DATABASE_URL):
        print("[db] 未配置 DATABASE_URL，使用文件存储降级模式")
        return
    try:
        conn = _db_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_data (
                id INTEGER PRIMARY KEY DEFAULT 1,
                data TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP DEFAULT NOW(),
                CHECK (id = 1)
            )
        """)
        conn.commit(); cur.close(); conn.close()
        print("[db] PostgreSQL sync_data 表就绪")
    except Exception as e:
        print(f"[db] 初始化失败: {e}")

def _db_get():
    try:
        conn = _db_conn(); cur = conn.cursor()
        cur.execute("SELECT data FROM sync_data WHERE id=1")
        row = cur.fetchone(); cur.close(); conn.close()
        return row[0] if row else '{}'
    except Exception as e:
        print(f"[db] 读取失败: {e}"); return None

def _db_set(data_str):
    try:
        conn = _db_conn(); cur = conn.cursor()
        cur.execute(
            "INSERT INTO sync_data(id,data,updated_at) VALUES(1,%s,NOW()) "
            "ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()",
            (data_str,))
        conn.commit(); cur.close(); conn.close(); return True
    except Exception as e:
        print(f"[db] 写入失败: {e}"); return False
_BASE       = os.path.dirname(os.path.abspath(__file__))
HTML_GOV    = os.path.join(_BASE, "index.html")
HTML_OPS    = os.path.join(_BASE, "ops.html")
DS_URL      = "https://api.deepseek.com/v1/chat/completions"
# 直连 DeepSeek，绕过系统代理(Clash 7897)——否则请求会挂死
DS_OPENER   = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def _load_ds_key():
    # 优先精确匹配环境变量；找不到则容错扫描（变量名含空格/DEEPSEEK/DS_KEY 都能兜住）
    v = os.environ.get("DEEPSEEK_API_KEY", "")
    if not v.strip():
        for k, val in os.environ.items():
            ku = k.strip().upper().replace(" ", "").replace("-", "_")
            if ku in ("DEEPSEEK_API_KEY", "DEEPSEEKAPIKEY", "DS_KEY", "DEEPSEEK_KEY") or "DEEPSEEK" in ku:
                if val and val.strip():
                    v = val; break
    # 最终兜底：从同目录 deepseek_key.txt 读取（不依赖 Railway 环境变量）
    if not v.strip():
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "deepseek_key.txt"), encoding="utf-8") as f:
                v = f.read()
        except Exception:
            pass
    v = v.strip().strip('"').strip("'").strip()
    if v and not v.startswith("sk-"):
        import re as _re
        m = _re.search(r"sk-[A-Za-z0-9_\-]{10,}", v)
        if m: v = m.group(0)
    return v
DS_KEY      = _load_ds_key()
MODEL       = "deepseek-v4-pro"
MAX_TOKENS_DRAFT = 800
MAX_TOKENS_FULL  = 5000
MAX_TOKENS_CHAT  = 400
# research 模式需返回结构化 JSON（对标企业3~5家+数量+来源），且 v4-pro 默认 thinking
# 会消耗 token，故单独放大并预留思考空间
MAX_TOKENS_RESEARCH = 6000
# 整链研判：一次返回整条链所有环节（6~8个），需更大 token 预算
MAX_TOKENS_CHAIN = 12000
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

SYSTEM_SUGGEST = """你是慧小招城市智库的AI助手。根据提供的某个城市的智库数据，站在当地招商干部视角，生成他们此刻最该问、最有价值的建议问题。

要求：
- 只输出 4 个问题，每行一个，不加序号、不加符号、不加任何解释。
- 每个问题必须紧扣该城市的真实产业/园区/链主/政策特征，带上城市名或该城市的具体产业名，禁止泛泛而谈。
- 问题要具体、可回答、对招商决策有用（围绕补链缺口、承接方向、园区分工、竞争差异化、招引对象等）。
- 若智库数据不足，也要基于城市名和常识提出该城市可能关心的招商问题，禁止出现其他城市的名字。
- 使用中文，每个问题不超过25字。"""

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
列出需要确认的关键事项（专项资金/园区地块/政策口径）。
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
   查不到来源须标注「（未获公开来源，待核实）」，禁止虚构

## 数字可靠性铁律（违反即为重大错误）
1. 报告里出现的每一个「数字」（产值/规模/企业数量/占比/金额）都必须能追溯到来源，
   来源限：政府公报 / 国家统计局 / 行业协会白皮书 / 上市公司财报·公告 / 权威媒体 / 工商注册数据。
2. 引用数字时在括号内标注来源与年份，如「(随州市统计局·2024)」「(中国食用菌协会·2025)」。
3. 拿不到可靠来源的数字，一律写「待核实」并说明原因，禁止编造、禁止用"大约/约/估计"糊弄一个看似合理的数。
4. 尤其「全国有多少家企业」「本地多少家企业」这类精确计数，除非有权威统计口径，否则必须标「待核实」。
5. 知识片段中已有的数字可直接引用，但也要能对应到片段标注的来源（cite）。"""

SYSTEM_RESEARCH = """你是慧小招产业调研员，负责针对某个产业链「环节」做完整调研：①该环节在本地的强弱判定（优势/培育/缺口）②本地代表企业 ③全国对标企业 ④企业数量与市场规模。

## 输出格式（严格输出 JSON，不要 markdown 代码块、不要任何 JSON 之外的文字）
{
  "segment": "环节名",
  "level": "strong|mid|weak",
  "level_basis": "判定依据（一句话，必须标注来源，如：随州为全球白花菇最大产地，约占全国50%——中国食用菌协会2024）",
  "local_leaders": [
    {"name": "本地代表企业名", "role": "它在本地该环节中的角色", "source": "信息来源"}
  ],
  "benchmarks": [
    {"name": "外地对标企业名", "region": "总部城市", "kind": "主营业务(简短)",
     "match": "为何匹配该环节", "signal": "扩张/迁移信号(无则空)", "source": "信息来源"}
  ],
  "local_count": {"value": "本地企业数或null", "source": "来源或null", "note": "无法给出时的原因"},
  "national_count": {"value": "全国企业数或null", "source": "来源或null", "note": "无法给出时的原因"},
  "market_size": {"value": "市场规模或null", "source": "来源或null", "note": "无法给出时的原因"},
  "confidence": "high|medium|low",
  "caveats": ["需人工核实的事项"]
}

## level 判定标准（必须基于可查证事实，不能拍脑袋）
- strong（优势）：本地已有全国知名龙头/产业集群，或产量/规模居全国前列（须有权威来源佐证）
- mid（培育）：本地已有一定基础，但规模/实力不足，需培育或增强
- weak（缺口）：本地该环节缺失、或严重依赖外购（须有"缺失/外购"的可查证事实）

## 铁律（违反即为重大错误）
1. level 判定必须有 level_basis 依据 + 来源；拿不准就判 mid 并在 caveats 标"待核实"。
2. 每一个数字（企业数量/市场规模）都必须有可靠来源；拿不到就 value=null + note"无权威公开口径，待核实"，禁止编造、禁止给一个看似合理的估算值。
3. local_leaders 只列本地（该城市/下辖区县）真实存在的企业；查不到本地企业就返回空数组 []，禁止拿外地企业冒充。
4. benchmarks 只列外地（非本地）真实对标企业，每家有 source；查不到就不列。
5. 企业必须真实存在，禁止虚构企业名；宁可少列，不可编造。"""

SYSTEM_RESEARCH_CHAIN = """你是慧小招产业调研员，负责对某城市一条完整产业链的「所有环节」一次性做研判。每个环节都要给出：强弱判定（优势/培育/缺口）+ 判定依据 + 本地代表企业 + 外地对标企业。

## 输出格式（严格输出 JSON，不要 markdown 代码块、不要任何 JSON 之外的文字）
{
  "chain": "产业链名",
  "segments": [
    {
      "name": "环节名",
      "level": "strong|mid|weak",
      "level_basis": "判定依据（一句话，必须标注来源与年份）",
      "local_leaders": [{"name": "本地代表企业名", "role": "角色", "source": "来源"}],
      "benchmarks": [{"name": "外地对标企业名", "region": "总部城市", "kind": "主营业务",
                      "match": "为何匹配", "signal": "扩张/迁移信号(无则空)", "source": "来源"}],
      "local_count": {"value": "本地企业数或null", "source": "来源或null"},
      "national_count": {"value": "全国企业数或null", "source": "来源或null"}
    }
  ],
  "confidence": "high|medium|low",
  "caveats": ["需人工核实的事项"]
}

## level 判定标准（必须基于可查证事实，不能拍脑袋）
- strong（优势）：本地已有全国知名龙头/产业集群，或产量/规模居全国前列（须有权威来源佐证）
- mid（培育）：本地已有一定基础，但规模/实力不足，需培育或增强
- weak（缺口）：本地该环节缺失、或严重依赖外购（须有"缺失/外购"的可查证事实）

## 铁律（违反即为重大错误）
1. 每个环节的 level 判定必须有 level_basis 依据 + 来源；拿不准就判 mid 并在 caveats 标"待核实"。
2. 每一个数字（企业数量 local_count/national_count）都必须有可查证的权威来源；拿不到就 value=null 且 source=null，禁止编造、禁止给一个看似合理的估算值。
3. local_leaders：列出你「确定真实存在」的本地（该城市/下辖区县）企业，优先列知名龙头/上市公司/出口企业/行业标杆，source 写「公开工商信息」即可。企业是否真实存在以你的可靠知识为准，不要因为"无法实时联网核实"就空着——只有该环节确实没有已知本地企业时才返回 []。禁止拿外地企业冒充本地企业。
4. benchmarks：只列外地（非本地）真实对标企业，优先列上市公司/细分龙头，每家有 source（公开资料即可）；确实没有就不列。
5. 企业名必须真实存在、用规范全称（如「湖北裕国菇业股份有限公司」「品源（随州）现代农业发展有限公司」），禁止虚构企业名。
6. 环节名必须与用户给出的环节清单完全一致，一个不少，不要增删改。"""


SYSTEM_TOPICS = """你是慧小招产业招商策略师。根据某城市的调研报告（知识片段），归纳出该城市当前最值得推进的 3-5 个「产业招商分析方向」。方向要具体、可招商落地，通常是「补链缺口」「精深加工升级」「承接转移」这类可执行主题，而不是宽泛的产业名。

## 输出格式（严格输出 JSON，不要 markdown 代码块、不要 JSON 之外的任何文字）
{
  "topics": [
    {
      "label": "方向名称（8-16字，具体可招商，如「氢能专用车核心零部件补链」）",
      "icon": "一个贴切的emoji",
      "type": "补链|精深加工|承接转移|培育",
      "desc": "一句话依据（≤24字，必须来自知识片段的事实，如「电堆占成本53%全外购」）"
    }
  ]
}

## 铁律
1. 每个方向的 label 和 desc 必须能在知识片段里找到事实支撑；片段没提到的产业，不要凭空造方向。
2. desc 优先引用知识片段里的具体数字/事实（占比、产值、企业数、缺口环节），不要空话套话。
3. 输出 3-5 个方向，按招商价值/紧迫性从高到低排序（缺口大、拉动强的排前面）。
4. 只输出该城市真实相关的方向；宁可少，不可为凑数编造。
5. icon 用单个 emoji；type 从给定四类里选最贴切的。"""


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
        # 云端数据同步：GET /api/sync 读取
        if path == '/api/sync':
            if _PG_AVAIL and DATABASE_URL:
                result = _db_get()
                data = (result or '{}').encode()
            else:
                try:
                    with open(SYNC_PATH, encoding='utf-8') as f:
                        data = f.read().encode()
                except FileNotFoundError:
                    data = b'{}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.cors(); self.end_headers(); self.wfile.write(data)
            return
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
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length)
        # 云端数据同步：POST /api/sync 合并保存（保护字段不被空值覆盖）
        if self.path == '/api/sync':
            data_str = raw.decode('utf-8')
            try:
                incoming = json.loads(data_str)
                if _PG_AVAIL and DATABASE_URL:
                    existing = json.loads(_db_get() or '{}')
                else:
                    try:
                        with open(SYNC_PATH, 'r', encoding='utf-8') as f2:
                            existing = json.loads(f2.read())
                    except Exception:
                        existing = {}
                # 合并：空列表/空字典不覆盖已有非空数据
                _protected = ['OPS_ENT','DEMANDS','KB_CHAT','PENDING_CONFIRMS','KB_CONFIRMS']
                for k, v in incoming.items():
                    if k in _protected and not v and existing.get(k):
                        continue
                    existing[k] = v
                data_str = json.dumps(existing, ensure_ascii=False)
            except Exception as e:
                print(f"[sync] merge error: {e}")
            if _PG_AVAIL and DATABASE_URL:
                ok = _db_set(data_str)
                resp = json.dumps({'ok': ok}).encode()
            else:
                try:
                    with open(SYNC_PATH, 'w', encoding='utf-8') as f:
                        f.write(data_str)
                    resp = json.dumps({'ok': True}).encode()
                except Exception as e:
                    resp = json.dumps({'ok': False, 'error': str(e)}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self.cors(); self.end_headers(); self.wfile.write(resp)
            return
        if self.path != '/api/kb-chat':
            self.send_error(404); return

        body   = json.loads(raw)
        q      = body.get("question", "").strip()
        chunks = body.get("chunks", [])
        city   = body.get("city", "")
        stream = body.get("stream", True)
        mode   = body.get("mode", "full")
        history = body.get("history", [])  # 多轮上下文：[{role:'user'|'assistant', content:'...'}]

        if mode not in ("chat", "draft", "full", "suggest", "research", "chain", "topics"):
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

        if mode == "suggest":
            system_prompt = SYSTEM_SUGGEST
            max_tokens    = 200
        elif mode == "chat":
            system_prompt = SYSTEM_CHAT
            max_tokens    = MAX_TOKENS_CHAT
        elif mode == "draft":
            system_prompt = SYSTEM_DRAFT
            max_tokens    = MAX_TOKENS_DRAFT
        elif mode == "research":
            system_prompt = SYSTEM_RESEARCH
            max_tokens    = MAX_TOKENS_RESEARCH
        elif mode == "chain":
            system_prompt = SYSTEM_RESEARCH_CHAIN
            max_tokens    = MAX_TOKENS_CHAIN
        elif mode == "topics":
            system_prompt = SYSTEM_TOPICS
            max_tokens    = 1200
        else:
            system_prompt = SYSTEM_FULL
            max_tokens    = MAX_TOKENS_FULL

        # 多轮上下文：注入最近几轮对话（仅保留合法 role + 非空文本，限制条数防止 context 膨胀）
        hist_msgs = []
        for h in (history or [])[-8:]:
            role = h.get("role", "")
            content = (h.get("content", "") or "").strip()
            if role in ("user", "assistant") and content:
                hist_msgs.append({"role": role, "content": content[:1500]})

        payload_dict = {
            "model": MODEL,
            "max_tokens": max_tokens,
            "stream": stream,
            "messages": [
                {"role": "system", "content": system_prompt},
                *hist_msgs,
                {"role": "user",   "content": f"城市：{city}\n\n知识片段：\n{ctx}\n\n问题：{q}"}
            ]
        }
        # v4-pro 默认开启 thinking，CoT 会吃光 max_tokens 导致 content 为空。
        # 除 chat/suggest 外全部关闭 thinking（报告/研判要的是结构化产出，不需深度推理链）。
        if mode in ("research", "chain", "full", "draft", "topics"):
            payload_dict["thinking"] = {"type": "disabled"}
        payload = json.dumps(payload_dict).encode()

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
    _init_db()
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
