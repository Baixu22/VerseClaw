**Status:** **CLOSED — pass_d1_hold** (agent-only; see END-STATE.md). N4/D2 not authorized.\n\n# SEKB Hermes 鈥?Next Acceptance Plan (post Tier C Offline Go)

**Status:** **N3 Pass-D1 closed (agent-only 2026-07-15)**; N4/D2 still blocked; prior line was  plan active — N0 Pass + N2 Pass-D0 executed 2026-07-15 (see ACCEPTANCE-EXECUTION-LOG.md); N1/N3/N4 still gated; **no runtime mutation authorization**  
**Baseline date:** 2026-07-15  
**Current baseline:** Tier C offline **Go**, `evaluable_for_promotion=true`, labels = **agent dual-review proxy**  
**Binding one-liner:** `evaluable_for_promotion 鈮?production filtering`; D1/D2 still need separate written approval and their own acceptance.

---

## 0. Current state (start here)

| Item | Value | Acceptance meaning |
| --- | --- | --- |
| Tier C hard gates | all green | Offline evidence pack may support later design |
| label origin | agent dual-review proxy | **Not** live-human dual-review equivalence |
| closed-loop | confirmed + usefulness restored | Suggest 鈮?durable; confirm_and_save only durable L2 |
| Shadow V1 | threshold frozen **50** | No holdout retune |
| Phase C/D | off | Must stay off until stage approvals |
| Tier D0 pack | **stale** (still records old No-Go / pairs=0) | Must re-audit before D1 entry |
| Runtime mutation | not authorized | Default for all stages below until signed |

**Primary evidence root**

```text
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\
```

