# SEKB Hermes Tier C — Agent Dual-Review Campaign Prompt

Copy everything below the line into a new agent task.

---

## Mission
Complete SEKB Hermes **Tier C offline dual-review campaign** in this repo.
Act as **Reviewer A**, then **Reviewer B**, then **Adjudicator**, then **Operator**.
Do **not** implement Phase C/D runtime, do **not** retune Shadow V1, do **not** wire offline artifacts into runtime.

**Authority honesty note (required in final report):**
There are no live humans. Labels are **agent dual-review proxies**. After merge the pipeline may set `labelAuthority=human_dual_review` because worksheets are fully filled — in `GO-NO-GO.md` / final message, explicitly state:
> labels produced by independent agent dual-review proxies (not live human annotators); offline evidence only; not production filtering; D1/D2 not authorized.

Do **not** copy `automated_smoke_not_human` labels.

## Workspace
```
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory
```

## Kit root (all Tier C deliverables)
```
C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\
```

## Working files
| Role | Path |
| --- | --- |
| Reviewer A worksheet | `artifacts/sekb-hermes-phase-a5/tier-c/reviewer-A.worksheet.v1.json` |
| Reviewer B worksheet | `artifacts/sekb-hermes-phase-a5/tier-c/reviewer-B.worksheet.v1.json` |
| Protocol | `artifacts/sekb-hermes-phase-a5/tier-c/LABELING-PROTOCOL.md` |
| Workflow | `artifacts/sekb-hermes-phase-a5/tier-c/DUAL-REVIEW-WORKFLOW.md` |
| Disagreement rules | `artifacts/sekb-hermes-phase-a5/tier-c/DISAGREEMENT-RESOLUTION.md` |
| Status | `artifacts/sekb-hermes-phase-a5/tier-c/TIER-C-STATUS.md` |
| Go memo | `artifacts/sekb-hermes-phase-a5/tier-c/GO-NO-GO.md` |

Each worksheet:
- schema: `sekb-tier-c-reviewer-worksheet.v1`
- items: **200**
- fill every `label` + optional `rationale`
- valid labels only: `valuable` | `not_valuable` | `uncertain`

## Allowed evidence (ONLY these)
For each item, judge only from:
- `exportFields.terminalOutcome`
- `exportFields.counts` (steps / toolCalls / toolResults / toolErrors / retries)
- `exportFields.shadowScore`, `exportFields.completionStatus`
- `exportFields.errorSignaturePresent`, `exportFields.errorRecurrenceCount`
- `stratum` (terminalOutcome / toolActivity / shadowScore / errorRecurrence)
- `split` (`development` | `holdout`) as stratification context only — **do not** use holdout to game gates

**Forbidden:**
- looking at the other reviewer's worksheet before adjudication
- copying smoke/auto labels
- hard-aligning label to shadow score (score is context only)
- retuning V1 threshold/weights (frozen at **50**)
- dropping disagreed samples without replacement
- opening Phase C scheduler / Phase D filtering / default full filtering
- writing durable principles except via existing confirm_and_save path (closed-loop already confirmed; prefer `--skip-closed-loop`)

## Label definitions
- `valuable` = worth keeping for human distillation / experience reuse
- `not_valuable` = low signal / not reusable
- `uncertain` = cannot decide from privacy-bounded fields alone

## Recommended decision heuristics (apply independently; do not share intermediate labels)
Use privacy-bounded fields only. These are **guidance**, not score hard-match:

**Lean valuable when several hold:**
- failure/partial with tool activity + retries/errors (reusable recovery pattern)
- recurring error signature (`errorSignaturePresent` + `errorRecurrenceCount > 0`)
- multi-step tool trajectory that completed with clear structure (`toolCalls`/`toolResults` > 0, steps >= 2)
- success with non-trivial tool use that looks like a reusable procedure

**Lean not_valuable when several hold:**
- trivial success: steps=1, toolCalls=0, no errors (near-empty trajectory)
- pure smoke/no-signal patterns with no tools and no error learning
- high noise without reusable structure

**Use uncertain when:**
- fields conflict (e.g. success + high retries + missing tool structure)
- too sparse to judge reuse value

**Independence requirement (critical for kappa):**
1. Pass A: write labels only into `reviewer-A.worksheet.v1.json`. Save. Do not open B.
2. Pass B: re-read each item's exportFields/stratum **from scratch** with a slightly different emphasis:
   - A prioritizes **reusable failure/recovery signal**
   - B prioritizes **reusable successful procedure signal** and is slightly stricter on trivial successes
