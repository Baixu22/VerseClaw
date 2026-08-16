---
id: verseshell-foundation-p0-boundary
title: VerseShell Foundation P0 Boundary
type: ai-coding-rule
appliesTo:
  - verseshell-foundation-governance
  - verseshell-p0-runtime-startup
  - verseshell-p0-reproducible-bundle
  - verseshell-typed-aci-adaptation
  - uas-05-verseshell-process-lifecycle
severity: error
---

# Rule: VerseShell Foundation P0 remains fail-closed and evidence-first

## R1: Preserve rollout and product locks

P0 governance and remediation must preserve `default-off`, `liveReady=false`,
`productApproved=false`, and `defaultOn=false`. No P0 check, engineering matrix, or historical
UAS report may enable a canary, default-on path, GA statement, or product approval.

## R2: Keep one owner per boundary

- OpenClaw owns command policy, approval, action-bound tokens, sanitized environment, and the
  model-facing surface.
- ClawX Main/Electron owns bundle identity, workspace/journal, host transport, diagnostics, and
  operator kill switch.
- VerseShell owns typed ACI decoding, runtime-internal validation, process lifecycle, bounded
  observations, and artifacts.
- MCP is an optional external compatibility adapter only; it cannot become the internal execution
  path or bypass any of those owners.

## R3: P0 evidence must be reproducible and classified

Every P0 claim records the candidate SHA, command, exit code, relevant binary/source/manifest
identity, and whether it is a current pass, current failure, conditional source defect, historical
failure, or not run. A packaged-binary pass cannot override a failing source test compilation or
a source/build/protocol mismatch.

## R4: No premature scope expansion

Before VS-P0-01 through VS-P0-03 are complete, do not add facade operations, command profiles,
MCP permissions, write/transaction behavior, canary execution, native fallback, or model-visible
VerseShell tools. Do not use workspace jail as an OS sandbox claim.

## R5: Fail closed on ambiguity

Approval denial must ultimately preserve `E_NEEDS_APPROVAL`; binary, catalog, protocol, policy,
or workspace drift must prevent governed execution. Effectful work is never implicitly replayed
or handed to a native shell after failure.
