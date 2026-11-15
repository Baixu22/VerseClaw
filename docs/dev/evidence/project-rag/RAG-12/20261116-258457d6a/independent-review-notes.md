# RAG-12 审阅修复复核

当前 C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX 的未提交修复对应完整 c8aef961e 审阅的三条发现，修复仍属于 RAG-12：

1. retrieval-index 同一 owner 的重复 enable 保留暂停意图；新 owner 不继承旧 owner 的暂停。新增暂停→重复启用→重启→重复启用回归。
2. ProjectionStore 在新的 owner 观察中为过期/取消的未完成 intent 建立新作业，保留已完成代际及真正失败的尝试预算。新增过期和三次取消耗尽尝试的回归。
3. worker 先提交不可检索的 building 代际及 FTS 数据，再发 prepared，父进程重验 owner pin 与实际文件占用。store.activate 的同一事务重验 source/lease/generation fence，并为元数据表与索引页、WAL 提交帧、可能的 DB checkpoint 增长和 SHM 预留空间；预算不足回滚激活。公开 publish 继续通过相同私有方法在单一事务完成原有直接发布，stage/activate 是 Worker 的分阶段入口。

读取 D:/tmp/project-rag-g2-relay-01a1df5c/staged-publication-unit.json（18/18）、staged-publication-integration.json（15/15），以及 pause-repro.json、expired-repro.json 的先失败后修复证据。包括 staging 不可检索、原始数据增长超限、激活前撤权的负例。重点核查预算上界、SQLite 事务/锁、scope 与 generation CAS、取消与失败历史、接口调用者、缓存与查询准入。

测试 fixture 增加仅在 CLAWX_E2E_APP_LOGS=1 时的进程退出/窗口关闭/crash 诊断。原 c8 的两个正式 E2E 因页面关闭失败；单独诊断运维旅程已通过，但不能代替修复后的正式 E2E。provider-settings 旅程新增真实 vector 启用→暂停→Gateway 重启→保持暂停→显式恢复，后续仍检查本地 768、远端 4096 embedding。

只读核查，无嵌套审阅、无源码修改、无安装或进程终止。遵循 AGENTS.md 的简明、证据对应表达规范，标 driven_by: agent、actor: codex/project-rag-g2-relay-01a1df5c、realHumanEvidence: false。

机器结果约束：code_location.file_path 必须使用仓库相对路径（例如 openclaw_runtime/src/knowledge/retrieval/projection-store.ts），符合 autoreview 校验器；该字段是机器定位信息，不是最终回复的文件链接。最终人类阅读的文件链接仍按 AGENTS.md 使用绝对路径。

## 后续两条发现的修复

被动 observe 默认不续期。只有 Controller.resume 或未暂停的 start 调用 reconcile(false, true)，才将 refreshInterrupted 传到 ProjectionSourceIntent；暂停/周期扫描继续观察 owner 权限和真实来源变更，但不为未变化来源重建到期作业。恢复调用会绕过已有扫描的合并，排队完成当前 owner 的新观察。识别 runProjectionWorker 实际错误 Projection worker deadline exceeded。新证据 review-fix2-runtime.json 为20/20，review-fix2-integration.json 为27/27；包括实际Worker到期、被动观察稳定job/intent及完整暂停后恢复。

## 混合尝试预算

取消在匹配的 leased claim 上归还本次 attempt，重复/旧 lease 的 fail 不会重复扣减。恢复新作业携带 currentJob 已消耗的真实 attempt；已达3次的真实失败不再续期。增加真实失败两次→第三次取消→恢复仍有attempt=2→下一次真实失败耗尽预算的回归，以及纯取消不消耗失败预算和真实worker超时保留attempt=1的验证。请检查 carry 仅用于同一当前 intent 的执行恢复，源版本变化或显式重建保持原有新任务语义。

最新结果：review-fix3-runtime.json 的21/21与 review-fix3-integration.json 的27/27全部通过。真实失败→取消→恢复的混合预算已实现，不再将保留失败归零；暂停造成的取消归还自己的一次claim，worker实际超时保留其失败次数。
