---
name: huixiaozhao-report
description: 慧小招城市招商报告生成。当用户要求为某个城市生成招商报告/产业分析时使用。触发词：招商报告、城市调研、产业分析、慧小招、跑一个XX城市。
version: "5.3"
---

# 慧小招 — 城市招商报告生成

## 触发条件
用户要求为某个**城市**生成招商报告、产业分析、产业调研时使用。
仅限城市/区域相关的产业招商任务。

## 架构（v5.1 — Agenda Pipeline + 定向采集）

14个Agent（含 fact_checker），5波调度。**每个 Agent 作为独立的 agenda generative task 运行**，彻底解决主会话 context 溢出问题。

### 为什么不用 spawn_agents？

spawn_agents 的输出**全部回传主会话 context**。13个 agent 每个回传 3000-5000 字 → 主会话 context 爆炸 → 截断 → 后续 wave 质量崩塌。

### Agenda Task 模式的优势
- 每个 agent 有**独立 context 窗口**（不共享、不挤占）
- 每个 agent 有**独立 10 分钟执行预算**
- 输出**写入文件**，主调度用 `gate_check.py` 校验（行数 + URL引用数 + 可信域名占比），不读内容
- 任何 agent 失败可**单独重跑**（agenda run）
- 主会话 context 始终极小（只有调度逻辑 + 文件路径检查）

## 报告核心逻辑（必须遵守）

**报告的核心价值 = 产业链缺口分析 + 基于缺口的精准企业推荐。**

报告结构权重分配：
- 城市基础数据（经济/人口/交通/配套/政策）：20%篇幅，作为背景支撑
- 产业方向研判 + 竞争分析：15%篇幅
- **产业链全景与缺口分析：25%篇幅（核心章节之一）**
- **目标招商企业（基于缺口推荐）：30%篇幅（最重要章节）**
- 匹配度评分 + 行动计划：10%篇幅

关键逻辑链：
```
产业方向 → 绘制完整产业链 → 标注本地已有/缺失/薄弱环节 → 针对每个缺口推荐具体可招企业
```

**企业猎手的输入必须包含 chain_mapper 的缺口结论**，企业推荐必须对应到具体缺口环节。

## 执行流程

### Step 0: 生成 Pipeline 配置 + 创建输出目录
```bash
mkdir -p ~/outputs/huixiaozhao/{city_pinyin}_report
python ~/outputs/huixiaozhao/system/orchestrator.py --city {city_name} --province {province} --mode deep
```
这会生成 `pipeline_config.json`，包含每个 agent 的完整 prompt 和依赖关系。

### Step 1: 创建 Agenda Tasks（每个 agent 一个 task）

现行Agenda创建接口要求cron或runAt。旧版省略时间会报 `either cron or runAt is required`，研究任务根本不会创建。

用随技能附带的确定性脚本生成完整调用参数，不手抄一个没有runAt的模板：
```bash
python /Users/ryan/.violoop/skills/huixiaozhao-report/scripts/build_agenda_task.py --config /绝对路径/pipeline_config.json --request-id rr申请ID --agent economic_profiler
```
输出含action=create、请求级name、未来UTC的runAt、taskType、对象型taskConfig。原样传给agenda；不要漏runAt，不要把taskConfig编码成字符串。参数生成后立即创建，超过runAt就重新生成。

先创建一个任务，检查返回success=true、id和runAt/nextRun存在，再创建同波剩余任务。创建成功会在runAt自动执行，不要紧接着agenda run造成重复触发。创建前按请求ID+agent_id查重，已存在就采用其ID。

每个running申请必须有启用的请求级接续任务，cron=`*/2 * * * *`，状态与任务ID存于 `/Users/ryan/outputs/agenda/{request_id}/`。接续任务需要full-trust并写清仅管理该申请的授权理由；子研究任务使用network-allowed。当前轮只推进就绪阶段，不睡眠等待整份报告。

### Step 2: Wave 调度（核心协议）

**Wave 1（7个并行）—— 无依赖，创建带未来runAt的7个任务，由调度系统自动启动**

| Agent | 输出文件 | 最低行数(deep) |
|-------|----------|---------------|
| economic_profiler | 01a_economy.md | 150 |
| population_profiler | 01b_population.md | 150 |
| transport_land_profiler | 01c_transport_land.md | 180 |
| life_support_profiler | 01d_life_support.md | 150 |
| industry_analyst | 02_industry_direction.md | 180 |
| competition_scout | 03_competition.md | 180 |
| policy_researcher | 04_policy_trends.md | 200 |

触发后轮询：
```bash
# 每 30s 检查一次
for f in 01a 01b 01c 01d 02 03 04; do
  wc -l ~/outputs/huixiaozhao/{city}_report/${f}*.md
done
```

**Wave 2A（chain_mapper）—— 等 02_industry_direction.md 就绪**

| Agent | 输出文件 | 最低行数 |
|-------|----------|---------|
| chain_mapper | 06_supply_chain_gaps.md | 250 |

