# Unified permission/effect checkpoint evidence

Status: **pass** for the six registered side-effect components.

- driven_by: `agent`
- actor: `codex`
- source commit: `cbbd29c231e24a5e1de48b9d3a29fcfab2be479f`
- source tree: `120219f7a7c406c3934f827f7e51ba0c218c53b2`
- product locks changed: `false`
- real-human evidence claimed: `false`

## Implemented boundary

| Component | Final production checkpoint |
|---|---|
| Browser | `electron/services/agent-browser-api.ts`; Gateway bridge delegates to the same helper |
| Exec | Policy/approval code creates evidence; `runExecProcess` only rechecks supplied evidence |
| Knowledge apply | Checked after approval, digest, workspace and target-revision validation |
| Fact tools | Checked after the `context_write` role whitelist and before the notes sink |
| Memory write | Checked in the single `storeMemoryCard` persistence path |
| Coding control | Existing Stage4 grant and ApprovalLedger checks followed by the shared final checkpoint |

Each component accepts only its registered authority owner. The grant is temporary,
non-persisted evidence over the existing owner decision; no second approval database
or grant store was introduced. Exec deliberately does not create owner evidence
inside its executor.

## Gates

- Root focused Vitest: 7 files, 98 tests passed.
- Runtime focused Vitest: 5 files, 38 tests passed.
- Full typecheck: node, web and test projects passed.
- Contract check and Harness spec validation: passed.
- Changed-file ESLint: 0 errors; 29 existing `no-explicit-any` warnings in `knowledge-api.ts`.
- Comms replay/compare: PASS, all metrics within thresholds.

## Boundary

This evidence proves the Windows x64 local path and the checked-in runtime/Electron code.
It does not claim a packaged release, live-provider run, non-Windows platform, full
Playwright matrix, product-lock change, or real-human evidence.