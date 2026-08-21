#!/usr/bin/env python3
"""
慧小招 KB Chat Server — localhost:5050
- GET  /            → 返回 HTML demo 文件
- GET  /health      → 健康检查
- POST /api/kb-chat → RAG 问答，流式调用 DeepSeek API
"""
import json, os, urllib.request, urllib.error, time, datetime, hashlib
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler
try:
    import psycopg2
    _PG_AVAIL = True
except ImportError:
    _PG_AVAIL = False

LOG_PATH    = os.path.expanduser("~/.violoop/services/kb-server/rag-audit.log")

def _chunk_text(c):
    """从 chunk 提取纯文本，兼容字符串 / 结构化对象。"""
    if isinstance(c, str):
        return c
    if isinstance(c, dict):
        return str(c.get("text", "") or "")
    return ""

import re as _re
_STOP = set("的了和与及在是有为对以及等就都也很更最这那你我他她它们个之其而或且被把从向到于对由于关于以为")
def _tokenize(s):
    """中英文混合粗分词：英文按词，中文按 2-gram + 单字，去停用词/短词。"""
    s = (s or "").lower()
    toks = set()
    # 英文/数字词
    for w in _re.findall(r"[a-z0-9]+", s):
        if len(w) >= 2:
            toks.add(w)
    # 中文串
    for seg in _re.findall(r"[\u4e00-\u9fff]+", s):
        for ch in seg:
            if ch not in _STOP:
                toks.add(ch)
        for i in range(len(seg) - 1):
            bg = seg[i:i+2]
            if bg[0] not in _STOP or bg[1] not in _STOP:
                toks.add(bg)
    return toks

def _retrieve_chunks(question, chunks, top_k=8, min_score=1):
    """按问题与 chunk 文本的词重合度打分，返回 TopK 真实命中（不足则少返，无命中返空）。
    - 上传/标注材料给予权重加成（origin=admin/user 更权威，应优先吃进）。
    返回: (selected_chunks, scored_debug)"""
    q_toks = _tokenize(question)
    if not q_toks or not chunks:
        # 无法打分（空问题）时退回原顺序前 top_k，保持可用
        return list(chunks)[:top_k], []
    scored = []
    for c in chunks:
        txt = _chunk_text(c)
        c_toks = _tokenize(txt)
        if not c_toks:
            continue
        overlap = q_toks & c_toks
        score = len(overlap)
        # 上传/标注材料加成：命中即 +2，鼓励优先采纳用户提供的证据
        if score > 0 and _is_upload_chunk(c):
            score += 2
        if score >= min_score:
            scored.append((score, c))
    # 按分数降序，稳定保留原相对顺序
    scored.sort(key=lambda x: x[0], reverse=True)
    selected = [c for _s, c in scored[:top_k]]
    return selected, scored[:top_k]

def _is_upload_chunk(c):
    """判断一个知识片段是否来自用户上传/标注（非 AI 采集）。"""
    if not isinstance(c, dict):
        return False
    # 结构化 chunk：origin 为 admin/user 即非 AI 采集
    if c.get("origin") in ("admin", "user"):
        return True
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
    """把一条 RAG 调用审计记录写入：①本地 JSONL 文件 ②云端 DB(RAG_AUDIT数组，跨会话可查)。"""
    entry["ts"] = datetime.datetime.now().isoformat(timespec="seconds")
    entry["tsMs"] = int(datetime.datetime.now().timestamp() * 1000)
    # ① 本地文件（开发环境）
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[audit] file write failed: {e}")
    # ② 云端 DB 持久化：存进同一 store 的 RAG_AUDIT 数组（最近 200 条）
    try:
        if _PG_AVAIL and DATABASE_URL:
            store = json.loads(_db_get() or '{}')
            arr = store.get("RAG_AUDIT") or []
            arr.append(entry)
            store["RAG_AUDIT"] = arr[-200:]
            _db_set(json.dumps(store, ensure_ascii=False))
    except Exception as e:
        print(f"[audit] db write failed: {e}")
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

def _keep_nonempty(existing_val, incoming_val):
    """入参为空（None/空串/空 list/dict）时不覆盖已有非空值——防止旧快照把刚同步的数据冲掉。"""
    if incoming_val is None:
        return existing_val
    if isinstance(incoming_val, (list, dict, str)) and len(incoming_val) == 0:
        return existing_val
    return incoming_val

def _kb_material_count(kb):
    """统计一个 project.kb 的累计材料条数（4 主题 known[] 之和）。"""
    if not isinstance(kb, list):
        return 0
    n = 0
    for t in kb:
        if isinstance(t, dict):
            n += len(t.get("known") or [])
    return n

