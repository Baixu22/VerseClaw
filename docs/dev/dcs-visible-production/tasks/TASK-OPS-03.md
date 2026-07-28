# TASK-OPS-03: Gate review (M0 exit / M1 entry) — NOT full M1 exit

| field | value |
|-------|-------|
| **id** | `TASK-OPS-03` |
| **milestone** | `OPS` |
| **priority** | `P1` |
| **status** | `done` |
| **reviewKind** | `M0-exit-M1-entry` (re-scoped; original “M1 exit” blocked) |
| **blockedBy** | — (original blockedBy P1-01/P1-02 **not** met; review re-scoped honestly) |
| **owner** | Claude |
| **gapRefs** | gap doc §0–§6; UI-01 / T-04 / M-01 |
| **estimate** | 0.5d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (as executed)

Written go/no-go after M0 + OPS-01/02:

1. Is **main-path shelfware** for the **control plane** cleared enough to start M1?
2. Is the program ready for **M2 default-on** discussion? (**No.**)

Original title “M1 exit review” assumed P1-01 + P1-02 done. They are **not**. This document is therefore an **M0 exit / M1 entry gate**, not an M1 exit.

---

## Evidence base

| Source | Result |
|--------|--------|
| M0 integration | **PASS** (`M0-INTEGRATION-REPORT`) |
| OPS-01 canary pack | **continue** (accept-with-residuals; 6 supervised runs) |
| OPS-02 kill drill | **pass** (`live-supervised-electron`) |
| Packaging smoke | defaultsUnchanged=true; productionMode=opt-in |
| C1 synthetic canary | recommendation=**keep-off** |
| TF-0006 | **blocked** |
| Writable Settings flags | context-view-tools, stale-write-guard, symbol-lease, routing-memo-shadow, sekb-experience-shadow |

---

## Main-path shelfware table (updated)

| ID | Topic | Was (gap doc Jul-22 draft) | Now (post M0/OPS) | Residual |
|----|-------|---------------------------|-------------------|----------|
| **UI-01** | DCS Flag panel | 只读目录 | **已达标（opt-in 可写）** Settings Switch + status + E2E | Not default-on |
| **T-04** | view tools (understand/impact/reuse/verify) | 默认隐身 | **已达标（可发现 + opt-in）** banner+CTA; gate=env/Settings | Live human free-form chat residual; not default catalog |
| **M-01** | working-memory injection | 只产 envelope / 默认不注 | **未达标（M1）** producer 3/3 在; Assembler **default off** | Need TASK-P1-02 for “打开后真注入 + 有用性” |
| UI-02 | VToken | 双门/文案混淆 | **部分达标** bridge UI + layer copy (P0-05); assembly product story residual | P1-04 decision still open |
| T-01..03 | context_read/search/write | dep 门控 | **部分达标** W5 接线绿; P0-04 存储失败可见 | 检索质量 live 未证 |
| CodeGraph | 插件工具 | 误导 | **已下架叙事** RETIRED; W5 codegraphCount=0 | harness only |
| factViews config | 死 true | 假默认 | **已清除** P0-02 | — |

### One-line verdict on “主路径 shelfware”

- **Control-plane / honesty shelfware: CLEARED** (M0 PASS).  
- **Productive-content shelfware (working-memory inject, default view tools, SEKB UX): NOT CLEARED** → **M1 work remains**.

---

## Go / No-Go

### GO — enter **M1-productive** (recommended)

| Criterion | Status |
|-----------|--------|
| Settings can enable/disable without env-only expert path | Yes (P0-01/03) |
| Fail-closed defaults + kill path | Yes (smoke + OPS-02) |
| Electron + Gateway production wiring | Yes (W5 3/3) |
| Honesty copy (shell vs core) | Yes (P0-05) |
| Retired surfaces not sold as live | Yes (P0-06) |
| Ops pack + continue decision | Yes (OPS-01) |

**M1 first picks (priority):**

1. **TASK-P1-02** — working-memory injection really lands when enabled (core “真干活”)  
2. **TASK-P1-04** — VToken vs DCS primary path decision (unblocks budget/copy)  
3. **TASK-P1-01** — Fact view tools productionization + live A/B evidence class  
4. **TASK-P1-08** — TaskLoop acceptance if marketing task_state  

### NO-GO — **M2 default-on / GA discussion**

| Criterion | Status |
|-----------|--------|
| TF-0006 four evidence files | Missing / blocked |
| productApproved / liveReady | false |
| Human free-form product-chat ≥10 | 0 (OPS-01 residual) |
| readyForDefaultFlagGraduation | false |
| Canary recommendation | keep-off |

**Do not** open default-on PRs, joint GA language, or SEKB auto writeback.

---

## Explicit non-claims

- Not “all visible features production-usable” end-state  
- Not M1 complete  
- Not liveReady / productApproved / default-on / joint-system GA  

---

## STATUS implication

| Field | Value |
|-------|-------|
| phase after review | `M1-productive` **OPEN** (entry authorized) |
| nextTaskId | `TASK-P1-02` (recommended) or `TASK-P1-04` (decision can parallel) |
| hardLocks | unchanged |

---

## Progress log

| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | original blockedBy P1-01/02 |
| 2026-07-22 | re-scope | done | M0-exit / M1-entry gate (honest) |
| 2026-07-22 | table tick | done | UI-01/T-04 cleared; M-01 open |
| 2026-07-22 | go/no-go | **GO M1 / NO-GO M2** | written herein |
| 2026-07-22 | close | **done** | |

## Handoff

Implementer next: open **TASK-P1-02** working-memory injection true path (flag already config-gated; prove prompt injection + soak notes).  
In parallel optional: **TASK-P1-04** product decision doc only.
