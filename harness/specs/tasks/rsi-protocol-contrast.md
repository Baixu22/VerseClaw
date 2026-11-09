---
lifecycleStatus: active
id: rsi-protocol-contrast
title: Measure public input and bounded tool effects separately
intent: Run the owner-authorized v2/v3/v4 off-only contrast with one durable budget and independently replay its case-level results.
diffBase: 08fa97bf3e261d49842c9b19cda7388aa4717f2d
touchedAreas:
  - scripts/rsi-protocol-contrast.*
  - scripts/rsi-protocol-contrast-replay.*
  - scripts/rsi-coding-collector.*
  - scripts/lib/rsi-benefit-eval.*
  - scripts/repository-artifacts.json
  - tests/unit/rsi-protocol-contrast.test.ts
  - tests/unit/rsi-coding-collector.test.ts
  - harness/specs/tasks/rsi-protocol-contrast.md
  - harness/specs/rules/rsi-protocol-contrast-boundary.md
  - harness/specs/fixtures/rsi-protocol-contrast/**
  - docs/dev/rsi-capability-and-boundaries.md
requiredProfiles:
  - rsi
requiredRules:
  - rsi-protocol-contrast-boundary
  - rsi-public-input-boundary
  - rsi-campaign-budget-boundary
  - reliability-aggregation-boundary
  - paired-ablation-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - disk-temp-policy
relatedScenarios:
  - gateway-backend-communication
expectedUserBehavior:
  - The same 24 historical tasks are measured with legacy input, public input and public tools, with experience injection off in every trial.
  - A shared authorization limits preflight and all protocol versions before dispatch.
  - Results identify v3 minus v2 and v4 minus v3 using complete case clusters and preserve every failure and unexecuted slot.
requiredTests:
  - node node_modules/vitest/vitest.mjs run --config vitest.rsi.node.config.ts tests/unit/rsi-protocol-contrast.test.ts tests/unit/rsi-coding-collector.test.ts tests/unit/rsi-campaign-budget.test.ts tests/unit/rsi-coding-tool-loop.test.ts tests/unit/rsi-benefit-eval.test.ts tests/unit/rsi-responses-provider.test.ts
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/rsi-protocol-contrast.md
  - git diff --check
acceptance:
  - Freeze a new source revision, plan, rotating version order, provider model, price evidence and the owner's additional 12000000-token, 433-call, 0-CNY authorization before any new request.
  - Declare 24 tasks times three versions times k=3, with 72 off-only slots per version. v2 and v3 allow one request per slot; v4 allows four. Task identity, baseline, reference, oracle, scope, split, safety and anchors remain equal across versions.
  - Use one ledger with version-prefixed identities for one preflight and at most 432 task requests. Both single-request collectors reserve before dispatch and settle known usage; a budget refusal records zero dispatches and never creates a fictitious unknown-use request.
  - Freshly verify all 24 unresolved baselines and reference-bound oracles with markdown-it 14.2.0, then verify the Free model route before every request. No quota purchase or paid fallback is allowed.
  - Validate off-only receipts through an explicit protocol-contrast entry point with budget-at-start values independently derived from the shared ledger. Preserve the existing full-schedule prefix requirement for ordinary benefit measurements.
  - Retain raw Responses, continuations, tools, edits, independent oracle artifacts, settled usage and unknown reserves. A stopped run seals its current report and supports importing retained receipts without redispatch.
  - Compute passK, passAtK, at least 20 complete case pairs where available, two paired 95 percent intervals and labelled power. Repeats establish matching; the case cluster is the inference unit. An independent arithmetic implementation reproduces both comparisons.
  - Apply the existing 5pp improvement, positive interval lower bound, cost, safety and anchor gates to each protocol comparison. Protocol findings do not alter the retained evolved-prompt verdict or establish experience benefit.
  - Credential-scan and archive recoverable raw artifacts; track curated evidence and verify hashes from disk before updating Task Forest acceptance states.
docs:
  required: true
  files:
    - docs/dev/rsi-capability-and-boundaries.md
readmeUpdates: not-required
---

On 2026-11-09 the owner approved the additional v2/v3/v4 contrast and its
independent resource ceiling: 12M tokens, 433 provider calls and 0 CNY new
spending using existing Free quota. This study has a new ledger and run identity.
The retained v4 prompt campaign remains sealed at 198/216 slots and NO_GO.

The contrasts estimate the public-input package (v3 minus v2) and the bounded
tool package (v4 minus v3). Input/instruction changes within each declared
protocol are recorded as part of that package. All three versions use sekb-off.
The study does not generate or select a new experience candidate.
