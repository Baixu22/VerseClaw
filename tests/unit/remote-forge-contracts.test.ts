// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  GIT_PATCH_ARTIFACT_SCHEMA,
  REMOTE_FORGE_ERROR_SCHEMA,
  decodeGitPatchArtifactV1,
  decodeRemoteForgeErrorV1,
  isGitPatchArtifactV1,
  isRemoteForgeErrorV1,
  type GitPatchArtifactV1,
} from '@shared/types/remote-forge';

function completeTextArtifact(): GitPatchArtifactV1 {
  return {
    schema: GIT_PATCH_ARTIFACT_SCHEMA,
    file: 'src/app.ts',
    status: 'modified',
    contentKind: 'text',
    completeness: 'complete',
    patch: [
      'diff --git a/src/app.ts b/src/app.ts',
      '@@ -1,2 +1,2 @@',
      ' const enabled = true;',
      '-const mode = "old";',
      '+const mode = "new";',
    ].join('\n'),
    hunks: [{
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: 'context', text: 'const enabled = true;', oldLine: 1, newLine: 1 },
        { kind: 'deletion', text: 'const mode = "old";', oldLine: 2, newLine: null },
        { kind: 'addition', text: 'const mode = "new";', oldLine: null, newLine: 2 },
      ],
    }],
    lineage: {
      requestId: 'request-1',
      mutationId: 'mutation-1',
      journalEntryId: 'journal-1',
    },
  };
}

