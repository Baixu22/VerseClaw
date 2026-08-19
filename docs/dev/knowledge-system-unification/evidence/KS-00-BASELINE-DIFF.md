# KS-00 基线差异与 WIP 归属复核

> 快照日期：2026-08-17
>
> 结论：规划基线可交付；实现 diff 为跨 KS-01～KS-03 的并发 WIP，尚未形成包级验收证据。
>
> 说明：本文是 KS-00 时点的历史快照。后续 KS-01～KS-03 已串行实现并通过独立验收，终版证据见 `KS-01-03-ACCEPTANCE.md` 与 `KS-00-03-INDEPENDENT-ACCEPTANCE.md`。

## 1. Git 基线

- 工作树：`D:\verse_claw_worktree_knowledge`
- 分支：`codex/knowledge-system-unification-plan`
- HEAD：`734ec877e75682861103660fbdea2bd55253ece0`
- `origin/main`：同一提交
- 主工作区 `D:\ClawX`：同一 committed baseline，另有大量不属于本工作树的 dirty/untracked WIP。

因此，“基线相同”只表示 committed source 相同；不表示两个目录的未提交代码相同，也不授权把 `D:\ClawX` 的 WIP 批量移植进本分支。

## 2. 本工作树当前内容分类

### 2.1 规划与治理文件

- `WORKTREE.md`
- `docs/dev/knowledge-system-unification-development-plan.zh-CN.md`
- `docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md`
- `docs/dev/handoffs/LATEST.md`（顶部新增本路线接力入口，既有历史交接保留）
- `harness/specs/tasks/knowledge-system-integrity-foundation.md`
- `harness/specs/tasks/knowledge-system-ks01-review-bundle-integrity.md`
- `harness/specs/tasks/knowledge-system-ks02-experience-session-truth.md`
- `harness/specs/tasks/knowledge-system-ks03-governance-store-adapters.md`

这些文件构成开发参考和前三个实现包的执行边界。

### 2.2 KS-01 候选 WIP

- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- `electron/services/knowledge-api.ts`
- `src/pages/Knowledge/index.tsx`
- `tests/unit/knowledge-api.test.ts`
- `tests/unit/knowledge-page.test.tsx`

观察到 ReviewBundle、revision/digest、单选择 UI 和 Host API 相关改动。它们必须按 KS-01 规格补齐 atomic/fsync、writer queue、captureKey 临界区、operation journal、stale/CAS 与 E2E 证据后，才能进入验收。

### 2.3 KS-02 候选 WIP

- `electron/services/session-cascade-delete.ts`
- `electron/services/sessions-api.ts`
- `openclaw_runtime/src/context-engine/block-store.ts`
- `openclaw_runtime/src/context-engine/block.ts`
- `openclaw_runtime/src/context-engine/knowledge-system-ks02-block-store-owner.test.ts`
- `openclaw_runtime/src/knowledge/sekb/distillation-tool.ts`
- `openclaw_runtime/src/knowledge/sekb/experience-block-bridge.ts`
- `openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts`
- `openclaw_runtime/src/knowledge/sekb/session-cascade-delete.ts`
- `tests/unit/session-cascade-delete.test.ts`

观察到 stable projection id、truthful DCS status、BlockStore session owner API 和 cascade finalizer 相关改动。当前仍需证明：persisted 必须可 read-back、confirm 只有一个 commit coordinator、delete 在 transcript mutation 前 fail-closed、restart/retry 后 residual 为 0。

### 2.4 KS-03 候选 WIP

- `shared/knowledge/governance-contract.ts`
- `openclaw_runtime/src/knowledge/governance-store.ts`
- `openclaw_runtime/src/knowledge/governance-store.test.ts`
- `openclaw_runtime/src/knowledge/governance-adapters.ts`
- `openclaw_runtime/src/knowledge/governance-adapters.test.ts`
- `openclaw_runtime/src/state/openclaw-state-schema.sql`
- `openclaw_runtime/src/state/openclaw-state-schema.generated.ts`
- `openclaw_runtime/src/state/openclaw-state-db.generated.d.ts`

观察到 GovernanceStore、owner adapter 和 existing state DB schema 相关改动。必须按 KS-03 规格证明单事务导入、count/digest parity、legacy JSON read-only、JSON writer 为 0、第二 active memory writer 被拒绝。

### 2.5 待归属复核

- `openclaw_runtime/src/state/openclaw-agent-schema.generated.ts`
- `openclaw_runtime/src/state/openclaw-agent-db.generated.d.ts`

