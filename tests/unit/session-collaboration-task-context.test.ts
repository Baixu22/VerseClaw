// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
describe('collaboration task context owner', () => {
  it('reads an observer checkpoint and original evidence without taking a claim or writing owner events', () => {
    const domain = resolveTaskDomain(mkdtempSync(join(tmpdir(), 'collaboration-context-'))), writer = new TaskSystemStore(domain);
    try {
      const task = writer.create({ objective: 'Keep the original goal', target: 'result.txt', constraints: ['Read original sources'],
        acceptance: [{ id: 'source', description: 'Original source', verification: { kind: 'owner-receipt', owner: 'fixture' } }] }, 'create').task;
      const claim = writer.claim(task.contract.taskNodeId, 'agent:main:parent', 'parent-generation', 'claim').claim!;
      writer.checkpoint(claim, { nextAction: 'Read the next source', completed: ['Known result'], unresolved: ['Open question'], artifacts: [] });
      writer.inheritReference('agent:main:parent', 'parent-generation', 'agent:main:observer', 'observer-generation');
      const before = writer.db.prepare('SELECT * FROM task_events ORDER BY seq').all();
      const read = new TaskSystemStore(domain, undefined, undefined, true);
      try {
        const view = read.sessionSnapshot('agent:main:observer', 'observer-generation').task;
        expect(view?.referenceOnly).toBe(true); expect(view?.contract.objective).toBe('Keep the original goal');
        expect(read.context('agent:main:observer', 'observer-generation')).toContain('Read the next source');
        expect(read.sessionSnapshot('agent:main:discussion', 'discussion-generation').task).toBeNull();
      } finally { read.close(); }
      expect(writer.db.prepare('SELECT * FROM task_events ORDER BY seq').all()).toEqual(before);
    } finally { writer.close(); }
  });
});
