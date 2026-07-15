# SEKB Hermes Tier C — Acceptance Fix Prompt (post dual-review)

Copy everything below the line into a new agent task.

---

## Mission
Fix **acceptance residuals** of SEKB Hermes Tier C offline dual-review pack.
Do **not** reopen labeling for gate-chasing. Do **not** retune Shadow V1. Do **not** enable Phase C/D or runtime mutation.

Workspace:
```
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory
```

Kit:
```
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\
```

## Known state (already accepted for hard gates)
- Offline **Go**; `evaluable_for_promotion=true`
- A/B worksheets 200/200 filled; merge done; kappa=1; holdout recall=1; false-drop=0
- Authority disclosed as **agent dual-review proxy** (not live humans)
- Hard gates already green — **do not break them**

## Findings to fix

### F1 (must fix) — Usefulness metrics regression after `--skip-closed-loop` merge
- `closed-loop.v1.json` is still `status=confirmed` with principleId `92d58571-255e-4c2c-8a58-f65be2206337`
- But `usefulness-metrics.v1.json` / `USEFULNESS-METRICS.md` show:
  - `deterministic_suggest_human_accept_rate` unavailable (skipped)
  - post_confirm_* unavailable (no_confirmed_principle)
- `evaluation-campaign-status.v1.json` may still say closedLoop skipped or metrics unavailable
- `TIER-C-STATUS.md` / `GO-NO-GO.md` should stay consistent with **prior confirmed** closed-loop

### F2 (doc only, must fix) — Residual-risk notes missing/thin
Add honest residual notes (do not change labels solely to create disagreements):
1. A/B labels are perfectly agreed; decision surface is highly separable / near-deterministic on privacy fields → kappa=1 is optimistic for true human independence.
2. All sampled shadow scores are >= 50 → holdout false-drop/recall gates have limited discrimination on this inventory.
3. `labelAuthority=human_dual_review` is pipeline-side after full fill; origin remains **agent dual-review proxy**.
4. `evaluable_for_promotion=true` ≠ production filtering; D1/D2 still need separate approval.

### F3 (do NOT do)
- Do **not** re-label A/B just to lower kappa or manufacture disagreements
- Do **not** copy smoke labels / auto-adjudicate
- Do **not** change Shadow V1 threshold/weights (frozen 50)
- Do **not** open Phase C/D / default full filtering / runtime wiring
- Do **not** re-run `confirm_and_save` (would write another durable principle)
- Do **not** re-run full campaign without `--skip-closed-loop` if it would rewrite worksheets or wipe reviews
- Prefer **not** re-running merge unless you can prove it will not wipe restored usefulness metrics (if you must merge, restore usefulness again afterward)

## Fix steps

### 1) Verify closed-loop still durable
```bash
node -e "const cl=require('./artifacts/sekb-hermes-phase-a5/tier-c/closed-loop.v1.json'); console.log(cl.status, cl.principleId); if(cl.status!=='confirmed') process.exit(1);"
```
If not confirmed: stop and report blocker (do not fake it).

### 2) Restore usefulness metrics from prior confirmed closed-loop (no new confirm)
Read live store principle snapshot for `closedLoop.principleId` if available; else use snapshot already in `closed-loop.v1.json`.

Rebuild and write:
- `artifacts/sekb-hermes-phase-a5/tier-c/usefulness-metrics.v1.json`
- `artifacts/sekb-hermes-phase-a5/tier-c/USEFULNESS-METRICS.md`
- patch `evaluation-campaign-status.v1.json`:
  - `closedLoop` = content of `closed-loop.v1.json` (confirmed)
  - `usefulnessMetrics` = restored rows
  - inventory trajectory/principle/dbBytes refreshed if easy
- patch `TIER-C-STATUS.md` closed-loop line to **confirmed** (prior; metrics restored, no re-confirm)
- patch `GO-NO-GO.md` closed-loop confirm line similarly

Required restored metric (minimum):
| metric | expected |
| --- | --- |
| `deterministic_suggest_human_accept_rate` | available, value `1` (prior session accept after human edit; note: not re-confirmed this fix) |
| `post_confirm_retrieval_count` | available from principle snapshot (likely 0) |
| `post_confirm_adoption_count` | available from principle snapshot (likely 0) |
| `post_adoption_success` | available from principle snapshot (likely 0) |
| `trajectory_count` | available (312 or current) |
| `principle_count` | available (3 or current) |
| `batch_probe_user_visible_status` | available (`feature_disabled` unless probe says otherwise) |

