# RAG-04 增量索引与恢复验收

候选 `ede4d91d7e957ec3c5588c42bc3096f5ca9931f6` 已实现共享 SQLite generation/CAS、持久 jobs、立即撤销、owner 回源、后台构建与清理、显式启用范围和重启恢复。

18项正式门禁全部退出0；root 111/111、runtime 23/23、Electron 1/1零跳过，完整类型、构建/Gateway smoke和12项Harness CI通过。真实plugin SQLite探针在删除清理后保留1条来源tombstone，generation/chunk均为0；跨进程异常退出的租约恢复为第二次领取并拒绝旧租约发布。

`report.json` 对齐五项验收；`index-lifecycle-receipt.json` 保存Electron九项步骤；`review.json`保留两项独立复核修复；`failure-history.json`与historical/保留首次失败。`crash-lease-driver.mjs`为本次跨进程检查的原始agent驱动脚本。
