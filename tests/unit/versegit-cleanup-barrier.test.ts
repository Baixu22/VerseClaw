import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createVerseGitCleanupBarrier,
  cleanupInventoryFromResources,
} from '../../shared/versegit-cleanup-barrier';
import type {
  VerseGitCleanupIdentity,
  VerseGitCleanupResource,
  VerseGitCleanupSealInput,
} from '../../shared/types/versegit';
import type {
  VerseGitBindingRecord,
  VerseGitRuntimeBindingPort,
} from '../../shared/versegit-runtime-contract';
import {
  __resetWorktreeRegistry,
  createWorktreeService,
} from '../../openclaw_runtime/src/agents/worktree-service';
import {
  clearVerseGitRuntimeBindingsForTest,
  registerVerseGitRuntimeBinding,
} from '../../openclaw_runtime/src/plugin-sdk/versegit-binding-registry';
import { runSubagentVerseGitCleanup } from '../../openclaw_runtime/src/agents/subagent-versegit-cleanup';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';
import { SUBAGENT_ENDED_REASON_COMPLETE } from '../../openclaw_runtime/src/agents/subagent-lifecycle-events';

const tempRoot = process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp';
const roots: string[] = [];
const originalCleanupRoot = process.env.CLAWX_VERSGIT_CLEANUP_ROOT;
const originalBindingEnabled = process.env.CLAWX_VERSGIT_BINDING_ENABLED;

const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const git = (cwd: string, args: string[]): string => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tempRoot, prefix));
  roots.push(root);
  return root;
}

function initRepo(): string {
  const root = makeRoot('versegit-f2-');
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, 'owned.txt'), 'base\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), '.openclaw/\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function identity(input: Partial<VerseGitCleanupIdentity> = {}): VerseGitCleanupIdentity {
  return {
    ownerId: 'agent:codex',
    epoch: 4,
    authorizationId: 'auth-f2',
    baseOid: 'a'.repeat(40),
    refsDigest: `sha256:${sha('refs')}`,
    ...input,
  };
}

function sealInput(overrides: Partial<VerseGitCleanupSealInput> = {}): VerseGitCleanupSealInput {
  const resource: VerseGitCleanupResource = {
    kind: 'manager', id: 'manager-f2', target: 'session-f2', owned: true, preserve: false,
  };
  return {
    runId: 'run-f2',
    sessionId: 'session-f2',
    bindingId: 'binding-f2',
    actor: 'codex',
    expected: identity(),
    current: identity(),
    references: [],
    evidenceDigests: [`sha256:${sha('evidence')}`],
    inventoryBefore: cleanupInventoryFromResources([resource]),
    resources: [resource],
    deletedKinds: ['manager'],
    stopAccepting: true,
    drain: { ok: true, issues: [] },
    ...overrides,
  };
}

function recordCompleteDelete(root: string, input = sealInput()) {
  const barrier = createVerseGitCleanupBarrier(root);
  const sealed = barrier.seal(input);
  if (!sealed.sealId) throw new Error('seal failed');
  barrier.markDetached({ runId: input.runId, sealId: sealed.sealId, current: input.current, vgDetached: true });
  return { barrier, sealed, completed: barrier.complete({
    runId: input.runId,
    sealId: sealed.sealId,
    inventoryAfter: { observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0, survivors: [] },
  }) };
}

function bindingIdentityFor(root: string): { baseOid: string; refsDigest: string; repoId: string; worktreeId: string } {
  const baseOid = git(root, ['rev-parse', 'HEAD']);
  let headRef = 'HEAD';
  try { headRef = git(root, ['symbolic-ref', '-q', 'HEAD']) || 'HEAD'; } catch { /* ignore */ }
  const normalized = root.replaceAll('\\', '/').toLowerCase();
  const repoId = sha(normalized + ':repo');
  const worktreeId = sha(normalized + ':worktree');
  return {
    baseOid,
    repoId,
    worktreeId,
    refsDigest: `sha256:${sha(`${repoId}\0${worktreeId}\0${headRef}\0${baseOid}`)}`,
  };
}

