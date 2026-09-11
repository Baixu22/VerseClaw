import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCapturedOutput } from '../../scripts/lib/captured-output-redaction.mjs';
import { validateSystemMaturityTraceability } from '../../scripts/lib/system-maturity-traceability.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function write(root: string, relative: string, content: string) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(options: {
  taskId?: string;
  taskChecked?: boolean;
  findingTasks?: string[];
  auditTestId?: string;
  sourceTime?: number;
  evidenceTime?: number;
  globalEvidenceOk?: boolean;
  tamperGlobalLog?: boolean;
  globalFindingIds?: string[];
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clawx-p7-traceability-'));
  const taskId = options.taskId ?? 'P0-001';
  const findingTasks = options.findingTasks ?? [taskId];
  const taskPath = `plans/system-maturity/phase0/tasks/${taskId}.md`;
  write(root, 'src/code.ts', 'export const covered = true;\n');
  write(root, 'tests/unit/covered.test.ts', 'export {};\n');
  write(root, 'artifacts/system-maturity/P0-001/evidence.txt', 'ok\n');
  if (options.globalEvidenceOk !== undefined) {
    const stdout = 'global ok\n';
    const stderr = '';
    write(root, 'artifacts/system-maturity/P7-001/gates/global.stdout.txt', stdout);
    write(root, 'artifacts/system-maturity/P7-001/gates/global.stderr.txt', stderr);
    write(root, 'artifacts/system-maturity/P7-001/full-validation.json', `${JSON.stringify({
      ok: options.globalEvidenceOk,
      findingIds: options.globalFindingIds,
      commands: [{
        id: 'global',
        exitCode: options.globalEvidenceOk ? 0 : 1,
        stdout: 'artifacts/system-maturity/P7-001/gates/global.stdout.txt',
        stdoutSha256: digest(stdout),
        stderr: 'artifacts/system-maturity/P7-001/gates/global.stderr.txt',
        stderrSha256: digest(stderr),
      }],
    })}\n`);
    if (options.tamperGlobalLog) {
      write(root, 'artifacts/system-maturity/P7-001/gates/global.stdout.txt', 'tampered\n');
    }
  }
  write(root, 'reports/audit-findings.json', `${JSON.stringify({
    findings: [{
      id: 'F-GOV-001',
      evidence: ['src/code.ts:1'],
      acceptance: [`${options.auditTestId ?? 'T-GOV-001'}: coverage`],
    }],
  }, null, 2)}\n`);
  write(root, taskPath, `# ${taskId} — fixture\n\nOwner: program-governance\nReviewer: qa-governance\nFindings: F-GOV-001\nDepends on: none\n\n## Tests\n\n- pnpm test tests/unit/covered.test.ts\n\n## Acceptance\n\n- [${options.taskChecked === false ? ' ' : 'x'}] A1: covered\n`);
  write(root, `plans/system-maturity/phase0/tasks/${taskId}.delivery.md`, `TASK_ID: ${taskId}\nSTATUS: done\nOWNER: program-governance\nCHANGED: src/code.ts; tests/unit/covered.test.ts\nTESTS: pnpm test tests/unit/covered.test.ts\nRESULTS: exit=0\nEVIDENCE: artifacts/system-maturity/P0-001/evidence.txt#sha256=${digest('ok\n')}\nACCEPTANCE: A1\nBLOCKERS: none\nNEXT: none\n`);
  write(root, 'plans/system-maturity/phase0/STATUS.json', `${JSON.stringify({
    phase: 'phase0',
    phaseStatus: 'done',
    tasks: { [taskId]: 'done' },
    allTasksDone: true,
  }, null, 2)}\n`);
  write(root, 'plans/system-maturity/findings-registry.json', `${JSON.stringify({
    schemaVersion: 1,
    source: { findingsPath: 'reports/audit-findings.json' },
    traceabilityPolicy: {
      reviewCycleDaysBySeverity: { Critical: 14, High: 30, Medium: 60, Low: 90 },
      globalEvidence: options.globalEvidenceOk === undefined
        ? []
        : ['artifacts/system-maturity/P7-001/full-validation.json'],
    },
    findings: [{
      id: 'F-GOV-001',
      status: 'Fixed',
      severity: 'High',
      tasks: findingTasks,
    }],
    tasks: {
      [taskId]: {
        id: taskId,
        owner: 'program-governance',
        reviewer: 'qa-governance',
        findings: ['F-GOV-001'],
        dependsOn: [],
        path: taskPath,
      },
    },
  }, null, 2)}\n`);

  const sourceTime = options.sourceTime ?? 200;
  const evidenceTime = options.evidenceTime ?? 300;
  const times = new Map<string, number>([
    ['src/code.ts', sourceTime],
    ['tests/unit/covered.test.ts', sourceTime],
    ['reports/audit-findings.json', evidenceTime],
    ['artifacts/system-maturity/P0-001/evidence.txt', evidenceTime],
    ['artifacts/system-maturity/P7-001/full-validation.json', 10_000],
    ['artifacts/system-maturity/P7-001/gates/global.stdout.txt', 10_000],
    ['artifacts/system-maturity/P7-001/gates/global.stderr.txt', 10_000],
  ]);
  return {
    root,
    run: () => validateSystemMaturityTraceability({
      root,
      now: new Date(1_000),
      evaluatedAt: new Date(1_000),
      getModifiedAt: (relativePath: string) => times.get(relativePath) ?? 100,
    }),
  };
}