| Pack | Path |
| --- | --- |
| Tier C kit | `...\tier-c\` |
| Tier D pack | `...\tier-d\` |
| Production preconditions | `...\PRODUCTION-ENABLEMENT-PRECONDITIONS.md` |

---

## 1. Acceptance stages (do not collapse)

```text
N0 Freeze C  鈫? N1 (optional) Live-human C  鈫? N2 Refresh D0  鈫? N3 D1 evidence  鈫? N4 D2 pilot
```

Each stage has: **entry criteria 鈫?tests 鈫?pass/fail 鈫?exit artifacts 鈫?explicit non-goals**.

---

## N0 鈥?Freeze Tier C offline evidence (immediate, no product approval)

### Goal
Lock a reproducible evidence pack so later stages cannot silently rewrite labels / thresholds.

### Entry
- Current Tier C Go already achieved

### Acceptance tests
1. **Hard gates re-read** from frozen files equal current Go table (200 pairs, 魏鈮?.7, recall鈮?.95, false-drop鈮?.02, authority filled).
2. **Integrity checklist**
   - A/B worksheets 200/200 valid labels
   - `reviews.v1.json` 400 annotations; unresolved disagreements = 0
   - `report.v1.json` / `evaluation-campaign-status.v1.json` agree on gates
   - usefulness: `deterministic_suggest_human_accept_rate=1` available; closed-loop confirmed
3. **Honesty present**
   - agent dual-review proxy disclosure
   - residual risks (魏 optimism; all scores 鈮?0)
   - 鈥溾墵 production filtering / D1D2 not authorized鈥?4. **Non-mutation**
   - `phaseCDActivated=false`, `shadowV1Retuned=false`, `runtimeAuthorityChanged=false`

### Pass / Fail
| Result | Condition |
| --- | --- |
| Pass | all tests green; pack hash/list recorded |
| Fail | any hard gate or honesty note missing |

### Exit deliverables
- `tier-c/EVIDENCE-FREEZE.md` (file list + SHA256 or mtime+size + runId)
- Optional: zip/copy under `artifacts/sekb-hermes-phase-a5/freezes/tier-c-<runId>/`

### Non-goals
No re-label, no merge rewrite, no runtime flags, no Phase C/D.

---

## N1 鈥?Optional: live-human dual-review revalidation (recommended before any production claim)

### Goal
Close the **agent-proxy residual**: production preconditions still say 鈥?=200 **human** dual-reviewed鈥?

### Entry
- N0 Pass

### Roles
- Reviewer A / B (live humans, independent)
- Adjudicator
- Operator (merge only; no invented labels)

### Acceptance tests
1. New or refilled worksheets: 200脳2 **live human** labels; no agent/smoke copy.
2. After merge+adjudication:
   - independentlyReviewedTrajectories 鈮?200
   - unresolvedDisagreements = 0
   - 魏 鈮?0.7
   - holdout valuable recall 鈮?0.95 (V1鈮?0 frozen)
   - holdout projected false-drop 鈮?0.02
3. `labelAuthority=human_dual_review` **and** process log proves live humans (names/date/tool).
4. Residual risks re-evaluated (expect lower 魏 than 1.0 if truly independent).
5. Score distribution still reported; if inventory still all 鈮?0, note discrimination limit.

### Pass / Fail
| Result | Condition |
| --- | --- |
| Pass-Human | all quantitative gates + live-human provenance |
| Pass-Proxy-only | skip N1; may proceed to **N2 design only**, **not** production benefit claims |
| Fail | any hard gate red or provenance missing |

### Exit deliverables
- Updated `tier-c/*` reviews/report/GO-NO-GO
- `tier-c/HUMAN-PROVENANCE.md` (who/when/how independence enforced)
- New freeze under N0 rules

### Non-goals
No V1 retune on holdout; no Phase C/D; no runtime filtering.

---

## N2 鈥?Refresh D0 promotion decision pack (design acceptance)

### Goal
Bring `tier-d/` current with **post-C reality** and decide first promotion surface without implementing mutation.

### Entry
- N0 Pass
- N1 either Pass-Human **or** explicit product note accepting agent-proxy offline evidence for **design only**

### Acceptance tests
1. Re-audit Tier C gates into D0 pack (replace stale pairs=0 / No-Go snapshot).
2. Decision fields coherent:
   - If only agent-proxy: `goNoGoForD1D2` may still be **No-Go** or **Conditional** until written human/product policy accepts proxy for D1 entry.
   - If Pass-Human: may set **Conditional-Go for D1 design entry** (still no implementation).
3. First promotion object remains lowest blast radius:
   - **recommended:** operator review ranking / candidate priority
   - **not** capture filtering as first surface
4. Explicit non-goals still listed (task success authority, permissions, default-on, auto principle write, full filtering).
5. Shadow V1: frozen 50; 鈥渋f insufficient 鈫?Shadow V2 + fresh holdout鈥? never retune V1.
6. Written approval table updated (missing vs signed).
7. `promotion-decision.v1.json` matches markdown pack.
8. `TIER-D-STATUS.md` no longer claims dual-reviewed=0 if C is Go.

### Pass / Fail
| Result | Condition |
| --- | --- |
| Pass-D0 | pack consistent + non-goals + approvals table honest |
| Fail | pack still stale or claims runtime authorization |

### Exit deliverables
- Updated:
  - `tier-d/D0-PROMOTION-DECISION-PACK.md`
  - `tier-d/promotion-decision.v1.json`
  - `tier-d/TIER-D-STATUS.md`
  - `tier-d/ROLLBACK-DRILL.md` (procedure ready even if not yet executed)

### Non-goals
No D1 code, no Phase C scheduler, no Phase D filter, no flag default-on.

---

## N3 鈥?D1 acceptance (mutation-free evidence only)

### Goal
Accept **would_trigger / evidence-only** path (Phase C evidence), still **zero** durable mutation of pool/trajectory/principle from scheduler.

### Entry (all required)
1. N2 Pass-D0
2. Product/tech **written approval**: 鈥渁llow D1 would_trigger implementation / observation鈥?3. Prefer N1 Pass-Human; if only proxy, written risk acceptance must be explicit
4. Rollback drill procedure exists (may execute here)

### Acceptance tests

#### N3.1 Functional
- Feature flag **default off**
- When flag on: emits would_trigger / evidence records only
- No write to principles except existing human confirm_and_save path
- No trajectory drop / capture filter
- Shadow score computation unchanged (threshold still 50)

#### N3.2 Safety / parity
- Flag off: behavior bit-identical to baseline (no ambient capture change)
- Operator report: missing metrics stay **unavailable**, never fabricated
- Privacy: export remains keyed-pseudonymous; no raw PII expansion

#### N3.3 Observation window (suggested)
- 鈮?N days embedded traffic **or** 鈮?M trajectories (set product numbers; default suggestion: 7 days **or** +200 new trajectories)
- Record: trigger rate, evidence count, error rate, latency p50/p95 delta vs baseline 鈮?agreed budget (e.g. +5% or absolute ms cap)
- No severity-1 incidents attributed to D1

#### N3.4 Rollback drill
- Execute flag-off drill per `ROLLBACK-DRILL.md`
- Pass if baseline restored within SLA (e.g. immediate flag-off; no residual scheduler mutation)

### Pass / Fail
| Result | Condition |
| --- | --- |
| Pass-D1 | functional+safety+observation+rollback all green + written approval archived |
| Fail | any mutation of durable state outside confirm_and_save, or rollback fails |

### Exit deliverables
- `tier-d/D1-OBSERVATION.md` + `d1-observation.v1.json`
- Signed approval note path
- Rollback drill evidence (timestamp, operator, result)

### Non-goals
No operator ranking mutation yet (that is D2), no capture filtering, no default-on.

---

## N4 鈥?D2 acceptance (narrow pilot mutation)

### Goal
Accept **first active promotion surface**: operator review ranking / candidate priority only.

### Entry (all required)
1. Pass-D1
2. Separate **written approval** for D2 pilot
3. Holdout policy still frozen for V1; no retune
4. Explicit pilot scope (users/env/timebox)

### Acceptance tests

#### N4.1 Scope lock
- Only ranking/priority of operator suggestions/candidates changes
- Store contents unchanged (no silent drop)
- Task success authority unchanged
- Permissions / tool policy unchanged
- Auto principle write still forbidden

#### N4.2 Effectiveness (offline + pilot)
- Valuable candidates appear earlier vs control (define metric, e.g. rank of consensus-valuable items)
- False prioritization of not_valuable within agreed bound
- Pilot does **not** use offline artifacts as live authority; live path uses in-process shadow/metadata only

#### N4.3 Safety
- Flag off restores previous order
- No increase in accidental durable writes
- Privacy export re-check still pass
- Latency regression within budget

#### N4.4 Stop conditions (auto No-Go)
- Any trajectory drop / filter activation without Phase D approval
- Any confirm_and_save bypass
- Rollback fail
- 魏/recall retest (if re-run) falls below gates after process change

### Pass / Fail
| Result | Condition |
| --- | --- |
| Pass-D2-pilot | scope lock + metrics + rollback green within timebox |
| Fail | scope creep into filtering/default-on or safety break |

### Exit deliverables
- `tier-d/D2-PILOT-REPORT.md` + metrics JSON
- Go/No-Go for **continuing pilot** (still not full production filtering)

### Non-goals / still later
- Phase D narrow capture filter pilot: **separate pack after N4**
- Full production filtering / default-on SEKB / ambient batch: **beyond this plan**

---

## 2. Cross-cutting gates (every stage)

| Gate | Rule |
| --- | --- |
| Authority | Offline artifacts never drive runtime decisions |
| Shadow V1 | threshold 50 frozen; no holdout weight/threshold retune |
| Durable write | only `confirm_and_save` (and existing human paths) |
| Metrics honesty | unavailable stays unavailable; no fabricated accept/edit-distance |
| Privacy | keyed-pseudonymous export only |
| Default-off | new flags default off; opt-in controllable |
| Documentation | Go memo must restate 鈮?production filtering when evaluable true |

---

## 3. Suggested acceptance cadence

| When | What |
| --- | --- |
| Now | **N0 freeze** (1 session) |
| If claiming 鈥渉uman dual-review production-ready鈥?| **N1** (staffing-bound) |
| Before any D1 code lands | **N2 D0 refresh + written approval** |
| After D1 ships flag-off | **N3 observation + rollback** |
| After D1 Pass | **N4 D2 pilot** under separate approval |

---

## 4. Roles & RACI (short)

| Activity | Reviewer A/B | Adjudicator | Operator | Product | Tech lead |
| --- | --- | --- | --- | --- | --- |
| N0 freeze | I | I | **R** | C | **A** |
| N1 human labels | **R** | **R** (disputes) | R (merge) | A (staffing) | C |
| N2 D0 refresh | I | I | **R** | **A** | **A** |
| N3 D1 | I | I | R (run) | **A** (approve) | **R/A** (impl+sign) |
| N4 D2 | C | C | R | **A** | **A** |

R=do, A=approve, C=consult, I=inform

---

## 5. Minimal command checklist (operators)

### Re-verify Tier C (N0)
```bash
node -e "const s=require('./artifacts/sekb-hermes-phase-a5/tier-c/evaluation-campaign-status.v1.json'); console.log(s.promotionDecision.goNoGo, s.promotionDecision.evaluableForPromotion, s.promotionDecision.hardGates);"
```

### After any future human re-label (N1)
```bash
node scripts/sekb-tier-c-campaign.mjs --merge-worksheets --skip-closed-loop
# then restore usefulness if needed:
node scripts/sekb-tier-c-restore-closed-loop-metrics.mjs
```

### Never for 鈥渁cceptance shortcut鈥?- Do not copy `automated_smoke_not_human` into human authority
- Do not retune V1 on holdout to force recall/false-drop
- Do not treat offline report as runtime filter config

---

## 6. Definition of done for 鈥渘ext phase鈥?(product language)

| Claim you want to make | Minimum stage Pass |
| --- | --- |
| 鈥淭ier C offline evidence exists (agent proxy)鈥?| **Already done** + N0 freeze |
| 鈥淗uman dual-review production preconditions met鈥?| **N1 Pass-Human** |
| 鈥淲e decided what to promote first (design)鈥?| **N2 Pass-D0** |
| 鈥淪cheduler evidence-only is safe鈥?| **N3 Pass-D1** |
| 鈥淥perator ranking pilot is safe/useful鈥?| **N4 Pass-D2-pilot** |
| 鈥淧roduction capture filtering on鈥?| **Not in this plan** (later Phase D pack) |

---

## 7. Immediate recommended order (this week)

1. **N0** freeze current Tier C pack (cheap, blocks evidence drift).
2. **N2** refresh stale `tier-d/*` against current Go + residual risks (still No runtime).
3. Product chooses path:
   - **A:** staff N1 live humans before any D1 approval, or
   - **B:** accept agent-proxy for design-only and sign explicit risk waiver for D1 entry.
4. Only then open D1 implementation ticket gated on written approval.

---

## 8. Failure policy

- Any stage Fail 鈫?stay at previous stage; do not 鈥減artial enable鈥?runtime.
- Hard gate regression on re-merge 鈫?Tier C offline Go suspended until re-adjudication.
- Discovery of runtime using offline artifacts 鈫?**severity stop**, flag-off, incident note.

---

## 9. One-line constraint (repeat)

No 200 dual-reviews + quantitative gates + written stage approval 鈬?no D1/D2 runtime mutation; offline Go never means production filtering.

