// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  GIT_PATCH_ADAPTER_LIMITS,
  adaptUnifiedDiffToGitPatchArtifacts,
} from '@shared/remote-forge/unified-diff-adapter';
import { isGitPatchArtifactV1 } from '@shared/types/remote-forge';
import {
  ADD_DELETE_PATCH,
  BARE_HUNK_PATCH,
  BINARY_AND_MODE_PATCH,
  CRLF_NO_NEWLINE_PATCH,
  GIT_BINARY_PATCH,
  HEADERED_UNIFIED_PATCH,
  MALFORMED_PATCH,
  RENAME_COPY_METADATA_PATCH,
  TRUNCATED_PATCH,
} from '../fixtures/remote-forge-unified-diff-corpus';

function artifactsFor(patch: string, sourceCompleteness: 'complete' | 'truncated' = 'complete') {
  const result = adaptUnifiedDiffToGitPatchArtifacts({ patch, sourceCompleteness });
  expect(result.kind).toBe('artifacts');
  if (result.kind !== 'artifacts') throw new Error(result.message);
  expect(result.artifacts.every(isGitPatchArtifactV1)).toBe(true);
  return result.artifacts;
}

describe('unified diff to GitPatchArtifact/v1 adapter', () => {
  it('normalizes CRLF, maps old/new lines, and retains no-newline markers', () => {
    const [artifact] = artifactsFor(CRLF_NO_NEWLINE_PATCH);

    expect(artifact).toMatchObject({
      schema: 'GitPatchArtifact/v1',
      file: 'src/app.ts',
      status: 'modified',
      contentKind: 'text',
      completeness: 'complete',
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, heading: 'configure' }],
    });
    expect(artifact?.patch).not.toContain('\r');
    expect(artifact?.hunks[0]?.lines).toEqual([
      { kind: 'context', text: 'const enabled = true;', oldLine: 1, newLine: 1 },
      { kind: 'deletion', text: 'const mode = "old";', oldLine: 2, newLine: null },
      { kind: 'no-newline', text: 'No newline at end of file', oldLine: null, newLine: null },
      { kind: 'addition', text: 'const mode = "new";', oldLine: null, newLine: 2 },
      { kind: 'no-newline', text: 'No newline at end of file', oldLine: null, newLine: null },
    ]);
  });

  it('preserves file order and add/delete line ownership', () => {
    const artifacts = artifactsFor(ADD_DELETE_PATCH);

    expect(artifacts.map(({ file, status }) => ({ file, status }))).toEqual([
      { file: 'src/new.ts', status: 'added' },
      { file: 'src/old.ts', status: 'deleted' },
    ]);
    expect(artifacts[0]?.hunks[0]?.lines[0]).toMatchObject({ oldLine: null, newLine: 1 });
    expect(artifacts[1]?.hunks[0]?.lines[0]).toMatchObject({ oldLine: 1, newLine: null });
  });

  it('represents rename and copy metadata without fake text hunks', () => {
    const artifacts = artifactsFor(RENAME_COPY_METADATA_PATCH);

    expect(artifacts).toMatchObject([
      {
        file: 'src/new-name.ts',
        status: 'renamed',
        oldPath: 'src/old-name.ts',
        newPath: 'src/new-name.ts',
        contentKind: 'metadata',
        hunks: [],
      },
      {
        file: 'src/copied.ts',
        status: 'copied',
        oldPath: 'src/source.ts',
        newPath: 'src/copied.ts',
        contentKind: 'metadata',
        hunks: [],
      },
    ]);
  });

  it('distinguishes binary from metadata-only changes', () => {
    const artifacts = artifactsFor(BINARY_AND_MODE_PATCH);

    expect(artifacts.map(({ file, contentKind, hunks }) => ({ file, contentKind, hunks }))).toEqual([
      { file: 'assets/logo.png', contentKind: 'binary', hunks: [] },
      { file: 'scripts/run.sh', contentKind: 'metadata', hunks: [] },
    ]);
  });

  it('accepts a bounded Git binary patch without interpreting payload lines as hunks', () => {
    const [artifact] = artifactsFor(GIT_BINARY_PATCH);

    expect(artifact).toMatchObject({
      file: 'assets/archive.bin',
      contentKind: 'binary',
      completeness: 'complete',
      hunks: [],
    });
    expect(artifact?.patch).toContain('literal 3');
  });

  it('accepts a headered single-file unified diff without a Git file marker', () => {
    const [artifact] = artifactsFor(HEADERED_UNIFIED_PATCH);

    expect(artifact).toMatchObject({
      file: 'docs/guide.md',
      status: 'modified',
      contentKind: 'text',
      completeness: 'complete',
    });
  });

  it('preserves a trustworthy truncated prefix without marking it complete', () => {
    const [artifact] = artifactsFor(TRUNCATED_PATCH, 'truncated');

    expect(artifact).toMatchObject({
      file: 'src/truncated.ts',
      contentKind: 'text',
      completeness: 'truncated',
      hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3 }],
    });
    expect(artifact?.hunks[0]?.lines).toHaveLength(3);
    expect(artifact?.message).toMatch(/truncated/i);
  });

  it.each([
    ['bare hunk', BARE_HUNK_PATCH],
    ['empty input', ''],
  ])('fails closed for %s input without inventing a complete artifact', (_name, patch) => {
    expect(adaptUnifiedDiffToGitPatchArtifacts({ patch, sourceCompleteness: 'complete' })).toMatchObject({
      kind: 'unavailable',
      artifacts: [],
    });
  });

  it('turns a malformed file patch into an unavailable artifact', () => {
    const [artifact] = artifactsFor(MALFORMED_PATCH);

    expect(artifact).toMatchObject({
      file: 'src/broken.ts',
      completeness: 'unavailable',
      contentKind: 'unknown',
      hunks: [],
    });
    expect(artifact?.patch).toBeUndefined();
  });

  it('keeps producer-unavailable and over-limit inputs explicitly unavailable', () => {
    expect(adaptUnifiedDiffToGitPatchArtifacts({
      patch: undefined,
      sourceCompleteness: 'unavailable',
    })).toMatchObject({ kind: 'unavailable', artifacts: [], message: expect.stringMatching(/unavailable/i) });

    const oversized = 'x'.repeat(GIT_PATCH_ADAPTER_LIMITS.maxInputBytes + 1);
    expect(adaptUnifiedDiffToGitPatchArtifacts({
      patch: oversized,
      sourceCompleteness: 'complete',
    })).toMatchObject({ kind: 'unavailable', artifacts: [], message: expect.stringMatching(/limit/i) });
  });

  it('copies lineage onto every artifact without becoming a write authority', () => {
    const result = adaptUnifiedDiffToGitPatchArtifacts({
      patch: ADD_DELETE_PATCH,
      sourceCompleteness: 'complete',
      lineage: { requestId: 'request-1', mutationId: 'mutation-1', journalEntryId: 'journal-1' },
    });

    expect(result.kind).toBe('artifacts');
    if (result.kind !== 'artifacts') return;
    expect(result.artifacts.every((artifact) => artifact.lineage?.requestId === 'request-1')).toBe(true);
  });
});
