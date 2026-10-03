# Runtime Authority Convergence Control Pack

> Program: `runtime-authority-convergence`
> Activation: `active`
> Status source: `.agent-workbench/task-forest/`
> Parent goal: `TF-0010`
> Current metadata: `STATUS.md`
> Updated: 2026-09-26

> Current program status: `in_progress`，唯一活动包为 RC-09（TF-0041）。当前分支已完成 RC-00..RC-08B 工程复验；RC-09 正在刷新证据并重跑独立 Executor/Verifier，尚未 accepted。以 Task Forest 和 `STATUS.md` 的当前状态为准；2026-08-09 的 `done` 与验收候选链仅为历史，不授权当前候选完成。product locks 保持 false（live_ready/product_approved/default_on 均未解锁）。
>
> 历史：candidate `fac6327a2` 曾于 2026-08-03 被独立审计拒绝并进入 fail-closed remediation；该段是历史证据。RC-10 真人验收仍按 `HUMAN-ACCEPTANCE.md` 执行，不得用工程复验或历史 accepted 记录替代。

## Purpose

This control pack governs convergence from parallel runtime implementations to an OpenClaw-based Operator Desktop. The current serial revalidation has accepted RC-00 through RC-08B and is working on RC-09. RC-09 may reach `human_acceptance_pending` only after its clean candidate passes independent engineering verification; RC-10 remains required before program completion. Earlier completion claims are historical evidence and do not authorize the current candidate.

## Read Order

1. `STATUS.md`
2. `RC-09-REMEDIATION-PLAN.md` — historical record of the 2026-08-03 NO-GO recovery sequence
3. `CHARTER.md`
4. `TARGET-ARCHITECTURE.md`
5. `WORK-PACKAGES.md`
6. `ACCEPTANCE.md`
7. `HUMAN-ACCEPTANCE.md` — real-channel evidence requirements that remain binding for RC-10 follow-ups
8. `AGENT-START.md` when opening a fresh development session

## Authority Order

| Concern | Authority |
|---|---|
| Repository policy | `AGENTS.md`, `harness/specs/rules/**` |
| Task status and dependencies | Task Forest |
| Proposed product scope and activation locks | `CHARTER.md` |
| Target ownership | `TARGET-ARCHITECTURE.md` |
| Current work sequence | `WORK-PACKAGES.md` |
| Per-change paths and tests | The active work package Harness task spec |
| Current metadata | `STATUS.md` |

If two sources conflict, stop. Prefer current workspace evidence, record the conflict, and update the higher authority before coding.

## Single-Task Rule

After activation, only one work package may be `in_progress`. Every package requires its own Harness task spec before implementation. No later package may be partially implemented to make an earlier package pass.

## Superseded Directions

- `DEVELOPMENT-STRATEGY.zh-CN.md` is historical and cannot authorize implementation sequencing.
- `runtime-family-unification-v1` is frozen as diagnostic legacy. It must not become runtime authority.
- New generic agent loops, workflow engines, memory stores, tool protocols, telemetry stores, or planner services are forbidden by default.
