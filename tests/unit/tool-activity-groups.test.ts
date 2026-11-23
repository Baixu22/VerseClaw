import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import type { UserRunCard } from '@/pages/Chat/execution-projection';
import type { TaskStep } from '@/pages/Chat/task-visualization';
import { deriveRuntimeTaskSteps } from '@/pages/Chat/task-visualization';
import type { ChatRuntimeRunState } from '@/stores/chat/types';
import { buildToolActivityGroups, inferToolActivityKind } from '@/pages/Chat/tool-activity-groups';

function card(steps: TaskStep[], active = false, runKey = 'run-a'): UserRunCard {
  return { runKey, triggerIndex: 0, replyIndex: 5, active, status: active ? 'running' : 'completed', hasVisibleReply: !active,
    agentLabel: 'Main', sessionLabel: 'Session', segmentEnd: 8, steps, orchestrations: [], messageStepTexts: [],
    streamingReplyText: null, suppressThinking: true, surfaces: { terminals: [], diffs: [], plan: null, promotedStepIds: new Set() } };
}
const tool = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const messages: RawMessage[] = [
  { id: 'u', role: 'user', content: 'Check the project', timestamp: 1_790_000_000_000 },
  { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Read the file first.' }, tool('read', 'read_file', { path: '/project/a.ts' })], timestamp: 1_790_000_000_010 },
  { role: 'assistant', content: [tool('cmd', 'exec', { command: 'pnpm check' })] },
  { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Now update the file.' }, tool('edit', 'apply_patch', { path: '/project/a.ts' })], timestamp: 1_790_000_000_030 },
  { role: 'toolresult', toolCallId: 'read', content: 'Read result arriving later' },
  { id: 'final', role: 'assistant', content: 'Done.' },
];
const steps: TaskStep[] = [
  { id: 'read', kind: 'tool', label: 'read_file', status: 'completed', detail: '{"path":"/project/a.ts"}', depth: 1 },
  { id: 'cmd', kind: 'tool', label: 'exec', status: 'completed', detail: '{"command":"pnpm check"}', depth: 1 },
  { id: 'edit', kind: 'tool', label: 'apply_patch', status: 'completed', detail: '{"path":"/project/a.ts"}', depth: 1 },
];

describe('conversation tool activity groups', () => {
  it('places adjacent calls after their explanation and pairs a late result with its original call', () => {
    const groups = buildToolActivityGroups(card(steps), messages);
    expect(groups.map(group => group.anchorIndex)).toEqual([1, 3]);
    expect(groups[0].steps.map(step => step.id)).toEqual(['read', 'tool-result-read', 'cmd']);
    expect(groups[1].steps.map(step => step.id)).toEqual(['edit']);
    expect(groups[0].steps.find(step => step.id === 'tool-result-read')?.detail).toBe('Read result arriving later');
  });
  it('keeps completed history when the live owner currently contains only the newest tool', () => {
    const groups = buildToolActivityGroups(card([{ ...steps[2], status: 'running' }], true), messages.slice(0, 4));
    expect(groups[0].entries.map(entry => entry.id)).toEqual(['read', 'cmd']);
    expect(groups[1].current).toMatchObject({ id: 'edit', kind: 'edit', target: '/project/a.ts' });
    expect(groups[1].isCurrent).toBe(true);
    expect(groups[0].id).toBe(buildToolActivityGroups(card(steps), messages)[0].id);
  });
  it('gives a promoted command one group and one renderer', () => {
    const run = card(steps);
    run.steps = run.steps.filter(step => step.id !== 'cmd');
    run.surfaces.terminals = [{ id: 'cmd:output', toolCallId: 'cmd', type: 'terminal', command: 'pnpm check', output: 'PASS\n', status: 'completed', truncated: false }];
    run.surfaces.promotedStepIds.add('cmd');
    const groups = buildToolActivityGroups(run, messages);
    expect(groups[0].steps.some(step => step.id === 'cmd')).toBe(false);
    expect(groups[0].terminals).toHaveLength(1);
    expect(groups.flatMap(group => group.entries).filter(entry => entry.id === 'cmd')).toHaveLength(1);
  });
  it('retains failed results and never animates an interrupted run', () => {
    const run = card([{ ...steps[0], status: 'running' }]);
    run.status = 'aborted';
    const groups = buildToolActivityGroups(run, messages.slice(0, 2));
    expect(groups[0]).toMatchObject({ status: 'aborted', pendingResult: true, current: undefined });
    const failed = buildToolActivityGroups(card(steps), [...messages.slice(0, 4), { role: 'toolresult', toolCallId: 'edit', content: 'Access denied', isError: true }]);
    expect(failed[1].status).toBe('error');
  });
  it('keeps disclosure identities within their owning run and excludes composer interactions', () => {
    const a = buildToolActivityGroups(card(steps), messages);
    const b = buildToolActivityGroups(card(steps, false, 'run-b'), messages);
    expect(a[0].id).not.toBe(b[0].id);
    expect(buildToolActivityGroups(card(steps), messages, [], [], new Set(['read'])).flatMap(group => group.steps).some(step => step.id.includes('read'))).toBe(false);
  });
  it('uses different operation semantics for reading, writing, editing, search, browsing and commands', () => {
    expect(['read_file', 'write_file', 'apply_patch', 'web_search', 'web_fetch', 'exec_command', 'mcp_weather'].map(inferToolActivityKind))
      .toEqual(['read', 'write', 'edit', 'search', 'web', 'command', 'other']);
  });
  it('keeps a large write target readable after argument reduction and partial output', () => {
    const runtime = { runId: 'r', status: 'running', events: [
      { type: 'tool.started', toolCallId: 'large-write', name: 'write_file', args: { path: '/project/report.md', content: 'x'.repeat(7000) }, ts: 1_790_000_000_040 },
      { type: 'tool.updated', toolCallId: 'large-write', name: 'write_file', partialResult: 'Writing…', ts: 1_790_000_000_050 },
    ] } as ChatRuntimeRunState;
    const group = buildToolActivityGroups(card(deriveRuntimeTaskSteps(runtime), true), messages.slice(0, 2)).at(-1)!;
    expect(group.current).toMatchObject({ kind: 'write', target: '/project/report.md' });
  });
  it('keeps late command output at its recorded start rather than a later explanation', () => {
    const run = card([], true);
    run.surfaces.terminals = [{ id: 'background', type: 'terminal', command: 'pnpm check', output: 'Still running', status: 'running', truncated: false, startedAt: 1_790_000_000_020 }];
    const groups = buildToolActivityGroups(run, messages.slice(0, 4));
    expect(groups.find(group => group.terminals.length > 0)?.anchorIndex).toBe(1);
  });
});
