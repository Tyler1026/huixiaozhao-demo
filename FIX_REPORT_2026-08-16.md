# 慧小招 Demo 修复报告 · 2026-08-16

环境: https://huixiaozhao-demo-production-21e7.up.railway.app/
仓库: Tyler1026/huixiaozhao-demo (main)
模型: deepseek-v4-pro

今日累计 commit 20+，修复真实 bug 17 个，完成两项架构改造，一次数据抢救，一轮 200 用例端到端测试。全部已上线并线上验证。

---

## 一、产业链图谱整链研判修复

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | 整链研判只落地 1 个环节（菌种研发） | 后端 SYSTEM_RESEARCH_CHAIN 返回 `name` 字段，前端读 `sr.segment` → 每个环节读不到名字被跳过 | 改为 `sr.segment \|\| sr.name`，OPS_ENT 补 segment 字段 |
| 2 | server.py 两段重复 SYSTEM_RESEARCH_CHAIN，字段不一致 | 后段覆盖前段 | 删除重复定义，只保留一份 |
| 3 | 优势环节「本地代表企业」常为空 | local_leaders 约束过严，模型因"无法联网核实"而空着 | 放宽：企业名以可靠知识为准（规范全称），只有数字仍需权威来源 |
| 4 | 图谱卡在"只研判 1 个环节" | `__chainKey` 已标记但环节不齐仍跳过 | 全部环节落地才标记；已标记但环节缺则清标记重跑（脏数据自愈） |
| 5 | 研判返回空 local_leaders | 用方向全称（"香菇产业精深加工升级"）构造问题，限定词误导模型 | 改用干净链名（"香菇"） |
| 6 | mode=full/chain 返回空 content | v4-pro 默认开 thinking，CoT 吃光 max_tokens | research/chain/full/draft/topics 全部 `thinking:disabled`，MAX_TOKENS_FULL 3000→5000 |

## 二、产业分析板块「单一事实源」架构改造

将报告正文、产业链图谱、可立项招引方向、补链清单全部改为从同一份城市调研报告（RAG 库）派生：

- **图谱接 RAG**：mode=chain 先 kbSearch 检索该城市调研报告片段作为事实依据。效果：菌种研发从模型瞎猜 mid 纠正为调研报告实证 weak 缺口。
- **可立项招引方向**：`deriveActionItemsFromChain` 从 segmentLevels 派生（weak 缺口第一梯队 → mid 培育第二梯队），携带对标企业。
- **报告第三章补链清单**：`chainPriorityMarkdown` + `alignChainToReport` 跟随图谱 segmentLevels 对齐。
- **报告正文**：`getTopicReport` AI 生成优先（aiReportByTopic 缓存），预埋兜底；`ensureAiReport` 后台从 RAG 生成真实报告替换预埋，AI 失败/无 RAG 时保留预埋保路演稳定。

## 三、选方向 AI 化 + 产业隔离

| # | 问题 | 修复 |
|---|------|------|
| 7 | 顶部 5 个方向是硬编码正则匹配 | 新增后端 mode=topics + SYSTEM_TOPICS，AI 读 RAG 归纳该城市 3-5 个方向（aiTopics 缓存 24h），正则兜底 |
| 8 | mode=topics 返回五章报告而非方向 JSON | 后端 mode 白名单遗漏 topics → 回退 SYSTEM_FULL；补上白名单 |
| 9 | 方向全是香菇 | 香菇片段密度高，笼统 query 霸占检索 | `balancedIndustryChunks` 按产业簇均衡取片段 + prompt 硬约束覆盖每产业/同产业最多 2 方向 |

效果：修复前 4 个全香菇 → 隔离后氢能 2 + 应急 1 + 香菇 1 + 专汽 1。

