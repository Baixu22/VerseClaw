import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { validateFrameworkRegistry } from './agent-first-evaluation-framework.mjs';
import { LOOP_NEGATIVE_CONTROLS } from './agent-first-evaluation-loop.mjs';

export const CORPUS_DIR = 'harness/specs/fixtures/agent-first-system';
export const TASK_CLASSES = ['capability', 'regression', 'negative', 'adversarial', 'recovery'];
export const GRADER_IDS = ['system-condition-set', 'system-trace-policy'];
export const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function loadCorpus(root = process.cwd()) {
  const corpusPath = join(root, CORPUS_DIR, 'tasks.v1.json');
  const registryPath = join(root, CORPUS_DIR, 'registry-extension.v1.json');
  const corpus = json(corpusPath);
  const extension = json(registryPath);
  const base = json(join(root, extension.baseRegistry));
  const registry = { ...base };
  for (const field of ['registeredSubjects', 'registeredSuites', 'registeredGraders', 'registeredProfiles']) {
    registry[field] = [...base[field], ...(extension[field] ?? [])];
  }
  return { corpus, registry, extension, corpusDigest: sha256(readFileSync(corpusPath)), root };
}

export function validateCorpus(corpus, root = process.cwd()) {
  const errors = [];
  const fail = (code, detail) => errors.push({ code, detail });
  if (!object(corpus) || corpus.schemaVersion !== 'AgentFirstTaskCorpus/v1') return [{ code: 'corpus.schema', detail: 'invalid corpus' }];
  if (corpus.driven_by !== 'agent' || !text(corpus.actor)) fail('corpus.actor', 'agent actor required');
  const tasks = Array.isArray(corpus.tasks) ? corpus.tasks : [];
  if (tasks.length < 20 || tasks.length > 50 || corpus.k !== 3) fail('corpus.floor', '20-50 tasks and k=3 required');
  const ids = new Set();
  for (const task of tasks) {
    if (task?.schemaVersion !== 'AgentFirstTask/v1' || !text(task?.id) || ids.has(task.id)) fail('task.identity', String(task?.id));
    ids.add(task?.id);
    if (!TASK_CLASSES.includes(task?.class) || !text(task?.prompt) || !text(task?.scope) || !text(task?.risk)) fail('task.definition', String(task?.id));
    if (!object(task?.input) || !object(task?.executor) || !text(task?.reference?.steps) || !text(task?.reference?.command)) fail('task.reference', String(task?.id));
    try {
      const entrypoint = task?.reference?.entrypoint;
      const entrypointPath = resolve(root, String(entrypoint ?? '../missing'));
      if (!text(entrypoint) || relative(resolve(root), entrypointPath).startsWith('..') || sha256(readFileSync(entrypointPath)) !== task.reference.entrypointDigest || !task.reference.command.includes(entrypoint)) fail('task.reference-entrypoint', String(task?.id));
    } catch { fail('task.reference-entrypoint', String(task?.id)); }
    if (!['qa-scenario', 'loop-control'].includes(task?.executor?.kind)) fail('task.executor', String(task?.id));
    if (!Array.isArray(task?.negativeExamples) || !task.negativeExamples.length || !task.negativeExamples.every(text)) fail('task.negative', String(task?.id));
    const conditions = task?.oracle?.conditions;
    if (!Array.isArray(conditions) || !conditions.length || conditions.some((c) => !text(c?.id) || !text(c?.expression)) || new Set(conditions.map((c) => c.id)).size !== conditions.length) fail('task.oracle', String(task?.id));
    if (!Array.isArray(task?.graders) || GRADER_IDS.some((id) => !task.graders.includes(id))) fail('task.grader', String(task?.id));
    const source = task?.source;
    if (!text(source?.path) || !text(source?.sha256) || !text(source?.selector)) { fail('task.source', String(task?.id)); continue; }
    const absolute = resolve(root, source.path);
    const rel = relative(resolve(root), absolute);
    if (rel.startsWith('..') || source.path.includes('node_modules')) { fail('task.source-path', String(task.id)); continue; }
    try {
      const bytes = readFileSync(absolute);
      if (sha256(bytes) !== source.sha256 || !bytes.toString('utf8').includes(source.selector)) fail('task.source-drift', String(task.id));
      if (task.reference?.solutionPath !== source.path) fail('task.reference', String(task.id));
      if (task.executor.kind === 'qa-scenario') {
        const raw = bytes.toString('utf8');
        const blocks = Object.fromEntries([...raw.matchAll(/```yaml (qa-scenario|qa-flow)\r?\n([\s\S]*?)```/g)].map((m) => [m[1], parse(m[2])]));
        const scenario = blocks['qa-scenario'];
        const expressions = blocks['qa-flow']?.steps?.flatMap((step) => step.actions ?? []).filter((action) => action.assert).map((action) => String(action.assert.expr));
        if (scenario?.id !== task.executor.scenarioId || task.input.scenarioId !== scenario?.id || task.prompt !== scenario?.objective?.trim() || JSON.stringify(expressions) !== JSON.stringify(conditions?.map((condition) => condition.expression))) fail('task.reference-drift', String(task.id));
      } else if (task.executor.kind === 'loop-control') {
        const control = LOOP_NEGATIVE_CONTROLS.find((entry) => entry.id === task.executor.controlId);
        if (!control || task.input.controlId !== control.id || task.prompt !== control.requirement || conditions?.[0]?.expression !== `violations.includes('${control.expectedCode}')`) fail('task.reference-drift', String(task.id));
      }
    } catch { fail('task.source-missing', String(task.id)); }
  }
  const split = corpus.split;
  if (!object(split) || split.writableByCandidate !== false || !Array.isArray(split.public) || !Array.isArray(split.heldOut) || !split.public.length || !split.heldOut.length) {
    fail('corpus.split', 'explicit readonly split required');
  } else {
    const all = [...split.public, ...split.heldOut];
    if (all.length !== tasks.length || new Set(all).size !== tasks.length || all.some((id) => !ids.has(id))) fail('corpus.split-coverage', 'split must cover each task once');
  }
  if (TASK_CLASSES.some((category) => !tasks.some((task) => task?.class === category))) fail('corpus.class-coverage', 'all task classes required');
  if (corpus.profileStatus !== 'not-run' || corpus.trialsExecuted !== 0) fail('corpus.unrun', 'corpus calibration is not a current-system trial');
  return errors;
}

