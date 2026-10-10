---
lifecycleStatus: archived
id: p2-issue-fixes-batch4-20261010
title: P2 issue batch 4 - gateway argv secret, error-governance calibration, endpoint request budget
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close three open [P2] issues (#130, #115, #123) with verified fixes, executable governance checks and no human-prerequisite acceptance.
touchedAreas:
  - electron/gateway/**
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/infra/**
  - harness/specs/**
  - scripts/**
  - tests/unit/**
  - tests/integration/**
  - docs/dev/error-governance-decision-record.md
  - docs/dev/p2-issue-fixes-batch4-20261010.md
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - The shared Gateway token is delivered to the gateway process through the environment, so it does not appear in a process command line that other local processes can read.
  - The error/problem governance draft is a decision record aligned with the shipped typed IPC and AppError assets, with executable checks instead of human-prerequisite rules.
  - An enabled OpenAI-compatible HTTP endpoint answers an over-budget request with a stable 429 and Retry-After instead of reaching the model.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - error-governance-boundary
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/gateway-argv-secret-exposure.test.ts tests/unit/gateway-env-token-auth.test.ts tests/unit/gateway-process-launcher-env.test.ts tests/unit/launch-contract-matrix.test.ts tests/unit/vtoken-launch-default.test.ts tests/unit/gateway-p4-001-auth-binding.test.ts tests/unit/openclaw-auth.test.ts tests/integration/channel-startup.integration.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/error-governance-boundary.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run --config openclaw_runtime/vitest.config.ts --project gateway-core http-endpoint-budget --maxWorkers=1
  - node scripts/check-error-governance.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/scenarios/gateway-backend-communication.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch4-20261010.md
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - Issue #130 - the gateway launch args builder emits no `--token`/`--password`/`--gateway-token`; the launcher strips a known Gateway secret from the real spawn argv even if a secret flag reappears; `OPENCLAW_GATEWAY_TOKEN` still reaches the child and the runtime resolves token auth from the environment alone; a real child started with the launch args receives an argv with no token.
  - Issue #115 - a decision record marks each draft item as existing/gap/proposal against current sources, the missing rule exists and is wired into the gateway-backend-communication scenario, no rule or acceptance requires a human verdict or human data, and executable counter-examples (including a deliberately failing fixture) prove unknown wait/approval types stay fail-closed and that a missing error mapping is rejected. The decision record is registered as a reviewed repository input so it is tracked rather than ignored by `/docs/**`.
  - Issue #123 - the shared authenticated HTTP admission boundary consumes a fixed-window request budget after auth/scope checks and before expensive work or SSE headers, returns a stable 429 with Retry-After without claiming authentication failure, keeps success auth from clearing the budget, keeps the auth-failure lockout independent, and leaves endpoint defaults (disabled) and any frozen lock unchanged.
  - No tool policy, product default, frozen product lock, packaged artifact or release state changes; no live upstream call or resource-exhaustion experiment is part of the verification.
docs:
  required: false
---

# P2 issue batch 4

Fourth batch of open `[P2]` issues on the private remote:

- **#130** the Gateway process received the shared auth token through `--token`,
  so the credential was visible in the process command line even though logging
  was redacted;
- **#115** the error/problem governance draft disagreed with the shipped typed
  IPC and `AppError` assets, referenced documents that do not exist in the tree,
  and carried hard rules that required a human decision;
- **#123** the enabled OpenAI-compatible HTTP endpoints had no request budget
  after successful authentication, so a valid credential loop was not limited by
  the authentication rate limiter.

#130 changes the Gateway launch path (renderer -> Main -> Gateway child) and #123
changes the Gateway HTTP admission boundary, so this spec carries the
`gateway-backend-communication` scenario. The host-api contract, the IPC-only
renderer transport (`harness/specs/rules/api-client-transport-policy.md`: the
renderer calls Main through the typed host-api only and Main owns the Gateway
WebSocket), endpoint default-off state and every product lock are unchanged.

Verification is agent-driven (`driven_by: agent`) with local fixtures and stubs;
no third-party download, live provider call, packaged artifact or
resource-exhaustion experiment is claimed, and no human verdict or human data is
required anywhere.
