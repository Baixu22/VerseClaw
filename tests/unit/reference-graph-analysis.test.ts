// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  analyzeReferences,
  categorizeSource,
  exclusionReason,
  groupCandidatesByDirectory,
  summarizeArea,
} from '../../scripts/analyze-reference-graph.mjs';

// Issue #75: the first audit matched candidates by filename/directory substring,
// so a file only had to share a basename with something in the tree to look
// "referenced", and a file whose full path occurs in the tree could still look
// "zero reference" when its basename did not occur verbatim. These tests pin the
// corrected rule: only containment of the candidate's full relative path counts.
//
// Everything below is a synthetic in-memory corpus. It is the in-repo heuristic
// proof for `scripts/analyze-reference-graph.mjs`, which applies the same
// exported `analyzeReferences` to the real `git ls-files` corpus.

const WIDGET = 'src/widgets/Widget.ts';
const OTHER_WIDGET = 'src/other/Widget.ts';
const DEEP_DOC = 'docs/dev/context-control-plane/stage0/authority-matrix.md';

type Corpus = { path: string; content: string }[];

function corpus(...files: [string, string][]): Corpus {
  return files.map(([path, content]) => ({ path, content }));
}

const SYNTHETIC: Corpus = corpus(
  [WIDGET, 'export const widget = 1;\n'],
  [OTHER_WIDGET, 'export const other = 1;\n'],
  ['src/consumer.ts', "import '../widgets/Widget.ts';\n// relative imports never spell out the repo-root path: Widget.ts\n"],
  ['src/loader.ts', "export const widgetSource = 'src/widgets/Widget.ts';\n"],
  ['docs/notes/Widget.ts', 'see `src/widgets/Widget.ts` on line one\n'],
  ['docs/contracts/widgets.json', '{\n  "file": "src/widgets/Widget.ts"\n}\n'],
  ['harness/specs/tasks/other-widget.md', 'This spec talks about Widget.ts and src/other/Widget.ts\n'],
  ['docs/appendix.md', 'Widget.ts, authority-matrix.md and STATUS.md are named here without any path.\n'],
);

function analyze(candidates: string[], options: { excludeSelf?: boolean } = {}) {
  return analyzeReferences({ candidates, corpus: SYNTHETIC, ...options });
}

