// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCandidateReport, verifyCandidateReport } from '../../scripts/agent-first-mainline.mjs';

const root = process.cwd();

describe('Agent First Windows acceptance mainline', () => {
  it('maps all 14 matrix stages to commands, actors, artifacts and current verdicts', () => {
    const report = buildCandidateReport(root);
    expect(report).toMatchObject({ schemaVersion: 'AgentFirstCandidateReport/v1', verdict: 'not-release-ready', releaseApproved: false });
    expect(report.gates).toHaveLength(14);
    expect(report.gates.every((gate: any) => gate.command && gate.oracle && gate.negative && gate.artifact && gate.actor && gate.skipBudget === 0)).toBe(true);
    expect(report.productLocks).toEqual({ humanAcceptanceRequired: false, humanEvidenceClaimed: false, drivenBy: 'agent', releaseApproved: false, liveReady: false, productApproved: false, defaultOn: false });
    expect(report.historicalVerdicts.every((entry: any) => entry.currentCandidate === false && entry.historical === true)).toBe(true);
    const dir = mkdtempSync('D:/tmp/agent-first-mainline-test-'), path = join(dir, 'candidate-report.json');
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    expect(verifyCandidateReport(root, path)).toMatchObject({ verification: 'pass', gates: 14, verdict: 'not-release-ready' });
  });

  it('rejects a gate status change in the candidate report', () => {
    const report = buildCandidateReport(root);
    report.gates.find((gate: any) => gate.id === 'D1').status = 'pass';
    const dir = mkdtempSync('D:/tmp/agent-first-mainline-tamper-'), path = join(dir, 'candidate-report.json');
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    expect(() => verifyCandidateReport(root, path)).toThrow('candidate report differs: gates');
  });
});