describe('P7-001 System Maturity traceability', () => {
  it('redacts Windows workspace and user-home paths before collector logs are hashed', () => {
    const workspaceRoot = 'C:\\Users\\fixture-user\\Desktop\\clawx\\ClawX';
    const userHome = 'C:\\Users\\fixture-user';
    const output = normalizeCapturedOutput([
      `${workspaceRoot}\\tests\\unit\\traceability.test.ts`,
      'C:/Users/fixture-user/Desktop/clawx/ClawX/artifacts/report.json',
      `${userHome}\\AppData\\Local\\Temp\\collector.log`,
      'C:/Users/fixture-user/.cache/pnpm/store',
      '',
    ].join('\n'), { workspaceRoot, userHome });

    expect(output).toBe([
      '[workspace]\\tests\\unit\\traceability.test.ts',
      '[workspace]/artifacts/report.json',
      '[user-home]\\AppData\\Local\\Temp\\collector.log',
      '[user-home]/.cache/pnpm/store',
      '',
    ].join('\n'));
    expect(output).not.toMatch(/C:\\Users\\/iu);
    expect(output).not.toMatch(/C:\/Users\//iu);
  });

  it('synchronizes delivery hashes before validating evidence in the collector', () => {
    const collector = readFileSync(join(process.cwd(), 'scripts/collect-p7-001-evidence.mjs'), 'utf8');
    const hashSyncIndex = collector.indexOf("['delivery-hash-sync'");
    const evidenceValidateIndex = collector.indexOf("['evidence-validate'");
    expect(hashSyncIndex).toBeGreaterThan(-1);
    expect(evidenceValidateIndex).toBeGreaterThan(hashSyncIndex);
  });

  it('serializes native operator inspection outside the parallel unit shard', () => {
    const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).scripts;
    expect(scripts.test).toContain('--exclude tests/unit/runtime-memory-operator-inspection.test.ts');
    expect(scripts.test).toContain('tests/unit/runtime-memory-operator-inspection.test.ts --maxWorkers=1');
  });

  it('resolves Finding, task, test, code, evidence, owner, and review cadence', () => {
    const report = fixture().run();
    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({ findingCount: 1, taskCount: 1, testCount: 1, staleCount: 0 });
    expect(report.findings[0]).toMatchObject({
      id: 'F-GOV-001',
      owner: 'program-governance',
      testIds: ['T-GOV-001'],
      freshness: 'fresh',
    });
    expect(report.findings[0].codePaths).toContain('src/code.ts');
  });

  it('fails orphan task and mismatched test links', () => {
    const report = fixture({ findingTasks: ['P0-999'], auditTestId: 'T-GOV-999' }).run();
    expect(report.ok).toBe(false);
    expect(report.fail.join('\n')).toContain('orphan task link P0-999');
    expect(report.fail.join('\n')).toContain('orphan or mismatched test T-GOV-999');
  });

  it('downgrades evidence that predates linked code or tests', () => {
    const report = fixture({ sourceTime: 5_000, evidenceTime: 300 }).run();
    expect(report.ok).toBe(false);
    expect(report.findings[0].freshness).toBe('stale');
    expect(report.fail.join('\n')).toContain('linked source is newer than evidence');
  });

  it('does not accept a failed full-validation report as freshness evidence', () => {
    const report = fixture({ sourceTime: 5_000, evidenceTime: 300, globalEvidenceOk: false }).run();
    expect(report.ok).toBe(false);
    expect(report.findings[0].freshness).toBe('stale');
    expect(report.findings[0].evidence.some((item: any) => item.kind === 'global-validation')).toBe(false);
  });

  it('rejects a successful report when a captured gate log was tampered', () => {
    const report = fixture({
      sourceTime: 5_000,
      evidenceTime: 300,
      globalEvidenceOk: true,
      tamperGlobalLog: true,
    }).run();
    expect(report.ok).toBe(false);
    expect(report.fail.join('\n')).toContain('global.stdout hash mismatch or missing');
    expect(report.findings[0].freshness).toBe('stale');
  });

  it('does not use scoped global evidence for an unrelated Finding', () => {
    const report = fixture({
      sourceTime: 5_000,
      evidenceTime: 300,
      globalEvidenceOk: true,
      globalFindingIds: ['F-OTHER-001'],
    }).run();
    expect(report.ok).toBe(false);
    expect(report.findings[0].freshness).toBe('stale');
    expect(report.findings[0].evidence.some((item: any) => item.kind === 'global-validation')).toBe(false);
  });

  it('fails a done task without checked acceptance evidence', () => {
    const report = fixture({ taskChecked: false }).run();
    expect(report.ok).toBe(false);
    expect(report.fail.join('\n')).toContain('done task P0-001 has unchecked acceptance');
  });
});