function makeBinding(input: {
  runId: string;
  worktreePath: string;
  baseOid: string;
  refsDigest: string;
  repoId: string;
  worktreeId: string;
}): VerseGitBindingRecord {
  return {
    schema: 'clawx.versegit.runtime-binding/v1',
    bindingId: `binding-${input.runId}`,
    authorizationId: `auth-${input.runId}`,
    baseOid: input.baseOid,
    refsDigest: input.refsDigest,
    requestId: `request-${input.runId}`,
    runId: `orchestration-${input.runId}`,
    traceId: `trace-${input.runId}`,
    repoId: input.repoId,
    worktreeId: input.worktreeId,
    worktreePath: input.worktreePath,
    agentSessionId: `agent-${input.runId}`,
    vgSessionId: `vg-${input.runId}`,
    ownerId: 'agent:codex',
    epoch: 4,
    mode: 'M1',
    phase: 'attached',
    createdAt: new Date(0).toISOString(),
    childSessionKey: `agent:child:${input.runId}`,
    childRunId: input.runId,
  };
}

function fakePort(): VerseGitRuntimeBindingPort & { ended: string[] } {
  const ended: string[] = [];
  return {
    ended,
    async bind() { throw new Error('unused'); },
    async attach() { throw new Error('unused'); },
    async end(request) { ended.push(request.reason); return { bindingId: request.bindingId, endedAt: new Date().toISOString(), reason: request.reason }; },
  };
}

function makeEntry(input: { runId: string; worktreeId: string; attachmentsDir?: string; transcriptFile?: string }): SubagentRunRecord {
  return {
    runId: input.runId,
    childSessionKey: `agent:child:${input.runId}`,
    requesterSessionKey: 'agent:main',
    requesterDisplayKey: 'main',
    task: 'cleanup barrier test',
    cleanup: 'delete',
    createdAt: 1,
    startedAt: 2,
    endedAt: 3,
    endedReason: SUBAGENT_ENDED_REASON_COMPLETE,
    outcome: { status: 'ok' },
    orchestration: {
      orchestrationRunId: `orchestration-${input.runId}`,
      roleName: 'worker',
      isVerifier: false,
      phase: 'worker',
      leadRole: 'lead',
      originalTask: 'cleanup barrier test',
      isolation: 'worktree',
      worktreeId: input.worktreeId,
      worktreeBackend: 'git',
    },
    completion: { required: true, resultText: 'done' },
    delivery: { status: 'delivered' },
    ...(input.attachmentsDir ? { attachmentsDir: input.attachmentsDir, attachmentsRootDir: input.attachmentsDir } : {}),
    execution: input.transcriptFile ? { status: 'terminal', transcriptFile: input.transcriptFile } : { status: 'terminal' },
  };
}

afterEach(() => {
  __resetWorktreeRegistry();
  clearVerseGitRuntimeBindingsForTest();
  if (originalCleanupRoot === undefined) delete process.env.CLAWX_VERSGIT_CLEANUP_ROOT;
  else process.env.CLAWX_VERSGIT_CLEANUP_ROOT = originalCleanupRoot;
  if (originalBindingEnabled === undefined) delete process.env.CLAWX_VERSGIT_BINDING_ENABLED;
  else process.env.CLAWX_VERSGIT_BINDING_ENABLED = originalBindingEnabled;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
});

