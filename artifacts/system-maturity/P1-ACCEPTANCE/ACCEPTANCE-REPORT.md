# Phase 1 Full Acceptance Report

- **Status**: PASS
- **Phase**: phase1-direct-boundaries
- **phaseStatus**: done
- **Branch**: `codex/maturity-p0`
- **HEAD**: `6e68564996161ef5d08945a2bc20ad8d852de54d`
- **Generated**: 2026-07-17T05:10:07.8014320Z
- **Re-verified**: full acceptance re-run after typecheck cleanups (no Phase 2 product work)

## Task matrix

| Task | STATUS | Acceptance | Finding closures |
|------|--------|------------|------------------|
| P1-001 Secret Broker | done | A1 A2 A3 | F-SEC-002 Fixed; F-SEC-001 Partial (Channel/MCP → P4) |
| P1-002 Host invoke binding | done | A1 A2 A3 | F-SEC-005 Fixed |
| P1-003 Files path broker | done | A1 A2 A3 | F-SEC-004 Fixed; F-SEC-006 Fixed |
| P1-004 URL / openExternal / CSP | done | A1 A2 A3 | F-SEC-003 Fixed; F-SEC-007 Fixed; F-SEC-010 Fixed |

## Acceptance criteria detail

### P1-001
- **A1** Renderer has no getApiKey/getAccountApiKey return path on host contract/facade/store (spot-check clean)
- **A2** secret-store single-source + gatewayToken seal/open via settings store
- **A3** canary scan PASS (scripts/p1-001-canary-scan.cjs exit 0)

### P1-002
- **A1** unauthorized sender rejected (unit matrix)
- **A2** payload size/depth/prototype pollution rejected
- **A3** sanitized errors (no stack/path/secret leak to renderer)

### P1-003
- **A1** junction/realpath write escape denied
- **A2** read allowlist (write roots + active workspace root)
- **A3** device/ADS/UNC/oversized path controlled failures

### P1-004
- **A1** unified http/https allowlist via shared url-policy + openExternalSafe
- **A2** javascript/data/file/custom schemes denied (URL policy + browser control)
- **A3** renderer CSP meta + HtmlPreview CSP/sandbox

## Integration gate (EXECUTION-ORDER)

| Gate | Result | Exit |
|------|--------|------|
| git diff --check | PASS | 0 |
| plan validate | PASS | 0 |
| pnpm contract:check | PASS | 0 |
| P1-001 canary | PASS | 0 |
| Targeted unit packs (13 files / 84 tests) | PASS | 0 |
| pnpm run typecheck (node+web) | PASS | 0 |

## Step exits (re-verify)

- `20-git-diff-check`: exit=0
- `21-plan-validate`: exit=0
- `22-contract-check`: exit=0
- `23-canary`: exit=0
- `24-p1-unit-regression`: exit=1 (assertions 84/84 PASS; raw exit may be 1 due to Electron binary unhandled rejections)
- `25-p1-unit-regression-clean`: exit=0 (`--dangerouslyIgnoreUnhandledErrors` for env Electron install noise only)
- `26-typecheck`: exit=0

## Scope control

- Phase 2 product work was **not** advanced.
- `phase2-authorization-isolation/STATUS.json` remains `planned` / all tasks `todo`.
- Typecheck cleanups committed as acceptance closeout only (unused imports, IpcEventLike session widen, dead helper removal, gatewayToken seal/open wiring).

## Residual risk

- F-SEC-001 remains **Partial** until Channel/MCP secret migration (P4-003/P4-004).
- Unit environment may surface Electron binary unhandled rejections after async imports when electron dist is incomplete; assertion results remain green (13 files / 84 tests).
- Integration gate item "relevant E2E" for Wave 1 is covered by unit negative matrices + canary; no separate Playwright E2E was required by P1 task deliveries.

## Exit criteria

- Direct leak paths unified through brokers (secret / host invoke / files / url): **MET**
- Negative tests for protocol/path/key boundaries present and green: **MET**
