import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { artifactPath } from './agent-first-trials.mjs';
import { evaluateAblation } from './paired-ablation.mjs';
import { summarizeTf0592Trials } from '../rsi-tf0592-statistical-adjudication.mjs';
import { sha256File } from '../rsi-tf0604-baseline.mjs';
import { buildResponsesRequest, parseResponsesReply } from './rsi-responses-provider.mjs';
import { assessTaskAdmission, finalizeLiveAdmission } from '../rsi-live-acceptance.mjs';
import { CODING_BINDINGS_PATH, resolveHistoricalTask } from './rsi-live-grader.mjs';
import { CODING_COLLECTOR, CODING_INSTRUCTIONS, codingCollectorConfig, parseCodingEdits,
  parseCodingFinish, TOOL_CODING_COLLECTOR, TOOL_CODING_INSTRUCTIONS } from './rsi-coding-protocol.mjs';
import { reserveProviderTokens } from './rsi-coding-protocol.mjs';
import { hasPassingPublicCheck, verifyCodingToolJournal } from './rsi-coding-tools.mjs';
import { buildPublicTaskInputs, TASK_INPUT_BINDINGS, PUBLIC_BEHAVIOR_SOURCE } from './rsi-task-inputs.mjs';
import { bindEvolutionCandidate } from './rsi-candidate-evolution.mjs';
import { validateCampaignBudget } from './rsi-campaign-budget.mjs';

export const BENEFIT_ARMS = Object.freeze(['sekb-off', 'sekb-shadow', 'sekb-confirmed']);
const CORPUS = 'harness/specs/fixtures/rsi-evidence-loop/tf0604/task-corpus.v1.json';
const TASKS = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
const POLICY = 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json';
const SOURCES = [CORPUS, TASKS, POLICY, 'scripts/lib/rsi-benefit-eval.mjs', 'scripts/lib/rsi-benefit-eval.d.mts',
  'scripts/rsi-benefit-eval.mjs', 'scripts/lib/rsi-responses-provider.mjs', 'scripts/lib/rsi-responses-provider.d.mts',
  'scripts/lib/paired-ablation.mjs', 'scripts/lib/reliability-aggregation.mjs',
  'scripts/rsi-tf0604-baseline.mjs', 'scripts/lib/entrypoint.mjs',
  'scripts/rsi-tf0592-statistical-adjudication.mjs', 'scripts/lib/agent-first-trials.mjs',
  'tests/unit/rsi-benefit-eval.test.ts', 'tests/unit/rsi-responses-provider.test.ts',
  'scripts/rsi-live-acceptance.mjs', 'scripts/rsi-live-acceptance.d.mts',
  'scripts/lib/rsi-task-inputs.mjs', 'scripts/lib/rsi-task-inputs.d.mts',
  'scripts/lib/rsi-coding-tools.mjs', 'scripts/lib/rsi-coding-tools.d.mts',
  'scripts/lib/rsi-live-grader.mjs', 'scripts/lib/rsi-live-grader.d.mts',
  'scripts/lib/rsi-candidate-evolution.mjs', 'scripts/lib/rsi-candidate-evolution.d.mts',
  'tests/unit/rsi-live-grader.test.ts', 'harness/specs/tasks/rsi-benefit-eval.md'];