describe('VerseGit cleanup barrier protocol', () => {
  it('seals, detaches, completes and rejects every identity drift before deletion', () => {
    const root = makeRoot('versegit-f2-barrier-');
    const driftCases: Array<[string, VerseGitCleanupIdentity]> = [
      ['ownerId', identity({ ownerId: 'agent:other' })],
      ['epoch', identity({ epoch: 3 })],
      ['authorizationId', identity({ authorizationId: 'auth-other' })],
      ['baseOid', identity({ baseOid: 'b'.repeat(40) })],
      ['refsDigest', identity({ refsDigest: `sha256:${sha('other-refs')}` })],
    ];
    for (const [name, current] of driftCases) {
      const input = sealInput({ runId: `run-${name}`, sessionId: `session-${name}`, bindingId: `binding-${name}` });
      const result = createVerseGitCleanupBarrier(root).seal({ ...input, current });
      expect(result.ok, name).toBe(false);
      expect(result.issues, name).toContain(`identity_mismatch:${name}`);
      expect(result.record?.status).toBe('rejected');
    }
    const { barrier, sealed, completed } = recordCompleteDelete(root, sealInput({ runId: 'run-valid', sessionId: 'session-valid', bindingId: 'binding-valid' }));
    expect(sealed.ok).toBe(true);
    expect(completed.ok).toBe(true);
    expect(barrier.read('run-valid')).toMatchObject({
      status: 'deleted', actor: 'codex', driven_by: 'agent',
      stages: expect.objectContaining({ stop_accepting: expect.any(String), drain_cancel: expect.any(String), seal_evidence: expect.any(String), detach_vg: expect.any(String), verify_owner_epoch_ref: expect.any(String), delete_disposable: expect.any(String) }),
    });
  });

  it('fails closed for references, unobserved inventory, missing evidence, preserved resources and premature completion', () => {
    const root = makeRoot('versegit-f2-negative-');
    const barrier = createVerseGitCleanupBarrier(root);
    expect(barrier.seal(sealInput({ references: ['delivery:pending'] })).issues).toContain('references_still_present');
    expect(barrier.seal(sealInput({ runId: 'run-unobserved', inventoryBefore: { observed: false, processes: 0, managers: 1, worktrees: 0, tempRoots: 0 } })).issues).toContain('resource_inventory_unobserved');
    expect(barrier.seal(sealInput({ runId: 'run-no-evidence', evidenceDigests: [] })).issues).toContain('evidence_not_sealed');
    const preserved = { kind: 'temp' as const, id: 'temp-preserved', target: 'evidence.tmp', owned: true, preserve: true };
    expect(barrier.seal(sealInput({ runId: 'run-preserved', resources: [preserved], deletedKinds: ['temp'], inventoryBefore: cleanupInventoryFromResources([preserved]) })).issues).toContain('resource_must_be_preserved');
    const valid = sealInput({ runId: 'run-premature', sessionId: 'run-premature', bindingId: 'run-premature' });
    expect(barrier.seal(valid).ok).toBe(true);
    expect(barrier.complete({ runId: valid.runId, sealId: barrier.read(valid.runId)!.sealId, inventoryAfter: { observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0 } }).issues).toContain('cleanup_not_detached');
  });

  it('records late events without overwriting a sealed or deleted outcome', () => {
    const root = makeRoot('versegit-f2-late-');
    const input = sealInput({ runId: 'run-late', sessionId: 'run-late', bindingId: 'run-late' });
    const { barrier, sealed } = recordCompleteDelete(root, input);
    const before = barrier.read(input.runId);
    const late = barrier.observeLateEvent({ runId: input.runId, event: 'start', epoch: 4 });
    expect(late.accepted).toBe(false);
    expect(late.record?.status).toBe('deleted');
    expect(late.record?.sealId).toBe(sealed.sealId);
    expect(late.record?.lateEvents).toHaveLength(1);
    expect(late.record?.evidenceDigests).toEqual(before?.evidenceDigests);
  });

  it('resumes a sealed record after restart and reports survivors as recovery_required', () => {
    const root = makeRoot('versegit-f2-restart-');
    const input = sealInput({ runId: 'run-restart', sessionId: 'run-restart', bindingId: 'run-restart' });
    const first = createVerseGitCleanupBarrier(root);
    const sealed = first.seal(input);
    expect(sealed.sealId).toBeTruthy();
    const restarted = createVerseGitCleanupBarrier(root);
    expect(restarted.read(input.runId)?.status).toBe('sealed');
    expect(restarted.markDetached({ runId: input.runId, sealId: sealed.sealId!, current: input.current, vgDetached: true }).ok).toBe(true);
    const survivor = restarted.complete({
      runId: input.runId,
      sealId: sealed.sealId!,
      inventoryAfter: { observed: true, processes: 0, managers: 1, worktrees: 0, tempRoots: 0, survivors: ['manager:session-f2'] },
    });
    expect(survivor.ok).toBe(false);
    expect(survivor.record?.status).toBe('recovery_required');
    expect(survivor.record?.issues).toEqual(expect.arrayContaining(['survivor:managers', 'survivors_reported']));
  });
});

