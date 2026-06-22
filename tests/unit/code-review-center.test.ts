import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const execFileMock = vi.hoisted(() => vi.fn());
const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));
const ledgerEvents = vi.hoisted(() => ({
  append: vi.fn(),
}));
const traceEvents = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/services/task-ledger-service', () => ({
  appendTaskLedgerEvents: ledgerEvents.append,
}));

vi.mock('@electron/services/observability-service', () => ({
  upsertObservabilityTrace: traceEvents.upsert,
}));

function workspace(): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: process.cwd(),
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

function mockExec(handler: (args: string[]) => { code?: number; stdout?: string; stderr?: string }) {
  execFileMock.mockImplementation((_command: string, args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
    const result = handler(args);
    const error = result.code && result.code !== 0 ? { code: result.code } : null;
    callback(error, result.stdout ?? '', result.stderr ?? '');
  });
}

function mockRepoWithPatch(patch: string) {
  mockExec((args) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${process.cwd()}\n` };
    if (args[0] === 'status') {
      return {
        stdout: [
          '# branch.head feature/review',
          '1 .M N... 100644 100644 100644 abc abc src/app.ts',
          '',
        ].join('\0'),
      };
    }
    if (args[0] === 'diff' && args[1] === '--cached') return { stdout: '' };
    if (args[0] === 'diff') return { stdout: patch };
    return { stdout: '' };
  });
}

describe('code review center service', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    ledgerEvents.append.mockReset();
    traceEvents.upsert.mockReset();
    activeWorkspace.profile = workspace();
  });

  it('parses JSON findings and sorts by severity', async () => {
    const { parseCodeReviewFindings } = await import('@electron/services/code-review-api');

    const result = parseCodeReviewFindings(JSON.stringify({
      summary: 'Review done',
      findings: [
        {
          severity: 'low',
          file: 'src/app.ts',
          line: 20,
          reason: 'Small issue',
          suggestedFix: 'Tighten the check.',
        },
        {
          severity: 'high',
          file: 'src/app.ts',
          line: 10,
          reason: 'Regression risk',
          suggested_fix: 'Guard the empty state.',
        },
      ],
    }), ['src/app.ts']);

    expect(result.summary).toBe('Review done');
    expect(result.findings.map((finding) => finding.severity)).toEqual(['high', 'low']);
    expect(result.findings[0]).toMatchObject({
      file: 'src/app.ts',
      line: 10,
      suggestedFix: 'Guard the empty state.',
    });
  });

  it('collects base branch diffs with read-only Git commands', async () => {
    const calls: string[][] = [];
    mockExec((args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${process.cwd()}\n` };
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: 'headsha\n' };
      if (args[0] === 'merge-base') return { stdout: 'basesha\n' };
      if (args[0] === 'diff') return { stdout: 'diff --git a/src/app.ts b/src/app.ts\n-old\n+new\n' };
      return { stdout: '' };
    });
    const { collectCodeReviewDiffForTarget } = await import('@electron/services/code-review-api');

    await expect(collectCodeReviewDiffForTarget({ kind: 'baseBranch', baseBranch: 'origin/main' })).resolves.toMatchObject({
      target: { kind: 'baseBranch', baseBranch: 'origin/main', baseCommit: 'basesha', headCommit: 'headsha' },
      stats: { files: 1, additions: 1, deletions: 1 },
    });
    expect(calls.map((args) => args[0])).toEqual(['rev-parse', 'rev-parse', 'merge-base', 'diff']);
    expect(calls.flat()).not.toEqual(expect.arrayContaining(['add', 'commit', 'clean', 'restore', 'checkout', 'push', 'pull']));
  });

  it('runs review, normalizes findings, and creates a Task Ledger review node', async () => {
    const patch = 'diff --git a/src/app.ts b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n';
    mockRepoWithPatch(patch);
    ledgerEvents.append.mockResolvedValue({
      workspaceId: 'workspace-1',
      nodes: [],
      edges: [],
      reviewNodeIds: [],
      sessionLinks: [],
      warnings: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
      eventsCount: 1,
    });
    const gatewayManager = new EventEmitter() as EventEmitter & {
      rpc: ReturnType<typeof vi.fn>;
    };
    gatewayManager.rpc = vi.fn(async (method: string) => {
      if (method === 'agent') return { runId: 'model-run-1', sessionKey: 'agent:main:code-review' };
      if (method === 'agent.wait') return { status: 'ok' };
      if (method === 'chat.history') {
        return {
          messages: [{
            role: 'assistant',
            content: JSON.stringify({
              summary: 'One issue',
              findings: [{
                severity: 'high',
                file: 'src/app.ts',
                line: 1,
                reason: 'Changed behavior without a guard.',
                suggestedFix: 'Add a regression test and preserve the old branch.',
              }],
            }),
          }],
        };
      }
      return {};
    });
    const { createCodeReviewApi } = await import('@electron/services/code-review-api');
    const api = createCodeReviewApi({ gatewayManager: gatewayManager as never });

    const result = await api.run({ target: { kind: 'uncommitted' }, focus: 'regressions' });
    expect(result).toMatchObject({
      success: true,
      review: {
        readonly: true,
        status: 'completed',
        findings: [expect.objectContaining({ severity: 'high', file: 'src/app.ts', line: 1 })],
      },
    });
    expect(traceEvents.upsert).toHaveBeenCalled();

    const ledger = await api.createTaskLedgerNode({
      runId: result.review.runId,
      findingId: result.review.findings[0].id,
    });
    expect(ledger).toMatchObject({ success: true, nodeId: expect.any(String) });
    expect(ledgerEvents.append).toHaveBeenCalledWith(undefined, [
      expect.objectContaining({
        type: 'node_created',
        payload: {
          node: expect.objectContaining({
            kind: 'review',
            status: 'review',
            evidenceRefs: [expect.objectContaining({ ref: 'src/app.ts:1' })],
            metadata: expect.objectContaining({
              source: 'codeReviewCenter',
              readonly: true,
            }),
          }),
        },
      }),
    ], expect.stringContaining('code-review:'));
  });
});
