# TF-0504 VerseShell / observability internal substrate

- Task: `TF-0504` - converge VerseShell and observability into the single internal execution/evidence substrate
- Actor: `codex` | Evidence driver: `agent`
- Release boundary: no public release, GA, liveReady or productApproved claim

## What changed

| Area | Change |
|---|---|
| `shared/model-capability-profile.ts` | The forbidden internal-name list now also covers `VerseShell`, `Observability recorder` and `event log`, so the substrate cannot be self-described as a user-visible capability. Bare `Observability` stays allowed because `surface.observability` is a real user surface. |
| `tests/unit/verseshell-internal-substrate-tf0504.test.ts` | New guard proving the single governed local spawn owner, the preserved out-of-domain owners, the internal disposition of adapter/recorder, lifecycle-matrix coverage, the absence of writable toggles, no-native-fallback/kill-switch behaviour and the model-positioning exclusion. |
| `tests/unit/model-capability-profile.test.ts` | The prompt assertion now also rejects the substrate names. |

## Acceptance mapping

| Criterion | Status | Evidence |
|---|---|---|
| One executor in the eligible-local domain, out-of-domain owners preserved | pass | `01-tf0504-guard.txt`; `09-substrate-audit.txt` |
| Cancel/timeout/PTY/pipes/cleanup/restart recovery and in-flight terminal/lost handling | pass | `03-verseshell-lifecycle.txt`; UAS-06 matrix + hard vetoes |
| No user-facing VerseShell/RC-03/event-log product switch | pass | `01-tf0504-guard.txt`; `09-substrate-audit.txt` |
| trace/receipt/log do not change the verdict or trigger execution | pass | `03-verseshell-lifecycle.txt`; internal recorder disposition |
| The model does not self-describe internal observability as a feature | pass | `02-model-positioning.txt` |

## Gates

See `verification.json`: TF-0504 guard, model positioning, governed-process/canary/RC-03 suites,
typecheck, lint, contract, no-BOM, diff check, substrate audit, scope audit, checksum check.

## Unverified boundary

- `openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts` fails 3 of 22 cases and takes ~160s.
  Provenance was verified with `git stash` at HEAD `91c429310` (no TF-0504 changes applied): the same three
  cases fail, so this is pre-existing. It is excluded from the gates with that record. The COMPASS-budget
  case injects `compassContext` directly and is therefore independent of the TF-0500 retired path.
- `tests/unit/uas-05-verseshell-process-lifecycle.test.ts` fails in this checkout because it hashes the
  bundled binary `resources/bin/win32-x64/ae.exe`, which is missing and gitignored (`.gitignore:70`) as a
  build artifact. It is excluded from the gates with this recorded reason; the failure is an environment
  precondition, not a source defect.
- The operator-facing inventory rows in `shared/dcs/prod-flags-catalog.ts` remain read-only documentation
  (no toggle); relabelling or removing them belongs to TF-0505/TF-0506.
- `docs/dev/default-config-matrix.md` still carries the pre-retirement wording; docs/ is outside this
  node paths (TF-0506).
- Agent-driven only; no human evidence is claimed.