3. Do **not** copy A's labels into B. Natural disagreement is expected; adjudicate later.
4. Keep both rationales short (one sentence, Chinese or English OK).

## Execution order
### 1) Optional kit refresh (do not wipe filled worksheets)
```bash
# only if worksheets still all-null; after partial fill, avoid full rewrite risks
node scripts/sekb-tier-c-campaign.mjs --skip-closed-loop
```

### 2) Reviewer A — fill all 200
Edit only:
`artifacts/sekb-hermes-phase-a5/tier-c/reviewer-A.worksheet.v1.json`

Validate:
```bash
node -e "const a=require('./artifacts/sekb-hermes-phase-a5/tier-c/reviewer-A.worksheet.v1.json'); const ok=['valuable','not_valuable','uncertain']; const bad=a.items.filter(i=>!ok.includes(i.label)); console.log({items:a.items.length,filled:a.items.filter(i=>i.label).length,bad:bad.length,dist:a.items.reduce((m,i)=>(m[i.label]=(m[i.label]||0)+1,m),{})}); if(a.items.length!==200||bad.length) process.exit(1);"
```

### 3) Reviewer B — fill all 200 independently
Edit only:
`artifacts/sekb-hermes-phase-a5/tier-c/reviewer-B.worksheet.v1.json`

Same validation for B.

### 4) Operator merge + report
```bash
node scripts/sekb-tier-c-campaign.mjs --merge-worksheets --skip-closed-loop
```
If closed-loop metrics get wiped, restore from existing `closed-loop.v1.json` without new `confirm_and_save` (prefer no extra principle writes).

### 5) Adjudicate if needed
Read:
`artifacts/sekb-hermes-phase-a5/tier-c/disagreements.v1.json`

For each unresolved disagreement:
- consensus re-label **both** worksheets to the same final label (or both `uncertain`)
- append row to `DISAGREEMENT-RESOLUTION-LOG.md`
- do **not** auto-smoke break ties
- do **not** retune V1

Then merge again:
```bash
node scripts/sekb-tier-c-campaign.mjs --merge-worksheets --skip-closed-loop
```

Repeat until `unresolvedDisagreements == 0`.

### 6) Read gates
Open:
- `GO-NO-GO.md`
- `evaluation-campaign-status.v1.json`
- `report.v1.json`
- `TIER-C-STATUS.md`

Hard gates (all must pass for offline Go):
1. independentlyReviewedTrajectories >= 200
2. unresolvedDisagreements == 0
3. Cohen's kappa >= 0.7
4. holdout valuable recall >= 0.95 (Shadow V1 score >= 50 frozen)
5. holdout projected false-drop <= 0.02
6. labelAuthority == human_dual_review  (pipeline-side; disclose agent-proxy origin in memo)

If any fail: keep **No-Go**, `evaluable_for_promotion=false`.
If all pass: offline may show Go / evaluable_for_promotion=true — still **not** production filter, still **not** D1/D2.

## Success criteria
1. Both worksheets 200/200 non-null valid labels
2. Merge: independentlyReviewedTrajectories >= 200
3. unresolvedDisagreements == 0
4. kappa / holdout recall / false-drop computable; report honestly
5. No Phase C/D, no V1 retune, no runtime mutation
6. Final message includes authority disclosure + deliverable paths

## Deliverables (must update)
Absolute base:
`C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\tier-c\`

Required files:
- `reviewer-A.worksheet.v1.json`
- `reviewer-B.worksheet.v1.json`
- `reviews.v1.json`
- `report.v1.json`
- `evaluation-campaign-status.v1.json`
- `disagreements.v1.json`
- `DISAGREEMENT-RESOLUTION-LOG.md` (if any adjudication)
- `GO-NO-GO.md`
- `TIER-C-STATUS.md`
- `USEFULNESS-METRICS.md` / `usefulness-metrics.v1.json`

Also mirrored reviews may appear under:
`C:\Users\27933\Desktop\clawx\ClawX-hermes-memory\artifacts\sekb-hermes-phase-a5\shadow-evaluation-reviews.v1.json`

## Final reply template
1. Go / No-Go + evaluable_for_promotion
2. Hard gate table (required vs actual)
3. Agreement: kappa, disagreements resolved count
4. Holdout: valuable recall, projected false-drop
5. Authority disclosure (agent dual-review proxy)
6. Explicit: evaluable_for_promotion ≠ production filtering; D1/D2 still needs separate approval
7. Absolute paths of all deliverables

## One-line constraint
No fabricated gate-chasing after seeing metrics except formal adjudication; no V1 retune; no runtime enablement from offline artifacts.
