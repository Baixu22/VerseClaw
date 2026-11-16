---
lifecycleStatus: archived
id: context-control-plane-stage5
title: Context Control Plane Stage 5 Memory Facade and Unit Aware Packing
taskType: runtime-authority-convergence
intent: >-
  Converge semantic memory behind one namespace-scoped durable owner and expose
  compatibility memory/context tools through a read-only facade. Replace
  character-prefix context truncation with a deterministic unit-aware packer
  that accounts for tokens, tool schemas, multimodal units, and output reserve.
  Critical, constraint, and evidence units are never silently cut. The feature
  remains observational/default-off and does not grant Memory DCS decision
  authority or add a durable writer.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage5.md
  - docs/dev/context-control-plane/DEVLOG.zh-CN.md
  - docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md
  - openclaw_runtime/src/context-engine/stage5-memory-facade.ts
  - openclaw_runtime/src/context-engine/stage5-unit-aware-packer.ts
  - openclaw_runtime/src/context-engine/stage5-memory-facade.test.ts
  - openclaw_runtime/src/context-engine/stage5-unit-aware-packer.test.ts
  - openclaw_runtime/src/agents/stage5-golden-run.ts
  - openclaw_runtime/src/agents/stage5-golden-run.test.ts
  - tests/unit/context-control-plane-stage5-contracts.test.ts
ownerDecisions:
  - "D1 accepted: each semantic-memory namespace has one durable owner; retrieval and summarization are adapters that return candidates only."
  - "D2 accepted: memory_search, memory_get, memory_query, context_search, and context_read remain compatibility names and route through the facade without changing executor authority."
  - "D3 accepted: Memory never selects PromptPlan entries, changes policy, or owns DCS admission/packing decisions."
  - "D4 accepted: packer inputs are immutable units with explicit kind, priority, token estimate, and provenance; critical/constraint/evidence units are atomic."
  - "D5 accepted: feature state is observational/default-off; flag off returns the legacy value and tool-name set unchanged."
  - "D6 accepted by owner: all development and acceptance tasks in this environment are agent-operated; there is no separate human acceptance channel. Stage 5 L7 therefore does not require >=10 human coding tasks. Agent-executed real-provider golden runs are the E4 evidence source; synthetic or cached runs are never promoted."
  - "D7 accepted by owner: numeric critical/constraint/evidence retention targets and P95 compile latency/cost thresholds are deferred to post-Stage-6 soak/exploration. Until the owner supplies values, L7 records real-run observations and does not gate Stage 6."
  - "D8 accepted by owner 2026-08-19: post-Stage-6 soak baseline S1-S6 is fixed in harness/specs/tasks/context-control-plane-stage5-l7-soak.md (critical/constraint/evidence retention 100%, P95 total compile latency <=100ms, P95 turn tokens <=4000, optional cost <=0.02 USD/turn, 10 paired baseline/experiment real turns). Soak evidence is artifacts/context-control-plane/stage5-l7-soak-evidence.json."
blockedBy: []
expectedUserBehavior:
  - "Existing memory_* and context_* names remain discoverable and return backend/source/freshness/evidence metadata; unknown tool names and schema-invalid adapter candidates fail closed with queryable reasons."
  - "A full unit either fits or is reported omitted/degraded with a queryable reason; no raw prefix truncation can split a critical, constraint, evidence, tool-schema, or multimodal unit. Invalid kind/priority/id/sourceRef, duplicate unit ids, and fractional/negative token estimates fail closed before packing."
  - "Memory results are candidates and cannot mutate PromptPlan, policy, grants, receipts, or effect state."
  - "Flag off preserves the previous tool set and serialized prompt bytes."
  - "The explicit-invoke Stage 5 observational runner is default off, reuses the real Stage 2 provider/write chain, and records only digest/ref evidence."
  - "No new durable memory writer, permission store, approval ledger, or product-lock change is introduced."
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
  - context-family-boundary
  - active-config-guards
  - coding-runtime-workspace-dcs-producer-boundary
humanEvidence: not-required
forbiddenPatterns:
  - adding a second semantic-memory durable writer or durable memory database
  - making Memory a PromptPlan, policy, grant, receipt, or effect authority
  - prefix slicing of context units or silent dropping of critical/constraint/evidence units
  - Date.now, new Date, Math.random, or provider calls inside facade/packer pure functions
  - changing defaultOn, liveReady, productApproved, or any product default
  - inventing numeric retention/P95 thresholds not supplied by the owner
  - storing raw prompt, tool output, credentials, or multimodal bytes in receipts/evidence
  - committing, pushing, or creating a PR
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage5-contracts.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage5-memory-facade.test.ts src/context-engine/stage5-unit-aware-packer.test.ts --reporter=verbose
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-golden-run.test.ts --reporter=verbose
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - git diff --check
acceptance:
  - "L1: Static scan and facade tests prove exactly one durable Memory write boundary; retrieval/summarization adapters only return candidates."
  - "L2: All five compatibility tool names route through one facade and every result carries backend, source, freshness, and evidence metadata; unknown tool names and invalid namespace/limit/query-id/candidate enum/evidence-digest inputs fail closed with queryable reasons."
  - "L3: Facade APIs cannot return PromptPlan/policy/grant/effect authority and context_* results are typed as context candidates, not memory authority."
  - "L4: Unit-aware packing accounts for token units, tool schema units, multimodal metadata units, and output reserve; atomic critical/constraint/evidence overflow returns explicit failure/degradation reasons and never prefix-slices. Invalid unit kind/priority/id/sourceRef, duplicate unit ids, and fractional/negative token estimates are rejected before any decision is produced."
  - "L5: Repeated facade projection and packing with equal inputs are deep-equal; source scan finds no wall-clock or randomness in pure functions."
  - "L6: Flag off leaves legacy bytes and compatibility tool names unchanged; explicit enablement only changes the observational projection."
  - "L7 PASS 2026-08-19: one real DeepSeek Stage 5 observational run plus the post-Stage6 soak are complete. Soak baseline S1-S6: critical/constraint/evidence retention 100%, P95 total compile latency <=100ms (observed 69ms), P95 turn tokens <=4000 (observed 663), 10 paired baseline/experiment real turns (20 real provider turns total, 0 invalid). Evidence: artifacts/context-control-plane/stage5-real-run-evidence.json and artifacts/context-control-plane/stage5-l7-soak-evidence.json. No synthetic or cached run is promoted to E4."
  - "L8: Product locks remain false, DEEPSEEK_API_KEY is absent from all persistent scopes, sk-hex32 scan is zero, no probe remains, and no commit/push/PR exists."
docs:
  required: true
  files:
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/stage0/artifacts-schema.md
    - docs/dev/context-capability-blueprint.md
    - docs/dev/adr/2026-08-16-context-authority-boundaries.md
    - harness/specs/tasks/context-control-plane-stage4.md
---

# Context Control Plane Stage 5

## Production disposition: retire (TF-0744)

The facade was never adopted by a production memory tool or a public production
barrel. Its direct exports remain only for contract tests and the explicit
Stage5 golden-run observer. This archived stage describes those historical
observations; its compatibility-name claims do not describe current production
registration. Runtime Memory persist remains retired, and no tool/default or
product lock changes as part of this disposition. Current acceptance lives in
`harness/specs/tasks/memory-facade-disposition.md`.

Stage 5 is an adapter and packing convergence slice. It does not migrate the
existing memory store or turn the experimental path on. The stage contract is
the frontmatter acceptance table above. Owner decision D6/D7 makes L7 an
agent-operated real-provider evidence record with deferred numeric soak
targets; synthetic evidence is never promoted.
