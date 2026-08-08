# Runtime Authority Convergence Control Pack

> Program: `runtime-authority-convergence`
> Activation: `active / remediation after independent NO-GO`
> Status source: `.agent-workbench/task-forest/`
> Parent goal: `TF-0010`
> Current metadata: `STATUS.md`
> Updated: 2026-08-03

> Independent audit override: candidate `fac6327a2` was rejected on 2026-08-03. Do not
> rely on earlier package-completion claims. The active recovery authority is
> `RC-09-REMEDIATION-PLAN.md`; RC-10 remains blocked.

## Purpose

This control pack governs convergence from parallel runtime implementations to an OpenClaw-based Operator Desktop. The original Task Forest proposal was applied, but the `fac6327a2` candidate failed independent audit and the program is now in fail-closed remediation. A new, user-confirmed Task Forest proposal must establish the serial revalidation sequence before implementation resumes; old expansion and pre-audit completion claims remain non-authorizing historical evidence.

## Read Order

1. `STATUS.md`
2. `RC-09-REMEDIATION-PLAN.md` while the independent NO-GO is unresolved
3. `CHARTER.md`
4. `TARGET-ARCHITECTURE.md`
5. `WORK-PACKAGES.md`
6. `ACCEPTANCE.md`
7. `HUMAN-ACCEPTANCE.md` only after engineering acceptance
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
