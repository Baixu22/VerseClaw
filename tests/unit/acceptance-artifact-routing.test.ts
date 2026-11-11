import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_DEV_EVIDENCE_INPUTS,
  acceptanceArtifactPath,
  prepareAcceptanceArtifacts,
} from '../../scripts/lib/acceptance-artifacts.mjs';

const originalArtifactRoot = process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT;
const roots: string[] = [];

afterEach(async () => {
  if (originalArtifactRoot === undefined) delete process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT;
  else process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT = originalArtifactRoot;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawx-acceptance-artifacts-'));
  roots.push(root);
  return root;
}

describe('acceptance artifact routing', () => {
  it('keeps the default generated-artifact location when no override is set', async () => {
    delete process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT;
    const root = await makeRoot();
    expect(acceptanceArtifactPath(root, 'system-maturity/P0-001')).toBe(
      join(root, 'artifacts', 'system-maturity', 'P0-001'),
    );
  });

  it('routes generated artifacts into an absolute acceptance root', async () => {
    const root = await makeRoot();
    const captured = join(root, 'captured');
    process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT = captured;
    expect(acceptanceArtifactPath(root, 'agent-dev-deep-test')).toBe(join(captured, 'agent-dev-deep-test'));
  });

  it('rejects relative roots and paths that escape the selected root', async () => {
    const root = await makeRoot();
    process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT = 'relative-artifacts';
    expect(() => acceptanceArtifactPath(root, 'agent-dev-workbench')).toThrow(/absolute/);

    process.env.CLAWX_ACCEPTANCE_ARTIFACT_ROOT = join(root, 'captured');
    expect(() => acceptanceArtifactPath(root, '../outside')).toThrow(/escapes/);
    expect(() => acceptanceArtifactPath(root, 'safe/../../outside')).toThrow(/escapes/);
  });

  it('copies frozen inputs without overwriting reports already captured in the run', async () => {
    const root = await makeRoot();
    const captured = join(root, 'captured');
    const source = join(root, 'artifacts');
    const timestamp = new Date('2026-11-11T08:00:00.000Z');
    for (const input of AGENT_DEV_EVIDENCE_INPUTS) {
      const path = join(source, input.path);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, `${input.id}:source\n`, 'utf8');
      await utimes(path, timestamp, timestamp);
    }

    const existing = join(captured, AGENT_DEV_EVIDENCE_INPUTS[0].path);
    await mkdir(join(existing, '..'), { recursive: true });
    await writeFile(existing, 'already-captured\n', 'utf8');

    prepareAcceptanceArtifacts(root, captured);

    await expect(readFile(existing, 'utf8')).resolves.toBe('already-captured\n');
    for (const input of AGENT_DEV_EVIDENCE_INPUTS.slice(1)) {
      const path = join(captured, input.path);
      await expect(readFile(path, 'utf8')).resolves.toBe(`${input.id}:source\n`);
      expect(Math.abs((await stat(path)).mtimeMs - timestamp.getTime())).toBeLessThan(1500);
    }
  });
});
