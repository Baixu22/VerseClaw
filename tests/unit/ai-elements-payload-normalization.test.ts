import { describe, expect, it } from 'vitest';
import { parseToolUiContent, parseToolUiInteraction } from '@/components/tool-ui/agent-interactions';

describe('AI Elements payload normalization', () => {
  it('normalizes test-results payloads with suites and failures', () => {
    const parsed = parseToolUiInteraction({
      type: 'test-results',
      title: 'Vitest run',
      suites: [{
        name: 'parser.test.ts',
        tests: [
          { name: 'passes structured payloads', status: 'passed', durationMs: 12 },
          { name: 'reports invalid payloads', error: { message: 'Expected true', stack: 'at parser.test.ts:7:3' } },
        ],
      }],
    });

    expect(parsed).toMatchObject({
      type: 'test-results',
      title: 'Vitest run',
      summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
      suites: [{ name: 'parser.test.ts', status: 'failed' }],
    });
  });

  it('normalizes stack-trace payloads and preserves source metadata', () => {
    const parsed = parseToolUiInteraction({
      type: 'stack-trace',
      errorType: 'TypeError',
      message: 'Cannot read properties of undefined',
      source: 'web-preview',
      stack: 'TypeError: boom\n    at render (src/App.tsx:10:5)',
    });

    expect(parsed).toMatchObject({
      type: 'stack-trace',
      errorType: 'TypeError',
      message: 'Cannot read properties of undefined',
      source: 'web-preview',
    });
  });

  it('normalizes chain-of-thought and task payloads', () => {
    expect(parseToolUiInteraction({
      type: 'chain-of-thought',
      steps: [
        { title: 'Inspect output', status: 'complete', results: [{ label: 'trace', url: 'https://example.test' }] },
        { title: 'Patch UI', status: 'active' },
      ],
    })).toMatchObject({
      type: 'chain-of-thought',
      steps: [
        { title: 'Inspect output', status: 'complete' },
        { title: 'Patch UI', status: 'active' },
      ],
    });

    expect(parseToolUiInteraction({
      type: 'task',
      title: 'Migration work',
      items: [{ label: 'Wire renderer', files: [{ path: 'src/components/card.tsx', status: 'modified' }] }],
    })).toMatchObject({
      type: 'task',
      title: 'Migration work',
      items: [{ label: 'Wire renderer', files: [{ path: 'src/components/card.tsx', status: 'modified' }] }],
    });
  });

  it('strips fenced AI Elements payloads from visible text', () => {
    const parsed = parseToolUiContent([
      'Before card.',
      '```tool-ui',
      JSON.stringify({ type: 'stack-trace', stack: 'at src/App.tsx:1:1' }),
      '```',
      'After card.',
    ].join('\n'));

    expect(parsed.displayText).toBe('Before card.\n\nAfter card.');
    expect(parsed.interactions).toHaveLength(1);
    expect(parsed.interactions[0]).toMatchObject({ type: 'stack-trace' });
  });

  it('falls back to null for invalid new payloads', () => {
    expect(parseToolUiInteraction({ type: 'test-results', suites: [] })).toBeNull();
    expect(parseToolUiInteraction({ type: 'task', title: 'Empty', items: [] })).toBeNull();
    expect(parseToolUiInteraction({ type: 'stack-trace', message: 'No stack' })).toBeNull();
  });
});
