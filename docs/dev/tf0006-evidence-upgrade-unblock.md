# TF-0006 M2/M3 Evidence Upgrade ? Unblock Criteria

> Status: **blocked**
> Node: TF-0006
> Date: 2026-07-19
> Decision: **do not unblock** until real evidence exists; synthetic / P0 green is insufficient

## Why blocked (clarified)

TF-0001 closed as **accept-with-residuals** with:

- `liveReady = false`
- `productApproved = false`
- `readyForDefaultFlagGraduation = false`
- joint-system GA = **NO-GO**

TF-0006 is the **only** node that may later support a default-on *discussion*. It is blocked because required evidence classes are missing or still synthetic:

| Required class | Current state | Notes |
|---|---|---|
| Real (non-synthetic) corpus at target scale | **missing / synthetic only** | e.g. `artifacts/dcs-corpus/synthetic-agent` is not liveReady |
| Human live A/B on production-like path | **missing** | not substituted by unit/E2E goldens |
| Soak / stability window | **missing** | duration + regression budget TBD by product |
| Product approval record | **missing** | `productApproved` stays false |

P0 artifacts (orchestrator, defaults matrix, SEKB golden path, Browser recovery) prove **controlled operable**, not M2/M3 readiness.

## Unblock checklist (all required)

1. **Real corpus**
   - Non-synthetic dataset with documented provenance
   - Scale target: playbook residual **64K-class** (or product-approved substitute scale)
   - Manifest path under `artifacts/tf0006-evidence-upgrade/corpus-manifest.json`
2. **Human live A/B**
   - Protocol + results under `artifacts/tf0006-evidence-upgrade/live-ab-report.json`
   - Must include: cohort size, win/loss/tie, safety incidents, opt-out path
3. **Soak**
   - Soak plan + results under `artifacts/tf0006-evidence-upgrade/soak-report.json`
4. **Product gate**
   - Explicit `productApproved: true` record under `artifacts/tf0006-evidence-upgrade/product-approval.json`
   - Named approver + date + scope (which flags may graduate)
5. **Honesty gate still true until approval**
   - Even after corpus lands, **do not** flip defaults in the same PR as first evidence drop
   - Graduation is a separate, reviewed change against `docs/dev/default-config-matrix.md`

## Explicit non-goals while blocked

- Do not set `liveReady=true` because Agent Dev / P0 E2E is green
- Do not enable SEKB auto writeback
- Do not flip VToken / Runtime Memory / private-network defaults to on
- Do not mark TF-0006 `done` without the four evidence files above

## Deprecate / cancel option

If product decides M2/M3 default-on is abandoned:

- Record decision in `artifacts/tf0006-evidence-upgrade/status.json` with `decision: "deprecated"`
- task-forest: set TF-0006 `status=deprecated` with reason
- Keep `readyForDefaultFlagGraduation=false`

## Machine status

`artifacts/tf0006-evidence-upgrade/status.json` is the lock file. Unit test asserts:

- `status === "blocked"`
- all graduation flags false
- required evidence files are **not** claimed present until they actually exist

## Related

- Close-out: `docs/dev/tf0001-controlled-operable-closeout.md`
- Defaults: `docs/dev/default-config-matrix.md`
- Playbook: `docs/dev/Sustained-Development-Playbook.md`
