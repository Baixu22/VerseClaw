// @vitest-environment jsdom
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';

const store = vi.hoisted(() => ({ dir: '', snapshot: null as TaskLedgerSnapshot | null, events: [] as unknown[] }));
vi.mock('@electron/services/task-system-service', () => ({}));
vi.mock('@electron/services/knowledge-read-scope', () => ({}));
vi.mock('../../openclaw_runtime/src/knowledge/retrieval/task-context-hint', () => ({}));
vi.mock('@electron/services/task-ledger-service', () => ({
  getTaskLedgerDir: () => store.dir,
  loadTaskLedgerSnapshot: async () => store.snapshot,
  readTaskLedgerEvents: async () => ({ events: store.events }),
}));

it('exports untrusted ledger fields as literal text in all four views and after searching', async () => {
  const attack = '<img src="data:," onerror="window.injected=true">&"';
  const scriptBreak = '</script><svg onload="window.injected=true">';
  const node = { id: attack, title: attack, description: scriptBreak, kind: 'task' as const, status: 'review' as const,
    createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z' };
  store.snapshot = { schemaVersion: 1, workspaceId: attack, generatedAt: node.createdAt,
    nodes: [node], edges: [{ id: attack, from: node.id, to: scriptBreak, type: 'depends_on', createdAt: node.createdAt }],
    sessionLinks: [], rootNodeIds: [node.id], reviewNodeIds: [node.id], activeNodeIds: [], blockedNodeIds: [],
    recentDecisions: [], eventsCount: 1, warnings: [] };
  store.events = [{ type: attack, actor: attack, createdAt: attack, payload: { note: scriptBreak } }];
  store.dir = await mkdtemp(join(tmpdir(), 'ledger-export-'));
  try {
    const { createTaskLedgerApi } = await import('@electron/services/task-ledger-api');
    const result = await createTaskLedgerApi().exportHtml({ workspaceId: 'test', includeHistory: true });
    expect(result.success).toBe(true);
    document.documentElement.innerHTML = await readFile(result.path, 'utf8');
    // innerHTML does not execute scripts: execute the actual report renderer once.
    new Function('document', document.querySelectorAll('script')[1].textContent!)(document);
    for (const id of ['tree', 'dag', 'history', 'review']) {
      expect(document.getElementById(id)?.textContent).toContain(attack);
      if (id === 'history') expect(document.querySelector('#history pre')?.textContent).toBe(JSON.stringify({ note: scriptBreak }, null, 2));
      else expect(document.getElementById(id)?.textContent).toContain(scriptBreak);
      expect(document.getElementById(id)?.querySelector('img,svg')).toBeNull();
    }
    expect(document.querySelectorAll('script')).toHaveLength(2);
    const search = document.getElementById('search') as HTMLInputElement;
    search.value = 'img';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelector('img,svg')).toBeNull();
    expect((window as Window & { injected?: boolean }).injected).toBeUndefined();
  } finally {
    document.documentElement.innerHTML = '';
    await rm(store.dir, { recursive: true, force: true });
  }
});
