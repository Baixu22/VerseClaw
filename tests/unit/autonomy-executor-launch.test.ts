// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { spawnWithFallback } from '../../openclaw_runtime/src/process/spawn-utils';
import { createPtyAdapter } from '../../openclaw_runtime/src/process/supervisor/adapters/pty';

const terminal = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('@lydell/node-pty', () => {
  return new Promise(resolve => setTimeout(() => resolve({ spawn: terminal.spawn }), 20));
});

describe('actual executor launch boundary', () => {
  it('checks again before an OS spawn fallback instead of reusing an earlier permission', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', Object.assign(new Error('retryable spawn failure'), { code: 'EBADF' })));
      return child;
    });
    let admitted = 0;
    await expect(spawnWithFallback({ argv: ['fixture'], options: {}, fallbacks: [{ label: 'retry', options: {} }],
      spawnImpl: spawn as never, beforeSpawn: () => { if (++admitted === 2) throw new Error('owner changed before retry'); },
    })).rejects.toThrow('owner changed before retry');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(admitted).toBe(2);
  });

  it('rechecks after asynchronous PTY preparation before invoking its spawn', async () => {
    let allowed = true;
    const pending = createPtyAdapter({ shell: 'fixture', args: [], beforeSpawn: () => {
      if (!allowed) throw new Error('session cancelled during PTY initialization');
    } });
    allowed = false;
    await expect(pending).rejects.toThrow('session cancelled during PTY initialization');
    expect(terminal.spawn).not.toHaveBeenCalled();
  });
});
