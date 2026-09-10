import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { sha256CanonicalEvidenceFile } from '../../scripts/lib/canonical-evidence-hash.mjs';

type Finding = {
  id: string;
  severity: string;
  status: string;
};

const registry = JSON.parse(
  readFileSync(join(process.cwd(), 'plans/system-maturity/findings-registry.json'), 'utf8'),
) as {
  findings: Finding[];
  findingIds: string[];
  tasks: Record<string, unknown>;
  counts: {
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
    open: number;
    fixed: number;
    tasks: number;
    findings: number;
  };
};
const validator = join(process.cwd(), 'scripts/validate-system-maturity-findings-registry.mjs');
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

function countBy(values: string[], statuses: string[]): Record<string, number> {
  return Object.fromEntries(
    statuses.map((status) => [status, values.filter((value) => value === status).length]),
  );
}

describe('system maturity findings registry counts', () => {
  it('validates the checked-in count snapshot against the findings array', () => {
    const severities = ['Critical', 'High', 'Medium', 'Low'];
    const statuses = ['Open', 'Fixed', 'Partial', 'Unverified'];
    const bySeverity = countBy(registry.findings.map((finding) => finding.severity), severities);
    const byStatus = countBy(registry.findings.map((finding) => finding.status), statuses);

    expect(registry.counts).toMatchObject({
      total: registry.findings.length,
      bySeverity,
      byStatus,
      open: byStatus.Open ?? 0,
      fixed: byStatus.Fixed ?? 0,
      tasks: Object.keys(registry.tasks).length,
      findings: registry.findings.length,
    });

    expect(execFileSync(process.execPath, [validator], { encoding: 'utf8' })).toContain(
      'findings registry: OK',
    );
  });

  it('fails closed when a finding changes without refreshing top-level counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-findings-registry-'));
    try {
      const mutated = structuredClone(registry);
      mutated.findings[0].status = 'Open';
      const file = join(root, 'registry.json');
      writeFileSync(file, `${JSON.stringify(mutated)}\n`, 'utf8');
      const result = spawnSync(process.execPath, [validator, '--file', file], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('counts.byStatus');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the task registry changes without refreshing counts.tasks', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-findings-registry-tasks-'));
    try {
      const mutated = structuredClone(registry);
      mutated.tasks['P9-999'] = {
        id: 'P9-999',
        owner: 'test',
        reviewer: 'test',
        findings: [],
        dependsOn: [],
        path: 'plans/test/P9-999.md',
      };
      const file = join(root, 'registry.json');
      writeFileSync(file, `${JSON.stringify(mutated)}\n`, 'utf8');
      const result = spawnSync(process.execPath, [validator, '--file', file], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('counts.tasks');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps findingIds mirroring the findings array', () => {
    expect([...registry.findingIds].sort()).toEqual(
      [...registry.findings.map((finding) => finding.id)].sort(),
    );
  });

  it('keeps frozen P2-005 evidence separate from current governance sources', () => {
    const finding = JSON.parse(
      readFileSync(join(process.cwd(), 'plans/system-maturity/findings-registry.json'), 'utf8'),
    ).findings.find((entry: { id: string }) => entry.id === 'F-AUTH-003');
    expect(finding.status).toBe('Partial');
    expect(finding.historicalEvidence.classification).toBe('historical-frozen');
    expect(finding.historicalEvidence.artifacts).toEqual(
      expect.arrayContaining([
        'artifacts/system-maturity/P2-005/P2-005.delivery.md',
        'artifacts/system-maturity/P2-ACCEPTANCE/report.json',
      ]),
    );

    const currentDelivery = readFileSync(
      join(process.cwd(), 'plans/system-maturity/phase2-authorization-isolation/tasks/P2-005.delivery.md'),
      'utf8',
    );
    expect(currentDelivery).toMatch(/^STATUS: blocked$/m);
    expect(currentDelivery).toContain('HISTORICAL_DELIVERY_STATUS: done (2026-07-17; API-level evidence only)');
    const phaseStatus = JSON.parse(readFileSync(
      join(process.cwd(), 'plans/system-maturity/phase2-authorization-isolation/STATUS.json'), 'utf8',
    ));
    expect(phaseStatus).toMatchObject({
      phaseStatus: 'blocked', allTasksDone: false, tasks: { 'P2-005': 'blocked' },
    });
    const evidence = currentDelivery.match(/^EVIDENCE: (.+)$/m)?.[1].split(';').map((entry) => entry.trim()) ?? [];
    expect(evidence).toHaveLength(3);
    for (const entry of evidence) {
      expect(entry).toMatch(/^artifacts\/system-maturity\/P2-005\/[^;]+#sha256=[a-f0-9]{64}$/);
      const [file, hash] = entry.split('#sha256=');
      expect(sha256CanonicalEvidenceFile(join(process.cwd(), file))).toBe(hash);
    }
    expect(currentDelivery).toContain('BLOCKERS: production CVK engine does not consume denied');
    expect(currentDelivery).not.toContain('BLOCKERS: none');
  });

  it('runs the guard from the effective maturity and DCS L1 entry points', () => {
    expect(packageJson.scripts['maturity:validate']).toContain('validate-system-maturity-findings-registry.mjs');
    expect(packageJson.scripts['test:dcs']).toContain('pnpm run maturity:findings:check');
    expect(packageJson.scripts['test:dcs']).toContain(
      'tests/unit/system-maturity-findings-registry.test.ts',
    );
  });

  it('keeps current P2-005 sources free of stale Fixed/enforce acceptance claims', () => {
    const currentSources = [
      'plans/system-maturity/phase2-authorization-isolation/tasks/P2-005.md',
      'plans/system-maturity/phase2-authorization-isolation/tasks/P2-005.delivery.md',
      'plans/system-maturity/phase2-authorization-isolation/PLAN.md',
      'plans/system-maturity/risk-acceptance.json',
    ];
    for (const file of currentSources) {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text, file).not.toMatch(/F-AUTH-003\s+Fixed/i);
      expect(text, file).not.toMatch(/F-AUTH-003[^\n]*CVK[^\n]*enforce/i);
    }
  });
});
