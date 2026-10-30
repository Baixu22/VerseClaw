#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildTaskCorpus, validateTaskCorpus, buildCalibrationSamples, replayCalibration, TF0590_PACK_DIR, CORPUS_ACTOR } from './lib/agent-first-task-corpus.mjs';
import { buildRubricRequest, graderDigest, GRADER_VERSION } from './lib/agent-first-graders.mjs';
import { sha256File } from './rsi-tf0604-baseline.mjs';
import { validateFrameworkRegistry } from './lib/agent-first-evaluation-framework.mjs';
import { computeHeldOutDigest } from './lib/agent-first-evaluation-loop.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CALIBRATION_GROUPS = { 'deterministic-final-state': 'deterministic', 'trace-authorization': 'trace', 'rubric-clarity': 'rubric' };
const CALIBRATION_FILES = Object.values(CALIBRATION_GROUPS).flatMap((group) => ['known-good', 'known-bad', 'unknown'].map((kind) => `calibration/${group}/${kind}.json`));
const FILES = ['task-corpus.v1.json', 'calibration-samples.v1.json', 'model-calibration.v1.json', 'calibration-results.v1.json', 'validation-report.v1.json', ...CALIBRATION_FILES, 'model-calibration-attempt1.v1.json'];
const SOURCE_FILES = ['scripts/agent-first-task-corpus.mjs', 'scripts/agent-first-task-corpus.d.mts', 'scripts/lib/agent-first-task-corpus.mjs', 'scripts/lib/agent-first-task-corpus.d.mts', 'scripts/lib/agent-first-graders.mjs', 'scripts/lib/agent-first-graders.d.mts', 'tests/unit/agent-first-task-corpus.test.ts', 'tests/unit/agent-first-graders.test.ts', 'tests/unit/agent-first-evaluation-framework.test.ts', 'tests/unit/agent-first-evaluation-loop.test.ts', 'harness/specs/tasks/agent-first-task-corpus-calibration.md', 'harness/specs/guides/agent-first-acceptance.md', 'scripts/lib/agent-first-evaluation-framework.mjs', 'scripts/lib/agent-first-evaluation-loop.mjs', 'package.json', 'docs/README.md', 'docs/dev/rsi-capability-and-boundaries.md'];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };

function identity(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  return { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty: Boolean(git(['status', '--porcelain', '--untracked-files=all'])), sourceHashes: Object.fromEntries(SOURCE_FILES.map((path) => [path, sha256File(join(root, path))])) };
}

export function writeTaskCorpusPack(root = ROOT) {
  const pack = join(root, TF0590_PACK_DIR);
  const corpus = buildTaskCorpus(root);
  const samples = buildCalibrationSamples(corpus);
  const model = existsSync(join(pack, FILES[2])) ? readJson(join(pack, FILES[2])) : { schemaVersion: 'AgentFirstModelCalibration/v1', driven_by: 'agent', actor: CORPUS_ACTOR, status: 'not-run', receipts: [], realHuman: false };
  const results = replayCalibration(corpus, samples, model.receipts);
  const validation = { schemaVersion: 'AgentFirstTaskCorpusValidation/v1', driven_by: 'agent', actor: CORPUS_ACTOR, candidate: identity(root),
    corpus: validateTaskCorpus(corpus, root), taskCount: corpus.tasks.length, distribution: corpus.distribution,
    calibration: { passed: results.passed, rowCount: results.rows.length, rubricRunStatus: results.rubricRunStatus },
    claims: { realHuman: false, actualSystemBaselineRun: false, liveModelCalibration: model.receipts.length > 0, rsiCandidateGenerated: false, productLocksChanged: false } };
  for (const [file, value] of [[FILES[0], corpus], [FILES[1], samples], [FILES[2], model], [FILES[3], results], [FILES[4], validation]]) writeJson(join(pack, file), value);
  for (const [graderId, group] of Object.entries(CALIBRATION_GROUPS)) for (const [kind, expected] of [['known-good', 'pass'], ['known-bad', 'fail'], ['unknown', 'unknown']]) {
    writeJson(join(pack, `calibration/${group}/${kind}.json`), { schemaVersion: 'AgentFirstCalibrationFixture/v1', driven_by: 'agent', actor: CORPUS_ACTOR, graderId, version: GRADER_VERSION, expectation: expected,
      cases: samples[group].filter((sample) => sample.expected === expected), claimBoundary: 'Labelled grader calibration fixtures; no product trial is claimed.' });
  }
  if (!existsSync(join(pack, 'model-calibration-attempt1.v1.json'))) writeJson(join(pack, 'model-calibration-attempt1.v1.json'), { driven_by: 'agent', actor: CORPUS_ACTOR, status: 'not-recorded' });
  writeFileSync(join(pack, 'SHA256SUMS'), FILES.map((file) => `${sha256File(join(pack, file))}  ${file}`).join('\n') + '\n');
  return validation;
}

