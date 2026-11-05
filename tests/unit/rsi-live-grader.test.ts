// @vitest-environment node
import { execFileSync } from 'node:child_process';
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
  git('add', '.'); git('commit', '-q', '-m', 'reference'); const reference = git('rev-parse', 'HEAD');
  write('tests/subject.test.ts', 'import { it, expect } from "vitest"; import {value} from "../src/subject.mjs"; it("requires implemented value",()=>expect(value).toBe(1));');
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

  it('rejects tampered oracle bytes before executing them', async () => {
    const { root, task, reference } = fixture(), workspace = join(root, 'tamper');
    await prepareGradeWorkspace({ root, task, workspace, revision: reference });
    writeFileSync(join(workspace, 'tests/subject.test.ts'), 'throw new Error("changed oracle")');
    await expect(runLiveTaskOracles({ root, task, workspace, outDir: join(root, 'tamper-oracle') })).rejects.toThrow('frozen-oracle-input-drift');
  });

  it('separates target-scoped absence from missing infrastructure dependencies', () => {
    expect(classifyMissingModuleFailure([])).toEqual({ failureClass: 'assertion', inTargetScope: false, diagnostics: [] });
    expect(classifyMissingModuleFailure([{ kind: 'missing-module', missingPath: 'src/new.js', inTargetScope: true }]).failureClass).toBe('target-module-absent');
    expect(classifyMissingModuleFailure([{ kind: 'missing-module', missingPath: 'tslog', inTargetScope: false }]).failureClass).toBe('infrastructure');
    expect(classifyMissingModuleFailure([{ kind: 'missing-module', missingPath: 'src/new.js', inTargetScope: true }, { kind: 'missing-module', missingPath: 'kysely', inTargetScope: false }]).failureClass).toBe('infrastructure');
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
