# 项目检索的离线评测与交付检查

这些入口封存查询、任务产物、排序策略及交付检查，所有执行记录标为 `driven_by: agent`。命令从仓库根目录运行；Windows 临时目录使用 `D:/tmp`。评测固定同一干净候选，执行器、适配器与原始输出均保存 digest。

## 查询与任务执行

```powershell
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-query-runner.ts <query-plan.json> <new-query-output>
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-task-runner.ts <task-plan.json> <new-task-output>
```

查询计划使用 `ProjectRagQueryExecutionPlan/v1`，包含 `sourceRoot`、`candidate`、`corpusRoot`、`corpusDigest`、`profile`、`candidatePolicy`、`argv`、`adapterInputs` 与 `heldOutRelease`。固定 240 条查询，各执行 page/full 两臂。适配器接收 `RAG_QUERY_*` 环境变量；full 臂从 `RAG_QUERY_POLICY_JSON` 取得排序候选，通过 backend/admin 的 `wiki.retrieval.evaluate` 执行，保存实际返回的 `plan.policyDigest`。普通 `wiki.retrieve` 使用当前 owner 策略。候选评测沿同一来源准入、检索与预算路径运行，模式为 manual。

`queries.json` 在执行前建立，逐臂原子保存检查点。`queries` 保存两臂均完成的查询，`partialQuery` 保存当前查询已获得的测量，`completedQueries` 只计完整查询。失败时 `failure` 记录 queryId、arm、失败阶段及原始原因，队列立即停止并返回非零退出码；启动或终止结果未确认时，命令回执的 `exitCode`、`timedOut` 保留 `null`。仅全 240 条查询完成后 `complete` 才为 `true`。每次执行使用新目录，日志、命令回执和已有 raw JSON 均保留。

任务计划使用 `ProjectRagTaskExecutionPlan/v1`，包含 `sourceRoot`、`corpusRoot`、`participantRoot`、`adapterArgv`、`adapterInputs`、`experiment`、`heldOutRelease`、`candidatePolicies` 与安全回执。participant 与任务证据目录互为独立兄弟目录。`candidatePolicies` 固定 local/quality/research 三个候选，`experiment.arms` 的 full 臂用 `policyDigests` 绑定它们。原 60 任务×3 repeats×3 arms 的顺序、预算与停止条件保持冻结。

任务适配器读取 `RAG_TASK_REQUEST` 和 `RAG_TASK_WORKSPACE`，接收原始预算与独立 session nonce。full 臂使用 `RAG_TASK_POLICY_JSON`，把实际 owner 回执的策略 digest 写到 `retrievalPolicyDigest`。返回候选、session、arm、experiment、五阶段费用、实测 token/模型调用/耗时、安全和关闭 writeback 的回执；独立判据重新读取产物。代码判据使用冻结原文与原平台的路径语义，Node 权限隔离禁止额外文件、子进程和 worker 访问。infra/unknown/timeout 状态保留在原始 attempt 中并停止后续队列。

## 封存并导入策略

```powershell
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-policy.ts <offline-report.json> <candidate-policy.json> <evidence-root/quality-policy.json> <capture-manifest.json>
```

`OfflineRagPolicyPackage/v1` 保存 `candidate`、带 path/digest 的 `report`、480 个 `queryCaptures` 与 `taskExecutions`。证据根下保存 `frozen-corpus/`、查询捕获、任务证据和 participant 目录。local/quality/research 的策略文件可放在同一根下，共用原始捕获。任务执行对象的 `evidenceDirectory` 和每个 `capture.workspace`、`materializationReceipt` 必须解析到此证据根内。

在知识设置的检索诊断中选择该 JSON 文件。Main 选取文件并传入文件名/digest；owner 在独立、130 秒以内的 Node 进程中读回原始捕获，验证候选策略与实验绑定，重新分级任务，再原子比较当前策略 digest 并晋级。未知用量、缺槽、安全问题或未达质量/成本门槛保留 held 回执。恢复上一策略使用同一 owner 的 CAS 路径；弱反馈保存 attach/dismiss 计数。

完整 Runtime 构建会生成 `dist/project-rag-policy-verifier.mjs` 和对应源码/输出哈希记录。编译器包含在独立校验器中；运行时只在显式导入时启动它。安装包使用已校验的 Node 24.16.0，Windows、macOS、Linux 的下载命令分别为 `node:download:win`、`node:download:mac`、`node:download:linux`。打包拒绝不匹配当前干净候选的校验器。

## 安装包与最终读回

```powershell
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-package.ts probe <delivered-runtime> <new-output>
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-package.ts upgrade-check <previous-runtime> <next-runtime> <owner.sqlite> <receipt.json> <installation-directory>
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-acceptance.ts soak <soak-plan.json> <new-output>
pnpm --dir openclaw_runtime exec tsx ../scripts/knowledge-rag-acceptance.ts readback <acceptance-manifest.json> <report.json>
```

probe 执行实际 SQLite/FTS、SDK、portable vector 和可选 ANN 读写，分别保存模型与容量是否执行。upgrade-check 在安装目标磁盘计算 staging/rollback 空间，并核对既有 owner SQLite 版本；实际写入仍由安装器和数据库 owner 执行。

`ProjectRagSoakPlan/v1` 固定源码输入、绝对 argv、探针/间隔预算及实际 72 小时。每次探针保存独立文件、执行时间和八个生命周期步骤；失败、探针复用、断档、候选变化、撤销泄漏、重复发布和未清理作业进入失败记录。

`ProjectRagAcceptanceManifest/v1` 绑定同一候选的 18 叶 `nodes`、五平台 `platforms`、20k/100k `capacity`、三个带 profile/path/sha256 的 `policyPackages`、`taskExecutions`、`soak` 及完整 `engineering`/`engineeringManifest`/`engineeringDirectory`。证据中已填写的 `candidate`、`candidate.commit` 与 `candidateCommit` 必须一致地匹配该候选；冲突字段记为 `candidate-mismatch`。读回重新验证策略包与任务收益，最终结果保存具体未满足项。

当前 G2 按[Windows 开发与测试顺序](WINDOWS-FIRST-PLAN.md)执行。manifest 显式指定 `qualificationScope: "windows-only"` 时，平台原件要求为 `win32-x64`，结果逐项列出四个 `deferred` 的 macOS/Linux 目标；其余能力、容量、质量、费用、安全、工程及稳定性门槛保持。`all-platforms` 或省略该字段执行原五平台合同；其他范围值拒绝执行。
