import { describe, expect, it } from 'vitest';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import {
  VG_OBSERVATION_SCHEMA,
  VerseGitObservationBridge,
  classifyToolSurface,
  type ObservationBinding,
} from '../../electron/services/versegit-observation';

function binding(runId: string, overrides: Partial<ObservationBinding> = {}): ObservationBinding {
  const suffix = runId.replace(/^run-/, '');
  return {
    runId,
    sessionKey: `session-${suffix}`,
    traceId: `trace-${suffix}`,
    requestId: `request-${suffix}`,
    repoId: 'repo-alpha',
    worktreeId: `worktree-${suffix}`,
    agentSessionId: `agent-session-${suffix}`,
    vgSessionId: `vg-session-${suffix}`,
    ownerId: `owner-${suffix}`,
    actor: 'agent:codex',
    epoch: 1,
    boundAt: 1_000,
    ...overrides,
  };
}

function started(runId: string, callId: string, name: string, args: unknown = {}, ts = 2_000): ChatRuntimeEvent {
  return {
    type: 'tool.started', runId, sessionKey: `session-${runId.replace(/^run-/, '')}`,
    seq: 1, ts, toolCallId: callId, name, args,
  };
}

function completed(runId: string, callId: string, name: string, result: unknown = { ok: true }, ts = 2_100, isError = false): ChatRuntimeEvent {
  return {
    type: 'tool.completed', runId, sessionKey: `session-${runId.replace(/^run-/, '')}`,
    seq: 2, ts, toolCallId: callId, name, result, isError,
  };
}

