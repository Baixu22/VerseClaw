// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adaptUnifiedDiffToGitPatchArtifacts } from '@shared/remote-forge/unified-diff-adapter';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { ChangeContextProjection, ChangeContextReviewVerdictDecision } from '@shared/types/change-context';

const fixture = vi.hoisted(() => ({ root: '', workspace: null as WorkspaceProfile | null }));
vi.mock('@electron/utils/paths', async (original) => ({ ...await original<object>(), getOpenClawConfigDir: () => join(fixture.root, 'config') }));
vi.mock('@electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: async () => fixture.workspace }));
vi.mock('electron-store', () => { const stores = new Map<string, Record<string, unknown>>(); return { default: class {
  private data: Record<string, unknown>;
  constructor(options?: { name?: string; defaults?: Record<string, unknown> }) {
    const key = `${fixture.root}:${options?.name}`;
    this.data = stores.get(key) ?? { ...options?.defaults };
    stores.set(key, this.data);
  }
  get(key: string, fallback?: unknown) { return this.data[key] ?? fallback; }
  set(key: string, value: unknown) { this.data[key] = value; }
} }; });

import { createChangeContextApi } from '@electron/services/change-context-api';
import { createChangeContextReviewCommentStore, createInMemoryChangeContextReviewCommentBackend } from '@electron/services/change-context-review-store';
import { createTaskLedgerApi } from '@electron/services/task-ledger-api';
import { createPermissionsApi } from '@electron/services/permissions-api';
import { getTaskLedgerEventsPath } from '@electron/services/task-ledger-service';

const author = { id: 'agent:acceptance', kind: 'agent' as const, drivenBy: 'agent' as const };
let api: ReturnType<typeof createChangeContextApi>;
let projection: ChangeContextProjection;
let head: string;
let destination: string;
let ledger: ReturnType<typeof createTaskLedgerApi>;
const identity = { workspaceId: 'fixture-workspace', sessionKey: 'agent:fixture:main' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.root, windowsHide: true, encoding: 'utf8' }).trim();

beforeEach(async () => {
  fixture.root = await mkdtemp(join(tmpdir(), 'change-context-verdict-'));
  fixture.workspace = { id: identity.workspaceId, name: 'Agent fixture', rootPath: fixture.root, permissionMode: 'acceptEdits', agentId: 'fixture', activeSessionKey: identity.sessionKey, createdAt: 0, updatedAt: 0, lastOpenedAt: 0, state: {} };
  destination = join(fixture.root, 'example.txt');
  await writeFile(destination, 'before\n');
  git('init', '-q'); git('add', 'example.txt'); git('-c', 'user.name=Agent Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture base');
  head = git('rev-parse', 'HEAD');
  await writeFile(destination, 'after\n');
  const patch = execFileSync('git', ['diff', '--', 'example.txt'], { cwd: fixture.root, windowsHide: true, encoding: 'utf8' });
  await writeFile(destination, 'before\n');
  const parsed = adaptUnifiedDiffToGitPatchArtifacts({ patch, sourceCompleteness: 'complete' });
  if (parsed.kind !== 'artifacts') throw new Error('Fixture patch did not parse');
  ledger = createTaskLedgerApi();
  api = createChangeContextApi({ store: createChangeContextReviewCommentStore({ backend: createInMemoryChangeContextReviewCommentBackend() }), taskLedger: ledger,
    sourceReader: { read: async () => ({ comparison: { mode: 'last-commit', state: 'available', base: { kind: 'git-commit', commit: head, treeDigest: null }, candidate: { kind: 'git-commit', commit: 'candidate', treeDigest: null }, resolvedAt: '', issues: [] },
      diff: { state: 'available', files: [{ path: 'example.txt', changeKind: 'modified', additions: 1, deletions: 1, patchDigest: `sha256:${createHash('sha256').update(patch).digest('hex')}`, contentState: 'available' }], patchArtifacts: parsed.artifacts, stats: { files: 1, additions: 1, deletions: 1, patchBytes: patch.length }, truncated: false, issues: [] } }) } });
  const loaded = await api.getProjection({ ...identity, comparison: { mode: 'last-commit', commit: 'candidate' } });
  expect(loaded.success).toBe(true); projection = loaded.projection!;
});
afterEach(async () => { vi.restoreAllMocks(); await rm(fixture.root, { recursive: true, force: true }); });

const verdict = (decision: ChangeContextReviewVerdictDecision) => ({ ...identity, contextId: projection.contextId, reviewedDigest: projection.reviewedDigest!, decision, author });
const pull = () => ({ ...identity, contextId: projection.contextId, patchArtifact: projection.diff!.patchArtifacts[0], expectedDestinationHead: head, approvalId: '' });

