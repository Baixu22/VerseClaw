# Proxy Label Authority Register (N1 permanent close-out)

**Status:** **Pass-Proxy permanent**  
**Date:** 2026-07-15  
**runId (Tier C freeze):** `c-human-2026-07-15T01-04-37-795Z-c4aeff8e`  
**Binding:** agent dual-review proxy is the **only** label source for this campaign; live-human dual-review is **not** claimed and is **not** required for N3 Pass-D1 under this register.

---

## 1. Authority decision

| Field | Value |
| --- | --- |
| `labelOrigin` | `agent_dual_review_proxy` |
| Pipeline `labelAuthority` | `human_dual_review` (worksheet fill + merge path only) |
| `n1Status` | `pass_proxy_permanent` |
| Live-human dual-review | **Not performed; not planned for this close-out** |
| Production dual-review claim | **Forbidden** under this register |

### Allowed claims
- Offline Tier C hard gates green under **agent dual-review proxy** labels.
- Offline `evaluable_for_promotion=true` may support design / D1 evidence-only paths under residual-risk acceptance.
- N3 Pass-D1 (mutation-free would_trigger, default-off) under agent-proxy authority.

### Forbidden claims
- "Human dual-review production preconditions met"
- Live-human dual-review equivalence (A/B independence of real annotators)
- Production capture filtering / default-on SEKB from this authority alone

---

## 2. Residual risk register (frozen)

| ID | Risk | Severity | Mitigation / acceptance |
| --- | --- | --- | --- |
| R1 | Kappa optimism (κ=1) vs true independent humans | High | Disclose always; do not use as live-human readiness |
| R2 | Holdout discrimination limited (many scores ≥50) | High | Synthetic D1 observe must include score &lt;50 cohort; no V1 retune |
| R3 | Agent proxy ≠ live human | Critical | Permanent waiver; production human claim blocked |
| R4 | Treating offline Go as filtering | Critical | Boundary docs + runtimeMutationAuthorized=false |
| R5 | Session-scoped usefulness ≠ production usefulness | Medium | Keep metrics honest (null when unavailable) |

---

## 3. Path choice

| Path | Description | Chosen |
| --- | --- | --- |
| A | Live-human dual-review (N1 Pass-Human) | No |
| B | Permanent agent-proxy + residual-risk register | **Yes** |

Written acceptance: `artifacts/sekb-hermes-phase-a5/tier-d/D1-WRITTEN-APPROVAL.md` (agent-proxy risk waiver for D1 entry).

---

## 4. Cross-links

- Freeze: `tier-c/EVIDENCE-FREEZE.md`
- Go memo: `tier-c/GO-NO-GO.md`
- Production preconditions: `PRODUCTION-ENABLEMENT-PRECONDITIONS.md` (path B)
- D1 observation: `tier-d/D1-OBSERVATION.md`