describe('exact-path reference analysis (issue #75 heuristic)', () => {
  it('counts an exact full relative path as a reference, with line numbers', () => {
    const record = analyze([WIDGET]).get(WIDGET);

    expect(record?.codeReferences).toEqual([
      { file: 'src/loader.ts', line: 1 },
      { file: 'docs/notes/Widget.ts', line: 1 },
    ]);
    expect(record?.contractReferences).toEqual([{ file: 'docs/contracts/widgets.json', line: 2 }]);
  });

  it('does not treat a relative import or bare basename as a full path', () => {
    const record = analyze([WIDGET]).get(WIDGET);
    const referencingFiles = record?.anyReferences.map((reference) => reference.file) ?? [];

    // `src/consumer.ts` imports '../widgets/Widget.ts' and names the basename:
    // neither string is the candidate's full relative path.
    expect(referencingFiles).not.toContain('src/consumer.ts');
    expect(SYNTHETIC.find((file) => file.path === 'src/consumer.ts')?.content).not.toContain(WIDGET);
  });

  it('does not count a same-named file in another directory as a reference', () => {
    const referencingFiles = analyze([WIDGET]).get(WIDGET)?.anyReferences.map((reference) => reference.file) ?? [];

    // `harness/specs/tasks/other-widget.md` mentions the bare basename `Widget.ts`
    // and the *other* widget's full path; neither references src/widgets/Widget.ts.
    expect(referencingFiles).not.toContain('harness/specs/tasks/other-widget.md');
    expect(referencingFiles).not.toContain('docs/appendix.md');
    expect(referencingFiles).not.toContain(OTHER_WIDGET);
    expect(referencingFiles).not.toContain(WIDGET);
  });

  it('does not count a bare basename, even when that basename exists in the tree', () => {
    const results = analyze([WIDGET, OTHER_WIDGET]);
    const appendix = SYNTHETIC.find((file) => file.path === 'docs/appendix.md')?.content ?? '';

    // The appendix names basenames only; the fixture would be useless if it
    // happened to contain a full path.
    expect(appendix).toContain('Widget.ts');
    expect(appendix).not.toContain('src/');
    for (const candidate of [WIDGET, OTHER_WIDGET]) {
      const referencingFiles = results.get(candidate)?.anyReferences.map((reference) => reference.file) ?? [];
      expect(referencingFiles).not.toContain('docs/appendix.md');
    }
  });

  it('keeps the exact-path rule for a deep documentation path', () => {
    const request = corpus(
      [DEEP_DOC, '# authority matrix\n'],
      [
        'harness/specs/tasks/context-control-plane-stage0.md',
        [
          'Intro line.',
          'See docs/dev/context-control-plane/stage0/authority-matrix.md for the matrix.',
          'The spec also names authority-matrix.md without a directory.',
        ].join('\n'),
      ],
    );
    const record = analyzeReferences({ candidates: [DEEP_DOC], corpus: request }).get(DEEP_DOC);

    expect(record?.anyReferences).toEqual([
      { file: 'harness/specs/tasks/context-control-plane-stage0.md', line: 2 },
    ]);
    expect(record?.anyReferences.some((reference) => reference.line === 3)).toBe(false);
  });

  it('does not follow relative markdown links that omit the repo-root path', () => {
    const linked = corpus(['docs/dev/context-control-plane/README.md', '[matrix](stage0/authority-matrix.md)\n']);
    const record = analyzeReferences({ candidates: [DEEP_DOC], corpus: linked }).get(DEEP_DOC);

    // A relative link is not a full relative repo path. The audit therefore also
    // reports the softer `--mentions` signal; see the limits section of
    // docs/dev/repository-reference-analysis-20261010.md.
    expect(record?.anyReferences).toEqual([]);
  });

  it('categorizes sources by the extension sets the audit distinguishes', () => {
    expect(categorizeSource('src/a.ts')).toBe('code');
    expect(categorizeSource('scripts/a.mjs')).toBe('code');
    expect(categorizeSource('src/a.tsx')).toBe('code');
    expect(categorizeSource('electron/a.js')).toBe('code');
    expect(categorizeSource('docs/a.md')).toBe('contract');
    expect(categorizeSource('plans/a.json')).toBe('contract');
    expect(categorizeSource('harness/a.yml')).toBe('contract');
    expect(categorizeSource('resources/logo.svg')).toBe('other');
  });

  it('can treat a candidate own file as a non-source', () => {
    const selfMentioning = corpus(['plans/self.json', '{"path":"plans/self.json"}\n']);
    const candidates = ['plans/self.json'];

    expect(analyzeReferences({ candidates, corpus: selfMentioning }).get('plans/self.json')?.selfReferenced).toBe(true);

    const excluded = analyzeReferences({ candidates, corpus: selfMentioning, excludeSelf: true });
    expect(excluded.get('plans/self.json')?.anyReferences).toEqual([]);
    expect(excluded.get('plans/self.json')?.selfReferenced).toBe(false);
  });

  it('skips the runtime tree and lockfiles by default', () => {
    expect(exclusionReason('openclaw_runtime/src/index.ts')).toBe('runtime');
    expect(exclusionReason('openclaw_runtime/src/index.ts', { includeRuntime: true })).toBeNull();
    expect(exclusionReason('pnpm-lock.yaml')).toBe('lockfile');
    expect(exclusionReason('reports/context-compression/handoff-benchmark-v1/ground-truth.json.lock.json')).toBe('lockfile');
    expect(exclusionReason('package-lock.json')).toBe('lockfile');
    expect(exclusionReason('pnpm-lock.yaml', { includeLockfiles: true })).toBeNull();
    expect(exclusionReason('artifacts/system-maturity/P6-005/release-source-manifest.json')).toBeNull();
  });

  it('groups candidates by directory without changing the result set', () => {
    const groups = groupCandidatesByDirectory(['docs/b.md', 'docs/a.md', 'docs/deep/c.md', 'root.md']);

    expect(groups.get('docs/')).toEqual(['docs/a.md', 'docs/b.md']);
    expect(groups.get('docs/deep/')).toEqual(['docs/deep/c.md']);
    expect(groups.get('')).toEqual(['root.md']);
  });

  it('summarizes zero-reference counts and percentages over an area', () => {
    const candidates = [WIDGET, OTHER_WIDGET, 'docs/notes/Widget.ts'];
    const summary = summarizeArea('synthetic', candidates, analyze(candidates));

    expect(summary.fileCount).toBe(3);
    expect(summary.zeroCode).toBe(2);
    expect(summary.zeroCodePct).toBeCloseTo(66.7, 1);
    expect(summary.zeroCodeFiles).toEqual([OTHER_WIDGET, 'docs/notes/Widget.ts']);
    // OTHER_WIDGET is self-contained, so nothing in the tree names its full path.
    expect(summary.zeroAny).toBe(1);
    expect(summary.zeroAnyPct).toBeCloseTo(33.3, 1);
  });
});