export async function runModelCalibration(root = ROOT, resource = {}) {
  const pack = join(root, TF0590_PACK_DIR);
  if (!existsSync(join(pack, FILES[0]))) writeTaskCorpusPack(root);
  const corpus = readJson(join(pack, FILES[0]));
  const samples = readJson(join(pack, FILES[1]));
  const endpoint = new URL(resource.endpoint ?? process.env.AGENT_FIRST_JUDGE_ENDPOINT ?? '');
  const key = resource.apiKey ?? process.env.AGENT_FIRST_JUDGE_API_KEY;
  if (!key || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.protocol !== 'https:') throw new Error('An existing HTTPS judge resource without URL credentials is required');
  const receipts = [];
  for (const sample of samples.rubric) for (let vote = 0; vote < samples.rubricConfig.votes; vote += 1) {
    const request = buildRubricRequest(sample, samples.rubricConfig);
    const startedAt = new Date().toISOString();
    let status = null, response = null, error = null;
    try {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${key}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(60000) });
      status = result.status;
      const text = (await result.text()).split(key).join('<secret>');
      try { response = JSON.parse(text); } catch { response = { invalidJson: true }; }
    } catch (caught) { error = caught.name; }
    receipts.push({ driven_by: 'agent', actor: 'codex/tf0590-provider-calibration', sampleId: sample.id, vote, startedAt, finishedAt: new Date().toISOString(),
      endpoint: endpoint.href, requestedModel: samples.rubricConfig.model, status, error, requestSha256: graderDigest(request), responseSha256: graderDigest(response), request, response });
    console.log(JSON.stringify({ sample: sample.id, vote: vote + 1, status, returnedModel: response?.model ?? null, error }));
    writeJson(join(pack, FILES[2]), { schemaVersion: 'AgentFirstModelCalibration/v1', driven_by: 'agent', actor: CORPUS_ACTOR, status: 'partial', config: samples.rubricConfig, receipts, realHuman: false, evidenceScope: 'Synthetic qualitative grader calibration; no product baseline or RSI candidate run.' });
  }
  const replay = replayCalibration(corpus, samples, receipts);
  writeJson(join(pack, FILES[2]), { schemaVersion: 'AgentFirstModelCalibration/v1', driven_by: 'agent', actor: CORPUS_ACTOR, status: replay.passed ? 'calibrated' : 'calibration-failed', config: samples.rubricConfig, receipts, realHuman: false, evidenceScope: 'Synthetic qualitative grader calibration; no product baseline or RSI candidate run.' });
  return writeTaskCorpusPack(root);
}