describe('WP1 VerseGit observation bridge', () => {
  it('binds two worktree/session owners without crossing repository facts', () => {
    const bridge = new VerseGitObservationBridge();
    expect(bridge.bind(binding('run-a')).status).toBe('attached');
    expect(bridge.bind(binding('run-b', { worktreeId: 'worktree-b', agentSessionId: 'agent-session-b' })).status).toBe('attached');
    const a = bridge.ingest(started('run-a', 'call-a', 'Read', { path: 'src/a.ts' }), {
      epoch: 1, ownerId: 'owner-a', requestId: 'request-a-1', traceId: 'trace-request-a', eventId: 'evt-a-read-start',
    });
    const b = bridge.ingest(started('run-b', 'call-b', 'Write', { path: 'src/b.ts' }), {
      epoch: 1, ownerId: 'owner-b', requestId: 'request-b-1', traceId: 'trace-request-b', eventId: 'evt-b-write-start',
    });
    expect(a.status).toBe('observed');
    expect(b.status).toBe('observed');
    expect(a.event).toMatchObject({ repoId: 'repo-alpha', worktreeId: 'worktree-a', agentSessionId: 'agent-session-a', traceId: 'trace-request-a' });
    expect(b.event).toMatchObject({ repoId: 'repo-alpha', worktreeId: 'worktree-b', agentSessionId: 'agent-session-b', traceId: 'trace-request-b' });
    expect(a.event?.eventId).not.toBe(b.event?.eventId);
    expect(bridge.activeSessionCount).toBe(2);
  });

  it('deduplicates a repeated host event without incrementing the observation count', () => {
    const bridge = new VerseGitObservationBridge();
    bridge.bind(binding('run-a'));
    const event = started('run-a', 'call-a', 'Read');
    const first = bridge.ingest(event, { ownerId: 'owner-a' });
    const second = bridge.ingest(event, { ownerId: 'owner-a' });
    expect(first.status).toBe('observed');
    expect(second).toMatchObject({ status: 'duplicate', event: null, host_verdict: 'unchanged' });
    expect(bridge.snapshot('run-a')).toMatchObject({ eventCount: 1, duplicateCount: 1 });
  });

  it('rejects stale epochs, future epochs, wrong owners and wrong session keys', () => {
    const bridge = new VerseGitObservationBridge();
    bridge.bind(binding('run-a'));
    const event = started('run-a', 'call-a', 'Read');
    expect(bridge.ingest(event, { epoch: 0, eventId: 'old-epoch' })).toMatchObject({ status: 'stale', host_verdict: 'unchanged' });
    expect(bridge.ingest(event, { epoch: 2, eventId: 'future-epoch' })).toMatchObject({ status: 'rejected_by_policy', issues: ['unknown_session_epoch'] });
    expect(bridge.ingest(event, { epoch: 1, ownerId: 'owner-b', eventId: 'wrong-owner' })).toMatchObject({ status: 'rejected_by_policy', issues: ['identity_mismatch'] });
    const wrongSession: ChatRuntimeEvent = { ...event, sessionKey: 'session-other' };
    expect(bridge.ingest(wrongSession, { epoch: 1, ownerId: 'owner-a', eventId: 'wrong-session' })).toMatchObject({ status: 'rejected_by_policy', issues: ['identity_mismatch'] });
  });

  it('seals coverage before detach and turns late events into stale facts', () => {
    const bridge = new VerseGitObservationBridge();
    bridge.bind(binding('run-a'));
    bridge.ingest(started('run-a', 'read', 'Read', { path: 'src/a.ts' }, 2_000), { epoch: 1, ownerId: 'owner-a', eventId: 'read-start' });
    bridge.ingest(completed('run-a', 'read', 'Read', { text: 'ok' }, 2_010), { epoch: 1, ownerId: 'owner-a', eventId: 'read-end' });
    bridge.ingest(started('run-a', 'write', 'Edit', { path: 'src/a.ts' }, 2_020), { epoch: 1, ownerId: 'owner-a', eventId: 'write-start' });
    bridge.ingest(started('run-a', 'test', 'exec', { command: 'pnpm test' }, 2_030), { epoch: 1, ownerId: 'owner-a', eventId: 'test-start' });
    bridge.ingest(started('run-a', 'mcp', 'mcp__server__read', {}, 2_040), { epoch: 1, ownerId: 'owner-a', eventId: 'mcp-start' });
    bridge.ingest(started('run-a', 'net', 'web_fetch', { url: 'https://example.invalid' }, 2_050), { epoch: 1, ownerId: 'owner-a', eventId: 'network-start' });
    const seal = bridge.detach('run-a', { epoch: 1, ownerId: 'owner-a', at: 2_100, reason: 'worktree_cleanup' });
    expect(seal.status).toBe('detached');
    expect(seal.coverage?.values).toMatchObject({
      fileRead: 'host-event', fileWrite: 'host-event', shellRead: 'unobserved', shellWrite: 'inferred',
      mcpRead: 'partial', mcpWrite: 'partial', network: 'partial', directFs: 'unobserved',
    });
    expect(seal.coverage?.knownGaps.join(' ')).toContain('shellRead is unobserved');
    expect(seal.sessionEnd).toMatchObject({ surface: 'control', operation: 'session.end', repoId: 'repo-alpha', worktreeId: 'worktree-a' });
    expect(seal.host_verdict).toBe('unchanged');
    expect(bridge.activeSessionCount).toBe(0);
    expect(bridge.ingest(started('run-a', 'late', 'Read', {}, 3_000), { epoch: 1, ownerId: 'owner-a', eventId: 'late' })).toMatchObject({
      status: 'stale', issues: ['late_event_after_detach'],
    });
    expect(bridge.detach('run-a', { epoch: 1, ownerId: 'owner-a' })).toMatchObject({ status: 'stale', issues: ['duplicate_detach'] });
  });

  it('rejects unbound events instead of inventing an owner', () => {
    const bridge = new VerseGitObservationBridge();
    expect(bridge.ingest(started('run-unknown', 'call-x', 'Read'), { epoch: 1, ownerId: 'owner-x' })).toMatchObject({
      status: 'rejected_by_policy', issues: ['unknown_owner'], host_verdict: 'unchanged',
    });
  });

  it('classifies read, write, search, test, exec, MCP, network, browser and unknown surfaces', () => {
    expect(classifyToolSurface('Read')).toMatchObject({ surface: 'file.read', effect: 'read', coverage: 'host-event' });
    expect(classifyToolSurface('apply_patch')).toMatchObject({ surface: 'file.write', effect: 'write' });
    expect(classifyToolSurface('grep')).toMatchObject({ surface: 'repo.search', effect: 'read' });
    expect(classifyToolSurface('exec', { command: 'pnpm test' })).toMatchObject({ surface: 'test', effect: 'process' });
    expect(classifyToolSurface('exec', { command: 'git status' })).toMatchObject({ surface: 'exec', effect: 'process' });
    expect(classifyToolSurface('mcp__server__read')).toMatchObject({ surface: 'mcp', coverage: 'partial' });
    expect(classifyToolSurface('web_fetch')).toMatchObject({ surface: 'network', coverage: 'partial' });
    expect(classifyToolSurface('browser_click')).toMatchObject({ surface: 'browser', coverage: 'partial' });
    expect(classifyToolSurface('mystery_tool')).toMatchObject({ surface: 'control', effect: 'unknown', coverage: 'unobserved' });
  });

  it('marks a completion without its start event as partial while preserving the event', () => {
    const bridge = new VerseGitObservationBridge();
    bridge.bind(binding('run-a'));
    const result = bridge.ingest(completed('run-a', 'orphan', 'Read', { text: 'data' }), {
      epoch: 1, ownerId: 'owner-a', eventId: 'orphan-complete',
    });
    expect(result.status).toBe('partial');
    expect(result.issues).toContain('missing_tool_start_event');
    expect(result.event).toMatchObject({
      schema: VG_OBSERVATION_SCHEMA, surface: 'file.read', status: 'succeeded', coverage: 'partial',
      reason: 'missing_tool_start_event', endedAt: new Date(2_100).toISOString(),
    });
  });

  it('requires opaque identities and a higher epoch when rebinding a detached run', () => {
    const bridge = new VerseGitObservationBridge();
    const invalid = bridge.bind(binding('run-a', { worktreeId: 'D:/Projects/repo' }));
    expect(invalid.status).toBe('rejected_by_policy');
    expect(invalid.issues.join(' ')).toContain('worktreeId must be a non-empty opaque identifier');
    expect(bridge.bind(binding('run-a')).status).toBe('attached');
    bridge.detach('run-a', { epoch: 1, ownerId: 'owner-a', at: 2_000 });
    expect(bridge.bind(binding('run-a', { epoch: 1 })).status).toBe('rejected_by_policy');
    expect(bridge.bind(binding('run-a', { epoch: 2, agentSessionId: 'agent-session-a2', boundAt: 2_100 })).status).toBe('attached');
  });
});