def _merge_map(old, new):
    """按 key 合并 dict-of-dict（PROJECTS / REPORTSTATE / CITY_ACCOUNTS）：
    - 逐字段保留非空值；新增 key 直接并入。
    - kb 字段特判：非空列表也可能是「4 空主题」的占位骨架，按累计材料条数比较，
      材料更多的一方胜出——防止旧快照(0 材料)冲掉刚推送的 RAG。
    - REPORTSTATE 的 text 同理：更长的正文胜出。"""
    merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in (old or {}).items()}
    for k, v in (new or {}).items():
        if not isinstance(v, dict):
            merged[k] = v; continue
        base = merged.get(k)
        if not isinstance(base, dict):
            merged[k] = dict(v); continue
        for fk, fv in v.items():
            if fk == "kb":
                # 材料多的一方胜出（相等时接受新值，允许内容更新）
                if _kb_material_count(fv) >= _kb_material_count(base.get("kb")):
                    base[fk] = fv
                continue
            if fk == "text":
                if len(fv or "") >= len(base.get("text") or ""):
                    base[fk] = fv
                continue
            base[fk] = _keep_nonempty(base.get(fk), fv)
    return merged

_BASE       = os.path.dirname(os.path.abspath(__file__))
HTML_GOV    = os.path.join(_BASE, "index.html")

# ===== AI 分类+摘要 =====
_KB_SUMMARY_CACHE = {}  # key: md5(city+all_raw) -> {topic: [items]}

SYSTEM_KB_CLASSIFY = """你是招商数据分析师。将以下城市的原始调研材料分类整理到4个板块中，每个板块提炼4-6条核心结论。

四个板块定义：
1. 主导产业与产业链：该城市有哪些主导产业、产业规模、产值、增速、全国地位、核心缺口
2. 园区与承载条件：经济总量(GDP)、园区面积/产能/入驻率、土地/人力/物流成本、基建条件
3. 链主与存量企业：具体龙头企业名称、产能、营收、在建项目、配套率、可对接标的
4. 政策、规划与领导关注：政策文件、补贴力度、竞争城市对比、招商方向优劣势

输出格式（严格遵守，不要额外文字）：
[主导产业与产业链]
结论1
结论2
...
[园区与承载条件]
结论1
结论2
...
[链主与存量企业]
结论1
结论2
...
[政策、规划与领导关注]
结论1
结论2
...

要求：
- 每条结论带关键数字（金额/产量/增速/占比），50-80字
- 覆盖材料中的所有产业方向（不要只挑一个产业）
- 严格按内容归类，不要混淆
- 不要加序号、不要加来源、不要加标题前缀"""

def _classify_and_summarize(city, kb_sections, all_cleaned_items):
    """把一个城市的所有cleaned材料汇总，调用DeepSeek一次性分类+概括到四个板块"""
    if not DS_KEY or not all_cleaned_items:
        return None
    raw_text = '\n'.join(all_cleaned_items)
    cache_key = hashlib.md5((city + raw_text).encode()).hexdigest()
    if cache_key in _KB_SUMMARY_CACHE:
        return _KB_SUMMARY_CACHE[cache_key]
    # 如果所有板块内容都已很精简，跳过
    total_items = len(all_cleaned_items)
    if total_items <= 16 and all(len(x) <= 80 for x in all_cleaned_items):
        return None
    # 调用 DeepSeek 一次性分类+概括
    prompt = f"城市：{city}\n\n原始材料共{total_items}条：\n" + raw_text
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_KB_CLASSIFY},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 1500,
        "temperature": 0.3,
        "stream": False,
        "thinking": {"type": "disabled"}
    }).encode()
    req = urllib.request.Request(
        DS_URL, data=payload, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {DS_KEY}"}
    )
    try:
        with DS_OPENER.open(req, timeout=45) as resp:
            result = json.loads(resp.read())
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not content:
            return None
        # 解析分类结果
        classified = {}
        current_topic = None
        topic_map = {
            '主导产业与产业链': '主导产业与产业链',
            '园区与承载条件': '园区与承载条件',
            '链主与存量企业': '链主与存量企业',
            '政策、规划与领导关注': '政策、规划与领导关注',
        }
        for line in content.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
            # 检查是否是板块标题
            for key in topic_map:
                if key in line and '[' in line:
                    current_topic = key
                    break
            else:
                if current_topic and len(line) >= 10:
                    clean_line = line.lstrip('•·-0123456789. ')
                    if len(clean_line) >= 10:
                        classified.setdefault(current_topic, []).append(clean_line)
        if classified:
            _KB_SUMMARY_CACHE[cache_key] = classified
            for t, items in classified.items():
                print(f"[classify] {city}/{t}: {len(items)} items")
            return classified
    except Exception as e:
        print(f"[classify] failed for {city}: {e}")
    return None



