# Runtime Authority Convergence Control Pack

> Program: `runtime-authority-convergence`
> Activation: `proposed / non-authorizing`
> Status source: `.agent-workbench/task-forest/`
> Parent goal: `TF-0010`
> Current metadata: `STATUS.md`
> Updated: 2026-08-02

## Purpose

This is the proposed control pack for converging ClawX from parallel runtime implementations to an OpenClaw-based Operator Desktop. It becomes implementation-authorizing only after `STATUS.md` names an applied Task Forest proposal. Until then, old expansion plans remain non-authorizing historical evidence and no RC implementation may start.

## Read Order

1. `STATUS.md`
2. `CHARTER.md`
3. `TARGET-ARCHITECTURE.md`
4. `WORK-PACKAGES.md`
5. `ACCEPTANCE.md`
6. `HUMAN-ACCEPTANCE.md` only after engineering acceptance
7. `AGENT-START.md` when opening a fresh development session

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
