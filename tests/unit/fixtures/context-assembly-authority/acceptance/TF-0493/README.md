# TF-0493 acceptance evidence

- Task: `TF-0493` — one context assembly authority
- Actor: `codex`
- Evidence driver: `agent`
- Product defaults changed: no
- VerseGit scope: excluded

## Delivered contract

- One shared `TurnInjectionLedger` per turn.
- One immutable `ContextFinalSnapshot/v1` per actual model call, independent of the optional RC-03 receipt flag.
- C6 is an automatic, bounded internal policy for DCS Block projection; it has no user-facing opt-in.
- VToken remains an internal source packer. Its Bridge panel and standalone context-layer product copy are removed from Settings.
- Final provider `RequestEnvelope/v1` identity is tied to the sealed RC-03 plan and ContextBundle digest.
- Tool-loop model-call advancement, provider fallback attempt reset, compaction cleanup, and handoff/task-state behavior remain owned by the existing runtime paths.

## Acceptance mapping

| Criterion | Evidence |
|---|---|
| one budget ledger per turn, one final snapshot per actual model call | `context-assembly-evidence.json`; `tests/unit/context-assembly-authority-tf0493.test.ts` |
| C6 has a concrete internal path or is retired, with no permanent opt-in | `context-assembly-evidence.json#c6`; `openclaw_runtime/src/context-engine/context-ladder.ts` |
| tool loop/retry/fallback/fork/handoff lineage and budget remain consistent | focused runtime tests, including working-memory model-call advancement, RC-03 fallback reset and task-state handoff |
| VToken has no user-level Bridge switch or independent product copy | `src/pages/Settings/index.tsx`; `tests/e2e/vtoken-bridge-settings.spec.ts` |
| final provider request context matches bundle evidence | provider-envelope fixture test plus `raw-evidence.json#providerEnvelope` |
| off/on prompt snapshot, lineage and rollback tests pass | assembler kill-switch and RC-03 byte-parity/rollback tests |

## Reproduction

```powershell
& '.\openclaw_runtime\node_modules\.bin\tsx.CMD' 'tests/unit/fixtures/context-assembly-authority/acceptance/TF-0493/generate-acceptance.mts'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'tests/unit/fixtures/context-assembly-authority/acceptance/TF-0493/run-verification.ps1'
```

## Unverified boundary

This evidence does not claim public release, GA, liveReady or productApproved.
It does not replace the later real effective-state adapter: live driver, grant,
ack, quarantine, memory/knowledge and restart propagation remain deferred to the
explicit later nodes.