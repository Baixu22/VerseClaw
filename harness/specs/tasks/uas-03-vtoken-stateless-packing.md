---
id: uas-03-vtoken-stateless-packing
title: UAS-03 VerseToken stateless packing
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the production VerseToken path a stateless, side-effect-free context pack request with explicit Orchestrator allowance, deduplicated candidates, honest token-estimate metadata, concurrent request isolation, and a defined hot-reload completion contract without changing product enablement or context authority.
ownedPaths:
  - harness/specs/tasks/uas-03-vtoken-stateless-packing.md
  - harness/specs/rules/vtoken-foundation-boundary.md
  - packages/vtoken/src/vtoken/host_rpc.py
  - packages/vtoken/src/vtoken/store.py
  - packages/vtoken/tests/test_host_rpc.py
  - packages/vtoken/tests/test_store.py
  - packages/vtoken/README.HOST.md
  - openclaw_runtime/src/context-engine/vtoken-rpc-client.ts
  - openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts
  - openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.test.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.test.ts
  - openclaw_runtime/src/context-engine/dcs-observability.ts
  - openclaw_runtime/src/context-engine/dcs-observability.test.ts
  - tests/unit/uas-03-vtoken-stateless-packing.test.ts
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
  - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
  - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
  - docs/dev/handoffs/LATEST.md
touchedAreas:
  - harness/specs/**
  - packages/vtoken/**
  - openclaw_runtime/src/context-engine/**
  - tests/unit/**
  - docs/dev/unified-agent-system/**
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - Opt-in VerseToken Working Context produces the same bounded prompt category while production packing no longer creates session files, WAL files, or lock files.
  - Independent agent turns can submit stateless pack requests without one request reopening or replacing another request's store.
  - VerseToken token counts are exposed as estimates with an explicit estimate method and are never represented as provider actual usage.
  - Existing diagnostics open/ingest/assemble host-api behavior remains available and default OFF.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - vtoken-foundation-boundary
forbiddenPatterns:
  - production open -> ingest -> assemble transactions, production sessionDir/session, production MemStore, production WAL, or production lock ownership
  - a shared runExclusive tail or another global mutex around stateless production pack requests
  - accepting duplicate pack candidate ids or silently allowing one request to mutate another request's graph
  - calling pack allowance provider actual usage, actual tokens, billed tokens, or cost
  - a second context budget, Memory authority, journal, Gateway route, host-api route, renderer IPC route, or renderer-side Python process
  - changing VToken default OFF, context enhancement kill-switch precedence, liveReady, productApproved, defaultOn, TF-0006, TF-0009, or TF-0018 ownership
  - implementing TF-0015, TF-0016, TF-0017, TF-0018, TF-0019, FP-P4-03, or product graduation
featureFlags:
  - No new runtime flag is added by UAS-03.
  - runtime.vtoken.assembly.enabled and VERSE_VTOKEN_ASSEMBLY_ENABLED remain explicit opt-in gates.
  - VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH and runtime.contextEnhancement.killSwitch remain fail-closed and take precedence.
rollback:
  - Revert the production caller to the existing stateful RPC methods while leaving the diagnostics bridge and package persistence APIs unchanged.
  - No data migration is required because the stateless pack request owns no durable business state.
  - Existing VToken session files, if created by diagnostics or package users, remain readable by the unchanged stateful API.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/uas-03-vtoken-stateless-packing.md
  - pnpm harness validate --spec harness/specs/tasks/uas-03-vtoken-stateless-packing.md
  - pnpm vtoken:test
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/chat-turn-vtoken-injection.test.ts src/context-engine/context-orchestrator.test.ts src/context-engine/dcs-observability.test.ts
  - pnpm exec vitest run tests/unit/uas-03-vtoken-stateless-packing.test.ts tests/unit/context-orchestrator-entry-scan.test.ts tests/unit/vtoken-bridge.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- harness/specs/tasks/uas-03-vtoken-stateless-packing.md harness/specs/rules/vtoken-foundation-boundary.md packages/vtoken/src/vtoken/host_rpc.py packages/vtoken/src/vtoken/store.py packages/vtoken/tests/test_host_rpc.py packages/vtoken/tests/test_store.py packages/vtoken/README.HOST.md openclaw_runtime/src/context-engine/vtoken-rpc-client.ts openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.test.ts openclaw_runtime/src/context-engine/context-orchestrator.ts openclaw_runtime/src/context-engine/context-orchestrator.test.ts openclaw_runtime/src/context-engine/dcs-observability.ts openclaw_runtime/src/context-engine/dcs-observability.test.ts tests/unit/uas-03-vtoken-stateless-packing.test.ts docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md docs/dev/handoffs/LATEST.md
acceptance:
  - Production Working Context uses one VtokenPackRequest/v1 RPC call and never calls vt.open, passes sessionDir/session, or creates MemStore/WAL/lock state.
  - The request carries an explicit allowanceTokens value owned by Context Orchestrator configuration and a stable, duplicate-free candidate list.
  - The worker rejects duplicate candidate ids and processes independent stateless pack requests concurrently without shared graph state or cross-request reopen behavior.
  - VtokenPackResult/v1 reports estimatedTokens and estimateMethod=chars_div_4; production comments, logs, types, and observability identify the value as an estimate rather than provider actual usage.
  - A filesystem-side-effect test proves stateless packing leaves the chosen state directory unchanged.
  - Multi-request tests prove two workspaces can pack overlapping graph ids without contamination and without a global exclusive transaction tail.
  - Doc-source hot reload exposes a synchronous refresh completion method; the concurrency test waits for that completion before asserting the final version.
  - Stateful diagnostics open/ingest/assemble tests remain green and VToken package persistence APIs remain available outside the production pack path.
  - Context Orchestrator remains the final deduplication, ordering, budget, projection, and lineage authority; UAS-03 adds no competing budget or Memory owner.
  - Default OFF, kill-switch, product locks, TF-0006 blocked state, TF-0009 review state, and TF-0018 ownership remain unchanged.
docs:
  required: true
  files:
    - packages/vtoken/README.HOST.md
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
    - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - Document the production stateless wire contract, estimate semantics, concurrency behavior, and the retained diagnostics stateful API.
    - Review README variants under docs-sync; update only if the internal refactor changes a user-visible flow or public product interface.
---

# UAS-03 VerseToken Stateless Packing

This task implements Task Forest node `TF-0014/UAS-03` only. It removes unnecessary business
state from the production VerseToken path while retaining the package's explicit persistence APIs
and the Electron diagnostics surface.

The authority split remains frozen: Context Orchestrator owns candidate selection, deduplication,
final allowance, projection, and lineage; VerseToken performs deterministic packing and rendering
for the candidates and allowance it receives. The returned token value is an estimate, not provider
usage or billing evidence.

UAS-03 does not authorize default-on behavior, product graduation, long-term Memory writes, Coding
mutation changes, VerseShell routing, canary expansion, ROI claims, or any Task Forest status change
outside the normal confirmed closeout proposal.
