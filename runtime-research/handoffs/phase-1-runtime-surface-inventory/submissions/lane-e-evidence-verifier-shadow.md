# lane-e-evidence-verifier-shadow: Task-loop Evidence Verifier shadow report handoff

## Status

blocked_on_lane_a_contracts

This lane cannot safely land runtime code yet. The requested shadow report must emit the shared runtime-core `EvidenceRef` contract, and the workspace does not contain the `lane-a-runtime-core-contracts` source for `RuntimeTaskEvent`, `ContextItem`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, or `Checkpoint`. Per lane constraint, this file records adapter research and test drafts only; it does not define substitute contract types.

## Scope Confirmation

- Lane: `lane-e-evidence-verifier-shadow`
- Goal: Generate a warning-only Evidence Verifier shadow report beside the existing task-loop evidence gate without changing completion decisions.
- Legacy paths inspected:
  - `openclaw_runtime/src/agents/task-loop-controller.ts:evaluateEvidenceGate`
  - `openclaw_runtime/src/agents/task-loop-self-check.ts`
  - `openclaw_runtime/src/agents/task-loop-context.ts`
- Contract dependency:
  - `lane-a-runtime-core-contracts` must provide `EvidenceRef` and related runtime-core contracts before implementation.
- Commands run:
  - `rtk rg -n "lane-a-runtime-core-contracts|RuntimeTaskEvent|ContextItem|ToolCallRequest|ToolCallResult|EvidenceRef|Checkpoint|runtime-core" . -S`
  - `rtk rg --files | rtk rg "(runtime-core|contracts|contract|handoff|lane-a|evidence|checkpoint)"`
  - `rtk rg -n "export type .*EvidenceRef|type .*EvidenceRef|interface .*EvidenceRef|EvidenceRef" openclaw_runtime shared src harness tests -S`
  - `rtk rg -n "runtime-evidence-verifier-shadow|evidence-verifier-shadow|lane-e-evidence" runtime-research harness tests openclaw_runtime -S`

## Findings

- No `lane-a-runtime-core-contracts` implementation was found in the workspace.
- Existing evidence-ref types are local and fragmented: `TaskLoopEvidenceRef`, `LongConversationEvidenceRef`, `LongTaskEvidenceRef`, `TaskLedgerEvidenceRef`, `MissionEvidenceRef`, and `ClawGraphEvidenceRef`.
- Because `EvidenceRef` must come from lane-a, this lane must not add `task-loop-evidence-verifier.ts`, `runtime-core-contracts.ts`, or any parallel type file.
- The safe adapter seam is still the existing task-loop collection point:
  - `record.subagentEvidence = await collectSubagentEvidence(...)`
  - `record.evidenceGate = evaluateEvidenceGate(...)`
  - `record.evidenceRefs = evidenceFromResult(...)`
- The shadow report must be warning-only and must not feed into `gateTaskLoopSelfCheckCompletion`, `applyEvidenceGateToSelfCheck`, final branch selection, repair iteration counting, checkpoint `reviewNeededItems`, or mission completion.

## Adapter Draft

Once lane-a lands, the smallest implementation should add a local adapter around current data and import lane-a `EvidenceRef`.

Inputs:

- `record.evidenceGate.filesTouched`
- `record.evidenceGate.testsRun`
- `record.evidenceRefs`
- `record.subagentEvidence`

Report placement:

- Optional `record.evidenceVerifierShadow` field only when `runtime.evidenceVerifier.shadow` is enabled.
- Optional iteration snapshot copy for observability/debugging.
- Optional lifecycle metadata only if host event contracts already allow an additive optional payload.
- No checkpoint decision fields should consume the shadow report in this lane.

Flag behavior:

- Flag off: no new field, no extra lifecycle payload, no changed checkpoint payload, no changed legacy status.
- Flag on: produce report only; legacy `pass | repair | blocked` and self-check decisions remain authoritative.

Reason mapping draft:

