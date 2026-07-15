# SEKB Hermes Tier D0 — Promotion Decision Package (refreshed post Tier C offline Go)

**Status:** decision package only (no runtime mutation)  
**Generated / refreshed:** 2026-07-15 (N2 refresh after N0 freeze)  
**Authority:** offline evaluation + product/tech design input — **not** a runtime source of truth  
**Tier C baseline runId:** `c-human-2026-07-15T01-04-37-795Z-c4aeff8e`  
**Tier C freeze:** `artifacts/sekb-hermes-phase-a5/tier-c/EVIDENCE-FREEZE.md`  
**Decision:** **Conditional — D1 design entry allowed; D1/D2 implementation still No-Go** without written product/tech approval and explicit agent-proxy risk acceptance for implementation

---

## 1. One-line constraint (binding)

> Without Tier C hard gates green **and** stage written approval, any Tier D runtime mutation is a policy violation.

`evaluable_for_promotion=true` means **offline evidence may support a later design decision**. It does **not** mean production filtering is on, Phase C scheduler is on, or default-on SEKB is authorized.

Current labels are **agent dual-review proxy** (pipeline `labelAuthority=human_dual_review` after full worksheet fill). Live-human dual-review equivalence is **not** claimed (N1 not executed).

---

## 2. Gate validation (prerequisite audit — post-C reality)

Source of truth for this audit:

| Artifact | Path |
| --- | --- |
| Tier C freeze | `artifacts/sekb-hermes-phase-a5/tier-c/EVIDENCE-FREEZE.md` |
| Tier C status | `artifacts/sekb-hermes-phase-a5/tier-c/TIER-C-STATUS.md` |
| Go / No-Go memo | `artifacts/sekb-hermes-phase-a5/tier-c/GO-NO-GO.md` |
| Campaign status JSON | `artifacts/sekb-hermes-phase-a5/tier-c/evaluation-campaign-status.v1.json` |
| Offline report | `artifacts/sekb-hermes-phase-a5/tier-c/report.v1.json` |
| Usefulness metrics | `artifacts/sekb-hermes-phase-a5/tier-c/USEFULNESS-METRICS.md` |
| Production preconditions | `artifacts/sekb-hermes-phase-a5/PRODUCTION-ENABLEMENT-PRECONDITIONS.md` |
| Freeze mirror | `artifacts/sekb-hermes-phase-a5/freezes/tier-c-c-human-2026-07-15T01-04-37-795Z-c4aeff8e/` |

### 2.1 Hard gates (A.5 / Tier C) — **current**

| Gate | Required | Actual (as of freeze runId above) | Pass |
| --- | --- | --- | --- |
| Independent dual-reviewed trajectories | ≥ 200 | **200** | **true** |
| Unresolved disagreements | 0 | **0** | **true** |
| Cohen's kappa | ≥ 0.7 | **1.0** | **true** |
| Holdout valuable recall | ≥ 0.95 | **1.0** (30/30) | **true** |
| Holdout projected false-drop | ≤ 0.02 | **0.0** (0/30) | **true** |
| `labelAuthority` (pipeline) | `human_dual_review` | **human_dual_review** | **true** |

**Label origin honesty:** agent dual-review proxy, not live-human annotators. N1 Pass-Human not achieved.

### 2.2 Promotion evaluability

| Field | Value | Authoritative? |
| --- | --- | --- |
| `promotionDecision.evaluableForPromotion` | **true** | yes (campaign status; offline only) |
| `promotionDecision.goNoGo` | **Go** (offline Tier C) | yes |
| `promotionDecision.status` | `evaluable_for_promotion` | yes |
| Offline report `promotion.status` | `evaluable_for_promotion` | yes |
| Automated smoke labels | must **not** authorize promotion | enforced by boundary |
| `phaseCDActivated` | **false** | yes |
| `shadowV1Retuned` | **false** | yes |
| `runtimeAuthorityChanged` | **false** | yes |

### 2.3 Usefulness / privacy / latency regression snapshot

- Closed-loop `confirm_and_save` path: **confirmed** (suggest does not write; confirm is durable write)
- Usefulness: `deterministic_suggest_human_accept_rate=1` **available** (session-scoped; restored from prior confirmed closed-loop)
- Batch ambient: **off** (`batch_probe_user_visible_status=feature_disabled`)
- Post-confirm retrieval/adoption: 0 (no longitudinal usefulness yet)
- Edit-distance / batch acceptance / batch latency: **unavailable** (honest nulls, not fabricated)
- SEKB master + shadow flags: **false** in inventory
- Offline artifacts remain non-authoritative for runtime

