// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBE_FILES, evaluateFindings, sha256, verifyEvidence } from '../../scripts/coding-baseline/verify.mjs';

const historical = JSON.parse(readFileSync(new URL('../../harness/specs/fixtures/coding-vg-sts-jj-baseline/historical-observations.json', import.meta.url), 'utf8'));
const commit = 'a'.repeat(40);

function pack() {
  const probes = structuredClone(historical.probes);
  for (const value of Object.values(probes) as Array<{ candidate: string }>) value.candidate = commit;
  const files = new Map<string, Buffer>();
  for (const [name, file] of Object.entries(PROBE_FILES)) files.set(file as string, Buffer.from(JSON.stringify(probes[name])));
  files.set('inventory.json', Buffer.from(JSON.stringify({
    vg: { binaryMatchesManifest: true }, vs: { binaryMatchesManifest: true },
    sts: { contracts: [{ invalid: [] }, { invalid: [] }], environment: { python: 'fixture' }, wheel: { sha256: 'f'.repeat(64), binding: { verified: true } } },
    jj: { libraryVersion: '0.46.0', cliClaim: 'not-executed' }, corpus: [1, 2, 3].map(() => ({ verified: true })),
  })));
  const source = Buffer.from('test-fixture-source');
  const report = {
    schema: 'CodingBaselineEvidence/v1', driven_by: 'agent', realHumanEvidence: false, actor: 'test-fixture',
    candidate: { commit, dirty: false }, sourceInputs: [{ path: 'fixture.ts', sha256: sha256(source) }],
    commands: Object.keys(PROBE_FILES).map(probe => ({ probe, exitCode: 0, timedOut: false })),
    artifacts: Object.fromEntries([...files].map(([p, value]) => [p, { sha256: sha256(value) }])),
    findings: evaluateFindings(probes), baselineVerdict: 'established', productVerdict: 'needs-fix', releaseApproved: false,
    protocolScope: 'mechanism-baseline-not-performance-or-live-quality',
  };
  const options = {
    readArtifact: (p: string) => { const result = files.get(p); if (!result) throw new Error('missing artifact'); return result; },
    readSource: () => source,
    requiredSources: ['fixture.ts'], expectedCandidate: commit,
  };
  return { report, files, probes, options };
}

describe('coding baseline evidence is a failure baseline, never product acceptance', () => {
  it('recomputes ten known failures from the retained raw observations', () => {
    const { report, options } = pack();
    expect(verifyEvidence(report, options)).toEqual({ ok: true, issues: [], productVerdict: 'needs-fix' });
    expect(report.findings).toHaveLength(10);
    expect(report.findings.every((f: { productPass: boolean }) => f.productPass === false)).toBe(true);
  });

  it.each(['artifact', 'source', 'candidate', 'missing-source', 'command-timeout', 'product-promotion', 'scope-promotion', 'raw-omission', 'control-removal'])(
    'rejects %s even if a caller writes a successful summary', (defect) => {
      const { report, files, probes, options } = pack();
      if (defect === 'artifact') files.set(PROBE_FILES.worktrees, Buffer.from('{}'));
      if (defect === 'source') options.readSource = () => Buffer.from('changed');
      if (defect === 'candidate') report.candidate.commit = 'b'.repeat(40);
      if (defect === 'missing-source') report.sourceInputs = [];
      if (defect === 'command-timeout') report.commands[0].timedOut = true;
      if (defect === 'product-promotion') report.releaseApproved = true;
      if (defect === 'scope-promotion') report.protocolScope = 'full-production';
      if (defect === 'raw-omission') {
        const bytes = Buffer.from(JSON.stringify({ ...probes.worktrees, rows: [] }));
        files.set(PROBE_FILES.worktrees, bytes);
        report.artifacts[PROBE_FILES.worktrees].sha256 = sha256(bytes);
      }
      if (defect === 'control-removal') {
        probes.boundaries.rows = probes.boundaries.rows.filter((r: { id: string }) => r.id !== 'denied-write-journal-external');
        const bytes = Buffer.from(JSON.stringify(probes.boundaries));
        files.set(PROBE_FILES.boundaries, bytes);
        report.artifacts[PROBE_FILES.boundaries].sha256 = sha256(bytes);
      }
      expect(verifyEvidence(report, options).ok).toBe(false);
    },
  );
});
