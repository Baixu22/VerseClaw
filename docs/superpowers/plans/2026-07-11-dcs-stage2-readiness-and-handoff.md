# DCS Stage 2 Readiness and Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and then implement the DCS v1.6 Stage 2 `task_state` adapter and child-session handoff without bypassing Stage 1, Coding Runtime P0, BlockStore authorization, or existing lifecycle ownership.

**Architecture:** A real TaskLoop transition emits existing `task_phase_change`; `taskLoopHandler` persists system-managed `task_state` through `ContextBlockSink`; parent-to-child handoff is stored under the child key before spawn; child startup recovers only its own state. State never travels as serialized prompt text.

**Tech Stack:** TypeScript, OpenClaw Runtime, existing plugin/harness lifecycle hooks, Kysely-backed BlockStore, Vitest, pnpm Harness, SEKB trajectory capture.

## Global Constraints

- Follow `harness/specs/tasks/dcs-stage2-task-state-handoff.md` and `harness/specs/rules/dcs-stage2-handoff-boundary.md`; DCS v1.6 remains authoritative.
- Start only after DCS Stage 1, Coding Runtime P0, and the real-worktree Runtime build are accepted.
- Reuse `task_phase_change`, `ContextBlockSink`, `BlockStore`, `spawnRoleSubagent`, and `before_agent_start`; add no event bus, private phase enum, or state store.
- Handoff is stored, not prompted. `extraSystemPrompt` contains only the fixed `context_read('task_state')` instruction.
- Do not touch Renderer/Main/Gateway, Stage 1 behavior, COMPASS, AgentMap, AST, CodeGraph, or sequential handoff.

---

## Task 1: Freeze Readiness

**Files:**
- Modify: `harness/specs/tasks/dcs-stage2-task-state-handoff.md` only when the code-fact path map differs.

**Interfaces:**
- Consumes: accepted Stage 1 and Coding Runtime P0 reports, `RuntimeTaskStatus`, Hook runner, BlockStore API.
- Produces: one reviewed readiness report that names canonical transition, spawn, child-startup, and SEKB paths.

- [ ] Read the prerequisite reports and diffs.
- [ ] Run `pnpm --dir openclaw_runtime build` in the target worktree; record exit code 0.
- [ ] Trace one canonical TaskLoop producer, child key, spawn entrypoint, child startup hook, and trajectory adapter.
- [ ] Review the map adversarially; stop if any path or prerequisite is incomplete.

## Task 2: Establish RED Evidence

**Files:**
- Create: `openclaw_runtime/src/context-engine/handlers/task-loop-handler.test.ts`
- Modify: `openclaw_runtime/src/context-engine/block-store.test.ts`
- Modify: `openclaw_runtime/src/agents/harness/dcs-stage0-hooks.test.ts`

**Interfaces:**
- Consumes: `PluginHookTaskPhaseChangeEvent`, `RuntimeTaskStatus`, `ContextBlockSink`, `BlockStoreApi`, `HandoffPack`.
- Produces: failed tests for state write, terminal trajectory capture, handoff ordering, and authorization.

- [ ] Write RED tests for every real phase transition and status reuse.
- [ ] Write RED tests for terminal-only trajectory capture and non-duplication of agent_end.
- [ ] Write RED tests for self/direct-parent/arbitrary/ancestor plus malformed/stale HandoffPack cases.
- [ ] Run focused tests and retain expected non-zero evidence.

## Task 3: Implement Task-State Adapter

**Files:**
- Create: `openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts`
- Modify: the preflight-confirmed TaskLoop producer file.
- Modify: `openclaw_runtime/src/knowledge/sekb/harness-integration.ts` only if required by the existing adapter contract.

**Interfaces:**
- Consumes: a true transition event and existing `ContextBlockSink`.
- Produces: one system-managed `task_state` ContextBlockWrite and terminal-only SEKB request.

- [ ] Validate with shared `RuntimeTaskStatus` and build stable task_state writes without direct SQL.
- [ ] Connect exactly one true TaskLoop producer to the existing hook helper.
- [ ] Capture SEKB only for `done` and `failed`.
- [ ] Turn Task 2 focused tests GREEN.

## Task 4: Implement Child-Key Handoff

**Files:**
- Modify: `openclaw_runtime/src/agents/role-spawn.ts`
- Modify: `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts`
- Create: `openclaw_runtime/src/agents/embedded-agent-runner/extensions.task-state.test.ts`

**Interfaces:**
- Consumes: parent session id, child key, accepted persisted working_memory facts, current phase, BlockStore API.
- Produces: child-key write-before-spawn, fixed prompt, and child-owned state restoration.

- [ ] Add RED tests for write-before-spawn and prompt non-leakage.
- [ ] Add RED tests for self restoration and authorization isolation.
- [ ] Build only the four-field HandoffPack from accepted persisted facts.
- [ ] Restore only child-owned task_state in `before_agent_start`.
- [ ] Turn focused tests GREEN.

