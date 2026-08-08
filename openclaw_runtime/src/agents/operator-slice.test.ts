import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { ApprovalLedger } from './approval-ledger.js';
import { EffectReceiptStore } from './effect-receipt.js';
import { ReceiptStore } from './receipt-store.js';
import {
  OPERATOR_DEFAULT_POLICY_RULE,
  createOperatorSliceIntent,
  executeOperatorSliceEffect,
  projectOperatorLineage,
  recoverOperatorSlice,
  resolveOperatorGovernancePolicy,
  resolveOperatorSliceApproval,
  runOperatorSlice,
} from './operator-slice.js';

const tempRoots: string[] = [];
let stateDir = '';
let effectRoot = '';

function databaseOptions() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

function options(enabled = true) {
  return { enabled, database: databaseOptions(), effectRootDir: effectRoot } as const;
}

function identity(overrides = {}) {
  return {
    sessionKey: 'sess-op-1',
    runId: 'run-op-1',
    traceId: 'trace-op-1',
    cronJobId: 'cron-1',
    inboxItemId: 'inbox-1',
    ...overrides,
  };
}

function approvedGovernance(actor = 'operator-1') {
  return resolveOperatorGovernancePolicy({
    policyRule: OPERATOR_DEFAULT_POLICY_RULE,
    decision: 'approved',
    actor,
  });
}

