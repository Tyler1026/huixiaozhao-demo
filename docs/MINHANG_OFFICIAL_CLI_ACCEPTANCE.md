# 闵行区正式 CLI 流程验收（2026-09-30）

## 目的

上次松江区验收用调试脚本手动逐阶段跑，绕过了正式的 `python -m report_service worker` 命令。这次改用完整的正式 API + worker CLI 流程，不写任何绕过内部方法的脚本，验证服务本身（而不是内部实现）真正可用。

## 过程与发现

1. `python -m report_service api` 正式启动，`POST /reports` 提交闵行区任务。
2. 第一次 `worker --provider live --once` 用旧的 `DEFAULT_OUTPUT_TOKENS=800` 默认值，`industry` 阶段撞上 DeepSeek 的 `finish_reason=length` 截断保护，任务失败。这是产品缺口：**正式流程要求用户手动传 `HXZ_MODEL_MAX_TOKENS` 才能跑通，默认值本身不足以支撑一个真实研究阶段**（此前松江验收时就手动调过这个值，但没有把默认值本身改掉）。
3. 修复：`DEFAULT_OUTPUT_TOKENS` 从 800 提到 3500（新增回归测试锁定"默认值必须 >= 3000"这个产品要求，防止再退化）。`report` 综合阶段仍固定使用 `MAX_OUTPUT_TOKENS=8000`。
4. 任务失败后，`status=failed` 且 `worker --once` 不会主动重试失败任务（只处理 `queued` 或过期的 `running`）——这是正确的设计（防止无限静默重试），但暴露了 CLI 层面确实需要显式调用 `POST /reports/{id}/retry` 才能恢复。验证了这个已有 API 端点可用：调用后任务状态从 `failed` 变回 `queued`，并保留了之前已完成阶段（`economy`）的 checkpoint，没有从头重跑。
5. 重试后再跑一次 `worker --once`，**一次性完成剩余全部 9 个阶段**，退出码 0，`worker result: {'status': 'completed'}`。

## 结果

闵行区报告完整生成，6890 字符。内容包含真实数据引用（2024年GDP 4119.25亿元、"3+3+3"产业体系等，均标注来源URL），并主动标注证据强度分级（A=多来源印证/B=单一来源/C=无法核实）和"企业落地状态存疑""证据时效性存疑"等风险提示——这个证据分级细节没有在提示词里被明确要求过，是模型在综合阶段自发产出的，质量优于此前松江区那次的输出。

## 结论

正式 CLI 流程（API 提交 → worker 执行 → API 读回）本身可用，不需要绕过内部方法。这次验收同时暴露并修复了一个真实的默认配置缺陷：`DEFAULT_OUTPUT_TOKENS` 过低会导致任何真实调研阶段大概率截断失败，不是闵行区或松江区特有的问题，而是此前默认配置本身不足以支撑正式使用。

未在本次范围内：任务本身仍不产出企业推荐结构化清单、Word文件、独立事实核验步骤；未接入生产网站或城市智库。
