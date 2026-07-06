# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md --no-diff
```

Vitest is not required for this phase because it is docs/spec only and adds no runtime code or test fixtures.

## Bounded Manual Scan

Use explicit path lists. Do not scan unbounded workspace content.

Candidate names:

```text
destructive-operation-guard
destructive_operation_guard
DestructiveOperationGuard
runtime.toolGovernance.destructiveOperationGuard.preflight.enabled
futureActiveCandidate
failure-tool-invocation-governance-destructive-operation-guard
```

Denied path groups:

```text
openclaw_runtime/src/agents
openclaw_runtime/src/acp
openclaw_runtime/src/gateway
openclaw_runtime/src/context-engine
openclaw_runtime/src/config
openclaw_runtime/src/runtime-core
electron/main
electron/services
electron/preload
src
scripts
```

Review matches manually. Allowed current matches are existing diagnostics-only helpers, tests, docs/specs, and parent governance records. There must be no active runtime import or consumer that gives `destructive_operation_guard` blocking authority.

Suggested command:

```text
rg -n "destructive-operation-guard|destructive_operation_guard|DestructiveOperationGuard|runtime\\.toolGovernance\\.destructiveOperationGuard\\.preflight\\.enabled|futureActiveCandidate|failure-tool-invocation-governance-destructive-operation-guard" openclaw_runtime/src/agents openclaw_runtime/src/acp openclaw_runtime/src/gateway openclaw_runtime/src/context-engine openclaw_runtime/src/config openclaw_runtime/src/runtime-core electron/main electron/services electron/preload src scripts
```

Expected current outcome:

- Existing runtime-core matches may include advisory/evidence-proof helpers and their barrel exports from prior accepted diagnostics-only phases.
- No TaskLoop, provider, Gateway, prompt/model-message, retry, approval, rollback, completion, checkpoint, lifecycle, Electron service, renderer, or script path may consume the future guard as an active decision.
- `futureActiveCandidate` matches remain diagnostics/evaluation metadata only.

## Future Automated Scan Requirements

Phase D must add focused automated boundary scan coverage before active guard code is introduced. The scan must:

- define the concrete future active guard module name and owner path
- allow imports only from the accepted mutation-capable tool invocation preflight owner
- deny imports from all denied path groups
- fail if checkpoint or lifecycle authority state writes reference guard reports, governance reports, replay reports, scorecards, evidence envelopes, or failure events
- fail if renderer, Electron services, Gateway, provider, prompt, TaskLoop, retry, approval, rollback, or completion paths reference active block decisions

## Docs Sync

README translation updates are not required for Phase C because this is internal docs/spec-only boundary material and introduces no user-visible behavior, UI, API, or runtime flow.

## Stop Conditions

Stop and write a narrower follow-up spec if boundary review finds any need to:

- implement active runtime behavior in Phase C
- let TaskLoop, provider, Gateway, prompt assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, or renderer code own the active decision
- read live providers
- execute real tool mutations
- modify the real workspace
- persist raw prompt/provider/tool/secret/env/workspace content
- use broad shell command pattern blocking
- allow deleted touched-path metadata alone to trigger active behavior
- add services, daemons, listeners, servers, databases, exporters, schedulers, or always-on sidecars
- treat governance reports, replay reports, scorecards, evidence proof output, evidence, failure events, boundary scan output, or proposal docs as completion proof
