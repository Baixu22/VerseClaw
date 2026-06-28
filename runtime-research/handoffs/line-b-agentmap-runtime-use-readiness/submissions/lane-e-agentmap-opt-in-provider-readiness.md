# Lane E AgentMap Opt-In Provider Readiness

## Scope

Implemented default-off AgentMap provider readiness behind an explicit config flag. The default provider registry ordering and default prompt behavior remain unchanged: `createContextProviderRegistryPilot()` still creates only `legacy-context-engine` followed by `loop-context-pack`, and AgentMap runs only when a caller explicitly injects the shadow provider and enables `runtime.agentMap.provider`.

## Preconditions

- `lane-a-agentmap-real-repo-hardening.md` is accepted.
- `lane-b-agentmap-cache-performance-budget.md` is accepted.
- `lane-c-agentmap-fixtures-quality-audit.md` is accepted.
- `lane-d-agentmap-shadow-runtime-collection.md` is accepted.
- The previous readonly/shadow Line B submissions A-E are accepted.

## Implementation Evidence

- `openclaw_runtime/src/config/types.openclaw.ts`
  - Added `runtime.agentMap.provider?: boolean`.
  - The flag is default-off by omission and is scoped to readonly AgentMap context provider output only.
- `openclaw_runtime/src/config/zod-schema.ts`
  - Added a strict `runtime.agentMap` schema with only `provider?: boolean`; unknown keys such as prompt cutover are rejected.
- `openclaw_runtime/src/config/schema.help.ts`
  - Added help text stating the flag is default-off, explicit-provider-only, does not register AgentMap by default, does not change provider ordering, does not alter prompts, and does not replace `read`/`grep`/`find`/`ls`.
- `openclaw_runtime/src/config/schema.labels.ts`
  - Added labels for `runtime.agentMap` and `runtime.agentMap.provider`.
- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
  - Added provider gating from `options.config`, `query.metadata.config`, or `extras.metadata.config`.
  - When `runtime.agentMap.provider` is not `true`, the provider returns `flag_disabled` diagnostics with no context items and does not call `getResult`.
  - When enabled, output remains `shadowOnly`, `legacyAuthoritative`, `readonlyAgentMap`, `noPromptAuthority`, `noToolAuthority`, and `noRuntimeAuthority`.
- `openclaw_runtime/src/context-engine/provider-registry.ts`
  - Passes registry `params.config` to explicitly supplied extra providers through extras metadata.
  - Does not add AgentMap to default registry construction and does not change legacy/loop ordering.

## Test Evidence

- `tests/unit/runtime-feature-config-schema.test.ts`
  - Covers strict schema acceptance/rejection for `runtime.agentMap.provider`.
  - Covers omitted flags not synthesizing enabled defaults.
  - Covers help and label entries.
- `tests/unit/runtime-agent-map-context-provider.test.ts`
  - Covers flag-off no-output behavior and proves `getResult` is not called.
  - Covers flag-on provider output, diagnostics, hardened diagnostic injection, failure isolation, and no-result fallback.
- `tests/unit/context-provider-registry.test.ts`
  - Covers default registry ordering unchanged.
  - Covers AgentMap not running unless explicitly injected.
  - Covers explicit AgentMap injection still requires `runtime.agentMap.provider: true`.
  - Covers explicit AgentMap/Symbol provider ordering after defaults when explicitly injected.
  - Covers legacy providers remain successful when explicit AgentMap collection fails.

## Verification

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - Passed and produced the expected reading list.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - Passed before and after implementation.
- `pnpm --config.verify-deps-before-run=false harness run --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md --dry-run`
  - Passed and wrote `artifacts/harness/latest.md`.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts`
  - Passed: 3 files, 23 tests.
- `pnpm --config.verify-deps-before-run=false run typecheck`
  - Passed: node and web typecheck.

## Boundary Evidence

- Default-off behavior:
  - `tests/unit/runtime-agent-map-context-provider.test.ts` asserts flag-off returns no context items and does not call `getResult`.
  - `tests/unit/context-provider-registry.test.ts` asserts explicit AgentMap provider output does not execute without `runtime.agentMap.provider`.
- Explicit shadow-only output:
  - AgentMap output requires both explicit provider injection and `runtime.agentMap.provider: true`.
  - Provider metadata continues to assert `shadowOnly`, `legacyAuthoritative`, `noPromptAuthority`, `noToolAuthority`, and `noRuntimeAuthority`.
- Default provider ordering:
  - `createContextProviderRegistryPilot()` remains legacy context engine, then loop context pack unless extra providers are explicitly supplied.
- No prompt cutover:
  - No TaskLoop, Gateway, model-message, or prompt assembly files were touched.
  - Registry tests keep legacy prompt/message output authoritative.
- No read/grep/find/ls replacement:
  - No discovery tool implementation or policy path was touched.
- No service/listener/daemon/database:
  - Narrow scan over runtime provider and tests returned no matches:
    `rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(|rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply' openclaw_runtime/src/context-engine/agent-map-context-provider.ts openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-feature-config-schema.test.ts`
  - A wider scan including `schema.help.ts`/`schema.labels.ts` reports existing unrelated help/label strings for gateway listener, sqlite memory docs, mcporter daemon docs, and `tools.exec.applyPatch.*`; this lane did not add those surfaces.
- Renderer/Main boundary:
  - No renderer, Electron Main, host-api, api-client, Gateway transport, or provider transport files were touched.
  - Comms replay/compare were not required.

## Docs Sync

README translation updates are not required. This adds an internal default-off runtime config flag plus schema help/labels, but no user-visible UI flow, CLI behavior, Gateway behavior, host-api interface, renderer behavior, default prompt behavior, or provider ordering change. `rg -n 'AgentMap|runtime\.agentMap|Runtime AgentMap|context provider|runtime feature' README.md README.zh-CN.md README.ja-JP.md` returned no existing README section requiring an update.

Status: accepted
