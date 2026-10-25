// Independent readback for the frozen TF-0507 acceptance run.
import fs from 'node:fs';
import path from 'node:path';
import { buildFixtureProfile, probeToolDecision, scoreAnswer, sha256, type PositioningProtocol } from './fixture-lib.mts';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../..');
const dir = 'tests/unit/fixtures/model-positioning-tf0507';
const protocolPath = path.join(root, dir, 'protocol-v11.json');
const runPath = path.join(root, dir, 'run-v11.json');
const protocolRaw = fs.readFileSync(protocolPath);
const protocol = JSON.parse(protocolRaw.toString('utf8')) as PositioningProtocol;
const run = JSON.parse(fs.readFileSync(runPath, 'utf8')) as any;
const issues: string[] = [];
if (run.schemaVersion !== 'ModelPositioningRun/v1') issues.push('run schema mismatch');
if (run.protocolSha256 !== sha256(protocolRaw)) issues.push('protocol hash mismatch');
if (run.model !== protocol.model) issues.push('model mismatch');
if (run.provider !== protocol.provider) issues.push('provider mismatch');
if (run.repeats !== protocol.repeats) issues.push('repeats mismatch');
if (run.rows.length !== protocol.cases.length) issues.push('row count mismatch');
const byId = new Map(protocol.cases.map((testCase) => [testCase.scenarioId, testCase]));
const expectedDigests = new Map<string, string>();
const evaluated = [];
for (const row of run.rows) {
  const testCase = byId.get(row.scenarioId);
  if (!testCase) {
    issues.push('unknown scenario ' + row.scenarioId);
    continue;
  }
  const built = buildFixtureProfile(protocol, testCase.profileId);
  expectedDigests.set(testCase.profileId, built.profile.effectiveDigest);
  if (row.profileDigest !== built.profile.effectiveDigest) issues.push('profile digest mismatch ' + row.scenarioId);
  if (row.promptSha256 !== sha256(testCase.prompt)) issues.push('prompt hash mismatch ' + row.scenarioId);
  const tool = testCase.expectedToolDecision ? probeToolDecision(built.profile, testCase.expectedToolDecision) : null;
  if (tool && (!tool.profileConsistent || tool.outcome !== testCase.expectedToolDecision?.expectedOutcome)) {
    issues.push('tool probe mismatch ' + row.scenarioId);
  }
  const answers = Array.isArray(row.answers) ? row.answers : [];
  if (answers.length !== protocol.repeats) issues.push('repeat count mismatch ' + row.scenarioId);
  const scored = answers.map((answer: any) => {
    const result = scoreAnswer(testCase, String(answer.text ?? ''));
    return { repeat: answer.repeat, pass: Boolean(answer.ok && result.pass), exact: result.exact };
  });
  if (!scored.every((answer: any) => answer.pass)) issues.push('row failed ' + row.scenarioId);
  evaluated.push({ scenarioId: row.scenarioId, profileId: row.profileId, pass: scored.every((answer: any) => answer.pass), scored });
}
for (const profile of protocol.profiles) {
  const expected = expectedDigests.get(profile.id);
  if (expected !== protocol.profileDigests[profile.id]) issues.push('profile digest map mismatch ' + profile.id);
}
const passedRows = evaluated.filter((row) => row.pass).length;
const passedCalls = evaluated.reduce((sum, row) => sum + row.scored.filter((answer: any) => answer.pass).length, 0);
const report = {
  schemaVersion: 'ModelPositioningVerification/v1',
  taskForestNodeId: 'TF-0507',
  generatedAt: protocol.declaredAt,
  driven_by: 'agent',
  actor: 'codex',
  provider: protocol.provider,
  model: protocol.model,
  dataset: protocol.dataset,
  repeats: protocol.repeats,
  scorer: protocol.scorer,
  protocolPath: dir + '/protocol-v11.json',
  runPath: dir + '/run-v11.json',
  protocolSha256: sha256(protocolRaw),
  runProtocolSha256: run.protocolSha256,
  rows: evaluated.length,
  expectedRows: protocol.cases.length,
  totalCalls: run.summary.totalCalls,
  passedRows,
  passedCalls,
  expectedPassedRows: protocol.cases.length,
  expectedPassedCalls: protocol.cases.length * protocol.repeats,
  profileDigests: Object.fromEntries(expectedDigests),
  issues,
  status: issues.length === 0 && passedRows === protocol.cases.length && passedCalls === protocol.cases.length * protocol.repeats ? 'pass' : 'fail',
  boundary: 'This verifies only the frozen ' + protocol.model + ' run over ' + protocol.cases.length + ' scenarios x ' + protocol.repeats + ' repeats. It does not generalize to other providers, models, datasets, or real-human evidence.',
};
const outputPath = path.join(root, dir, 'verification.json');
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'pass') process.exitCode = 1;
