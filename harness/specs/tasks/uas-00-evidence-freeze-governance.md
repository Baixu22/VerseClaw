---
lifecycleStatus: archived
id: uas-00-evidence-freeze-governance
title: UAS-00 evidence freeze and governance registration
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve and explicitly replay the historical unified-agent engineering baseline from one restored workspace, without requiring local task history for default tests or promoting historical evidence to acceptance of the current checkout.
touchedAreas:
  - .agent-workbench/task-forest/**
  - .gitignore
  - artifacts/coding-c1/**
  - artifacts/coding-prod-p0/**
  - artifacts/dcs-canary/**
  - artifacts/dcs-deep-test-week1/**
  - artifacts/first-product-preview/**
  - artifacts/unified-agent-system/TF-0011/**
  - docs/dev/**
  - electron/services/vtoken-bridge.ts
  - harness/specs/rules/c1-gate-corpus-authority.md
  - harness/specs/rules/dcs-production-flags-localization.md
  - harness/specs/rules/tf0009-real-canary-authority.md
  - harness/specs/rules/uas-00-evidence-freeze-boundary.md
  - harness/specs/tasks/dcs-production-flags-localization.md
  - harness/specs/tasks/p4-05-07-acceptance.md
  - harness/specs/tasks/tf0009-engineering-evidence-audit.md
  - harness/specs/tasks/uas-00-evidence-freeze-governance.md
  - harness/specs/tasks/unified-c1-gate-corpus.md
  - harness/specs/tasks/vtoken-default-off-documentation.md
  - harness/specs/tasks/vtoken-foundation-bridge.md
  - openclaw_runtime/CODING-PROD-P0-COMPLETE.md
  - openclaw_runtime/scripts/coding-c1-ab.mts
  - openclaw_runtime/scripts/tf0009-agent-surrogate.mts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.test.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.ts
  - package.json
  - packages/vtoken/README.HOST.md
  - scripts/build-openclaw-runtime.mjs
  - scripts/c1-authoritative-decision.mjs
  - scripts/dcs-ops-preflight.mjs
  - scripts/lib/tf0009-agent-surrogate.mjs
  - scripts/lib/tf0009-canary-readiness.mjs
  - scripts/smoke-openclaw-runtime.mjs
  - scripts/uas-00-evidence-freeze.mjs
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/vtoken/types.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
  - tests/unit/c1-authoritative-decision.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - tests/unit/dcs-production-flags-localization.test.ts
  - tests/unit/sekb-runtime-build-contract.test.ts
  - tests/unit/tf0009-agent-surrogate.test.ts
  - tests/unit/tf0009-engineering-evidence-audit.test.ts
  - tests/unit/uas-00-evidence-freeze.test.ts
  - tests/unit/vtoken-default-off-documentation.test.ts
expectedUserBehavior:
  - Maintainers can reproduce the exact dirty engineering baseline from HEAD, tracked diff, untracked file, environment, and executable hashes.
  - Historical TF-0009 records retain their degraded label; current v2 agent evidence may close the node under the 2026-09-27 policy without human/product claims.
  - VToken remains default OFF and no production runtime behavior changes during UAS-00.
  - Authority ownership for events, context, VToken packing, coding mutation, local execution, and long-term memory remains explicit and non-overlapping.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - tf0009-real-canary-authority
  - uas-00-evidence-freeze-boundary
  - vtoken-foundation-boundary
  - docs-sync
requiredTests:
  - tests/unit/uas-00-evidence-freeze.test.ts
  - tests/unit/tf0009-engineering-evidence-audit.test.ts
  - tests/unit/vtoken-default-off-documentation.test.ts
  - tests/unit/default-config-matrix.test.ts
acceptance:
  - A machine-readable audit manifest records HEAD, tracked and staged diff hashes, untracked file hashes, environment, executable hashes, and exact reproduction commands.
  - The manifest has a check mode that fails when the frozen working-tree inputs drift.
  - The owner matrix identifies one authority per governed surface and reserves TF-0018 as the only long-term Memory lifecycle owner.
  - In an explicit restored history workspace, the original chain remains TF-0011 ready / TF-0012 proposed or TF-0011 done / TF-0012 ready. Default tests do not require a current local task graph, export, or handoff.
  - Historical replay rejects missing authorization, relative or missing input roots, output inside either source workspace, existing output files, and input drift; it never rewrites sealed evidence.
  - TF-0009 keeps zero human/live counts; done requires clean validated v2 agent evidence, not a human verdict.
  - VToken active authority remains default OFF and the FP-P4-06 drift regression remains green.
  - Product locks, TF-0006 blocked state, C1 4.5x keep-off authority, and Runtime Memory diagnostics-only remain unchanged.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
    - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/repository-artifact-retention.md
---

# UAS-00 evidence freeze and governance registration

This spec preserves `TF-0011/UAS-00` as historical engineering evidence. Default tests
read the tracked legacy manifest; they do not require a local Task Forest or handoff.
Explicit replay binds every input to a restored historical root and writes only a
new external output:

```sh
node scripts/uas-00-evidence-freeze.mjs --history-replay --root=<absolute-history-workspace> --output=<new-absolute-external-output>
```

Use the same arguments with `--check` to detect drift in that replay. Missing local
history is a replay-input error, not a new product blocker. This tool does not
implement TF-0012, TF-0013, TF-0014, FP-P4-03, or FP-P4-04 or authorize live,
product, or default-on claims.

## Frozen boundaries

- Historical TF-0009 manifests retain `degraded-agent-complete`; current closure follows `tf0009-real-canary-authority` R7 and the 2026-09-27 owner policy.
- `liveReady=false`
- `productApproved=false`
- `defaultOn=false`
- C1 `4.5x`, `meetsGate=false`, `recommendation=keep-off`
- `TF-0006=blocked`
- Runtime Memory remains `diagnostics-only`
- TF-0018 remains the only long-term Memory lifecycle owner
