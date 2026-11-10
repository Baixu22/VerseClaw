// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, parse, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeCodeProbe, stageCodeDefect } from '../../scripts/lib/project-rag-code-oracle.mjs';

type CodeOracle = {
  referenceSource: string;
  spec: { symbol: string; mode: string; defect: { before: string; after: string }; [key: string]: unknown };
  supportingSources: Record<string, string>;
  cases: unknown[];
  expected: unknown[];
};
const taskGold: Array<{ code?: CodeOracle }> = JSON.parse(readFileSync('harness/specs/fixtures/project-rag/v2/oracle/task-gold.json', 'utf8'));
const codeOracles = taskGold.flatMap(row => row.code ? [row.code] : []);
const functionSpec = (builtins: string[] = []) => ({ mode: 'function', symbol: 'probe', builtins });
const run = (body: string, builtins: string[] = [], args: unknown[] = []) => executeCodeProbe(
  `export function probe(): unknown {${body}}`,
  functionSpec(builtins),
  {},
  [{ args }],
);

describe('private Project RAG code oracle isolation', () => {
  it('runs all 20 frozen declarations and their staged defects through 106 real probes', () => {
    const previousCanary = process.env.RAG_ORACLE_CANARY;
    process.env.RAG_ORACLE_CANARY = 'parent-only-secret';
    try {
      expect(codeOracles).toHaveLength(20);
      expect(codeOracles.reduce((count, oracle) => count + oracle.cases.length, 0)).toBe(106);
      for (const oracle of codeOracles) {
        const reference = executeCodeProbe(oracle.referenceSource, oracle.spec, oracle.supportingSources, oracle.cases);
        expect(reference, oracle.spec.symbol).toEqual(oracle.expected);
        const defective = executeCodeProbe(stageCodeDefect(oracle.referenceSource, oracle.spec), oracle.spec,
          oracle.supportingSources, oracle.cases);
        expect(defective, `${oracle.spec.symbol} defect`).not.toEqual(oracle.expected);
      }
    } finally {
      if (previousCanary === undefined) delete process.env.RAG_ORACLE_CANARY;
      else process.env.RAG_ORACLE_CANARY = previousCanary;
    }
  }, 120_000);

  it('uses the platform native path separator and returns context-owned path objects', () => {
    const value = parse('/tmp/project-rag.txt');
    const results = run("return { separator: path.sep, namedSeparator: sep, parsed: path.parse('/tmp/project-rag.txt') };", ['path']);
    expect(results).toEqual([{ value: { separator: sep, namedSeparator: sep, parsed: value } }]);
  });
  it('keeps the crypto dependency available through a context-owned wrapper', () => {
    const results = run("return createHash('sha256').update('abc').digest('hex');", ['crypto']);
    expect(results).toEqual([{ value: createHash('sha256').update('abc').digest('hex') }]);
  });

  it('rejects process filesystem reads and writes without touching the canary', () => {
    const root = mkdtempSync(join(tmpdir(), 'project-rag-code-oracle-'));
    try {
      const canary = join(root, 'canary.txt');
      writeFileSync(canary, 'unchanged');
      const read = `const fs = process.getBuiltinModule('node:fs'); return fs.readFileSync(${JSON.stringify(canary)}, 'utf8');`;
      const write = `const fs = process.getBuiltinModule('node:fs'); fs.writeFileSync(${JSON.stringify(canary)}, 'changed'); return 'written';`;
      expect(() => run(read)).toThrow(/forbidden executable authority: process/);
      expect(() => run(write)).toThrow(/forbidden executable authority: process/);
      expect(readFileSync(canary, 'utf8')).toBe('unchanged');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects process and environment access', () => {
    expect(() => run("return process.env.RAG_ORACLE_CANARY;"))
      .toThrow(/forbidden executable authority: process/);
    expect(() => run("return globalThis.process.env.RAG_ORACLE_CANARY;"))
      .toThrow(/forbidden executable authority: globalThis/);
  });

  it('removes network globals from the participant context', () => {
    const results = run("return fetch('http://127.0.0.1:9');");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ error: { name: 'ReferenceError', message: 'fetch is not defined', code: null } });
  });

  it('rejects executable import, eval and direct constructor escapes', () => {
    expect(() => executeCodeProbe("export async function probe(){return import('node:fs');}", functionSpec(), {}, [{ args: [] }]))
      .toThrow(/forbidden executable authority: dynamic import/);
    expect(() => run("return eval('1');")).toThrow(/forbidden executable authority: eval/);
    expect(() => run("return ({} as any).constructor.constructor('return process')();"))
      .toThrow(/forbidden executable authority: constructor/);
  });

  it('does not expose the host function constructor through dependency wrappers', () => {
    const results = run("const key = 'con' + 'structor'; return (path.resolve as any)[key][key]('return process')();", ['path']);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ error: { name: 'EvalError' } });
    expect(results[0]).not.toHaveProperty('value');
  });
});