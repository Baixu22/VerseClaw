# TF-0512 runtime effective-state acceptance

- Task: `TF-0512` — bind `ModelCapabilityProfile/v1` to real runtime effective state.
- Actor: `codex`
- Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded
- Release boundary: no public release, GA, liveReady or productApproved claim

## Deliverable

The runtime adapter in
`openclaw_runtime/src/runtime-core/model-capability-effective-state.ts` turns the
admitted tool inventory, process runtime acknowledgement, grants, quarantine,
memory and knowledge observations into a fresh `ModelCapabilityProfile/v1`.

`openclaw_runtime/src/context-engine/model-capability-prompt.ts` bridges that
adapter into the active context-engine `assemble()` boundary. The built-in
default context engine is `legacy`; its `assemble()` runs for each model call.
The returned bounded capability text becomes the context engine's
`systemPromptAddition`, after which the normal prompt/candidate projection runs.

## Safety rules

- Static disposition never proves runtime availability.
- A missing, stale, rejected or generation-mismatched runtime ack leaves
  availability and drivers `unknown`.
- `local-fallback` capability publications are not executable proof.
- Tool presence alone does not grant permission. Side-effect actions remain
  `requires-approval` until an active grant is present.
- Expired and revoked grants become denied at refresh time.
- Tool-schema quarantine is preserved as a negative runtime fact.
- The run generation guard rejects an older refresh before it can project into a
  newer model call.
- Static digest changes only with static catalog/configuration; effective digest
  changes with effective facts and ignores observation-only timestamps.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| loading/unavailable/degraded/quarantined propagation | `raw-evidence.json#observations`; focused tests |
| grant expiry/revocation and config-switch refresh | `raw-evidence.json#observations.expiredGrant`, `revokedGrant`, `killSwitch` |
| actual tool denial agrees with profile | `raw-evidence.json#toolOutcomeCrossCheck` |
| restart recovery/downgrade is explainable | `raw-evidence.json#observations.restartMismatch` |
| static/effective digest auditability | `raw-evidence.json#digestAudit`; `profile.json` |

## Reproduction

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  'tests/unit/fixtures/model-capability-effective-state-tf0512/run-verification.ps1'
```

The generator is executed through Vitest so it uses the repository's normal
module-resolution path. `verification.json` records exact gate exit codes and
log hashes; `SHA256SUMS` seals every retained artifact.

## Unverified boundary

This is fixture-driven runtime-adapter and context-engine boundary evidence. It
does not claim a live provider request, Electron E2E, latency/benefit result,
public release, GA, liveReady or productApproved. Component owners still own
the acceptance of any additional live state source they add.