**Wave 2B（3个企业猎手并行）—— 等 06_supply_chain_gaps.md 就绪**

| Agent | 输出文件 | 最低行数 |
|-------|----------|---------|
| enterprise_hunter_1 | 05a_target_enterprises_dir1.md | 250 |
| enterprise_hunter_2 | 05b_target_enterprises_dir2.md | 250 |
| enterprise_hunter_3 | 05c_target_enterprises_dir3.md | 250 |

企业猎手数量标准：
- standard模式：每方向 >= 15家
- deep模式：每方向 >= 25家
- 每家企业必须包含：补链环节、扩产/迁移信号、与本城市匹配点、建议话术切入点

**Wave 2.5（fact_checker）—— 等 Wave 2B 全部就绪（v5.1 新增）**

| Agent | 输出文件 | 最低行数 |
|-------|----------|---------|
| fact_checker | 06b_fact_check.md | 60 |

独立交叉核验：经济核心数字（对照统计局公报原文）、政策文号（site:gov.cn）、全部★★★★★企业扩产信号（巨潮/招投标平台）。输出 ✅一致/⚠️偏差/❌不实/❓无法核验 四级判定 + 总体可信度评分。若结论建议重跑某 agent，调度层先重跑再进 Wave 3。

**Wave 3（串行）—— 等 Wave 2B + Wave 2.5 全部就绪**

| Agent | 输出文件 | 最低行数 |
|-------|----------|---------|
| scoring_engine | 07_matching_score.md | 100 |
| action_planner | 08_action_plan.md + 00_executive_summary.md | 150+80 |

**Wave 4（compact_writer）—— 等 Wave 3 全部就绪**

| Agent | 输出文件 | 最低行数 |
|-------|----------|---------|
| compact_writer | 09_compact_report.md | 80 |

精简报告的80行为正文展示下限，允许用简短的具体依据、风险和行动表达。原始研究、全部精选企业及七维评分保留在完整产物中；研究正文、企业数量、事实核验的年份及双来源要求不变。

compact_writer 读取所有完整版 md 文件（00/02/05a/05b/05c/06/07/08），按六段式结构生成精简版报告，含自检清单。

### Step 3: 文件就绪判断标准（v5.1 门禁）

用 `gate_check.py` 替代纯行数检查（每个 agent 的 pipeline_config.json 里已预生成 `gate_cmd` 字段，直接执行）：

```bash
# 采集类 agent：行数 + URL引用数 + 可信域名占比
python ~/outputs/huixiaozhao/system/gate_check.py {file} --min-lines {n} --min-urls 8
# 企业猎手额外校验信号溯源格式
 python ~/outputs/huixiaozhao/system/gate_check.py {file} --min-lines 250 --min-urls 12 --signal-mode
```

退出码0=PASS，1=FAIL（FAIL时输出 JSON 指出哪项不达标）。纯读文件的 agent（scoring/action/compact）仍用行数检查。

### Step 4: 失败处理

- Agent超时/网络暂时失败/门禁未通过：保留已有成果，记录错误和未完成部分，退避后由接续任务继续；默认不设总次数或累计时长上限。
- 禁止因为失败两次而skipped，也不得把缺失章节当完成推进下一波。检查错误原因，连续同错先调整策略，不机械重复错误调用。
- 创建参数错误：先检查脚本生成结果中的runAt、taskConfig对象和返回的success；修正参数后单项探测，不能整批重复同一错误。
- 持续认证/权限等无法自行解决的问题：明确通知用户需要什么，并保留成果。不要伪造完成，不同步残缺报告。
- 在 `/Users/ryan/outputs/agenda/{request_id}/` 持久记录任务ID、尝试、下次恢复时间和错误。
- 文件就绪必须同时满足本申请完成凭证、任务实际完成和门禁通过。旧文件存在或旧哈希不能作为本轮新产出的证据。

### Step 5: 合并为 Word（必须执行）

```bash
python ~/outputs/huixiaozhao/system/build_docx.py \
  --city {city_name} \
  --input ~/outputs/huixiaozhao/{city_pinyin}_report/ \
  --output ~/outputs/huixiaozhao/{city_pinyin}_report/{city_name}_招商报告.docx

# 同时生成精简版 Word（Wave 4 完成后执行）
python ~/outputs/huixiaozhao/system/build_docx.py \
  --city {city_name} \
  --input ~/outputs/huixiaozhao/{city_pinyin}_report/ \
  --output ~/outputs/huixiaozhao/{city_pinyin}_report/{city_name}_招商报告.docx \
  --compact
```

**双产物交付标准（硬性）：**
- 完整版 Word：{city}市_招商报告.docx（全部章节，约100-150页）
- 精简版 Word：{city}市精准招商作战报告_精简版.docx（六段式，≤60页，决策层可直接使用）
- 两份 Word 都复制到桌面 + preview_open 给用户确认

