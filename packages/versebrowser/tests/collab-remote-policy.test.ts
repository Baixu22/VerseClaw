import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPolicyBundle,
  buildEvidenceIndex,
  createDefaultPolicyBundle,
  readEvidenceIndex,
  serializePolicyBundle,
  writeEvidenceIndex,
} from '../src/collab/remote-policy';
import { setWorkspaceRoot } from '../src/host/workspace-paths';

describe('remote evidence index + policy bundle', () => {
  it('builds a metadata-only index (no payloads, workspace-relative paths)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-collab-idx-'));
    setWorkspaceRoot(root);
    const packDir = join(root, '.ae', 'evidence', 'pack-abc');
    await mkdir(join(packDir, 'shots'), { recursive: true });
    await writeFile(
      join(packDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        packId: 'pack-abc',
        label: 'demo',
        sessionId: 's1',
        files: [
          { path: 'summary.md', kind: 'summary' },
          { path: 'shots/verify.png', kind: 'screenshot', size: 12 },
        ],
      }),
      'utf8',
    );
    await writeFile(join(packDir, 'summary.md'), 'secret body must not be indexed', 'utf8');

    const index = await buildEvidenceIndex({ workspaceLabel: 'demo-ws' });
    expect(index.schemaVersion).toBe(1);
    expect(index.packs).toHaveLength(1);
    const pack = index.packs[0]!;
    expect(pack.packId).toBe('pack-abc');
    expect(pack.metadataOnly).toBe(true);
    expect(pack.files.map((f) => f.path).join(',')).toMatch(/summary\.md/u);
    expect(pack.files.every((f) => f.path.startsWith('.ae/') || f.path.includes('pack-abc') || !f.path.startsWith('/'))).toBe(true);
    // No file bodies in the index
    expect(JSON.stringify(index)).not.toContain('secret body');

    const indexPath = join(root, '.ae', 'index.json');
    await writeEvidenceIndex(index, indexPath);
    const reread = await readEvidenceIndex(indexPath);
    expect(reread.packs[0]?.packId).toBe('pack-abc');
  });

  it('defaults the workspace field to a workspace-relative label, not a local absolute path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-collab-ws-'));
    setWorkspaceRoot(root);
    const index = await buildEvidenceIndex();
    // The index is pushed off the machine, so the default workspace field must not carry the
    // local absolute evidence root (e.g. D:\versebrowser\.ae\evidence).
    expect(index.workspace).toBe('.ae/evidence');
    expect(index.workspace.startsWith('/')).toBe(false);
    expect(/^[A-Za-z]:[\\/]/u.test(index.workspace)).toBe(false);
    expect(JSON.stringify(index)).not.toContain(root);

    // An explicit evidenceRoot outside the jail has no workspace-relative form. The field
    // promises "never an absolute local path", so the build refuses instead of embedding the
    // local temp root in an artifact made to be pushed off the machine.
    const outside = await mkdtemp(join(tmpdir(), 'vb-collab-outside-'));
    await expect(buildEvidenceIndex({ evidenceRoot: outside })).rejects.toThrow(/workspace-relative/u);
    // A caller label is the escape hatch and still wins.
    const labelled = await buildEvidenceIndex({ evidenceRoot: outside, workspaceLabel: 'demo-ws' });
    expect(labelled.workspace).toBe('demo-ws');
  });

  it('rejects unknown schemaVersion on read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-collab-bad-'));
    const p = join(root, 'idx.json');
    await writeFile(p, JSON.stringify({ schemaVersion: 99, packs: [] }), 'utf8');
    await expect(readEvidenceIndex(p)).rejects.toThrow(/schemaVersion/u);
  });

  it('applies a policy bundle from groups and expands capabilities', () => {
    const bundle = createDefaultPolicyBundle({
      version: '2026.09.24',
      issuer: 'team-sec',
      groups: ['debug', 'evidence'],
    });
    const result = applyPolicyBundle(bundle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.groups).toEqual(['debug', 'evidence']);
      expect(result.expandedCapabilities).toContain('debug.explain');
      expect(result.expandedCapabilities).toContain('evidence.write');
      // deny-by-default: no wildcards
      expect(result.policy.capabilities).not.toContain('*' as never);
    }
  });

  it('fail-closed on expired, unknown group, and wildcards', () => {
    const expired = createDefaultPolicyBundle({
      version: '1',
      issuer: 'x',
      groups: ['debug'],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r1 = applyPolicyBundle(expired);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('E_EXPIRED');

    const badGroup = {
      ...createDefaultPolicyBundle({ version: '1', issuer: 'x', groups: [] }),
      groups: ['nope' as never],
    };
    const r2 = applyPolicyBundle(badGroup);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('E_GROUP_CONFIG');

    const wild = {
      ...createDefaultPolicyBundle({ version: '1', issuer: 'x', groups: ['debug'] }),
      capabilities: ['*' as never],
    };
    const r3 = applyPolicyBundle(wild);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.message).toMatch(/wildcard/iu);
  });

  /**
   * An unreadable expiresAt used to be treated as *no* expiry: Date.parse() returns NaN and
   * `NaN <= at` is always false, so a bundle whose date was malformed bypassed the expiry check
   * entirely - a fail-open on the policy-distribution path. Omitting expiresAt still means no
   * expiry; stating one that cannot be read must be refused.
   */
  it('refuses an unreadable expiresAt instead of treating it as never expiring', () => {
    for (const expiresAt of ['not-a-date', '', 'null', '2026-13-45T99:99:99Z']) {
      const bundle = {
        ...createDefaultPolicyBundle({ version: '1', issuer: 'x', groups: ['debug'] }),
        expiresAt,
      };
      const result = applyPolicyBundle(bundle, { nowMs: Date.parse('2026-01-01T00:00:00.000Z') });
      expect(result.ok, `expiresAt=${JSON.stringify(expiresAt)}`).toBe(false);
      if (!result.ok) expect(result.code).toBe('E_EXPIRED');
    }
    // Omitting expiresAt is still allowed: a non-expiring bundle is a deliberate choice.
    expect(applyPolicyBundle(createDefaultPolicyBundle({ version: '1', issuer: 'x', groups: ['debug'] })).ok).toBe(true);
  });

  /**
   * The bundle arrives as JSON, so its shape is not guaranteed by the TS type. applyPolicyBundle's
   * contract is a PolicyApplyResult, never a throw - docs/collab.md tells receivers to write
   * `if (!result.ok) throw new Error(result.message)`, which a TypeError from .join() skips entirely.
   */
  it('returns a result for a malformed bundle shape instead of throwing', () => {
    const base = createDefaultPolicyBundle({ version: '1', issuer: 'x', groups: ['debug'] });
    const cases: Array<[string, unknown, string]> = [
      ['groups as a string', { ...base, groups: 'debug' }, 'E_GROUP_CONFIG'],
      ['groups as an object', { ...base, groups: { debug: true } }, 'E_GROUP_CONFIG'],
      ['capabilities as a string', { ...base, capabilities: 'debug.explain' }, 'E_CAPABILITY_CONFIG'],
      ['capabilities as an object', { ...base, capabilities: { debug: true } }, 'E_CAPABILITY_CONFIG'],
    ];
    for (const [label, bundle, code] of cases) {
      let result: ReturnType<typeof applyPolicyBundle> | undefined;
      expect(() => { result = applyPolicyBundle(bundle as never); }, label).not.toThrow();
      expect(result, label).toMatchObject({ ok: false, code });
    }
    // The documented receiver branch is reachable for every case above.
    for (const [, bundle] of cases) {
      const result = applyPolicyBundle(bundle as never);
      expect(result.ok ? 'ok' : result.message.length > 0).toBeTruthy();
    }
  });

  it('serializes bundles for push', () => {
    const bundle = createDefaultPolicyBundle({
      version: 'v1',
      issuer: 'ci',
      groups: ['core'],
      notes: 'read-mostly',
    });
    const text = serializePolicyBundle(bundle);
    const parsed = JSON.parse(text);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.issuer).toBe('ci');
    expect(parsed.groups).toEqual(['core']);
  });
});
