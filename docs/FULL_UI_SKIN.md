# 全站界面迁移与复原

2026-10-24：将《慧小招_完整网页》v1.4.3 的视觉、素材与布局接入真实业务项目。

## 页面入口

- `/` 或 `/welcome`：公开服务首页。
- `/app`：客户工作台；`/app?screen=login` 和 `/app?screen=register` 只控制未登录时的账号入口。
- `/index.html`、`/client.html`：保留原客户网页的兼容地址。
- `/ops`、`/ops.html`：运营后台。

## 源码边界

`frontend/index/full-skin.css` 与 `full-skin.js` 为客户端展示层；`frontend/ops/full-skin.css` 与 `full-skin.js` 为运营端展示层。由现有 `frontend/manifest.json` 拼装，修改后运行 `scripts/build_frontend.py`，并更新 manifest 中的输出 SHA256。

首页位于 `frontend/public/landing.html`；公共资源位于 `frontend/public/skin/`，通过 `/static/skin/` 读取。视频支持 HTTP Range。静态文件处理器只允许此目录内的视觉资源类型，不对外提供源码、密钥或业务数据文件。

迁移保留原认证、权限、同步、上传下载、需求提交与回执、企业核验、报告暂停继续和引用依据。原型中的演示账号、虚构数据、网络拦截、存储替代及预览导航未进入生产文件。资料中“政策、规划与国家战略”使用展示名称，兼容原存储主题，不改写报告正文。

## 改版前复原点

- 已部署主分支提交：`b0c26e151d6db24c9da38b37b9a7fd90282e4863`。
- 本地等价提交：`5eb8a20`；两者文件树均为 `a3244e3b2062d4aa5082236d26c2fed9bf8a2f11`。
- Git 标签：`restore/pre-full-ui-20261024`。
- 独立源码归档和 Git bundle 保存在本次工作区的 `restore-point-20261024-before-full-ui/`，附校验记录及复原脚本。

需要查看旧版时，可从该标签创建新的工作树，或者将独立归档解压到新目录。复原脚本只创建新目录，不覆盖当前代码。发布后要回退线上界面，应部署上述旧版本；不要重置业务数据库。本轮没有数据库迁移。

## 验证

使用隔离文件存储和独立本地 PostgreSQL `report_ci` 运行全部 Python、Node、HTML/JS 构建检查和真实 HTTP 入口测试。浏览器视觉场景使用合成数据；账号、注册和需求提交另走真实本地服务验证。测试不得使用生产数据库或付费模型凭据。

全部测试证据、浏览器截图及汇总存放在工作区 `full-ui-test-results-20261024/`。最终结果以本次汇总报告为准。