**Regression verdict for D1/D2 implementation entry:** offline hard gates are green, but residual risks (κ optimism, score≥50 discrimination limit, agent-proxy origin) mean **no** claim of live-human production dual-review preconditions. Treat D1/D2 **implementation** as blocked until written approval + explicit risk acceptance of agent-proxy (or N1 Pass-Human).

### 2.4 Written approval table

| Approval | Status |
| --- | --- |
| Product written approval: "allow promotion **design** (D0)" | **This refreshed pack is the design deliverable**; N2 Pass-D0 under agent-proxy design-only path |
| Product/tech written acceptance: agent-proxy offline evidence for **design only** | **Recorded by this N2 refresh** (not an implementation waiver) |
| Product/tech written approval: "allow D1 would_trigger implementation" | **missing** |
| Product/tech written risk waiver: agent-proxy for D1 entry (if skipping N1) | **missing** |
| Product/tech written approval: "allow D2 active pilot mutation" | **missing** |
| Approval for full production filtering / default-on | **forbidden by this package** |

---

## 3. Promotion object (what would be promoted, if ever)

Layered targets. **Do not collapse into one step.**

### D0 (this package) — design only

Decide the **first** promotion surface and explicit non-goals. No code mutation required. **N2 Pass-D0:** pack consistent with post-C Go + residual risks + non-goals + honest approvals.

### Recommended first promotion surface

**Operator review ranking / distillation candidate priority** — not capture filtering.

Rationale:

1. Lowest blast radius: affects operator queue order only, not what is stored, not task success, not permissions.
2. Preserves `confirm_and_save` as sole durable L2 write boundary.
3. Allows measuring "valuable items surfaced earlier" without false-drop of user trajectories.
4. Matches offline dual-review labels (valuable / not_valuable / uncertain) without deleting data.

Concrete meaning when later implemented (D2, after D1):

- Input: shadow score + optional offline consensus labels **never as live authority**; live path uses only runtime-computed shadow score / metadata already produced in-process.
- Effect when pilot flag on: sort order of operator suggestion / review candidates changes.
- Effect when flag off: parity with today's non-ranked / existing order.
- **No silent drop** of trajectories from store.
- **No auto principle write**.

### Deferred promotion surfaces (explicit later stages)

| Surface | Earliest stage | Notes |
| --- | --- | --- |
| Mutation-free `would_trigger` scheduler evidence | **D1 / Phase C** | Emit evidence only; no pool/trajectory/principle mutation |
| Extremely narrow capture filter pilot | **Phase D after N4** | Separate pack; only after D0+D1+D2 ranking evidence + separate written approval |
| Full production filtering | **beyond this plan** | Requires fresh holdout retest + broader ops approval |
| Default-on SEKB / ambient batch | **never under this pack** | Separate product decision |

---

## 4. Explicit non-goals

The following must **not** be altered by Tier D D0–D2 under this package:

1. Task success / failure authority
2. Permission grants or tool policy
3. Retry / abort / resume authority
4. `confirm_and_save` as the **only** durable L2 principle write path
5. Automatic principle / ContextBlock durable writes from shadow score
6. Reading offline artifacts under `artifacts/sekb-hermes-phase-a5/**` as runtime decision inputs
7. Shadow V1 threshold retune on holdout (threshold frozen at **50**)
8. Using `automated_smoke_not_human` labels to set `evaluable_for_promotion=true` or to tune gates
9. SEKB ops GUI / large operator admin console (CLI + Host API + report files only unless a new approved spec)
10. Declaring "full production filtering" from this decision package alone
11. Treating agent dual-review proxy as live-human dual-review equivalence without N1 or written risk acceptance

---

## 5. Why Shadow V1 may be insufficient → Shadow V2 (no holdout retune of V1)

Shadow V1 contract (frozen):

- Policy id: `sekb-shadow-v1-score-gte-50`
- Score threshold: **50**
- Holdout weight/threshold tuning: **forbidden**

Current freeze residual: **all sampled scores ≥ 50**, so holdout recall/false-drop gates have limited discrimination. If later live-human or expanded inventory shows:

