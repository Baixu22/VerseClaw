# VS-P1-03 MCP Compatibility Evidence

Date: 2026-08-14  
Task Forest: `TF-0063` / VS-P1-03  
Scoped spec: [`verseshell-p1-mcp-compatibility.md`](../../../harness/specs/tasks/verseshell-p1-mcp-compatibility.md)  
Scoped rule: [`verseshell-mcp-compatibility-boundary.md`](../../../harness/specs/rules/verseshell-mcp-compatibility-boundary.md)  
Candidate HEAD: `d6750aee0caffa43c1b39874c15d98d861052df6`  
Base HEAD parent: `ff07973eb3d46c256cd8c2540835154976b94098`  
Worktree: dirty; this is engineering evidence, not clean-release or canary evidence.

## Scope

This package hardens the external `resources/verseshell-mcp` compatibility adapter. It does not
add a ClawX internal MCP dependency, expand the model-visible VerseShell facade, add writes, enable
native fallback, or alter rollout/product locks.

## Implemented boundary

- Product profile is deny-by-default. With no explicit grant, only the side-effect-free
  `verseshell_health` tool is listed and the VerseShell runtime is not spawned.
- `all`, `*`, and unknown capability names fail before server startup. The catalog is filtered by
  profile and exact capability grant; denied calls return stable `E_PROFILE_DENY`,
  `E_CAPABILITY_DENY`, or `E_TOOL_DENY` errors.
- `verseshell_eval` and `verseshell_shell_exec` are development-profile-only. Shell compatibility
  accepts an explicit argv vector and rejects shell metacharacters, NUL bytes, and unterminated
  quotes before constructing the `shell.exec([...])` typed expression.
- Capability names are checked against the pinned runtime grant vocabulary, including
  `crypto.hash`, `crypto.random`, and `sys.uptime`. Adapter-only `catalog.read`,
  `compat.transpile`, and `health.read` are never passed as runtime grants. Unknown legacy tools
  and deferred effectful tools are fail-closed, so P1 does not publish file mutation, archive
  mutation, or clipboard write paths.
- Runtime startup always uses `--agent --policy strict`. The adapter treats a spawned child as
  requestable immediately, avoiding a stdout-readiness deadlock when the runtime emits its first
  response only after stdin receives a request. A real Windows x64 MCP-to-runtime smoke covers the
  grant, health identity, read tool, and deferred-write filtering path.
- Package version is read from `resources/verseshell-mcp/package.json`; protocol, runtime version,
  expected server protocol, operation catalog digest, and catalog count are read from the tracked
  `resources/verseshell/manifest.json`. Health reports bounded identity only and omits workspace,
  executable path, approval token, and raw command text.
- The MCP package is a workspace member with a frozen lockfile and a real
  `@modelcontextprotocol/sdk` dependency. It remains an external compatibility surface and is not
  used by the ClawX typed facade.

## Verification

| Command | Result |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p1-mcp-compatibility.md` | PASS |
| `pnpm harness validate --spec harness/specs/tasks/verseshell-p1-mcp-compatibility.md --no-diff` | PASS |
| `pnpm run verseshell:mcp:install` | PASS; frozen lockfile, workspace importer present |
| `pnpm run verseshell:mcp:test` | PASS; 11/11 |
| `pnpm verseshell:test` | PASS; bundle 13/13, runtime-bundle 11/11, OpenClaw 64/64, MCP 8/8 |
| `pnpm run typecheck:node` | PASS |
| `pnpm run comms:replay` then `pnpm run comms:compare` | PASS; zero loss/duplicate/order/RPC violations |

## Scenarios

| Scenario | Result |
|---|---|
| product profile without grants | only health listed; runtime start skipped |
| explicit `file.read,shell.exec` | only corresponding read/process facade appears; eval/shell compatibility remains hidden |
| development profile + `shell.exec` | explicit process, dev shell argv adapter and eval appear |
| `--cap all`, `--cap *`, unknown capability | startup exits 1 with `E_CAPABILITY_CONFIG` |
| shell metacharacters or unmatched quote | `E_ARG`; no shell wrapper is built |
| MCP initialize/tools/list/tools/call | startup smoke succeeds with SDK and no runtime capability |
| file.read grant with packaged Windows x64 runtime | real read call succeeds; strict runtime reports file.read; deferred write and unknown platform tools stay hidden |

## Residuals and locks

The ordinary diff-aware Harness validation remains subject to the shared-worktree ownership and
local harness dependency residual already recorded by the foundation evidence. Full aggregate
typecheck/lint and repository-wide diff checks are not reclassified as passing by this scoped gate.
The implementation remains engineering evidence only. Keep `default-off`, `liveReady=false`,
`productApproved=false`, and `defaultOn=false`; do not start P2, write, provider canary, or rollout
work until the Task Forest closeout is applied and the next node is explicitly unlocked.