| Current source | Shadow reason to express | Notes |
|---|---|---|
| `testsRun.length === 0` while files were touched | missing tests | Warning only. Do not downgrade legacy complete. |
| `completionStatus === "failed"` or `spawnStatus === "error"` | worker failure | Include role name and failure reason when present. |
| `completionStatus === "permission_blocked"` or `spawnStatus === "forbidden"` | permission blocked | Do not decide blocked in shadow; mirror legacy reason only. |
| `completionStatus === "timeout"` or `spawnStatus === "timeout"` | timeout | Include role name and failure reason when present. |
| `completionStatus === "unverifiable"` or accepted worker without captured result | unverifiable | Mirrors current `unverifiable_result:<role>` gate reason. |
| Empty worker summary and no refs | unverifiable | Mirrors current empty worker evidence reason. |
| No worker evidence | missing evidence | Mirrors current `evidence_gap:no_worker_evidence`. |

Evidence adapter draft:

| Legacy input | Lane-a contract target |
|---|---|
| `filesTouched[]` | lane-a `EvidenceRef` file evidence |
| `testsRun[]` | lane-a `EvidenceRef` test evidence |
| `record.evidenceRefs[]` | lane-a `EvidenceRef` trace/subagent/tool evidence |
| `subagentEvidence[].evidenceRefs[]` | lane-a `EvidenceRef` subagent/tool/trace evidence |
| `subagentEvidence[].failureReason` | report reason metadata, not a new evidence type |

## Test Drafts

These are intentionally draft assertions, not checked-in tests, until lane-a contracts exist.

```ts
it('emits warning-only verifier report on complete flow when shadow flag is enabled', async () => {
  const result = await runTaskLoop(request, {
    agents: { defaults: { taskLoop: { runtime: { evidenceVerifier: { shadow: true } } } } },
  }, depsWithSuccessfulWorkers);

  expect(result.status).toBe('complete');
  expect(result.evidenceGate?.status).toBe('pass');
  expect(result.evidenceVerifierShadow).toMatchObject({
    mode: 'shadow',
    severity: 'warning',
  });
  expect(result.evidenceVerifierShadow.evidenceRefs).toEqual(expect.arrayContaining([
    expect.objectContaining({ /* imported lane-a EvidenceRef file evidence */ }),
    expect.objectContaining({ /* imported lane-a EvidenceRef test evidence */ }),
  ]));
});

it('emits warning-only verifier report on repair or blocked flow without changing legacy status', async () => {
  const result = await runTaskLoop(request, shadowConfig, depsWithWorkerFailure);

  expect(result.status).toBe('blocked');
  expect(result.evidenceGate?.status).toBe('blocked');
  expect(result.evidenceVerifierShadow.reasons).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: 'worker failure' }),
  ]));
});

it('keeps legacy status unchanged with shadow flag off', async () => {
  const baseline = await runTaskLoop(request, legacyConfig, deps);
  const flagOff = await runTaskLoop(request, flagOffConfig, deps);

  expect(flagOff.status).toBe(baseline.status);
  expect(flagOff.phase).toBe(baseline.phase);
  expect(flagOff.evidenceVerifierShadow).toBeUndefined();
});
```

## Implementation Guardrails

- Import `EvidenceRef` from lane-a only. Do not alias an existing local evidence type as the runtime-core contract.
- Keep the adapter local to task-loop until a shared verifier module can import the real lane-a contract.
- Do not alter `evaluateEvidenceGate` return values.
- Do not alter `applyEvidenceGateToSelfCheck`.
- Do not add verifier reasons to `record.remaining` or checkpoint review-needed items in the shadow slice.
- Do not update mission completion behavior in this lane.

## Recommended Next Slice After Lane A

```text
Slice:
Task-loop Evidence Verifier shadow report using lane-a EvidenceRef.

New code path:
Add a task-loop-local adapter that imports lane-a EvidenceRef and maps filesTouched/testsRun/evidenceRefs/subagentEvidence into a warning-only report.

Legacy path wrapped:
Generate the report immediately after evaluateEvidenceGate and evidenceFromResult, but never feed it back into legacy status decisions.

Feature flag:
runtime.evidenceVerifier.shadow

Tests:
Add focused task-loop unit coverage for complete, repair/blocked, and flag-off parity. Keep existing task-loop and mission tests passing.

Rollback:
Disable runtime.evidenceVerifier.shadow; no report is emitted and legacy task-loop behavior remains unchanged.

Done when:
Shadow report exists with lane-a EvidenceRef values, expresses missing tests / worker failure / permission / timeout / unverifiable reasons, and proves legacy status parity.
```

