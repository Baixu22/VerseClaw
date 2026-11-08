---
lifecycleStatus: active
id: rsi-paired-measurement
title: Measure the sealed evolved RSI prompt on the complete paired cohort
intent: Run a fresh v4 experiment with the staged second-generation prompt, whole-campaign resource accounting, fresh reference-bound admission and replayable outcomes.
diffBase: c0868c76f7a583b7d8c809dff905f3ad29a0784f
touchedAreas:
  - scripts/rsi-paired-measurement.*
  - scripts/rsi-coding-collector.*
  - scripts/rsi-live-acceptance.*
  - scripts/lib/rsi-campaign-budget.*
  - scripts/lib/rsi-coding-tool-loop.*
  - scripts/lib/rsi-benefit-eval.*
  - tests/unit/rsi-campaign-budget.test.ts
  - tests/unit/rsi-benefit-eval.test.ts
  - tests/unit/rsi-coding-tool-loop.test.ts
  - harness/specs/tasks/rsi-paired-measurement.md
  - harness/specs/rules/rsi-campaign-budget-boundary.md
  - harness/specs/guides/rsi-remediation-roadmap.md
  - harness/specs/fixtures/rsi-paired-measurement/**
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - rsi-public-input-boundary
  - rsi-candidate-evolution-boundary
  - rsi-campaign-budget-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - reliability-aggregation-boundary
  - paired-ablation-boundary
relatedScenarios:
  - gateway-backend-communication
expectedUserBehavior:
  - The executor measures the frozen prompt with public tools and an independent historical final-state oracle.
  - Preflight and every continuation consume one shared authorization envelope before dispatch.
  - Monetary accounting uses the declared currency and observed billing basis; a credit multiplier is retained as a credit multiplier.
requiredTests:
  - node node_modules/vitest/vitest.mjs run --config vitest.rsi.node.config.ts tests/unit/rsi-campaign-budget.test.ts tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-coding-tool-loop.test.ts tests/unit/rsi-coding-collector.test.ts tests/unit/rsi-responses-provider.test.ts tests/unit/rsi-live-acceptance.test.ts
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-paired-measurement.md
  - git diff --check
acceptance:
  - Freeze endpoint/model, price basis, authorization, source candidate, selected prompt version and all 24 task identities before the first provider request.
  - Use 24 tasks, three arms, k=3 and 216 declared slots; preserve rotating arm order and unchanged v4 tools, evaluator, oracle and promotion thresholds.
  - One campaign envelope limits preflight and trials to 864 provider calls, 12000000 tokens and 300 CNY of new spending. Unknown usage retains its pre-dispatch upper reservation.
  - A quota-only price basis requires the declared provider/model and existing Free quota to remain verified before each dispatch; route drift stops new requests. Credit usage and unavailable provider billing fields retain their actual units and unknown values.
  - Reserve before dispatch, retain first failures and incomplete requests, forbid provider retries, and reconcile every ledger reservation with a preflight or trial receipt on replay.
  - Fresh admission executes both reference and unresolved baseline for all tasks with reference-commit oracle bytes and exact support versions.
  - Final artifacts expose all slot outcomes, passK/passAtK, at least 20 complete paired cases when available, 95 percent paired intervals, power, safety, anchors, actual usage and observed spending. An incomplete or negative experiment keeps its actual verdict.
  - Retain raw Responses turns, tool journals, final edits and oracle executions; recompute source, admission, outcome, cost and manifest bindings from disk.
  - Keep the previous measurements and candidate selection records intact; independently identify input/protocol changes and prompt effects without attributing cross-run differences to one cause.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

TF-0857 measures `rsi-prompt-4fb74767a8b13b831edd60f3`, version
`da9adbb1b5faab2778fb048b832ea1254bc77358875e33b8e54f0330663818f9`.
The held-out task commitment is
`01b05ac42fa2fd57d61a6af6e88887220a65a58952dfd5f0aa0e5a241feff501`.
The experiment uses RsiBenefitPlan/v2 and RsiCodingCollector/v4.

The owner authorized 12M tokens, 864 calls and a maximum of 300 CNY for this
campaign. The sealed TF-0856 preparation remains a historical proposal with
zero dispatch authorization; this experiment records the later authorization.

The initial endpoint is `http://127.0.0.1:3065/v1/responses`, model `space-bunny`.
Live model metadata identifies WorkBuddy ownership and a credit multiplier.
The local provider account metadata identifies existing Free quota. This basis
permits using that quota with no new purchase; it does not provide a fiat token
tariff. The campaign retains the credit metadata and prevents a paid route or
quota purchase. Missing upstream credit debits or invoices remain null.

The within-run comparisons estimate the staged prompt effect under v4. Historical
v2 measurements remain separate. Their differences cannot isolate public-input
and tool-loop effects because both conditions changed; no new single-shot arm
is added to the frozen 216-slot design.

Request timeout is 240 seconds, oracle timeout 300 seconds and provider phase
900 seconds per slot. Each slot allows four provider calls and twelve tools;
provider retries remain zero. A negative or incomplete measurement is retained
with its failure categories and the exact next acceptance gap.
