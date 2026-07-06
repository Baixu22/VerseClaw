# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md --no-diff
```

## Focused Test Expectations

The Vitest suite must prove:

- omitted config and `enabled: false` resolve disabled
- disabled flag allows with `legacyBehavior: true`
- enabled flag can block only through mutation-capable preflight
- non-preflight owners, non-mutation-capable tools, missing candidates, and invalid candidates allow
- deleted touched-path metadata alone does not trigger
- missing edit metric failure does not trigger
- failing false-block corpus metadata does not trigger
- block diagnostics are bounded and sanitized
- config schema is strict and does not synthesize defaults
- direct active runtime consumer matches are limited to the accepted preflight owner plus runtime-core helper/barrel export

## Boundary Scan

The automated test scan uses exact candidate symbols and module names:

```text
failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot
evaluateRuntimeFailureDestructiveOperationGuardPreflight
RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER
```

Allowed runtime matches:

```text
openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts
openclaw_runtime/src/runtime-core/index.ts
```

Denied active-owner roots include TaskLoop, ACP, Gateway, auto-reply, channels, plugin SDK, tasks, Electron main/services, renderer `src`, and scripts.

## Docs Sync

README translation updates are not required for Phase D because this is an internal default-off runtime pilot with no user-visible UI, API route, command, setup flow, or documented user workflow change.

## Stop Conditions

Stop and write a follow-up instead of continuing if validation shows any need to:

- change TaskLoop decisions
- change provider transport
- change Gateway payloads
- change prompt/model-message assembly
- change retry, approval, rollback, or completion
- write checkpoint or lifecycle authority state
- add active consumers outside mutation-capable tool invocation preflight
- read live providers
- execute real workspace mutation for proof
- use broad shell command pattern blocking
- treat deleted touched-path metadata alone as a trigger
- begin Phase E holdout expansion
