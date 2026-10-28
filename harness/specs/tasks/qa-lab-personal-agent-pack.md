---
lifecycleStatus: active
id: qa-lab-personal-agent-pack
title: Executable personal-agent QA scenario pack
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore the ten canonical personal-agent QA fixtures and prove source-host mock-provider execution, failure detection and continuation without changing product locks.
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
touchedAreas:
  - harness/specs/tasks/qa-lab-personal-agent-pack.md
  - harness/specs/tasks/product-acceptance-closeout.md
  - harness/specs/guides/product-acceptance-strategy.md
  - harness/specs/fixtures/product-acceptance-shortfalls/**
  - harness/specs/fixtures/product-acceptance-closeout/a5-qa-pack/**
  - openclaw_runtime/qa/**
  - openclaw_runtime/extensions/qa-lab/src/**
  - openclaw_runtime/extensions/qa-lab/api.ts
  - openclaw_runtime/tsdown.config.ts
  - openclaw_runtime/test/tsconfig/tsconfig.qa-lab.test.json
  - scripts/qa-lab-personal-agent-acceptance.mjs
  - tests/unit/product-acceptance-shortfalls.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - An explicitly requested personal-agent pack executes all ten registry scenarios through a real isolated Gateway with a scripted mock provider.
  - Missing or corrupt fixtures, an empty selection and failed final-state assertions fail visibly and cannot produce an empty successful suite.
  - Denied approval leaves its external effect absent and a subsequent local task completes after failure.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-qa.config.ts extensions/qa-lab/src/scenario-catalog.test.ts extensions/qa-lab/src/suite-planning.test.ts extensions/qa-lab/src/suite-summary.test.ts extensions/qa-lab/src/suite-startup.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/product-acceptance-shortfalls.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p test/tsconfig/tsconfig.qa-lab.test.json
  - node scripts/qa-lab-personal-agent-acceptance.mjs --preflight
  - node scripts/qa-lab-personal-agent-acceptance.mjs
  - node scripts/qa-lab-personal-agent-acceptance.mjs --negative-controls
  - pnpm docs:policy:validate
  - pnpm harness validate --spec harness/specs/tasks/qa-lab-personal-agent-pack.md
  - pnpm harness run --spec harness/specs/tasks/qa-lab-personal-agent-pack.md --dry-run
  - git diff --check
acceptance:
  - Each ID in QA_PERSONAL_AGENT_SCENARIO_IDS has exactly one parseable qa-scenario and qa-flow fixture; the index contains a valid qa-pack fence.
  - Source-host mock-openai execution selects and executes exactly ten scenarios, exits zero and has no unexpected skips; final replies agree with Gateway transcripts and deterministic effect readback.
  - Catalog regressions cover missing and duplicate IDs, malformed YAML, empty packs, explicit source selection and the optional npm-distribution fallback.
  - A missing fixture or empty catalog exits nonzero; a deliberately false final-state assertion produces a failure bundle and a later task still completes.
  - Approval rejection creates no denied side effect; retired Runtime Memory flags and product locks remain unchanged.
  - A clean committed candidate and retained a5 manifest bind actual commands, exit codes, counts, raw events, hashes, agent actor, credential scan and source-host/mock limitations.
docs:
  required: true
  files:
    - openclaw_runtime/qa/README.md
    - harness/specs/tasks/qa-lab-personal-agent-pack.md
---

# Executable personal-agent QA scenario pack

This is the TF-0578 repair contract within `product-acceptance-closeout`.
`extensions/qa-lab/src/scenario-packs.ts` remains the only pack-ID registry.
Fixtures live at `openclaw_runtime/qa/scenarios/` in the existing `qa-pack`,
`qa-scenario` and `qa-flow` Markdown fences. Use the existing host runner,
`mock-openai` provider and isolated `qa-channel` transport.

The retained runtime has retired the upstream general CLI. Build private QA
with `OPENCLAW_BUILD_PRIVATE_QA=1` and the `cliStartup` build profile, then use
`node scripts/qa-lab-personal-agent-acceptance.mjs`. Its host runner starts the
existing `dist/entry.js` Gateway. `--preflight` selects the first requested ID;
`--scenario` is repeatable. Private QA builds include the QA runtime SDK facades
while preserving every public entry; omitted upstream test-only helpers stay
outside this runtime build.

`--negative-controls` requires a clean source candidate, makes a Git archive,
reuses dependencies and current build outputs, mutates only that disposable
projection and checks both the failing oracle and successful continuation.
Record each child exit 1 separately from the successful controller exit 0.
Both build stamps must match the clean candidate; the negative receipt hashes
every copied build file. Provider/Gateway startup failure tests check that all
previously acquired QA HTTP listeners are closed.

Run one bootstrap preflight before the full ten-scenario pack. Use a unique,
agent-owned output directory accepted by the existing repo-bound path policy;
process TEMP/TMP and large archived output live on D:. Record the effective
output root instead of weakening its boundary to fit an example command.

Retain the suite summary, per-scenario results, Gateway/provider events,
deterministic file or channel readback and negative-control failure bundle.
Never use `--allow-failures` to obtain a successful exit. Selection counts and
skip IDs are checked from artifacts, rather than inferred from printed output.

The existing mock scripts prove tool and control-flow semantics. These runs are
`driven_by: agent`, source-host Windows evidence. They do not prove live model
quality, arbitrary providers, packaged behavior or release approval.
`releaseApproved`, `productApproved`, `liveReady` and `defaultOn` stay false.

Raw runs use `D:/tmp/clawx-product-acceptance/<run-id>/a5-qa-pack/` or a recorded
agent-owned repo output root with a D: recovery archive. Curated final evidence
uses `harness/specs/fixtures/product-acceptance-closeout/a5-qa-pack/`, including
candidate commit/tree/dirty, result counts, reproducible commands, SHA256SUMS
and a zero-hit credential scan.
