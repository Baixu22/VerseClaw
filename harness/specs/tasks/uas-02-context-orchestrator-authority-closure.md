---
id: uas-02-context-orchestrator-authority-closure
title: UAS-02 Context Orchestrator authority closure
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the TF-0002 residual by routing production Memory, VToken, DCS context-block, and CVK prompt additions through one ContextCandidate/v1 arbitration authority that deterministically orders, deduplicates, budgets, projects, and records lineage without changing product locks or implementing UAS-03 VerseToken storage and concurrency work.
ownedPaths:
  - openclaw_runtime/src/agents/harness/context-engine-lifecycle.ts
  - openclaw_runtime/src/agents/harness/selection.ts
  - openclaw_runtime/src/agents/harness/selection.compass.test.ts
  - openclaw_runtime/src/auto-reply/reply.test-harness.ts
  - openclaw_runtime/src/auto-reply/reply.compass.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md
  - openclaw_runtime/src/context-engine/context-orchestrator.ts
  - openclaw_runtime/src/context-engine/context-candidate.ts
  - openclaw_runtime/src/context-engine/assembler.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.test.ts
  - openclaw_runtime/src/context-engine/context-candidate.test.ts
  - openclaw_runtime/src/context-engine/assembler.test.ts
  - openclaw_runtime/src/context-engine/turn-injection-budget.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.working-memory.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - tests/unit/context-orchestrator-entry-scan.test.ts
  - docs/dev/context-orchestrator.md
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/handoffs/LATEST.md
  - openclaw_runtime/src/agents/cli-runner.ts
  - openclaw_runtime/src/agents/cli-runner/prepare.ts
  - openclaw_runtime/src/agents/cli-runner/types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner-execution.ts
  - openclaw_runtime/src/auto-reply/reply/followup-runner.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply-run.ts
  - openclaw_runtime/src/auto-reply/reply/queue/types.ts
  - openclaw_runtime/src/context-engine/rc03-seal-hook.ts
  - openclaw_runtime/src/context-engine/registry.ts
  - openclaw_runtime/src/context-engine/compass-context.ts
  - openclaw_runtime/src/context-engine/context-orchestrator.compass.test.ts
