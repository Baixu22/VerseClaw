// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyMissingModuleFailure, linkGraderDependencies, missingModuleDiagnostics, prepareGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } from '../../scripts/lib/rsi-live-grader.mjs';
import { sha256File } from '../../scripts/rsi-tf0604-baseline.mjs';

const ROOT = process.cwd(), TEMP = 'D:/tmp', roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(TEMP, 'rsi-live-grader-test-')); roots.push(root);
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=offline-grader-test', '-c', 'user.email=grader@example.invalid', ...args], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
  write('package.json', '{"type":"module"}');
  write('vitest.config.mjs', 'export default { test: { environment:"node", include:["tests/**/*.test.ts"], maxWorkers:1 } };');
  write('src/subject.mjs', 'export const value = 0;');
  git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'unresolved'); const base = git('rev-parse', 'HEAD');
  write('src/subject.mjs', 'export const value = 1;');
  write('tests/subject.test.ts', 'import { it, expect } from "vitest"; import {value} from "../src/subject.mjs"; it("requires implemented value",()=>expect(value).toBe(1));');
  git('add', '.'); git('commit', '-q', '-m', 'reference'); const reference = git('rev-parse', 'HEAD');
  const record = 'evidence/source.json'; write(record, JSON.stringify({ candidate: { base, commit: reference } }));
  const task = { id: 'fixture-task', input: { targetScope: ['src/subject.mjs'] },
    referenceSolution: { sourceRecord: record, sourceRecordSha256: sha256File(join(root, record)), referenceCommit: reference },
    oracle: { commandLines: ['pnpm exec vitest run tests/subject.test.ts --maxWorkers=1'], testPaths: ['tests/subject.test.ts'],
      inputDigests: { 'tests/subject.test.ts': sha256File(join(root, 'tests/subject.test.ts')) }, expectedSkips: 0, expectedTestCount: 1 } };
  write('harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json', JSON.stringify({ tasks: [task] }));
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'junction');
  return { root, task: resolveHistoricalTask(root, 'fixture-task'), base, reference };
}
afterAll(() => {
  for (const root of roots) {
    if (!resolve(root).startsWith(`${resolve(TEMP)}${sep}rsi-live-grader-test-`)) throw Error('unsafe cleanup');
    rmdirSync(join(root, 'node_modules'));
    rmSync(root, { recursive: true, force: true });
  }
});