Missing metrics remain **unavailable** with reason — do not invent estimates.

Optional helper already in repo (use or reimplement equivalently):
```bash
node scripts/sekb-tier-c-restore-closed-loop-metrics.mjs
```
If helper missing/outdated, implement the same restore logic inline.

### 3) Add residual-risk section to memos (doc only)
Update both:
- `GO-NO-GO.md`
- `TIER-C-STATUS.md`

Add a short section **Residual risks / acceptance caveats** covering F2 points.
Do **not** flip Go → No-Go solely because of residual risks (hard gates already pass).
Keep Decision: **Go** (offline evidence only).

Also ensure authority honesty note remains:
> labels produced by independent agent dual-review proxies (not live human annotators); offline evidence only; not production filtering; D1/D2 not authorized.

### 4) Optional small consistency file
Write/update:
`artifacts/sekb-hermes-phase-a5/tier-c/ACCEPTANCE-FIX-NOTES.md`
with:
- what was fixed
- what was intentionally not changed (labels/kappa/V1/runtime)
- re-verification commands + results

### 5) Re-verify (must all pass)
```bash
node -e "
const fs=require('fs');
const root='artifacts/sekb-hermes-phase-a5/tier-c';
const u=JSON.parse(fs.readFileSync(root+'/usefulness-metrics.v1.json','utf8'));
const s=JSON.parse(fs.readFileSync(root+'/evaluation-campaign-status.v1.json','utf8'));
const cl=JSON.parse(fs.readFileSync(root+'/closed-loop.v1.json','utf8'));
const a=JSON.parse(fs.readFileSync(root+'/reviewer-A.worksheet.v1.json','utf8'));
const b=JSON.parse(fs.readFileSync(root+'/reviewer-B.worksheet.v1.json','utf8'));
const row=m=> (u.rows||u).find?.(x=>x.metric===m) || (Array.isArray(u)?u.find(x=>x.metric===m):null);
const accept=row('deterministic_suggest_human_accept_rate') || (u.rows||[]).find(x=>x.metric==='deterministic_suggest_human_accept_rate');
const checks={
  closedLoop: cl.status==='confirmed',
  acceptAvailable: accept && accept.status==='available' && accept.value===1,
  go: s.promotionDecision?.goNoGo==='Go' || /Decision: \\*\\*Go\\*\\*/.test(fs.readFileSync(root+'/GO-NO-GO.md','utf8')),
  evaluable: s.promotionDecision?.evaluableForPromotion===true,
  pairs200: a.items.filter(i=>i.label).length===200 && b.items.filter(i=>i.label).length===200,
  noPhaseCD: s.campaign?.phaseCDActivated===false,
  noRetune: s.campaign?.shadowV1Retuned===false,
};
console.log(JSON.stringify({checks, hardGates:s.promotionDecision?.hardGates, accept},null,2));
if(!Object.values(checks).every(Boolean)) process.exit(1);
"
```

Also confirm memos contain residual-risk notes and authority disclosure:
```bash
rg -n "Residual|agent dual-review proxy|evaluable_for_promotion" artifacts/sekb-hermes-phase-a5/tier-c/GO-NO-GO.md artifacts/sekb-hermes-phase-a5/tier-c/TIER-C-STATUS.md
```

## Success criteria
1. Usefulness closed-loop metrics restored and consistent with confirmed `closed-loop.v1.json`
2. No new durable principle write
3. Labels/reviews/report hard gates unchanged (still Go offline)
4. Residual-risk + authority honesty documented
5. No Phase C/D, no V1 retune, no runtime enablement
6. Final reply lists absolute paths touched + before/after for usefulness accept_rate

## Deliverables (absolute)
```
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\usefulness-metrics.v1.json
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\USEFULNESS-METRICS.md
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\evaluation-campaign-status.v1.json
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\TIER-C-STATUS.md
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\GO-NO-GO.md
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\ACCEPTANCE-FIX-NOTES.md
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\closed-loop.v1.json  (keep confirmed; refresh snapshot only if safe)
```

## Final reply template
1. Fixed items (F1/F2)
2. Explicitly unchanged (labels, kappa, V1, runtime, Go decision)
3. Usefulness before → after
4. Re-verify command results
5. Absolute paths
6. One-liner: offline Go evidence only; not production filtering; D1/D2 not authorized

## One-line constraint
Restore metrics + document caveats; never re-label to chase kappa, never retune V1, never confirm_and_save again, never enable runtime from offline artifacts.