## Task 5: Gate and Review

**Files:**
- Modify: `team/dcs/README.md` only after every gate is green.

- [ ] Run all commands in `harness/specs/tasks/dcs-stage2-task-state-handoff.md`.
- [ ] Scan for SQL bypasses, prompt JSON, duplicate events, sequential handoff, transcript writes, and untracked files.
- [ ] Obtain independent Critical 0 / Important 0 review.
- [ ] Update DCS status and publish COMPLETE only after verified success.

## Agent Dispatch Prompt

```text
/goal 无预算限制

# Goal：DCS Stage 2 — task_state Adapter + Child-Session Handoff

## 权威与读取顺序
工作目录：C:\Users\27933\Desktop\clawx\ClawX
依次读取：AGENTS.md；team/dcs/dcs-v1.6-spec.md（第 1、4、5、9 章）；team/dcs/dcs-v1.6-review.md；team/dcs/README.md；harness/specs/tasks/dcs-stage2-task-state-handoff.md；harness/specs/rules/dcs-stage2-handoff-boundary.md；gateway-backend-communication 场景与其规则。

DCS v1.6 与最终 review 是唯一设计权威。任务规范和本提示词只约束执行与证据，不得平行改写 HandoffPack、授权、Hook 或阶段状态语义。

## 开工硬门槛
先写 readiness report，且不要修改生产代码。下列任一不能在目标工作树证明时，报告 BLOCKED：
1. DCS Stage 1 最终报告为 COMPLETE，所有门禁 exit code 0，独立审阅 Critical 0 / Important 0，且如实写出 producer coverage。
2. Coding Runtime P0 最终报告为 COMPLETE，证明可信 workspace authority、session/workspace 隔离、producer-owned mutation envelope 与恰好一次临时 Recent Actions 注入。
3. `pnpm --dir openclaw_runtime build` 在本工作树 exit 0；不得用 clean-copy 例外替代。
4. 能定位唯一真实 TaskLoop phase producer、child session-key 派生、role-spawn 入口、child before_agent_start 路径和 SEKB trajectory adapter。

若任意项缺失或歧义，先对任务规范做对抗审阅后修订；不得造兼容路径。

## 必做行为
- 只复用 `RuntimeTaskStatus`。真实 TaskLoop transition 每次仅调用一次既有 `task_phase_change` runner。
- taskLoopHandler 仅经 `ContextBlockSink` / `BlockStore` 写 system-managed task_state；不得直接 SQL 或新建 state store。
- 仅 `done` / `failed` 触发一次 SEKB trajectory capture；不得新增或重复 agent_end。
- 父 session 在 spawn 前向 child session key 写四字段 HandoffPack：`objective`、`current_phase`、`recent_actions`、`parent_session_id`。
- recent_actions 仅来自 accepted、persisted 的 working_memory 事实，最多 5 条，只包含 high/medium，摘要不超过 100 字符；不得读 transcript/raw output 或推断。
- extraSystemPrompt 必须恰好为：
  ## Handoff Available
  Use context_read('task_state') to load parent session state.
- child 的 before_agent_start 只读自己的 current task_state。只有 child 自己的有效 HandoffPack 指向该 direct parent 时才可读 parent；arbitrary/ancestor 均返回空并记录观测。

## 禁止
- 禁止把 HandoffPack JSON、task_state JSON、block id、transcript、raw tool output 放进 prompt。
- 禁止 sequential same-session handoff、新 event bus、DCS 私有 phase enum、第二 context engine/store、直接 SQLite DDL、Renderer/Main/Gateway/host-api/UI 改动。
- 禁止改 DCS Stage 1 working-memory、Coding Runtime P0 workspace authority、COMPASS、AgentMap、AST、CodeGraph 或 runbook/orchestration P2。
- 禁止 skip、删断言、伪造 green、降低 build gate，或把 task throughput 当 coding uplift。

## TDD 与验收
1. 运行 Harness context/validate。
2. 先写 RED 并记录非零退出：phase-to-state、terminal SEKB、write-before-spawn、prompt non-leak、child recovery、self/direct-parent/arbitrary/ancestor 授权。
3. 最小实现转 GREEN。
4. 跑 task spec 中全部门禁：DB、typecheck、lint、全量 test、test:dcs、Harness、contract、comms replay/compare、Runtime build、git diff --check。
5. 跑 ownership/prohibition scan 和独立复审。仅 Critical 0 / Important 0 时才更新 team/dcs/README.md 并报告 COMPLETE。

## 最终报告
列出：修改文件、readiness path map、RED/GREEN 命令与 exit code、全量门禁、prompt non-leak 证明、授权矩阵、agent_end 不重复证明、未跟踪文件检查和独立审阅。DCS correctness 与任何产品 uplift 必须分开表述。
```
