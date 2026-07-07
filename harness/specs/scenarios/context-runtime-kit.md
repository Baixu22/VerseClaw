---
id: context-runtime-kit
title: Context Runtime Kit Boundary
type: context-runtime-boundary
ownedPaths:
  - harness/specs/scenarios/context-runtime-kit.md
  - harness/specs/rules/context-runtime-kit-boundary.md
  - harness/specs/tasks/context-runtime-kit.md
  - docs/superpowers/plans/2026-07-06-context-runtime-kit.md
  - docs/clawx-design-overview.md
  - docs/enhancements/05-adaptive-context-budget.md
requiredRules:
  - context-runtime-kit-boundary
  - workspace-harness-single-source
  - chat-loop-boundary
---

Context Runtime Kit work defines verifiable context protocols for long-running local agents. It is a harness-governed context architecture track that starts shadow-first and may only promote runtime behavior through explicit follow-up task specs.

Use this scenario when work changes the contract for CVK resources, selectors, chunks, compact views, evidence refs, retrieval traces, prompt bundle projections, hard-claim evidence, tool-schema expansion gates, or compact recovery boundaries.

Scenario boundaries:

- Context Runtime Kit must start shadow-first and report-only. Prompt assembly, tool invocation, approval, retry, and execution semantics stay legacy-authoritative until a later task spec explicitly promotes behavior with parity, metrics, rollback, and tests.
- `context-runtime-kit-default-on` is the Phase 1-10 promotion task for backend context, prompt addition, and recovery defaults. It may default the context engine to the core-owned CRK engine when no explicit slot is configured, but it must preserve `legacy` rollback, respect explicit slots, keep tool gates report-only, and avoid renderer/UI changes.
- Summary text, compact views, and recovery projections are navigation or recovery aids only. Hard claims require resolved evidence with `resource_id`, `selector`, and `checksum`.
- `CompressionArtifact`, `LoopContextPack`, Task Ledger, ClawGraph, Observability, Memory, and Knowledge keep their existing ownership. Context Runtime Kit may reference them or project from them, but it must not replace them.
- Durable policy belongs under `AGENTS.md` and `harness/specs/**`. Do not create a parallel `.trellis/`, `.cvk/rules`, hidden task database, or independent rule directory as source of truth.
- Phase 0 and Phase 1 are contract-only phases. They must not implement the CVK compiler, selector resolver, context router, verifier, artifact store, database, prompt assembly changes, renderer UI, host-api changes, or tool-call behavior changes.
