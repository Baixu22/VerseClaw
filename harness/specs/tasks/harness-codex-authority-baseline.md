---
lifecycleStatus: active
id: harness-codex-authority-baseline
title: Harness and Codex Authority Baseline
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Freeze the authority layers, scenarios and evidence vocabulary for Codex, ACPX, Codex Supervisor and external agent harnesses before any runtime, packaging or product-surface changes.
touchedAreas:
  - harness/specs/tasks/harness-codex-authority-baseline.md
  - harness/specs/fixtures/harness-codex-authority-baseline/**
  - harness/specs/fixtures/harness-codex-managed-runtime/**
  - harness/specs/tasks/harness-codex-managed-runtime.md
  - tests/unit/harness-codex-managed-runtime.test.ts
  - docs/modules/harness-and-codex.md
  - docs/modules/README.md
  - docs/README.md
  - .gitignore
  - scripts/repository-artifacts.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - tests/unit/harness-codex-authority-baseline.test.ts
  - scripts/copy-runtime-package.mjs
  - scripts/copy-runtime-package.d.mts
  - scripts/bundle-openclaw-runtime.mjs
  - tests/unit/copy-runtime-package.test.ts
  - harness/src/git.mjs
  - tests/unit/harness-git.test.ts
  - .agent-workbench/task-forest/config.json
  - .agent-workbench/task-forest/graph/**
  - .agent-workbench/task-forest/exports/**
  - .agent-workbench/task-forest/todos/**
residualPaths:
  - .agent-workbench/task-forest/config.json
  - openclaw_runtime/extensions/codex/src/app-server/managed-binary.ts
  - scripts/verify-codex-managed-runtime.mjs
  - .agent-workbench/task-forest/exports/task-forest.graph.json
  - .agent-workbench/task-forest/exports/task-forest.html
  - .agent-workbench/task-forest/exports/task-forest.timeline.json
  - .agent-workbench/task-forest/exports/task-forest.todos.json
  - .agent-workbench/task-forest/graph/edges.json
  - .agent-workbench/task-forest/graph/forest.json
  - .agent-workbench/task-forest/graph/nodes.json
  - .agent-workbench/task-forest/todos/todos.json
expectedUserBehavior:
  - Users can tell whether a turn runs on the native OpenClaw loop, the Codex app-server harness, an explicit ACP adapter or another agent harness.
  - Codex controls are not presented as a second global scheduler, approval plane or task ledger.
  - A missing harness or adapter fails explicitly rather than silently switching to a different executor.
  - Source presence, runtime reachability, packaged availability and product approval are visibly separate claims.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - chat-loop-boundary
  - contract-first-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/harness-codex-authority-baseline.md
  - pnpm exec vitest run tests/unit/harness-codex-authority-baseline.test.ts
  - pnpm run docs:policy:validate
  - pnpm run repo:artifacts:check
  - git diff --check
plannedTests:
  - tests/unit/harness-codex-authority-baseline.test.ts
acceptance:
  - The authority matrix separates the native loop, Codex app-server, `/codex`, ACPX, Codex Supervisor, Copilot and ClawX product owners; no layer claims a second task, approval, context, trace or scheduler authority.
  - The scenario matrix covers ordinary Chat, a normal Codex turn, explicit `/codex` control, packaged launch, CI/headless, ACP alternative, alternate-harness evaluation, VB, VS, VG and failure/fallback.
  - The capability vocabulary separates source existence, runtime reachability, verified effect, packaged availability, default path and release approval.
  - Every source reference resolves to a current repository path; every external research source records URL, title, evidence type, retrieval method, observation time and retrieval status, and is not treated as acceptance evidence.
  - The document includes a use/no-use decision and adoption boundary for Codex plus a comparative harness decision table covering Codex, ACP, OpenCode, Goose, OpenHands and Copilot; no third-party runtime is presented as an automatic equivalent.
  - The document records VB/VS/VG collaboration seams, real scenarios, adoption dispositions and explicit non-goals; VG remains fact/advisory only, VS remains governed execution and VB remains browser ownership.
  - Deliberate non-goals include Codex Cloud, complete Codex TUI, plugin marketplace, a second task authority, ACP v2 as a required draft dependency, and blanket model-quality/cost equivalence.
  - The document links each scenario to the next executable node and does not mark TF-0566..TF-0570 complete.
  - The external source ledger is marked as independently retrieved only after its referenced pages were fetched during this pass; search-only or failed entries remain explicitly labelled and cannot support a claim.
  - No runtime code, dependency, default value, product lock or release/publication state changes in this node.
docs:
  required: true
  files:
    - docs/modules/harness-and-codex.md
    - docs/modules/README.md
    - docs/README.md
---

# TF-0565 Harness and Codex Authority Baseline

This is a planning and evidence-boundary task. It creates the vocabulary and scenario baseline used by the Codex runtime, product-integration, alternate-harness, Verse-tools and verification nodes.

## Scope

- Source-grounded authority matrix.
- Real scenario matrix with failure/fallback cases.
- Capability vocabulary and explicit non-goals.
- A retained VerseSearch source ledger.
- Links to the next executable nodes.

## Explicit non-goals

- No runtime or packaging implementation.
- No Settings or Chat UI change.
- No new Codex or ACP dependency.
- No product default, release lock or publication change.
- No claim that a source path or a search result proves runtime or packaged capability.

## Evidence outputs

- `docs/modules/harness-and-codex.md`
- `harness/specs/fixtures/harness-codex-authority-baseline/authority-matrix.json`
- `harness/specs/fixtures/harness-codex-authority-baseline/scenario-matrix.json`
- `harness/specs/fixtures/harness-codex-authority-baseline/verseSearch-sources.json`
- `harness/specs/fixtures/harness-codex-authority-baseline/SHA256SUMS`

The JSON matrices must be recomputable from the source references and must not contain private prompts, credentials or external page bodies. Evidence is agent-driven and is never labelled real-human.

## Validation

Run the commands in the frontmatter. A changed source reference, missing external URL or unsupported capability claim fails the node. A passing static test does not establish packaged Codex availability; that belongs to TF-0566.
