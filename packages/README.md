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
types before a standalone typecheck or test run. No build depends on the
independent `D:/versebrowser` checkout; that path is only used by provenance audits.

- Desktop: renderer `hostApi.agentBrowser` -> Main host adapter -> embedded driver.
- Model: `agent_browser` -> Gateway `agentBrowser.invoke` -> Main host adapter.
  The model schema lists 24 actions: 11 original actions plus the 13 unsupported
  additions below. It does not expose `takeSnapshot`; its `command snapshot`
  diagnostic requires the optional CLI executable. Do not treat this as a complete
  snapshot/action/verification model workflow, or bypass the owners with renderer
  IPC, a second MCP session or an SDK fallback.
- The host contract contains 80 methods, but the Electron driver implements only
  the original 67. The 13 facade-only additions (downloads/uploads, pointer/drag,
  select/append/check, find, semantic reads, forms and dialogs) return explicit
  `E_NOT_IMPLEMENTED`; they are not evidence of usable Electron capabilities.
- Host transport `ok: true` only means dispatch succeeded. Also inspect the nested
  `success` / `ok`, `error`, observation completeness and business verdict. Never
  retry a denied or unsupported mutation through another backend.
- Open an owned session, observe it, obtain any required runtime-mode authorization,
  act, re-observe the result, then close that session. Agent-driven fixture approval
  is not real-human evidence and does not authorize other sessions or origins.
- The existing optional `agent-browser` CLI is injected into the same host service.
  CLI commands/external browser attachment still require the bundled executable;
  its absence is not repaired by pretending the Electron driver supports those calls.
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
