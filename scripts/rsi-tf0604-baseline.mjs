#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { aggregateReliability } from './lib/reliability-aggregation.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TF0604_PACK_DIR = 'harness/specs/fixtures/rsi-evidence-loop/tf0604';
const PACK_ROOT = join(ROOT, TF0604_PACK_DIR);
export const TF0604_GENERATED_AT = '2026-10-30T00:00:00+08:00';
export const TF0604_FAILURE_CLASSES = ['infrastructure', 'task', 'grader', 'agent'];
export const TF0604_MIN_CASES = 20;
export const TF0604_K = 3;

const SOURCE_CASE_FILES = [
  'docs/dev/harness-gap-closure/e01-acceptance.json',
  'docs/dev/harness-gap-closure/e02-acceptance.json',
  'docs/dev/harness-gap-closure/g01-acceptance.json',
  'docs/dev/harness-gap-closure/g02-acceptance.json',
  'docs/dev/harness-gap-closure/g03-acceptance.json',
  'docs/dev/harness-gap-closure/l01-acceptance.json',
  'docs/dev/harness-gap-closure/l02-acceptance.json',
  'docs/dev/harness-gap-closure/l03-acceptance.json',
  'docs/dev/harness-gap-closure/l04-acceptance.json',
  'docs/dev/harness-gap-closure/l05-acceptance.json',
  'docs/dev/harness-gap-closure/l06-acceptance.json',
  'docs/dev/harness-gap-closure/s01-acceptance.json',
  'docs/dev/harness-gap-closure/s02-acceptance.json',
  'docs/dev/harness-gap-closure/s03-acceptance.json',
  'docs/dev/harness-gap-closure/s04-acceptance.json',
  'docs/dev/harness-gap-closure/s05-acceptance.json',
  'docs/dev/harness-gap-closure/s06-acceptance.json',
  'docs/dev/harness-gap-closure/s07-acceptance.json',
  'docs/dev/harness-gap-closure/a01-acceptance.json',
  'docs/dev/harness-gap-closure/a02-acceptance.json',
  'docs/dev/harness-gap-closure/a03-acceptance.json',
  'docs/dev/harness-gap-closure/a04-acceptance.json',
  'docs/dev/harness-gap-closure/a05-acceptance.json',
  'docs/dev/harness-gap-closure/a06-acceptance.json',
];

const FILES = {
  corpus: 'task-corpus.v1.json',
  controls: 'negative-controls.v1.json',
  rawTrials: 'raw-trials.v1.json',
  aggregate: 'aggregate.v1.json',
  controlResults: 'negative-control-results.v1.json',
  validation: 'validation-report.v1.json',
  sums: 'SHA256SUMS',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function canonicalBytes(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n?/gu, '\n'), 'utf8');
}

export function sha256File(path) {
  return createHash('sha256').update(canonicalBytes(readFileSync(path))).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch {
    return 'unavailable';
  }
}

function packetFor(path) {
  return path.split('/').at(-1)?.slice(0, 3).toUpperCase() ?? 'UNKNOWN';
}

function categoryFor(packet) {
  return {
    E01: 'reliability',
    E02: 'paired-ablation',
    G01: 'error-governance',
    G02: 'documentation',
    G03: 'trace-to-eval',
    L01: 'long-session-context',
    L02: 'long-session-pressure',
    L03: 'long-session-steering',
    L04: 'checkpoint-binding',
    L05: 'rate-control',
    L06: 'write-owner',
    S01: 'provider-boundary',
    S02: 'sensitive-sink',
    S03: 'external-write',
    S04: 'browser-boundary',
    S05: 'credential-boundary',
    S06: 'memory-effect-receipt',
    S07: 'completion-verdict',
    A01: 'isolation',
    A02: 'orchestration',
    A03: 'resilience',
    A04: 'decision-quality',
    A05: 'adaptive-budget',
    A06: 'persistence',
  }[packet] ?? 'historical-acceptance';
}

