import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from '@/lib/generated-files';
import type { ChatRuntimeRunState } from '@/stores/chat/types';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import {
  MAX_TERMINAL_OUTPUT_CHARS,
  projectCommandSurfaces,
  projectGeneratedFileDiff,
  projectProgressSurface,
  selectPendingApprovals,
} from '@/components/tool-ui/run-surfaces';

function runState(events: ChatRuntimeRunState['events'], status: ChatRuntimeRunState['status'] = 'running'): ChatRuntimeRunState {
  return {
    runId: 'run-1',
    sessionKey: 'agent:main:main',
    status,
    assistantText: '',
    thinkingText: '',
    events,
  };
}

function generatedFile(overrides: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    filePath: 'src/demo.ts',
    fileName: 'demo.ts',
    ext: '.ts',
    mimeType: 'text/typescript',
    contentType: 'code',
    action: 'modified',
    lastSeenIndex: 1,
    ...overrides,
  };
}

function approval(overrides: Partial<PermissionApprovalEvent> = {}): PermissionApprovalEvent {
  return {
    id: 'approval-1',
    workspaceId: 'workspace-1',
    sessionKey: 'agent:main:main',
    runId: 'run-1',
    mode: 'accept-edits',
    source: 'terminal',
    requestedAt: 1,
    status: 'pending',
    risk: 'dangerous',
    command: 'git clean -fd',
    cwd: 'C:/repo',
    ...overrides,
  };
}

describe('Tool UI runtime surface projection', () => {
  it('merges command events by stable id and keeps the final 32 KiB', () => {
    const prefix = 'a'.repeat(MAX_TERMINAL_OUTPUT_CHARS);
    const surfaces = projectCommandSurfaces(runState([
      {
        type: 'tool.started',
        runId: 'run-1',
        toolCallId: 'call-1',
        name: 'exec',
        args: { command: 'pnpm test', cwd: 'C:/repo' },
      },
      {
        type: 'command.output',
        runId: 'run-1',
        toolCallId: 'call-1',
        itemId: 'command-1',
        output: prefix,
        status: 'running',
        phase: 'update',
      },
      {
        type: 'command.output',
        runId: 'run-1',
        toolCallId: 'call-1',
        itemId: 'command-1',
        output: 'TAIL',
        status: 'completed',
        phase: 'end',
        exitCode: 0,
        durationMs: 1250,
      },
    ]));

    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({
      type: 'terminal',
      id: 'command-1',
      command: 'pnpm test',
      cwd: 'C:/repo',
      status: 'completed',
      exitCode: 0,
      durationMs: 1250,
      truncated: true,
    });
    expect(surfaces[0].output).toHaveLength(MAX_TERMINAL_OUTPUT_CHARS);
    expect(surfaces[0].output.endsWith('TAIL')).toBe(true);
  });

  it('does not duplicate cumulative command output snapshots', () => {
    const surfaces = projectCommandSurfaces(runState([
      {
        type: 'command.output',
        runId: 'run-1',
        itemId: 'command-1',
        output: 'line one',
        phase: 'update',
      },
      {
        type: 'command.output',
        runId: 'run-1',
        itemId: 'command-1',
        output: 'line one\nline two',
        phase: 'end',
        exitCode: 0,
      },
    ]));

    expect(surfaces[0].output).toBe('line one\nline two');
  });

  it('projects only trustworthy generated-file diffs', () => {
    expect(projectGeneratedFileDiff(generatedFile({
      baseline: { status: 'ok', content: 'const value = 1;\n' },
      fullContent: 'const value = 2;\n',
    }))).toMatchObject({
      type: 'code-diff',
      original: 'const value = 1;\n',
      modified: 'const value = 2;\n',
      confidence: 'trusted',
    });

    expect(projectGeneratedFileDiff(generatedFile({
      edits: [
        { old: 'const value = 1;', new: 'const value = 2;' },
        { old: 'export default value;', new: 'export { value };' },
      ],
    }))).toMatchObject({
      original: 'const value = 1;\n\nexport default value;',
      modified: 'const value = 2;\n\nexport { value };',
      mode: 'snippet',
    });

    expect(projectGeneratedFileDiff(generatedFile({
      baseline: { status: 'unavailable', reason: 'File is too large' },
      fullContent: 'replacement',
    }))).toBeNull();
    expect(projectGeneratedFileDiff(generatedFile({
      contentType: 'snapshot',
      ext: '.png',
      fullContent: 'not-real-text',
      baseline: { status: 'ok', content: '' },
    }))).toBeNull();
    expect(projectGeneratedFileDiff(generatedFile({
      action: 'created',
      fullContent: 'new file',
    }))).toBeNull();
  });

  it('maps task steps to an active tracker and a completed receipt', () => {
    const steps = [
      { id: 'read', label: 'Read files', status: 'completed' as const, kind: 'tool' as const, depth: 1 },
      { id: 'edit', label: 'Apply patch', status: 'running' as const, kind: 'tool' as const, depth: 1 },
      { id: 'test', label: 'Run tests', status: 'error' as const, kind: 'tool' as const, depth: 1 },
    ];

    expect(projectProgressSurface('run-1', steps, true)).toMatchObject({
      type: 'progress-tracker',
      id: 'run-1',
      status: 'running',
      steps: [
        { id: 'read', status: 'completed' },
        { id: 'edit', status: 'running' },
        { id: 'test', status: 'failed' },
      ],
    });
    expect(projectProgressSurface('run-1', steps.slice(0, 1), false)?.receipt).toMatchObject({
      outcome: 'success',
    });
  });

  it('selects pending approvals only for the active workspace, session, and run', () => {
    const selected = selectPendingApprovals([
      approval(),
      approval({ id: 'legacy', runId: null }),
      approval({ id: 'other-run', runId: 'run-2' }),
      approval({ id: 'resolved', status: 'approved' }),
      approval({ id: 'other-session', sessionKey: 'agent:main:other' }),
    ], {
      workspaceId: 'workspace-1',
      sessionKey: 'agent:main:main',
      activeRunId: 'run-1',
      includeLegacyForLatestActiveRun: true,
    });

    expect(selected.map((entry) => entry.id)).toEqual(['approval-1', 'legacy']);
  });
});
