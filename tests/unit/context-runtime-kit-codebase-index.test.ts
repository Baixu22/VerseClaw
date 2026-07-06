import { describe, expect, it } from 'vitest';
import {
  buildCvkCodebaseIndex,
  resolveCvkCodebaseSelector,
} from '../../openclaw_runtime/src/context-engine/cvk/codebase-index';

const FIXTURE_FILES = [
  {
    path: 'src/math.ts',
    content: [
      "import { clamp } from './util';",
      '',
      'export function add(a: number, b: number): number {',
      '  return clamp(a + b);',
      '}',
      '',
      'export const scale = (value: number): number => value * 2;',
    ].join('\n'),
    relatedTests: ['tests/math.test.ts'],
  },
  {
    path: 'src/util.ts',
    content: [
      'export function clamp(value: number): number {',
      '  return Math.max(0, value);',
      '}',
    ].join('\n'),
    relatedTests: ['tests/math.test.ts'],
  },
  {
    path: 'tests/math.test.ts',
    content: [
      "import { add } from '../src/math';",
      '',
      "test('adds numbers', () => {",
      '  expect(add(1, 2)).toBe(3);',
      '});',
    ].join('\n'),
  },
];

describe('Context Runtime Kit codebase index MVP', () => {
  it('resolves file line-range selectors', () => {
    const index = buildCvkCodebaseIndex({ id: 'fixture-codebase', files: FIXTURE_FILES });
    const result = resolveCvkCodebaseSelector(index, {
      resourceId: index.resourceId,
      selector: 'code:file.src/math.ts#L3-L5',
    });

    expect(result).toMatchObject({
      ok: true,
      selector: 'code:file.src/math.ts#L3-L5',
    });
    if (result.ok) {
      expect(result.text).toContain('export function add');
      expect(result.text).toContain('return clamp(a + b);');
      expect(result.importHints).toEqual(["import { clamp } from './util';"]);
      expect(result.relatedTests).toEqual(['tests/math.test.ts']);
    }
  });

  it('resolves symbol selectors with deterministic related tests', () => {
    const index = buildCvkCodebaseIndex({ id: 'fixture-codebase', files: FIXTURE_FILES });
    const result = resolveCvkCodebaseSelector(index, {
      resourceId: index.resourceId,
      selector: 'code:symbol.add',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filePath).toBe('src/math.ts');
      expect(result.lineRange).toEqual({ startLine: 3, endLine: 5 });
      expect(result.relatedTests).toEqual(['tests/math.test.ts']);
    }
  });

  it('keeps selectors stable across identical input builds', () => {
    const first = buildCvkCodebaseIndex({ id: 'fixture-codebase', files: FIXTURE_FILES });
    const second = buildCvkCodebaseIndex({ id: 'fixture-codebase', files: FIXTURE_FILES });

    expect(first.resourceId).toBe(second.resourceId);
    expect(first.selectors).toEqual(second.selectors);
    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.relatedTests).toEqual(second.relatedTests);
  });

  it('marks old refs stale when source changes and fails closed for missing symbols', () => {
    const first = buildCvkCodebaseIndex({ id: 'fixture-codebase', files: FIXTURE_FILES });
    const changed = buildCvkCodebaseIndex({
      id: 'fixture-codebase',
      files: FIXTURE_FILES.map((file) => file.path === 'src/math.ts'
        ? { ...file, content: file.content.replace('value * 2', 'value * 3') }
        : file),
    });
    const stale = resolveCvkCodebaseSelector(changed, {
      resourceId: first.resourceId,
      selector: 'code:symbol.scale',
    });
    const missing = resolveCvkCodebaseSelector(changed, {
      resourceId: changed.resourceId,
      selector: 'code:symbol.divide',
    });

    expect(changed.resourceId).not.toBe(first.resourceId);
    expect(stale).toMatchObject({ ok: false, status: 'stale_resource' });
    expect(missing).toMatchObject({ ok: false, status: 'missing_symbol' });
  });
});