export function registerTaskCorpus(root = ROOT) {
  const pack = join(root, TF0590_PACK_DIR);
  const corpus = readJson(join(pack, FILES[0]));
  const registryPath = join(root, 'harness/specs/fixtures/agent-first-framework/registry.json');
  const registry = readJson(registryPath);
  const suite = registry.registeredSuites.find((suite) => suite.id === 'acceptance-core');
  if (!suite) throw new Error('Existing acceptance-core suite is missing');
  suite.corpusStatus = 'frozen'; suite.contentDigest = `sha256:${sha256File(join(pack, FILES[0]))}`;
  suite.taskIds = corpus.tasks.map((task) => task.id); suite.provenance = `${TF0590_PACK_DIR}/${FILES[0]}`;
  suite.split = { public: corpus.split.public.length, heldOut: corpus.split.heldOut.length, heldOutWritableByCandidate: false };
  for (const grader of registry.registeredGraders) {
    const group = CALIBRATION_GROUPS[grader.id];
    if (!group) throw new Error(`Unknown grader ${grader.id}`);
    grader.version = GRADER_VERSION;
    grader.calibration = { knownGood: [`${TF0590_PACK_DIR}/calibration/${group}/known-good.json`], knownBad: [`${TF0590_PACK_DIR}/calibration/${group}/known-bad.json`], unknown: [`${TF0590_PACK_DIR}/calibration/${group}/unknown.json`] };
    grader.implementation = 'scripts/lib/agent-first-graders.mjs';
    if (grader.kind === 'rubric') grader.promptDigest = `sha256:${readJson(join(pack, FILES[1])).rubricConfig.promptDigest}`;
  }
  if (!registry.registeredGraders.some((grader) => grader.id === 'trace-authorization')) registry.registeredGraders.push({ id: 'trace-authorization', version: GRADER_VERSION, kind: 'heuristic', precedence: 2, authoredBy: 'framework', implementation: 'scripts/lib/agent-first-graders.mjs', calibration: { knownGood: [`${TF0590_PACK_DIR}/calibration/trace/known-good.json`], knownBad: [`${TF0590_PACK_DIR}/calibration/trace/known-bad.json`], unknown: [`${TF0590_PACK_DIR}/calibration/trace/unknown.json`] } });
  for (const profile of registry.registeredProfiles) if (profile.suiteId === suite.id && !profile.graderIds.includes('trace-authorization')) profile.graderIds.splice(1, 0, 'trace-authorization');
  const validation = validateFrameworkRegistry(registry);
  if (validation.violations.length) throw new Error(JSON.stringify(validation.violations));
  writeJson(registryPath, registry);
  const loopPath = join(root, 'harness/specs/fixtures/agent-first-framework/loop-record.json');
  const loop = readJson(loopPath);
  loop.suiteBinding = { suiteId: suite.id, status: 'frozen', contentDigest: suite.contentDigest };
  loop.heldOutSplit = { suiteId: suite.id, status: 'frozen', digest: computeHeldOutDigest(suite), sealedAt: '2026-10-30', writableByCandidate: false };
  loop.claimBoundary = 'TF-0590 task corpus and grader calibration are frozen. No current-system baseline, RSI candidate, re-evaluation or promotion has run; the existing signals remain evaluation gaps.';
  writeJson(loopPath, loop);
  return validation;
}

