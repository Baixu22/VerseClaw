import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BASELINE_RELATIVE = 'artifacts/runtime-authority-convergence/rc-01/baseline.json';
const BASELINE_PATH = join(REPO_ROOT, 'artifacts', 'runtime-authority-convergence', 'rc-01', 'baseline.json');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }).trim();
}

const REQUIRED_MODULES = [
  'taskFlow',
  'taskRegistry',
  'longTaskCheckpoints',
  'runtimeTaskEventLog',
  'mission',
  'taskLoop',
  'clawgraph',
  'taskLedger',
  'runtimeSpine',
  'memorySlot',
  'contextEngineSlot',
  'mcp',
  'otel',
  'trajectory',
  'observabilityJsonl',
  'approval',
];

describe('RC-01 authority inventory baseline', () => {
  it('exists with the correct schema and a valid accepted base SHA', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(baseline.schema).toBe('runtime-authority-convergence-baseline/v1');
    expect(baseline.acceptedBaseSha).toMatch(/^[a-f0-9]{40}$/);
  });

  it('records source and npm runtime versions with correct capability split', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(baseline.sourceRuntimeVersion).toMatchObject({ runtimeMode: 'source' });
    expect(baseline.sourceRuntimeVersion.version).toMatch(/^\d{4}\.\d+\.\d+$/);
    expect(baseline.npmRuntimeVersion.satisfiesReceiptReadiness).toBe(false);
    expect(baseline.capabilitySplit.sourceIsSoleImplementationPath).toBe(true);
    expect(baseline.capabilitySplit.npmFallbackReportsDegraded).toBe(true);
  });

  it('classifies every writer with no unclassified entries', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const unclassified = [];
    for (const authority of Object.values(baseline.authorities)) {
      for (const list of ['writers', 'nonOwners', 'legacyWriters', 'candidates']) {
        for (const writer of (authority as any)[list] ?? []) {
          if (writer && typeof writer === 'object' && !writer.classification) unclassified.push(writer.path ?? JSON.stringify(writer).slice(0, 80));
        }
      }
    }
    expect(unclassified).toEqual([]);
  });

  it('covers every required authority module', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const patterns = {
      taskFlow: /task-flow-registry/,
      taskRegistry: /task-registry/,
      longTaskCheckpoints: /long-task-control\/store|long_task_checkpoints/,
      runtimeTaskEventLog: /event-log-persistence|runtime_task_event_log_records/,
      mission: /mission-control\/store|mission_runs/,
      taskLoop: /task-loop-controller/,
      clawgraph: /clawgraph\/runtime/,
      taskLedger: /task-ledger/,
      runtimeSpine: /runtime-spine/,
      memorySlot: /memory\/memory-store|plugins\/slots/,
      contextEngineSlot: /context-engine\/assembler|context_blocks/,
      mcp: /mcp\//,
      otel: /diagnostics-otel/,
      trajectory: /trajectory\/runtime|sekb\/trajectory/,
      observabilityJsonl: /observability/,
      approval: /exec-approval-manager/,
    };
    const found = new Set();
    for (const authority of Object.values(baseline.authorities)) {
      for (const list of ['writers', 'nonOwners', 'legacyWriters', 'candidates']) {
        for (const writer of (authority as any)[list] ?? []) {
          if (!writer?.path) continue;
          for (const [name, pattern] of Object.entries(patterns)) {
            if (pattern.test(writer.path)) found.add(name);
          }
        }
      }
    }
    for (const module of REQUIRED_MODULES) expect(found).toContain(module);
  });

  it('freezes runtime-family and runtime-spine and keeps product locks false', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(baseline.authorities.runtimeFamily.frozen).toBe(true);
    expect(baseline.authorities.runtimeSpine.frozen).toBe(true);
    expect(baseline.productLocks).toEqual({ liveReady: false, productApproved: false, defaultOn: false });
  });

  it('records the accepted receipt-owner decision (runtime_receipts via ReceiptStore)', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(baseline.receiptOwnerDecision.status).toBe('accepted');
    expect(baseline.receiptOwnerDecision.blocker).toBeNull();
    expect(baseline.receiptOwnerDecision.selectedOwner).toBe('OpenClaw shared state SQLite / runtime_receipts via ReceiptStore');
    expect(baseline.receiptOwnerDecision.logicalOwner).toBe('narrow ReceiptStore interface');
    expect(baseline.receiptOwnerDecision.physicalOwner).toBe('existing openclaw-state SQLite');
    expect(baseline.receiptOwnerDecision.tableName).toBe('runtime_receipts');

    const receipt = baseline.authorities.receipt;
    expect(receipt.decision).toBe('accepted');
    expect(receipt.tableName).toBe('runtime_receipts');
    expect(receipt.tableIsNewTypedAppendOnly).toBe(true);
    expect(receipt.hardConstraints).toHaveLength(7);
    // Constraint 2: content-sensitive idempotency.
    const constraint2 = receipt.hardConstraints.find((c: any) => /idempotency_key/i.test(c));
    expect(constraint2).toMatch(/identical content/);
    expect(constraint2).toMatch(/conflict/);
    // Constraint 5: shadow-write failure fails RC-02 but never changes send behavior.
    const constraint5 = receipt.hardConstraints.find((c: any) => /shadow write failure/i.test(c));
    expect(constraint5).toMatch(/fail RC-02/i);
    expect(constraint5).toMatch(/must not change send behavior/i);
    // Rejected owners recorded.
    expect(Object.keys(receipt.rejectedOwners)).toEqual(expect.arrayContaining([
      'long_task_checkpoints',
      'RuntimeTaskEventLog',
      'flow_runs',
      'mission_events',
      'channels/message/receipt.ts',
    ]));
    // RuntimeTaskEventLog stays diagnostic: default-off, prunable, no receipt/effect kind, role rejected.
    const runtimeEventLog = receipt.candidates.find((candidate: any) => candidate.path.includes('event-log-persistence'));
    expect(runtimeEventLog.role).toBe('rejected');
    expect(runtimeEventLog.defaultOff).toBe(true);
    expect(runtimeEventLog.prunable).toBe(true);
    expect(runtimeEventLog.hasReceiptEffectKind).toBe(false);
    // long_task_checkpoints rejected: mutable under the same idempotency key.
    const checkpointCandidate = receipt.candidates.find((candidate: any) => candidate.path.includes('long-task-control'));
    expect(checkpointCandidate.role).toBe('rejected');
    expect(checkpointCandidate.rejectionReason).toMatch(/mutable/i);
  });
});

