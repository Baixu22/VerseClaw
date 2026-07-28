# SEKB human-confirm production loop (TASK-P1-05)

## Product policy (hard)

| Rule | Status |
|------|--------|
| Human confirm required before principle persist | **enforced** (`confirm_and_save` only) |
| Auto writeback / unattended worker | **forbidden** (`cutoverAllowed=false` always) |
| Default-on SEKB full inject | **forbidden** |
| suggest_* may not write principles | **enforced** (ANTI-8) |

## ≤3 step operator path (after enable)

1. **Capture** — host `knowledge.sekbCaptureTrajectory` (or product UI that wraps it) after a task run.  
2. **Suggest** — `knowledge.sekbSuggestPrinciples` (candidates only).  
3. **Confirm** — `knowledge.sekbConfirmPrinciple` → then **Recall** via `sekbRetrieveForTask`.

Electron product host path is validated by `tests/e2e/sekb-golden-path.spec.ts` (no main-process bypass for confirm semantics).

## Discoverability

| Surface | How to find |
|---------|-------------|
| Knowledge nav | Sidebar → Knowledge (`sidebar-nav-knowledge`) |
| i18n | `knowledge:runtime.title` = “Runtime Lessons”; subtitle mentions SEKB |
| Docs | `docs/dev/sekb-golden-path.md` |
| Host API | `sekbCaptureTrajectory` / `sekbSuggestPrinciples` / `sekbConfirmPrinciple` / `sekbRetrieveForTask` |

## Acceptance automation

```powershell
# unit
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts `
  src/knowledge/sekb/golden-path.test.ts `
  src/knowledge/sekb/experience-shadow-cutover-pack.test.ts `
  src/knowledge/sekb/experience-block-bridge.test.ts

# e2e (built app)
pnpm exec playwright test tests/e2e/sekb-golden-path.spec.ts --workers=1
```

Evidence artifact: `artifacts/sekb-golden-path/evidence.json`  
Requires: `evaluation.writeOccurredOnlyAfterConfirm=true`, `noAutoWriteback=true`, `chainComplete=true`.

## Human 10-run residual

Free-form human product UI sessions (≥10) remain **calendar residual**.  
This task closes when **supervised host golden path + anti-auto-writeback locks** are green and discoverability is documented — same honesty class as OPS-01 accept-with-residuals.