function sourceRecord(path) {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) throw new Error(`missing source record: ${path}`);
  return readJson(absolute);
}

function buildCase(path, index) {
  const record = sourceRecord(path);
  const packet = packetFor(path);
  const sourceDigest = sha256File(join(ROOT, path));
  const taskId = record.scope?.task ?? `historical-${String(index + 1).padStart(2, '0')}`;
  const candidate = record.candidate ?? {};
  const acceptanceCriteria = Array.isArray(record.acceptanceCriteria)
    ? record.acceptanceCriteria
    : Array.isArray(record.criteria)
      ? record.criteria
      : [];
  const acceptanceCounts = acceptanceCriteria.reduce((counts, entry) => {
    const status = String(entry.status ?? 'unknown').toLowerCase();
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    id: `${taskId.toLowerCase()}-${packet.toLowerCase()}`,
    taskId,
    packet,
    category: categoryFor(packet),
    title: record.scope?.title ?? 'Historical acceptance task',
    taskIntent: record.scope?.title ?? 'Historical repository task with a recorded acceptance oracle.',
    taskDefinition: {
      input: {
        taskId,
        packet,
        title: record.scope?.title ?? 'Historical acceptance task',
        source: record.scope?.source ?? 'committed repository acceptance record',
      },
      referenceOutcome: {
        decision: record.decision?.status ?? 'unknown',
        acceptanceCriteria: acceptanceCriteria.map((entry) => ({
          id: entry.id ?? null,
          status: entry.status ?? 'unknown',
          note: entry.note ?? '',
        })),
        gateIds: Object.keys(record.gates ?? {}),
      },
      forbiddenClaims: record.notMeasured ?? [],
    },
    sourceKind: 'historical-agent-acceptance-record',
    sourceRefs: [path],
    sourceDigest,
    sourceClaims: {
      driven_by: record.driven_by ?? 'agent',
      actor: record.actor ?? 'unknown-agent',
      liveProvider: record.scope?.liveProvider === true,
      realHuman: record.scope?.realHuman === true,
    },
    oracle: {
      kind: 'sealed-acceptance-record',
      requiredFields: ['scope.task', 'decision.status', 'candidate', 'acceptanceCriteria'],
      deterministic: true,
      modelGraderMayNotOverride: true,
    },
    reference: {
      candidateCommit: candidate.commit ?? null,
      candidateTree: candidate.tree ?? null,
      candidateDirty: candidate.dirty ?? null,
      recordedDecision: record.decision?.status ?? 'unknown',
      evidenceTier: record.decision?.evidenceTier ?? 'unknown',
      acceptanceCounts,
    },
    baselinePlan: {
      arm: 'current-system-before-any-rsi-candidate',
      k: TF0604_K,
      trialStatus: 'not-run',
      performanceClaim: false,
      note: 'The source record is a real repository task reference, not a model-quality trial. It is never converted into pass^k evidence.',
    },
    negativeControlIds: [
      'case-count-floor',
      'duplicate-case-id',
      'source-digest-tamper',
      'missing-source-record',
      'real-human-claim',
      'unknown-failure-class',
      'negative-anchor-pass',
      'baseline-pass-without-complete-cases',
    ],
  };
}

export function buildTf0604Corpus() {
  const cases = SOURCE_CASE_FILES.map(buildCase);
  return {
    schemaVersion: 'RsiTf0604TaskCorpus/v1',
    taskId: 'TF-0604',
    generatedAt: TF0604_GENERATED_AT,
    driven_by: 'agent',
    actor: 'codex/tf0604-rsi-baseline',
    corpusKind: 'historical-agent-task-corpus',
    claimBoundary: 'These are real repository tasks and committed agent-driven acceptance records. They are not real-human traffic, live-provider quality evidence, or promotion evidence.',
    provenance: {
      sourceCommit: git(['rev-parse', 'HEAD']),
      sourceTree: git(['rev-parse', 'HEAD^{tree}']),
      sourcePolicy: 'Only committed repository artefacts are admitted; source digests are checked before every report.',
      realProvider: false,
      realHuman: false,
      userData: false,
      syntheticTaskInputs: false,
      sourceFileCount: SOURCE_CASE_FILES.length,
    },
    protocol: {
      minimumCompleteCases: TF0604_MIN_CASES,
      k: TF0604_K,
      heldOutRequired: true,
      baselineArm: 'current-system-before-any-rsi-candidate',
      failureClasses: TF0604_FAILURE_CLASSES,
      incompleteTrialRule: 'missing, timeout, crash and skip remain visible and never count as complete.',
      promotionReady: false,
    },
    cases,
  };
}

export function buildNegativeControls() {
  return {
    schemaVersion: 'RsiTf0604NegativeControls/v1',
    taskId: 'TF-0604',
    generatedAt: TF0604_GENERATED_AT,
    driven_by: 'agent',
    actor: 'codex/tf0604-rsi-baseline',
    claimBoundary: 'Controls test corpus integrity and gate honesty. A control pass does not prove model quality or promotion readiness.',
    controls: [
      { id: 'case-count-floor', mutation: 'remove-case', expected: 'reject', expectedCode: 'case-count-floor' },
      { id: 'duplicate-case-id', mutation: 'duplicate-case-id', expected: 'reject', expectedCode: 'duplicate-case-id' },
      { id: 'source-digest-tamper', mutation: 'source-digest-tamper', expected: 'reject', expectedCode: 'source-digest-mismatch' },
      { id: 'missing-source-record', mutation: 'missing-source-record', expected: 'reject', expectedCode: 'missing-source-record' },
      { id: 'real-human-claim', mutation: 'real-human-claim', expected: 'reject', expectedCode: 'real-human-claim' },
      { id: 'unknown-failure-class', mutation: 'unknown-failure-class', expected: 'reject', expectedCode: 'unknown-failure-class' },
      { id: 'negative-anchor-pass', mutation: 'negative-anchor-pass', expected: 'reject', expectedCode: 'negative-anchor-violated' },
      { id: 'baseline-pass-without-complete-cases', mutation: 'baseline-pass-without-complete-cases', expected: 'reject', expectedCode: 'insufficient-evidence-bypass' },
    ],
  };
}

export function buildRawTrials(corpus) {
  return {
    schemaVersion: 'RsiTf0604RawTrials/v1',
    taskId: 'TF-0604',
    generatedAt: TF0604_GENERATED_AT,
    driven_by: 'agent',
    actor: 'codex/tf0604-rsi-baseline',
    trialKind: 'baseline-measurement-reservation',
    performanceEvidence: false,
    note: 'No provider/model trials are fabricated. Each corpus case is reserved with zero completed trials until a later stage supplies an identical runtime envelope.',
    cases: corpus.cases.map((entry) => ({
      caseId: entry.id,
      taskId: entry.taskId,
      trials: [],
      incomplete: true,
      status: 'not-run',
      failureClass: null,
    })),
  };
}

export function buildAggregate(corpus, rawTrials) {
  const perTask = corpus.cases.map((entry) => {
    const raw = rawTrials.cases.find((candidate) => candidate.caseId === entry.id);
    return {
      caseId: entry.id,
      taskId: entry.taskId,
      trialCount: raw?.trials.length ?? 0,
      complete: false,
      outcome: 'not-run',
      failureClass: raw?.failureClass ?? null,
    };
  });
  const failureClasses = Object.fromEntries(TF0604_FAILURE_CLASSES.map((name) => [name, { trialCount: 0, caseCount: 0 }]));
  return {
    schemaVersion: 'RsiTf0604BaselineAggregate/v1',
    taskId: 'TF-0604',
    generatedAt: TF0604_GENERATED_AT,
    driven_by: 'agent',
    actor: 'codex/tf0604-rsi-baseline',
    status: 'insufficient-evidence',
    reason: 'The 24-case corpus is sealed, but no model/provider baseline trials have been executed. The floor is not bypassed by corpus size.',
    corpusCaseCount: corpus.cases.length,
    completeCaseCount: 0,
    incompleteCaseCount: perTask.length,
    k: TF0604_K,
    minimumCompleteCases: TF0604_MIN_CASES,
    passK: null,
    passAtK: null,
    confidenceInterval95: null,
    perTask,
    failureClasses,
    negativeControls: {
      required: true,
      regressionCount: 0,
      status: 'reserved',
    },
  };
}

function error(code, message, path = null) {
  return { code, message, path };
}

export function validateCorpus(corpus, root = ROOT) {
  const errors = [];
  if (corpus?.schemaVersion !== 'RsiTf0604TaskCorpus/v1') errors.push(error('schema-version', 'unexpected corpus schema'));
  if (corpus?.taskId !== 'TF-0604') errors.push(error('task-id', 'corpus must belong to TF-0604'));
  if (corpus?.driven_by !== 'agent') errors.push(error('agent-label', 'corpus must be driven_by=agent'));
  if (!corpus?.actor) errors.push(error('actor-missing', 'corpus actor is required'));
  if (corpus?.provenance?.realHuman !== false) errors.push(error('real-human-claim', 'realHuman must be false'));
  if (corpus?.provenance?.realProvider !== false) errors.push(error('live-provider-claim', 'realProvider must be false for this pack'));
  if (corpus?.protocol?.minimumCompleteCases !== TF0604_MIN_CASES) errors.push(error('case-count-floor', `minimumCompleteCases must be ${TF0604_MIN_CASES}`));
  if (corpus?.protocol?.k !== TF0604_K) errors.push(error('trial-count', `k must be ${TF0604_K}`));
  if (!Array.isArray(corpus?.protocol?.failureClasses) || JSON.stringify(corpus.protocol.failureClasses) !== JSON.stringify(TF0604_FAILURE_CLASSES)) {
    errors.push(error('failure-classes', 'failure classes must remain the four pre-registered classes'));
  }
  if (!Array.isArray(corpus?.cases) || corpus.cases.length < TF0604_MIN_CASES) {
    errors.push(error('case-count-floor', `corpus must contain at least ${TF0604_MIN_CASES} cases`));
    return { passed: false, errors };
  }

  const ids = new Set();
  for (const entry of corpus.cases) {
    if (!entry?.id || ids.has(entry.id)) errors.push(error('duplicate-case-id', `duplicate or missing case id: ${entry?.id ?? '<missing>'}`, entry?.id ?? null));
    ids.add(entry?.id);
    if (!entry.taskId || !entry.title || !entry.taskIntent) errors.push(error('case-shape', `case ${entry.id} is missing task identity fields`, entry.id));
    if (entry.sourceClaims?.driven_by !== 'agent') errors.push(error('agent-label', `case ${entry.id} is not agent-labelled`, entry.id));
    if (entry.sourceClaims?.realHuman === true) errors.push(error('real-human-claim', `case ${entry.id} claims real-human evidence`, entry.id));
    if (entry.sourceClaims?.liveProvider === true) errors.push(error('live-provider-claim', `case ${entry.id} claims live provider evidence`, entry.id));
    if (!Array.isArray(entry.sourceRefs) || entry.sourceRefs.length === 0) {
      errors.push(error('missing-source-record', `case ${entry.id} has no source record`, entry.id));
      continue;
    }
    for (const sourceRef of entry.sourceRefs) {
      const absolute = join(root, sourceRef);
      if (!existsSync(absolute)) {
        errors.push(error('missing-source-record', `source record does not exist: ${sourceRef}`, entry.id));
      } else if (sourceRef === entry.sourceRefs[0] && entry.sourceDigest !== sha256File(absolute)) {
        errors.push(error('source-digest-mismatch', `source digest mismatch: ${sourceRef}`, entry.id));
      }
    }
    if (!TF0604_FAILURE_CLASSES.includes(entry.baselinePlan?.failureClass ?? 'none') && entry.baselinePlan?.failureClass) {
      errors.push(error('unknown-failure-class', `unknown failure class: ${entry.baselinePlan.failureClass}`, entry.id));
    }
  }
  return { passed: errors.length === 0, errors };
}

export function validateRawTrials(rawTrials, corpus) {
  const errors = [];
  if (rawTrials?.driven_by !== 'agent') errors.push(error('agent-label', 'raw trials must be agent-labelled'));
  const ids = new Set(corpus.cases.map((entry) => entry.id));
  if (!Array.isArray(rawTrials?.cases) || rawTrials.cases.length !== ids.size) errors.push(error('raw-trial-coverage', 'raw trial records must cover every corpus case'));
  for (const entry of rawTrials?.cases ?? []) {
    if (!ids.has(entry.caseId)) errors.push(error('unknown-case', `raw trial references unknown case ${entry.caseId}`));
    if (!Array.isArray(entry.trials)) errors.push(error('trial-shape', `trials must be an array for ${entry.caseId}`));
    if (entry.failureClass !== null && !TF0604_FAILURE_CLASSES.includes(entry.failureClass)) errors.push(error('unknown-failure-class', `unknown failure class for ${entry.caseId}`));
  }
  return { passed: errors.length === 0, errors };
}

export function validateAggregate(aggregate, corpus, rawTrials) {
  const errors = [];
  if (aggregate?.driven_by !== 'agent') errors.push(error('agent-label', 'aggregate must be agent-labelled'));
  if (aggregate?.corpusCaseCount !== corpus.cases.length) errors.push(error('aggregate-case-count', 'aggregate case count does not match corpus'));
  if (aggregate?.completeCaseCount < TF0604_MIN_CASES && aggregate?.status !== 'insufficient-evidence') {
    errors.push(error('insufficient-evidence-bypass', 'thin baseline must be insufficient-evidence'));
  }
  if (aggregate?.completeCaseCount < TF0604_MIN_CASES && (aggregate?.passK !== null || aggregate?.passAtK !== null)) {
    errors.push(error('thin-sample-metric', 'thin baseline cannot expose pass^k/pass@k'));
  }
  if (JSON.stringify(Object.keys(aggregate?.failureClasses ?? {})) !== JSON.stringify(TF0604_FAILURE_CLASSES)) {
    errors.push(error('failure-classes', 'aggregate must separate the four failure classes'));
  }
  const expectedIds = new Set(corpus.cases.map((entry) => entry.id));
  const actualIds = new Set((aggregate?.perTask ?? []).map((entry) => entry.caseId));
  if (actualIds.size !== expectedIds.size || [...expectedIds].some((id) => !actualIds.has(id))) errors.push(error('per-task-coverage', 'aggregate must preserve every task case'));
  if (rawTrials && aggregate?.incompleteCaseCount !== rawTrials.cases.length) errors.push(error('incomplete-count', 'aggregate incomplete count must preserve raw trial coverage'));
  return { passed: errors.length === 0, errors };
}

function applyMutation(corpus, aggregate, control) {
  const nextCorpus = clone(corpus);
  const nextAggregate = clone(aggregate);
  switch (control.mutation) {
    case 'remove-case':
      nextCorpus.cases.length = TF0604_MIN_CASES - 1;
      break;
    case 'duplicate-case-id':
      nextCorpus.cases[1].id = nextCorpus.cases[0].id;
      break;
    case 'source-digest-tamper':
      nextCorpus.cases[0].sourceDigest = '0'.repeat(64);
      break;
    case 'missing-source-record':
      nextCorpus.cases[0].sourceRefs[0] = 'docs/dev/harness-gap-closure/missing-tf0604-source.json';
      break;
    case 'real-human-claim':
      nextCorpus.provenance.realHuman = true;
      break;
    case 'unknown-failure-class':
      nextCorpus.cases[0].baselinePlan.failureClass = 'unknown';
      break;
    case 'negative-anchor-pass':
      return { negativeAnchor: aggregateReliability([{ id: 'negative-control', anchor: 'negative', trials: ['pass', 'pass', 'pass'] }], { k: 3, minCases: 1 }) };
    case 'baseline-pass-without-complete-cases':
      nextAggregate.status = 'pass';
      nextAggregate.passK = 1;
      nextAggregate.passAtK = 1;
      break;
    default:
      throw new Error(`unsupported mutation: ${control.mutation}`);
  }
  return { corpus: nextCorpus, aggregate: nextAggregate };
}

export function runNegativeControls(corpus, aggregate, controls, root = ROOT) {
  return controls.controls.map((control) => {
    const mutation = applyMutation(corpus, aggregate, control);
    let result;
    if (mutation.negativeAnchor) {
      result = mutation.negativeAnchor.anchors.violated
        ? { passed: true, code: 'negative-anchor-violated' }
        : { passed: false, code: 'negative-anchor-escaped' };
    } else {
      const corpusResult = validateCorpus(mutation.corpus, root);
      const aggregateResult = validateAggregate(mutation.aggregate, mutation.corpus, null);
      const errors = [...corpusResult.errors, ...aggregateResult.errors];
      result = errors.length > 0
        ? { passed: true, code: errors[0].code }
        : { passed: false, code: 'mutation-escaped' };
    }
    return {
      id: control.id,
      mutation: control.mutation,
      expectedCode: control.expectedCode,
      observedCode: result.code,
      passed: result.passed && result.code === control.expectedCode,
    };
  });
}

function writeSums() {
  const lines = Object.values(FILES)
    .filter((file) => file !== FILES.sums)
    .map((file) => `${sha256File(join(PACK_ROOT, file))}  ${file}`);
  writeFileSync(join(PACK_ROOT, FILES.sums), `${lines.join('\n')}\n`, 'utf8');
}

function verifySums() {
  const path = join(PACK_ROOT, FILES.sums);
  if (!existsSync(path)) return { passed: false, errors: [error('hash-manifest-missing', 'SHA256SUMS is missing')] };
  const errors = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean)) {
    const [, expected, file] = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u) ?? [];
    if (!expected || !file || !existsSync(join(PACK_ROOT, file)) || sha256File(join(PACK_ROOT, file)) !== expected) {
      errors.push(error('hash-mismatch', `hash mismatch or missing file: ${file ?? '<invalid-line>'}`));
    }
  }
  return { passed: errors.length === 0, errors };
}