KS-03 目标只修改 existing `openclaw-state` governance schema；若生成命令连带改动 agent schema，必须确认是确定性 generator 输出还是无关 churn。未解释前不得纳入 KS-03 commit。

### 2.6 Task Forest 派生文件

本轮读取 task forest 时刷新了 `graph/forest.json` 和 export 的 `generated_at`，未改变 canonical `graph/nodes.json`、`graph/edges.json`。这些 timestamp-only 派生改动不是 KS 实现证据，也不能代表 proposal 已应用。

## 3. `D:\ClawX` 相关 WIP 裁决

| 主工作区 WIP | 裁决 | 理由 |
|---|---|---|
| `openclaw_runtime/src/gateway/session-delete-operation-journal.ts` + test | 只参考事件原语；KS-02 需要时移植最小部分 | 当前主工作区版本是更大 Session Lifecycle 路线的一部分，不能整体并入。 |
| `openclaw_runtime/src/sessions/session-admission-registry.ts` + test | 不移植 | KS-02 只做 derivative finalizer，不扩展为完整 admission control plane。 |
| `docs/dev/session-lifecycle-control-plane/**`、`docs/dev/runtime-lifecycle-governance/**` | 不移植 | 属于后续独立规划面，不是统一知识系统当前工作包。 |
| context/coding/goal-loop/mission-control 等其他 WIP | 不移植 | 与 KS-00～KS-03 无直接依赖，混入会破坏包级 ownership 和回滚边界。 |

## 4. Authority 与状态裁决

1. memory-wiki、Role Memory、SEKB、DCS、Provider Guard 的 owner 矩阵以 ADR 和总规划为本工作树开发基准。
2. `runtime-convergence/README.md` 的 user-accepted done 记录支持把 `STATUS.md` 调整为 done，但当前 `STATUS.md` 仍属于未提交 WIP，需在 KS-00 diff 中复核。
3. Task Forest 当前显示 `TF-0010=in_progress(0%)`、`TF-0038=proposed(0%)`，且 `TF-0038` 仍被 `TF-0031/TF-0037` 阻塞。统一知识系统 milestone 应直接挂 `TF-0010`，再以 `contributes_to` 关联 `TF-0038`；这些节点和边都是 proposal，不是已应用事实。
4. 只有用户确认 proposal 后，才可通过 Task Forest CLI 修改 canonical graph；禁止直接编辑 `.agent-workbench/task-forest/graph/nodes.json` 或 `edges.json`。
5. 所有产品锁保持 false；架构冻结、工程包通过和产品毕业是三个独立状态。
6. 候选提案 `TFP-knowledge-system-unification-20260817` 已保存并通过 proposal 预校验，当前状态仍为 `proposed`，未应用。

## 5. 当前验证口径

- 已完成：主规划审阅、ADR/规格一致性修正；KS-00～KS-03 的 `pnpm harness context` 和 `pnpm harness validate --no-diff` 均通过；`git diff --check` 通过（仅 LF/CRLF 提示）。
- 候选 WIP 冒烟：root Knowledge/Session 聚焦测试 43/43 通过；runtime Governance/SEKB/BlockStore 聚焦测试 30/30 通过；`pnpm contract:check` 通过。
- `pnpm run typecheck` 当前失败于 `electron/services/knowledge-api.ts:66`：`KnowledgeListReviewBundlesResult` 未使用（TS6196）；web phase 通过，node phase 未通过。
- diff-aware 结果：KS-01、KS-02、KS-03 均被 changed-path ownership 正确拒绝，因为当前 diff 同时包含其他包、规划文档和 Task Forest 派生文件；没有扩大 `touchedAreas` 规避。
- 尚未通过：完整 KS-01/02/03 package gate、完整 unit/typecheck/lint/comms/build、Electron E2E、session crash/restart/residual、migration parity。
- 正确做法：把候选 WIP 按 KS-01、KS-02、KS-03 拆成独立可审计 diff，逐包运行对应规格的全部 requiredTests，并生成包级 evidence。

## 6. KS-00 Exit

KS-00 只有在以下条件同时满足时才可关闭：

1. 本文件与实时 `git status` 的归属一致。
2. ADR、总规划、WORKTREE 和三个执行规格无 authority/状态矛盾。
3. Task Forest proposal 已保存并经用户确认；未确认时保持 proposed。
4. `pnpm harness validate --no-diff --spec harness/specs/tasks/knowledge-system-integrity-foundation.md` 通过。
5. 第一个生产实现包明确为 KS-01，KS-02/KS-03 不得继续并行扩展。
