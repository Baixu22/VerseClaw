# Chain Audit v2 - full-chain integration test / acceptance monitor

Reusable, config-driven, quantified integration tests that exercise the real
OpenClaw gateway + a real model over every major agent chain, plus a direct
RPC service surface. Designed to catch cross-component defects that unit tests
cannot (three rounds found 13 real issues #9-#21).

## Quick start

```bash
# full matrix (real model required)
DEEPSEEK_API_KEY="sk-..." node scripts/chain-audit/run-chain-audit.mjs

# deterministic RPC surface only (no model, no API cost)
node scripts/chain-audit/run-chain-audit.mjs --rpc-only

# fail-closed CI gate: agent>=75, rpc>=75, no critical failures, all RPC groups pass
DEEPSEEK_API_KEY="sk-..." node scripts/chain-audit/run-chain-audit.mjs --ci

# one or more chains
DEEPSEEK_API_KEY="sk-..." node scripts/chain-audit/run-chain-audit.mjs --chain readonly --chain coding

# unit tests for the checker itself
node --test scripts/chain-audit/tests/*.test.mjs

# cross-run reliability (per-task spread / pass-rate / stability)
node scripts/chain-audit/reliability.mjs --runs 4
```

## Evidence rules (v2)

Every declared check is evaluated from real evidence and is fail-closed:

| Check | Evidence |
|---|---|
| `tools.<name>` | tool was called AND a linked tool result has `isError=false` (a denied/errored call is a failure). `toolModes.<name>: "call"` relaxes to call-only for error-path probes. |
| `hasAnswer` | at least one model round AND non-empty final answer text (`NO_REPLY` sentinel excluded). |
| `memory.available` | `memory_search`/`memory_get` result is a real success without disabled/missing-index markers. |
| `answerContains.<i>` | final answer contains `answerContains[i]`. |
| `fileCheck.<label>` | workspace file is absent/exists, or matches positive regexes and no negative regexes. |
| `toolResult.<tool>` | a tool result text matches every pattern in `toolResultChecks`. |
| `evidence.matched` | the transcript provably belongs to this task (first user message match). |
| `evidence.complete` | the transcript ended with an assistant message. |

Unknown check names abort before any run (`lib/validate.js`). No check is ever
silently dropped.

## RPC probe modes

- `checks` (normal): call with operator.read/write scopes; a scope denial is a failure.
- `adminOnly` (deny): must be denied without the required scope; an unexpected success = "security gate missing".
- `adminOk` (allow): call with the configured scopes and must succeed.
- `expectError`: must fail with the configured error; an unexpected success = failure.
- `mutating`: probes are skipped unless `--allow-mutations` is passed.

Groups are graded per-group; any critical group failure forces an F. Reports
record `payloadKeys` per probe and per-task before/after file hashes.

## Evidence binding and exit codes

Every report under `artifacts/chain-audit/evidence/<ts>/` binds HEAD, branch,
tree-dirty state, matrix/rpc config digests, runtime entry mtime/build stamp,
node/platform. `history.json` keeps the last 50 runs with those bindings.

| Exit | Meaning |
|---|---|
| 0 | passed |
| 1 | runner/gateway/config error |
| 2 | agent score below `--fail-on-score` |
| 3 | rpc score below `--fail-on-rpc-score` (or a group failed under `--ci`) |
| 4 | critical check failed under `--ci` |
| 5/6 | no executable checks / no chain-filter hits |

## Workspace isolation

`CHAIN_AUDIT_WORKSPACE` overrides `matrix.common.workspace`. Task messages use
`{{workspace}}` for project paths. Destructive chains run in a per-run
`scratch-git` fixture, never against the real project. The `jforum-fix` chain
refuses to run against a workspace already diverged from its baseline unless
`--restore-baseline` is passed (current files are backed up first).

## Extending the matrix

Add chains/tasks to `config/matrix.json` (schema v7) and probes to
`config/rpc-checks.json` (schema v3). Declared checks must map to
answerContains/fileChecks/toolResultChecks specs; validation rejects
unresolvable checks.
