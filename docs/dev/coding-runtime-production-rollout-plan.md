# Coding Runtime 生产接线与真实使用计划（Production Rollout Plan）

> 状态：**Draft / 待用户选定 Pilot 并授权实施**（2026-08-19）
> 目标：把已经验收的 Coding Runtime 能力接入真实生产路径并产生真实使用证据，不再只停留在 shadow / 未接线状态。
> 边界：本计划**不**翻产品锁，**不**改默认 flag。`liveReady=false`、`productApproved=false`、`defaultOn=false` 保持；代码默认仍全部 false。真实使用通过**显式工作区/会话配置覆盖**实现。
> 前置：P1-P7 均已验收（TF-0070..TF-0076 done），当前唯一未闭环的是“生产接线 + 真实使用证据”。

---

## 1. 现状判断（为什么现在可以进入真实使用）

- P1-P5 的 write/edit/apply_patch/exec UFTK 路径**已经有生产级接线**：`agent-tools.ts` 读取 `runtime.coding.uftk.*` 配置并创建 `FileTransactionService`、audit sink、ExecAuditor。当前不用的原因只是默认 flag false，而不是缺代码。
- P6A `concurrencyV2` 也已经在 `agent-tools.ts` 中接线：flag 开启即设置锁全局状态并把该选项传入 FTS。
- P6B/P7 的模块仍无生产调用方，需要新增少量内部接线：
  - `auto-checkpoint` → turn 开始 / 长任务前；
  - `exec-side-effect-undo` → exec 前自动 checkpoint + 副作用恢复路径；
  - `checkpoint-worktree-bridge` → worktree merge 场景。
- 因此“真实使用”不需要重写内核，只需要：配置通道、内部接线、allowlist、观测、kill switch、回滚预案。

---

## 2. 三个 Pilot 波次（推荐顺序，可合并决策）

### Pilot A：先让已接线的 P1-P5 + P6A 真实跑起来（0 新代码，最快）

开启：

```text
runtime.coding.uftk.enabled = true
runtime.coding.uftk.baseVersionGuard.enabled = true
runtime.coding.uftk.auditLog.enabled = true
runtime.coding.uftk.concurrencyV2.enabled = true
```

只对一个指定 workspace / agent 显式开启，不改默认。

真实效果：

- write / edit / apply_patch / delete / move 全部走统一事务、版本冲突检测、统一 journal。
- mutation / exec / rollback 事件真实写入 `<openclaw-state>/logs/coding-audit`。
- `previewRollback`、`rollback(batchId)` 变成真实可用恢复面。
- 并发写、跨进程 shared-read 在真实会话中生效并产生 observability。

完成标准：

- 连续 3 个真实开发日 / 或 50 个真实 coding turn；
- audit JSONL 与 SQLite 有真实事件；
- 至少一次真实 rollback / previewRollback 成功；
- 至少一次真实 E_CONFLICT 或锁等待被记录并确认非误伤；
- 无数据丢失、无 write/edit/apply_patch 语义回归。

### Pilot B：把 auto checkpoint 接进 turn 生命周期（少量新代码）

开启：

```text
runtime.coding.uftk.gitCheckpoint.enabled = true
runtime.coding.uftk.gitCheckpoint.pathScoped.enabled = true
runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled = true
runtime.coding.uftk.gitCheckpoint.lifecycle.enabled = true
runtime.coding.uftk.autoCheckpoint.enabled = true
```

接线点：

- `embedded-agent-runner` turn 开始前调用 `AutoCheckpointService.checkpointBeforeTurn(...)`；
- `mission-control` / 长任务 tick 前调用 `checkpointBeforeLongTask(...)`；
- 失败只 warn + 结构化结果，绝不抛进 turn。

真实效果：

- 每个真实 turn 自动产生 label 带 `requestId` 的 checkpoint；
- retention 自动清理旧 checkpoint；
- restore 有 safety snapshot + recoveryRef；
- 多会话并发写与 restore barrier 在真实场景中生效。

完成标准：

- 10 个真实 turn 产生 10 个可列查 checkpoint；
- 至少一次真实 restore 成功且 scope 外路径零变化；
- 至少一次 safety snapshot 真实恢复演练通过；
- retention 按策略删除旧 checkpoint，不删除最新和 safety ref。