def _clean_kb_text(text):
    """清洗 known 条目：删除URL/来源/元信息/系统prompt/章节标题等冗余"""
    if not isinstance(text, str):
        return text
    # 删除所有 URL
    text = _re.sub(r'https?://[^\s\)）,，。]*', '', text)
    # 删除来源标注
    text = _re.sub(r'[\(（]?来源[:：]?\s*[^\)）\n]*[\)）]?', '', text)
    text = _re.sub(r'数据[来源]+[:：][^。；\n]*[。；]?', '', text)
    # 删除日期标注
    text = _re.sub(r'[\(（]\s*\d{4}[-/]\d{2}[-/]\d{2}\s*[\)）]', '', text)
    text = _re.sub(r'[,，]\s*\d{4}[-/]\d{2}[-/]\d{2}', '', text)
    # 删除系统prompt残留
    text = _re.sub(r'编制单位[:：][^。\n]*', '', text)
    text = _re.sub(r'数据基准[:：][^。\n]*', '', text)
    text = _re.sub(r'引用铁律[:：][^。\n]*', '', text)
    text = _re.sub(r'地价只认[^。\n]*[。]?', '', text)
    text = _re.sub(r'政策必标[^。\n]*[。]?', '', text)
    text = _re.sub(r'>\s*[^\n]*', '', text)
    # 删除所有【...】及孤立的】
    text = _re.sub(r'【[^】]*】\s*', '', text)
    text = text.replace('】', '')
    # 删除生成时间/分析对象等元信息
    text = _re.sub(r'生成时间[:：][^。；\n]*[。；]?', '', text)
    text = _re.sub(r'分析对象[:：][^。；\n]*[。；]?', '', text)
    text = _re.sub(r'gov\.cn\s*权威源为主[）\)]?', '', text)
    # 删除文号标注 如 （鄂政发〔2021〕29 号）
    text = _re.sub(r'[\(（][^\)）]*〔\d+〕\d+\s*号[\)）]', '', text)
    # 清理多余空格/标点
    text = _re.sub(r'\s{2,}', ' ', text)
    text = _re.sub(r'[。；，]{2,}', '。', text)
    # 清理 markdown 粗体标记（所有**都删掉）
    text = text.replace('**', '')
    # 清理 URL 路径碎片
    text = _re.sub(r'\S*\.s?html\S*', '', text)
    text = _re.sub(r'\S*/\d{8}/[a-f0-9]+/\S*', '', text)
    text = text.strip(' 。；，')
    return text

def _is_junk_item(text):
    """判断一条 known 是否为无用条目（纯标题/元信息/报告头）应被丢弃"""
    if not text or len(text) < 6:
        return True
    # 纯报告标题类（不含有用数据）
    junk_patterns = [
        r'^[✅⚠️\s]*[\[【]?.*招商方向研判报告[】\]]?[。\s]*$',
        r'^[✅⚠️\s]*[\[【]?.*经济数据报告[】\]]?.*$',
        r'^[✅⚠️\s]*[\[【]?.*竞争格局分析报告[】\]]?.*$',
        r'^[✅⚠️\s]*[\[【]?.*招商作战清单[】\]]?.*$',
        r'^[✅⚠️\s]*[\[【]?.*市方向[一二三四五六七八九十\d]+.*$',
        r'^[✅\s]*\d+年各产业链方向.*请领导确认$',
        r'^[✅\s]*(首选|拟优先|专项资金).*请(领导|主管).*确认$',
    ]
    for pat in junk_patterns:
        if _re.search(pat, text):
            return True
    # 纯表格行/URL碎片/分隔线
    if _re.match(r'^\d{3,4}/t\d+', text):
        return True
    if _re.match(r'^注[:：]', text):
        return True
    if _re.match(r'^(年份|排名)\s+(GDP|企业)', text):
        return True
    if '------' in text or '---' * 3 in text:
        return True
    if _re.match(r'^\d+\s+\S+\s+★', text):
        return True
    # URL碎片
    if '.shtml' in text or '.html)' in text:
        return True
    # fortune/xx 类残留
    if _re.search(r'ortune/\d+/', text):
        return True
    # 纯数字串
    if _re.match(r'^[\d\s\.]+$', text.replace(',', '').replace('，', '')):
        return True
    # 趋势判断框架
    if text.startswith('趋势判断'):
        return True
    # 含★排名的企业表格行
    if '★★' in text:
        return True
    # 数据残片（如"数据2025年结构比"）
    if _re.match(r'^数据\d{4}', text):
        return True
    return False