- valuable recall < 0.95 **or**
- projected false-drop > 0.02 **or**
- systematic bias that cannot be fixed by operator ranking alone

then the **only** allowed scoring change path is:

1. Freeze V1 evidence pack as historical baseline (export / protocol / reviews / report) — **done for current offline pack via N0**.
2. Define **Shadow V2** under a **new** policy id, new default-off flag namespace, and a **fresh** holdout protocol.
3. Never retune V1 weights/threshold on the original holdout to "brush past" gates.
4. V2 remains non-authoritative until its own dual-review campaign and written approval.

**This package does not authorize Shadow V2 implementation.** It only records the rule: **do not holdout-tune V1**.

---

## 6. Staged plan (mandatory split)

```text
Tier C offline Go (agent proxy) + N0 freeze
        │
        ├─(optional) N1 live-human revalidation
        │
        ▼
N2 D0 decision (this pack) — design only
        │
        │  written approval + (N1 Pass-Human OR proxy risk waiver)
        ▼
N3 D1 Phase C would_trigger (mutation-free evidence)
        │
        │  observation + rollback drill + separate approval
        ▼
N4 D2 pilot — operator ranking first
        │
        ▼
still NOT full production filter (Phase D pack later)
```

### D1 — Phase C: mutation-free scheduler / `would_trigger` evidence

**Enter implementation only if:** N2 Pass-D0 **and** product/tech written approval for D1 **and** (N1 Pass-Human **or** written agent-proxy risk acceptance).

Requirements (for future approved task spec):

- Named owner, workspace isolation, single-flight / lease, timeout cancel
- Observability fields for `would_trigger` decisions
- Default-off + kill switch
- Emits evidence only; **must not** mutate trajectory, principle, candidate pool, or filter authority
- Tests prove flag on/off produce **no durable mutation**

### D2 — Phase D pilot surface (narrow): operator ranking

**Enter only if:** Pass-D1 **and** separate written approval for D2 **and** explicit pilot scope (users/env/timebox).

Preferred mutation: operator review / candidate sort order only. Capture filter is **not** the first surface.

---

## 7. Rollback design (all later stages)

| Control | Design |
| --- | --- |
| Kill switch | Single feature flag (per stage: D1 flag, D2 flag) separate from master SEKB enable |
| Flag-off behavior | Bit-identical to pre-pilot path for mutation surfaces |
| Migration | **None required**; no reverse migration |
| Data cleanup | **Not required** to roll back |
| Evidence retention | Offline reports may remain under `artifacts/`; runtime ignores them |
| Drill | Procedure ready in `ROLLBACK-DRILL.md`; execute only when D1/D2 code exists |

**Current status:** procedure ready; drill **not run** — no D1/D2 runtime surface yet.

---

## 8. Monitoring fields (CLI / report first; no GUI required)

When D1/D2 are implemented later, reports must expose at least:

| Field | Stage | Purpose |
| --- | --- | --- |
| `would_trigger.count` | D1+ | How often scheduler would fire |
| `would_trigger.suppressed_by_flag` | D1+ | Kill switch / default-off path |
| `would_trigger.lease_busy` | D1+ | Single-flight contention |
| `would_trigger.timeout_cancel` | D1+ | Watchdog cancellations |
| `pilot.rank_reorder_count` | D2 | Operator sort mutations |
| `pilot.false_drop_observed` | D2 | Only if filter pilot ever approved |
| `pilot.complaint_count` | D2 | Operator / user complaints |
| `pilot.latency_ms_p50_p95` | D1/D2 | Regression watch |
| `pilot.flag_state` | D1/D2 | on/off/kill |
| `promotion.evaluable_for_promotion` | offline only | Must never gate live mutation alone |

---

## 9. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Treating offline Go as live filter enablement | Critical | Boundary rule + design text; runtimeMutationAuthorized=false |
| Agent-proxy treated as live-human dual-review | Critical | Honesty notes; N1 optional; production preconditions still require humans or waiver |
| Auto labels / smoke used to "pass" gates | Critical | Only dual-review worksheets + merge path; smoke forbidden |
| Holdout-tune V1 to pass recall | High | Frozen V1@50; V2 new policy only |
| Offline artifacts drive runtime | High | Write-path + promotion boundaries forbid runtime reads |
| Pilot expands to silent data delete | High | First surface = ranking only |
| confirm_and_save bypass | High | Write-path boundary unchanged |
| κ=1 / score≥50 optimism misread as production-ready | High | Residual risks frozen in N0; restate here |
| Missing usefulness metrics interpreted as success | Medium | Unavailable metrics stay null; no fabrication |

