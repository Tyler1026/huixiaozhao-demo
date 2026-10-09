# 慧小招 — AI 招商系统

政府端城市智库、研判需求、项目管理、政企对接，以及管理端需求池、城市报告申请与发布。

## 城市报告默认独立运行

管理端提交省份与城市 → 服务器保存申请并归属独立报告引擎 → 云端 Python worker 直接调用模型与检索 → PostgreSQL 持久保存检查点 → 完整与精简 Word 下载 → 管理端推送四类城市智库材料及研判正文。

报告生成无需 Violoop、Agenda、桌面在线设备或本机绝对路径。新申请以及有效未认领的历史 pending 不会交给旧 Agent；配置缺失时保留申请并等待，不回退旧执行器。历史 running/done 保留，旧 Word 下载保持不变；缺少独立研究包的未发布历史报告需重新生成后发布。

业务标准保留：产业方向 → 产业链缺口 → 对应企业 → 独立核验 → 匹配评分与行动计划。deep 每方向至少25家最终企业，standard至少15家；产出16份 Markdown、完整与精简两份 Word，知识库发布须通过完整性门禁。

## 启动与配置

```sh
pip install psycopg2-binary esprima pdfplumber python-docx
python scripts/build_frontend.py --check
python server.py
```

网站端口使用 Railway 注入的 `PORT`，本地默认5050；管理端地址 `/ops`。

管理端必须设置 `HXZ_ADMIN_USERNAME` 与足够强的 `HXZ_ADMIN_PASSWORD`；没有默认管理员密码。凭据仅由部署环境注入，不要写入仓库、网页或日志。首次上线这套认证后，已有浏览器会话需要重新登录；已有账号保持原密码，首次成功登录时在服务端迁移为加盐哈希。

普通用户在 `/` 使用账号密码登录，通过“有邀请码，注册加入团队”首次注册；已有账号在设置页用邀请码加入其它团队，原团队保留。邀请码在 `/ops` 的注册用户页面生成、登记分发或撤销；登记邮箱不代表已发送邮件。注册、加入、移除及邀请码变更均由服务端事务确认，通用同步接口不接受账号或邀请码修改。会话使用 HttpOnly Cookie，生产环境启用 Secure；跨站写入被拒绝。多个同城团队仍按独立工作区隔离。

真实报告需要环境配置：

- `DATABASE_URL`：PostgreSQL，存申请、检查点与全部交付字节。
- `DEEPSEEK_API_KEY`，或完整的 `HXZ_MODEL_KEY`、`HXZ_MODEL_URL`、`HXZ_MODEL_NAME`。
- `HXZ_SEARCH_KEY` 与 `HXZ_SEARCH_PROVIDER=exa` 或 `brave`；已有 `EXA_API_KEY` 可在内存中适配。
- `HXZ_ENABLE_LIVE=1`：明确允许真实付费研究；未设置时 supervisor 等待配置，不发起研究。

`HXZ_REPORT_ENGINE` 可省略；现有 `standalone` 值兼容。其他值只阻止执行，不恢复旧 Agent 的队列访问。凭据只由环境注入，不写入网页或命令行。

配置检查 `python -m report_service.hosted --check` 不访问数据库、检索或模型，仅返回缺项/无效项名称。`/health` 的 `report_engine` 仅证明配置及进程状态，不能证明真实报告质量。

## 开发与验证

`frontend/` 是前端源文件，`index.html`、`ops.html` 由 `scripts/build_frontend.py` 生成；修改源文件后更新 manifest 的 SHA256 并构建。`backend/` 是网站存储及接口边界，`report_service/` 是独立研究、恢复、Word 构建与发布服务。

```sh
python -m unittest discover -s tests -p 'test_*.py' -q
node --test tests/test_*.cjs
python scripts/build_frontend.py --check
python scripts/check_inline_js.py ops.html index.html
python scripts/smoke_entrypoint.py
```

完整 Git 历史用于旧版行为回归。PostgreSQL 集成测试只接受本机隔离的 `report_ci` 数据库与 `HXZ_TEST_DATABASE_URL`，不能使用生产数据库；CI 自动运行该 fixture。合成数据仅用于隔离测试，不能作为客户报告发布。

运行、恢复、取消、发布以及真实报告验收边界详见 [独立报告引擎说明](docs/INDEPENDENT_REPORT_ENGINE.md)。