touchedAreas:
  - artifacts/agent-dev-workbench/**
  - artifacts/agent-dev-deep-test/**
  - artifacts/agent-dev-quality/**
  - openclaw_runtime/extensions/codex/src/app-server/side-question.ts
  - openclaw_runtime/extensions/codex/src/app-server/attempt-context.ts
  - openclaw_runtime/extensions/codex/src/app-server/dynamic-tool-diagnostics.ts
  - openclaw_runtime/extensions/codex/src/app-server/dynamic-tools.ts
  - openclaw_runtime/extensions/codex/src/app-server/event-projector.ts
  - openclaw_runtime/extensions/codex/src/app-server/diagnostic-contract.test.ts
  - artifacts/tf0013-codex-contract-20261001/**
  - openclaw_runtime/extensions/codex/src/app-server/run-attempt.ts
  - artifacts/tf0013-native-wire-20260930/**
  - openclaw_runtime/src/agents/harness/context-engine-lifecycle.ts
  - artifacts/tf0013-native-budget-20260930/**
  - openclaw_runtime/src/agents/harness/selection.ts
  - openclaw_runtime/src/agents/harness/selection.compass.test.ts
  - openclaw_runtime/src/auto-reply/reply.test-harness.ts
  - openclaw_runtime/src/auto-reply/reply.compass.test.ts
  - harness/specs/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/agents/cli-runner.ts
  - openclaw_runtime/src/agents/cli-runner/**
  - openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts
  - openclaw_runtime/src/auto-reply/reply/**
  - .agent-workbench/task-forest/**
  - artifacts/tf0013-compass-budget-20260930/**
  - artifacts/tf0013-message-budget-20260930/**
  - tests/unit/**
  - docs/dev/**
expectedUserBehavior:
  - Context enhancements remain opt-in and fail closed; all product defaults and the three product locks remain false.
  - When enabled sources overlap, stable authority identity and content digest prevent duplicate projection without model inference or semantic matching.
  - Enabled working-memory, role-memory or compass knowledge, tool registry, CVK, VToken, and Runtime Memory candidates share one deterministic precedence and one turn budget.
  - The context enhancement kill switch or a source flag being off prevents that source from querying, producing, charging, or projecting context.
  - Runtime Memory remains diagnostics-only outside the already opt-in memory inject pilot; SEKB remains human-confirmed and never auto-writes.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - a second production context assembly authority, prompt mutator, budget ledger, context registry, or semantic dedup model
  - heading text, source display text, or provider prose as the sole dedup identity
  - charging or projecting any candidate before the declared precedence and dedup pass
  - private Assembler fallback budget on a production call, unbudgeted CVK addition, or reservation standing in for final precedence
  - querying BlockStore, Runtime Memory providers, VToken RPC, or another source when its flag is off or the context enhancement kill switch is engaged
  - changing liveReady, productApproved, or defaultOn to true; changing C1 4.5x, meetsGate=false, or recommendation=keep-off
  - Runtime Memory production graduation, SEKB automatic writeback, TF-0006 completion, or claiming agent-driven evidence as real-human
  - VToken MemStore, WAL, lock, worker-pool, reload-completion, workspace isolation, or estimate-versus-actual implementation owned by TF-0014/UAS-03
  - FP-P4-03 Settings opt-in, runtime acknowledgement, Electron E2E, or default-on graduation
  - FP-P4-04 long-term Memory lifecycle behavior owned by TF-0018/UAS-07
  - renderer, Main, host-api, api-client, Gateway route, provider transport, approval, or tool-permission changes
featureFlags:
  - No new default-on flag is added by UAS-02.
  - Existing context block, Runtime Memory inject-pilot, and VToken assembly flags remain explicit opt-ins.
  - Existing context enhancement kill switch remains the master fail-closed control and must stop queries before candidate production.
rollback:
  - Remove the ContextCandidate arbitration wiring and restore the existing orchestrator, Assembler, and CVK projection calls.
  - Existing BlockStore data, Runtime Memory stores, VToken RPC data, context-engine plugins, and turn accounting require no migration.
  - All source flags and product locks remain unchanged, so rollback is code-only and does not enable a fallback product path.
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-codex.config.ts extensions/codex/src/app-server/diagnostic-contract.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p extensions/codex/tsconfig.json
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts harness/selection.compass.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.auto-reply-top-level.config.ts reply.compass.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/context-orchestrator.compass.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts rc03-entry-transitions.acceptance.test.ts
  - pnpm harness context --spec harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md
  - pnpm harness validate --spec harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/context-candidate.test.ts src/context-engine/context-orchestrator.test.ts src/context-engine/assembler.test.ts src/context-engine/turn-injection-budget.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/embedded-agent-runner/extensions.knowledge.test.ts src/agents/embedded-agent-runner/extensions.working-memory.test.ts src/agents/embedded-agent-runner/extensions.tool-registry.test.ts
  - pnpm exec vitest run tests/unit/context-orchestrator-entry-scan.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md openclaw_runtime/src/context-engine/context-orchestrator.ts openclaw_runtime/src/context-engine/context-candidate.ts openclaw_runtime/src/context-engine/assembler.ts openclaw_runtime/src/context-engine/turn-injection-budget.ts openclaw_runtime/src/context-engine/context-orchestrator.test.ts openclaw_runtime/src/context-engine/context-candidate.test.ts openclaw_runtime/src/context-engine/assembler.test.ts openclaw_runtime/src/context-engine/turn-injection-budget.test.ts openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts openclaw_runtime/src/agents/embedded-agent-runner/extensions.knowledge.test.ts openclaw_runtime/src/agents/embedded-agent-runner/extensions.working-memory.test.ts openclaw_runtime/src/agents/embedded-agent-runner/extensions.tool-registry.test.ts openclaw_runtime/src/agents/embedded-agent-runner/compact.ts openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts tests/unit/context-orchestrator-entry-scan.test.ts docs/dev/context-orchestrator.md docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md docs/dev/first-product-controlled-preview/STATUS.md docs/dev/handoffs/LATEST.md
acceptance:
  - Codex native and dynamic tool diagnostics carry a host-generated requestId and a resolved trace, with matching identity on each start/terminal pair; schema quarantine emits a valid standalone blocked event. Codex tool-definition reporting supplies the shared definitionChars field without changing its existing accounting convention.
  - Separately loaded source hosts and built plugin SDKs share the native attempt scope, and admission executes against the original owner's candidate collection and ledger. Real native app-server requests verify atomic drop, shared exhaustion, kill, bootstrap reuse, and stale-thread recovery with an explicitly agent-driven local provider.
  - Native harness dispatch and its SDK ContextEngine assembly share the existing attempt ledger with COMPASS; retained history is free, new message replacements are atomic, and system additions consume remaining capacity before plugin projection.
  - Native startup retries reuse an identical admitted assembly without charging twice; failed assembly cannot mutate caller history, kill switch prevents engine assembly, and failed attempts release collection and ledger state.
  - A reduced native assembly cannot retain its original thread-bootstrap fingerprint; plugin context-window rendering limits remain separate from the shared enhancement allowance.
  - Embedded ContextEngine replacements containing new or rewritten messages enter the existing cvk_addition candidate arbitration; retained history is matched exactly with multiplicity and is not charged again.
  - Structured replacements are atomic. Only the serialized new messages count toward the unchanged shared character budget; an over-budget replacement is dropped without truncating tool structures or removing original history. Engine input mutation cannot corrupt the live transcript on failure.
  - A replacement admitted on the first call remains present exactly once in later tool-loop calls, and each intercepted request is bound to its own wire receipt and matching context receipt.
  - COMPASS SSP and retrieval are prepared behind source flags and the enhancement kill switch, transported through immediate and queued runs, and projected only by the existing candidate owner in embedded and CLI execution.
  - COMPASS receipts attribute the charged text after truncation; only fully projected retrieval groups count toward fact-use metrics. No raw pre-budget COMPASS text is appended to extraSystemPrompt.
  - ContextCandidate/v1 has stable candidateId and dedupKey fields derived from authority object identity, authority version, and a deterministic content digest.
  - Candidate ordering uses the declared turn-injection precedence with deterministic tie breaking; duplicate dedupKey candidates are dropped before any budget charge.
  - Final lineage records candidate identity, source, channel, disposition, requested and applied characters, and explicit duplicate, empty, budget-truncate, budget-drop, flag-off, or kill-switch reasons.
  - Production Memory, VToken, DCS context-block, and CVK additions cannot project through an independent final assembly authority.
  - The production attempt gathers all enabled candidates before final arbitration; the final projection order matches declared precedence rather than lifecycle call order or reservation behavior.
  - One existing turn ledger remains the only total budget owner, and no production Assembler call creates a private fallback budget.
  - Combined tests cover knowledge from compass or role-memory, working-memory, tool registry, CVK, VToken, and memory-pilot enabled on the same turn with deterministic ordering, deduplication, accounting, and lineage.
  - Flag-off and kill-switch tests prove zero source query, zero candidate production, zero charge, and zero injection.
  - A static production scan finds one final Context Orchestrator authority and no direct low-level production prompt projection for the covered sources.
  - liveReady=false, productApproved=false, defaultOn=false, C1=4.5x, meetsGate=false, recommendation=keep-off, TF-0006 blocked, Runtime Memory diagnostics-only, and SEKB auto-writeback=false remain unchanged.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/handoffs/LATEST.md
    - docs/dev/context-orchestrator.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - Record UAS-02 as an engineering authority closure, not live, product, default-on, or Runtime Memory graduation evidence.
    - Review README variants; update only if user-visible behavior, public interfaces, or product flows change.
---

# UAS-02 Context Orchestrator Authority Closure

This task implements Task Forest node TF-0013 only. It closes the known TF-0002 residual by making one Context Orchestrator the final selector, deduplicator, budget consumer, projector, and lineage recorder for the covered production context sources.

The source stores and builders keep their domain ownership. ContextCandidate/v1 is a bounded projection contract, not a new Memory store, provider registry, semantic router, or persistence layer. UAS-02 must not implement TF-0014/UAS-03 VerseToken storage or concurrency work, FP-P4-03 product opt-in, FP-P4-04 long-term Memory lifecycle behavior, or any product-lock change.

## 2026-09-30 TF-0013 development slice

COMPASS pre-reply output joins the existing knowledge channel and unchanged turn budget. Embedded ContextEngine message replacements join the same owner as atomic candidates after exact history matching. An unchanged or windowed history remains free; summaries and added copies are new content. Native harness dispatch now retains that ledger across SDK assembly and startup retries; admission precedes plugin prompt rendering without changing engine identity or the public SDK contract. Development proof uses the focused commands above plus runtime types/lint and comms; formal RC acceptance requires a fresh frozen candidate. Native external app-server transport is not proven by a dispatch/SDK fixture.
