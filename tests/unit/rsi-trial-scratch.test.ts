// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeScratchTree } from '../../scripts/lib/rsi-trial-scratch.mjs';

const linkKind = process.platform === 'win32' ? 'junction' : 'dir';

let workspace = '';
let store = '';
let tree = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'rsi-scratch-ws-'));
  store = join(workspace, 'store');
  tree = join(workspace, 'tree');
  mkdirSync(join(store, 'keepme'), { recursive: true });
  writeFileSync(join(store, 'keepme', 'payload.js'), 'export const value = 1;\n');
  mkdirSync(join(tree, 'src'), { recursive: true });
  writeFileSync(join(tree, 'src', 'file.ts'), 'x\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('trial scratch removal', () => {
  it('removes a plain scratch tree and leaves the store intact', () => {
    expect(removeScratchTree(tree).removed).toBe(true);
    expect(existsSync(tree)).toBe(false);
    expect(existsSync(join(store, 'keepme', 'payload.js'))).toBe(true);
  });

  it('is idempotent and reports a missing directory', () => {
    expect(removeScratchTree(tree).removed).toBe(true);
    expect(removeScratchTree(tree).missing).toBe(true);
  });

  it('never descends into a reparse point that targets the shared store', () => {
    symlinkSync(resolve(store), join(tree, 'node_modules'), linkKind);
    const result = removeScratchTree(tree);
    expect(result.removed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(existsSync(tree)).toBe(false);
    expect(readFileSync(join(store, 'keepme', 'payload.js'), 'utf8')).toContain('value');
  });

  it('survives a nested reparse point inside a subdirectory', () => {
    mkdirSync(join(tree, 'runtime'), { recursive: true });
    symlinkSync(resolve(store), join(tree, 'runtime', 'node_modules'), linkKind);
    expect(removeScratchTree(tree).removed).toBe(true);
    expect(existsSync(join(store, 'keepme', 'payload.js'))).toBe(true);
  });

  it('removes a reparse point given directly as the root', () => {
    const linkPath = join(workspace, 'direct-link');
    symlinkSync(resolve(store), linkPath, linkKind);
    const result = removeScratchTree(linkPath);
    expect(result.removed).toBe(true);
    expect(result.link).toBe(true);
    expect(existsSync(linkPath)).toBe(false);
    expect(existsSync(join(store, 'keepme', 'payload.js'))).toBe(true);
  });
});