export function validateTaskCorpusPack(root = ROOT, options = {}) {
  const errors = [];
  let corpus, replay;
  try {
    const pack = join(root, TF0590_PACK_DIR);
    const actualFiles = readdirSync(pack, { recursive: true }).filter((name) => lstatSync(join(pack, name)).isFile()).map((name) => name.replaceAll('\\', '/'));
    if (JSON.stringify(actualFiles.sort()) !== JSON.stringify([...FILES, 'SHA256SUMS'].sort())) errors.push('pack-file-coverage');
    const actualSums = FILES.map((file) => `${sha256File(join(pack, file))}  ${file}`).sort();
    if (JSON.stringify(readFileSync(join(pack, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/u).sort()) !== JSON.stringify(actualSums)) errors.push('pack-digest');
    corpus = readJson(join(pack, FILES[0])); const samples = readJson(join(pack, FILES[1])); const model = readJson(join(pack, FILES[2]));
    errors.push(...validateTaskCorpus(corpus, root).errors);
    if (JSON.stringify(samples) !== JSON.stringify(buildCalibrationSamples(corpus))) errors.push('calibration-input-tamper');
    const expectedCorpus = buildTaskCorpus(root);
    if (JSON.stringify(corpus.tasks) !== JSON.stringify(expectedCorpus.tasks) || JSON.stringify(corpus.split) !== JSON.stringify(expectedCorpus.split) || corpus.sourceCorpusSha256 !== expectedCorpus.sourceCorpusSha256) errors.push('task-definition-recomputation');
    replay = replayCalibration(corpus, samples, model.receipts);
    if (new Set(model.receipts.map((receipt) => receipt.response?.id)).size !== model.receipts.length) errors.push('duplicate-model-receipt');
    if (!replay.passed) errors.push('calibration-not-passing');
    if (JSON.stringify(replay) !== JSON.stringify(readJson(join(pack, FILES[3])))) errors.push('calibration-replay');
    const validation = readJson(join(pack, FILES[4]));
    if (validation.corpus?.passed !== true || validation.calibration?.passed !== replay.passed || validation.taskCount !== corpus.tasks.length) errors.push('validation-report');
    if (JSON.stringify(Object.keys(validation.candidate?.sourceHashes ?? {}).sort()) !== JSON.stringify([...SOURCE_FILES].sort())) errors.push('source-fingerprint-missing');
    for (const path of SOURCE_FILES) if (validation.candidate?.sourceHashes?.[path] !== sha256File(join(root, path))) errors.push(`source-fingerprint:${path}`);
    if (!options.allowDraft) {
      if (validation.candidate?.dirty !== false || identity(root).dirty) errors.push('dirty-candidate');
      const candidate = validation.candidate?.commit;
      if (!/^[a-f0-9]{40}$/u.test(candidate ?? '')) errors.push('candidate-identity');
      else {
        const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
        if (git(['rev-parse', `${candidate}^{tree}`]) !== validation.candidate.tree) errors.push('candidate-tree');
        git(['merge-base', '--is-ancestor', candidate, 'HEAD']);
        const changed = git(['diff', '--name-only', candidate, 'HEAD']).split(/\r?\n/u).filter(Boolean);
        if (changed.some((path) => !path.startsWith(`${TF0590_PACK_DIR}/`) && !path.startsWith('harness/specs/fixtures/rsi-evidence-loop/tf0592/') && !['harness/specs/fixtures/agent-first-framework/registry.json', 'harness/specs/fixtures/agent-first-framework/loop-record.json', 'harness/specs/fixtures/agent-first-framework/validation-report.json', 'harness/specs/fixtures/agent-first-framework/loop-validation-report.json', 'harness/specs/fixtures/agent-first-framework/SHA256SUMS'].includes(path))) errors.push('candidate-source-drift');
      }
    }
    if (model.status !== 'calibrated' || model.receipts.length !== samples.rubric.length * samples.rubricConfig.votes) errors.push('provider-calibration-incomplete');
    for (const [graderId, group] of Object.entries(CALIBRATION_GROUPS)) for (const [kind, expected] of [['known-good', 'pass'], ['known-bad', 'fail'], ['unknown', 'unknown']]) {
      const fixture = readJson(join(pack, `calibration/${group}/${kind}.json`));
      if (fixture.graderId !== graderId || fixture.expectation !== expected || JSON.stringify(fixture.cases) !== JSON.stringify(samples[group].filter((sample) => sample.expected === expected))) errors.push(`calibration-fixture:${graderId}:${kind}`);
    }
    const registry = readJson(join(root, 'harness/specs/fixtures/agent-first-framework/registry.json'));
    if (validateFrameworkRegistry(registry).violations.length) errors.push('registry-contract');
    for (const [graderId, group] of Object.entries(CALIBRATION_GROUPS)) {
      const grader = registry.registeredGraders.find((entry) => entry.id === graderId);
      if (grader?.version !== GRADER_VERSION || grader?.implementation !== 'scripts/lib/agent-first-graders.mjs'
        || JSON.stringify(grader?.calibration?.knownGood) !== JSON.stringify([`${TF0590_PACK_DIR}/calibration/${group}/known-good.json`])
        || JSON.stringify(grader?.calibration?.knownBad) !== JSON.stringify([`${TF0590_PACK_DIR}/calibration/${group}/known-bad.json`])
        || JSON.stringify(grader?.calibration?.unknown) !== JSON.stringify([`${TF0590_PACK_DIR}/calibration/${group}/unknown.json`])) errors.push(`grader-binding:${graderId}`);
    }
    const suite = registry.registeredSuites.find((suite) => suite.id === 'acceptance-core');
    if (suite?.corpusStatus !== 'frozen' || suite?.contentDigest !== `sha256:${sha256File(join(pack, FILES[0]))}` || JSON.stringify(suite?.taskIds) !== JSON.stringify(corpus.tasks.map((task) => task.id))) errors.push('registry-corpus-binding');
    const loop = readJson(join(root, 'harness/specs/fixtures/agent-first-framework/loop-record.json'));
    if (loop.suiteBinding?.contentDigest !== suite?.contentDigest || loop.heldOutSplit?.digest !== computeHeldOutDigest(suite)) errors.push('loop-corpus-binding');
  } catch (error) { errors.push(error.message); }
  return { passed: !errors.length, errors, taskCount: corpus?.tasks.length ?? null, calibratedRows: replay?.rows?.filter((row) => row.observed === row.expected).length ?? 0 };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean' }, check: { type: 'boolean' }, calibrate: { type: 'boolean' }, register: { type: 'boolean' } } });
  try {
    const result = values.calibrate ? await runModelCalibration() : values.register ? registerTaskCorpus() : values.write ? writeTaskCorpusPack() : validateTaskCorpusPack();
    console.log(JSON.stringify(result, null, 2));
    if (values.check && result.passed !== true) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