const FLAGS = {
  'sekb-off': { enabled: false, shadowEvaluation: false, injection: false },
  'sekb-shadow': { enabled: true, shadowEvaluation: true, injection: false },
  'sekb-confirmed': { enabled: true, shadowEvaluation: true, injection: true },
};
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const benefitDigest = (value) => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const fileDigest = (path) => benefitDigest(readFileSync(path));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function repoPath(value, label = 'repository path') {
  assert(text(value), `${label}-required`);
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  const parts = normalized.split('/');
  assert(normalized && !isAbsolute(value) && !parts.some((part) => !part || part === '..' || /^[A-Za-z]:$/u.test(part))
    && !parts.includes('.git') && !parts.includes('node_modules'), `invalid-${label}`);
  return normalized;
}
function inTaskScope(path, scope) {
  const normalized = repoPath(scope, 'target-scope');
  return path === normalized || path.startsWith(normalized.endsWith('/') ? normalized : `${normalized}/`);
}
function validateTaskEdits(task, edits, measured) {
  assert(Array.isArray(edits), 'trial-edits-required');
  if (!measured) {
    assert.equal(edits.length, 0, 'offline-trial-cannot-claim-edits');
    return [];
  }
  const oraclePaths = new Set(task.oracle.testPaths.map((path) => repoPath(path, 'oracle-path')));
  const seen = new Set();
  for (const edit of edits) {
    assert.deepEqual(Object.keys(edit ?? {}).sort(), ['content', 'path'], 'undeclared-edit-fields');
    const path = repoPath(edit.path, 'edit-path');
    assert.equal(edit.path, path, 'non-canonical-edit-path');
    assert(!oraclePaths.has(path), `edit-targets-hidden-oracle:${path}`);
    assert(task.targetScope.some((scope) => inTaskScope(path, scope)), `edit-outside-task-scope:${path}`);
    assert(typeof edit.content === 'string', `edit-content-required:${path}`);
    assert(!seen.has(path), `duplicate-edit-path:${path}`);
    seen.add(path);
  }
  return edits;
}function write(path, value, exclusive = false) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (exclusive) writeFileSync(path, bytes, { flag: 'wx' });
  else {
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, bytes, { flag: 'wx' });
    renameSync(temp, path);
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}
function acquireRunLock(directory, planDigest) {
  const path = join(directory, '.run.lock');
  const payload = { schemaVersion: 'RsiRunLock/v1', pid: process.pid, startedAt: new Date().toISOString(), planDigest };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify(payload)}\n`, { flag: 'wx' });
      return path;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing;
      try { existing = read(path); } catch (parseError) { throw new Error('run-lock-invalid', { cause: parseError }); }
      assert.equal(existing.schemaVersion, 'RsiRunLock/v1', 'run-lock-invalid');
      assert(Number.isInteger(existing.pid) && existing.pid > 0, 'run-lock-invalid');
      if (processAlive(existing.pid)) throw new Error('run-in-progress', { cause: error });
      unlinkSync(path);
    }
  }
  throw new Error('run-in-progress');
}
function releaseRunLock(path) {
  try { unlinkSync(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 }).trim();
}
const codingContextCache = new Map();
function codingContext(root, task) {
  const key = `${root}:${task.base}:${benefitDigest(task.input.targetScope)}:${benefitDigest(task.baselineSetup ?? null)}`;
  if (codingContextCache.has(key)) return codingContextCache.get(key);
  const missing = new Set(task.baselineSetup?.removePaths.map(entry => entry.path) ?? []);
  const queue = task.input.targetScope.filter(p => /\.(?:[cm]?[jt]sx?|json|md)$/u.test(p));
  const seen = new Set(), files = [];
  let remaining = CODING_COLLECTOR.maxContextChars;
  while (queue.length && files.length < 24 && remaining > 0) {
    const path = queue.shift().replaceAll('\\', '/');
    if (seen.has(path) || path.includes('..') || task.oracle.testPaths.includes(path)
      || path === task.referenceSolution.sourceRecord
      || /(?:^|\/)(?:tests|fixtures)\/|\.test\.|\.spec\.|SHA256SUMS$/u.test(path)) continue;
    seen.add(path);
    let bytes;
    try { bytes = execFileSync('git', ['show', `${task.base}:${path}`], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { files.push({ path, content: null, missing: true }); continue; }
    if (missing.has(path)) { files.push({ path, content: null, missing: true }); continue; }
    const content = bytes.toString('utf8');
    const selected = content.slice(0, remaining);
    files.push({ path, content: selected, truncated: selected.length !== content.length }); remaining -= selected.length;
    for (const match of content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/gu)) {
      const stem = join(dirname(path), match[1]).replaceAll('\\', '/');
      const options = /\.[cm]?[jt]sx?$/u.test(stem) ? [stem.replace(/\.js$/u, '.ts'), stem] : [`${stem}.ts`, `${stem}.mjs`, `${stem}.tsx`];
      for (const candidate of options) {
        try { execFileSync('git', ['cat-file', '-e', `${task.base}:${candidate}`], { cwd: root, windowsHide: true, stdio: 'ignore' }); queue.push(candidate); break; } catch { /* Absent at this historical base. */ }
      }
    }
  }
  codingContextCache.set(key, files);
  return files;
}
function taskSet(root, codingCollector = false, collector = null) {
  const corpus = read(join(root, CORPUS));
  const historical = read(join(root, TASKS));
  const tasks = corpus.cases.map((entry) => {
    const task = codingCollector ? resolveHistoricalTask(root, entry.id, { codingCohort: true })
      : historical.tasks.find((task) => task.id === entry.id);
    assert(task, `task-source-missing:${entry.id}`);
    assert(text(task.input?.prompt), `task-prompt-missing:${entry.id}`);
    const originalScope = (task.input?.targetScope ?? []).map((path) => repoPath(path, 'target-scope'));
    const targetScope = codingCollector ? originalScope.filter(path => !task.oracle.testPaths.includes(path)
      && path !== task.referenceSolution.sourceRecord
      && !/(?:^|\/)tests\/|\.test\.|\.spec\.|SHA256SUMS$/u.test(path)) : originalScope;
    const acceptanceCriteria = (task.input?.acceptanceCriteria ?? []).map((criterion, index) => {
      assert(text(criterion), `task-acceptance-criterion-missing:${entry.id}:${index}`);
      return criterion;
    });
    assert(targetScope.length > 0, `task-target-scope-required:${entry.id}`);
    const recordPath = repoPath(task.referenceSolution?.sourceRecord, 'source-record-path');
    const recordDigest = sha256File(artifactPath(root, recordPath));
    assert.equal(recordDigest, task.referenceSolution.sourceRecordSha256, `source-record-digest-mismatch:${entry.id}`);
    const publicInput = collector?.publicInputProtocol ? buildPublicTaskInputs(root, entry.id, {
      maxContextChars: collector.maxContextChars, responseSchema: collector.responseSchema,
    }) : null;
    const sourceRecord = read(artifactPath(root, recordPath));
    const base = sourceRecord.candidate?.base;
    const reference = sourceRecord.candidate?.commit;
    assert(/^[0-9a-f]{40}$/u.test(base ?? '') && /^[0-9a-f]{40}$/u.test(reference ?? ''), `source-revision-missing:${entry.id}`);
    assert.equal(reference, task.referenceSolution.referenceCommit, `source-reference-drift:${entry.id}`);
    return {
      id: entry.id, taskId: entry.taskId, split: historical.split.heldOut.includes(entry.id) ? 'held-out' : 'public',
      safetyRequired: entry.safetyRequired === true, anchor: entry.anchor ?? null,
      negativeExpectedOutcome: entry.negativeExpectedOutcome ?? 'fail',
      prompt: task.input.prompt, acceptanceCriteria, targetScope,
      source: { recordPath, recordDigest, base, reference },
      ...(codingCollector ? { baselineSetup: task.baselineSetup ?? null,
        contextFiles: publicInput ? publicInput.input.baseFiles : codingContext(root, task), oracleTestDigests: task.oracleTestDigests } : {}),
      ...(publicInput ? { publicInput: publicInput.input, publicInputDigest: publicInput.inputDigest,
        publicInputSources: publicInput.sources, publicInputOmissions: publicInput.omitted } : {}),
      oracleDigest: benefitDigest(task.oracle),
      oracle: { commands: task.oracle.commandLines, testPaths: task.oracle.testPaths,
        expectedSkips: task.oracle.expectedSkips, inputDigests: task.oracle.inputDigests },
    };
  });
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length, 'duplicate-task-identity');
  assert.equal(new Set(tasks.map((task) => task.source.recordPath)).size > 0, true, 'source-record-coverage');
  return tasks;
}function schedule(tasks) {
  // Rotate arm order within each case/repeat: no all-off-then-all-treatment run.
  return tasks.flatMap((task, index) => [1, 2, 3].flatMap((repeat) => {
    const offset = (index + repeat - 1) % BENEFIT_ARMS.length;
    return BENEFIT_ARMS.map((_, armIndex) => {
      const arm = BENEFIT_ARMS[(armIndex + offset) % BENEFIT_ARMS.length];
      return { id: `${task.id}-${repeat}-${arm}`, caseId: task.id, repeat, arm,
        caseDigest: benefitDigest(task), pairSeed: index * 3 + repeat, flagsDigest: benefitDigest(FLAGS[arm]) };
    });
  })).map((slot, position) => ({ ...slot, position }));
}

export function createBenefitPlan(root, options = {}) {
  root = resolve(root);
  const collector = options.codingCollector ? codingCollectorConfig(options.collectorVersion) : null;
  const tasks = taskSet(root, options.codingCollector, collector), policy = read(join(root, POLICY));
  assert.equal(tasks.length, 24, 'existing-corpus-required');
  assert.equal(policy.taskSet.k, 3); assert.equal(policy.taskSet.minimumCompleteCases, 20);
  assert.equal(policy.promotion.thresholds.passKAbsoluteImprovement.minimum, 0.05);
  assert.equal(policy.budgets.costCeiling.maxRelativeIncrease, 0.1);
  const endpoint = options.endpoint ?? 'http://127.0.0.1:3065/v1/responses';
  const url = new URL(endpoint);
  assert(!url.username && !url.password && !url.search && !url.hash, 'credential-free-endpoint-required');
  assert(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'invalid-provider-endpoint');
  const model = options.model ?? 'space-bunny';
  const mode = options.mode ?? 'offline';
  assert(['offline', 'measured'].includes(mode), 'invalid-evaluation-mode');
  assert(text(model) && text(options.actor ?? 'codex/rsi-benefit-eval'), 'actor-and-model-required');
  const evolutionBinding = options.candidateEvolution
    ? bindEvolutionCandidate(options.candidateEvolution, options.candidateGeneration, tasks) : null;
  if (evolutionBinding) assert(mode === 'measured' && collector?.version === TOOL_CODING_COLLECTOR.version, 'evolution-requires-v4-measured-plan');
  const candidate = options.candidate ?? evolutionBinding?.candidate ?? {
    id: 'offline-context-control', kind: 'synthetic-control', sourceCaseIds: ['offline-training-control'],
    context: 'Offline SEKB context marker. This control does not contain a solution to any evaluation task.',
  };
  const candidateKind = evolutionBinding ? 'evolved-prompt' : mode === 'offline' ? 'synthetic-control' : 'confirmed-sekb';
  assert(text(candidate.id) && candidate.kind === candidateKind && text(candidate.context), 'candidate-kind-mismatch');
  if (evolutionBinding) assert.deepEqual(candidate, evolutionBinding.candidate, 'evolution-candidate-drift');
  assert.deepEqual(Object.keys(candidate).sort(), ['context', 'id', 'kind', 'sourceCaseIds'], 'undeclared-candidate-fields');
  assert(Array.isArray(candidate.sourceCaseIds) && candidate.sourceCaseIds.length > 0, 'candidate-provenance-required');
  assert(candidate.sourceCaseIds.every((id) => text(id) && !tasks.some((task) => task.id === id)), 'training-evaluation-overlap');
  if (options.codingCollector && mode === 'measured' && !evolutionBinding) {
    const frozen = read(join(root, 'harness/specs/fixtures/rsi-coding-cohort/candidate.json'));
    const provenance = read(join(root, 'harness/specs/fixtures/rsi-coding-cohort/candidate-provenance.json'));
    assert.deepEqual(candidate, frozen, 'coding-candidate-drift');
    assert.equal(provenance.candidateDigest, benefitDigest(candidate), 'coding-candidate-provenance-drift');
    assert(provenance.driven_by === 'agent' && provenance.principle?.created_by === 'agent', 'candidate-agent-provenance-required');
    assert.deepEqual(provenance.records.map(item => item.id), candidate.sourceCaseIds, 'candidate-source-case-drift');
    assert(provenance.records.every(item => item.results?.length === 2 && item.results[0].exitCode === 1 && item.results[1].exitCode === 0), 'candidate-training-evidence-required');
  }
  const maxProviderCalls = mode === 'offline' ? 0 : options.maxProviderCalls;
  const maxTotalTokens = mode === 'offline' ? null : options.maxTotalTokens;
  if (mode === 'measured') assert(Number.isSafeInteger(maxProviderCalls) && maxProviderCalls >= 216
    && Number.isSafeInteger(maxTotalTokens) && maxTotalTokens > 0, 'explicit-measurement-budget-required');
  if (options.campaignBudget) {
    validateCampaignBudget(options.campaignBudget);
    assert(evolutionBinding && collector?.version === TOOL_CODING_COLLECTOR.version, 'campaign-requires-evolved-v4-plan');
    assert.equal(options.campaignBudget.endpoint, endpoint, 'campaign-endpoint-drift');
    assert.equal(options.campaignBudget.model, model, 'campaign-model-drift');
    assert(maxProviderCalls <= options.campaignBudget.authorization.maxProviderCalls
      && maxTotalTokens <= options.campaignBudget.authorization.maxTotalTokens, 'campaign-plan-budget-drift');
  }
  const paths = [...new Set([...SOURCES, ...(options.codingCollector ? [CODING_BINDINGS_PATH,
    'scripts/rsi-coding-collector.mjs', 'scripts/rsi-coding-collector.d.mts', 'scripts/rsi-coding-candidate.mts',
    'scripts/lib/rsi-coding-protocol.mjs', 'scripts/lib/rsi-coding-protocol.d.mts', 'tests/unit/rsi-coding-collector.test.ts',
    'harness/specs/fixtures/rsi-coding-cohort/candidate.json', 'harness/specs/fixtures/rsi-coding-cohort/candidate-provenance.json'] : []),
    ...(collector?.version === 'RsiCodingCollector/v2' ? ['harness/specs/tasks/rsi-coding-full-completion.md'] : []),
    ...(collector?.publicInputProtocol ? [TASK_INPUT_BINDINGS, PUBLIC_BEHAVIOR_SOURCE, 'scripts/rsi-task-inputs.mjs',
      'harness/specs/rules/rsi-public-input-boundary.md', 'harness/specs/tasks/rsi-public-task-inputs.md',
      'tests/unit/rsi-task-inputs.test.ts'] : []),
    ...(collector?.version === TOOL_CODING_COLLECTOR.version ? ['scripts/lib/rsi-coding-tool-loop.mjs',
      'scripts/lib/rsi-coding-tool-loop.d.mts', 'scripts/rsi-coding-tool-integration.mjs',
      'tests/unit/rsi-coding-tool-loop.test.ts',
      'harness/specs/tasks/rsi-bounded-coding-loop.md'] : []),
    ...(evolutionBinding ? ['scripts/rsi-candidate-evolution.mjs', 'scripts/rsi-candidate-evolution.d.mts',
      'scripts/rsi-candidate-evolution-integration.mjs', 'tests/unit/rsi-candidate-evolution.test.ts',
      'vitest.rsi-adoption.config.ts', 'openclaw_runtime/src/knowledge/sekb/knowledge-store.ts',
      'openclaw_runtime/src/knowledge/sekb/trajectory-redaction.ts', 'openclaw_runtime/src/knowledge/sekb/types.ts',
      'harness/specs/tasks/rsi-candidate-evolution.md', 'harness/specs/rules/rsi-candidate-evolution-boundary.md'] : []),
    ...(options.campaignBudget ? ['scripts/lib/rsi-campaign-budget.mjs', 'scripts/lib/rsi-campaign-budget.d.mts',
      'scripts/rsi-paired-measurement.mjs', 'scripts/rsi-paired-measurement.d.mts',
      'tests/unit/rsi-campaign-budget.test.ts', 'harness/specs/tasks/rsi-paired-measurement.md',
      'harness/specs/rules/rsi-campaign-budget-boundary.md'] : []),
    ...tasks.flatMap((task) => [task.source.recordPath, ...Object.keys(task.oracle.inputDigests)])])].sort();
  // Source bindings use the repository's canonical text bytes across LF/CRLF
  // checkouts. Raw run receipts and their manifest remain byte-addressed.
  const bindings = Object.fromEntries(paths.map((path) => [path, sha256File(artifactPath(root, path))]));
  const commit = git(root, ['rev-parse', 'HEAD']);
  return {
    schemaVersion: evolutionBinding ? 'RsiBenefitPlan/v2' : 'RsiBenefitPlan/v1', driven_by: 'agent', actor: options.actor ?? 'codex/rsi-benefit-eval',
    runId: options.runId ?? randomUUID(), evidenceKind: mode === 'offline' ? 'synthetic-wiring-fixture' : 'live-provider',
    source: { commit, tree: git(root, ['rev-parse', 'HEAD^{tree}']), bindings,
      boundary: 'Bindings pin working bytes; measured receipts also require a clean committed evaluator at final check.' },
    provider: { endpoint, model, maxOutputTokens: collector ? collector.maxOutputTokens : 2048 },
    ...(collector ? { collector: structuredClone(collector) } : {}),
    ...(evolutionBinding ? { evolution: evolutionBinding.evolution } : {}),
    budget: { providerCallsAuthorized: maxProviderCalls, maxTotalTokens, network: mode === 'offline' ? 'none' : 'declared-provider-only', retries: 0,
      ...(options.campaignBudget ? { campaign: structuredClone(options.campaignBudget) } : {}) },
    design: { k: 3, minimumCompleteCases: 20, primaryComparison: 'sekb-confirmed-vs-off', order: 'rotating-three-arm',
      unit: 'caseId', minimumImprovement: 0.05, costIncreaseMaximum: 0.1 },
    arms: structuredClone(FLAGS), candidate, candidateDigest: benefitDigest(candidate), tasks, policy, slots: schedule(tasks),
    claims: { realHuman: false, liveProvider: false, benefit: false, promotionReady: false, productLocksChanged: false },
  };
}

export function validateBenefitPlan(plan, root) {
  assert(['RsiBenefitPlan/v1', 'RsiBenefitPlan/v2'].includes(plan?.schemaVersion), 'benefit-plan-version');
  assert(text(plan.runId) && plan.driven_by === 'agent' && text(plan.actor), 'plan-identity');
  assert(['synthetic-wiring-fixture', 'live-provider'].includes(plan.evidenceKind), 'invalid-evidence-kind');
  const expected = createBenefitPlan(root, { endpoint: plan.provider?.endpoint, model: plan.provider?.model,
    actor: plan.actor, runId: plan.runId, candidate: plan.candidate,
    mode: plan.evidenceKind === 'live-provider' ? 'measured' : 'offline',
    maxProviderCalls: plan.budget?.providerCallsAuthorized, maxTotalTokens: plan.budget?.maxTotalTokens,
    codingCollector: Boolean(plan.collector), collectorVersion: plan.collector?.version,
    candidateEvolution: plan.evolution?.export, candidateGeneration: plan.evolution?.generation,
    campaignBudget: plan.budget?.campaign });
  assert.equal(plan.schemaVersion, expected.schemaVersion, 'benefit-plan-version-drift');
  assert.deepEqual(plan.evolution, expected.evolution, 'frozen-evolution-drift');
  assert.deepEqual(plan.collector, expected.collector, 'frozen-collector-drift');
  for (const field of ['provider', 'budget', 'design', 'arms', 'candidate', 'candidateDigest', 'tasks', 'policy', 'slots', 'claims']) {
    assert.deepEqual(plan[field], expected[field], `frozen-${field}-drift`);
  }
  assert.deepEqual(plan.source.bindings, expected.source.bindings, 'evaluator-source-drift');
  assert.equal(git(root, ['rev-parse', `${plan.source.commit}^{tree}`]), plan.source.tree, 'candidate-tree-drift');
  git(root, ['merge-base', '--is-ancestor', plan.source.commit, 'HEAD']);
  return true;
}

export function writeBenefitPlan(root, directory, options = {}) {
  const plan = createBenefitPlan(root, options);
  directory = resolve(directory);
  assert(!existsSync(directory) || readdirSync(directory).length === 0, 'new-run-directory-required');
  write(join(directory, 'plan.json'), plan, true);
  writeFileSync(join(directory, 'plan.sha256'), `${fileDigest(join(directory, 'plan.json'))}\n`, { flag: 'wx' });
  return plan;
}
function loadPlan(root, directory) {
  const plan = read(artifactPath(directory, 'plan.json'));
  assert.equal(readFileSync(artifactPath(directory, 'plan.sha256'), 'utf8').trim(), fileDigest(join(directory, 'plan.json')), 'plan-seal-drift');
  validateBenefitPlan(plan, root);
  return plan;
}

export function buildBenefitRequest(plan, slot) {
  const task = plan.tasks.find((entry) => entry.id === slot.caseId);
  assert(task && plan.slots.some((entry) => entry.id === slot.id), 'unknown-trial');
  // Only this projection reaches the subject. Oracle content, split membership and
  // reference solutions remain evaluator-only; task criteria and target scope are
  // subject inputs rather than hidden grading metadata.
  let instructions = 'Perform the supplied task. Treat retrieved experience as advisory; preserve existing safety and authorization rules.'
    + (plan.collector ? `\n${CODING_INSTRUCTIONS}` : '');
  if (plan.collector?.publicInputProtocol) {
    if (plan.collector.version === TOOL_CODING_COLLECTOR.version) instructions = TOOL_CODING_INSTRUCTIONS;
    assert.equal(benefitDigest(task.publicInput), task.publicInputDigest, 'public-subject-input-drift');
  }
  const input = JSON.stringify(plan.collector?.publicInputProtocol ? task.publicInput
    : { prompt: task.prompt, acceptanceCriteria: task.acceptanceCriteria, targetScope: task.targetScope,
      ...(plan.collector ? { responseSchema: plan.collector.responseSchema, baseFiles: task.contextFiles } : {}) }, null, 2);
  if (plan.collector?.publicInputProtocol) assert(input.length <= plan.collector.maxContextChars, 'public-input-over-budget');
  return buildResponsesRequest({ model: plan.provider.model, maxOutputTokens: plan.provider.maxOutputTokens,
    ...(plan.collector ? { reasoningEffort: plan.collector.reasoningEffort } : {}),
    ...(plan.collector?.responseFormat === 'strict-json-schema' ? { jsonSchema: plan.collector.responseSchema } : {}),
    ...(plan.collector?.tools ? { tools: plan.collector.tools } : {}),
    instructions: slot.arm === 'sekb-confirmed' ? [instructions, plan.candidate.context].join("\n") : instructions,
    input });
}

function offlineResponse(plan, slot) {
  const protectedTask = (task) => task.safetyRequired || task.anchor === 'positive';
  const improved = new Set(plan.tasks.filter((task) => !protectedTask(task)).slice(0, 6).map((task) => task.id));
  const task = plan.tasks.find((task) => task.id === slot.caseId);
  const correct = protectedTask(task) || slot.arm === 'sekb-confirmed' && improved.has(task.id);
  const inputTokens = slot.arm === 'sekb-confirmed' ? 1020 : 1000;
  return {
    id: `offline-${slot.id}`, model: plan.provider.model, status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ caseId: task.id, probeValue: correct ? 'ok' : 'wrong' }) }] }],
    usage: { input_tokens: inputTokens, output_tokens: 100, total_tokens: inputTokens + 100 },
  };
}
const recordPath = (slot) => `trials/${slot.id}.json`;
const startPath = (slot) => `started/${slot.id}.json`;

function trialReceipt(plan, slot, interrupted = false) {
  const request = buildBenefitRequest(plan, slot);
  return {
    schemaVersion: 'RsiBenefitTrial/v1', driven_by: 'agent', actor: `${plan.actor}/executor`,
    planDigest: benefitDigest(plan), slot, evidenceKind: plan.evidenceKind,
    request, requestDigest: benefitDigest(request),
    runtime: { flags: plan.arms[slot.arm], flagsDigest: slot.flagsDigest,
      candidateDigest: plan.candidateDigest, injectionDigest: slot.arm === 'sekb-confirmed' ? benefitDigest(plan.candidate.context) : null,
      isolationId: `${plan.runId}/${slot.id}`, runtimeEffectMeasured: plan.evidenceKind === 'live-provider' },
    edits: [],
    execution: { status: interrupted ? 'crash' : 'completed', failureClass: interrupted ? 'infrastructure' : null,
      attempts: 1, providerCalls: 0, wallClockMs: null, costUsd: null, toolEvents: [],
      runPosition: slot.position, startedAt: null, endedAt: null,
      measurementBasis: plan.evidenceKind === 'live-provider' ? 'live-provider' : 'synthetic-control',
      note: interrupted ? 'interrupted slot preserved; no retry' : 'No model or historical task execution; protocol control only.' },
    rawResponse: interrupted ? null : offlineResponse(plan, slot), providerAttempts: [], grader: null,
  };
}

export function runOfflineBenefit(root, directory, options = {}) {
  directory = resolve(directory);
  const plan = loadPlan(root, directory), limit = options.limit ?? plan.slots.length;
  assert.equal(plan.evidenceKind, 'synthetic-wiring-fixture', 'offline-driver-cannot-execute-measured-plan');
  assert(Number.isInteger(limit) && limit >= 0, 'invalid-trial-limit');
  const lock = acquireRunLock(directory, benefitDigest(plan));
  let written = 0, resumed = 0;
  try {
    for (const slot of plan.slots) {
      const path = artifactPath(directory, recordPath(slot));
      if (existsSync(path)) { readTrial(plan, slot, directory, undefined, root); resumed++; continue; }
      if (written >= limit) break;
      const journal = artifactPath(directory, startPath(slot));
      const interrupted = existsSync(journal);
      if (interrupted) assert.deepEqual(read(journal), { planDigest: benefitDigest(plan), slotId: slot.id }, 'interrupted-plan-drift');
      if (!interrupted) write(journal, { planDigest: benefitDigest(plan), slotId: slot.id }, true);
      const startedAt = performance.now();
      const receipt = trialReceipt(plan, slot, interrupted);
      receipt.execution.startedAt = new Date().toISOString();
      receipt.execution.wallClockMs = Math.max(0, performance.now() - startedAt);
      receipt.execution.endedAt = new Date().toISOString();
      write(path, receipt, true);
      written++;
    }
  } finally { releaseRunLock(lock); }
  return { written, resumed, planned: plan.slots.length, providerCalls: 0 };
}

function readTrial(plan, slot, directory, supplied, root, priorRows) {
  const path = artifactPath(directory, recordPath(slot));
  if (supplied === undefined && !existsSync(path)) return null;
  const row = supplied ?? read(path), expected = trialReceipt(plan, slot);
  assert.deepEqual(Object.keys(row).sort(), Object.keys(expected).sort(), 'undeclared-trial-fields');
  for (const field of ['schemaVersion', 'driven_by', 'actor', 'planDigest', 'slot', 'evidenceKind', 'request', 'requestDigest', 'runtime']) {
    assert.deepEqual(row[field], expected[field], `trial-${field}-drift:${slot.id}`);
  }
  if (supplied === undefined) assert.deepEqual(read(artifactPath(directory, startPath(slot))), { planDigest: benefitDigest(plan), slotId: slot.id }, 'start-receipt-drift');
  const execution = row.execution;
  assert.equal(execution.attempts, 1, 'hidden-retry');
  const measured = plan.evidenceKind === 'live-provider';
  const task = plan.tasks.find((entry) => entry.id === slot.caseId);
  assert(task, 'unknown-trial-task');
  validateTaskEdits(task, row.edits, measured);
  assert.equal(execution.measurementBasis, measured ? 'live-provider' : 'synthetic-control', 'measurement-basis-drift');
  assert((execution.costUsd === null || measured && Number.isFinite(execution.costUsd) && execution.costUsd >= 0)
    && Array.isArray(execution.toolEvents) && Array.isArray(row.providerAttempts), 'invalid-cost-receipt');
  if (!measured) assert(execution.providerCalls === 0 && row.providerAttempts.length === 0 && row.grader === null, 'offline-provider-or-grader-claim');
  const attempts = measured ? readProviderAttempts(plan, row) : [];
  const toolLoop = plan.collector?.version === TOOL_CODING_COLLECTOR.version;
  if (toolLoop && measured) {
    const prior = priorRows ?? plan.slots.slice(0, slot.position).map(item => read(artifactPath(directory, recordPath(item))));
    assert.equal(execution.tokenBudgetAtStart, plan.budget.maxTotalTokens
      - prior.reduce((sum, item) => sum + reserveProviderTokens(plan, item.providerAttempts), 0), 'tool-token-budget-start-drift');
    assert.equal(execution.providerBudgetAtStart, Math.min(plan.collector.maxProviderCalls,
      plan.budget.providerCallsAuthorized - prior.reduce((sum, item) => sum + item.execution.providerCalls, 0)),
    'tool-provider-budget-start-drift');
    verifyCodingToolJournal(root, task, execution.toolEvents, row.edits, execution.status !== 'completed');
  }
  assert(Number.isFinite(execution.wallClockMs) && execution.wallClockMs >= 0, 'invalid-duration');
  assert.equal(execution.runPosition, slot.position, 'actual-execution-order-drift');
  assert(typeof execution.startedAt === 'string' && typeof execution.endedAt === 'string'
    && Number.isFinite(Date.parse(execution.startedAt)) && Number.isFinite(Date.parse(execution.endedAt))
    && Date.parse(execution.endedAt) >= Date.parse(execution.startedAt), 'invalid-execution-timestamps');
  assert(['completed', 'timeout', 'crash'].includes(execution.status), 'invalid-execution-status');
  if (execution.status !== 'completed') {
    assert(row.rawResponse === null && execution.failureClass === 'infrastructure', 'invalid-interrupted-trial');
    return { row, outcome: execution.status, failureClass: 'infrastructure',
      tokens: attempts.length && attempts.every((attempt) => attempt?.usage) ? attempts.reduce((n, attempt) => n + attempt.usage.totalTokens, 0) : null,
      turns: attempts.length || null, toolCalls: execution.toolEvents.length };
  }
  assert.equal(execution.failureClass, null, 'completed-failure-class');
  const response = parseResponsesReply(row.rawResponse);
  assert.equal(response.model, plan.provider.model, 'resolved-model-drift');
  if (!measured) assert.equal(response.id, `offline-${slot.id}`, 'response-identity-reused-or-drifted');
  else assert.deepEqual(row.rawResponse, row.providerAttempts.at(-1)?.rawResponse, 'terminal-provider-response-drift');
  const toolBudgetFailure = toolLoop && ['model-turn-limit', 'model-tool-limit'].includes(execution.failureCategory);
  if (!toolBudgetFailure && response.status === 'completed') assert.equal(response.functionCalls.length, 0, 'unconsumed-terminal-tool-call');
  let success = false;
  if (response.status === 'completed') {
    if (measured) {
      if (toolBudgetFailure) {
        assert.equal(row.grader, null, 'tool-budget-failure-cannot-claim-grade');
        assert(response.functionCalls.length > 0, 'tool-budget-terminal-calls-required');
        if (execution.failureCategory === 'model-turn-limit') {
          assert.equal(row.providerAttempts.length, plan.collector.maxProviderCalls, 'provider-limit-failure-drift');
        } else assert(execution.toolEvents.length + response.functionCalls.length > plan.collector.maxToolCalls,
          'tool-limit-failure-drift');
      } else if (toolLoop && execution.failureCategory === 'model-public-check') {
        assert.equal(row.grader, null, 'public-check-failure-cannot-claim-grade');
        assert(!hasPassingPublicCheck(execution.toolEvents), 'public-check-failure-drift');
      } else if (plan.collector && execution.failureCategory === 'model-format') {
        assert.equal(row.grader, null, 'format-failure-cannot-claim-grade');
        if (toolLoop) assert.throws(() => parseCodingFinish(response.text), undefined, 'valid-output-misclassified');
        else {
          assert.deepEqual(row.edits, [], 'format-failure-cannot-claim-edits');
          assert.throws(() => parseCodingEdits(response.text, task), undefined, 'valid-output-misclassified');
        }
      } else if (plan.collector?.incompleteOutcome === 'known-output-limit-is-failure'
        && execution.failureCategory === 'model-output-limit') {
        assert.equal(response.status, 'incomplete', 'output-limit-response-status');
        assert.equal(response.incompleteReason, 'max_output_tokens', 'output-limit-reason');
        assert(response.usage !== null, 'output-limit-usage-required');
        assert.equal(row.grader, null, 'output-limit-cannot-claim-grade');
        assert.deepEqual(row.edits, [], 'output-limit-cannot-claim-edits');
      } else { success = gradeMeasuredObservation(plan, slot, row); if (success) assert(row.edits.length > 0, 'pass-without-edits'); }
    }
    else try { const answer = JSON.parse(response.text); success = answer.caseId === slot.caseId && answer.probeValue === 'ok'; } catch { /* Malformed output is an agent failure. */ }
  }
  const outputLimitFailure = plan.collector?.incompleteOutcome === 'known-output-limit-is-failure'
    && response.status === 'incomplete' && response.incompleteReason === 'max_output_tokens';
  if (outputLimitFailure) {
    assert(response.usage !== null && execution.failureCategory === 'model-output-limit', 'output-limit-evidence-required');
    assert(row.grader === null && (toolLoop || row.edits.length === 0), 'output-limit-cannot-claim-grade');
  }
  const outcome = response.status === 'completed' ? success ? 'pass' : 'fail' : outputLimitFailure ? 'fail' : 'missing';
  return { row, outcome, failureClass: outcome === 'pass' ? null : 'agent',
    tokens: measured ? attempts.every((attempt) => attempt?.usage) ? attempts.reduce((n, attempt) => n + attempt.usage.totalTokens, 0) : null : response.usage?.totalTokens ?? null,
    turns: measured ? attempts.length : 1, toolCalls: execution.toolEvents.filter((event) => event.type === 'tool-call').length };
}

export function validateCollectedBenefitTrial(root, plan, receipt, priorRows = []) {
  validateBenefitPlan(plan, root);
  const slot = plan.slots.find(item => item.id === receipt?.slot?.id);
  assert(slot && priorRows.length === slot.position
    && priorRows.every((row, index) => row.slot.id === plan.slots[index].id), 'trial-prefix-required');
  return readTrial(plan, slot, resolve(root), receipt, root, priorRows);
}

function readProviderAttempts(plan, row) {
  assert.equal(row.execution.providerCalls, row.providerAttempts.length, 'provider-attempt-coverage');
  const calls = [];
  const attempts = row.providerAttempts.map((attempt, index) => {
    assert.deepEqual(Object.keys(attempt).sort(), ['endpoint', 'parsedResponse', 'rawResponse', 'request'], 'undeclared-provider-attempt-fields');
    assert.equal(attempt.endpoint, plan.provider.endpoint, 'provider-endpoint-drift');
    assert.equal(attempt.request?.model, plan.provider.model, 'provider-model-drift');
    assert.equal(attempt.request?.instructions, row.request.instructions, 'provider-context-drift');
    assert.deepEqual(Object.keys(attempt.request).sort(), Object.keys(row.request).sort(), 'provider-request-fields');
    for (const field of ['store', 'stream', 'truncation', 'max_output_tokens', 'reasoning', 'text', 'tools']) assert.deepEqual(attempt.request[field], row.request[field], 'provider-request-policy');
    if (index === 0) assert.deepEqual(attempt.request, row.request, 'initial-provider-request-drift');
    if (plan.collector && attempt.rawResponse === null) {
      assert(row.execution.status !== 'completed' && attempt.parsedResponse === null, 'invalid-provider-failure-attempt');
      return null;
    }
    const parsed = parseResponsesReply(attempt.rawResponse);
    assert.deepEqual(attempt.parsedResponse, parsed, 'raw-parsed-response-drift');
    assert.equal(parsed.model, plan.provider.model, 'resolved-model-drift');
    calls.push(...parsed.functionCalls);
    return parsed;
  });
  const toolLoop = plan.collector?.version === TOOL_CODING_COLLECTOR.version;
  if (plan.collector) assert(attempts.length <= (toolLoop ? plan.collector.maxProviderCalls : 1), 'coding-provider-retry');
  for (let index = 0; index < attempts.length - 1; index++) {
    assert(attempts[index].status === 'completed' && attempts[index].functionCalls.length > 0, 'undeclared-provider-retry');
    const nextInput = row.providerAttempts[index + 1].request.input;
    const previousInput = row.providerAttempts[index].request.input;
    const toolOutputs = attempts[index].functionCalls.map((call) => {
      const event = row.execution.toolEvents.find((event) => event.callId === call.callId);
      assert(event && event.name === call.name && event.arguments === call.arguments && typeof event.output === 'string', 'tool-result-not-bound');
      return { type: 'function_call_output', call_id: call.callId, output: event.output };
    });
    const history = Array.isArray(previousInput) ? previousInput : [{ role: 'user', content: previousInput }];
    assert.deepEqual(nextInput, [...history, ...row.providerAttempts[index].rawResponse.output, ...toolOutputs], 'tool-continuation-context-drift');
  }
  assert(row.execution.toolEvents.every((event) => event?.type === 'tool-call' && text(event.callId)), 'invalid-tool-events');
  const consumed = row.execution.toolEvents.length;
  if (toolLoop) {
    assert(consumed <= plan.collector.maxToolCalls, 'executed-tool-budget-drift');
    assert(consumed <= calls.length && consumed >= calls.length - (attempts.at(-1)?.functionCalls.length ?? 0), 'tool-call-prefix');
    const unfinished = row.execution.status !== 'completed'
      || ['model-turn-limit', 'model-tool-limit', 'model-output-limit'].includes(row.execution.failureCategory);
    assert(unfinished || consumed === calls.length, 'tool-call-coverage');
    assert.deepEqual(row.execution.toolEvents.map(event => event.callId), calls.slice(0, consumed).map(call => call.callId),
      'tool-call-prefix-drift');
  } else assert.deepEqual(row.execution.toolEvents.map((event) => event.callId).sort(), calls.map((call) => call.callId).sort(), 'tool-call-coverage');
  assert.equal(new Set(calls.map((call) => call.callId)).size, calls.length, 'repeated-tool-effect');
  if (row.execution.status === 'completed') assert(attempts.length > 0, 'missing-provider-receipt');
  return attempts;
}

function gradeMeasuredObservation(plan, slot, row) {
  const task = plan.tasks.find((task) => task.id === slot.caseId), grader = row.grader;
  assert(task, 'unknown-grader-task');
  assert.equal(grader?.schemaVersion, 'RsiBenefitGrader/v1', 'grader-schema');
  assert(grader?.driven_by === 'agent' && text(grader.actor) && grader.actor !== row.actor && grader.actor !== plan.actor, 'independent-grader-required');
  assert.equal(grader.workspaceRevision, task.source.base, 'grader-workspace-revision-drift');
  assert.equal(grader.oracleDigest, task.oracleDigest, 'grader-oracle-drift');
  assert.equal(grader.editsDigest, benefitDigest(row.edits), 'grader-edits-drift');
  if (plan.collector) {
    if (plan.collector.version === TOOL_CODING_COLLECTOR.version) {
      parseCodingFinish(parseResponsesReply(row.rawResponse).text);
      assert(hasPassingPublicCheck(row.execution.toolEvents), 'public-check-required-before-grade');
    }
    else assert.deepEqual(parseCodingEdits(parseResponsesReply(row.rawResponse).text, task), row.edits, 'response-edits-drift');
    assert.deepEqual(grader.baselineSetup ?? null, task.baselineSetup, 'grader-baseline-setup-drift');
    assert.equal(grader.oracleRevision, task.source.reference, 'grader-reference-drift');
    assert.deepEqual(grader.oracleTestDigests, task.oracleTestDigests, 'grader-test-digest-drift');
    assert.equal(grader.oracleUnchanged, true, 'grader-oracle-drift');
  }
  assert.deepEqual(grader.commands, task.oracle.commands, 'grader-command-drift');
  assert.equal(grader.responseDigest, benefitDigest(row.rawResponse), 'grader-response-drift');
  assert(grader.isolation?.hiddenOracleVisible === false && grader.isolation?.unapprovedEgress === false
    && grader.isolation?.candidateChangedEvaluator === false, 'evaluation-contamination');
  assert(Array.isArray(grader.reports) && grader.reports.length === grader.commands.length, 'grader-report-coverage');
  const tested = new Set(), outcomes = [];
  assert.equal(task.oracle.expectedSkips, 0, 'zero-skip-oracle-required');
  for (const [index, item] of grader.reports.entries()) {
    assert.equal(item.command, task.oracle.commands[index], 'grader-report-command-drift');
    if (plan.collector && item.kind === 'command') {
      assert(/^node scripts\//u.test(item.command) && item.report?.kind === 'command', 'grader-command-kind');
      assert(Number.isInteger(item.exitCode) && item.exitCode === item.report.exitCode, 'grader-command-exit-drift');
      for (const digest of [item.report.stdoutDigest, item.report.stderrDigest]) assert(/^[a-f0-9]{64}$/u.test(digest), 'grader-command-output-missing');
      outcomes.push(item.exitCode === 0);
      continue;
    }
    assert(Number.isInteger(item.exitCode) && Array.isArray(item.report?.testResults), 'grader-result-missing');
    const assertions = item.report.testResults.flatMap((suite) => {
      const path = typeof suite.name === 'string' ? suite.name.replaceAll('\\', '/') : '';
      for (const required of task.oracle.testPaths) if (path === required || path.endsWith(`/${required}`)) tested.add(required);
      assert(Array.isArray(suite.assertionResults), 'grader-assertions-missing');
      return suite.assertionResults;
    });
    if (plan.collector && item.report.success === false && item.exitCode !== 0 && assertions.length === 0) {
      assert(item.report.testResults.some(suite => typeof suite.message === 'string' && suite.message.length > 0), 'grader-suite-error-missing');
      outcomes.push(false);
      continue;
    }
    assert(assertions.length > 0 && assertions.length === item.report.numTotalTests, 'grader-test-count-drift');
    const failed = assertions.filter((entry) => entry.status === 'failed').length;
    const passed = assertions.filter((entry) => entry.status === 'passed').length;
    assert.equal(item.report.numFailedTests, failed, 'grader-failed-count-drift');
    assert.equal(item.report.numPassedTests, passed, 'grader-passed-count-drift');
    assert.equal(item.report.numSkippedTests ?? 0, task.oracle.expectedSkips, 'grader-skip-budget');
    assert.equal(item.report.numTodoTests ?? 0, 0, 'grader-todo-budget');
    outcomes.push(item.exitCode === 0 && failed === 0 && passed === assertions.length && item.report.numPendingTests === 0 && item.report.success === true);
  }
  assert(task.oracle.testPaths.every((path) => tested.has(path)), 'grader-test-path-coverage');
  return outcomes.every(Boolean);
}

export function recordMeasuredBenefitTrials(root, directory, receipts) {
  directory = resolve(directory);
  const plan = loadPlan(root, directory);
  assert.equal(plan.evidenceKind, 'live-provider', 'measured-receipt-requires-measured-plan');
  assert(Array.isArray(receipts) && receipts.length > 0, 'receipt-array-required');
  assert.equal(new Set(receipts.map((receipt) => receipt?.slot?.id)).size, receipts.length, 'duplicate-import-slot');
  verifyTaskAdmissions(root, directory, plan, new Set(receipts.map((receipt) => receipt?.slot?.caseId)));
  verifyLiveAdmissionReport(root, directory, plan);
  // Import only collector output. Existing receipts are immutable, never retries.
  const lock = acquireRunLock(directory, benefitDigest(plan));
  try {
    const existing = plan.slots.filter((slot) => existsSync(artifactPath(directory, recordPath(slot))));
    assert(existing.every((slot, index) => slot.position === index), 'existing-schedule-gap');
    const admitted = receipts.map((receipt) => {
      const slot = plan.slots.find((slot) => slot.id === receipt?.slot?.id);
      assert(slot, 'unknown-trial');
      const path = artifactPath(directory, recordPath(slot)), journal = artifactPath(directory, startPath(slot));
      assert(!existsSync(path) && !existsSync(journal), 'trial-already-recorded');
      const previousRows = plan.collector?.version === TOOL_CODING_COLLECTOR.version
        ? plan.slots.slice(0, slot.position).map(item => receipts.find(incoming => incoming.slot?.id === item.id)
          ?? read(artifactPath(directory, recordPath(item)))) : undefined;
      return { slot, path, journal, receipt, validated: readTrial(plan, slot, directory, receipt, root, previousRows) };
    });
    assert(admitted.every(({ slot }, index) => slot.position === existing.length + index), 'import-schedule-drift');
    const prior = existing.length ? readTrial(plan, existing.at(-1), directory, undefined, root).row : null;
    const ordered = [...(prior ? [prior] : []), ...admitted.map(({ receipt }) => receipt)];
    assert(ordered.every((row, index) => index === 0 || Date.parse(row.execution.startedAt) >= Date.parse(ordered[index - 1].execution.endedAt)), 'collector-order-or-overlap');
    for (const { slot, path, journal, receipt } of admitted) {
      write(journal, { planDigest: benefitDigest(plan), slotId: slot.id }, true);
      write(path, receipt, true);
    }
    return admitted.map(({ validated }) => validated);
  } finally { releaseRunLock(lock); }
}

function verifyTaskAdmissions(root, directory, plan, taskIds) {
  for (const taskId of taskIds) {
    const task = plan.tasks.find((task) => task.id === taskId);
    assert(task, 'unknown-calibration-task');
    const admission = read(artifactPath(directory, `calibration/${taskId}/admission.json`));
    assert.equal(admission.schemaVersion, 'RsiLiveTaskAdmission/v1', 'calibration-schema');
    assert.equal(admission.driven_by, 'agent', 'calibration-agent-label');
    assert(text(admission.actor), 'calibration-actor-required');
    assert.equal(admission.taskId, taskId, 'calibration-task-mismatch');
    assert.deepEqual(admission.claims, { modelQuality: false, benefit: false, realHuman: false }, 'calibration-claim-boundary');
    assert.equal(admission.source?.base, task.source.base, 'calibration-base-drift');
    assert.equal(admission.source?.reference, task.source.reference, 'calibration-reference-drift');
    assert.equal(admission.source?.sourceRecord, task.source.recordPath, 'calibration-source-path-drift');
    assert.equal(admission.source?.sourceRecordDigest, task.source.recordDigest, 'calibration-source-digest-drift');
    assert.equal(sha256File(artifactPath(root, task.source.recordPath)), task.source.recordDigest, 'bound-source-record-drift');
    const { reference, baseline } = admission.stages ?? {};
    for (const stage of [reference, baseline]) {
      assert.deepEqual(stage?.commands, task.oracle.commands, 'calibration-command-drift');
      assert.deepEqual(stage?.inputDigests, task.oracle.inputDigests, 'calibration-input-drift');
      assert.equal(stage?.oracleRevision, task.source.reference, 'calibration-oracle-revision-drift');
    }
    const observed = assessTaskAdmission({ reference, baseline });
    assert.deepEqual(admission.admission, observed, 'calibration-verdict-drift');
    assert(observed.passed, `task-calibration-rejected:${taskId}`);
  }
}
function verifyLiveAdmissionReport(root, directory, plan) {
  const saved = read(artifactPath(directory, 'calibration/admission-report.json'));
  const recomputed = finalizeLiveAdmission(root, directory, { write: false });
  assert.deepEqual(saved, recomputed, 'live-admission-recomputation');
  assert.equal(saved.status, 'ready-for-measurement', 'live-admission-not-ready');
  const providerReceipt = read(artifactPath(directory, 'provider-preflight.json'));
  assert.equal(providerReceipt.request?.url, plan.provider.endpoint, 'live-provider-endpoint-drift');
  assert.equal(providerReceipt.response?.model, plan.provider.model, 'live-provider-model-drift');
  assert.equal(saved.trialSlots.length, plan.slots.length, 'live-admission-slot-count');
  assert.deepEqual(saved.admissions.map((entry) => entry.taskId).sort(), plan.tasks.map((task) => task.id).sort(), 'live-admission-task-set');
  assert(saved.admissions.every((entry) => entry.passed === true && entry.status === 'admitted'), 'live-admission-task-rejected');
  return saved;
}
export function verifyCodingAdmission(root, directory, plan) {
  assert.deepEqual(plan.collector, codingCollectorConfig(plan.collector?.version), 'coding-plan-required');
  verifyTaskAdmissions(root, directory, plan, new Set(plan.tasks.map(task => task.id)));
  verifyLiveAdmissionReport(root, directory, plan);
  assert.equal(git(root, ['status', '--porcelain', '--', ...Object.keys(plan.source.bindings)]), '', 'measured-evaluator-uncommitted');
  for (const [path, digest] of Object.entries(plan.source.bindings)) {
    const bytes = execFileSync('git', ['show', `${plan.source.commit}:${path}`], { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(benefitDigest(bytes.replace(/\r\n?/gu, '\n')), digest, 'measured-source-not-in-candidate');
  }
  return true;
}
export function adoptLiveCalibration(root, directory, calibrationDir) {
  root = resolve(root); directory = resolve(directory); calibrationDir = resolve(calibrationDir);
  const plan = loadPlan(root, directory);
  assert.equal(plan.evidenceKind, 'live-provider', 'measured-plan-required');
  const sourceReportPath = artifactPath(calibrationDir, 'admission-report.json');
  const sourceReport = read(sourceReportPath);
  const recomputed = finalizeLiveAdmission(root, calibrationDir, { write: false });
  assert.deepEqual(sourceReport, recomputed, 'live-admission-report-drift');
  assert.equal(sourceReport.status, 'ready-for-measurement', 'live-admission-not-ready');
  assert.equal(sourceReport.trialSlots.length, plan.slots.length, 'live-admission-slot-count');
  assert.deepEqual(sourceReport.admissions.map((entry) => entry.taskId).sort(), plan.tasks.map((task) => task.id).sort(), 'live-admission-task-set');
  assert(sourceReport.admissions.every((entry) => entry.passed === true && entry.status === 'admitted'), 'live-admission-task-rejected');
  let copied = 0, existing = 0;
  const copyExact = (source, target) => {
    const bytes = readFileSync(source);
    if (existsSync(target)) {
      assert(readFileSync(target).equals(bytes), `calibration-copy-drift:${relative(directory, target)}`);
      existing += 1;
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx' });
      copied += 1;
    }
  };
  copyExact(sourceReportPath, artifactPath(directory, 'calibration/admission-report.json'));
  copyExact(artifactPath(calibrationDir, 'provider-preflight.json'), artifactPath(directory, 'provider-preflight.json'));
  if (plan.collector) copyExact(artifactPath(calibrationDir, 'task-bindings.json'), artifactPath(directory, 'task-bindings.json'));
  for (const task of plan.tasks) {
    const source = artifactPath(calibrationDir, `calibration/${task.id}/admission.json`);
    const target = artifactPath(directory, `calibration/${task.id}/admission.json`);
    copyExact(source, target);
  }
  verifyTaskAdmissions(root, directory, plan, new Set(plan.tasks.map((task) => task.id)));
  verifyLiveAdmissionReport(root, directory, plan);
  return { copied, existing, reportDigest: fileDigest(sourceReportPath), status: sourceReport.status };
}export function summarizeBenefitRun(root, directory, actor = 'codex/rsi-benefit-verifier') {
  directory = resolve(directory);
  assert(!existsSync(join(directory, '.run.lock')), 'run-in-progress');
  const plan = loadPlan(root, directory);
  assert(text(actor) && actor !== plan.actor && actor !== `${plan.actor}/executor`, 'distinct-verifier-role-required');
  const records = new Map(plan.slots.map((slot) => [slot.id, readTrial(plan, slot, directory, undefined, root)]));
  const actual = [...records.values()].filter(Boolean);
  if (plan.evidenceKind === 'live-provider' && actual.length > 0) {
    verifyTaskAdmissions(root, directory, plan, new Set(actual.map((record) => record.row.slot.caseId)));
    verifyLiveAdmissionReport(root, directory, plan);
  }
  assert(actual.every((record, index) => index === 0 || Date.parse(record.row.execution.startedAt) >= Date.parse(actual[index - 1].row.execution.endedAt)), 'collector-order-or-overlap');
  assert(actual.every((record) => record.row.grader?.actor !== actor), 'verifier-cannot-grade-own-run');
  const responseIds = actual.flatMap((record) => record.row.providerAttempts.filter(attempt => attempt.rawResponse !== null).map((attempt) => attempt.rawResponse.id));
  assert.equal(new Set(responseIds).size, responseIds.length, 'reused-provider-response');
  const providerCalls = actual.reduce((total, record) => total + record.row.execution.providerCalls, 0);
  assert(providerCalls <= plan.budget.providerCallsAuthorized, 'provider-call-budget-exceeded');
  const totalTokens = actual.length > 0 && actual.every((record) => record.tokens !== null) ? actual.reduce((n, record) => n + record.tokens, 0) : null;
  if (totalTokens !== null && plan.budget.maxTotalTokens !== null) assert(totalTokens <= plan.budget.maxTotalTokens, 'token-budget-exceeded');
  const corpus = { cases: plan.tasks.map((task) => ({ id: task.id, taskId: task.taskId, safetyRequired: task.safetyRequired,
    ...(task.anchor ? { anchor: task.anchor } : {}), negativeExpectedOutcome: task.negativeExpectedOutcome })) };
  const pair = (treatment) => summarizeTf0592Trials(corpus, { cases: plan.tasks.map((task) => ({ caseId: task.id,
    trials: plan.slots.filter((slot) => slot.caseId === task.id && ['sekb-off', treatment].includes(slot.arm)).map((slot) => {
      const trial = records.get(slot.id);
      return { arm: slot.arm === 'sekb-off' ? 'baseline' : 'treatment', repeat: slot.repeat,
        outcome: trial?.outcome ?? 'missing', failureClass: trial?.failureClass ?? (trial ? null : 'infrastructure'),
        tokens: trial?.tokens ?? null, turns: trial?.turns ?? null, toolCalls: trial?.toolCalls ?? null,
        wallClockMs: trial?.row.execution.wallClockMs ?? null, cost: trial?.row.execution.costUsd ?? null };
    }),
  })) }, plan.policy);
  const confirmed = pair('sekb-confirmed'), shadow = pair('sekb-shadow');
  const splitEffects = Object.fromEntries(['public', 'held-out'].map((split) => {
    const tasks = plan.tasks.filter((task) => task.split === split);
    const runs = (arm) => plan.slots.filter((slot) => slot.arm === arm && tasks.some((task) => task.id === slot.caseId)).map((slot) => {
      const record = records.get(slot.id), task = tasks.find((task) => task.id === slot.caseId);
      return { caseId: slot.caseId, repeat: slot.repeat, success: record?.outcome === 'pass', outcome: record?.outcome ?? 'missing',
        safetyRequired: task.safetyRequired, ...(task.anchor ? { anchor: task.anchor } : {}), negativeExpectedOutcome: task.negativeExpectedOutcome };
    });
    const result = evaluateAblation({ baselineRuns: runs('sekb-off'), treatmentRuns: runs('sekb-confirmed'),
      preRegistered: { primaryMetric: 'success', k: 3, minCases: 20, maxFlakeCases: 1 } });
    return [split, { cases: tasks.length, completePairs: result.effect.pairCount, passK: { off: result.baseline.passK, confirmed: result.treatment.passK }, effect: result.effect, verdict: result.verdict }];
  }));
  const missing = plan.slots.filter((slot) => records.get(slot.id) === null).map((slot) => slot.id);
  const incomplete = plan.slots.filter((slot) => records.get(slot.id) && !['pass', 'fail'].includes(records.get(slot.id).outcome)).map((slot) => slot.id);
  const measured = plan.evidenceKind === 'live-provider';
  const slotByKey = new Map(plan.slots.map((slot) => [`${slot.caseId}/${slot.repeat}/${slot.arm}`, slot]));
  const requestFor = (taskId, repeat, arm) => records.get(slotByKey.get(`${taskId}/${repeat}/${arm}`)?.id)?.row.request ?? null;
  const offShadowInputsIdentical = plan.tasks.every((task) => [1, 2, 3].every((repeat) => {
    const off = requestFor(task.id, repeat, 'sekb-off');
    const shadow = requestFor(task.id, repeat, 'sekb-shadow');
    return Boolean(off && shadow) && benefitDigest(off) === benefitDigest(shadow);
  }));
  const confirmedCandidateBound = plan.tasks.every((task) => [1, 2, 3].every((repeat) => {
    const off = requestFor(task.id, repeat, 'sekb-off');
    const shadow = requestFor(task.id, repeat, 'sekb-shadow');
    const confirmedRequest = requestFor(task.id, repeat, 'sekb-confirmed');
    return Boolean(off && shadow && confirmedRequest)
      && !off.instructions.includes(plan.candidate.context)
      && !shadow.instructions.includes(plan.candidate.context)
      && confirmedRequest.instructions.includes(plan.candidate.context);
  }));
  const runtimeEffectMeasured = measured && actual.length === plan.slots.length
    && actual.every((record) => record.row.runtime.runtimeEffectMeasured === true
      && record.row.execution.measurementBasis === 'live-provider');
  const wiringReasons = [];
  if (!offShadowInputsIdentical) wiringReasons.push('off/shadow subject inputs are not identical');
  if (!confirmedCandidateBound) wiringReasons.push('confirmed arm does not bind the frozen candidate context');
  if (measured && !runtimeEffectMeasured) wiringReasons.push('runtime effect receipts are incomplete');
  const benefitStatus = !measured ? 'insufficient-evidence'
    : confirmed.promotion.status === 'eliminate' || shadow.promotion.status === 'eliminate' ? 'eliminate'
      : missing.length || incomplete.length || totalTokens === null ? 'insufficient-evidence'
        : wiringReasons.length > 0 || shadow.runStatus !== 'pass' ? 'hold' : confirmed.promotion.status;
  return {
    schemaVersion: 'RsiBenefitReport/v1', driven_by: 'agent', actor, planDigest: benefitDigest(plan),
    evidenceKind: plan.evidenceKind, status: measured ? benefitStatus : 'synthetic-wiring-only',
    coverage: { planned: plan.slots.length, recorded: records.size - missing.length, missing, incomplete },
    comparisons: { confirmedVsOff: confirmed, shadowVsOff: shadow }, splitEffects,
    wiring: { offShadowInputsIdentical, confirmedCandidateBound, runtimeEffectMeasured },
    benefit: { status: benefitStatus, numericalStatus: confirmed.promotion.status,
      reasons: measured ? ['Benefit is scoped to the frozen task cohort; this is not product promotion or evidence of a complete RSI system.',
        ...wiringReasons, ...confirmed.promotion.reasons] : ['Offline controls do not execute the historical tasks or measure model quality.',
        'A live executor, independent final-state oracle and runtime effect receipts are required.'] },
    cost: { measurementBasis: measured ? 'live-provider' : 'synthetic-control', providerCalls, totalTokens,
      actualCostUsd: measured && actual.length > 0 && actual.every((record) => record.row.execution.costUsd !== null) ? actual.reduce((n, record) => n + record.row.execution.costUsd, 0) : null,
      missingUsageTrials: [...records.values()].filter((record) => record && record.tokens === null).length },
    claims: { benefit: measured && benefitStatus === 'promote', promotionReady: false, liveProvider: measured && providerCalls > 0, realHuman: false, productLocksChanged: false },
  };
}

function packFiles(directory) {
  const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name), rel = relative(directory, full).replaceAll('\\', '/');
    artifactPath(directory, rel);
    return entry.isDirectory() ? walk(full) : [rel];
  });
  return walk(directory).filter((path) => path !== 'SHA256SUMS').sort();
}
function allowedFiles(plan) {
  return new Set(['plan.json', 'plan.sha256', 'report.json', ...plan.slots.flatMap((slot) => [recordPath(slot), startPath(slot)]),
    ...(plan.collector ? ['task-bindings.json'] : []),
    ...(plan.evidenceKind === 'live-provider' ? ['provider-preflight.json', 'calibration/admission-report.json',
      ...plan.tasks.map((task) => `calibration/${task.id}/admission.json`)] : [])]);
}
export function sealBenefitRun(root, directory, actor) {
  directory = resolve(directory);
  const report = summarizeBenefitRun(root, directory, actor);
  write(join(directory, 'report.json'), report);
  const allowed = allowedFiles(loadPlan(root, directory)), files = packFiles(directory);
  assert(files.every((path) => allowed.has(path)), 'undeclared-pack-file');
  writeFileSync(join(directory, 'SHA256SUMS'), files.map((path) => `${fileDigest(join(directory, path))}  ${path}`).join('\n') + '\n');
  return report;
}
export function checkBenefitRun(root, directory) {
  const errors = [];
  let report;
  try {
    directory = resolve(directory);
    const saved = read(artifactPath(directory, 'report.json'));
    report = summarizeBenefitRun(root, directory, saved.actor);
    assert.deepEqual(saved, report, 'report-recomputation');
    const plan = loadPlan(root, directory), allowed = allowedFiles(plan), files = packFiles(directory);
    if (plan.evidenceKind === 'live-provider') {
      verifyTaskAdmissions(root, directory, plan, new Set(plan.tasks.map((task) => task.id)));
      verifyLiveAdmissionReport(root, directory, plan);
      assert.equal(git(root, ['status', '--porcelain', '--', ...Object.keys(plan.source.bindings)]), '', 'measured-evaluator-uncommitted');
      for (const [path, digest] of Object.entries(plan.source.bindings)) {
        const committed = execFileSync('git', ['show', `${plan.source.commit}:${path}`], { cwd: root, windowsHide: true, encoding: 'utf8' });
        assert.equal(benefitDigest(committed.replace(/\r\n?/gu, '\n')), digest, 'measured-source-not-in-candidate');
      }
    }
    assert(files.every((path) => allowed.has(path)), 'undeclared-pack-file');
    const sums = files.map((path) => `${fileDigest(join(directory, path))}  ${path}`).join('\n') + '\n';
    assert.equal(readFileSync(artifactPath(directory, 'SHA256SUMS'), 'utf8'), sums, 'pack-digest-drift');
    assert.equal(report.coverage.missing.length, 0, 'unexecuted-slots');
    assert.equal(report.coverage.incomplete.length, 0, 'incomplete-slots');
  } catch (caught) { errors.push(caught.message); }
  return { passed: errors.length === 0, errors, evidenceKind: report?.evidenceKind ?? 'invalid',
    reportStatus: report?.status ?? 'invalid', benefitStatus: report?.benefit.status ?? 'insufficient-evidence',
    coverage: report?.coverage ?? null, claims: errors.length ? { benefit: false, promotionReady: false, liveProvider: false, realHuman: false }
      : report.claims };
}