def _clean_sync_data(data):
    """清洗+AI分类概括：把所有材料汇总后让AI按板块主题分类+精选概括"""
    if not isinstance(data, dict):
        return data
    projects = data.get('PROJECTS') or {}
    for pkey, proj in projects.items():
        city = proj.get('city', '')
        kb = proj.get('kb') or []
        if not kb:
            continue
        # 第一步：收集所有板块的cleaned items（汇总）
        all_cleaned = []
        for section in kb:
            known = section.get('known') or []
            for item in known:
                t = _clean_kb_text(item)
                if not _is_junk_item(t):
                    all_cleaned.append(t)
        # 第二步：AI一次性分类+概括
        classified = _classify_and_summarize(city, kb, all_cleaned)
        # 第三步：把分类结果写回各板块
        for section in kb:
            topic = section.get('t', '')
            if classified and topic in classified:
                section['known'] = classified[topic]
            else:
                # AI未返回或失败，保留清洗后的前6条
                known = section.get('known') or []
                cleaned = []
                for item in known:
                    t = _clean_kb_text(item)
                    if not _is_junk_item(t):
                        cleaned.append(t)
                section['known'] = cleaned[:6]
            # 修正 sub
            sub = section.get('sub', '')
            if 'AI流水线' in sub or '流水线产出' in sub or not sub:
                _sub_map = {
                    '主导产业与产业链': city + '主导产业集群与核心缺口',
                    '园区与承载条件': city + '主要园区与承载能力',
                    '链主与存量企业': city + '链主企业与配套格局',
                    '政策、规划与领导关注': city + '政策方向与竞争态势',
                }
                section['sub'] = _sub_map.get(topic, city + '产业数据')
            # 修正 tag
            tag = section.get('tag', '')
            if tag in ('已初始化', '') or 'AI流水线' in tag:
                n = len(section['known'])
                section['tag'] = f'AI研判 · {n}条' if n else '待补充'
    return data
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
    # key 仅从环境变量读取（Railway Variables 配置 DEEPSEEK_API_KEY）；不再从明文文件兜底，避免密钥入库泄露
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


