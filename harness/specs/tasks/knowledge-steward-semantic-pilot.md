---
id: knowledge-steward-semantic-pilot
title: Knowledge Steward semantic pass pilot (Area 5 §3.2)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an opt-in LLM classification pass to the Knowledge Steward review, riding the existing role system without changing the heuristic-first, always-degradable design.
touchedAreas:
  - shared/host-api/contract.ts
  - electron/services/knowledge-api.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
expectedUserBehavior:
  - When the active KB role player has classification: 'heuristic' (default), stewardReview runs the instant offline heuristic pass only — byte-identical to today's behavior.
  - When classification: 'semantic' and an LLM invoker is registered, stewardReview runs the heuristic pass first, then a second LLM pass that refines type/tags and adds judgment warnings (duplicate, conflict, stale, quality).
  - LLM pass failure, timeout, or missing invoker → heuristic result stands; stewardNotes records "semantic pass unavailable" with the reason.
  - Semantic type overrides heuristic only when confidence >= 0.7; below threshold, heuristic type is kept and disagreement is logged.
  - The steward can never apply changes directly (canApplyDirectly: false remains a literal type).
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/knowledge-steward-registry.test.ts
acceptance:
  - mergeSemanticReview is a pure function that unions tags, concatenates warnings (semantic warnings prefixed with [kind]), and overrides type only when confidence >= 0.7.
  - setSemanticStewardInvoker / getSemanticStewardInvoker provide a module-level seam for dependency injection; default is null (no LLM).
  - stewardReview handler checks activeRole.classification === 'semantic' before attempting the LLM pass; heuristic-only when classification is 'heuristic'.
  - wiki.search context gathering is best-effort (search failure does not block the semantic pass).
  - All degradation paths (no invoker, invoker returns null, invoker throws) produce a success response with "semantic pass unavailable" appended to notes.
docs:
  required: true
---

## Pilot phases (§6 Migration Path)

1. **Operator gate / default-off**: registry ships with `classification: 'heuristic'` for the default steward; semantic is per-variant opt-in via the Configure flow.
2. **Shadow phase**: both passes run but the heuristic result remains authoritative; the semantic result is stored as a stewardNotes appendix. Telemetry: type-classification agreement rate, warning helpful-rate, semantic pass latency/cost.
3. **Gate to active**: >= 30 shadow reviews; semantic type agreement with user's final accepted type >= heuristic's agreement; warning helpful-rate >= 60%.
4. **Rollback**: disable-only — flip variant back to `heuristic`; persisted drafts keep whatever review they got; no schema change (all new fields optional JSON).

## Execution path (target vs MVP)

- **Target**: Main's `stewardReview` gathers context (draft + top-K `wiki.search` results) and invokes the runtime via `spawnRoleSubagent` with the steward contract (`tools: ['read']`, `network: 'none'`, `effort: 'low'`, JSON schema output). The role-spawn path enforces the tool allowlist mechanically.
- **MVP (current)**: a pluggable `SemanticStewardInvoker` seam (`setSemanticStewardInvoker`) that can be wired to a direct single-turn `chat.send` against a dedicated steward session. The seam is null by default; production wiring is a separate task once the gateway/chat infrastructure is confirmed.

## Structured output

```typescript
type StewardSemanticReview = {
  type: KnowledgeDraftType;
  tags: string[];
  warnings: Array<{ kind: 'duplicate' | 'conflict' | 'stale' | 'quality'; message: string; relatedPageId?: string }>;
  confidence: number;      // 0-1; below 0.7 → keep heuristic result
};
```