describe('review verdict and existing mutation owners', () => {
  it('creates one real Task Ledger node, reuses it, and approve/comment-only never complete it', async () => {
    const first = await api.submitVerdict(verdict('request_changes'));
    expect(first.verdict?.taskLedgerLink).toMatchObject({ direction: 'review-to-task-ledger', created: true });
    const repeat = await api.submitVerdict(verdict('request_changes'));
    expect(repeat.verdict?.taskLedgerLink).toMatchObject({ taskLedgerNodeId: first.verdict?.taskLedgerLink?.taskLedgerNodeId, created: false });
    const before = await readFile(getTaskLedgerEventsPath(identity.workspaceId), 'utf8');
    for (const decision of ['approve', 'comment_only'] as const) {
      expect(await api.submitVerdict(verdict(decision))).toMatchObject({ success: true, verdict: { decision, taskLedgerEffect: 'none', authority: { completesTaskLedgerNode: false, grantsApproval: false, executesCode: false } } });
    }
    expect(await readFile(getTaskLedgerEventsPath(identity.workspaceId), 'utf8')).toBe(before);
    const snapshot = await ledger.snapshot({ workspaceId: identity.workspaceId });
    expect(snapshot.snapshot.nodes).toHaveLength(1);
    expect(snapshot.snapshot.nodes[0]).toMatchObject({ status: 'todo', completedAt: null });
    expect(JSON.parse(before.trim()).payload.node.metadata).toMatchObject({ driven_by: 'agent', actor: 'agent:acceptance' });
  });
  it('links a pre-existing node without changing it', async () => {
    await ledger.createNode({ workspaceId: identity.workspaceId, node: { title: 'Existing' } });
    const node = (await ledger.snapshot({ workspaceId: identity.workspaceId })).snapshot.nodes[0];
    expect(await api.submitVerdict({ ...verdict('request_changes'), taskLedgerNodeId: node.id })).toMatchObject({ success: true, verdict: { taskLedgerLink: { created: false, taskLedgerNodeId: node.id } } });
    expect((await ledger.snapshot({ workspaceId: identity.workspaceId })).snapshot.nodes[0]).toEqual(node);
  });
  it.each(['approve', 'request_changes', 'comment_only'] as const)('rejects stale digest for %s', async (decision) => {
    expect(await api.submitVerdict({ ...verdict(decision), reviewedDigest: 'sha256:stale' })).toMatchObject({ success: false, error: { code: 'stale' } });
    expect((await ledger.snapshot({ workspaceId: identity.workspaceId })).snapshot.nodes).toHaveLength(0);
  });
  it('rejects invalid transitions, cross-workspace linkage, missing comments and missing nodes', async () => {
    for (const payload of [
      { ...verdict('approve'), taskLedgerNodeId: 'node' },
      { ...verdict('request_changes'), taskLedgerWorkspaceId: 'another-workspace' },
      { ...verdict('comment_only'), commentIds: ['not-in-context'] },
      { ...verdict('request_changes'), taskLedgerNodeId: 'missing' },
      { ...verdict('approve'), decision: 'auto_merge' as never },
    ]) expect((await api.submitVerdict(payload)).success).toBe(false);
  });
  it('requires approval and then applies via real Git and Coding journal', async () => {
    const mtimeBefore = (await stat(destination)).mtimeMs;
    const denied = await api.pullChanges(pull());
    expect(denied).toMatchObject({ success: false, state: 'denied', destinationMutated: false });
    expect(await readFile(destination, 'utf8')).toBe('before\n');
    expect((await stat(destination)).mtimeMs).toBe(mtimeBefore);
    if (denied.success) throw new Error('Expected approval request');
    const approvalId = (denied.error.details?.approval as { id: string }).id;
    await createPermissionsApi().decideApproval({ id: approvalId, decision: 'approved' });
    expect(await api.pullChanges({ ...pull(), expectedDestinationHead: 'f'.repeat(40), approvalId })).toMatchObject({ state: 'stale', destinationMutated: false });
    const applied = await api.pullChanges({ ...pull(), approvalId });
    expect(applied).toMatchObject({ success: true, state: 'applied', destinationMutated: true, receipt: { approvalId, destinationHeadBefore: head, destinationHeadAfter: head, writeJournalId: expect.stringMatching(/^write-journal:/) } });
    expect(await readFile(destination, 'utf8')).toBe('after\n');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    if (!applied.success) throw new Error('Expected journaled apply');
    const [, sessionId, seq] = applied.receipt.writeJournalId.split(':');
    const journal = join(fixture.root, '.openclaw', 'journal', sessionId, `${seq.padStart(4, '0')}-example.txt.pre`);
    expect(await readFile(journal, 'utf8')).toBe('before\n');
    expect(JSON.parse(await readFile(`${journal}.meta.json`, 'utf8')).batch.state).toBe('committed');
  });
  it('rejects a conflict with identical destination bytes and Git HEAD', async () => {
    await writeFile(destination, 'conflicting content\n');
    const before = await readFile(destination);
    expect(await api.pullChanges(pull())).toMatchObject({ success: false, state: 'conflicted', destinationMutated: false });
    expect(await readFile(destination)).toEqual(before); expect(git('rev-parse', 'HEAD')).toBe(head);
  });
  it('rejects forged/truncated patches before the apply owner', async () => {
    expect(await api.pullChanges({ ...pull(), patchArtifact: { ...pull().patchArtifact, patch: pull().patchArtifact.patch + '\n' } })).toMatchObject({ state: 'stale', destinationMutated: false });
    expect(await api.pullChanges({ ...pull(), patchArtifact: { ...pull().patchArtifact, completeness: 'truncated' } })).toMatchObject({ state: 'truncated', destinationMutated: false });
    expect(await readFile(destination, 'utf8')).toBe('before\n');
  });
  it('expires loaded snapshots rather than accepting an old review', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    expect(await api.submitVerdict(verdict('approve'))).toMatchObject({ success: false, error: { code: 'stale' } });
  });
});