export function writeTf0604Pack() {
  const corpus = buildTf0604Corpus();
  const controls = buildNegativeControls();
  const rawTrials = buildRawTrials(corpus);
  const aggregate = buildAggregate(corpus, rawTrials);
  const corpusValidation = validateCorpus(corpus);
  const trialValidation = validateRawTrials(rawTrials, corpus);
  const aggregateValidation = validateAggregate(aggregate, corpus, rawTrials);
  const controlResults = runNegativeControls(corpus, aggregate, controls);
  const report = {
    schemaVersion: 'RsiTf0604ValidationReport/v1',
    taskId: 'TF-0604',
    generatedAt: TF0604_GENERATED_AT,
    driven_by: 'agent',
    actor: 'codex/tf0604-rsi-baseline',
    corpus: {
      status: corpusValidation.passed ? 'sealed' : 'invalid',
      caseCount: corpus.cases.length,
      minimumCompleteCases: TF0604_MIN_CASES,
      sourceFileCount: corpus.provenance.sourceFileCount,
    },
    baseline: {
      status: aggregate.status,
      completeCaseCount: aggregate.completeCaseCount,
      reason: aggregate.reason,
      performanceClaim: false,
    },
    gates: {
      corpusIntegrity: corpusValidation,
      rawTrialShape: trialValidation,
      aggregateFloor: aggregateValidation,
      negativeControls: {
        passed: controlResults.every((entry) => entry.passed),
        count: controlResults.length,
        results: controlResults,
      },
    },
    claims: {
      realHuman: false,
      liveProvider: false,
      promotionReady: false,
      productLocksChanged: false,
    },
    sourceIdentity: {
      commit: corpus.provenance.sourceCommit,
      tree: corpus.provenance.sourceTree,
      corpusDigest: sha256Json(corpus),
    },
  };

  writeJson(join(PACK_ROOT, FILES.corpus), corpus);
  writeJson(join(PACK_ROOT, FILES.controls), controls);
  writeJson(join(PACK_ROOT, FILES.rawTrials), rawTrials);
  writeJson(join(PACK_ROOT, FILES.aggregate), aggregate);
  writeJson(join(PACK_ROOT, FILES.controlResults), controlResults);
  writeJson(join(PACK_ROOT, FILES.validation), report);
  writeSums();
  return report;
}