### Pilot C：exec 文件副作用撤销接入 exec 恢复面（需设计决策）

开启：

```text
runtime.coding.uftk.execSideEffects.enabled = true
runtime.coding.uftk.execUndo.enabled = true
```

接线方案二选一，需你拍板：

1. **内部恢复路径**：exec 前自动做 path-scoped checkpoint；exec 后若 result 标记失败 / 需要撤销，由内部 recovery 调用 `undoExecSideEffects`。不新增模型工具。
2. **新增工具**：给模型新增 `undo_exec` 工具。需要改模型 schema，属新授权，不在此计划默认范围内。

推荐先做方案 1。

完成标准：

- 真实 exec 产生的 added/modified/deleted 文件副作用可撤销；
- 工作区外、非文件、gitignored 副作用结构化拒绝；
- 至少一次真实 exec 撤销成功，且 raw command 不落盘。

---

## 3. 需要的工程改动清单（按波次）

### 3.1 Pilot A

- 无新代码。
- 新增配置入口：允许在 Settings / runtime config 中显式对单个 workspace/agent 写这些叶子；如现有 config 已支持，则只做配置操作。
- 新增运行监控：审计 JSONL 行数、rollback 次数、E_CONFLICT 次数、锁等待 p50/p95。

### 3.2 Pilot B

- `agent-tools.ts` / `embedded-agent-runner/run`：创建并持有 `AutoCheckpointService`。
- 新 config leaf（可选）：`runtime.coding.uftk.autoCheckpoint` 已有；再补 allowlist 与策略即可。
- turn hook 必须默认关闭，仅 allowlist 命中时创建。
- 新增集成测试：真实 turn runner 下 checkpoint 创建、失败不抛、retention 生效。

### 3.3 Pilot C

- `bash-tools.exec.ts`：exec 前按 allowlist 创建 checkpoint；exec 完成时把 checkpoint id 写入内部 result metadata（不改变模型 schema）。
- 恢复调用面：内部 recovery API 或后续新工具。
- 新增集成测试：真实 exec 副作用撤销全链路。

---

## 4. 安全网与退出条件

1. **allowlist**：所有生产接线默认只对指定 workspaceRoot / sessionId 生效。
2. **kill switch**：每个波次保留“关闭一个叶子即回到旧路径”的能力；关闭后行为与 P1-P5 flag-off 逐字节一致。
3. **数据保护**：所有 restore 前 safety snapshot；禁止 `git reset --hard` / `git clean -f`。
4. **观测**：真实使用期间记录 audit 事件、lock metrics、checkpoint 数量、restore 结果、exec undo 结果。
5. **退出/回退**：
   - 若出现任何用户内容丢失、write/edit/apply_patch 语义回归、checkpoint 污染工作区 → 立即关闭相关 leaf，恢复原路径。
   - 产品锁始终不翻；退出不等于删除能力，只是停止显式启用。

---

## 5. 真实使用验收门禁

Pilot 完成后需要：

- 真实证据报告：配置、workspace、turns 数、audit 事件数、rollback/restore/undo 次数、性能 p50/p95、错误率。
- 回归命令：contract、coding-runtime 全目录、dcs flags、typecheck、contract:check、lint、verseshell、tsgo（按 P1-P7 residual 规则）。
- verdict 只能写 `PILOT_PASS_WITH_EVIDENCE` 或 `PILOT_FAIL`；仍不得写 UFTK GA / canary / maturity。

---

## 6. Task Forest 建议

- 新节点：`TF-0078 Coding Runtime Production Rollout Pilot A→B→C`，child_of `TF-0010`，depends_on `TF-0076`。
- 状态：先 `proposed`；用户选定 pilot workspace 和波次后 `ready`。
- P7 节点保持 done；不创建其他平行节点。

---

## 7. 需要你现在拍板的三个问题

1. **Pilot workspace**：用哪个真实 workspace / agent 先跑？（推荐一个活跃但非当前脏 WIP 仓库）
2. **波次范围**：先只做 A，还是 A+B 一起，还是 A+B+C？
3. **exec undo 形态**：内部恢复路径，还是新增模型工具？

确认后我就可以把 `TF-0078` 建为 ready，并开始最小接线。
