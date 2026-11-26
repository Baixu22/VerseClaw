import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCalibrationInputs } from '../../scripts/rsi-library-checker-calibrate.mjs';

const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const put = (directory: string, name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value));
const base = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
mkdirSync(base, { recursive: true });

function fixture() {
  const directory = mkdtempSync(join(base, 'rsi-usaco-input-'));
  const selected = { familyId: 'usaco-family-fixture', sourceKey: 'usaco:1347', caseId: 'usaco-1347', familyOrder: 0, sourceOrder: 0 };
  const review = { schemaVersion: 'RsiUsacoFamilyReview/v2', planSha256: 'f'.repeat(64), formalAdmission: false,
    historicalBaseManifestSha256: '4cd43e9eb87864da8d16f8603aa16a959d0ec168eec904d4f86aca628992e916',
    sourceCandidates: [{ sourceIdentity: selected.sourceKey, outputComparison: 'normalized-text' }],
    driven_by: 'agent', realHumanEvidence: false, runnerCalibration: false, modelRequests: 0, executedPrograms: 0,
    semanticIndependenceReview: 'pending',
    qualifiedFamilyIncrement: 0, families: [{ familyId: selected.familyId, status: 'new-component', oldFamilyIds: [] as string[],
      sourceIdentities: [selected.sourceKey] }] };
  const plan = { schemaVersion: 'RsiUsacoMeasurementPlan/v1', driven_by: 'agent', realHumanEvidence: false,
    modelRequests: 0, usage: 'scripted-control', pythonVersion: 'Python 3.10.12', minimumSystemAvailableBytes: 4294967296,
    calibrationSchemaVersion: 'RsiUsacoCalibrationBatch/v1', sourceFamilyPlanSha256: review.planSha256,
    sourceFamilyReviewSha256: '', selectedSources: [selected], sourceFilesSha256: { ...Object.fromEntries([
      'scripts/rsi-library-checker-calibrate.mjs', 'scripts/rsi-native-checker-worker.py', 'scripts/rsi-native-checker-replay.py',
      'scripts/lib/rsi-native-checker.mjs', 'scripts/lib/rsi-isolated-python.mjs', 'scripts/rsi-isolated-python-worker.py',
      'scripts/rsi-isolated-python-replay.py'].map(name => [name, 'a'.repeat(64)])),
    'harness/specs/fixtures/rsi-live-experience/usaco-output-contracts.json':
      sha(readFileSync('harness/specs/fixtures/rsi-live-experience/usaco-output-contracts.json')) } };
  const prepared = { schemaVersion: 'RsiUsacoMeasurementInputs/v1', modelRequests: 0, formalAdmission: false,
    planSha256: '', sourceFamilyReviewSha256: '', cases: [{ ...selected, problem: selected.caseId,
      path: selected.caseId + '.json.gz', sha256: 'b'.repeat(64), packDigest: 'c'.repeat(64), referenceSha256: 'd'.repeat(64), vectors: 14 }] };
  const save = () => {
    put(directory, 'family-review.json', review);
    plan.sourceFamilyReviewSha256 = sha(readFileSync(join(directory, 'family-review.json')));
    prepared.sourceFamilyReviewSha256 = plan.sourceFamilyReviewSha256;
    put(directory, 'plan.json', plan);
    prepared.planSha256 = sha(readFileSync(join(directory, 'plan.json')));
    put(directory, 'report.json', prepared);
  };
  save();
  return { directory, plan, prepared, review, save };
}

describe('USACO source calibration admission', () => {
  it('uses the existing isolated Python executor with separate source and phase identities', async () => {
    const { directory } = fixture();
    expect(await loadCalibrationInputs(process.cwd(), directory)).toMatchObject({ supplemental: true,
      batchVersion: 'RsiUsacoCalibrationBatch/v1', phaseVersion: 'RsiUsacoCalibrationPhase/v1',
      evidenceDirectory: 'stdio-python-evidence', selection: ['usaco-1347'] });
  });

  it.each(['existing-component', 'excluded-observed'])('rejects %s even with refreshed report hashes', async status => {
    const f = fixture(); f.review.families[0].status = status; f.save();
    await expect(loadCalibrationInputs(process.cwd(), f.directory)).rejects.toThrow('calibration-usaco-unobserved-family');
  });

  it('rejects a changed source-family mapping or original family digest', async () => {
    const f = fixture(); f.review.families[0].sourceIdentities = ['usaco:1348']; f.save();
    await expect(loadCalibrationInputs(process.cwd(), f.directory)).rejects.toThrow('calibration-usaco-unobserved-family');
    const g = fixture(); g.review.formalAdmission = true; g.save();
    await expect(loadCalibrationInputs(process.cwd(), g.directory)).rejects.toThrow('calibration-usaco-family-review');
    const h = fixture(); put(h.directory, 'family-review.json', { ...h.review, edited: true });
    await expect(loadCalibrationInputs(process.cwd(), h.directory)).rejects.toThrow('calibration-usaco-family-review');
    const i = fixture(); i.review.semanticIndependenceReview = 'passed'; i.save();
    await expect(loadCalibrationInputs(process.cwd(), i.directory)).rejects.toThrow('calibration-usaco-family-review');
  });

  it('requires the reviewed comparator and frozen exclusion manifest for USACO', async () => {
    const f = fixture(); f.review.sourceCandidates[0].outputComparison = 'pending'; f.save();
    await expect(loadCalibrationInputs(process.cwd(), f.directory)).rejects.toThrow('calibration-usaco-output-comparison');
    const g = fixture(); g.review.historicalBaseManifestSha256 = '0'.repeat(64); g.save();
    await expect(loadCalibrationInputs(process.cwd(), g.directory)).rejects.toThrow('calibration-usaco-family-review');
  });

  it('keeps the four GiB gate and frozen interpreter requirement', async () => {
    const f = fixture(); f.plan.minimumSystemAvailableBytes -= 1; f.save();
    await expect(loadCalibrationInputs(process.cwd(), f.directory)).rejects.toThrow('calibration-memory-budget');
    const g = fixture(); g.plan.pythonVersion = ''; g.save();
    await expect(loadCalibrationInputs(process.cwd(), g.directory)).rejects.toThrow('calibration-isolated-python-required');
  });
});
