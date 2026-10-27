---
lifecycleStatus: active
id: coding-loop-final-response-closeout
title: Coding-loop final response and undo closeout
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the FP-P1-04 coding journey reach a visible final response and complete the undo loop, by stopping successful tool rounds from consuming the shared provider retry budget and by degrading best-effort raw-output capture instead of failing the exec tool.
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - harness/specs/tasks/coding-loop-final-response-closeout.md
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/guides/product-acceptance-strategy.md
  - harness/specs/fixtures/product-acceptance-shortfalls/ledger.json
  - harness/specs/fixtures/product-acceptance-closeout/a4-coding-final/**
  - openclaw_runtime/src/agents/request-attempt-budget.ts
  - openclaw_runtime/src/agents/request-attempt-budget.test.ts
  - openclaw_runtime/src/agents/provider-outbound-budget.test.ts
  - openclaw_runtime/src/agents/bash-raw-output-capture.ts
  - tests/unit/bash-raw-output-capture-degraded.test.ts
  - tests/unit/product-acceptance-shortfalls.test.ts
  - tests/e2e/coding-loop-fp-p1-04.spec.ts
expectedUserBehavior:
  - A coding turn that reads, edits, writes and verifies reaches a visible final assistant message instead of stalling.
  - The final message reports the actual outcome and the review panel shows the real diff and verify result.
  - undo_write restores both mutated files and drains the journal.
  - A terminal provider disconnect surfaces a visible failure and never renders a success-looking final answer.
  - After a blocked exec on a host whose TEMP is unwritable, the tool returns an explicit result instead of a lost one.
requiredTests:
  - pnpm --dir openclaw_runtime exec vitest run src/agents/request-attempt-budget.test.ts src/agents/provider-outbound-budget.test.ts src/agents/model-fallback.loop-termination.test.ts
  - pnpm exec vitest run tests/unit/bash-raw-output-capture-degraded.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/coding-loop-fp-p1-04.spec.ts --workers=1
  - pnpm run typecheck:test
  - pnpm harness validate --spec harness/specs/tasks/coding-loop-final-response-closeout.md
  - git diff --check
acceptance:
  - Three independent full runs of the coding-loop spec pass on the same candidate and leave the repository source unchanged.
  - undo restores both original files and empties the journal; out-of-scope paths are rejected; a partial undo with a missing snapshot fails explicitly and keeps recovery evidence.
  - A terminal provider disconnect produces a visible failure and no success-looking final answer; the next turn can still run; no orphaned Electron/Gateway processes remain.
  - The shortfall coding-loop-e2e-final-response becomes resolved only with a clean candidate, command and exit codes, parsed counts, raw artifact SHA256, curated evidence, and visible limitations.
  - No product lock (releaseApproved/productApproved/liveReady/defaultOn), default value, approval authority, or public state changes.
docs:
  required: true
  files:
    - harness/specs/tasks/product-acceptance-closeout.md
---

# Coding-Loop Final Response and Undo Closeout

TF-0577 closes shortfall `coding-loop-e2e-final-response`. The FP-P1-04 spec drives a real Gateway
child through read → edit → write → verify → undo. It stopped after the fourth tool call with no
final assistant message.

## Root cause

One user turn issues one provider request per tool round. `runAgentPrompt` wrapped the whole turn in
a single `RequestAttemptBudget` sized `maxRetries + 1` (default 4), and every provider transport
call took a slot — including the successful ones. A four-tool loop therefore consumed the entire
retry budget, and the fifth call (the final answer) failed closed with
`ProviderRequestAttemptBudgetExhaustedError`. The OpenAI client wrapped that as
`APIConnectionError("Connection error.")`, which the runner classified as a retryable transport
failure and surfaced as `FailoverError: LLM request failed: network connection error`.

`completeAttempt` now releases the slot when an attempt succeeds: only failed attempts hold retry
capacity. Retry layers still share one budget, because each retry after a failure keeps its slot.

A second, smaller defect surfaced while diagnosing: `createBashRawOutputCapture` allocated its
scratch directory eagerly, so a host whose TEMP is unwritable made the whole exec tool throw and the
tool result was never written back. Capture is best-effort enrichment; it now degrades to a no-op
recorder that reports the allocation error in its diagnostics.

## Terminal disconnect negative case

The spec's scripted provider can now abort the final response mid-stream
(`startScriptedLlm({ abortFinalResponse: true })`). It emits only a partial delta and destroys the
socket before `finish_reason`/`[DONE]`. The assertion requires the UI to show `Needs attention` and
requires the full success sentence to be absent, so a disconnect can neither fabricate success nor
leave the turn silently open.

## Evidence

Raw runs stay under `D:/tmp/clawx-product-acceptance/tf0577-*/`. Curated evidence is retained under
`harness/specs/fixtures/product-acceptance-closeout/a4-coding-final/` with candidate binding,
commands, exit codes, parsed counts, the three-run receipts, source hashes and SHA256SUMS.

The shortfall `coding-loop-e2e-final-response` may move to `resolved` only after that evidence is
read back from disk. Provider behaviour is the scripted local OpenAI-compatible endpoint; this node
does not claim live-model quality, packaged/install-state, release, or real-human evidence.