**Word 格式要求（硬性）：**
- 正文字体：仿宋，小四（12pt）
- 标题字体：仿宋加粗（一级小二/18pt，二级小三/15pt，三级四号/14pt）
- 表格内文字：仿宋，五号（10.5pt）
- 行距：1.5倍
- 页边距：上下2.54cm，左右3.17cm

**章节合并顺序（突出核心）：**
00 领导摘要 → 02 产业方向 → 06 产业链缺口 → 05a/05b/05c 目标企业 → 07 匹配评分 → 08 行动计划 → 01a-01d 城市基础 → 03 竞争 → 04 政策

### Step 6: 交付

1. `mkdir -p ~/Desktop/{city_name}招商报告`
2. `cp *.md *.docx ~/Desktop/{city_name}招商报告/`
3. `preview_open` 打开 Word 给用户确认

### Step 7: 一键同步到客户系统 RAG（v5.2 新增）

报告产出后，将全部章节切分为智库材料，回填客户系统（政府端城市智库 + 研判报告）：

```bash
python ~/outputs/huixiaozhao/system/sync_to_kb.py \
  --city {city_name} --input ~/outputs/huixiaozhao/{city_pinyin}_report \
  --server https://<railway-app>.up.railway.app \
  [--request-id {rr_id}]   # 由管理端申请触发时必带，完成后自动标记 done
```

- 章节→主题映射：02+06→主导产业与产业链；01a-01d→园区与承载条件；05a/b/c+07→链主与存量企业；03+04→政策规划
- 09_compact_report.md 全文写入 REPORTSTATE（政府端「研判报告」直接可见）
- 每主题最多60条 chunk；总数<40 视为报告不完整，中止同步（防止半成品污染 RAG）
- 本地调 localhost 时必须 `NO_PROXY='*'` 绕过 Clash

## 管理端发起申请 → 自动产出（闭环协议）

管理端（ops.html 需求池页顶部「发起城市报告生成」面板）填省份+城市提交 → 写入 `/api/sync` 的 `REPORT_REQUESTS` 队列（status=pending）。

调度侧消费流程（agenda 轮询任务执行）：
```bash
# 1. 轮询（退出码 0=有 pending，2=空队列直接结束）
python ~/outputs/huixiaozhao/system/check_requests.py --server <url> list
# 2. 认领（pending→running，防重复消费）
python ~/outputs/huixiaozhao/system/check_requests.py --server <url> claim --id {rr_id}
# 3. 跑本 SKILL 的 Step 0-6 完整流水线
# 4. Step 7 带 --request-id 同步（自动标 done + 回填 chunks 数）
# 失败时：check_requests.py fail --id {rr_id} --reason "..."（管理端显示可重试）
```

状态机：pending → running → done / failed。管理端面板实时显示每条申请状态与入库材料数。

## Bridge 通知（可选）

每个 agent 启动/完成时通知 bridge（不在线时静默失败）：
```bash
~/outputs/huixiaozhao/system/notify_bridge.sh {agent_id} started|completed "{message}"
```

agent_id 对照表：
- economic_profiler / population_profiler / transport_land_profiler / life_support_profiler
- industry_analyst / competition_scout / policy_researcher
- chain_mapper / enterprise_hunter_1/2/3 / fact_checker
- scoring_engine / action_planner

## 关键原则

1. **每个 agent 必须是独立 agenda generative task**——绝不用 spawn_agents
2. **主会话只做调度**——创建 task、触发 run、轮询文件、build_docx
3. **主会话不读 agent 输出内容**——只检查文件存在+行数达标
4. agent_type 统一用 operator（需要写文件），capability: network-allowed
5. model_tier 统一用 heavy（深度研究需要）
6. Bridge 不在线时通知静默失败，不影响主流程
7. 每个 agent 的 prompt 已内置在 orchestrator.py 中，无需手动构造
8. 每次报告必须产出双版本：完整版（研究底稿）+ 精简版（决策作战手册）
9. 精简版质量标准：六段式结构完整 + 话术全部含数字 + 不超过完整版40%字数
10. compact_writer 的六段式自检通过后才能 build_docx
11. （v5.1）采集类 agent 引用铁律：数值（来源：完整URL，YYYY-MM-DD）；无URL标「二手来源，待核实」
12. （v5.1）定向采集优先：先 webfetch source_registry.yaml 的 T1 权威源，失败才降级 websearch
13. （v5.1）fact_checker 建议重跑某 agent 时，先重跑再进 Wave 3

## 配置文件位置

- 配置生成器：`~/outputs/huixiaozhao/system/orchestrator.py`
- 数据源注册表：`~/outputs/huixiaozhao/system/source_registry.yaml`（T1/T2分级源 + 付费源预留槽位）
- 门禁校验：`~/outputs/huixiaozhao/system/gate_check.py`
- Prompt 模板：`~/outputs/huixiaozhao/system/prompts/`
- Word 构建脚本：`~/outputs/huixiaozhao/system/build_docx.py`
- Bridge 通知脚本：`~/outputs/huixiaozhao/system/notify_bridge.sh`
- Pipeline 执行指南：`~/outputs/huixiaozhao/system/run_pipeline.md`