---

## 10. Decision record

### 10.1 D0 conclusions (refreshed)

1. **Tier C offline hard gates are green** (200 pairs, κ/recall/false-drop, pipeline authority filled) under **agent dual-review proxy** labels; N0 freeze recorded.
2. **First promotion object:** **operator review / candidate ranking**, not capture filter.
3. **Filter pilot** is a separate later decision after D1 + ranking pilot evidence and written approval (beyond N4 preferred path).
4. **D1/D2 implementation remains blocked** pending written stage approval (+ N1 or proxy risk waiver for D1).
5. **goNoGoForD1D2 = Conditional** — design entry open; implementation No-Go.
6. **Shadow V1 remains frozen at 50**; any algorithmic change requires Shadow V2 + fresh holdout, not V1 retune.
7. **Rollback** for any future pilot is single-flag, no reverse migration, no data cleanup dependency; procedure ready, drill not executed.
8. **This package does not authorize production filtering or default-on SEKB.**

### 10.2 Immediate next actions

1. Product chooses path **A** (staff N1 live humans) or **B** (sign explicit agent-proxy risk waiver for D1 entry).
2. Product/tech sign D1 approval box **in writing** before any D1 code lands.
3. Keep Shadow V1@50; do not retune on holdout.
4. Do not enable Phase C/D flags from these artifacts.

### 10.3 Approval boxes (leave blank until real humans sign)

```text
[x] Design stance (N2 pack): ranking-first; D1/D2 still gated; agent-proxy accepted for design-only
    Recorded in this pack / promotion-decision.v1.json  Date: 2026-07-15

[ ] Product: countersign D0 design stance
    Name: ____________  Date: ____________

[ ] Tech: countersign D0 design stance
    Name: ____________  Date: ____________

[ ] Product+Tech: accept agent-proxy for D1 entry OR complete N1 live-human
    Path: A human / B waiver ____________
    Name: ____________  Date: ____________

[ ] Product+Tech: approve D1 mutation-free would_trigger implementation
    Name: ____________  Date: ____________
    Preconditions checked: Tier C hard gates green = [x offline] N1 or waiver = [ ]

[ ] Product+Tech: approve D2 active pilot (name exact surface: ranking | narrow-filter)
    Surface: ____________
    Name: ____________  Date: ____________
    Preconditions: D1 evidence + pilot scope attached = [ ]
```

---

## 11. Deliverables map

| Deliverable | Path | Status |
| --- | --- | --- |
| D0 decision pack | `artifacts/sekb-hermes-phase-a5/tier-d/D0-PROMOTION-DECISION-PACK.md` | **refreshed N2** |
| D0 machine-readable summary | `artifacts/sekb-hermes-phase-a5/tier-d/promotion-decision.v1.json` | **refreshed N2** |
| Tier D status | `artifacts/sekb-hermes-phase-a5/tier-d/TIER-D-STATUS.md` | **refreshed N2** |
| Rollback drill procedure | `artifacts/sekb-hermes-phase-a5/tier-d/ROLLBACK-DRILL.md` | **procedure ready; not executed** |
| N0 freeze | `artifacts/sekb-hermes-phase-a5/tier-c/EVIDENCE-FREEZE.md` | **done** |
| D1/D2 code + tests | — | **not started (blocked)** |

---

## 12. Explicit statements for reviewers

1. **evaluable_for_promotion ≠ production filtering**
2. **Tier C offline is Go** (200 dual-reviewed pairs, agent dual-review proxy)
3. **No runtime mutation ships from D0**
4. **Any agent implementing D1/D2 without written stage approval is out of policy**
5. **N2 Pass-D0 does not authorize D1 code**

---

## Appendix: D2 design stub (post Pass-D1; not implementation)

See [D2-DESIGN-STUB.md](./D2-DESIGN-STUB.md).

- Pass-D1 completed under agent-only close-out (synthetic observation + rollback drill).
- D2 ranking pilot remains **blocked** until separate written approval.
- Production filtering remains **out of scope**.
