---
lifecycleStatus: archived
id: phase-8-ast-patch-planner-readonly-scan
title: Phase 8 AST Patch Planner Readonly Scan
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Start AST Patch Planner work with a readonly TypeScript/TSX pattern/fix scan and preview-diff planner, without applying patches, mutating symbols, or changing TaskLoop/Gateway/provider behavior.
ownedPaths:
  - harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
  - runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
touchedAreas:
  - harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/runtime-ast-patch-planner*.test.ts
  - tests/fixtures/ast-patch-planner/**
  - runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - Default runtime behavior remains unchanged.
  - AST patch planning is explicit, local, readonly, and non-authoritative.
  - The planner may return matches, diagnostics, rule validation results, and preview diffs only.
  - No file write, patch apply, symbol mutation, TaskLoop automatic invocation, Gateway route, renderer route, or UI path is introduced.
  - Invalid rules, unbound metavariables, overbroad matches, overlapping ranges, and resume range drift fail closed into diagnostics.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - applying patches, writing files, workspace edits, rename, replace body, insert before/after, safe delete, or symbol mutation
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, model-message, provider-transport, or provider-ordering cutover
  - default-on AST patch planner behavior or automatic planner invocation
  - starting a service, listener, daemon, WebSocket server, local HTTP server, second Gateway, or second runtime
  - raw prompt/tool/checkpoint payload retention beyond bounded fixture/test evidence
  - treating preview diffs as verifier evidence for completed code edits
featureFlags:
  - runtime.astPatchPlanner.readonlyScan defaults off by omission.
  - runtime.astPatchPlanner.previewDiff defaults off by omission.
  - No flag may enable apply behavior in this phase.
rollback:
  - Omit or disable AST patch planner flags.
  - Do not call readonly planner helpers.
  - Remove optional planner exports without affecting AgentMap, Symbol, registry, verifier, trace, or memory paths.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner*.test.ts
  - pnpm --config.verify-deps-before-run=false run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/scan-pattern.mjs --pattern "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" <ast-patch-planner-touched-files>
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
  - node scripts/scan-pattern.mjs --pattern "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\\(" <ast-patch-planner-touched-files>
acceptance:
  - A task spec validates before implementation review.
  - Handoff lanes define contracts, rule validation, readonly scan/preview diff, resume drift diagnostics, and validation/synthesis.
  - Planner helpers are explicit-call only and return bounded structured results.
  - Preview diffs are diagnostics only and cannot be applied in this phase.
  - Tests cover fixable/unfixable rules, invalid rules, unbound metavariables, overbroad matches, overlapping ranges, multi-file preview diff order, and range drift on resume.
  - Runtime index records the phase as planned/ready only until synthesis accepts implementation evidence.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 AST Patch Planner Readonly Scan

This task starts the AST Patch Planner as a readonly planning surface. It intentionally stops before patch apply, workspace mutation, TaskLoop invocation, Gateway/Main/renderer routing, or verifier completion authority.
