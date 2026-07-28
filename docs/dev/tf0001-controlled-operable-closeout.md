# TF-0001 Controlled Operable Close-out (NOT joint-system GA)

> Status: **accept-with-residuals**
> Node: TF-0001
> Date: 2026-07-19
> Decision: P0 controlled-operable baseline **met**; full-system default-on / GA remains **NO-GO**

## Verdict (honest)

| Gate | Value | Meaning |
|---|---|---|
| Controlled operable (non-GA) | **YES** | P0-1..P0-4 evidence exists and is locked by tests/E2E |
| `liveReady` | **false** | No real 64K corpus / human live A/B (TF-0006) |
| `productApproved` | **false** | No product graduation review |
| `readyForDefaultFlagGraduation` | **false** | Defaults stay fail-closed / opt-in |
| Joint-system GA | **NO-GO** | Do not market or flip default-on |

Rewriting honesty packs does **not** turn NO-GO into GA.

## Acceptance criteria map

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Single Context Orchestrator on production turn | **met** (TF-0002) | `docs/dev/context-orchestrator.md`, `openclaw_runtime/src/context-engine/context-orchestrator.ts`, `tests/unit/context-orchestrator-entry-scan.test.ts` |
| 2 | Default policy matrix locked; VToken/DCS/Browser not contradictory | **met** (TF-0003) | `docs/dev/default-config-matrix.md`, `tests/unit/default-config-matrix.test.ts` |
| 3 | SEKB semi-auto golden-path E2E green | **met** (TF-0004) | `docs/dev/sekb-golden-path.md`, `tests/e2e/sekb-golden-path.spec.ts`, `artifacts/sekb-golden-path/evidence.json` |
| 4 | Browser private network default false + task recovery | **met** (TF-0005) | `docs/dev/browser-security-recovery.md`, `tests/e2e/browser-security-recovery.spec.ts`, `artifacts/browser-security-recovery/evidence.json` |
| 5 | liveReady/productApproved may stay false with honest residuals | **met** (this doc) | Explicit false gates above + residual list |

## What is in production posture today

- Memory/context enhancement: **opt-in / kill-switchable**, fail-closed
- VToken: **default off** (assembly + bridge)
- SEKB: **human confirm** path only; **no auto writeback**
- Browser: private network **default deny**; mode upgrade **userApproval** gate; tasks recover as **interrupted** after restart
- Agent Dev green ? joint-system GA

## Residuals (explicit, non-P0-debt / blocked only)

1. **TF-0006 blocked**: real corpus + human live A/B required before any default-on discussion
2. **Assembler/CVK dual path architecture** remains (flags default off); production attempt gates CVK systemPromptAddition with enhancement kill switch - full stage unification is future architecture, not open P0 debt
3. **agent-browser CLI open** can be flaky in some E2E environments (unit + recovery path cover restart; do not treat CLI flake as product GA blocker)
4. **SEKB inject** in full live agent dialogue remains feature-flag gated (by design)
5. **No unsupervised browsing GA** (by design)

### P0 tech-debt cleared (production pass)

- Unacked private-network allow auto-migrates to deny (both dangerouslyAllowPrivateNetwork and allowPrivateNetwork)
- Kill switch cuts VToken + memory inject + DCS flags + CVK addition fail-closed
- Unified gate: tests/unit/p0-production-acceptance.test.ts + artifacts/p0-production-pass/evidence.json
## Forbidden follow-ups (until TF-0006 + product review)

- Flip any memory/context/SEKB/Browser private-network default to production full-on
- Claim joint-system GA because P0 E2Es are green
- Enable SEKB unattended writeback
- Treat Agent Dev scorecard green as product release

## Close-out artifact

Machine-readable: `artifacts/tf0001-closeout/evidence.json`

## Next

- Optional residual hardening only when explicitly requested
- Otherwise only TF-0006 (blocked) can raise readiness for default-on debate
