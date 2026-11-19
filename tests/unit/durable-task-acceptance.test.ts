// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from 'node:child_process';
import { beforeEach, afterEach, it, describe, expect, vi } from "vitest";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import {
  acceptPersistentTask,
  reconcilePersistentTaskEffect,
  readPersistentTaskCompletionReceipt,
} from "../../openclaw_runtime/src/agents/persistent-task-acceptance";
import { EffectReceiptStore } from "../../openclaw_runtime/src/agents/effect-receipt";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
const registry = vi.hoisted(() => ({ run: null as unknown }));
vi.mock("../../openclaw_runtime/src/agents/subagent-registry-read", () => ({
  getSubagentRunByRunId: () => registry.run,
}));

let root: string, store: TaskSystemStore;
const oldState = process.env.OPENCLAW_STATE_DIR;
const hash = createHash("sha256").update("verified artifact").digest("hex");
beforeEach(() => {
  registry.run = null;
  root = mkdtempSync(join(tmpdir(), "task-owner-acceptance-"));
  process.env.OPENCLAW_STATE_DIR = join(root, "state");
  store = new TaskSystemStore(resolveTaskDomain(root));
  writeFileSync(join(root, "artifact.txt"), "verified artifact");
});
afterEach(() => {
  store.close();
  closeOpenClawStateDatabase();
  if (oldState === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = oldState;
  rmSync(root, { recursive: true, force: true });
});

function task() {
  const created = store.create(
    {
      objective: "Deliver the accepted artifact",
      target: "artifact.txt",
      constraints: [],
      acceptance: [
        {
          id: "file",
          description: "Approved bytes",
          verification: { kind: "file-sha256", path: "artifact.txt", sha256: hash },
        },
        {
          id: "verified",
          description: "Verifier evaluates actual file evidence",
          verification: { kind: "owner-receipt", owner: "evidence-verifier", requires: ["file"] },
        },
      ],
    },
    "create",
  ).task;
  const c = store.claim(created.contract.taskNodeId, "parent", "generation", "claim").claim!;
  store.submit(c, "candidate");
  return c;
}

describe("existing verifier and effect owners", () => {
  it('preserves ordinary task resubmission and revision after a generic observer', () => {
    const c = task();
    store.prepareWriterDelegation(c, { delegationId: 'generic', childSessionKey: 'generic', childGeneration: 'generic-generation',
      childRunId: 'generic', childWorktree: root, mode: 'observer' });
    store.returnDelegatedWriter('generic', { runId: 'generic', endedAt: Date.now(), outcome: 'ok', parentGeneration: c.generation });
    expect(store.submit(c, 'ordinary-next').contract.state).toBe('review');
    const current = store.get(c.taskNodeId).contract;
    expect(store.revise(c.taskNodeId, current.revision, { ...current, objective: 'Revised ordinary task' }).contract.revision).toBe(2);
  });
  function reviewTask() {
    const t = store.create({ objective: 'Deliver the reviewed candidate', target: 'artifact.txt', constraints: [], maxRepairAttempts: 1,
      acceptance: [{ id: 'review', description: 'Independent review', verification: {
        kind: 'owner-receipt', owner: 'subagent-verifier', files: ['artifact.txt'],
      } }] }, 'review-task').task;
    const c = store.claim(t.contract.taskNodeId, 'parent', 'generation', 'review-claim').claim!;
    store.submit(c, 'candidate');
    return c;
  }
  function reviewer(c: ReturnType<typeof reviewTask>, id = 'review-run', complete = true) {
    store.prepareWriterDelegation(c, { delegationId: id, childSessionKey: id, childGeneration: `${id}-generation`,
      childRunId: id, childWorktree: root, mode: 'observer', verifier: true });
    for (const artifact of store.delegationForChild(id)!.candidateArtifacts ?? []) {
      const content = [{ type: 'text', text: readFileSync(artifact.path, 'utf8') }];
      store.recordReviewRead(id, `${id}-generation`, `read:${artifact.path}`,
        { content, details: {
          reviewReads: [{ ...artifact, kind: 'text', start: 1, end: 1, lines: 1 }],
        } });
      store.confirmReviewerPrompt(id, `${id}-generation`, [{ role: 'toolResult', toolCallId: `read:${artifact.path}`, content }]);
    }
    if (complete) store.returnDelegatedWriter(id, { runId: id, endedAt: Date.now(), outcome: 'ok', parentGeneration: c.generation });
    registry.run = { runId: id, childSessionKey: id, requesterSessionKey: c.sessionKey, requesterSessionId: c.generation,
      endedAt: Date.now(), outcome: { status: 'ok' }, orchestration: { isVerifier: true, verificationVerdict: 'pass' } };
  }
  it('binds a review to the submitted candidate even when the files are identical', () => {
    const c = reviewTask(); reviewer(c);
    const first = store.submission(c);
    store.submit(c, 'candidate');
    expect(store.submission(c).sequence).toBe(first.sequence);
    expect(() => store.submit(c, 'new-candidate')).toThrow('TASK_REPAIR_REQUIRED');
    store.repair(c, 'candidate', 'new-review-cycle', 'Recheck this candidate');
    store.submit(c, 'new-candidate');
    expect(() => acceptPersistentTask(store, c, 'new-candidate')).toThrow('VERIFIER_SUBMISSION_CHANGED');
    expect(store.get(c.taskNodeId).contract.state).toBe('review');
  });
  it('does not fall back to an old pass while a new reviewer is pending', () => {
    const c = reviewTask(); reviewer(c);
    store.repair(c, 'candidate', 'second-cycle', 'Address review'); store.submit(c, 'candidate');
    reviewer(c, 'second-review', false);
    expect(() => acceptPersistentTask(store, c, 'candidate')).toThrow('VERIFIER_RUN_PENDING');
  });
  it('rejects a pass without candidate reads and accepts only complete matching read ranges', () => {
    const c = reviewTask();
    store.prepareWriterDelegation(c, { delegationId: 'unread', childSessionKey: 'unread', childGeneration: 'unread-g',
      childRunId: 'unread', childWorktree: root, mode: 'observer', verifier: true });
    const delegation = store.delegationForChild('unread')!;
    expect(() => store.assertReviewerReadCandidate(delegation)).toThrow('TASK_VERIFIER_READ_REQUIRED');
    const input = { content: [{ type: 'text', text: 'verified artifact' }], details: { reviewReads: [{
      ...delegation.candidateArtifacts![0], kind: 'text', start: 1, end: 1, lines: 1,
    }] } };
    store.recordReviewRead('unread', 'unread-g', 'bad-read', { ...input, isError: true });
    expect(() => store.assertReviewerReadCandidate(delegation)).toThrow('TASK_VERIFIER_READ_REQUIRED');
    store.recordReviewRead('unread', 'unread-g', 'read', input);
    store.confirmReviewerPrompt('unread', 'unread-g', [{ role: 'toolResult', toolCallId: 'read', content: input.content }]);
    expect(() => store.assertReviewerReadCandidate(delegation)).not.toThrow();
  });
  it('rejects another generic observer for the same submitted candidate', () => {
    const c = reviewTask(); reviewer(c);
    expect(() => reviewer(c, 'rerolled-review')).toThrow('TASK_REVIEW_ALREADY_DISPATCHED');
    expect(store.getTaskEvidence(c.taskNodeId)).toHaveLength(0);
    expect(() => store.reserveReview(c, 'candidate', 'explicit-after-generic')).toThrow('TASK_REVIEW_ALREADY_DISPATCHED');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'review_reserved')).toHaveLength(0);
    expect(store.repair(c, 'candidate', 'valid-repair', 'Fix findings').contract.state).toBe('doing');
  });
  it('requires an explicit repair budget when creating an independent review contract', () => {
    expect(() => store.create({ objective: 'Unbounded review', target: 'artifact.txt', constraints: [], acceptance: [{
      id: 'review', description: 'Review', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: ['artifact.txt'] },
    }] }, 'missing-budget')).toThrow('TASK_REPAIR_BUDGET_REQUIRED');
  });
  it.each([undefined, []])('rejects an independent review contract without input files: %j', files => {
    expect(() => store.create({ objective: 'Incomplete review', target: 'artifact.txt', constraints: [], maxRepairAttempts: 1,
      acceptance: [{ id: 'review', description: 'Review', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files } }],
    }, 'missing-files')).toThrow('TASK_VERIFIER_INPUTS_REQUIRED');
  });
  it('keeps the original failing check and scope after entering repair', () => {
    const t = store.create({ objective: 'Review with mandatory check', target: 'artifact.txt', constraints: ['keep scope'], maxRepairAttempts: 1,
      acceptance: [
        { id: 'test', description: 'Original required check', verification: { kind: 'tool-result', tool: 'exec', command: 'node check.cjs', files: ['artifact.txt'], exitCode: 0 } },
        { id: 'review', description: 'Review', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: ['artifact.txt'] } },
      ],
    }, 'original-check').task;
    const c = store.claim(t.contract.taskNodeId, 'parent', 'generation', 'check-claim').claim!;
    store.submit(c, 'candidate'); reviewer(c); store.repair(c, 'candidate', 'repair', 'check failed');
    const contract = store.get(c.taskNodeId).contract;
    expect(() => store.revise(c.taskNodeId, 1, { ...contract, acceptance: contract.acceptance.filter(v => v.id !== 'test') })).toThrow('TASK_REVIEW_CRITERION_IMMUTABLE');
    expect(() => store.revise(c.taskNodeId, 1, { ...contract, constraints: [] })).toThrow('TASK_REPAIR_SCOPE_IMMUTABLE');
  });
  it('rejects a verifier receipt from an earlier repaired submission even after acceptance', () => {
    const t = store.create({ objective: 'Retain completion identity', target: 'artifact.txt', constraints: [], maxRepairAttempts: 1,
      acceptance: [
        { id: 'file', description: 'File bytes', verification: { kind: 'file-sha256', path: 'artifact.txt', sha256: hash } },
        { id: 'review', description: 'Review', verification: { kind: 'owner-receipt', owner: 'subagent-verifier', files: ['artifact.txt'] } },
      ],
    }, 'old-receipt').task;
    const c = store.claim(t.contract.taskNodeId, 'parent', 'generation', 'old-receipt-claim').claim!;
    store.submit(c, 'candidate'); reviewer(c);
    expect(() => acceptPersistentTask(store, c, 'candidate')).toThrow('TASK_EVIDENCE_MISSING');
    const old = store.getTaskEvidence(c.taskNodeId).find(e => e.ownerProof)!;
    store.repair(c, 'candidate', 'repair', 'Missing check'); store.verifyFile(c, 'file', 'artifact.txt', hash, 'candidate');
    store.submit(c, 'candidate'); reviewer(c, 'new-receipt-review'); acceptPersistentTask(store, c, 'candidate');
    const current = store.getTaskEvidence(c.taskNodeId).filter(e => e.ownerProof).at(-1)!;
    const read = (receipt: typeof old) => readPersistentTaskCompletionReceipt(store, { taskId: c.taskNodeId, candidateDigest: 'candidate', generation: c.generation,
      verifierReceiptId: receipt.receiptId, effectReceiptId: receipt.ownerProof!.effectReceiptId });
    expect(() => read(old)).toThrow('TASK_COMPLETION_RECEIPT_SUBMISSION_MISMATCH');
    expect(read(current).taskId).toBe(c.taskNodeId);
  });
  it.each(['missing', 'error'])('recovers a %s dispatch response from the terminal reservation-bound reviewer', response => {
    const c = reviewTask(); const reservation = store.reserveReview(c, 'candidate', 'lost-response');
    store.prepareWriterDelegation(c, { delegationId: 'recovered-review', childSessionKey: 'recovered-review', childGeneration: 'review-g',
      childRunId: 'recovered-review', childWorktree: root, mode: 'observer', verifier: true, reviewReservationId: reservation.id });
    if (response === 'error') store.recordReviewDispatch(c, reservation, { status: 'error', error: 'transport response lost', childSessionKey: 'recovered-review' });
    store.returnDelegatedWriter('recovered-review', { runId: 'recovered-review', endedAt: Date.now(), outcome: 'ok', parentGeneration: c.generation });
    store.close(); store = new TaskSystemStore(resolveTaskDomain(root));
    expect(store.reserveReview(c, 'candidate', 'lost-response')).toMatchObject({ replayed: true, result: { runId: 'recovered-review' } });
    expect(store.repair(c, 'candidate', 'repair', 'Reviewer requested repair').contract.state).toBe('doing');
    expect(store.history(c.taskNodeId).filter(e => e.kind === 'review_reserved')).toHaveLength(1);
  });
  it.each(['remove', 'replace-files'])('preserves the independent review requirement during a repair revision: %s', mode => {
    const c = reviewTask(); reviewer(c); store.repair(c, 'candidate', 'repair', 'Fix findings');
    const original = store.get(c.taskNodeId).contract;
    const acceptance = mode === 'remove'
      ? [{ id: 'file', description: 'File only', verification: { kind: 'file-sha256' as const, path: 'artifact.txt', sha256: hash } }]
      : [{ id: 'review', description: 'Independent review', verification: { kind: 'owner-receipt' as const, owner: 'subagent-verifier', files: ['other.txt'] } }];
    expect(() => store.revise(c.taskNodeId, original.revision, { ...original, acceptance })).toThrow('TASK_REVIEW_CRITERION_IMMUTABLE');
    expect(store.get(c.taskNodeId).contract.acceptance).toEqual(original.acceptance);
  });
  it('keeps the new submitted reviewer selected when an older completion replays late', () => {
    const c = reviewTask(); reviewer(c, 'old-review');
    store.repair(c, 'candidate', 'new-cycle', 'Address review findings');
    store.submit(c, 'next'); reviewer(c, 'new-review');
    store.returnDelegatedWriter('old-review', { runId: 'old-review', endedAt: Date.now(), outcome: 'ok', parentGeneration: c.generation });
    expect(acceptPersistentTask(store, c, 'next').contract.state).toBe('done');
  });
  it('cannot reroll a zero-budget review through candidate renaming, revision or handoff', () => {
    const t = store.create({ objective: 'One review', target: 'artifact.txt', constraints: [], maxRepairAttempts: 0,
      acceptance: [{ id: 'review', description: 'Review', verification: {
        kind: 'owner-receipt', owner: 'subagent-verifier', files: ['artifact.txt'],
      } }] }, 'no-repair').task;
    const c = store.claim(t.contract.taskNodeId, 'parent', 'generation', 'no-repair-claim').claim!;
    store.submit(c, 'candidate'); reviewer(c);
    expect(() => store.submit(c, 'reroll')).toThrow('TASK_REPAIR_REQUIRED');
    expect(() => store.revise(c.taskNodeId, 1, t.contract)).toThrow('TASK_REPAIR_REQUIRED');
    expect(() => store.handoff(c, 'successor', 'new-generation')).toThrow('TASK_REVIEW_CLOSEOUT_REQUIRED');
    expect(() => store.control(c, 'pause')).toThrow('TASK_REVIEW_CLOSEOUT_REQUIRED');
    expect(acceptPersistentTask(store, c, 'candidate').contract.state).toBe('done');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'submitted')).toHaveLength(1);
  });
  it.each(['handoff', 'pause-resume'])('allows a current successor to consume the retained review budget after %s', mode => {
    const c = reviewTask(); reviewer(c);
    const previous = mode === 'pause-resume' ? store.control(c, 'pause').claim! : c;
    const next = store.handoff(previous, 'successor', 'next-generation').claim!;
    expect(() => store.submit(next, 'unbudgeted')).toThrow('TASK_REPAIR_REQUIRED');
    expect(() => store.repair(c, 'candidate', 'old-owner', 'repair')).toThrow('TASK_STALE_OWNER');
    expect(store.repair(next, 'candidate', 'successor-repair', 'Address review findings').contract.state).toBe('doing');
    store.submit(next, 'repaired'); reviewer(next, 'successor-review');
    expect(acceptPersistentTask(store, next, 'repaired').contract.state).toBe('done');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'repair_started')).toHaveLength(1);
  });
  it.each(['accept', 'recover'])('preserves review provenance after an idle zero-budget lease expires via %s', action => {
    let now = Date.now(); store.close(); store = new TaskSystemStore(resolveTaskDomain(root), () => now);
    const t = store.create({ objective: 'Long independent review', target: 'artifact.txt', constraints: [], maxRepairAttempts: 0,
      acceptance: [{ id: 'review', description: 'Review', verification: {
        kind: 'owner-receipt', owner: 'subagent-verifier', files: ['artifact.txt'],
      } }] }, 'long-review').task;
    const c = store.claim(t.contract.taskNodeId, 'parent', 'generation', 'long-claim').claim!;
    store.submit(c, 'candidate'); reviewer(c);
    const sequence = store.submission(c).sequence;
    now += 120_001;
    expect(store.get(c.taskNodeId).claim?.state).toBe('recovery_required');
    if (action === 'recover') expect(store.recover(c.taskNodeId, c.sessionKey, c.generation, root).claim?.epoch).toBe(c.epoch);
    expect(acceptPersistentTask(store, c, 'candidate').contract.state).toBe('done');
    const events = store.history(c.taskNodeId);
    expect(events.filter(event => event.kind === 'review_lease_restored')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'submitted').at(-1)?.seq).toBe(sequence);
    expect(events.filter(event => event.kind === 'repair_started')).toHaveLength(0);
  });
  it('does not restore a review lease while its old run is still registered', () => {
    let now = Date.now(); store.close(); store = new TaskSystemStore(resolveTaskDomain(root), () => now);
    const c = reviewTask(); store.beginRun(c, 'old-run'); now += 120_001;
    expect(() => store.assertOwner(c)).toThrow('TASK_REVIEW_RECOVERY_NOT_IDLE');
    expect(() => store.assertOwner({ ...c, generation: 'replacement' })).toThrow('TASK_STALE_OWNER');
    store.endRun(c, 'old-run');
    expect(store.assertOwner(c).claim?.epoch).toBe(c.epoch);
  });
  it('reconciles the exited process of an interrupted review without changing candidate provenance', () => {
    let now = Date.now(); store.close(); store = new TaskSystemStore(resolveTaskDomain(root), () => now);
    const c = reviewTask(); reviewer(c); store.beginRun(c, 'exited-review-run');
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
    expect(exited.status).toBe(0); expect(exited.pid).toBeGreaterThan(0);
    store.db.prepare('UPDATE task_active_runs SET owner_pid=? WHERE task_id=?').run(exited.pid, c.taskNodeId);
    now += 120_001;
    expect(store.recover(c.taskNodeId, c.sessionKey, c.generation, root).claim?.epoch).toBe(c.epoch);
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'interrupted_review_run_reconciled')).toHaveLength(1);
    expect(acceptPersistentTask(store, c, 'candidate').contract.state).toBe('done');
  });
  it('replays repair after lease renewal using only stable writer identity', () => {
    let now = Date.now(); store.close(); store = new TaskSystemStore(resolveTaskDomain(root), () => now);
    const c = reviewTask(); store.repair(c, 'candidate', 'repair-once', 'Fix'); now += 1000;
    const renewed = store.control(c, 'renew').claim!;
    expect(renewed.expiresAt).not.toBe(c.expiresAt);
    expect(store.repair(renewed, 'candidate', 'repair-once', 'Fix').contract.state).toBe('doing');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'repair_started')).toHaveLength(1);
  });
  it.each(['wrong-run', 'wrong-generation', 'implementer'])('rejects %s verifier provenance', mismatch => {
    const c = reviewTask(); reviewer(c);
    registry.run = { ...(registry.run as object), ...(mismatch === 'wrong-run' ? { runId: 'other' }
      : mismatch === 'wrong-generation' ? { requesterSessionId: 'old' } : { childSessionKey: 'parent' }) };
    expect(() => acceptPersistentTask(store, c, 'candidate')).toThrow('VERIFIER_RUN_INVALID');
  });
  it('rejects a candidate changed before reviewer dispatch as well as missing files', () => {
    const c = reviewTask(); writeFileSync(join(root, 'artifact.txt'), 'new bytes'); reviewer(c);
    expect(() => acceptPersistentTask(store, c, 'candidate')).toThrow('VERIFIER_CANDIDATE_CHANGED');
    rmSync(join(root, 'artifact.txt'));
    expect(() => acceptPersistentTask(store, c, 'candidate')).toThrow();
    expect(store.get(c.taskNodeId).contract.state).toBe('review');
  });
  it('allows observer dispatch during review while retaining the writer fence', () => {
    const c = reviewTask();
    store.beginOperation(c, 'dispatch-review', 'team_orchestrate');
    reviewer(c);
    expect(() => store.prepareWriterDelegation(c, { delegationId: 'writer', childSessionKey: 'writer',
      childGeneration: 'writer-g', childRunId: 'writer', childWorktree: root, mode: 'writer' })).toThrow('REPAIR_REQUIRED');
    expect(() => store.beginOperation(c, 'write', 'write')).toThrow('EXECUTION_NOT_RUNNING');
    store.finishOperation(c, 'dispatch-review', 'completed', 'observer started');
    expect(acceptPersistentTask(store, c, 'candidate').contract.state).toBe('done');
  });
  it('persists a single repair across restart and invalidates checks even for unchanged files', () => {
    const contract = { objective: 'Repair a checked artifact', target: 'artifact.txt', constraints: [], maxRepairAttempts: 1,
      acceptance: [{ id: 'file', description: 'Approved bytes', verification: { kind: 'file-sha256' as const, path: 'artifact.txt', sha256: hash } }] };
    const t = store.create(contract, 'repair-task').task;
    const c = store.claim(t.contract.taskNodeId, 'parent', 'generation', 'repair-claim').claim!;
    store.verifyFile(c, 'file', 'artifact.txt', hash, 'candidate'); store.submit(c, 'candidate');
    expect(store.repair(c, 'candidate', 'repair-1', 'The integrated check failed').contract.state).toBe('doing');
    store.close(); store = new TaskSystemStore(resolveTaskDomain(root));
    expect(store.repair(c, 'candidate', 'repair-1', 'The integrated check failed').contract.state).toBe('doing');
    store.submit(c, 'candidate');
    expect(() => store.accept(c, 'candidate')).toThrow('EVIDENCE_MISSING');
    expect(() => store.repair(c, 'candidate', 'repair-2', 'Try again')).toThrow('REPAIR_BUDGET_EXHAUSTED');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'repair_started')).toHaveLength(1);
    store.verifyFile(c, 'file', 'artifact.txt', hash, 'candidate');
    expect(store.accept(c, 'candidate').contract.state).toBe('done');
    expect(store.replayCompletedTask(c.taskNodeId, c.sessionKey, c.generation, 'candidate').contract.state).toBe('done');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'accepted')).toHaveLength(1);
  });
  it('retains review admission and refuses an unknown dispatch retry after reopening', () => {
    const c = reviewTask();
    const first = store.reserveReview(c, 'candidate', 'review-1');
    expect(first.replayed).toBe(false);
    store.close(); store = new TaskSystemStore(resolveTaskDomain(root));
    expect(() => store.reserveReview(c, 'candidate', 'review-1')).toThrow('REVIEW_DISPATCH_UNKNOWN');
    expect(() => store.reserveReview(c, 'candidate', 'review-2')).toThrow();
    expect(() => store.repair(c, 'candidate', 'unknown-repair', 'dispatch unknown')).toThrow('REVIEW_DISPATCH_UNKNOWN');
    expect(() => store.submit(c, 'another')).toThrow('REVIEW_DISPATCH_UNKNOWN');
    store.recordReviewDispatch(c, first, { status: 'accepted', runId: 'reviewer' });
    expect(store.reserveReview(c, 'candidate', 'review-1')).toMatchObject({ replayed: true, result: { runId: 'reviewer' } });
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'review_reserved')).toHaveLength(1);
  });
  it('does not bypass the repair budget by resuming or removing it from the contract', () => {
    const c = reviewTask();
    const original = store.get(c.taskNodeId).contract;
    expect(() => store.revise(c.taskNodeId, original.revision, { ...original, maxRepairAttempts: undefined })).toThrow('REPAIR_BUDGET_REQUIRED');
    expect(() => store.revise(c.taskNodeId, original.revision, { ...original, maxRepairAttempts: 0 })).toThrow('REPAIR_BUDGET_IMMUTABLE');
    const resumed = store.handoff(c, c.sessionKey, c.generation).claim!;
    expect(() => store.beginOperation(resumed, 'bypass', 'write')).toThrow('REPAIR_REQUIRED');
    expect(() => store.prepareWriterDelegation(resumed, { delegationId: 'bypass-worker', childSessionKey: 'bypass-worker',
      childGeneration: 'child-g', childRunId: 'bypass-worker', childWorktree: root, mode: 'writer' })).toThrow('REPAIR_REQUIRED');
    store.submit(resumed, 'candidate');
    store.repair(resumed, 'candidate', 'repair-after-handoff', 'Failed check');
    store.submit(resumed, 'next');
    expect(() => store.handoff(resumed, 'successor', 'next-generation')).toThrow('TASK_REVIEW_CLOSEOUT_REQUIRED');
    expect(() => store.repair(resumed, 'next', 'extra-repair', 'Second failure')).toThrow('REPAIR_BUDGET_EXHAUSTED');
  });
  it.each([undefined, 'allocated-but-never-dispatched'])('retries a known dispatch refusal without spending a repair: %s', childSessionKey => {
    const c = reviewTask();
    const first = store.reserveReview(c, 'candidate', 'first');
    store.recordReviewDispatch(c, first, { status: 'forbidden', error: 'capacity', childSessionKey });
    expect(store.reserveReview(c, 'candidate', 'first')).toMatchObject({ replayed: true, result: { status: 'forbidden' } });
    const second = store.reserveReview(c, 'candidate', 'second');
    expect(second.replayed).toBe(false);
    store.recordReviewDispatch(c, second, { status: 'accepted', runId: 'review-run', childSessionKey: 'reviewer' });
    expect(() => store.reserveReview(c, 'candidate', 'third')).toThrow('TASK_REVIEW_ALREADY_DISPATCHED');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'repair_started')).toHaveLength(0);
  });
  it.each([{}, { runId: 'unconfirmed', childSessionKey: 'unconfirmed-child' }])('keeps an error dispatch fenced across a renamed candidate: %j', identity => {
    const c = reviewTask(); const reservation = store.reserveReview(c, 'candidate', 'first');
    store.recordReviewDispatch(c, reservation, { status: 'error', error: 'response lost', ...identity });
    expect(() => store.submit(c, 'renamed-candidate')).toThrow('TASK_REVIEW_DISPATCH_UNKNOWN');
    expect(() => store.repair(c, 'candidate', 'retry-repair', 'try again')).toThrow('TASK_REVIEW_DISPATCH_UNKNOWN');
    expect(() => store.reserveReview(c, 'candidate', 'another-request')).toThrow('TASK_REVIEW_ALREADY_DISPATCHED');
  });
  it('only lets the reservation owner attach a reviewer and retains a late immutable refusal', () => {
    const c = reviewTask(); const reserved = store.reserveReview(c, 'candidate', 'first');
    expect(() => reviewer(c, 'foreign-observer')).toThrow('TASK_REVIEW_RESERVATION_REQUIRED');
    expect(() => store.handoff(c, 'next', 'g2')).toThrow('TASK_REVIEW_DISPATCH_UNKNOWN');
    expect(() => store.control(c, 'pause')).toThrow('TASK_REVIEW_DISPATCH_UNKNOWN');
    store.prepareWriterDelegation(c, { delegationId: 'owned-review', childSessionKey: 'owned-review', childGeneration: 'review-generation',
      childRunId: 'owned-review', childWorktree: root, mode: 'observer', verifier: true, reviewReservationId: reserved.id });
    expect(() => reviewer(c, 'second-observer')).toThrow('TASK_REVIEW_RESERVATION_REQUIRED');
    store.recordReviewDispatch(c, reserved, { status: 'accepted', runId: 'owned-review', childSessionKey: 'owned-review' });
    expect(() => store.recordReviewDispatch(c, reserved, { status: 'forbidden' })).toThrow('TASK_IDEMPOTENCY_CONFLICT');
    expect(() => store.handoff(c, 'next', 'g2')).toThrow('TASK_REVIEW_DISPATCH_UNKNOWN');
  });
  it('records a known refusal after cancellation without changing task state', () => {
    const c = reviewTask(); const reserved = store.reserveReview(c, 'candidate', 'first');
    store.control(c, 'cancel');
    const receipt = { status: 'forbidden', error: 'cancelled before spawn' };
    store.recordReviewDispatch(c, reserved, receipt);
    store.recordReviewDispatch(c, reserved, receipt);
    expect(store.get(c.taskNodeId).contract.state).toBe('cancelled');
    expect(store.history(c.taskNodeId).filter(event => event.kind === 'review_dispatched')).toHaveLength(1);
  });
  it('leaves the verifier slot free after a normal read-only observer', () => {
    const c = reviewTask();
    store.prepareWriterDelegation(c, { delegationId: 'reader', childSessionKey: 'reader', childGeneration: 'reader-generation',
      childRunId: 'reader', childWorktree: root, mode: 'observer', verifier: false });
    store.returnDelegatedWriter('reader', { runId: 'reader', endedAt: Date.now(), outcome: 'ok', parentGeneration: c.generation });
    reviewer(c, 'actual-reviewer');
    expect(acceptPersistentTask(store, c, 'candidate').contract.state).toBe('done');
  });
  it('permits a trusted pre-dispatch error to retry without relaxing an ambiguous error', () => {
    const c = reviewTask(); const reservation = store.reserveReview(c, 'candidate', 'prepare-failure');
    store.recordReviewDispatch(c, reservation, { status: 'error', dispatchOutcome: 'not-dispatched', error: 'context preparation failed', childSessionKey: 'provisional' });
    expect(store.reserveReview(c, 'candidate', 'retry-preparation').replayed).toBe(false);
  });
  it('reads an existing accepted receipt without submission metadata only for a single unambiguous submission', () => {
    const c = reviewTask(); reviewer(c); acceptPersistentTask(store, c, 'candidate');
    const receipt = store.getTaskEvidence(c.taskNodeId).find(e => e.ownerProof)!;
    delete receipt.submissionSequence; delete receipt.repairAttempt;
    store.db.prepare('UPDATE task_evidence SET json=? WHERE id=?').run(JSON.stringify(receipt), receipt.receiptId);
    expect(readPersistentTaskCompletionReceipt(store, { taskId: c.taskNodeId, candidateDigest: 'candidate', generation: c.generation,
      verifierReceiptId: receipt.receiptId, effectReceiptId: receipt.ownerProof!.effectReceiptId }).taskId).toBe(c.taskNodeId);
  });
  it("reconciles an unknown effect only from a matching terminal receipt owned by the runtime", () => {
    const t = store.create(
      {
        objective: "One external effect",
        target: ".",
        constraints: [],
        acceptance: [
          {
            id: "v",
            description: "verify",
            verification: { kind: "owner-receipt", owner: "fixture" },
          },
        ],
      },
      "external",
    ).task;
    const c = store.claim(t.contract.taskNodeId, "parent", "generation", "claim").claim!;
    store.beginOperation(c, "run:call", "browser");
    store.finishOperation(c, "run:call", "unknown", "connection lost");
    const effects = new EffectReceiptStore();
    const record = (id: string, outcome: "applied" | "unknown", sessionKey = "parent") =>
      effects.record({
        idempotencyKey: id,
        proposal: { operation: "browser click" },
        domainExecutor: "browser-owner",
        outcome,
        recoverability: "owner-readback",
        stage1Context: {
          actor: {
            sessionKey,
            runId: "run",
            attemptIndex: 1,
            modelCallIndex: 1,
            actorKind: "principal",
          },
          effect: { toolCallId: "call", toolName: "browser", resource: "page", action: "click" },
        },
      });
    const wrong = record("wrong", "applied", "other");
    expect(wrong.ok).toBe(true);
    expect(() =>
      reconcilePersistentTaskEffect(store, c, "run:call", wrong.effectReceiptId),
    ).toThrow("SCOPE_MISMATCH");
    const unknown = record("unknown", "unknown");
    expect(() =>
      reconcilePersistentTaskEffect(store, c, "run:call", unknown.effectReceiptId),
    ).toThrow("OUTCOME_UNKNOWN");
    const terminal = record("terminal", "applied");
    expect(
      reconcilePersistentTaskEffect(store, c, "run:call", terminal.effectReceiptId)
        .pendingOperations,
    ).toBe(0);
    const different = record("different", "applied");
    expect(() =>
      reconcilePersistentTaskEffect(store, c, "run:call", different.effectReceiptId),
    ).toThrow("RECEIPT_CONFLICT");
    expect(
      reconcilePersistentTaskEffect(store, c, "run:call", terminal.effectReceiptId)
        .pendingOperations,
    ).toBe(0);
  });
  it("requires an independent verifier run bound to the unchanged input snapshot", () => {
    const t = store.create(
      {
        objective: "Independent verification",
        maxRepairAttempts: 0,
        target: "artifact.txt",
        constraints: [],
        acceptance: [
          {
            id: "review",
            description: "Independent verifier approves this artifact",
            verification: {
              kind: "owner-receipt",
              owner: "subagent-verifier",
              files: ["artifact.txt"],
            },
          },
        ],
      },
      "create",
    ).task;
    const c = store.claim(t.contract.taskNodeId, "parent", "generation", "claim").claim!;
    store.submit(c, "candidate");
    store.prepareWriterDelegation(c, {
      delegationId: "review-run",
      childSessionKey: "reviewer",
      childGeneration: "review-generation",
      childRunId: "review-run",
      childWorktree: root,
      mode: "observer",
      verifier: true,
    });
    store.recordReviewRead('reviewer', 'review-generation', 'read', { content: [{ type: 'text', text: 'verified artifact' }],
      details: { reviewReads: [{ ...store.delegationForChild('reviewer')!.candidateArtifacts![0], kind: 'text', start: 1, end: 1, lines: 1 }] } });
    store.confirmReviewerPrompt('reviewer', 'review-generation', [{ role: 'toolResult', toolCallId: 'read', content: [{ type: 'text', text: 'verified artifact' }] }]);
    store.returnDelegatedWriter("reviewer", {
      runId: "review-run",
      endedAt: Date.now(),
      outcome: "ok",
      parentGeneration: "generation",
    });
    registry.run = {
      runId: "review-run",
      childSessionKey: "reviewer",
      requesterSessionKey: "parent",
      requesterSessionId: "generation",
      endedAt: Date.now(),
      outcome: { status: "ok" },
      orchestration: { isVerifier: true, verificationVerdict: "fail" },
    };
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("VERIFIER_NOT_APPROVED");
    registry.run = {
      ...(registry.run as object),
      orchestration: { isVerifier: true, verificationVerdict: "pass" },
    };
    writeFileSync(join(root, "artifact.txt"), "changed after verification");
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("VERIFIER_CANDIDATE_CHANGED");
    writeFileSync(join(root, "artifact.txt"), "verified artifact");
    expect(acceptPersistentTask(store, c, "candidate").contract.state).toBe("done");
  });
  it("reads actual evidence, records an existing effect receipt, and accepts only the current candidate", () => {
    const c = task();
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("EVIDENCE_MISSING");
    store.verifyFile(c, "file", "artifact.txt", hash, "candidate");
    const accepted = acceptPersistentTask(store, c, "candidate");
    expect(accepted.contract.state).toBe("done");
    const proof = store
      .getTaskEvidence(c.taskNodeId)
      .find((e) => e.criterionId === "verified")!.ownerProof!;
    const effects = new EffectReceiptStore();
    expect(effects.getById(proof.effectReceiptId)?.domain_executor).toBe(
      "task-verification-journal",
    );
    expect(effects.getById(proof.effectReceiptId)?.outcome).toBe("applied");
    expect(acceptPersistentTask(store, c, "candidate").contract.state).toBe("done");
    expect(() => acceptPersistentTask(store, c, "different")).toThrow("COMPLETION_REPLAY_MISMATCH");
  });
  it("rejects artifacts changed after the requirement was checked", () => {
    const c = task();
    store.verifyFile(c, "file", "artifact.txt", hash, "candidate");
    writeFileSync(join(root, "artifact.txt"), "changed");
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("EVIDENCE_STALE");
    expect(store.get(c.taskNodeId).contract.state).toBe("review");
  });
  it("does not accept caller-chosen unknown owners", () => {
    const t = store.create(
      {
        objective: "unknown owner",
        target: "artifact.txt",
        constraints: [],
        acceptance: [
          {
            id: "owner",
            description: "verify",
            verification: { kind: "owner-receipt", owner: "model-says-pass" },
          },
        ],
      },
      "create",
    ).task;
    const c = store.claim(t.contract.taskNodeId, "a", "g", "claim").claim!;
    store.submit(c, "candidate");
    expect(() => acceptPersistentTask(store, c, "candidate")).toThrow("OWNER_VERIFIER_UNAVAILABLE");
  });
  it("rejects new generations and unresolved operations before completing", () => {
    const c = task();
    store.verifyFile(c, "file", "artifact.txt", hash, "candidate");
    expect(() => acceptPersistentTask(store, { ...c, generation: "wrong" }, "candidate")).toThrow(
      "STALE_OWNER",
    );
    expect(store.get(c.taskNodeId).contract.state).toBe("review");
  });
});
