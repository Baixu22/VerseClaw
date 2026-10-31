// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAdjudicationReport, verifyAdjudicationReport } from '../../scripts/agent-first-adjudicate.mjs';

const root = process.cwd();
const plan = 'harness/specs/fixtures/agent-first-system/adjudication/plan.v1.json';

describe('Agent First independent adjudication', () => {
  it('builds a current-candidate dimension report and verifies it from disk', () => {
    const report = buildAdjudicationReport(root, plan, 'codex/adjudicator-reviewer');
    expect(report).toMatchObject({
      schemaVersion: 'AgentFirstAdjudicationReport/v1',
      taskId: 'TF-0595',
      verdict: 'not-release-ready',
      claims: { realHuman: false, releaseApproved: false, evidenceFresh: true },
    });
    expect(report.dimensions.engineering.status).toBe('pass');
    expect(report.dimensions.operational.status).toBe('pass');
    expect(report.dimensions.distribution.status).toBe('not-run');
    const dir = mkdtempSync('D:/tmp/agent-first-adjudication-test-');
    const reportPath = join(dir, 'review.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    expect(verifyAdjudicationReport(root, plan, reportPath, 'codex/adjudicator-verifier')).toMatchObject({ verification: 'pass', reportVerdict: 'not-release-ready' });
  });

  it('rejects same-actor review and a tampered report', () => {
    expect(() => buildAdjudicationReport(root, plan, 'codex/agent-first-executor')).toThrow('reviewer actor must differ from executor');
    const report = buildAdjudicationReport(root, plan, 'codex/adjudicator-reviewer');
    report.dimensions.operational.status = 'fail';
    const dir = mkdtempSync('D:/tmp/agent-first-adjudication-tamper-');
    const reportPath = join(dir, 'review.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    expect(() => verifyAdjudicationReport(root, plan, reportPath, 'codex/adjudicator-verifier')).toThrow('report dimensions differ from disk replay');
  });
});