describe('production cleanup caller', () => {
  it.each([
    ['normal', 'completed'],
    ['failure', 'failed'],
    ['cancel', 'cancelled'],
    ['stale', 'failed'],
  ] as const)('uses the same barrier for %s cleanup and removes owned worktree/temp/manager resources', async (_case, bindingReason) => {
    const baseRoot = initRepo();
    const cleanupRoot = join(makeRoot('versegit-f2-runtime-store-'), 'records');
    process.env.CLAWX_VERSGIT_CLEANUP_ROOT = cleanupRoot;
    process.env.CLAWX_VERSGIT_BINDING_ENABLED = '1';
    const service = createWorktreeService(baseRoot, { backend: 'git' });
    const runId = `run-${_case}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = service.create(runId, { writeSet: ['owned.txt'] });
    writeFileSync(join(record.root, 'owned.txt'), 'agent change\n', 'utf8');
    const attachmentsDir = join(baseRoot, `.openclaw/${runId}-attachments`);
    const transcriptFile = join(baseRoot, `.openclaw/${runId}-transcript.jsonl`);
    mkdirSync(attachmentsDir, { recursive: true });
    writeFileSync(join(attachmentsDir, 'a.txt'), 'attachment\n', 'utf8');
    writeFileSync(transcriptFile, 'transcript\n', 'utf8');
    const repo = bindingIdentityFor(baseRoot);
    const binding = makeBinding({ runId, worktreePath: record.root, ...repo });
    const port = fakePort();
    registerVerseGitRuntimeBinding(runId, binding, port);
    let managerPresent = true;
    const result = await runSubagentVerseGitCleanup({
      runId,
      entry: makeEntry({ runId, worktreeId: runId, attachmentsDir, transcriptFile }),
      cleanup: 'delete',
      sessionPresent: true,
      bindingEndReason: bindingReason,
      actions: {
        stopSession: async () => {},
        deleteSession: async () => { managerPresent = false; },
        deleteAttachments: async () => { rmSync(attachmentsDir, { recursive: true, force: true }); },
        deleteTranscript: async () => { rmSync(transcriptFile, { force: true }); },
        retireManagers: async () => {},
        cleanupWorktree: (authorization) => { service.cleanup(runId, authorization ? { authorization } : undefined); },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe('deleted');
    expect(result.record?.inventoryAfter).toMatchObject({ observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0 });
    expect(managerPresent).toBe(false);
    expect(existsSync(record.root)).toBe(false);
    expect(existsSync(attachmentsDir)).toBe(false);
    expect(existsSync(transcriptFile)).toBe(false);
    expect(existsSync(baseRoot)).toBe(true);
    expect(port.ended).toEqual([bindingReason]);
  });

  it('preserves user changes outside the agent write set and reports recovery_required', async () => {
    const baseRoot = initRepo();
    process.env.CLAWX_VERSGIT_CLEANUP_ROOT = join(makeRoot('versegit-f2-user-store-'), 'records');
    process.env.CLAWX_VERSGIT_BINDING_ENABLED = '1';
    const service = createWorktreeService(baseRoot, { backend: 'git' });
    const runId = `run-user-${Date.now()}`;
    const record = service.create(runId, { writeSet: ['owned.txt'] });
    writeFileSync(join(record.root, 'user-note.txt'), 'must preserve\n', 'utf8');
    const repo = bindingIdentityFor(baseRoot);
    registerVerseGitRuntimeBinding(runId, makeBinding({ runId, worktreePath: record.root, ...repo }), fakePort());
    const result = await runSubagentVerseGitCleanup({
      runId,
      entry: makeEntry({ runId, worktreeId: runId }),
      cleanup: 'keep',
      sessionPresent: false,
      bindingEndReason: 'failed',
      actions: {
        cleanupWorktree: (authorization) => { service.cleanup(runId, authorization ? { authorization } : undefined); },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.record?.status).toBe('recovery_required');
    expect(result.issues.join(' ')).toContain('user_content');
    expect(existsSync(join(record.root, 'user-note.txt'))).toBe(true);
  });

  it('refuses a direct worktree delete when VerseGit cleanup has no detached seal', () => {
    const baseRoot = initRepo();
    process.env.CLAWX_VERSGIT_CLEANUP_ROOT = join(makeRoot('versegit-f2-direct-store-'), 'records');
    process.env.CLAWX_VERSGIT_BINDING_ENABLED = '1';
    const service = createWorktreeService(baseRoot, { backend: 'git' });
    const record = service.create('direct-delete', { writeSet: ['owned.txt'] });
    expect(() => service.cleanup('direct-delete')).toThrow('worktree_cleanup_barrier_required');
    expect(existsSync(record.root)).toBe(true);
  });
});
