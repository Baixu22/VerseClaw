import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
} from '../../openclaw_runtime/src/context-engine/cvk/compiler';
import {
  resolveCvkSelector,
  resolveCvkSelectorBatch,
} from '../../openclaw_runtime/src/context-engine/cvk/resolver';

const WRONG_CHECKSUM = `sha256:${'b'.repeat(64)}`;

function loadArtifact(): CvkFixtureArtifact {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
  return compileCvkFixtureSources(fixture);
}

function checksumFor(artifact: CvkFixtureArtifact, resourceId: string, selector: string): string {
  const chunk = artifact.chunks.find((item) => item.resourceId === resourceId && item.selector === selector);
  if (!chunk) throw new Error(`Missing test chunk ${resourceId} ${selector}`);
  return chunk.checksum;
}

describe('Context Runtime Kit selector resolver', () => {
  it('resolves a selector and validates its checksum', () => {
    const artifact = loadArtifact();
    const result = resolveCvkSelector(artifact, {
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.run_shell.required',
      checksum: checksumFor(artifact, 'toolset:local.shell@v1', 'schema:tool.run_shell.required'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chunk.selector).toBe('schema:tool.run_shell.required');
      expect(result.chunk.text).toContain('"required"');
    }
  });

  it('fails closed with deterministic diagnostics for missing, stale, ambiguous, wrong-resource, and checksum errors', () => {
    const artifact = loadArtifact();
    const validChunk = artifact.chunks.find((chunk) => chunk.selector === 'schema:tool.run_shell.required');
    if (!validChunk) throw new Error('Fixture must include shell required chunk.');

    const missing = resolveCvkSelector(artifact, {
      resourceId: 'skill:context-runtime-kit@v1',
      selector: 'skill:missing',
    });
    const stale = resolveCvkSelector(artifact, {
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.run_shell.required',
      sourceChecksum: WRONG_CHECKSUM,
    });
    const ambiguousArtifact = {
      ...artifact,
      chunks: [
        ...artifact.chunks,
        { ...validChunk, chunkId: `${validChunk.chunkId}-duplicate` },
      ],
    };
    const ambiguous = resolveCvkSelector(ambiguousArtifact, {
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.run_shell.required',
    });
    const wrongResource = resolveCvkSelector(artifact, {
      resourceId: 'skill:context-runtime-kit@v1',
      selector: 'schema:tool.run_shell.required',
    });
    const checksumMismatch = resolveCvkSelector(artifact, {
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.run_shell.required',
      checksum: WRONG_CHECKSUM,
    });
    const hardClaimMissingChecksum = resolveCvkSelector(artifact, {
      resourceId: 'toolset:local.shell@v1',
      selector: 'schema:tool.run_shell.required',
      hardClaim: true,
    });

    expect(missing).toMatchObject({ ok: false, status: 'missing_selector' });
    expect(stale).toMatchObject({ ok: false, status: 'stale_selector' });
    expect(ambiguous).toMatchObject({ ok: false, status: 'ambiguous_selector' });
    expect(wrongResource).toMatchObject({ ok: false, status: 'wrong_resource' });
    expect(checksumMismatch).toMatchObject({ ok: false, status: 'checksum_mismatch' });
    expect(hardClaimMissingChecksum).toMatchObject({ ok: false, status: 'hard_claim_missing_checksum' });
    expect([missing, stale, ambiguous, wrongResource, checksumMismatch, hardClaimMissingChecksum].map((result) => (
      result.ok ? '' : result.diagnostic.code
    ))).toEqual([
      'missing_selector',
      'stale_selector',
      'ambiguous_selector',
      'wrong_resource',
      'checksum_mismatch',
      'hard_claim_missing_checksum',
    ]);
  });

  it('preserves batch order and reports per-item resolution status', () => {
    const artifact = loadArtifact();
    const results = resolveCvkSelectorBatch(artifact, [
      {
        resourceId: 'toolset:local.shell@v1',
        selector: 'schema:tool.run_shell.required',
        checksum: checksumFor(artifact, 'toolset:local.shell@v1', 'schema:tool.run_shell.required'),
      },
      {
        resourceId: 'skill:context-runtime-kit@v1',
        selector: 'skill:missing',
      },
      {
        resourceId: 'toolset:local.shell@v1',
        selector: 'schema:tool.run_shell.permission',
        checksum: WRONG_CHECKSUM,
      },
    ]);

    expect(results.map((result) => (result.ok ? 'resolved' : result.status))).toEqual([
      'resolved',
      'missing_selector',
      'checksum_mismatch',
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      ref: {
        resourceId: 'toolset:local.shell@v1',
        selector: 'schema:tool.run_shell.required',
      },
    });
    expect(results[1]).toMatchObject({
      ok: false,
      diagnostic: {
        resourceId: 'skill:context-runtime-kit@v1',
        selector: 'skill:missing',
      },
    });
  });
});
