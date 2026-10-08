---
id: stepfun-basic-live-evidence
title: Expand Windows alpha evidence with a real StepFun model
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a2a21463dccfdf98460086b1730401093a31bf10
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
