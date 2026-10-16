import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  getWorkspaceEvidencePackDir,
  getWorkspaceEvidenceRoot,
  getWorkspaceRoot,
  getWorkspaceSessionDir,
  getWorkspaceSessionsRoot,
  setWorkspaceRoot,
  setWorkspaceRootProvider,
  toWorkspaceRelative,
  WORKSPACE_AE_DIR,
  WORKSPACE_EVIDENCE_DIR,
  WORKSPACE_SESSIONS_DIR,
} from '../src/host/workspace-paths';

describe('workspace-paths (TF-0017 workspace jail)', () => {
  afterEach(() => {
    setWorkspaceRoot(undefined);
    setWorkspaceRootProvider(null);
    delete process.env.VERSEBROWSER_WORKSPACE;
  });

  it('defaults evidence and sessions under <workspace>/.ae/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-ws-'));
    setWorkspaceRoot(root);

    expect(getWorkspaceRoot()).toBe(resolve(root));
    expect(getWorkspaceEvidenceRoot()).toBe(join(resolve(root), WORKSPACE_AE_DIR, WORKSPACE_EVIDENCE_DIR));
    expect(getWorkspaceSessionsRoot()).toBe(join(resolve(root), WORKSPACE_AE_DIR, WORKSPACE_SESSIONS_DIR));
  });

  it('resolves pack and session dirs with sanitized ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-ws-'));
    setWorkspaceRoot(root);

    expect(getWorkspaceEvidencePackDir('pack-abc')).toBe(
      join(resolve(root), '.ae', 'evidence', 'pack-abc'),
    );
    expect(getWorkspaceSessionDir('s-1')).toBe(
      join(resolve(root), '.ae', 'sessions', 's-1'),
    );
    // traversal / illegal characters are neutralized
    expect(getWorkspaceSessionDir('../escape')).not.toContain('..');
    expect(getWorkspaceEvidencePackDir('a/b')).toBe(
      join(resolve(root), '.ae', 'evidence', 'a_b'),
    );
  });

  it('honors VERSEBROWSER_WORKSPACE when no root is pinned', () => {
    const envRoot = join(tmpdir(), 'vb-env-ws');
    process.env.VERSEBROWSER_WORKSPACE = envRoot;
    expect(getWorkspaceRoot()).toBe(resolve(envRoot));
    expect(getWorkspaceEvidenceRoot()).toBe(join(resolve(envRoot), '.ae', 'evidence'));
  });

  it('prefers host provider over env', () => {
    const envRoot = join(tmpdir(), 'vb-env-ws');
    const provided = join(tmpdir(), 'vb-provided-ws');
    process.env.VERSEBROWSER_WORKSPACE = envRoot;
    setWorkspaceRootProvider(() => provided);
    expect(getWorkspaceRoot()).toBe(resolve(provided));
  });

  it('prefers explicit override over pinned root', async () => {
    const pinned = await mkdtemp(join(tmpdir(), 'vb-pinned-'));
    const override = await mkdtemp(join(tmpdir(), 'vb-override-'));
    setWorkspaceRoot(pinned);
    expect(getWorkspaceRoot(override)).toBe(resolve(override));
    expect(getWorkspaceEvidenceRoot(override)).toBe(join(resolve(override), '.ae', 'evidence'));
  });

  it('toWorkspaceRelative returns posix-style relative path inside jail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-ws-'));
    setWorkspaceRoot(root);
    const abs = join(resolve(root), '.ae', 'evidence', 'pack-x', 'summary.md');
    expect(toWorkspaceRelative(abs)).toBe('.ae/evidence/pack-x/summary.md');
  });

  it('toWorkspaceRelative returns null outside workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-ws-'));
    const outside = join(tmpdir(), 'elsewhere', 'file.png');
    setWorkspaceRoot(root);
    expect(toWorkspaceRelative(outside)).toBeNull();
  });
});
