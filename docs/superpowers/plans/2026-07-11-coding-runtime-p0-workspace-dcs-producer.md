# Coding Runtime P0 Workspace and DCS Producer Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first production coding vertical slice in which a trusted Chat workspace controls runtime tool authority and explicit mutation facts become exactly-once, transient DCS working-memory context.

**Architecture:** Main resolves the workspace root from renderer-supplied identity and passes one authoritative runtime workspace context through existing boundaries. The mutation producers own their explicit envelopes; Stage 1 consumes accepted envelopes without heuristics; each subsequent LLM transform projects one Recent Actions block without mutating transcripts.

**Tech Stack:** Electron, React, typed Host API, Gateway/runtime bridge, OpenClaw Runtime, TypeScript, Vitest, Playwright, pnpm Harness.

## Global Constraints

- Follow `harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md` and `harness/specs/rules/coding-runtime-workspace-dcs-producer-boundary.md`.
- Do not start until DCS Stage 1 has a verified COMPLETE report and real-worktree Runtime build evidence.
- Renderer supplies identity, never path authority. Main resolves the root and runtime uses it consistently for workspaceDir, cwd, file boundaries, and sandbox root.
- Mutation producers create facts; hooks never infer facts. The default flag remains false.
- Do not touch Stage 2 task_state/handoff, AgentMap, AST, SEKB, COMPASS, LSP, CodeGraph algorithms, always-on policy, or direct renderer transport.

---

## Task 1: Trace and Freeze Workspace Authority

**Files:**
- Modify: the P0 task spec only if the code-fact path map contradicts its touched areas.

- [ ] Map Chat workspace identity, trusted Main resolver, runtime request, workspaceDir/cwd/sandbox construction, mutation producers, and session binding.
- [ ] Write a preflight report naming exactly one owner at each step.
- [ ] Stop if a renderer path can become executable authority or if two roots survive in one run.

## Task 2: RED Workspace and Session Tests

**Files:**
- Modify/Create: focused unit tests beside canonical Main/runtime workspace paths.
- Modify/Create: one Electron E2E spec for workspace A/B selection and a normal Chat coding turn.

- [ ] Prove A's runtime workspaceDir/cwd/sandbox root all equal trusted A.
- [ ] Prove A cannot access B through inherited cwd, tool input, or stale session state.
- [ ] Prove a workspace switch invalidates old DCS scope or creates a new session.
- [ ] Record expected non-zero RED exits before implementation.

## Task 3: Implement One Authority and Binding

**Files:**
- Modify: the preflight-confirmed host API/Main/runtime boundary files only.

- [ ] Pass workspace identity through existing typed boundaries.
- [ ] Resolve and fingerprint root only in Main.
- [ ] Thread the resolved authority into runtime workspaceDir, cwd, file tools, and sandbox.
- [ ] Bind or invalidate session scope on trusted-root change.
- [ ] Turn Task 2 focused tests GREEN.

## Task 4: RED Producer and DCS Visibility Tests

**Files:**
- Modify/Create: focused mutation producer tests and existing Stage 1 integration tests.

- [ ] Prove edit/write/apply_patch success emits explicit high envelope.
- [ ] Prove explicit structured partial/failure may emit medium and unstructured failure emits nothing.
- [ ] Prove read/search/CodeGraph/exec never emit envelopes.
- [ ] Prove next LLM call has exactly one transient Recent Actions and repeated calls do not accumulate.
- [ ] Prove flag-off/no-envelope has zero DCS store access and transcript stays unchanged.

## Task 5: Implement Producers and Verify Effects

**Files:**
- Modify: only canonical mutation producer implementations and their existing runtime dispatch bridge.

- [ ] Emit producer-owned structured envelopes; add no hook heuristics.
- [ ] Route through accepted Stage 1 sink/handler behavior.
- [ ] Generate machine-readable matched off/on replay evidence.
- [ ] Run all Harness, contract, comms, Runtime build, UI build, and E2E gates.
- [ ] Complete independent review, then report COMPLETE with correctness and uplift evidence separated.

## Agent Dispatch Prompt

```text
/goal 无预算限制

# Goal：Coding Runtime P0 — Workspace Authority + DCS Producer Vertical Slice

## 目标
在已完成并验收的 DCS Stage 1 基础上，完成第一个真实 ClawX coding 闭环：Chat workspace identity 经 Main 解析成为 runtime 的唯一 workspaceDir/cwd/file boundary/sandbox root；edit/write/apply_patch 显式生产 `details.working_memory`；下一次 LLM 调用恰好一次临时注入 `## Recent Actions`。

## 唯一权威与读取顺序
工作目录：C:\Users\27933\Desktop\clawx\ClawX
先读：AGENTS.md；DCS Stage 1 最终报告与 diff；team/dcs/dcs-v1.6-spec.md；team/dcs/dcs-v1.6-review.md；team/dcs/README.md；harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md；harness/specs/rules/coding-runtime-workspace-dcs-producer-boundary.md；gateway-backend-communication 场景与其规则。

## 开工前硬门槛
先运行 Harness context/validate 并写 path-map。若 DCS Stage 1 不是 COMPLETE、任一 Stage 1 gate 非 0、独立审阅非 Critical 0 / Important 0、或 `pnpm --dir openclaw_runtime build` 不能在本工作树 exit 0，立即报告 BLOCKED，不得改生产代码。

## 必做
- Renderer 只传 workspace identity；Main 解析可信 rootPath。一个 run 内 workspaceDir、cwd、file boundary、sandbox root 必须一致。
- session 与可信 root fingerprint 绑定；workspace 变更时创建新 scope 或使旧 working-memory scope 失效，不能重用旧 Block。
- 只有 edit/write/apply_patch producer 可显式发 envelope。成功为 high + <=100 字 structured summary；结构化部分/失败才可发 medium；否则不发。
- hook/extension 禁止从 tool name、参数、stdout、文本或错误字符串推断 summary/significance。
- read/search/CodeGraph/exec/process 本阶段不发 envelope。
- Stage 1 负责持久化；下一次 LLM context 仅一个临时 Recent Actions，不写 transcript、不累计、不触发 COMPASS。
- flag off 或无 envelope 时完全 no-op：零 BlockStore 构造/查询/写入，existing output identity 不变。

## 禁止
禁止 DCS Stage 2 task_state/handoff、AgentMap、AST、SEKB、COMPASS、LSP、CodeGraph 算法、always-on、第二 workspace/context/store/event bus/session classifier、任何 Renderer 直连 IPC/Gateway/HTTP/WS、skip/删断言/伪绿。

## TDD 与验收
先写 RED 并记录非零退出：workspace A/B 隔离、session switch、producer 覆盖/负覆盖、next-call exactly-once、transcript non-mutation、flag-off/no-envelope。最小实现转 GREEN。随后运行 task spec 所有 gate：typecheck、lint、全量 test、test:dcs、DB、Harness、contract、comms、Runtime build、Vite build、Electron E2E、git diff --check。独立审阅 Critical 0 / Important 0 后才更新文档并报告 COMPLETE。

## 效果报告
对相同 coding replay 运行 flag off/on，机器可读记录 workspace/cwd 一致性、producer coverage、下一调用可见性、重复注入、任务/验证通过率、token、延迟、重复工具调用、错误 workspace access。不得把注入或读取本身宣称为正收益。
```
