// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { verifyVerseGitEvaluation as checkReport } from '../../scripts/coding-evaluation/verify-versegit.mjs';

const verifyVerseGitEvaluation = (report: unknown) => checkReport(report, {
  binarySha256: 'a'.repeat(64), capabilitiesSha256: 'b'.repeat(64), sourceCommit: 'c'.repeat(40),
});

const ids = ['m0-inert', 'm1-capabilities', 'm2-read', 'm3-bounded-read', 'owner-rejected', 'epoch-rejected',
  'binary-rejected', 'm4-rejected', 'six-dimensions', 'selected-rejected', 'stale-rejected', 'candidate-rejected',
  'observed-write-risk', 'rename-unobserved', 'delete-unobserved', 'missing-basis-partial'];
const fixture = () => ({ schema: 'CodingVgEvaluation/v1', driven_by: 'agent', realHumanEvidence: false,
  binary: { sha256: 'a'.repeat(64), capabilitiesSha256: 'b'.repeat(64) },
  manifest: { binarySha256: 'a'.repeat(64), capabilitiesSha256: 'b'.repeat(64), sourceCommit: 'c'.repeat(40) },
  cases: ids.map((id): { id: string; passed: boolean; actual: unknown } => ({ id, passed: true, actual: id === 'six-dimensions'
    ? { admitted: true, single_green_light: false, dimensions: { candidate: {}, execution: {}, evidence: {}, freshness: {}, risk: {}, trial: {} } }
    : id === 'm0-inert' ? { observation: { process_started: false } }
    : id === 'm1-capabilities' ? { status: 'observed', observation: { effects: { domainStateWrite: false } } }
    : ['m2-read','m3-bounded-read'].includes(id) ? { status: 'observed', observation: { effects: { workspaceWrite: false, execute: false } } }
    : ['owner-rejected','epoch-rejected','binary-rejected','m4-rejected'].includes(id) ? { status: 'rejected_by_policy', observation: { process_started: false } }
    : ['selected-rejected','stale-rejected','candidate-rejected'].includes(id) ? { admitted: false }
    : id === 'observed-write-risk' ? [{ kind: 'api-drift' }]
    : ['rename-unobserved','delete-unobserved'].includes(id) ? { values: { directFs: 'unobserved' } }
    : { status: 'partial' } })), commands: [{ id: 'fixture', exitCode: 0, stdout: '',
      outputSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }] as unknown[], cleanup: { ownedProcessSurvivors: 0, hostWorktreesDeleted: 0 },
});
describe('TF-0775 retained evaluation verifier', () => {
  it('accepts a complete current result envelope', () => {
    expect(verifyVerseGitEvaluation(fixture())).toEqual({ ok: true, issues: [] });
  });
  it('rejects a report that replaces both its binary and embedded manifest identity', () => {
    const report = fixture();
    report.binary.sha256 = '0'.repeat(64);
    report.manifest.binarySha256 = '0'.repeat(64);
    expect(verifyVerseGitEvaluation(report).ok).toBe(false);
  });
  it.each([null, { id: 'bad', exitCode: 0, stdout: 9 }])('returns rejection for malformed command %j', (command) => {
    const report = fixture();
    report.commands = [command];
    expect(verifyVerseGitEvaluation(report).ok).toBe(false);
  });
  it.each(['missing-case','failed-case','wrong-binary','collapsed-dimensions','leaked-process'] as const)('rejects %s', (kind) => {
    const report = fixture();
    if (kind === 'missing-case') report.cases.pop();
    if (kind === 'failed-case') report.cases[0].passed = false;
    if (kind === 'wrong-binary') report.binary.sha256 = '0'.repeat(64);
    if (kind === 'collapsed-dimensions') report.cases.find((entry) => entry.id === 'six-dimensions')!.actual = {};
    if (kind === 'leaked-process') report.cleanup.ownedProcessSurvivors = 1;
    expect(verifyVerseGitEvaluation(report).ok).toBe(false);
  });
});
