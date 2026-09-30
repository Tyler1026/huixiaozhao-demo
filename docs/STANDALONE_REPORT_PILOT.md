# 独立报告服务试点运行边界

本模块不依赖 Violoop、Agenda、桌面在线状态或旧 `/api/sync` 接口。它是独立进程验证版本，不是已上线的报告系统。

## 本次与生产的关系

- 新代码仅位于 `feature/standalone-report-service` 工作树。
- 原 `index.html`、`ops.html`、生产启动入口和旧轮询配置不变。
- 不自动领取生产 REPORT_REQUESTS，也不把合成结果推入客户城市包。
- 原来排队的松江报告不会因为本地试点完成而自动恢复。
- 暂用 SQLite 单机持久化队列验证恢复语义；正式云端多实例要适配 PostgreSQL，不能把 SQLite 文件放在共享网络磁盘上冒充分布式队列。

## API 与身份边界

试点 API 是服务间接口，不是公开注册入口。API 服务只代表配置中的一个租户，令牌由服务器环境变量提供；不接受浏览器随意传入组织身份。正式接入现有网站前需要把用户会话与组织授权接到 API，不能把服务令牌嵌在前端。

提供提交任务、读取任务与健康检查。原子认领、心跳、阶段检查点和完成提交由 worker 内部执行，不开放给未经认证的浏览器。

## 模型与证据

合成模式只用于基础设施验收，每一步输出都标记为合成测试，不是松江事实研究。

真实模式必须显式开启并配置模型端点、密钥、模型名和搜索密钥，不从 Violoop 或旧网站自动读取凭据。本轮不运行真实付费调用。当前搜索结果摘要只能作为证据线索，不能称为已核验原文。后续仍需原文抓取、完整引用映射和研究质量门禁。

程序控制阶段顺序并持久化结果，模型不能改变任务状态或发布城市包。任务失败时只公开安全错误码，不把原始异常、密钥或完整上下文发给客户端。

## 本地启动与重复验收

工作目录：`/Users/ryan/projects/huixiaozhao-report-service`。

无需任何密钥的一键隔离验收（临时令牌和数据库自动清理，含 API 重启）：

```sh
python -m unittest discover -s tests -p 'test_report_service_acceptance.py' -v
```

手动启动需预先设置 `HXZ_REPORT_SERVICE_TOKEN`（至少32字符的随机令牌），可用 `HXZ_REPORT_TENANT` 指定单租户。令牌也支持 JSON 形式的令牌到租户映射，不要写进前端或仓库。两个进程使用同一个绝对数据库路径：

```sh
python -m report_service api --db /absolute/persistent/reports.db --host 127.0.0.1 --port 8797
python -m report_service worker --db /absolute/persistent/reports.db --provider synthetic --once
```

`POST /reports` 的 JSON 为 `{"province":"上海","city":"松江区","idempotency_key":"unique-test-key"}`；带 `Authorization: Bearer <service-token>`。`GET /reports/{id}` 读取状态和完成后的正文；`POST /reports/{id}/retry` 对失败任务显式重试，最多总计3次认领，保留已完成阶段；不同租户不可重试。`GET /healthz` 不需要令牌，仅证明进程响应，不表示报告成功。

真实适配器为 OpenAI-compatible chat completions + Brave-compatible search；`HXZ_MODEL_URL` 是完整 HTTPS 接口地址，`HXZ_MODEL_KEY`、`HXZ_MODEL_NAME`、`HXZ_SEARCH_KEY` 从环境注入，`HXZ_SEARCH_URL` 可选。必须 `HXZ_ENABLE_LIVE=1` 并指定 `--provider live` 才会调用。测试完成不代表已批准真实调用。当前模型默认每阶段800输出token，前序上下文6000字符分配给各阶段，属于连通性试点，不是长篇研究配置。

## 本轮实测证据（2026-09-30）

- 104 项 Python 测试全通过（原有41项、新增63项）；14项 Node 测试全通过；前端构建一致性通过。
- 独立 API 进程接受合成松江申请，独立 worker 完成，API 停止再启动仍读回同一报告。子进程环境剔除了模型密钥与桌面配置。
- 8线程同时提交同幂等键只有一个新任务；8线程认领只有一个有效持有者。
- 租约过期可接管，旧租约无法完成；失败可显式重试并保留检查点，超出预算拒绝。
- 审查回归覆盖：负请求长度、并发幂等、失败退出码、跨域重定向认证头清理、禁止HTTPS降级、响应1MB上限和关闭、模型输出截断拒绝、前序阶段预算分配。
- 未部署、未推送、未调用真实模型或搜索；未覆盖完整原始报告质量、Word导出或城市包发布。
- worker 常驻模式在任务失败后退出，部署时需进程监督器负责重新拉起；不能据此宣称无人值守云端服务已就绪。端点只允许可信运维配置，目前不提供DNS钉住防重绑定能力。

## 切换生产前

1. 选择模型与检索供应商、预算上限和最大重试费用。
2. 在隔离环境完成一份真实城市报告，并逐项评估来源、企业推荐和报告格式。
3. PostgreSQL 多 worker 并发、重启接管、备份恢复和容量测试。
4. 接入网站的用户/组织身份和任务进度，不复用整库同步承担任务状态。
5. 增加 Word、对象存储及人工审核后城市包发布。
6. 经确认后只让一个系统消费新申请，保留旧任务处理和回滚办法。
