import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFsSourceMapResolver,
  explainError,
  isNoiseStackFrame,
  parseErrorStack,
} from '../src/mcp/explain-error';

const stackSample = `TypeError: Cannot read properties of undefined (reading 'name')
    at handleClick (https://cdn.example.com/assets/app.min.js:1:2345)
    at https://cdn.example.com/assets/app.min.js:1:2400
    at Array.forEach (<anonymous>)
    at Object.<anonymous> (https://cdn.example.com/node_modules/react-dom/index.js:2:3)
    at chrome-extension://abcdef/content.js:10:1
    at run (node:internal/timers:1:1)`;

describe('explain_error stack parse', () => {
  it('extracts message and frames', () => {
    const { message, frames } = parseErrorStack(stackSample);
    expect(message).toContain('TypeError');
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames[0]).toMatchObject({
      functionName: 'handleClick',
      url: 'https://cdn.example.com/assets/app.min.js',
      line: 1,
      column: 2345,
    });
  });

  it('filters node_modules, extensions, and anonymous frames', () => {
    const { frames } = parseErrorStack(stackSample);
    const appFrames = frames.filter((frame) => !isNoiseStackFrame(frame));
    expect(appFrames.every((frame) => frame.url?.includes('app.min.js'))).toBe(true);
    expect(appFrames.length).toBe(2);
  });

  it('parses Firefox-style frames without leading at', () => {
    const { frames } = parseErrorStack('Error: boom\nfoo@https://x.test/a.js:3:7');
    expect(frames[0]).toMatchObject({ functionName: 'foo', url: 'https://x.test/a.js', line: 3, column: 7 });
  });

  it('explains without resolver and still points at generated location', async () => {
    const result = await explainError(stackSample);
    expect(result.message).toContain('TypeError');
    expect(result.frames.length).toBe(2);
    expect(result.primary?.url).toContain('app.min.js');
    expect(result.content).toContain('Primary source');
    expect(result.suggestion).toBeTruthy();
  });

  it('maps frames when resolver succeeds', async () => {
    const result = await explainError(stackSample, {
      resolve: async (frame) => ({
        ...frame,
        mapped: true,
        source: 'src/components/Button.tsx',
        originalLine: 42,
        originalColumn: 10,
        snippet: 'const name = user.name;',
        redacted: false,
        truncated: false,
      }),
    });
    expect(result.primary?.source).toBe('src/components/Button.tsx');
    expect(result.primary?.originalLine).toBe(42);
    expect(result.content).toContain('Button.tsx:42');
    expect(result.content).toContain('const name = user.name;');
    expect(result.suggestion).toContain('src/components/Button.tsx:42');
  });

  it('keeps failure reason when resolver throws', async () => {
    const result = await explainError(stackSample, {
      resolve: async () => {
        throw new Error('map fetch blocked');
      },
    });
    expect(result.frames[0].mapped).toBe(false);
    expect(result.frames[0].reason).toBe('map fetch blocked');
    expect(result.content).toContain('map fetch blocked');
  });

  it('maps via local fs source map (offline CLI path)', async () => {
    const mapDir = await mkdtemp(join(tmpdir(), 'vb-map-'));
    const resolver = createFsSourceMapResolver({ mapPaths: [join(mapDir, 'missing.js.map')] });
    const result = await explainError(stackSample, { resolve: resolver });
    expect(result.frames[0].mapped).toBe(false);
    expect(result.frames[0].reason).toContain('local source map not found');
    expect(result.frames[0].originalLine).toBeUndefined();
    expect(result.frames[0].source).toBeUndefined();
  });

  it('unmapped when map cannot resolve the generated position (never invent a line)', async () => {
    const mapDir = await mkdtemp(join(tmpdir(), 'vb-map-bad-'));
    const mapPath = join(mapDir, 'app.min.js.map');
    const { writeFile } = await import('node:fs/promises');
    // Valid map shape but mappings empty for the queried position → honest unmapped.
    await writeFile(
      mapPath,
      JSON.stringify({
        version: 3,
        file: 'app.min.js',
        sources: ['src/components/Button.tsx'],
        names: [],
        mappings: '',
        sourcesContent: ['const name = user.name;\n'],
      }),
      'utf8',
    );
    const resolver = createFsSourceMapResolver({ mapPaths: [mapPath] });
    const result = await explainError(stackSample, { resolve: resolver });
    for (const frame of result.frames) {
      expect(frame.mapped).toBe(false);
      expect(frame.reason).toBeTruthy();
      expect(frame.originalLine).toBeUndefined();
      expect(frame.source).toBeUndefined();
    }
    expect(result.content).not.toMatch(/Button\.tsx:\d+/u);
  });
});