describe('GitPatchArtifact/v1', () => {
  it('accepts a complete text artifact with exact old/new line mapping', () => {
    const artifact = completeTextArtifact();

    expect(isGitPatchArtifactV1(artifact)).toBe(true);
    expect(decodeGitPatchArtifactV1(artifact)).toEqual({ ok: true, value: artifact });
  });

  it('allows additive fields within v1 but rejects another major schema', () => {
    const artifact = { ...completeTextArtifact(), futureHint: 'additive-v1-field' };

    expect(isGitPatchArtifactV1(artifact)).toBe(true);
    expect(isGitPatchArtifactV1({ ...artifact, status: 'moved' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...artifact, contentKind: 'symlink' })).toBe(false);
    expect(decodeGitPatchArtifactV1({ ...artifact, schema: 'GitPatchArtifact/v2' })).toEqual({
      ok: false,
      error: 'unsupported_schema',
      schema: 'GitPatchArtifact/v2',
    });
  });

  it('rejects invalid line ownership and false complete hunk counts', () => {
    const invalidAddition = completeTextArtifact();
    invalidAddition.hunks[0].lines[2] = {
      kind: 'addition',
      text: 'const mode = "new";',
      oldLine: 2,
      newLine: 2,
    };
    expect(decodeGitPatchArtifactV1(invalidAddition)).toMatchObject({
      ok: false,
      error: 'invalid_payload',
    });

    const mismatchedCounts = completeTextArtifact();
    mismatchedCounts.hunks[0].newLines = 3;
    expect(isGitPatchArtifactV1(mismatchedCounts)).toBe(false);

    const discontinuousOldLines = completeTextArtifact();
    discontinuousOldLines.hunks[0].lines[1].oldLine = 3;
    expect(isGitPatchArtifactV1(discontinuousOldLines)).toBe(false);

    const repeatedNewLines = completeTextArtifact();
    repeatedNewLines.hunks[0].lines[2].newLine = 1;
    expect(isGitPatchArtifactV1(repeatedNewLines)).toBe(false);

    const unnormalizedCrLf = completeTextArtifact();
    unnormalizedCrLf.hunks[0].lines[0].text = 'const enabled = true;\r';
    expect(isGitPatchArtifactV1(unnormalizedCrLf)).toBe(false);
  });

  it('represents add and delete mappings without inventing the missing side', () => {
    const added: GitPatchArtifactV1 = {
      schema: GIT_PATCH_ARTIFACT_SCHEMA,
      file: 'src/new.ts',
      status: 'added',
      contentKind: 'text',
      completeness: 'complete',
      patch: '--- /dev/null\r\n+++ b/src/new.ts\r\n@@ -0,0 +1 @@\r\n+new line',
      hunks: [{
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{ kind: 'addition', text: 'new line', oldLine: null, newLine: 1 }],
      }],
    };
    const deleted: GitPatchArtifactV1 = {
      schema: GIT_PATCH_ARTIFACT_SCHEMA,
      file: 'src/old.ts',
      status: 'deleted',
      contentKind: 'text',
      completeness: 'complete',
      hunks: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 0,
        newLines: 0,
        lines: [{ kind: 'deletion', text: 'old line', oldLine: 1, newLine: null }],
      }],
    };

    expect(isGitPatchArtifactV1(added)).toBe(true);
    expect(isGitPatchArtifactV1(deleted)).toBe(true);
  });

  it('requires repository-relative POSIX paths at the contract boundary', () => {
    const artifact = completeTextArtifact();

    expect(isGitPatchArtifactV1({ ...artifact, file: '/src/app.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...artifact, file: 'C:/src/app.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...artifact, file: 'src\\app.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...artifact, file: 'src/../app.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...artifact, file: './src/app.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...artifact, file: 'src//app.ts' })).toBe(false);
  });

  it('keeps truncated and unavailable distinct from complete', () => {
    const truncated = completeTextArtifact();
    truncated.completeness = 'truncated';
    truncated.message = 'Patch exceeded the producer output budget.';
    truncated.hunks[0].newLines = 3;
    expect(isGitPatchArtifactV1(truncated)).toBe(true);

    const unavailable: GitPatchArtifactV1 = {
      schema: GIT_PATCH_ARTIFACT_SCHEMA,
      file: 'src/large.ts',
      status: 'unknown',
      contentKind: 'unknown',
      completeness: 'unavailable',
      hunks: [],
      message: 'The source did not provide patch content.',
    };
    expect(isGitPatchArtifactV1(unavailable)).toBe(true);
    expect(isGitPatchArtifactV1({ ...unavailable, completeness: 'complete' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...unavailable, patch: '' })).toBe(false);
  });

  it('represents rename metadata and binary observations without fake hunks', () => {
    const renameMetadata: GitPatchArtifactV1 = {
      schema: GIT_PATCH_ARTIFACT_SCHEMA,
      file: 'src/new-name.ts',
      status: 'renamed',
      oldPath: 'src/old-name.ts',
      newPath: 'src/new-name.ts',
      contentKind: 'metadata',
      completeness: 'complete',
      hunks: [],
      message: 'Rename metadata only; file content is unchanged.',
    };
    const binary: GitPatchArtifactV1 = {
      schema: GIT_PATCH_ARTIFACT_SCHEMA,
      file: 'assets/logo.png',
      status: 'modified',
      contentKind: 'binary',
      completeness: 'complete',
      hunks: [],
      message: 'Binary content changed; no text hunks are available.',
    };

    expect(isGitPatchArtifactV1(renameMetadata)).toBe(true);
    expect(isGitPatchArtifactV1(binary)).toBe(true);
    expect(isGitPatchArtifactV1({ ...renameMetadata, newPath: 'src/old-name.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...renameMetadata, oldPath: '../old-name.ts' })).toBe(false);
    expect(isGitPatchArtifactV1({ ...binary, hunks: completeTextArtifact().hunks })).toBe(false);
  });
});

describe('RemoteForgeError/v1', () => {
  const error = {
    schema: REMOTE_FORGE_ERROR_SCHEMA,
    code: 'rate_limited',
    retryable: true,
    requestId: 'request-2',
    httpStatus: 429,
    safeMessage: 'The forge rate limit was reached. Retry later.',
  } as const;

  it('accepts the stable safe error envelope and additive v1 fields', () => {
    expect(isRemoteForgeErrorV1(error)).toBe(true);
    expect(isRemoteForgeErrorV1({ ...error, futureHint: 'retry-after-supported-later' })).toBe(true);
    expect(decodeRemoteForgeErrorV1(error)).toEqual({ ok: true, value: error });
  });

  it('rejects unknown codes, unsafe multiline messages, and invalid HTTP status', () => {
    expect(isRemoteForgeErrorV1({ ...error, code: 'raw_github_error' })).toBe(false);
    expect(isRemoteForgeErrorV1({ ...error, safeMessage: 'safe\nraw response body' })).toBe(false);
    expect(isRemoteForgeErrorV1({ ...error, httpStatus: 42 })).toBe(false);
  });

  it('fails closed on unsupported schemas instead of treating them as v1', () => {
    expect(decodeRemoteForgeErrorV1({ ...error, schema: 'RemoteForgeError/v2' })).toEqual({
      ok: false,
      error: 'unsupported_schema',
      schema: 'RemoteForgeError/v2',
    });
    expect(decodeRemoteForgeErrorV1({ code: 'timeout' })).toMatchObject({
      ok: false,
      error: 'invalid_payload',
    });
  });
});
