# 独立报告服务：DeepSeek + Exa 真实验收记录

## 配置

- 模型：DeepSeek `deepseek-chat`（OpenAI 兼容协议），`HXZ_MODEL_URL=https://api.deepseek.com/chat/completions`。
- 检索：Exa，`HXZ_SEARCH_PROVIDER=exa`，协议为 POST JSON + `x-api-key` header（与 Brave 的 GET + 查询字符串 + `X-Subscription-Token` 结构不同，`providers.py` 已按 `search_provider` 参数分流两种协议，Brave 路径保持不变并有回归测试）。
- `report` 综合阶段自动使用更大的输出预算（`MAX_OUTPUT_TOKENS`，当前 8000，对齐 DeepSeek `deepseek-chat` 8K 上限），其余阶段使用 `HXZ_MODEL_MAX_TOKENS`（建议 2200，经研究阶段实测足够）。

## 本次真实验收（松江区，2026-09-30）

在隔离本地环境（临时 SQLite、独立 API+worker 子进程，未接入生产、未消费生产 `REPORT_REQUESTS` 队列）用真实 DeepSeek + Exa 调用完整跑通全部 10 阶段：

economy → industry → competition → policy → chain → enterprises → verification → scoring → action → report

- 每个研究阶段（economy/industry/competition/policy/chain/enterprises）都触发了真实 Exa 检索，证据来源为公开可查的松江区政府网站等，输出带真实来源 URL。
- 对无法核实或口径冲突的数据点，模型按提示词要求标注为"待核实"，未观察到编造具体数字的情况。
- `report` 综合阶段产出 8268 字符的成文报告，明确声明"不引入任何新的原始数据"，仅综合前序阶段结论，并如实说明"无法独立访问或验证任何 URL 的实际内容"。

## 已知限制（与原 14-Agent 流水线的差距，非本次目标）

- 企业推荐没有原流水线要求的"每方向 15-25 家、按缺口环节标注补链信号"的结构化产出。
- 没有独立 `fact_checker` 交叉核验步骤，`verification` 阶段是同一模型自我核验，可信度弱于独立核验。
- 没有生成完整版/精简版双 Word 产物，也没有回填城市智库或标记 `REPORT_REQUESTS` 完成。
- 未做大规模城市/并发压力测试，仅验证单个任务端到端跑通。

## 结论

DeepSeek + Exa 的组合协议、凭据配置和 token 预算已验证可用，能产出有真实证据支撑、不编造数据的报告草稿。距离替代现有生产报告流程，仍需要完成上述限制项，以及网站接入、PostgreSQL 迁移和真实成本/并发验收。
