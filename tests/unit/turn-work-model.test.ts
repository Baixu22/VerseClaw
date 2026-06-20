import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from '@/lib/generated-files';
import { buildTurnWorkModel } from '@/components/assistant-render/turn-work-model';

function generatedFile(overrides: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    filePath: '/workspace/report.md',
    fileName: 'report.md',
    ext: '.md',
    mimeType: 'text/markdown',
    contentType: 'document',
    action: 'created',
    fullContent: '# Report',
    lastSeenIndex: 2,
    ...overrides,
  };
}

describe('turn work model', () => {
  it('prioritizes running task state while preserving reports and sources', () => {
    const model = buildTurnWorkModel({
      id: 'run-1',
      active: true,
      steps: [
        { id: 'tool-1', label: 'web_fetch', status: 'running', kind: 'tool', depth: 1, url: 'https://example.com/docs' },
      ],
      reports: [generatedFile()],
    });

    expect(model).toMatchObject({
      id: 'run-1',
      status: 'running',
      primaryKind: 'tasks',
    });
    expect(model?.tasks).toHaveLength(1);
    expect(model?.reports[0]?.fileName).toBe('report.md');
    expect(model?.sources[0]).toMatchObject({ domain: 'example.com', status: 'running' });
  });

  it('uses reports as the primary completed view when files are present', () => {
    const model = buildTurnWorkModel({
      id: 'run-2',
      active: false,
      steps: [
        { id: 'tool-1', label: 'Write', status: 'completed', kind: 'tool', depth: 1 },
      ],
      reports: [generatedFile({ action: 'modified' })],
    });

    expect(model?.status).toBe('completed');
    expect(model?.primaryKind).toBe('reports');
    expect(model?.reports[0]?.action).toBe('modified');
  });

  it('returns null when no task, report, or source data exists', () => {
    expect(buildTurnWorkModel({ id: 'empty', active: false, steps: [], reports: [] })).toBeNull();
  });
});
