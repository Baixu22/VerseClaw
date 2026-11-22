// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';

const probe = vi.hoisted(() => ({ path: '', descriptor: -1, bytes: 0, grow: false, grew: false }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const fd = fs.openSync(...args);
      if (String(args[0]).replaceAll('\\', '/').toLowerCase() === probe.path.replaceAll('\\', '/').toLowerCase()) probe.descriptor = fd;
      return fd;
    },
    readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
      if (fd === probe.descriptor && probe.grow && !probe.grew) {
        const writer = fs.openSync(probe.path, 'r+');
        try { fs.ftruncateSync(writer, 64 * 1024 * 1024); probe.grew = true; }
        finally { fs.closeSync(writer); }
      }
      const bytes = fs.readSync(fd, buffer, offset, length, position);
      if (fd === probe.descriptor) probe.bytes += bytes;
      return bytes;
    },
  };
});

describe('bounded checkpoint artifact projection', () => {
  it.each([false, true])('hashes through a bounded descriptor when concurrent growth is %s', grow => {
    const root = mkdtempSync(join(tmpdir(), 'context-artifact-bound-'));
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const content = Buffer.alloc(160_000, 'a'), path = join(root, 'artifact.bin');
      writeFileSync(path, content);
      const sha256 = createHash('sha256').update(content).digest('hex');
      const task = store.start({ contract: { objective: 'Keep bounded artifact references', constraints: [], target: '.',
        acceptance: [{ id: 'file', description: 'Check bytes', verification: { kind: 'file-sha256', path: 'artifact.bin', sha256 } }],
      } }, 'coordinator', 'g', 'start');
      store.checkpoint(task.claim!, { nextAction: 'Review bytes', completed: [], unresolved: [], artifacts: [{ path, sha256 }] });
      Object.assign(probe, { path, descriptor: -1, bytes: 0, grow, grew: false });
      const context = store.context('coordinator', 'g');
      expect(probe.bytes).toBe(content.length);
      expect(context).toContain(`"state":"${grow ? 'stale' : 'current'}"`);
      if (grow) {
        probe.bytes = 0;
        expect(store.context('coordinator', 'g')).toContain('"state":"unverified"');
        expect(probe.bytes).toBe(0);
      }
    } finally {
      Object.assign(probe, { path: '', descriptor: -1, grow: false });
      store.close(); rmSync(root, { recursive: true, force: true });
    }
  });
});
