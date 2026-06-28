# Phase 9 Window Prompts

Use these prompts in order. Replace only the lane id/title when launching separate windows.

## Execution Order

1. Lane A: persistence spec boundary.
2. Lane B, C, D: run in parallel after Lane A.
3. Lane E: run after A-D submissions exist.
4. Synthesis owner: run after Lane E.

## Lane A Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 9 Lane A: persistence spec boundary.

Goal:
Prepare the Phase 9 Runtime Memory Persistence Foundation boundary. Do not implement runtime behavior.

Required:
- Read AGENTS.md, openclaw_runtime/AGENTS.md if runtime files are inspected, runtime-research/agent-runtime-index.md, Phase 8 synthesis, Phase 9 README/parallel-lanes/spec.
- Validate that Phase 9 forbids raw chat-log memory, raw trace-dump memory, unverified durable facts, default-on memory behavior, persistence without retention/redaction/migration/rollback/idempotency proof, provider-ordering cutover without parity proof, service/exporter/database service, and runtime authority.
- Refine docs/spec only if needed.
- Write runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md.
- Include path/function/test/command evidence and one valid Status line.

Validation:
- harness context/validate for Phase 9
- harness validate for Phase 8 and Phase 7
- touched-doc scans for forbidden boundary language
```

## Lane B Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 9 Lane B: local store schema migration.

Goal:
Design or implement default-off Runtime Memory local persistence for sanitized records without accepting persistence cutover.

Required:
- Start from Phase 8 synthesis and Phase 9 Lane A/spec evidence. Do not accept unverified memory claims.
- Prove the store owner/schema/retained fields/redacted fields/migration/idempotency/disabled parity story.
- If code is added, keep runtime.memory.persist default false and prove disabled parity.
- Prove no raw chat logs, transcripts, raw traces, prompts, full payloads, full checkpoints, full tool args/output, env, secrets, raw trace context, service/exporter/database service, listener, or external telemetry.
- Write runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-b-local-store-schema-migration.md.
- Include one valid Status line.

Validation:
- harness context/validate for Phase 9
- focused runtime memory store/context tests
- node typecheck if code changed
- persistence/raw-retention/service-exporter scans over touched files
- comms replay/compare only if Main/Gateway/host-api/api-client paths changed
```

## Lane C Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 9 Lane C: retention redaction rollback.

Goal:
Prove persisted Runtime Memory records retain only sanitized bounded fields and can roll back safely.

Required:
- Start from Phase 8 synthesis and Phase 9 Lane A/spec evidence.
- Prove retention limits, redaction behavior, invalidation behavior, migration rollback, stop-new-writes rollback, and user-data preservation.
- Do not persist raw chat logs, transcripts, raw traces, prompts, full payloads, full checkpoints, full tool args/output, env, secrets, raw trace context, or unbounded source bodies.
- Keep durable facts evidence-backed and current-valid queries filtered by default.
- Write runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-c-retention-redaction-rollback.md.
- Include one valid Status line.

Validation:
- harness context/validate for Phase 9
- runtime-memory-context-contracts and runtime-memory-store tests
- node typecheck if code changed
- raw-retention and persistence scans over touched files
```

## Lane D Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 9 Lane D: flag-off provider fact parity.

Goal:
Prove persistence does not change default provider ordering, memory authority, or durable fact promotion gates.

Required:
- Start from Phase 8 synthesis and Phase 9 Lane A/spec evidence.
- Prove default registry/provider ordering is unchanged when runtime.memory.provider and runtime.memory.persist are false.
- Prove persisted memory does not become a completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority.
- Prove durable facts still require source episode refs, evidence refs, and verifier/human/deterministic-rule promotion evidence.
- Do not add renderer direct IPC/Gateway HTTP calls.
- Write runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-d-flag-off-provider-fact-parity.md.
- Include one valid Status line.

Validation:
- harness context/validate for Phase 9
- runtime-memory-context-provider and context-provider-registry tests
- node typecheck if code changed
- renderer boundary scans
- service/exporter/raw-retention scans
- comms replay/compare if Main/Gateway/host-api/api-client paths changed
```

## Lane E Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Phase 9 Lane E: validation docs synthesis readiness.

Goal:
Validate A-D evidence and prepare Phase 9 for synthesis. Do not accept unverified lane claims.

Required:
- Review A-D submissions.
- Confirm every A-D submission exists and has exactly one valid Status line.
- Run harness context/validate for Phase 9 and validate Phase 8 and Phase 7.
- Run focused runtime memory tests, node typecheck, renderer boundary scans, service/exporter/database scans, persistence scans, raw-retention scans, and comms replay/compare if required.
- Classify broad scan matches as pre-existing or Phase-9-added.
- Review docs sync requirements.
- Write runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-e-validation-docs-synthesis-readiness.md.
- Include one valid Status line.

Validation:
- harness context/validate
- focused tests
- typecheck
- boundary scans
- persistence/raw-retention scans
- comms replay/compare if Main/Gateway/host-api/api-client paths changed
```
