import { describe, expect, it } from 'vitest';
import {
  computeLineStats,
  extractGeneratedFiles,
  supportsInlineDiff,
  supportsInlineDocumentPreview,
  type GeneratedFile,
  type GeneratedFileBaseline,
} from '@/lib/generated-files';
import type { RawMessage } from '@/stores/chat';

function makeWriteFile(overrides: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    filePath: '/tmp/example.ts',
    fileName: 'example.ts',
    ext: '.ts',
    mimeType: 'text/typescript',
    contentType: 'code',
    action: 'modified',
    fullContent: 'const value = 2\nconsole.log(value)\n',
    lastSeenIndex: 1,
    ...overrides,
  };
}

describe('generated-files utilities', () => {
  const trustedPatchResult = {
    toolCallId: 'write-1',
    toolName: 'write',
    result: {
      patchArtifacts: [{
        schema: 'GitPatchArtifact/v1',
        file: 'src/example.ts',
        status: 'modified',
        contentKind: 'text',
        hunks: [{
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            { kind: 'deletion', text: 'const value = 1', oldLine: 1, newLine: null },
            { kind: 'addition', text: 'const value = 2', oldLine: null, newLine: 1 },
          ],
        }],
        patch: [
          '--- src/example.ts',
          '+++ src/example.ts',
          '@@ -1,1 +1,1 @@',
          '-const value = 1',
          '+const value = 2',
        ].join('\n'),
        completeness: 'complete',
        lineage: {
          requestId: 'write-1',
          journalEntryId: 'write-journal:session:1',
        },
      }],
      write_journal: {
        snapshots: [{
          path: 'src/example.ts',
          journalEntryId: 'write-journal:session:1',
          hadPrior: true,
        }],
      },
    },
  };

  it('computes write line stats from an existing-file baseline', () => {
    const stats = computeLineStats(
      makeWriteFile({
        baseline: { status: 'ok', content: 'const value = 1\nconsole.log(value)\n' },
      }),
    );

    expect(stats).toEqual({ added: 1, removed: 1 });
  });

  it('treats missing baseline as a new file for line stats', () => {
    const stats = computeLineStats(
      makeWriteFile({
        action: 'created',
        baseline: { status: 'missing' },
        fullContent: 'line 1\nline 2\n',
      }),
    );

    expect(stats).toEqual({ added: 2, removed: 0 });
  });

  it('refuses to fake precise line stats when baseline is unavailable', () => {
    const stats = computeLineStats(
      makeWriteFile({
        baseline: { status: 'unavailable', reason: 'outsideSandbox' },
      }),
    );

    expect(stats).toBeNull();
  });

  it('routes html documents to rendered inline preview and text diff support', () => {
    expect(supportsInlineDocumentPreview('.html')).toBe(true);
    expect(supportsInlineDocumentPreview('.htm')).toBe(true);
    expect(supportsInlineDiff({ ext: '.html', contentType: 'document' })).toBe(true);
  });

  it('routes pdf/spreadsheet/office documents to rich-doc preview but never to text diff', () => {
    expect(supportsInlineDocumentPreview('.md')).toBe(true);
    // PDFs, spreadsheets, Word docs, and presentations render through dedicated viewers, so they
    // qualify for inline preview...
    expect(supportsInlineDocumentPreview('.pdf')).toBe(true);
    expect(supportsInlineDocumentPreview('.xlsx')).toBe(true);
    expect(supportsInlineDocumentPreview('.docx')).toBe(true);
    expect(supportsInlineDocumentPreview('.pptx')).toBe(true);
    // ...but diffing binary content is still meaningless, so the diff
    // tab stays hidden for these formats.
    expect(supportsInlineDiff({ ext: '.pdf', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.xlsx', contentType: 'document' })).toBe(false);
    expect(supportsInlineDiff({ ext: '.docx', contentType: 'document' })).toBe(false);

    const stats = computeLineStats({
      filePath: '/tmp/report.pdf',
      fileName: 'report.pdf',
      ext: '.pdf',
      mimeType: 'application/pdf',
      contentType: 'document',
      action: 'modified',
      fullContent: 'pretend text payload',
      baseline: { status: 'ok', content: 'older pretend text payload' },
      lastSeenIndex: 1,
    });

    expect(stats).toBeNull();
  });

  it('extracts write files with per-run baseline state and action', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'update file', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'write-1',
          name: 'Write',
          input: {
            file_path: '/tmp/example.ts',
            content: 'const value = 2\n',
          },
        }],
      },
    ];

    const baselineByPath = new Map<string, GeneratedFileBaseline>([
      ['/tmp/example.ts', { status: 'ok', content: 'const value = 1\n' }],
    ]);

    const files = extractGeneratedFiles(messages, 0, 1, (filePath) => baselineByPath.get(filePath));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filePath: '/tmp/example.ts',
      action: 'modified',
      baseline: { status: 'ok', content: 'const value = 1\n' },
    });
  });

  it('prefers the strictly linked mutation artifact over renderer baseline inference', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'update file', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'write-1',
          name: 'write',
          input: { path: 'src/example.ts', content: 'const value = 2\n' },
        }],
        _toolResults: [trustedPatchResult],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1, () => ({
      status: 'ok',
      content: 'stale renderer baseline\n',
    }));

    expect(files[0]?.patchProjection).toMatchObject({
      status: 'ok',
      artifact: {
        file: 'src/example.ts',
        lineage: {
          requestId: 'write-1',
          journalEntryId: 'write-journal:session:1',
        },
      },
    });
    expect(computeLineStats(files[0]!)).toEqual({ added: 1, removed: 1 });
  });

  it.each([
    ['stale request', { lineage: { requestId: 'other', journalEntryId: 'write-journal:session:1' } }],
    ['missing journal entry', { lineage: { requestId: 'write-1' } }],
    ['truncated evidence', { completeness: 'truncated' }],
    ['unknown schema', { schema: 'GitPatchArtifact/v2' }],
  ])('fails closed for %s instead of falling back to inferred diff content', (_label, artifactOverride) => {
    const artifact = {
      ...(trustedPatchResult.result.patchArtifacts[0] as Record<string, unknown>),
      ...artifactOverride,
    };
    const messages: RawMessage[] = [
      { role: 'user', content: 'update file', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'write-1',
          name: 'write',
          input: { path: 'src/example.ts', content: 'const value = 2\n' },
        }],
        _toolResults: [{
          ...trustedPatchResult,
          result: { ...trustedPatchResult.result, patchArtifacts: [artifact] },
        }],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1, () => ({
      status: 'ok',
      content: 'const value = 1\n',
    }));

    expect(files[0]?.patchProjection).toMatchObject({ status: 'unavailable' });
  });

  it('keeps new-file writes marked as created when the baseline says missing', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'create file', timestamp: 1 },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'write-1',
          name: 'Write',
          input: {
            file_path: '/tmp/new-file.ts',
            content: 'export const created = true\n',
          },
        }],
      },
    ];

    const files = extractGeneratedFiles(messages, 0, 1, () => ({ status: 'missing' }));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filePath: '/tmp/new-file.ts',
      action: 'created',
      baseline: { status: 'missing' },
    });
  });

  it('computes edit snippet stats from joined edit hunks', () => {
    const stats = computeLineStats({
      filePath: '/tmp/example.ts',
      fileName: 'example.ts',
      ext: '.ts',
      mimeType: 'text/typescript',
      contentType: 'code',
      action: 'modified',
      edits: [
        { old: 'alpha\n', new: 'beta\n' },
        { old: 'gamma\n', new: 'delta\n' },
      ],
      lastSeenIndex: 1,
    });

    expect(stats).toEqual({ added: 2, removed: 2 });
  });
});
