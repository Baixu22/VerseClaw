# Packages

This directory contains components that are packaged by Verse Claw but are not
all JavaScript packages in the pnpm workspace.

| Package | Language | Workspace membership |
| --- | --- | --- |
| `versebrowser` | TypeScript | Private `@verse-claw/versebrowser` workspace module; builds from source and is consumed through public exports |
| `vtoken` | Python / uv | Deliberately outside `pnpm-workspace.yaml`; launched as a sidecar |
| Shared JavaScript packages | TypeScript | Declared by the nearest `package.json` and `pnpm-workspace.yaml` where applicable |

The repository root, `harness`, `packages/versebrowser` and
`resources/verseshell-mcp` are JavaScript pnpm workspace packages. `packages/vtoken` is copied into the Electron application
through `electron-builder.yml` and must not be treated as a pnpm dependency.

## VerseBrowser integration and invocation

`pnpm install`, `pnpm dev`, `pnpm dev:mock` and `pnpm run build:vite` compile
`@verse-claw/versebrowser` before consuming its ignored `dist/` outputs. After
editing module source, `pnpm run versebrowser:build` also refreshes the public
types before a standalone typecheck or test run. The same build applies the required
hash-pinned `playwright-core` bundle patch (`packages/versebrowser/scripts/patch-upstream.mjs`)
before `tsc`, so a fresh checkout needs no manual `patch:upstream` step; `patch:upstream:check`
verifies it and browser `open` fails closed with `E_UPSTREAM_PATCH` if it is missing.
No build depends on the independent `D:/versebrowser` checkout; that path is only used by provenance audits.

- Desktop: renderer `hostApi.agentBrowser` -> Main host adapter -> embedded driver.
- Model: `agent_browser` -> Gateway `agentBrowser.invoke` -> Main host adapter.
  The model schema lists 24 actions and is filtered by the live capability snapshot, so an
  action the active driver cannot serve is neither advertised nor executed. The desktop host
  serves every managed session through the embedded Electron browser-window engine (the
  `agent-browser-cli` engine is only selected for external/CDP attachment), so `takeSnapshot`,
  `extractPageText`, `pressKey` and `verifyFlow` belong to the desktop workflow while `command`
  (CLI passthrough) is not advertised there. Do not bypass the owners with renderer IPC, a
  second MCP session or an SDK fallback.
- The model vocabulary now includes `takeSnapshot`, `extractPageText`, `pressKey` and `verifyFlow`,
  so open -> observe -> act -> re-observe -> business verify -> close is reachable without the optional
  CLI. `verifyFlow` reuses the facade's own judge (not a second one) and returns PASS only when the
  business assertions hold AND console/network collection is complete; otherwise it returns UNKNOWN.
- The 13 source-only additions stay in the DECLARED runtime vocabulary (the reintegration
  contract and `versebrowser:api-coverage` pin the full source-method list) but are NOT advertised:
  the model schema defaults to the declared list minus `DRIVER_UNAVAILABLE_ACTIONS`, and every direct
  or forged call is rejected by Main with an `UNSUPPORTED` envelope before any browser effect. They are
  not delivered capabilities; enabling one requires real driver support, not a second engine.
- The host contract contains 81 methods, but the Electron driver implements only
  the original 67. The 13 facade-only additions (downloads/uploads, pointer/drag,
  select/append/check, find, semantic reads, forms and dialogs) return explicit
  `E_NOT_IMPLEMENTED`; they are not evidence of usable Electron capabilities.
- `agentBrowser.status` carries a capability snapshot (24 model actions, each with an
  `available` flag and a reason) derived from the live driver profile and, on surfaces that
  actually serve CLI sessions, the bundled-CLI presence - never from the 81-method contract
  or from a wrapper function existing. Actions the
  driver refuses are neither advertised nor executed: Main rejects them with
  `E_CAPABILITY_UNAVAILABLE`/`AgentBrowserCapabilityError` before any browser effect, and the
  snapshot carries a deterministic `version` so a derived schema is only rebuilt when facts change.
- Host transport `ok: true` only means dispatch succeeded. Also inspect the nested
  `success` / `ok`, `error`, observation completeness and business verdict. Never
  retry a denied or unsupported mutation through another backend.
- Open an owned session, observe it, obtain any required runtime-mode authorization,
  act, re-observe the result, then close that session. Agent-driven fixture approval
  is not real-human evidence and does not authorize other sessions or origins.
- The desktop host deliberately does NOT inject the bundled `agent-browser` CLI into the
  session engine: whenever a CLI runner is present the package prefers the
  `agent-browser-cli` engine for every managed `open()`, and that engine cannot serve
  `takeSnapshot`/`clickByUid`/`fillByUid`/`pressKey`. Packaged evidence for both the defect
  and the fix lives in `harness/specs/fixtures/versebrowser-invocation-maturity/n8-20261016/`.
  The bundled CLI stays wired on the standalone/MCP facade
  (`packages/versebrowser/src/engine/api.ts`); CLI passthrough and external browser
  attachment are that surface's capabilities, and the desktop snapshot reports
  `cliAvailable: false` rather than advertising them.
- Standalone VerseBrowser MCP/CLI is a separate driver and workspace lifecycle.
  Its tool availability does not prove the desktop or Gateway path works. On Windows,
  use Node >=24.16 / libuv >=1.52.1 for browser probes; the test guard must not be bypassed.

Run `node scripts/versebrowser-api-coverage-verify.mjs` for both declared coverage
and actual driver availability. Its pass is a contract-coverage result, not full
runtime, model, packaged-app or product acceptance.

For a separate, localhost-only **standalone driver** smoke test, build the module,
then run `node scripts/versebrowser-standalone-smoke.mjs --output <receipt.json>`
with the supported Node runtime and TEMP/TMP on D: on this Windows machine. It
opens, fills, clicks, re-observes, verifies a business assertion, and closes its own
session. This does not validate the ClawX renderer, Gateway, model or release package.