// RC-01R: the audit found the baseline was never part of the candidate. These
// cases pin the four properties that made it non-self-contained.
describe('RC-01R self-contained baseline', () => {
  it('is tracked by Git so a clean clone of the candidate can read it', () => {
    expect(git(['ls-files', '--', BASELINE_RELATIVE])).toBe(BASELINE_RELATIVE);
  });

  it('keeps sibling convergence run outputs ignored', () => {
    const ignored = execFileSync('git', ['check-ignore', '--quiet', 'artifacts/runtime-authority-convergence/rc-07/manifest.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(ignored).toBe('');
  });

  it('reads identically from the Git index blob and the working tree', () => {
    const indexed = git(['show', `:${BASELINE_RELATIVE}`]);
    const onDisk = readFileSync(BASELINE_PATH, 'utf8');
    expect(JSON.parse(indexed)).toEqual(JSON.parse(onDisk));
  });

  it('derives generatedAt from the accepted base commit, not wall-clock time', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const commitEpochSeconds = Number(git(['show', '-s', '--format=%ct', baseline.acceptedBaseSha]));
    expect(baseline.generatedAt).toBe(new Date(commitEpochSeconds * 1000).toISOString());
  });

  it('records an acceptedBaseSha that is an ancestor of the candidate', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const head = git(['rev-parse', 'HEAD']);
    expect(() => git(['merge-base', '--is-ancestor', baseline.acceptedBaseSha, head])).not.toThrow();
  });

  it('names only owner paths that exist in the candidate tree', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const trackedFiles = git(['ls-files']).split('\n').filter(Boolean);
    const trackedSet = new Set(trackedFiles);
    const missing: string[] = [];
    for (const [authorityKey, authority] of Object.entries<Record<string, unknown>>(baseline.authorities)) {
      for (const list of ['writers', 'nonOwners', 'legacyWriters', 'candidates']) {
        for (const entry of ((authority as any)[list] as { path?: string }[] | undefined) ?? []) {
          if (!entry || typeof entry !== 'object' || !entry.path) continue;
          const ownerPath = entry.path;
          const prefix = ownerPath.endsWith('/**') ? ownerPath.slice(0, -2) : ownerPath.endsWith('/') ? ownerPath : null;
          const exists = prefix === null ? trackedSet.has(ownerPath) : trackedFiles.some((file) => file.startsWith(prefix));
          if (!exists) missing.push(`${authorityKey}.${list}: ${ownerPath}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

});
