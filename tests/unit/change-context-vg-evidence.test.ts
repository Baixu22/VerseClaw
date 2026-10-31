// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeContextProjection } from '@shared/types/change-context';
import { createChangeContextVgEvidenceReader } from '@electron/services/change-context-vg-evidence';

const projection: ChangeContextProjection = { schemaVersion: 1, contextId: 'context-1',
  identity: { workspaceId: 'workspace-1', sessionKey: 'agent:main:main', runId: 'run-1', turn: null },
  comparison: null, diff: null, comments: [], evidence: [], issues: [], generatedAt: '' };
const workspace = async () => ({ id: 'workspace-1', rootPath: 'D:/agent-fixture' }) as never;
// Mapping fixtures only: these are not claimed as real execution receipts.
function receipt(overrides: Record<string, unknown> = {}) {
  return { workspaceRoot: 'D:/agent-fixture', candidateId: 'candidate-1', receiptId: 'receipt-1', candidateCommitOid: 'commit-1', refs: ['receipts/fixture.json'],
    verdict: { schema: 'clawx.versegit.receipt-verdict/v1', planId: 'run-1', receiptId: 'receipt-1', status: 'observed',
      reasons: [], dimensions: { candidate: 'observed', execution: 'verified', evidence: 'receipt-bound', freshness: 'epoch:1', risk: 'unknown', trial: 'not_run' },
      realVerseshellExecution: true, evidenceGrade: 'direct-receipt', hostVerdict: 'unchanged', singleGreenLight: false, issues: [], ...overrides } } as never;
}
afterEach(() => vi.unstubAllEnvs());
describe('read-only Change Context VG projection', () => {
  it('makes zero workspace, observation or receipt calls with the existing gate off', async () => {
    vi.stubEnv('CLAWX_VERSGIT_BINDING_ENABLED', '0');
    const observations = vi.fn(); const readReceipt = vi.fn(); const readWorkspace = vi.fn();
    expect(await createChangeContextVgEvidenceReader({ workspace: readWorkspace, observations, receipt: readReceipt })(projection)).toEqual([]);
    expect(observations).not.toHaveBeenCalled(); expect(readReceipt).not.toHaveBeenCalled(); expect(readWorkspace).not.toHaveBeenCalled();
  });
  it('keeps missing receipt partial/unmeasured and candidate unavailable', async () => {
    const evidence = await createChangeContextVgEvidenceReader({ enabled: () => true, workspace, observations: () => null, receipt: () => null })(projection);
    expect(evidence).toMatchObject([{ kind: 'candidate', state: 'unavailable', execution: 'unmeasured' }, { kind: 'receipt', state: 'partial', execution: 'unmeasured' }]);
    expect(evidence.every((entry) => entry.advisory && entry.hostVerdict === 'unchanged')).toBe(true);
  });
  it('keeps stale-read warnings advisory and does not flatten partial coverage to clean', async () => {
    const observations = () => ({ bindingId: 'binding-1', baseCommit: 'base', phase: 'attached', coverage: null,
      staleReads: [{ findingId: 'finding-1', path: 'src/example.ts', host_verdict: 'unchanged' }] }) as never;
    const evidence = await createChangeContextVgEvidenceReader({ enabled: () => true, workspace, observations, receipt: () => null })(projection);
    expect(evidence[0]).toMatchObject({ kind: 'stale-read', state: 'stale', advisory: true, hostVerdict: 'unchanged', paths: ['src/example.ts'] });
    expect(projection.comparison).toBeNull(); expect(projection.evidence).toEqual([]);
  });
  it.each([{ realVerseshellExecution: false }, { evidenceGrade: 'normalized-event' }, { hostVerdict: 'changed' }, { singleGreenLight: true }, { receiptId: 'another' }, { planId: 'another-run' }])('rejects a structural or authority-changing green receipt: %j', async (override) => {
    const evidence = await createChangeContextVgEvidenceReader({ enabled: () => true, workspace, observations: () => null, receipt: () => receipt(override) })(projection);
    expect(evidence.at(-1)).toMatchObject({ state: 'partial', execution: 'unmeasured', hostVerdict: 'unchanged' });
  });
  it('maps an admitted owner verdict without changing the host verdict', async () => {
    const evidence = await createChangeContextVgEvidenceReader({ enabled: () => true, workspace, observations: () => null, receipt: () => receipt() })({ ...projection,
      comparison: { mode: 'last-commit', state: 'available', base: null, candidate: { kind: 'git-commit', commit: 'commit-1', treeDigest: null }, resolvedAt: '', issues: [] } });
    expect(evidence.at(-1)).toMatchObject({ state: 'available', execution: 'verified', receiptId: 'receipt-1', candidateId: 'candidate-1', advisory: true, hostVerdict: 'unchanged' });
  });
  it('keeps a failing admitted execution visible', async () => {
    const value = receipt() as unknown as { verdict: { dimensions: { execution: string } } }; value.verdict.dimensions.execution = 'failed';
    const evidence = await createChangeContextVgEvidenceReader({ enabled: () => true, workspace, observations: () => null, receipt: () => value as never })({ ...projection,
      comparison: { mode: 'last-commit', state: 'available', base: null, candidate: { kind: 'git-commit', commit: 'commit-1', treeDigest: null }, resolvedAt: '', issues: [] } });
    expect(evidence.at(-1)).toMatchObject({ execution: 'failed', advisory: true, hostVerdict: 'unchanged' });
  });
  it('does not read facts for an inactive workspace', async () => {
    const observations = vi.fn(); const readReceipt = vi.fn();
    await createChangeContextVgEvidenceReader({ enabled: () => true, workspace, observations, receipt: readReceipt })({ ...projection, identity: { ...projection.identity, workspaceId: 'different' } });
    expect(observations).not.toHaveBeenCalled(); expect(readReceipt).not.toHaveBeenCalled();
  });
});
