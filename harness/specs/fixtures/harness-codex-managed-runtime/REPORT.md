# Codex Managed Runtime Acceptance

> Agent-driven TF-0566 evidence. The current release tree was produced by `electron-builder --win --dir`. This does not approve a default runtime, publish a release, or claim an authenticated model turn.

## Verdict

| Claim | Observed state |
|---|---|
| sourceBinary | available |
| sourceAppServerProtocol | pass |
| packagedRuntime | available |
| packagedLaunch | pass |
| authenticationBoundary | recorded-unauthenticated |
| managedTurn | not-run |
| defaultPathChanged | false |
| productApproval | not-claimed |

## Current receipts

- Source: `source-runtime.json`
- Packaged: `packaged-runtime.json`
- Both resolve the plugin-local `@openai/codex` Windows binary directly, never through system PATH.
- Version: `codex-cli 0.137.0`
- Binary bytes: `247691568`
- Binary SHA256: `dae89a14373859b04e05a801a6104e1ef8c007059355fcd07a4eb64f893455dc`
- app-server initialize: returned `userAgent`, `codexHome`, `platformFamily=windows`, and `platformOs=windows` from both roots.

## Packaging

- Command: `node scripts/run-electron-builder.mjs --win --dir --publish never`
- Exit code: `0`
- App executable: `release/win-unpacked/Verse Claw.exe`
- App executable SHA256: `465e7bf060e573f9fac8c6f4d5c2b8ad6c70be9754bbee3e21615d5d6955c164`
- VerseShell `ae.exe` identity was reused from the previously qualified artifact and validated against `resources/verseshell/manifest.json`; package validation exited 0.

## Historical probe

`runtime-probe-20261026.json` is preserved as the earlier pre-fix probe. It correctly reported `packaged-unavailable` because the plugin-local dependency tree had not yet been materialized. It is superseded for current availability by the two receipts above.

## Boundaries

- No authenticated Codex model turn was run; the isolated unauthenticated probe remains the authentication failure boundary.
- No credentials, auth headers, or private prompts are retained.
- ACP adapters and alternate harnesses are outside this node's packaged-codex availability decision.
- No product selector, frozen default, release lock, public release, GA, liveReady, or productApproved state changed.
- All retained evidence is agent-driven; no real-human evidence is claimed.