function deniedGovernance(actor = 'operator-1') {
  return resolveOperatorGovernancePolicy({ policyRule: 'deny-all', decision: 'denied', actor });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc05-operator-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  effectRoot = path.join(root, 'effects');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(effectRoot, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RC-05 operator governance slice', () => {
  it('runs the primary path: approval -> bounded file effect -> EffectReceipt -> delivery projection', () => {
    const result = runOperatorSlice({
      identity: identity(),
      effect: { kind: 'file', path: 'out/result.txt', content: 'cron result' },
      requestJson: { command: 'write result', source: 'cron' },
      governance: approvedGovernance(),
      options: options(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectReceiptId).toMatch(/^efx_/);
    expect(result.approvalId).toMatch(/^aprv_/);
    expect(result.state).toBe('reconciled');

    // The bounded file effect was applied exactly once.
    const target = path.join(effectRoot, 'out', 'result.txt');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toContain('cron result');

    // Delivery projection shows approval/effect/recovery lineage from real data.
    const projection = projectOperatorLineage({ identity: identity(), options: options() });
    expect(projection.recovery).toBe('recovered');
    // No fabricated `context:<sessionKey>` ref: without a real ContextReceipt
    // there is no context ref at all.
    expect(projection.lineage.some((l) => l === 'context:sess-op-1')).toBe(false);
    expect(projection.lineage.some((l) => l.startsWith('effect:'))).toBe(true);
  });

  it('a Cron ingress only creates the intent; approval comes from governance (actor + policy digest)', async () => {
    // Step 1: Cron ingress creates the intent; it never resolves inline.
    const intent = createOperatorSliceIntent({
      identity: identity({ runId: 'run-three-phase' }),
      requestJson: { command: 'announce' },
      options: options(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    const ledger = new ApprovalLedger(databaseOptions());
    expect(ledger.getById(intent.approvalId)?.state).toBe('approval_pending');
    expect(ledger.getById(intent.approvalId)?.resolved_by).toBeNull();

    // Step 2: governance decision records actor + policy digest.
    const governance = resolveOperatorGovernancePolicy({
      policyRule: 'cron-announce-under-operator-slice',
      decision: 'approved',
      actor: 'inbox-operator-alice',
    });
    expect(governance.policyDigest).toMatch(/^[0-9a-f]{64}$/);
    const resolved = resolveOperatorSliceApproval({ approvalId: intent.approvalId, governance, options: options() });
    expect(resolved.ok).toBe(true);
    expect(ledger.getById(intent.approvalId)?.state).toBe('approved');
    expect(ledger.getById(intent.approvalId)?.resolved_by).toBe('inbox-operator-alice');

    // Step 3: execution with a real executor; the EffectReceipt proposal digest
    // binds the governance decision (actor + policy digest).
    const executed = await executeOperatorSliceEffect({
      identity: identity({ runId: 'run-three-phase' }),
      approvalId: intent.approvalId,
      effect: { kind: 'file', path: 'out/three.txt', content: 'x' },
      governance,
      options: options(),
      executor: async (effect, _id) => {
        if (effect.kind !== 'file') return { outcome: 'not_applied' };
        fs.mkdirSync(path.dirname(path.join(effectRoot, effect.path)), { recursive: true });
        fs.appendFileSync(path.join(effectRoot, effect.path), `${effect.content}\n`, 'utf8');
        return { outcome: 'applied', journalRef: `journal:three` };
      },
    });
    expect(executed.ok).toBe(true);
    expect(fs.existsSync(path.join(effectRoot, 'out', 'three.txt'))).toBe(true);
    const effects = new EffectReceiptStore(databaseOptions());
    const rows = effects.listByApproval(intent.approvalId);
    expect(rows).toHaveLength(1);
    expect(rows[0].approval_decision).toBe('approved');
    // The receipt proposal digest binds the governance decision (actor +
    // policyDigest): the digest recomputed from the same proposal matches the
    // persisted digest, proving the audit trail is verifiable.
    const { effectProposalDigest } = await import('./effect-receipt.js');
    const proposal = {
      effect: { kind: 'file', path: 'out/three.txt', content: 'x' },
      identity: identity({ runId: 'run-three-phase' }),
      governance,
    };
    expect(rows[0].proposal_digest).toBe(effectProposalDigest(proposal));
  });

  it('duplicate effect count is zero: a repeated identical turn is idempotent', () => {
    const first = runOperatorSlice({
      identity: identity(),
      effect: { kind: 'file', path: 'out/dup.txt', content: 'x' },
      requestJson: { command: 'write x' },
      governance: approvedGovernance(),
      options: options(),
    });
    expect(first.ok).toBe(true);

    // Second identical turn: the approval already resolved, the effect receipt
    // already exists -> no duplicate effect application.
    const second = runOperatorSlice({
      identity: identity(),
      effect: { kind: 'file', path: 'out/dup.txt', content: 'x' },
      requestJson: { command: 'write x' },
      governance: approvedGovernance(),
      options: options(),
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('duplicate');

    const target = path.join(effectRoot, 'out', 'dup.txt');
    const content = fs.readFileSync(target, 'utf8');
    // Exactly one line: no duplicate effect.
    expect(content.trim().split('\n')).toHaveLength(1);

    const effects = new EffectReceiptStore(databaseOptions());
    expect(effects.listByApproval(first.ok ? first.approvalId : '')).toHaveLength(1);
  });

  it('exactly one concurrent caller wins execution (duplicate execution_started is rejected)', async () => {
    const intent = createOperatorSliceIntent({
      identity: identity({ runId: 'run-concurrent' }),
      requestJson: { command: 'write once' },
      options: options(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    expect(
      resolveOperatorSliceApproval({
        approvalId: intent.approvalId,
        governance: approvedGovernance(),
        options: options(),
      }).ok,
    ).toBe(true);

    let executorCalls = 0;
    const run = () =>
      executeOperatorSliceEffect({
        identity: identity({ runId: 'run-concurrent' }),
        approvalId: intent.approvalId,
        effect: { kind: 'file', path: 'out/concurrent.txt', content: 'x' },
        governance: approvedGovernance(),
        options: options(),
        executor: async (effect, _id) => {
          executorCalls += 1;
          if (effect.kind !== 'file') return { outcome: 'not_applied' };
          fs.mkdirSync(path.join(effectRoot, 'out'), { recursive: true });
          fs.appendFileSync(path.join(effectRoot, effect.path), 'x\n', 'utf8');
          return { outcome: 'applied', journalRef: 'journal:concurrent' };
        },
      });
    const [first, second] = await Promise.all([run(), run()]);
    const winners = [first, second].filter((result) => result.ok === true);
    expect(winners).toHaveLength(1);
    expect([first, second].filter((result) => result.ok !== true).every((r) => r.reason === 'not-approved')).toBe(true);
    // The ledger granted exactly one execution_started: the executor ran once.
    expect(executorCalls).toBe(1);
  });

  it('rejects execution when the caller substitutes a different governance actor', async () => {
    const intent = createOperatorSliceIntent({
      identity: identity({ runId: 'run-governance-bind' }),
      requestJson: { command: 'write bound' },
      options: options(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    // Approved by alice through the governance policy.
    const alice = approvedGovernance('inbox-operator-alice');
    expect(
      resolveOperatorSliceApproval({ approvalId: intent.approvalId, governance: alice, options: options() }).ok,
    ).toBe(true);

    // The executor tries to run under a DIFFERENT governance identity (bob):
    // the ledger row carries resolved_by=alice, so the mismatch is rejected
    // before any effect runs.
    let executorCalls = 0;
    const executed = await executeOperatorSliceEffect({
      identity: identity({ runId: 'run-governance-bind' }),
      approvalId: intent.approvalId,
      effect: { kind: 'file', path: 'out/bound.txt', content: 'x' },
      governance: approvedGovernance('inbox-operator-bob'),
      options: options(),
      executor: async () => {
        executorCalls += 1;
        return { outcome: 'applied', journalRef: 'journal:bound' };
      },
    });
    expect(executed.ok).toBe(false);
    expect(executed.reason).toBe('governance-mismatch');
    expect(executorCalls).toBe(0);
    // The approval stays approved (no execution_started, no outcome).
    const ledger = new ApprovalLedger(databaseOptions());
    expect(ledger.getById(intent.approvalId)?.state).toBe('approved');
    expect(ledger.getById(intent.approvalId)?.resolved_by).toBe('inbox-operator-alice');
  });

  it('denial produces zero effect', () => {
    const denied = runOperatorSlice({
      identity: identity({ runId: 'run-denied' }),
      effect: { kind: 'file', path: 'out/denied.txt', content: 'should-not-exist' },
      requestJson: { command: 'write denied' },
      governance: deniedGovernance(),
      options: options(),
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('denied');
    expect(fs.existsSync(path.join(effectRoot, 'out', 'denied.txt'))).toBe(false);

    const effects = new EffectReceiptStore(databaseOptions());
    expect(effects.listByApproval(denied.ok ? denied.approvalId : '')).toHaveLength(0);
  });

  it('a message effect without a real executor is never applied', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-message-no-executor' }),
      effect: { kind: 'message', text: 'hello' },
      requestJson: { command: 'send message' },
      governance: approvedGovernance(),
      options: options(),
    });
    // No real executor -> no fake send -> not applied. The approval is resolved
    // but execution never started (no executor, no execution phase).
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-approved');
    const ledger = new ApprovalLedger(databaseOptions());
    const row = ledger.getByIdempotencyKey(`op:run-message-no-executor:sess-op-1`);
    expect(row?.state).toBe('approved');
    expect(row?.state).not.toBe('reconciled');
  });

  it('restart preserves pending/completed truth from RC-04', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-restart' }),
      effect: { kind: 'file', path: 'out/restart.txt', content: 'x' },
      requestJson: { command: 'write restart' },
      governance: approvedGovernance(),
      options: options(),
    });
    expect(result.ok).toBe(true);

    // A brand-new ledger over the same state dir sees the reconciled truth.
    const ledger = new ApprovalLedger(databaseOptions());
    const row = ledger.getById(result.ok ? result.approvalId : '');
    expect(row?.state).toBe('reconciled');

    // Recovery projection works after restart.
    const recovery = recoverOperatorSlice({ identity: identity({ runId: 'run-restart' }), options: options() });
    expect(recovery.recovery).toBe('recovered');
    expect(recovery.state).toBe('reconciled');
  });

  it('is a no-op when the feature flag is off', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-off' }),
      effect: { kind: 'file', path: 'out/off.txt', content: 'x' },
      requestJson: { command: 'x' },
      governance: approvedGovernance(),
      options: options(false),
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(effectRoot, 'out', 'off.txt'))).toBe(false);
  });

  it('a bounded file effect cannot escape the effect root', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-escape' }),
      effect: { kind: 'file', path: '../escape.txt', content: 'x' },
      requestJson: { command: 'escape' },
      governance: approvedGovernance(),
      options: options(),
    });
    // The effect application fails -> unknown outcome -> needs_reconciliation.
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(effectRoot, '..', 'escape.txt'))).toBe(false);
  });

  it('a symlink inside the effect root cannot redirect the write outside', async () => {
    // Skip on platforms without symlink support in temp dirs.
    const outsideDir = path.join(stateDir, '..', 'outside-effects');
    fs.mkdirSync(outsideDir, { recursive: true });
    try {
      fs.symlinkSync(outsideDir, path.join(effectRoot, 'escape-link'), 'dir');
    } catch {
      return; // symlinks unavailable (e.g. restricted Windows perms): skip.
    }

    const intent = createOperatorSliceIntent({
      identity: identity({ runId: 'run-symlink' }),
      requestJson: { command: 'escape via symlink' },
      options: options(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    const governance = approvedGovernance();
    expect(resolveOperatorSliceApproval({ approvalId: intent.approvalId, governance, options: options() }).ok).toBe(true);

    const executed = await executeOperatorSliceEffect({
      identity: identity({ runId: 'run-symlink' }),
      approvalId: intent.approvalId,
      effect: { kind: 'file', path: 'escape-link/pwn.txt', content: 'evil' },
      governance,
      options: options(),
      executor: async (effect, _id) => {
        if (effect.kind !== 'file') return { outcome: 'not_applied' };
        const { applyBoundedFileEffect } = await import('./operator-slice.js');
        try {
          return { outcome: 'applied', journalRef: applyBoundedFileEffect(effect, effectRoot) };
        } catch (err) {
          return { outcome: 'unknown', error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
    // The write was blocked: nothing landed outside the root.
    expect(fs.existsSync(path.join(outsideDir, 'pwn.txt'))).toBe(false);
    // The canonical path stays inside the root (realpath of the parent was
    // re-checked), so the effect is rejected as unknown, never applied.
    expect(executed.ok).toBe(false);
  });

  it('a symlink LEAF inside the root cannot redirect the write outside', async () => {
    const outsideFile = path.join(stateDir, '..', 'outside-leaf.txt');
    try {
      fs.writeFileSync(outsideFile, 'preexisting\n');
      fs.symlinkSync(outsideFile, path.join(effectRoot, 'leaf-link.txt'));
    } catch {
      return; // symlinks unavailable: skip.
    }

    const intent = createOperatorSliceIntent({
      identity: identity({ runId: 'run-symlink-leaf' }),
      requestJson: { command: 'escape via leaf symlink' },
      options: options(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    const governance = approvedGovernance();
    expect(
      resolveOperatorSliceApproval({ approvalId: intent.approvalId, governance, options: options() }).ok,
    ).toBe(true);

    const executed = await executeOperatorSliceEffect({
      identity: identity({ runId: 'run-symlink-leaf' }),
      approvalId: intent.approvalId,
      effect: { kind: 'file', path: 'leaf-link.txt', content: 'evil' },
      governance,
      options: options(),
      executor: async (effect, _id) => {
        if (effect.kind !== 'file') return { outcome: 'not_applied' };
        const { applyBoundedFileEffect } = await import('./operator-slice.js');
        try {
          return { outcome: 'applied', journalRef: applyBoundedFileEffect(effect, effectRoot) };
        } catch (err) {
          return { outcome: 'unknown', error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
    // The leaf symlink was rejected (lstat) BEFORE appending: the outside file
    // is untouched.
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('preexisting\n');
    expect(executed.ok).toBe(false);
  });

  it('lineage uses real ContextReceipt refs when receipts exist', () => {
    // Record a real context receipt for the run, then verify the projection
    // uses the real receipt id instead of a fabricated session ref.
    const receipts = new ReceiptStore(databaseOptions());
    const put = receipts.put({
      idempotencyKey: 'rcpt:sess-op-1:run-op-1:0:0:0:context',
      kind: 'context',
      version: '1',
      identity: {
        sessionKey: 'sess-op-1',
        runId: 'run-op-1',
        traceId: 'trace-op-1',
        providerId: 'provider-1',
        adapterId: 'adapter-1',
        transformIds: [],
        runtimeMode: 'source',
      },
      callIndex: { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      content: {
        logicalDigest: 'a'.repeat(64),
        wireDigest: 'b'.repeat(64),
        correlationDigest: 'c'.repeat(64),
        selected: [],
        omitted: [],
      },
    });
    expect(put.ok).toBe(true);

    const projection = projectOperatorLineage({ identity: identity(), options: options() });
    expect(projection.contextReceipts.length).toBeGreaterThanOrEqual(1);
    expect(projection.lineage.some((l) => l.startsWith('context:rcpt_'))).toBe(true);
    expect(projection.lineage.some((l) => l === 'context:sess-op-1')).toBe(false);
  });
});