export function validateTf0604Pack(root = ROOT) {
  const packRoot = join(root, TF0604_PACK_DIR);
  const load = (file) => {
    const path = join(packRoot, file);
    if (!existsSync(path)) throw new Error(`missing TF-0604 pack file: ${file}`);
    return readJson(path);
  };
  const corpus = load(FILES.corpus);
  const controls = load(FILES.controls);
  const rawTrials = load(FILES.rawTrials);
  const aggregate = load(FILES.aggregate);
  const controlResults = load(FILES.controlResults);
  const report = load(FILES.validation);
  const corpusValidation = validateCorpus(corpus, root);
  const trialValidation = validateRawTrials(rawTrials, corpus);
  const aggregateValidation = validateAggregate(aggregate, corpus, rawTrials);
  const observedControls = runNegativeControls(corpus, aggregate, controls, root);
  const errors = [
    ...corpusValidation.errors,
    ...trialValidation.errors,
    ...aggregateValidation.errors,
    ...(observedControls.every((entry) => entry.passed) ? [] : [error('negative-controls', 'one or more negative controls escaped')]),
    ...(controlResults.every((entry) => entry.passed) ? [] : [error('negative-control-report', 'persisted negative-control result is not all-pass')]),
    ...(report?.claims?.realHuman === false && report?.claims?.liveProvider === false ? [] : [error('claim-boundary', 'validation report overclaims live or human evidence')]),
    ...verifySumsAt(root).errors,
  ];
  return {
    passed: errors.length === 0,
    errors,
    corpusCaseCount: corpus.cases.length,
    baselineStatus: aggregate.status,
    negativeControlCount: observedControls.length,
  };
}

