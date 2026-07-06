# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md --no-diff
```

## Unit Coverage

- Evidence-qualified positive trigger with deleted touched-path metadata, failing edit scorecard metadata, and Phase 5 `futureActiveCandidate.action: "block"` plus `requiresAcceptedSpec: true`.
- False-block cases for expected edits, expected deletion, normal completed repair, completed test repair, sanitized/inconclusive touched-path metadata, legitimate fixture mutation, slow test command metadata, and known dev-server-like long-running metadata.
- Expected deletion observes Phase 5 future candidate metadata but does not qualify as a proof trigger while edit metrics pass.
- Proof output preserves replay id/scenario/terminal status, scorecard aggregate decision, `wrong_file_edit` and `unnecessary_edit` metric refs, failure refs, evidence refs, and touched-path refs.
- Proof output is deterministic through fixture-owned/synthetic metadata, JSON-serializable, bounded, diagnostics-only, evaluation metadata only, and not completion proof.
- Proof output keeps `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- Proof output excludes raw prompts, provider payloads, tool args/results, secrets, environment dumps, and unredacted workspace content.
- A negative corpus mutation reports `needs_more_evidence` when a false-block expected-deletion case becomes evidence-qualified.
- Boundary scans prove no active runtime consumer and no checkpoint/lifecycle authority write.

## Boundary Scan

The focused unit test scans active runtime roots for imports or references to:

- `failure-tool-invocation-governance-destructive-operation-guard-evidence-proof`
- `createRuntimeFailureDestructiveOperationGuardEvidenceProofReport`

Forbidden active roots include agents, Gateway, ACP control plane, Electron main/services, and renderer `src`. Allowed references are the helper file, docs, and focused tests.

The focused unit test also scans checkpoint and lifecycle authority files for the same references so proof metadata cannot silently become runtime state authority.

## Promotion Criteria

This phase may only promote to `evidence_conditions_met_not_active_runtime_ready`. Any active guard proposal requires a later accepted implementation spec with:

- an explicit default-off/disable flag
- tool invocation preflight ownership
- fresh active-consumer boundary scan
- replay/scorecard false-block regression coverage
- rollback proof that restores legacy behavior without migration or state cleanup

## Stop Conditions

Stop and write a narrower follow-up spec if any implementation need appears to:

- read live providers
- execute real tool mutations
- modify the real workspace
- persist raw prompt/provider/tool/secret/env/workspace content
- change TaskLoop/provider/Gateway/prompt/retry/approval/rollback/completion/tool-blocking behavior
- add services, daemons, listeners, servers, databases, exporters, schedulers, or always-on sidecars
- treat governance reports, replay reports, scorecards, evidence proof output, evidence, or failure events as completion proof