## 四、图谱跨链污染彻底根治

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 10 | 无论点哪个方向图谱都出香菇 | 选链匹配不到就 `else key='香菇'` 无脑兜底 | 抽 `pickChainKey()`，匹配不到明确提示不兜底 |
| 11 | 氢能方向显示香菇 | "氢燃料电池电堆"不含"氢能"二字，正则漏 | 选链正则覆盖 氢燃料/电堆/储氢/燃料电池 等全称变体 |
| 12 | 图谱串链显示别链环节 | segmentLevels 历史混入多链环节 | 图谱只读 `__chainKey===当前链` 的研判，切链前清理不属于本链的残留环节 |
| 13 | 页面莫名刷新 | researchChain 成功后无条件 render → 渲染循环 | 改为局部更新图谱 DOM，不重渲染整页 |
| 14 | 香菇招引方向出现氢气标题 | `deriveActionItemsFromChain` 未做当前链隔离 | 只取 `__chainKey===当前链` 且属于该链节点清单（新增 CHAIN_NODE_NAMES）的环节 |
| 15 | 补链清单混入氢能环节 | `chainPriorityMarkdown` 同源缺链隔离 | 补上当前链隔离过滤 |

## 五、招商对接删除功能 + 数据抢救

| # | 问题 | 修复 |
|---|------|------|
| 16 | 新增每方向「取消申请/删除」按钮 | 卡片头部 🗑 + 确认弹窗，删除联动清理 REPORTSTATE/PENDING_CONFIRMS/UPLOADS/KB_FILE_CHUNKS/DEMANDS |
| 17 | 删除跳出其他城市报告 | 删除后 cur 落到 `Object.keys(PROJECTS)[0]` 可能跨城 → 改为只在同城回退，优先主锚点 |
| 18 | 删到最后整个项目被初始化 | sz/城市锚点可被删空 → `isMainProject` 保护（sz、id===city、"XX主导产业补链招引"、某城市最后 1 个项目均禁删） |
| — | 数据抢救 | 之前删除事故导致 sz 主锚点丢失、城市智库挂在派生 key。从服务器备份把 pmsvshbx2 重锚为 sz（stage=5、4 板块），从 REPORT_HISTORY 恢复报告状态 |

## 六、第一次报告分析流程崩溃修复

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 19 | draft 生成待确认项但确认面板不渲染、卡死 | `parsePendingItems` 只匹配"待确认事项"，draft 用"③待确认："标题解析不出 | 章节匹配放宽到"待确认" |
| 20 | 新旧方向待确认项混淆 | phase-1 追加而非替换 | draft 解析结果为当前方向权威源，替换保留已确认状态，按 topic 缓存 |

## 七、自定义方向报告可找回

| # | 问题 | 修复 |
|---|------|------|
| 21 | 自定义方向选完就丢，找不回 | `selectTopic` 自定义方向落库 customTopics，顶部方向卡片持久显示可切回 |
| 22 | 历史报告被当前方向死死过滤 | 历史报告区加「查看全部方向」开关，列出该城市所有方向（含自定义）历史报告，每条可「切到此方向」 |
| 23 | 全部方向模式删错报告 | 折叠/删除用排序后索引 → 改用原始索引 oi |

## 八、200 用例端到端测试（注册 → 项目最后一步）

200/200 全部通过，期间发现并修复 5 个真实 bug（部分已并入上表）：

- **注册城市隔离漏洞**：随州等系统常驻城市（ACCOUNTS）可被重复注册，同城校验只查 USER_PROFILES → 补上 ACCOUNTS 校验
- **待确认解析阈值**：`t.length>5` 误过滤"园区地块"等 4 字短条目 → 改 `>=2`
- **补链清单跨链污染**（#15）
- **跨城市材料泄漏**：`buildKBCorpus` 用全局 cur 不校验 city，切他市仍取到随州上传文件 → 改为「当前项目城市===请求 city」才纳入
- 三大核心验证目标全部达成：AI 跟随最新修改（上传 5000万→改 8000万，AI 准确跟随）、文件上传修改生效、材料不串线（污染注入测试图谱/招引/补链清单三处全隔离）

测试污染全部清理，服务器回读校验健康：PROJECTS 只剩 sz、城市智库 4 板块完整、无脏账号、无残留派生项目。

---

## 数据健康最终状态
- PROJECTS: 仅 sz（随州，stage=5，城市智库 4 板块）
- REPORTSTATE: 仅 sz（香菇报告）
- USER_PROFILES: 张三/李四/黎四（无测试脏账号）
- 无残留派生项目、无遗留上传 chunk