/** Grades observation values. Agent text and supplemental model votes are never state. */
export function gradeObservation(task, observation, graderId = 'system-condition-set') {
  const result = (verdict, reason) => ({ graderId, version: '1.0.0', verdict, reason });
  if (!GRADER_IDS.includes(graderId)) return result('unknown', 'unregistered-grader');
  if (!object(task) || !object(observation) || observation.taskId !== task.id || !['environment', 'filesystem', 'gateway', 'host-api'].includes(observation.source)) return result('unknown', 'missing-or-untrusted-observation');
  if (graderId === 'system-trace-policy') {
    if (!text(observation.trialId) || !Array.isArray(observation.events) || (task.executor?.kind === 'qa-scenario' && !observation.events.length)) return result('unknown', 'trace-missing');
    if (observation.events.some((event) => !object(event) || event.authorized !== true || event.trialId !== observation.trialId || !task.permissions?.effects?.includes(event.effect) || event.outsideWorkspace === true || event.network === 'external')) return result('fail', 'unauthorized-or-cross-trial-effect');
    return result('pass', 'trace-policy-satisfied');
  }
  if (!Array.isArray(observation.conditions)) return result('unknown', 'final-state-missing');
  const seen = new Map();
  for (const condition of observation.conditions) {
    if (!object(condition) || !text(condition.id) || seen.has(condition.id)) return result('fail', 'duplicate-or-invalid-condition');
    seen.set(condition.id, condition.actual);
  }
  const expected = task.oracle.conditions.map((condition) => condition.id);
  if ([...seen.keys()].some((id) => !expected.includes(id))) return result('fail', 'unknown-condition');
  if (expected.some((id) => seen.get(id) === false)) return result('fail', 'deterministic-final-state-failed');
  if (expected.some((id) => seen.get(id) !== true)) return result('unknown', 'incomplete-final-state');
  return result('pass', 'all-frozen-final-state-conditions-satisfied');
}

export function zeroPassDiagnosis(passed, total) {
  return total > 0 && passed === 0 ? { category: 'task-or-grader-investigation', agentFailure: false } : null;
}

export function runCalibration(corpus, fixtures) {
  const results = [];
  for (const task of corpus.tasks) {
    for (const graderId of GRADER_IDS) {
      for (const expected of ['pass', 'fail', 'unknown']) {
        const fixture = fixtures.find((entry) => entry.taskId === task.id && entry.graderId === graderId && entry.expected === expected);
        const actual = fixture ? gradeObservation(task, fixture.observation, graderId) : { verdict: 'unknown', reason: 'calibration-fixture-missing' };
        results.push({ taskId: task.id, graderId, expected, actual: actual.verdict, ok: Boolean(fixture) && actual.verdict === expected });
      }
    }
  }
  return results;
}

export function checkCorpus(root = process.cwd()) {
  const loaded = loadCorpus(root);
  const errors = validateCorpus(loaded.corpus, root);
  const baseBytes = readFileSync(join(root, loaded.extension.baseRegistry));
  if (sha256(baseBytes) !== loaded.extension.baseRegistryDigest) errors.push({ code: 'registry.base-drift', detail: 'historical registry changed' });
  errors.push(...validateFrameworkRegistry(loaded.registry).violations.map((v) => ({ code: v.code, detail: v.message })));
  const suite = loaded.extension.registeredSuites[0];
  if (suite.contentDigest !== loaded.corpusDigest || JSON.stringify(suite.taskIds) !== JSON.stringify(loaded.corpus.tasks.map((task) => task.id))) errors.push({ code: 'registry.corpus-binding', detail: 'suite must bind exact corpus bytes/tasks' });
  const fixtures = json(join(root, CORPUS_DIR, 'calibration.v1.json'));
  if (fixtures.driven_by !== 'agent' || !text(fixtures.actor) || fixtures.evidenceKind !== 'deterministic-fixture') errors.push({ code: 'calibration.claim', detail: 'fixture provenance must be explicit' });
  const fixtureIds = fixtures.cases.map((entry) => `${entry.taskId}:${entry.graderId}:${entry.expected}`);
  if (fixtures.cases.length !== loaded.corpus.tasks.length * GRADER_IDS.length * 3 || new Set(fixtureIds).size !== fixtureIds.length) errors.push({ code: 'calibration.coverage', detail: 'exact unique known-good/bad/unknown coverage required' });
  const calibration = runCalibration(loaded.corpus, fixtures.cases);
  if (calibration.some((entry) => !entry.ok)) errors.push({ code: 'calibration.failed', detail: 'known-good/bad/unknown mismatch' });
  return { ok: !errors.length, errors, calibration, corpusDigest: loaded.corpusDigest, counts: Object.fromEntries(TASK_CLASSES.map((category) => [category, loaded.corpus.tasks.filter((task) => task.class === category).length])), taskCount: loaded.corpus.tasks.length, evaluationStatus: loaded.corpus.profileStatus };
}
