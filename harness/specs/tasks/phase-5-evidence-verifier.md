---
id: phase-5-evidence-verifier
title: Phase 5 evidence verifier contracts and shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a canonical Evidence Verifier contract/taxonomy and Phase 5 handoff scaffold without changing TaskLoop, tool invocation, approval, retry, error, or return-payload behavior.
ownedPaths:
  - harness/specs/tasks/phase-5-evidence-verifier.md
  - runtime-research/handoffs/phase-5-evidence-verifier/**
  - openclaw_runtime/src/runtime-core/evidence-verifier.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/runtime-evidence-verifier-contracts.test.ts
expectedUserBehavior:
  - With Phase-5 verifier flags disabled, existing TaskLoop execution, tools.invoke behavior, approval waiting, retries, error mapping, and return payloads remain unchanged.
  - Phase 5 Lane A adds contract validation and taxonomy only; it does not run verifier gates, tests, lint, typecheck, or diagnostics from runtime behavior.
  - Verifier decisions distinguish completed, failed, blocked, cancelled, and insufficient_evidence, with blocked reserved for explicit external dependencies.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
forbiddenPatterns:
  - default-on verifier completion gate
  - TaskLoop integration in Lane A
  - external lint/typecheck/test execution inside verifier runtime behavior
  - LLM judge for verifier decisions
  - persistence of raw prompts, full event payloads, full checkpoints, full tool args, or full tool output
  - adding a second runtime service, daemon, listener, HTTP server, WebSocket server, Temporal service, or Gateway instance
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.evidenceVerifier.shadow defaults off and is warning/observe-only.
  - runtime.evidenceVerifier.pilot defaults off and must not become an active completion gate in Lane A.
rollback:
  - Stop importing `openclaw_runtime/src/runtime-core/evidence-verifier.ts`.
  - Keep existing TaskLoop evidence gate, warning-only evidence verifier report, tool invocation paths, and event-log verification sampling authoritative/unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src electron shared tests --glob '!**/*.md'
  - node scripts/scan-pattern.mjs --pattern 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core/evidence-verifier.ts tests/unit/runtime-evidence-verifier-contracts.test.ts
acceptance:
  - Contract exposes verifier evidence kinds file/test/tool/trace/human.
  - Verifier input covers objective/task id, obligations, evidence refs, tool results, and event replay summary.
  - Decision taxonomy covers completed/failed/blocked/cancelled/insufficient_evidence.
  - Finding severity, category, and code taxonomy is deterministic and validated.
  - Blocked is emitted only for explicit external dependency obligations.
  - Missing required file/test/tool evidence emits insufficient_evidence.
  - Feature flags are default-off shadow/pilot only and do not introduce an active gate.
  - Lane A does not touch TaskLoop integration.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 5 Evidence Verifier

This task starts Phase 5 with contract and harness work only. Runtime behavior remains unchanged unless a future lane explicitly wires a warning-only adapter behind default-off flags and proves flag-off parity.