SYSTEM_FUNNEL = """你是慧小招招商情报分析师。针对某个具体的「招商项目方向」，基于其产业研判报告与缺口分析，筛选出真实存在的、有异地设厂/投资/合作可能的适配企业，构成一个企业漏斗。

## 输出格式（严格输出 JSON，不要 markdown 代码块、不要 JSON 之外的任何文字）
{
  "topic": "该招商方向名",
  "total_scanned": 40,
  "companies": [
    {
      "name": "企业规范全称（真实存在的公司，如「亿华通科技股份有限公司」）",
      "region": "总部所在城市",
      "kind": "主营业务（简短，一句话）",
      "fit": "为何适配该招商方向（结合缺口，一句话）",
      "score_match": 36,
      "score_relocate": 22,
      "score_strength": 25,
      "score_reason": "三项打分的简要依据（一句话说明为何这样给分）",
      "signal": "扩张/迁移/投资信号（有则写，无则空字符串）",
      "expansion": "该企业明确的扩张/建厂/异地投资/产能扩产等公开需求信号（务必有公开依据才写，注明信息线索；无则留空字符串）",
      "faction": "该企业核心领导（董事长/总经理/创始人）与本招商城市或所在省是否存在可考的『同派系』关联——校友（同一母校）、同乡（籍贯）、商会/行业协会共同任职、过往任职交集等（务必有可信线索才写，写明关联类型与具体依据，如『董事长张三为武汉大学校友』；无则留空字符串）",
      "listed": "上市情况（如 A股/新三板/未上市/港股）",
      "source": "信息来源（如 公开工商信息 / 上市公司公告 / 行业协会名录）"
    }
  ]
}

## 要求
1. companies 输出目标 40 家（至少 30 家），聚焦该方向缺口环节适配度最高的真实企业；宁可精不可滥，不要为凑数拉低质量。
2. 企业必须是你「确定真实存在」的公司，用规范全称，优先列上市公司/细分龙头/专精特新/已有扩张信号的企业。禁止虚构企业名——宁可少列，绝不编造。
3. 【评分卡·三个分项，分别独立打分，禁止都给高分，要有区分度】
   - score_match（0-40）：业务与该方向缺口环节的匹配度。越是精准补上报告识别出的缺口环节，分越高。
   - score_relocate（0-30）：异地投资/迁移/落地本城市的可能性。有公开扩张/迁移/投资动向或处于产能扩张期的，分越高；总部已在本地或明显无外迁可能的，分低。
   - score_strength（0-30）：企业实力。上市公司/细分龙头/专精特新/规模大的分高。
   - 不要输出 fit_score 总分，总分由系统按三项相加得出。score_reason 用一句话说明三项打分依据。
4. fit 必须具体说明该企业能补上这个方向的哪个缺口环节，不要空话。
5. signal / expansion 只写你确有公开依据的动向；没有就留空字符串，【严禁编造】任何融资/建厂/扩张消息。
6. faction 是稀缺信息：只有当你确有可信线索（公开可考的校友/籍贯/商会/任职关联）时才填，并写清依据；绝大多数企业此项应留空——【严禁为了凑数编造领导背景或人际关联】。找不到就留空，这是正常的，不强求。
7. total_scanned 写你本轮实际扫描评估的企业规模（约等于 companies 长度或更多）。
8. 全部用中文。这是 AI 推理结果，前端会标注"待人工核验"。核心底线：所有企业、分数、信号、扩张需求、派系关联都必须基于真实公开信息或合理推断，绝不编造虚假数据；宁可留空、宁可少列，也不许造假。"""


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
        # 云端数据同步：GET /api/sync 读取（返回前清洗冗余内容）
        if path == '/api/sync':
            if _PG_AVAIL and DATABASE_URL:
                result = _db_get()
                raw_str = result or '{}'
            else:
                try:
                    with open(SYNC_PATH, encoding='utf-8') as f2:
                        raw_str = f2.read()
                except FileNotFoundError:
                    raw_str = '{}'
            try:
                sync_obj = json.loads(raw_str)
                sync_obj = _clean_sync_data(sync_obj)
                data = json.dumps(sync_obj, ensure_ascii=False).encode()
            except Exception:
                data = raw_str.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.cors(); self.end_headers(); self.wfile.write(data)
            return
        # 原始报告下载：GET /api/report-file?city=随州&kind=full|short
        # 从云端存储的 base64 docx 里取出并回传，供管理端「下载原始报告」按钮使用。
        if path == '/api/report-file':
            import base64, urllib.parse
            qs = urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '')
            city = (qs.get('city') or [''])[0]
            kind = (qs.get('kind') or ['full'])[0]
            try:
                if _PG_AVAIL and DATABASE_URL:
                    store = json.loads(_db_get() or '{}')
                else:
                    with open(SYNC_PATH, encoding='utf-8') as f2:
                        store = json.loads(f2.read())
            except Exception:
                store = {}
            # 优先从 REPORT_REQUESTS（最近一条该城市 done 且带 files 的），回退到项目 reportFiles
            files = None
            done = [r for r in (store.get('REPORT_REQUESTS') or [])
                    if isinstance(r, dict) and r.get('city') == city and r.get('files')]
            if done:
                files = done[-1]['files']
            if not files:
                for pv in (store.get('PROJECTS') or {}).values():
                    if isinstance(pv, dict) and pv.get('city') == city and pv.get('reportFiles'):
                        files = pv['reportFiles']; break
            meta = None
            if files:
                meta = next((m for m in files if m.get('kind') == kind), None) or files[0]
            if not meta or not meta.get('b64'):
                msg = json.dumps({'ok': False, 'error': '未找到该城市原始报告文件'}).encode()
                self.send_response(404); self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(msg)))
                self.cors(); self.end_headers(); self.wfile.write(msg); return
            try:
                blob = base64.b64decode(meta['b64'])
            except Exception:
                blob = b''
            fname = meta.get('name') or (city + '_报告.docx')
            fname_enc = urllib.parse.quote(fname)
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            self.send_header('Content-Disposition',
                             "attachment; filename*=UTF-8''" + fname_enc)
            self.send_header('Content-Length', str(len(blob)))
            self.cors(); self.end_headers(); self.wfile.write(blob)
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
            recs = []
            # ① 云端 DB 优先（生产环境跨会话可查）
            try:
                if _PG_AVAIL and DATABASE_URL:
                    store = json.loads(_db_get() or '{}')
                    recs = store.get("RAG_AUDIT") or []
            except Exception as e:
                print(f"[rag-log] db read failed: {e}")
            # ② 回退本地文件（开发环境）
            if not recs:
                try:
                    lines = open(LOG_PATH, encoding="utf-8").read().splitlines()
                    recs = [json.loads(l) for l in lines if l.strip()]
                except FileNotFoundError:
                    recs = []
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
                _protected = ['OPS_ENT','DEMANDS','KB_CHAT','PENDING_CONFIRMS','KB_CONFIRMS','REPORT_REQUESTS','CITY_ACCOUNTS']
                # REPORT_REQUESTS 按 id 合并且状态只进不退（pending<running<done/failed）
                # 防止管理端旧快照 persist 把流水线已推进的状态倒改回 pending
                _rr_rank = {'pending': 0, 'running': 1, 'failed': 2, 'done': 3}
                def _merge_rr(old_list, new_list):
                    by_id = {r.get('id'): dict(r) for r in (old_list or []) if isinstance(r, dict)}
                    for r in (new_list or []):
                        if not isinstance(r, dict):
                            continue
                        rid = r.get('id')
                        ex = by_id.get(rid)
                        if not ex:
                            by_id[rid] = r
                        elif _rr_rank.get(r.get('status'), 0) >= _rr_rank.get(ex.get('status'), 0):
                            ex.update(r)
                        # 否则丢弃倒退的状态更新，保留服务端已推进的记录
                    return sorted(by_id.values(), key=lambda x: x.get('ts', 0))
                for k, v in incoming.items():
                    if k in _protected and not v and existing.get(k):
                        continue
                    if k == 'REPORT_REQUESTS':
                        existing[k] = _merge_rr(existing.get(k), v)
                        continue
                    if k in ('PROJECTS', 'REPORTSTATE', 'CITY_ACCOUNTS'):
                        # 逐 key/逐字段合并，空值不覆盖非空——防止旧快照把已同步的 RAG/账号冲掉
                        existing[k] = _merge_map(existing.get(k), v)
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
        # ── 接口1：管理员上传文档，补充/修正城市智库 ──
        if self.path == '/api/kb-upload':
            try:
                body = json.loads(raw)
                city = body.get('city', '')
                pkey = body.get('projectKey', '')
                topic = body.get('topic', '')          # 目标主题名
                text = body.get('text', '')            # 文档全文
                filename = body.get('filename', '上传文档')
                mode = body.get('mode', 'append')       # append=补充 / replace=修正覆盖该主题
                if _PG_AVAIL and DATABASE_URL:
                    store = json.loads(_db_get() or '{}')
                else:
                    with open(SYNC_PATH, 'r', encoding='utf-8') as f2:
                        store = json.loads(f2.read())
                projects = store.get('PROJECTS') or {}
                # 定位项目：优先 projectKey，其次按 city 匹配
                if pkey and pkey in projects:
                    key = pkey
                else:
                    key = next((k for k, v in projects.items()
                                if isinstance(v, dict) and v.get('city') == city), None)
                if not key:
                    resp = json.dumps({'ok': False, 'error': 'project not found'}).encode()
                else:
                    p = projects[key]
                    if not isinstance(p.get('kb'), list):
                        p['kb'] = []
                    # origin: admin(管理员) / user(前端用户)；nature: support(佐证) / fix(修正/修改) / confirm(确认)
                    origin = body.get('origin', 'admin')
                    nature = body.get('nature', 'support')   # 默认佐证
                    import time as _tt
                    _ts = int(_tt.time() * 1000)
                    # 切分文档为结构化 chunks（每条带来源标记，前端据此着色）
                    import re as _re
                    parts = [x.strip() for x in _re.split(r'\n\s*\n', text) if len(x.strip()) >= 20]
                    chunks = []
                    for para in parts:
                        para = _re.sub(r'\s+', ' ', para)[:420]
                        chunks.append({'text': para, 'origin': origin, 'nature': nature,
                                       'src': filename, 'ts': _ts})
                    # 找/建目标主题
                    tp = next((t for t in p['kb'] if t.get('t') == topic), None)
                    if not tp:
                        tp = {'icon': '📎', 't': topic or '管理员补充资料',
                              'sub': '', 'tag': '', 'known': [], 'calls': []}
                        p['kb'].append(tp)
                    # 就地匹配：新 chunk 与已有条目相似度高 → 在已有条目上打标注，不新增
                    def _norm(s):
                        return _re.sub(r'[\s，,。、；;：:（）()【】\[\]|—\-]+', '', str(s or ''))
                    def _chunk_text(k):
                        return k.get('text', '') if isinstance(k, dict) else str(k)
                    def _similar(a, b):
                        a, b = _norm(a), _norm(b)
                        if not a or not b:
                            return 0.0
                        # 双向包含 or 字符级重叠比例
                        if a in b or b in a:
                            return 0.9
                        short, long = (a, b) if len(a) <= len(b) else (b, a)
                        # 滑窗取 short 的若干 8-gram 命中率
                        grams = [short[x:x+8] for x in range(0, max(1, len(short) - 7), 4)] or [short]
                        hit = sum(1 for g in grams if g and g in long)
                        return hit / len(grams)

                    matched_ct = 0
                    if mode == 'replace':
                        base = [k for k in (tp.get('known') or [])
                                if isinstance(k, str) or (isinstance(k, dict) and k.get('origin') == 'ai')]
                        tp['known'] = base + chunks
                    else:
                        known = tp.get('known') or []
                        # 归一化为对象以便挂标注（AI 基础材料原是字符串）
                        norm_known = []
                        for k in known:
                            norm_known.append(k if isinstance(k, dict) else {'text': k, 'origin': 'ai', 'nature': 'base'})
                        leftover = []
                        for nc in chunks:
                            best, best_score = None, 0.55   # 相似度阈值
                            for ek in norm_known:
                                sc = _similar(nc['text'], ek.get('text', ''))
                                if sc > best_score:
                                    best, best_score = ek, sc
                            if best is not None:
                                # 就地标注到已有条目
                                best.setdefault('annotations', []).append({
                                    'origin': origin, 'nature': nature, 'src': filename,
                                    'text': nc['text'], 'ts': _ts})
                                matched_ct += 1
                            else:
                                leftover.append(nc)
                        tp['known'] = norm_known + leftover
                    # 记录上传审计
                    p.setdefault('kbUploads', []).append({
                        'filename': filename, 'topic': topic, 'mode': mode,
                        'chunks': len(chunks), 'ts': int(__import__('time').time() * 1000),
                        'by': body.get('by', '管理员')})
                    store['PROJECTS'] = projects
                    out_str = json.dumps(store, ensure_ascii=False)
                    if _PG_AVAIL and DATABASE_URL:
                        _db_set(out_str)
                    else:
                        with open(SYNC_PATH, 'w', encoding='utf-8') as f:
                            f.write(out_str)
                    resp = json.dumps({'ok': True, 'chunks': len(chunks),
                                       'topic': tp['t'], 'total': len(tp['known'])}).encode()
            except Exception as e:
                resp = json.dumps({'ok': False, 'error': str(e)}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self.cors(); self.end_headers(); self.wfile.write(resp); return

        # ── 接口2：城市智库版本管理（多次报告按时间快照+覆盖）──
        if self.path == '/api/kb-version':
            try:
                body = json.loads(raw)
                action = body.get('action', 'snapshot')  # snapshot=存快照 / rollback=回滚到某版本
                city = body.get('city', ''); pkey = body.get('projectKey', '')
                if _PG_AVAIL and DATABASE_URL:
                    store = json.loads(_db_get() or '{}')
                else:
                    with open(SYNC_PATH, 'r', encoding='utf-8') as f2:
                        store = json.loads(f2.read())
                projects = store.get('PROJECTS') or {}
                key = pkey if (pkey and pkey in projects) else next(
                    (k for k, v in projects.items() if isinstance(v, dict) and v.get('city') == city), None)
                if not key:
                    resp = json.dumps({'ok': False, 'error': 'project not found'}).encode()
                else:
                    import time as _t
                    p = projects[key]
                    p.setdefault('kbVersions', [])
                    if action == 'snapshot':
                        # 保存当前 kb 为一个带时间戳的历史版本
                        tot = sum(len(t.get('known', [])) for t in (p.get('kb') or []))
                        p['kbVersions'].append({
                            'ver': len(p['kbVersions']) + 1,
                            'ts': int(_t.time() * 1000),
                            'label': body.get('label', ''),
                            'chunks': tot,
                            'kb': json.loads(json.dumps(p.get('kb') or []))  # 深拷贝
                        })
                        # 只保留最近 10 个版本
                        p['kbVersions'] = p['kbVersions'][-10:]
                        resp = json.dumps({'ok': True, 'ver': p['kbVersions'][-1]['ver'],
                                           'versions': len(p['kbVersions'])}).encode()
                    elif action == 'rollback':
                        ver = body.get('ver')
                        target = next((v for v in p['kbVersions'] if v.get('ver') == ver), None)
                        if target:
                            p['kb'] = json.loads(json.dumps(target['kb']))
                            p['kbInitTs'] = int(_t.time() * 1000)
                            resp = json.dumps({'ok': True, 'restored': ver}).encode()
                        else:
                            resp = json.dumps({'ok': False, 'error': 'version not found'}).encode()
                    else:
                        resp = json.dumps({'ok': False, 'error': 'unknown action'}).encode()
                    if b'"ok": true' in resp or b'"ok":true' in resp:
                        store['PROJECTS'] = projects
                        out_str = json.dumps(store, ensure_ascii=False)
                        if _PG_AVAIL and DATABASE_URL:
                            _db_set(out_str)
                        else:
                            with open(SYNC_PATH, 'w', encoding='utf-8') as f:
                                f.write(out_str)
            except Exception as e:
                resp = json.dumps({'ok': False, 'error': str(e)}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self.cors(); self.end_headers(); self.wfile.write(resp); return

        # ── 接口3：管理端「推送到RAG」按钮 → 给已完成申请打 pushRequested 标记 ──
        # 本地议程轮询器消费该标记，执行 sync_to_kb.py 完成 RAG 推送 + 城市账号连接。
        if self.path == '/api/report-push-request':
            try:
                body = json.loads(raw)
                city = body.get('city', '')
                if _PG_AVAIL and DATABASE_URL:
                    store = json.loads(_db_get() or '{}')
                else:
                    with open(SYNC_PATH, 'r', encoding='utf-8') as f2:
                        store = json.loads(f2.read())
                reqs = store.get('REPORT_REQUESTS') or []
                done = [r for r in reqs if isinstance(r, dict)
                        and r.get('city') == city and r.get('status') == 'done']
                target = (done[-1] if done else
                          (reqs[-1] if reqs else None))
                rid = None
                if target and isinstance(target, dict):
                    target['pushRequested'] = True
                    target['pushRequestedTs'] = int(time.time() * 1000)
                    target['pushed'] = False
                    rid = target.get('id')
                    store['REPORT_REQUESTS'] = reqs
                    out_str = json.dumps(store, ensure_ascii=False)
                    if _PG_AVAIL and DATABASE_URL:
                        _db_set(out_str)
                    else:
                        with open(SYNC_PATH, 'w', encoding='utf-8') as f:
                            f.write(out_str)
                resp = json.dumps({'ok': bool(rid), 'id': rid, 'city': city}).encode()
            except Exception as e:
                resp = json.dumps({'ok': False, 'error': str(e)}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self.cors(); self.end_headers(); self.wfile.write(resp); return

        if self.path != '/api/kb-chat':
            self.send_error(404); return

        body   = json.loads(raw)
        q      = body.get("question", "").strip()
        chunks = body.get("chunks", [])
        city   = body.get("city", "")
        stream = body.get("stream", True)
        mode   = body.get("mode", "full")
        history = body.get("history", [])  # 多轮上下文：[{role:'user'|'assistant', content:'...'}]

        if mode not in ("chat", "draft", "full", "suggest", "research", "chain", "topics", "funnel"):
            mode = "full"

        if not q:
            self.send_error(400, "question required"); return

        # 拼 RAG context —— 真实检索：按问题与语料词重合度打分取 TopK，而非盲切前 N
        # 报告类 mode（full/research/chain/funnel）吃进更多语料，对话类少吃
        _top_k = 12 if mode in ("full", "research", "chain", "funnel") else 6
        used, _scored = _retrieve_chunks(q, chunks, top_k=_top_k, min_score=1)
        # 注意：本方法体内(第729行附近)另有一个局部 def _chunk_text，会遮蔽模块级同名函数，
        # 导致此处 genexpr 引用报 NameError。故内联提取文本，不调用 _chunk_text。
        def _ctext(c):
            if isinstance(c, str): return c
            if isinstance(c, dict): return str(c.get("text", "") or "")
            return ""
        ctx = "\n\n".join(
            f"[{(c.get('cite','') if isinstance(c, dict) else '')}·{(c.get('topic','') if isinstance(c, dict) else '')}]\n{_ctext(c)}"
            for c in used
        ) or "暂无检索到相关内容，请基于通用招商知识回答。"

        # —— RAG 审计日志：证明本次分析实际吃进了哪些数据、其中多少来自用户上传 ——
        # total_available = 前端送来的候选总数；total_chunks = 真实命中并吃进的数量（可能 0~top_k）
        upload_used = [c for c in used if _is_upload_chunk(c)]
        audit_log({
            "city": city,
            "mode": mode,
            "question": q,
            "total_available": len(chunks),
            "total_chunks": len(used),
            "upload_chunks": len(upload_used),
            "kb_chunks": len(used) - len(upload_used),
            "all_cites": [(c.get("cite", "") if isinstance(c, dict) else "") for c in used],
            "top_scores": [s for s, _c in _scored],
            "upload_samples": [
                {"cite": (c.get("cite", "") if isinstance(c, dict) else ""),
                 "id": (c.get("id", "") if isinstance(c, dict) else ""),
                 "text": _ctext(c)[:120]}
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
        elif mode == "funnel":
            system_prompt = SYSTEM_FUNNEL
            max_tokens    = 9500    # 约40家企业结构化 JSON（含三分项评分卡+扩张/派系标注，字段增多）
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
        # v4-pro 默认开启 thinking，CoT 会先吐 reasoning_content 并吃光 max_tokens，
        # 导致 content 迟迟不出/为空。前端只渲染 delta.content、不显示思考链，
        # 所以对所有 mode（含 chat/suggest）一律关闭 thinking，避免问答“出不来答案”。
        payload_dict["thinking"] = {"type": "disabled"}
        payload = json.dumps(payload_dict).encode()

        req = urllib.request.Request(
            DS_URL, data=payload, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {DS_KEY}"}
        )

        try:
            _timeout = 150 if mode in ("funnel", "chain", "research") else 60
            with DS_OPENER.open(req, timeout=_timeout) as resp:
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
