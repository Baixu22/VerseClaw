import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createAgencyRolePackageStore } from '@electron/services/agency-role-package-store';

const roots: string[] = [];

async function tempDir(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

async function createAgencyRepository(): Promise<string> {
  const root = await tempDir('agency-package-source');
  await mkdir(join(root, 'engineering'), { recursive: true });
  await mkdir(join(root, 'strategy'), { recursive: true });
  await writeFile(
    join(root, 'divisions.json'),
    JSON.stringify({ divisions: { engineering: { label: 'Engineering' } } }),
  );
  await writeFile(join(root, 'tools.json'), JSON.stringify({ tools: {} }));
  await writeFile(
    join(root, 'strategy', 'runbooks.json'),
    JSON.stringify({
      runbooks: [{
        slug: 'review',
        roster: [{ agents: ['code-reviewer'] }],
      }],
    }),
  );
  await writeFile(join(root, 'LICENSE'), 'MIT License\n');
  await writeFile(
    join(root, 'engineering', 'code-reviewer.md'),
    [
      '---',
      'name: Code Reviewer',
      'description: Reviews correctness and evidence.',
      '---',
      '# Code Reviewer Agent',
      '',
      '## Critical Rules',
      '- Require evidence.',
    ].join('\n'),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Agency role package store', () => {
  it('imports an immutable deterministic package and reuses identical content', async () => {
    const sourceRoot = await createAgencyRepository();
    const baseDir = await tempDir('agency-package-store');
    const store = createAgencyRolePackageStore({
      baseDir,
      now: () => new Date('2026-07-12T10:00:00.000Z'),
    });

    const first = await store.importFromRepository({
      sourceRoot,
      draftId: 'agency:engineering:code-reviewer',
    });
    const second = await store.importFromRepository({
      sourceRoot,
      draftId: 'agency:engineering:code-reviewer',
    });

    expect(first.packageId).toMatch(/^[a-f0-9]{64}$/);
    expect(second.packageId).toBe(first.packageId);
    expect(first).toMatchObject({
      completeness: 'complete',
      sourceRef: {
        relativePath: 'engineering/code-reviewer.md',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      matchedRunbooks: ['review'],
      draft: {
        id: 'agency:engineering:code-reviewer',
        status: 'draft',
      },
    });
    expect(first.sourcePath).toBe(join(baseDir, 'v1', first.packageId, 'source.md'));
    expect(await store.list()).toHaveLength(1);
  });

  it('creates a new linked package when upstream content changes', async () => {
    const sourceRoot = await createAgencyRepository();
    const baseDir = await tempDir('agency-package-store');
    const store = createAgencyRolePackageStore({ baseDir });
    const first = await store.importFromRepository({
      sourceRoot,
      draftId: 'agency:engineering:code-reviewer',
    });

    await writeFile(
      join(sourceRoot, 'engineering', 'code-reviewer.md'),
      '# Code Reviewer\n\n## Workflow\nReview changed behavior first.\n',
    );
    const refreshed = await store.refreshFromRepository({
      packageId: first.packageId,
      sourceRoot,
    });

    expect(refreshed.packageId).not.toBe(first.packageId);
    expect(refreshed.supersedesPackageId).toBe(first.packageId);
    expect(await store.list()).toHaveLength(2);
  });

  it('fails closed when a persisted package file is changed', async () => {
    const sourceRoot = await createAgencyRepository();
    const baseDir = await tempDir('agency-package-store');
    const store = createAgencyRolePackageStore({ baseDir });
    const imported = await store.importFromRepository({
      sourceRoot,
      draftId: 'agency:engineering:code-reviewer',
    });
    await writeFile(imported.sourcePath!, 'tampered');

    await expect(store.get(imported.packageId)).rejects.toThrow(/integrity|hash/i);
  });

  it('reconstructs legacy packages without inventing source prose', async () => {
    const sourceRoot = await createAgencyRepository();
    const sourceStore = createAgencyRolePackageStore({
      baseDir: await tempDir('agency-package-source-store'),
    });
    const imported = await sourceStore.importFromRepository({
      sourceRoot,
      draftId: 'agency:engineering:code-reviewer',
    });
    const baseDir = await tempDir('agency-package-legacy-store');
    const store = createAgencyRolePackageStore({ baseDir });

    const reconstructed = await store.reconstructLegacy({
      draft: imported.draft,
      sourceRef: imported.sourceRef,
      importedAt: '2026-07-12T11:00:00.000Z',
    });

    expect(reconstructed).toMatchObject({
      completeness: 'legacy-reconstructed',
      sourcePath: undefined,
      draft: imported.draft,
    });
    const manifest = JSON.parse(
      await readFile(join(baseDir, 'v1', reconstructed.packageId, 'manifest.json'), 'utf8'),
    ) as { files: Record<string, string> };
    expect(manifest.files).not.toHaveProperty('source.md');
  });
});
