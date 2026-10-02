# 完整报告独立服务：本地验收与上线边界

2026-10-02（北京时间）。分支 feat/durable-full-report；未推送、未部署、未切生产、未调用真实模型/搜索。

## 已执行证据

- `python -m unittest discover -s tests -q`：249项通过（包含旧版回归与新增完整服务）。
- `node --test tests/*.cjs`：14项通过。
- `python scripts/build_frontend.py --check`：index与ops构建一致。
- `git diff --check`：通过。
- `test_full_cli.py`：实际独立API/worker进程完成16阶段，生成16MD、2DOCX、evidence.json共19载荷；API重启后逐个下载比对SHA256。
- `test_full_http_bridge.py`：真实本地HTTP服务端桥接提交→worker生成→Word下载；撤销合成会话后404。授权函数只用于隔离测试，未接生产身份。
- `test_full_process_recovery.py`：worker被强杀后研究子进程退出；租约过期可接续；完成前8阶段强杀CLI，重启后检查点哈希不变。
- `test_full_worker.py`：无限等待、子进程崩溃、慢校验受到硬截止；显式有限测试策略可在指定尝试数后失败，生产默认策略持续退避接续；常驻循环继续处理其他报告；synthetic/live认领隔离。
- `test_full_live_acceptance.py`：用实际OpenAIResearchProvider传输入口注入离线HTTP结果，证明分批累积25候选/15精选、17条核验记录、Python风险反向加权、长依赖不按6000字截断、401安全失败。这些不是实际城市研究。

## 10月2日后续修复

- `test_full_continuation_policy.py`：30次失败、累计9000秒后可继续，worker默认不在两小时退出；单次硬截止有效。
- `test_full_directions.py`：产业阶段的dir1/dir2/dir3与来源结构化保存；重载检查点后三个企业猎手检索各自方向，缺失或重复方向拒绝。
- CI补充python-docx依赖与独立服务镜像构建/断网导入冒烟；本机无Docker，容器结果以远端CI实际结果为准。
- 合并代码不等于启用服务：主站Dockerfile不复制report_service，server.py不接full-v1；默认生产入口不变。

## 真实修复而非只改提示词

1. 独立full_reports/full_steps/full_events表，持久化子步骤、尝试、退避、预算、租约与真实进展。
2. provider运行、上下文组装与阶段校验均在可终止子进程中；心跳不能突破硬截止，父进程消失时子进程退出。
3. 完成前验证全部研究阶段与文件包；19载荷有大小/SHA；缺文件、空文件、篡改、路径穿越、符号链接、冲突发布均有拒绝测试。
4. 企业研究按每批5家拆分；候选池至少25，精选至少15；引用按真实hostname和canonical URL处理。核验去重、评分由Python计算。
5. API拒绝浏览器Cookie/Origin；服务令牌不进入前端；桥接默认关闭、每次重新授权并校验组织项目关联。

## 使用方式（本地隔离）

先配置 `HXZ_FULL_TOKENS_JSON` 为显式长随机令牌到组织的JSON映射；禁止default租户回退。不要将令牌放进命令行或前端。

API：
`python -m report_service.full_cli api --db /absolute/local/reports.db --artifacts /absolute/local/artifacts --host 127.0.0.1 --port 8798`

Worker：
`python -m report_service.full_cli worker --db /absolute/local/reports.db --artifacts /absolute/local/artifacts --provider synthetic`

实际报告默认禁止。启用live需要运维显式配置模型/检索环境及 `HXZ_ENABLE_LIVE=1`，API还需 `--allow-live`。本次不启用。

POST `/v1/reports`：province/city/idempotency_key/synthetic；GET同路径列本组织任务；GET `/v1/reports/{id}`查询；GET `/v1/reports/{id}/artifacts/{manifest文件名}`下载。

`--once`仅执行一个持久子步骤；`--until-id ID --tenant ORG --run-limit SECONDS`为有界验收模式。常驻worker默认持续运行，不设两小时退出。默认任务无总尝试数/累计阶段或任务时长上限；单次180秒硬截止与30/120秒退避保留。`--run-limit`仅为明确指定的验收时间盒。数据库中0表示无总上限；历史已创建任务的显式非零上限仍保留，不静默改历史策略。

`Dockerfile.full-report`仅为待验收镜像模板。本机没有Docker，未构建/运行容器；不能声称云端部署已通过。

## 仍然未完成的生产门槛

- 真实研究质量：来源内容、企业真实性、已落地核查、数字时效及报告可读性需要付费真实试跑和人工抽查；结构校验不等于事实为真。
- 生产网站尚没有接入此服务。旧匿名sync不能充当用户身份；需以已验收的服务器会话与组织项目权限接入默认关闭的桥接。
- 知识库发布未启用；当前publication_status固定unpublished。evidence与Markdown是待交付产物，不是已经回填RAG的证明。实际发布适配、幂等回执与审核门禁仍需实现/验收。
- 旧闵行请求和其8份材料未动；需要审核后导入新任务，不应直接把旧running标成新完成。
- SQLite仅限单主机本地持久盘。跨主机多实例需PostgreSQL适配/迁移/备份恢复验收。API/worker镜像、磁盘、重启策略尚待真实部署验证。
- 失败事件持久保存且接口可读；外部告警通知通道尚未配置，不能声称通知已送达。

## 切换前顺序

先验收隔离真实城市报告，再处理服务器身份桥接及发布，再审核部署/恢复，最后经用户确认仅让一个系统消费生产新申请。不要先删除旧队列或关闭旧消费者来掩盖问题。