function verifySumsAt(root) {
  const packRoot = join(root, TF0604_PACK_DIR);
  const path = join(packRoot, FILES.sums);
  if (!existsSync(path)) return { passed: false, errors: [error('hash-manifest-missing', 'SHA256SUMS is missing')] };
  const errors = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean)) {
    const [, expected, file] = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u) ?? [];
    const target = file ? join(packRoot, file) : null;
    if (!expected || !file || !target || !existsSync(target) || sha256File(target) !== expected) errors.push(error('hash-mismatch', `hash mismatch or missing file: ${file ?? '<invalid-line>'}`));
  }
  return { passed: errors.length === 0, errors };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean' }, check: { type: 'boolean' }, json: { type: 'boolean' } } });
  try {
    const result = values.write ? writeTf0604Pack() : validateTf0604Pack();
    const summary = values.write
      ? { passed: result.gates.corpusIntegrity.passed && result.gates.rawTrialShape.passed && result.gates.aggregateFloor.passed && result.gates.negativeControls.passed, corpusCaseCount: result.corpus.caseCount, baselineStatus: result.baseline.status, negativeControlCount: result.gates.negativeControls.count }
      : result;
    if (values.json || values.write) console.log(JSON.stringify(summary, null, 2));
    else console.log(summary.passed ? `TF-0604 pack check passed (${summary.corpusCaseCount} cases; baseline=${summary.baselineStatus}; negative-controls=${summary.negativeControlCount}).` : summary.errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n'));
    process.exitCode = summary.passed ? 0 : 1;
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  }
}
