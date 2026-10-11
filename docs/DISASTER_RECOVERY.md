# 慧小招数据备份与恢复

## 当前方案与边界

当前阶段只使用 Railway，不新增第二家云服务商。Hobby 套餐不能启用当前项目的原生卷快照和时间点恢复；不要把方案说明当成已经启用 PITR 的收据，也不要自动升级套餐。

落实的备份机制是独立的 Railway 定时备份服务：每日执行一次 PostgreSQL `pg_dump`，将完整自定义格式备份以 AES-256-GCM 加密后保存到私有 Railway Bucket。每日版本保留 30 天，每月版本保留 12 个月。以最后一次**成功且校验完成**的备份时间计算保护窗口；正常每日执行时，最多可能损失约 24 小时数据。备份失败或没有成功运行时，这个窗口会扩大。

数据库包括账号和密码哈希、邀请码与使用记录、地区/主账号/子账号关系、工作区、月度报告排程和发布收据、研究检查点、报告原文、Word/其他交付文件字节，以及新增上传原件。只有已实际持久化的原件可以恢复；历史上只留下解析文字的上传无法凭空补回原件。

备份服务只运行备份脚本，不启动应用、研究 worker、AI 请求或城市月度调度。加密密钥、数据库连接和 Bucket 凭据通过服务端环境变量注入；不得写入 Git、工单、命令参数或日志。密钥要保存在受控密码管理器中：仅有密文、遗失密钥无法恢复。

**单供应商仍有明确边界**：数据库和 Bucket 同时受 Railway 账号与平台可用性影响。独立 Bucket 能降低误改数据库、错误发布和单个数据库损坏的影响，但不能覆盖整个平台长期不可用或整个账号被恶意删除。未来接入异地副本时复用现有加密备份对象，不必更改业务数据库结构。

## 验收与日常维护

1. 第一次上线后立即运行一次完整备份，并检查备份完成收据、密文对象、SHA256 和字节数。
2. 从 Bucket **实际下载该备份**，校验密文 SHA256，验证 AES-GCM 标签，解密后校验明文 SHA256，再恢复到全新 `hxz_drill_*` 临时数据库。
3. 只读检查所有非系统表的行数与内容摘要、结构摘要和序列状态；逐个读取所有报告交付物与上传原件，核对完整字节长度和 SHA256。验证已完成报告的 manifest 文件、邀请码与城市/工作区、账号成员关系及报告发布引用。
4. 演练不连接前端，不启动任何 worker/调度/AI；检查完成即删除自建临时数据库及临时明文。收据仅保留计数、SHA、时间和检查结果，不复制客户行数据。
5. 每月重复一次恢复演练；重要数据结构迁移后追加一次。演练成功只证明指定备份可以恢复，不等于所有未来备份都有效，也不等于报告事实质量已经通过。

每天检查最近成功备份时间和定时服务退出状态。超过 30 小时没有成功备份就应处理；现阶段没有另行开通告警服务，不应声称已经实现无人值守告警。建议另行安排通知接收方式。

`scripts/disaster_recovery.py` 是人工演练工具，默认 `inspect` **只读**；只有显式 `drill` / Bucket 恢复演练会创建临时数据库。它拒绝普通数据库名，只接受新的 `hxz_drill_*` 名称；不会覆盖已有数据库。出现异常时检查安全收据中的清理结果，确认没有遗留临时库。

```sh
# 这些标识符不是密钥。数据库及 Bucket 凭据留在 Railway 服务环境中。
python scripts/disaster_recovery.py inspect \
  --project PROJECT_ID --environment ENVIRONMENT_ID \
  --app-service APP_SERVICE_ID --database-service POSTGRES_SERVICE_ID \
  --receipt /private/path/read-only-check.json

# 完整 pg_dump 与隔离恢复演练；本机无需安装 PostgreSQL 客户端。
python scripts/disaster_recovery.py drill \
  --project PROJECT_ID --environment ENVIRONMENT_ID \
  --app-service APP_SERVICE_ID --database-service POSTGRES_SERVICE_ID \
  --receipt /private/path/restore-drill.json
```

`drill` 将一份 PostgreSQL 自定义格式备份保存在本机 `~/.codex/private/huixiaozhao/backups/` 的全新目录，目录权限 `0700`，备份文件权限 `0600`。这是一次人工恢复验证副本，不能替代每日 Bucket 备份。生产数据库仍可并发写入；`pg_dump` 自身使用一致的 MVCC 快照。检查清单以该份 dump 恢复后的同一事务快照为准，不能拿稍后的生产计数差异判断备份损坏。

实际 Bucket 演练使用 `restore_bucket_backup(manifest_key)`。定时容器正常运行后立即退出，因此不能假设它一直在线供 SSH。可在一次人工启动中依次执行备份和演练，完成后恢复正常的短时备份入口；不必加常驻 `sleep`，也不新建应用服务：

```python
import json
from scripts.backup_job import run
from scripts.disaster_recovery import restore_bucket_backup

backup = run()
restored = restore_bucket_backup(backup['manifest_key'])
print(json.dumps({'backup': backup, 'restore': restored}, sort_keys=True))
raise SystemExit(0 if restored.get('integrity_passed') and restored.get('cleanup_complete') else 1)
```

如有已运行的备份容器，也可用 `bucket-drill --backup-service SERVICE_ID --manifest-key EXACT_MANIFEST_KEY`，其他 Railway 标识参数与上面的命令相同。必须指定本次成功备份的完整 manifest key，不盲目选择“最新”文件；整个过程只下载对应的一对 manifest/密文对象，不修改 Bucket 备份。

## 真正故障时的恢复顺序

1. 暂停业务写入、应用 worker、月度排程和 AI 外部调用，记录事故时间及最后可用备份。不要先清空或覆盖生产数据库。
2. 选择事故发生前的备份，完整下载、解密、校验，并先恢复到**独立新数据库**。用兼容的 PostgreSQL 主版本恢复；升级主版本另作迁移测试。
3. 执行上述完整性检查。还要人工核对一个已有账号、一个邀请码、闵行等地区的主/子账号关系、报告下载和上传原件。仅有文件 SHA 检查不能证明页面与权限均正常。
4. 切换数据库连接前处理旧会话和浏览器缓存，避免旧客户端把恢复后的数据再次覆盖。先在隔离应用环境验证登录、权限与报告下载。
5. 核对 `REPORT_REQUESTS`、`REPORT_PUBLICATIONS`、地区 `nextReportAt`、运行中的任务租约/检查点。恢复时可能同时回退发布收据，不能只因任务显示待运行就重新生成、重发报告或再次调用 AI。不得通过演练工具自动清空这些业务记录。
6. 明确切换新数据库后再开放写入；最后恢复 worker 和月度调度。保留原数据库用于回退，经过验收后再按保留政策处理。

当前没有承诺固定恢复时长。一次真实演练记录数据库大小、下载、解密、恢复和校验耗时之后，再制定可验证的恢复目标。

## 以后升级时

如果升级到支持原生备份的套餐，可增设每日/每周/每月卷快照及 PITR，缩短误操作恢复窗口；它们与加密逻辑备份并行。Railway 的原生 PITR 会恢复到独立数据库，仍需校验后切换连接，不能替代本手册的业务验收。

- Railway 官方：[备份与恢复 PostgreSQL](https://docs.railway.com/guides/postgres-backups-restores)
- Railway 官方：[时间点恢复](https://docs.railway.com/volumes/point-in-time-recovery)
- PostgreSQL 官方：[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)
