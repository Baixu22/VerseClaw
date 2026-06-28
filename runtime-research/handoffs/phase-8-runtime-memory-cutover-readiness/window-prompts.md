# Phase 8 Window Prompts

Use these prompts in order. Replace only the lane id/title when launching separate windows.

## Execution Order

1. Lane A: cutover spec boundary.
2. Lane B, C, D: run in parallel after Lane A.
3. Lane E: run after A-D submissions exist.
4. Synthesis owner: run after Lane E.

## Lane A Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 8 Lane A: cutover spec boundary.

Goal:
Prepare the Phase 8 Runtime Memory Cutover Readiness boundary. Do not implement runtime behavior.

Required:
- Read AGENTS.md, openclaw_runtime/AGENTS.md if runtime files are inspected, runtime-research/agent-runtime-index.md, Phase 7 synthesis, Phase 8 README/parallel-lanes/spec.
- Validate that Phase 8 forbids raw chat-log memory, raw trace-dump memory, unverified durable facts, default-on memory behavior, persistence without rollback, provider-ordering cutover without parity proof, service/exporter/database service, and runtime authority.
- Refine docs/spec only if needed.
- Write runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-a-cutover-spec-boundary.md.
- Include path/function/test/command evidence and one valid Status line.

Validation:
- harness context/validate for Phase 8
- harness validate for Phase 7
- touched-doc scans for forbidden boundary language
```

## Lane B Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 8 Lane B: persistence retention rollback.

Goal:
Design or implement default-off Runtime Memory persistence readiness without accepting persistence cutover.

Required:
- Start from Phase 7 synthesis and Phase 8 Lane A/spec evidence. Do not accept unverified memory claims.
- Prove the persistence owner/schema/retained fields/redacted fields/migration/rollback/idempotency/invalidation story.
- If code is added, keep runtime.memory.persist default false and prove disabled parity.
- Prove no raw chat logs, transcripts, raw traces, prompts, full payloads, full checkpoints, full tool args/output, env, secrets, raw trace context, service/exporter/database service, listener, or external telemetry.
- Write runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-b-persistence-retention-rollback.md.
- Include one valid Status line.

Validation:
- harness context/validate for Phase 8
- focused runtime memory store/context tests
- node typecheck if code changed
- persistence/raw-retention/service-exporter scans over touched files
- comms replay/compare only if Main/Gateway/host-api/api-client paths changed
```

## Lane C Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 8 Lane C: provider registration ordering cutover.

Goal:
Prove optional RuntimeMemoryProvider registration and ordering behavior without default provider-ordering cutover.

Required:
- Start from Phase 7 synthesis and Phase 8 Lane A/spec evidence.
- Prove default registry/provider ordering is unchanged when runtime.memory.provider is false.
- If an optional registration path is added, keep it default-off and prove rollback.
- Do not make memory context a completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority.
- Do not add renderer direct IPC/Gateway HTTP calls.
- Write runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-c-provider-registration-ordering-cutover.md.
- Include one valid Status line.

Validation:
- harness context/validate for Phase 8
- runtime-memory-context-provider and context-provider-registry tests
- node typecheck if code changed
- renderer boundary scans
- service/exporter/raw-retention scans
- comms replay/compare if Main/Gateway/host-api/api-client paths changed
```

## Lane D Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 8 Lane D: durable fact promotion gate.

Goal:
Prove candidates cannot become durable Runtime Memory facts without verifier, human, or deterministic-rule evidence.

Required:
- Start from Phase 7 synthesis and Phase 8 Lane A/spec evidence.
- Keep LLM extraction proposal-only; no unverified durable facts.
- Prove durable facts cite source episode refs, evidence refs, and promotion evidence.
- Prove current-valid queries exclude invalidated, expired, rejected, candidate, and unpromoted facts by default.
- Do not create completion, verifier, security, retry, tool, or runtime authority.
- Write runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-d-durable-fact-promotion-gate.md.
- Include one valid Status line.

Validation:
- harness context/validate for Phase 8
- runtime-memory-context-contracts, runtime-memory-store, and runtime-memory-proposal-shadow tests
- node typecheck if code changed
- raw-retention and authority scans over touched files
```

## Lane E Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 8 Lane E: validation docs synthesis readiness.

Goal:
Validate A-D evidence and prepare Phase 8 for synthesis. Do not accept unverified lane claims.

Required:
- Review A-D submissions.
- Confirm every A-D submission exists and has exactly one valid Status line.
- Run harness context/validate for Phase 8 and validate Phase 7.
- Run focused runtime memory tests, node typecheck, renderer boundary scans, service/exporter/database scans, raw-retention scans, and comms replay/compare if required.
- Classify broad scan matches as pre-existing or Phase-8-added.
- Review docs sync requirements.
- Write runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-e-validation-docs-synthesis-readiness.md.
- Include one valid Status line.

Validation:
- harness context/validate
- focused tests
- typecheck
- boundary scans
- raw-retention scans
- comms replay/compare if Main/Gateway/host-api/api-client paths changed
```
