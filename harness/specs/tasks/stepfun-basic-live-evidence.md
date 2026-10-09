---
id: stepfun-basic-live-evidence
title: Expand Windows alpha evidence with a real StepFun model
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 9e463c269e113db09244647d072d55a7fbb55484
intent: Verify bounded real-model dialogue, context continuity and usage through direct HTTPS and the existing Gateway RPC path while excluding credentials from evidence.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - scripts/check-live-model-evidence.mjs
  - scripts/check-live-model-evidence.test.mjs
  - docs/dev/live-model-cleanup-20261009.md
  - artifacts/live-model-cleanup-20261009/**
  - openclaw_runtime/src/agents/openai-transport-stream.ts
  - openclaw_runtime/src/agents/openai-transport-stream.test.ts
  - tests/e2e/chat-cache-live-model.spec.ts
  - harness/specs/tasks/stepfun-basic-live-evidence.md
  - docs/dev/stepfun-basic-live-evidence-20261008.md
  - artifacts/stepfun-basic-live-evidence-20261008/report.json
  - artifacts/stepfun-basic-live-evidence-20261008/credential-scan.json
  - artifacts/stepfun-basic-live-evidence-20261008/SHA256SUMS
  - .gitignore
  - .gitattributes
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - A configured custom OpenAI-compatible provider supports two real Gateway turns and reports session usage.
  - The second turn recalls synthetic information from the first; a placeholder assistant message or an error never counts as a successful response.
docs:
  required: true
  paths:
    - docs/dev/stepfun-basic-live-evidence-20261008.md
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/openai-transport-stream.test.ts
  - node --check scripts/check-live-model-evidence.mjs
  - node --test scripts/check-live-model-evidence.test.mjs
  - node scripts/check-live-model-evidence.mjs
acceptance:
  - Record the clean source commit/tree and reused application/runtime bundle identity.
  - Run at most three conversation turns per attempt with no automatic retries; use only agent-authored synthetic prompts and the provided step-5-preview model.
  - Capture exact expected/actual assistant text, per-turn usage growth, model identity and runtime cache assessment without inventing cache hits or monetary cost.
  - Use scripts only, without desktop/browser operations. Keep the key in process-local input/environment only and verify exact-secret scans and owned-process cleanup.
  - Preserve failed attempts, run relevant types, lint, communication gates and diff-aware Harness, then land curated evidence on the existing private main.
---

This supplements the completed Windows x64 alpha qualification. It does not rerun
or replace that complete suite and does not expand platform, release or product
lock claims. The original desktop live-model test is restored unchanged; its failed attempts remain local.
All scenario actions and judgments are agent-driven; the remote model is real.

The 2026-10-09 cleanup follow-up uses zero provider calls. Its local lifecycle
regression executes the production cleanup block and a real owned child process.
Numeric exit and signal termination both count as exited; neither may trigger
forced cleanup of an already-exited PID. Historical live-model evidence stays
bound to its original candidate and is not rewritten by this follow-up.
