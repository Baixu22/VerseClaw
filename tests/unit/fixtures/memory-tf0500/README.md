# TF-0500 Dreams / parallel memory injection retirement

- Task: `TF-0500` - retire the Dreams page, the parallel Runtime Memory injection and legacy memory flags
- Actor: `codex` | Evidence driver: `agent`
- Release boundary: no public release, GA, liveReady or productApproved claim

## What changed

| Area | Change |
|---|---|
| `runtime-core/memory-pre-reply-injection.ts` | `COMPASS_PRE_REPLY_INJECTION_RETIRED`: the SSP and top-5 branches can never fire, so this path no longer injects prompt text next to dcs-context-authority. Pressure/page-fault diagnostics keep their meaning. |
| `runtime-core/memory-runtime-config.ts` | `RETIRED_MEMORY_INJECTION_FLAGS`: `enableSessionStatePage` / `enablePreReplyRetrieval` are stripped from any override, so they can never be true. |
| `runtime-core/memory-context.ts` | `RETIRED_RUNTIME_MEMORY_FLAGS`: `shadow` / `provider` / `proposeFacts` / `persist` resolve to false unconditionally. `candidateGeneration` is kept because `memory.candidate` is proposal-only in the authority manifest. |
| `tests/unit/compass-experience-validation.test.ts` | Dimensions 2-6 (the superseded injection-benefit acceptance) replaced by a retirement lock. |
| `runtime-core/memory-runtime-config.test.ts`, `tests/unit/default-config-matrix.test.ts` | Updated to the retired expectations (the matrix lock ids are unchanged so the fixture registry stays valid). |
| `context-engine/context-orchestrator.test.ts` | TF-0496 closeout correction: the four vtoken-stage assertions now expect the retired behaviour. |

Dreams itself was already developer-mode gated; this node records that as the production boundary
and locks it, and no new user entry or route was added.

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| Production route no longer exposes DREAMS or the old memory page | pass | `09-retirement-audit.txt` |
| Background consolidation creates no second accepted-memory writer | pass | `01-tf0500-acceptance.txt`; authority manifest store boundaries |
| Legacy data migration / rollback tests pass | pass | `01-tf0500-acceptance.txt` |
| CI finds no legacy flag as a user entry or a duplicate injection path | pass | `09-retirement-audit.txt` |

## Gates

See `verification.json`: TF-0500 acceptance, surface and lock suites, runtime memory sweep (10 files,
82 tests), typecheck, lint, contract, no-BOM, diff check, retirement audit, scope audit, checksum check.

## Unverified boundary

- `docs/dev/default-config-matrix.md` still carries the pre-retirement rows: `docs/` is outside this
  node paths, so requirement 5 is deferred to `TF-0506`, which owns the docs surface.
- The retired runtime-memory flag *keys* remain in config schema files outside this node paths; the code
  documents them as retired and cannot resolve them to true.
- Dreams gating is verified as a source-level audit plus the existing dev-mode gate, not by a screenshot.
- Agent-driven only; no human evidence is claimed.
