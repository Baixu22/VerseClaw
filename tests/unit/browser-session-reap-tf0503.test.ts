// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  closeAllAgentBrowserSessions,
  registerAgentBrowserShutdownReaper,
} from '../../electron/services/agent-browser-api';
import {
  listResourceEnvelopeEntries,
  recordResourceEnvelopeEntry,
} from '../../electron/services/resource-envelope';

type SessionHost = { list?: () => Array<{ id?: string }>; close?: (id: string) => void };

describe('TF-0503 browser session reaper (no orphan sessions)', () => {
  it('closes every live session through the same owner that listed it', () => {
    const closedIds: string[] = [];
    const host = {
      list: () => [{ id: 's-1' }, { id: 's-2' }],
      close: (id: string) => { closedIds.push(id); },
    } satisfies SessionHost;
    const result = closeAllAgentBrowserSessions(host);
    expect(closedIds).toEqual(['s-1', 's-2']);
    expect(result.closed).toEqual(['s-1', 's-2']);
    expect(result.failed).toEqual([]);
  });

  it('is a no-op when no sessions exist', () => {
    expect(closeAllAgentBrowserSessions({ list: () => [] })).toEqual({ closed: [], failed: [] });
  });

  it('reports a session that refuses to close instead of throwing', () => {
    const host = {
      list: () => [{ id: 'ok' }, { id: 'stuck' }],
      close: (id: string) => { if (id === 'stuck') throw new Error('refuses'); },
    } satisfies SessionHost;
    const result = closeAllAgentBrowserSessions(host);
    expect(result.closed).toEqual(['ok']);
    expect(result.failed).toEqual(['stuck']);
  });

  it('survives a service whose list() itself throws', () => {
    const host = { list: () => { throw new Error('no engine'); } } satisfies SessionHost;
    expect(() => closeAllAgentBrowserSessions(host)).not.toThrow();
    expect(closeAllAgentBrowserSessions(host)).toEqual({ closed: [], failed: [] });
  });

  it('skips sessions without an id', () => {
    const closedIds: string[] = [];
    const host = {
      list: () => [{ id: '' }, {} as { id?: string }, { id: 'real' }],
      close: (id: string) => { closedIds.push(id); },
    } satisfies SessionHost;
    expect(closeAllAgentBrowserSessions(host).closed).toEqual(['real']);
  });

  it('drops the resource-envelope entry for a closed session', () => {
    const envelopeId = 'main:browser-session:env-1';
    recordResourceEnvelopeEntry({
      id: envelopeId,
      workspaceKey: 'ws',
      kind: 'browser-session',
      priority: 'foreground',
      owner: 'main',
      activeSlots: 1,
      queuedCount: 0,
      queueWaitMs: 0,
      processCount: 0,
      treeRssBytes: 0,
      treeCpuPercent: 0,
      reason: 'test fixture',
    });
    expect(listResourceEnvelopeEntries().some((entry) => entry.id === envelopeId)).toBe(true);
    const host = { list: () => [{ id: 'env-1' }], close: () => undefined } satisfies SessionHost;
    closeAllAgentBrowserSessions(host);
    expect(listResourceEnvelopeEntries().some((entry) => entry.id === envelopeId)).toBe(false);
  });

  it('registering the reaper outside Electron is safe', () => {
    expect(() => registerAgentBrowserShutdownReaper()).not.toThrow();
  });
});
