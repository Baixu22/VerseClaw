// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { CodeFile, LanguageId } from '../../openclaw_runtime/src/context-engine/fact-types';

const loading = vi.hoisted(() => {
  const state = {
    native: [] as string[],
    initialized: [] as string[],
    parsed: [] as string[],
    rejectLanguage: '',
    failParse: false,
  };
  class Parser {
    private language = '';
    setLanguage(language: { name: string }) {
      state.initialized.push(language.name);
      if (state.rejectLanguage === language.name) {
        state.rejectLanguage = '';
        throw new Error('language initialization failed');
      }
      this.language = language.name;
    }
    parse() {
      state.parsed.push(this.language);
      if (state.failParse) throw new Error('parse failed');
      return { rootNode: { type: 'module', children: [] } };
    }
  }
  return { state, Parser };
});

vi.mock('node:module', () => ({
  createRequire: () => (name: string) => {
    loading.state.native.push(name);
    return name === 'tree-sitter' ? loading.Parser : { name };
  },
}));
import {
  analyzeFileWithRegistry, analyzerFor, listAnalyzers,
} from '../../openclaw_runtime/src/context-engine/producers/analyzers/registry';

function analyze(language: LanguageId) {
  const file: CodeFile = {
    projectId: 'fixture', path: `sample.${language}`, absolutePath: `/fixtures/sample.${language}`,
    language, sizeBytes: 0, contentHash: '', modifiedAtMs: 0,
  };
  return analyzeFileWithRegistry({ repoRoot: '/fixtures', file, content: '' });
}

it('retries native initialization, reuses usable parsers and preserves parse fallback', () => {
  expect(listAnalyzers().map(analyzer => analyzer.language)).toEqual([
    'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'unknown',
  ]);
  expect(analyzerFor('python').capabilities).toContain('imports');
  expect(analyze('unknown').symbols).toHaveLength(1);
  expect(loading.state.native).toEqual([]);

  loading.state.rejectLanguage = 'tree-sitter-java';
  expect(() => analyze('java')).toThrow('language initialization failed');
  expect(analyze('java').symbols).toHaveLength(1);
  expect(loading.state.parsed).toEqual(['tree-sitter-java']);
  expect(loading.state.native).toEqual([
    'tree-sitter', 'tree-sitter-java', 'tree-sitter', 'tree-sitter-java',
  ]);

  for (const language of ['python', 'go', 'rust'] as const) {
    const before = loading.state.native.length;
    expect(analyze(language).symbols).toHaveLength(1);
    expect(loading.state.native.slice(before)).toEqual(['tree-sitter', `tree-sitter-${language}`]);
    analyze(language);
    expect(loading.state.native).toHaveLength(before + 2);
  }
  const afterLanguageLoads = loading.state.native.length;
  analyze('java');
  expect(loading.state.native).toHaveLength(afterLanguageLoads);

  loading.state.failParse = true;
  const before = loading.state.native.length;
  const analysis = analyze('java');
  expect(analysis.symbols).toHaveLength(1);
  expect(analysis.warnings).toEqual([{
    kind: 'parser_fallback', message: 'tree-sitter java analysis skipped: parse failed',
    count: 1, samples: ['sample.java'],
  }]);
  expect(loading.state.native).toHaveLength(before);
  loading.state.failParse = false;
});
