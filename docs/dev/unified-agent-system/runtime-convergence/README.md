# Runtime Authority Convergence Control Pack

> Program: `runtime-authority-convergence`
> Activation: `active`
> Status source: `.agent-workbench/task-forest/`
> Parent goal: `TF-0010`
> Current metadata: `STATUS.md`
> Updated: 2026-08-09

> Program status: `done`（2026-08-09，user-accepted）。工程验收候选链 `rc09-final-candidate`（`3209f098…`）通过独立 engineering + human-phase validator；`STATUS.md` 记录 program_status=done、engineering_verdict=accepted、human_verdict=accepted。product locks 保持 false（live_ready/product_approved/default_on 均未解锁），done 不改变 default-on/GA/TF-0006 状态。
>
> 历史：candidate `fac6327a2` 曾于 2026-08-03 被独立审计拒绝并进入 fail-closed remediation；该段是历史证据，不再授权新实施。RC-10 的 H-03 真实 channel 轮次与后续 runtime owner 复核（FP-P1-11 DCS budget-channel 偏差、FP-P1-01 Setup 验证方差）按 `HUMAN-ACCEPTANCE.md` 与 `STATUS.md.next_action` 跟进，不因 done 而免除。

## Purpose

This control pack governs convergence from parallel runtime implementations to an OpenClaw-based Operator Desktop. The original Task Forest proposal was applied; the `fac6327a2` candidate failed independent audit and the program was placed in fail-closed remediation, after which the revalidation sequence (RC-00..RC-10) was executed serially and the program reached `done` with user acceptance on 2026-08-09. Old pre-audit completion claims remain non-authorizing historical evidence.

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
