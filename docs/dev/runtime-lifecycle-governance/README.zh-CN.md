# Runtime Lifecycle Governance — 合并后的开发程序入口

> 状态：Phase 0 Shared Foundation、Phase 1 Session Cleanup Finalizer And Drain、Phase 2 Session Delete Operation Journal And Terminal Gate、Phase 3 Same-Gateway Goal Wake Loop、Phase 4 Durable Helper And Restart Recovery、Phase 5 Read Model And UI Projection 均已交付；Phase 6 Production Audit And Closeout 已交付（audit-6，程序整体收卡）。
> GA hardening：2026-08-19 已补齐 packaged Electron 真实入口验证（normal-exit + cancel，rawSecretPersistenceFindings=0）与 10 周期真实进程 goal-wake canary（processPollToolCalls=0、duplicateWakeTickCount=1/cycle、flag-off parity 10/10）；RLG-only 验收不再以其它 workstream 脏树为条件。默认开关与产品锁未变：goal-wake / durable-helper 仍 default-off，VerseShell liveReady/productApproved/defaultOn 仍为 false。
> 审计：`artifacts/runtime-lifecycle-governance/audit-0.json` 至 `audit-6.json` 均 PASS；程序基线 `734ec877e75682861103660fbdea2bd55253ece0`。
> 证据：`dead-code-caller-map-phase1..6.json`、`phase1..6-loc-accounting.mjs`、`phase1..6-timing-baseline.json` 与 `preexistingWipExcluded` 归因。
> 本程序已合并为一个完整开发规范（7 个阶段：Phase 0–6 + 量化验收）。原两个工作为：
> 1. Session Lifecycle Governance（会话生命周期治理）
> 2. Goal Loop Durable Process Wake（goal/loop 持久进程唤醒）

## GA hardening 证据

- 执行规范：`harness/specs/tasks/runtime-lifecycle-governance-ga-hardening.md`
- 命令：`pnpm run verify:runtime-lifecycle-ga`
- 证据：`artifacts/runtime-lifecycle-governance/ga-acceptance.json`、`ga-acceptance.md`
- 边界：本硬化只补证据与验证脚本，不翻 default-on，不修改产品锁，不重开 Phase 0-5。

## 唯一权威

- 执行规范：`harness/specs/tasks/runtime-lifecycle-governance.md`
- 硬规则：`harness/specs/rules/runtime-lifecycle-governance-boundary.md`

后续开发先运行：

```bash
pnpm harness context --spec harness/specs/tasks/runtime-lifecycle-governance.md
```

每个阶段产出 audit JSON 后，用同一脚本机器验收：

```bash
pnpm run runtime-lifecycle-audit --phase <phase>
```

## 合并后的契约

| 关注点 | 唯一 owner | 规则 |
|---|---|---|
| 会话身份/代际 | per-agent SQLite session store | `agentId + canonicalSessionKey + expectedSessionId` |
| 副作用准入 | SessionAdmissionRegistry | 所有 spawn/enqueue/arm 前拿 permit |
| 清理 finalizer | cleanupSessionBeforeMutation | fence -> abort -> wait -> drain -> mutation |
| 会话删除 | session delete operation journal | operationId + manifest digest + store_committed 同事务 |
| goal 真相 | mission_runs | revision + active_tick_id + last_wake_id fencing |
| wait 真相 | flow_runs(controller_id=goal-wake) | 仅 SQL CAS writer |
| process 真相 | task_runs(runtime=process) | 进程退出只 finalize task_runs；level-check 再唤醒；不自动重启 |
| 耐久 helper | background-processes/<runId>/ 文件协议 | `intent.json -> started.json -> exit.json`；cancel 只写 `control.json`；runDir 配额/TTL；session delete/reset 级联取消并删 runDir |
| 普通 exec/process | native supervisor | 内存态，重启标 lost；wait=goal default-off |
| 终端 | Electron TerminalSessionManager | keep_on_leave；idleTtl=0；cap=null |
| 读模型 | SessionActivity | 只读投影 goal/process/lineage，无写路径；UI 不新增生命周期 action |

## 验收与证据

- Phase 3 量化证据：`artifacts/runtime-lifecycle-governance/audit-3.json`（armTxCount=1、processPollToolCalls=0、重复 wake 不重复 tick/副作用）
- Phase 4 量化证据：`artifacts/runtime-lifecycle-governance/audit-4.json`（secretPersistenceFindings=0、crash matrix 全绿、Windows detached helper 实测通过；Electron packaged build 未在本机复现时 fail-closed）
- Phase 5 量化证据：`artifacts/runtime-lifecycle-governance/audit-5.json`（`activitySnapshotWriteFindings=0`、组件级 `tests/unit/session-activity-panel.test.tsx` 覆盖 goal/process/lineage 面板状态、contract/comms/coverage/cycle/dup 门禁全绿）
- Phase 6 收尾证据：`artifacts/runtime-lifecycle-governance/audit-6.json`；`pnpm run runtime-lifecycle-audit --phase all` 全部 PASS；superseded 临时提示词与 scratch 已删除
- Phase 3/4/5 LOC 记账：`phase3-loc-accounting.mjs`、`phase4-loc-accounting.mjs`、`phase5-loc-accounting.mjs`；goal-wake 实现位于 `openclaw_runtime/src/agents/goal-wake-*.ts` 与 `process-run-reconciler.ts`

## 支持文档

- `docs/dev/session-lifecycle-control-plane/*`：会话治理设计/证据/提示词。
- `docs/dev/goal-loop-durable-process-wake-design.md`：goal 设计 v2。
- `docs/dev/mission-goal-durable-scheduler-development-plan.md`：goal 原始计划。
- `docs/dev/goal-loop-durable-process-wake-prompt.md`：goal 实施提示词。

这些支持文档是设计来源，不是规范权威；与 harness 规范冲突时以 harness 规范为准。
