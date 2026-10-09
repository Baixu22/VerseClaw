---
id: stepfun-real-acceptance
title: Verify bounded live StepFun runtime and read-tool behavior
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: abdd8cea95b6ce3b327aae583f4e3c002bc897c6
intent: Execute the supplied real model through existing direct HTTPS and Gateway RPC paths, including one actual read-tool result, without credentials on disk or changing product defaults.
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
  - harness/specs/tasks/stepfun-real-acceptance.md
  - docs/dev/stepfun-real-acceptance-20261009.md
  - artifacts/stepfun-real-acceptance-20261009/**
  - .gitignore
  - scripts/repository-artifacts.json
expectedUserBehavior:
  - The supplied step-5-preview returns exact live stream text, selects a fixture function, and consumes its result.
  - A real isolated Gateway preserves a random marker across two turns and invokes its read tool on a newly generated file in the third turn.
docs:
  required: true
  paths:
    - docs/dev/stepfun-real-acceptance-20261009.md
requiredTests:
  - node --check scripts/check-live-model-evidence.mjs
  - node --test scripts/check-live-model-evidence.test.mjs
  - node scripts/check-live-model-evidence.mjs
acceptance:
  - Reuse the provided endpoint and real model with at most eight provider requests and three Gateway user turns per run, no automatic retries or synthetic response overrides.
  - Read live provider model identity, exact text, usage, tool call and non-error tool result from reports and transcripts; identify agent-driven synthetic data separately from real execution.
  - Only the explicit LIVE_MODEL_RUNTIME_READ=1 mode permits read with workspace-only scope in the isolated configuration; default runner and all product permissions remain unchanged.
  - The random file value must be absent from the tool-turn user prompt and visible only after a real read; verify its bytes stay unchanged.
  - Keep the real credential in stdin memory only, retain failures and raw receipts, verify exact-secret absence and independently confirm runner and Gateway PIDs are gone.
  - Land curated reports with new hashes and communication/Harness gates on existing private main; do not rewrite old acceptance, promote defaults or claim desktop/platform/release acceptance.
---

This is the user's explicitly requested continuation of real model acceptance, not
zero-provider script-only verification. A read-tool fixture is agent-authored; the
provider response and Runtime tool execution must be real. No model quality
benchmark or billing amount is claimed by a handful of calls.
