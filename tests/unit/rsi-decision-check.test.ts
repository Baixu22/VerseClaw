// @vitest-environment node
// The six-decision acceptance record used to have no reader. This keeps it
// reproducible: the decisions file is the source of truth, bound blobs are
// re-hashed against disk, and files declared as non-judged registries produce a
// warning instead of a failure.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PATHS, validateDecisionAcceptance } from '../../scripts/rsi-decision-check.mjs';

const ROOT = process.cwd();
const readAcceptance = () => JSON.parse(readFileSync(join(ROOT, PATHS.acceptance), 'utf8'));
const codes = (result: { errors: Array<{ code: string }> }) => result.errors.map((entry) => entry.code);

describe('rsi decision acceptance readback', () => {
  it('rejects a current revalidation that loses the immutable historical acceptance identity', () => {
    const acceptance = readAcceptance();
    acceptance.historicalAcceptance.gitBlob = '0'.repeat(40);
    expect(codes(validateDecisionAcceptance(acceptance, ROOT, { allowDirty: true }))).toContain('historical-acceptance-binding');
  });
  it('rejects an emptied hash inventory or a judged source relabelled non-judged', () => {
    const missing = readAcceptance();
    missing.source.gitBlobHashes = {};
    expect(codes(validateDecisionAcceptance(missing, ROOT, { allowDirty: true }))).toContain('bound-file-coverage');
    const bypass = readAcceptance();
    bypass.source.nonJudgedInputs['scripts/lib/paired-ablation.mjs'] = 'not judged';
    expect(codes(validateDecisionAcceptance(bypass, ROOT, { allowDirty: true }))).toContain('non-judged-scope');
  });

  it('passes on the checked-in record and agrees with the decisions file', () => {
    const result = validateDecisionAcceptance(readAcceptance(), ROOT, { allowDirty: true });

    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.decisions).toEqual({ D1: 'C', D2: 'B', D3: 'A', D4: 'A', D5: 'A', D6: 'B' });
    expect(result.boundFileCount).toBeGreaterThan(0);
  });

  it('fails when a judged input moves after the seal', () => {
    const acceptance = readAcceptance();
    const judged = Object.keys(acceptance.source.gitBlobHashes).find((path) => !(path in acceptance.source.nonJudgedInputs)) as string;
    acceptance.source.gitBlobHashes[judged] = '0'.repeat(40);

    const result = validateDecisionAcceptance(acceptance, ROOT, { allowDirty: true });

    expect(codes(result)).toContain('bound-file-drift');
    expect(result.passed).toBe(false);
  });

  it('only warns when a declared non-judged registry moves', () => {
    const acceptance = readAcceptance();
    const nonJudged = Object.keys(acceptance.source.nonJudgedInputs)[0];
    acceptance.source.gitBlobHashes[nonJudged] = '0'.repeat(40);

    const result = validateDecisionAcceptance(acceptance, ROOT, { allowDirty: true });

    expect(codes(result)).not.toContain('bound-file-drift');
    expect(result.warnings.map((entry) => entry.code)).toContain('non-judged-drift');
    expect(result.passed).toBe(true);
  });

  it('keeps README documentation drift out of the RSI hard-failure scope', () => {
    const acceptance = readAcceptance();
    for (const path of ['README.ja-JP.md', 'README.md', 'README.zh-CN.md']) {
      acceptance.source.gitBlobHashes[path] = '0'.repeat(40);
    }

    const result = validateDecisionAcceptance(acceptance, ROOT, { allowDirty: true });

    expect(codes(result)).not.toContain('bound-file-drift');
    expect(result.warnings.filter((entry) => entry.code === 'non-judged-drift' && entry.message.startsWith('README.'))).toHaveLength(3);
    expect(result.passed).toBe(true);
  });
  it('fails when the acceptance disagrees with the decisions file', () => {
    const acceptance = readAcceptance();
    acceptance.decisions.find((entry: { id: string }) => entry.id === 'D1').choice = 'A';

    const result = validateDecisionAcceptance(acceptance, ROOT, { allowDirty: true });

    expect(codes(result)).toContain('decision-mismatch');
    expect(result.passed).toBe(false);
  });

  it('fails when a boundary claim is raised', () => {
    const acceptance = readAcceptance();
    acceptance.boundaries.completeRsiImplementation = true;

    const result = validateDecisionAcceptance(acceptance, ROOT, { allowDirty: true });

    expect(codes(result)).toContain('boundary');
  });
});
