import { describe, expect, it, vi } from 'vitest';

import {
  isDynamicImportLoadError,
  recoverFromDynamicImportLoadError,
} from '@/lib/dynamic-import-recovery';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, String(value));
    }),
  };
}

describe('dynamic import recovery', () => {
  it('recognizes stale Vite dynamic import failures', () => {
    expect(isDynamicImportLoadError(
      new TypeError('Failed to fetch dynamically imported module: file:///C:/app/dist/assets/index-old.js'),
    )).toBe(true);
    expect(isDynamicImportLoadError(new Error('regular render failure'))).toBe(false);
  });

  it('reloads the current hash route once with a cache-busting query', () => {
    const storage = createMemoryStorage();
    const reload = vi.fn();
    const error = new TypeError('Failed to fetch dynamically imported module: file:///C:/app/dist/assets/index-old.js');
    const href = 'file:///C:/app/dist/index.html?e2eSkipSetup=1#/clawgraph';

    expect(recoverFromDynamicImportLoadError(error, {
      href,
      now: 1000,
      storage,
      reload,
    })).toBe(true);

    expect(reload).toHaveBeenCalledWith('file:///C:/app/dist/index.html?e2eSkipSetup=1&clawxReload=1000#/clawgraph');

    expect(recoverFromDynamicImportLoadError(error, {
      href: 'file:///C:/app/dist/index.html?e2eSkipSetup=1&clawxReload=1000#/clawgraph',
      now: 2000,
      storage,
      reload,
    })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