describe('live task grader independent execution', () => {
  it('reconstructs only explicitly bound source files before applying edits and preserves reference and oracle bytes', async () => {
    const { root, task, base, reference } = fixture();
    const baseBytes = execFileSync('git', ['show', `${base}:src/subject.mjs`], { cwd: root, windowsHide: true });
    const binding = { ...task, baselineSetup: { kind: 'implementation-reconstruction',
      removePaths: [{ path: 'src/subject.mjs', sha256: createHash('sha256').update(baseBytes).digest('hex') }] } };
    const baseline = join(root, 'reconstructed');
    await prepareGradeWorkspace({ root, task: binding, workspace: baseline, revision: base });
    expect(existsSync(join(baseline, 'src/subject.mjs'))).toBe(false);
    expect(readFileSync(join(baseline, 'tests/subject.test.ts'), 'utf8')).toContain('requires implemented value');
    const solved = join(root, 'reconstructed-solved');
    await prepareGradeWorkspace({ root, task: binding, workspace: solved, revision: base,
      edits: [{ path: 'src/subject.mjs', content: 'export const value = 1;' }] });
    expect((await runLiveTaskOracles({ root, task: binding, workspace: solved, outDir: join(root, 'reconstructed-oracle') })).passed).toBe(true);
    const ref = join(root, 'reconstructed-reference');
    await prepareGradeWorkspace({ root, task: binding, workspace: ref, revision: reference });
    expect(readFileSync(join(ref, 'src/subject.mjs'), 'utf8')).toContain('value = 1');
    await expect(prepareGradeWorkspace({ root, task: { ...binding, baselineSetup: { ...binding.baselineSetup,
      removePaths: [{ path: 'tests/subject.test.ts', sha256: 'bad' }] } }, workspace: join(root, 'bad-reconstruction'), revision: base })).rejects.toThrow('invalid reconstruction target');
  });

  it('rejects an isolated support package whose version differs from the historical declaration', () => {
    const { root } = fixture();
    const workspace = join(root, 'exact-support');
    const importer = join(workspace, 'openclaw_runtime/packages/markdown-core');
    const support = join(root, 'support');
    mkdirSync(importer, { recursive: true });
    mkdirSync(join(support, 'node_modules/markdown-it'), { recursive: true });
    writeFileSync(join(importer, 'package.json'), JSON.stringify({ dependencies: { 'markdown-it': '14.2.0' } }));
    writeFileSync(join(support, 'node_modules/markdown-it/package.json'), JSON.stringify({ version: '14.1.1' }));
    expect(() => linkGraderDependencies(root, workspace, [], support)).toThrow('oracle support version mismatch');
    writeFileSync(join(support, 'node_modules/markdown-it/package.json'), JSON.stringify({ version: '14.2.0' }));
    const links = linkGraderDependencies(root, workspace, [], support);
    expect(links).toHaveLength(1);
    for (const link of links) rmdirSync(link);
  });
  it('executes a genuine fail-first baseline and passing reference with frozen hidden tests', async () => {
    const { root, task, base, reference } = fixture();
    for (const [label, revision, passed] of [['baseline', base, false], ['reference', reference, true]] as const) {
      const workspace = join(root, label);
      await prepareGradeWorkspace({ root, task, workspace, revision });
      const report = await runLiveTaskOracles({ root, task, workspace, outDir: join(root, `${label}-oracle`), timeoutMs: 20000 });
      expect(report.passed).toBe(passed);
      expect(report.oracleUnchanged).toBe(true);
      expect(report.numTotalTests).toBe(1);
      expect(report.executions[0].exitCode).toBe(passed ? 0 : 1);
      expect(report.failureClass).toBe(passed ? null : 'assertion');
      expect(readFileSync(report.executions[0].stdoutPath, 'utf8')).toContain('JSON report written');
    }
  });

  it('restores hidden oracle bytes from the reference revision, not mutable root files', async () => {
    const { root, task, reference } = fixture();
    expect(task.oracleRevision).toBe(reference);
    expect(task.oracleTestDigests['tests/subject.test.ts']).toBe(sha256File(join(root, 'tests/subject.test.ts')));
    writeFileSync(join(root, 'tests/subject.test.ts'), 'throw new Error("mutated root oracle")');
    const workspace = join(root, 'reference-bound');
    await prepareGradeWorkspace({ root, task, workspace, revision: reference });
    expect(readFileSync(join(workspace, 'tests/subject.test.ts'), 'utf8')).toContain('requires implemented value');
    const report = await runLiveTaskOracles({ root, task, workspace, outDir: join(root, 'reference-bound-oracle'), timeoutMs: 20000 });
    expect(report.passed).toBe(true);
    expect(report.oracleRevision).toBe(reference);
  });

  it('links runtime dependencies for a runtime oracle command', () => {
    const { root } = fixture();
    mkdirSync(join(root, 'openclaw_runtime'), { recursive: true });
    const workspace = join(root, 'runtime-linked');
    mkdirSync(join(workspace, 'openclaw_runtime'), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    symlinkSync(join(ROOT, 'openclaw_runtime', 'node_modules'), join(root, 'openclaw_runtime', 'node_modules'), 'junction');
    const links = linkGraderDependencies(root, workspace, [{ usesRootDeps: false, usesRuntimeDeps: true }]);
    expect(links).toEqual([join(workspace, 'openclaw_runtime', 'node_modules')]);
    expect(existsSync(join(workspace, 'openclaw_runtime', 'node_modules'))).toBe(true);
    for (const link of links) rmdirSync(link);
    rmdirSync(join(root, 'openclaw_runtime', 'node_modules'));
  });

  it('links declared oracle support packages into their package-local node_modules', () => {
    const { root } = fixture();
    const workspace = join(root, 'support-linked');
    const importer = 'openclaw_runtime/packages/markdown-core';
    const source = join(root, 'openclaw_runtime/node_modules/.pnpm/markdown-it@14.1.1/node_modules/markdown-it');
    mkdirSync(source, { recursive: true });
    mkdirSync(join(workspace, importer), { recursive: true });
    const links = linkGraderDependencies(root, workspace, []);
    const target = join(workspace, importer, 'node_modules', 'markdown-it');
    expect(links).toContain(target);
    expect(existsSync(target)).toBe(true);
    rmdirSync(target);
  });

  it('rejects tampered oracle bytes before executing them', async () => {
    const { root, task, reference } = fixture(), workspace = join(root, 'tamper');
    await prepareGradeWorkspace({ root, task, workspace, revision: reference });
    writeFileSync(join(workspace, 'tests/subject.test.ts'), 'throw new Error("changed oracle")');
    await expect(runLiveTaskOracles({ root, task, workspace, outDir: join(root, 'tamper-oracle') })).rejects.toThrow('frozen-oracle-input-drift');
  });

  it('separates target-scoped absence from missing infrastructure dependencies', () => {
    const { task } = fixture();
    expect(classifyMissingModuleFailure([])).toEqual({ failureClass: 'assertion', inTargetScope: false, diagnostics: [] });
    expect(classifyMissingModuleFailure([{ kind: 'missing-module', missingPath: 'src/new.js', inTargetScope: true }]).failureClass).toBe('target-module-absent');
    expect(classifyMissingModuleFailure([{ kind: 'missing-module', missingPath: 'tslog', inTargetScope: false }]).failureClass).toBe('infrastructure');
    expect(classifyMissingModuleFailure([{ kind: 'missing-module', missingPath: 'src/new.js', inTargetScope: true }, { kind: 'missing-module', missingPath: 'kysely', inTargetScope: false }]).failureClass).toBe('infrastructure');
    const packageReport = { testResults: [{ name: 'D:/tmp/workspace/tests/unit/runtime.test.ts', message: "Cannot find package 'kysely' imported from workspace/openclaw_runtime/src/infra/kysely-sync.ts", assertionResults: [] }] };
    expect(missingModuleDiagnostics(packageReport, 'D:/tmp/workspace', { ...task, input: { ...task.input, targetScope: [] } })).toMatchObject([{ kind: 'missing-module', missingPath: 'kysely', inTargetScope: false }]);
  });

  it('classifies a missing module from the top-level suite message and task scope', () => {
    const { task } = fixture();
    const report = { testResults: [{ name: 'D:/tmp/workspace/tests/subject.test.ts', message: "Cannot find module './subject.mjs'", assertionResults: [] }] };
    expect(missingModuleDiagnostics(report, 'D:/tmp/workspace', task)).toEqual([
      { kind: 'missing-module', missingPath: 'tests/subject.mjs', importer: 'tests/subject.test.ts', inTargetScope: false },
    ]);
    const scoped = { ...task, input: { targetScope: ['tests/subject.mjs'] } };
    expect(missingModuleDiagnostics(report, 'D:/tmp/workspace', scoped)[0].inTargetScope).toBe(true);
  });

  it('rejects model edits to hidden tests or outside the declared task scope', async () => {
    const { root, task, base } = fixture();
    await expect(prepareGradeWorkspace({ root, task, workspace: join(root, 'bad-edit'), revision: base,
      edits: [{ path: 'tests/subject.test.ts', content: '' }] })).rejects.toThrow('hidden oracle');
  });
});
