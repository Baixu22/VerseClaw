import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runRagCommand } from './lib/project-rag-process.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { bindRagExperiment, gradeRagTaskArtifact, jsonBytes, loadFrozenRagCorpus, materializeRagTask, sha256 } from './lib/project-rag-corpus.mjs';
import { normalizeRetrievalPolicy, retrievalPolicyDigest } from '../openclaw_runtime/src/knowledge/retrieval/policy';

type AdapterResult = {
  candidate: string; sessionId: string; arm: string; experimentBindingDigest: string;
  actualBudget: { totalTokens: number; modelCalls: number; elapsedMs: number };
  costs: Record<string, number | null>; unknownReserveUsd: number; usageUnknown: boolean;
  safetyViolation: boolean; memoryWriteback: false; backgroundRetrieval: boolean;
  retrievalPolicyDigest?: string;
};

/** One pinned adapter runs the actual product task; the independent oracle stays outside its workspace. */
async function main() {
  const [planFile, outputDirectory] = process.argv.slice(2);
  assert(planFile && outputDirectory, 'Usage: knowledge-rag-task-runner <plan.json> <new-output-directory>');
  const plan = JSON.parse(await readFile(resolve(planFile), 'utf8'));
  assert(plan.schema === 'ProjectRagTaskExecutionPlan/v1' && Array.isArray(plan.adapterArgv)
    && plan.adapterArgv.length > 0 && plan.adapterArgv.every((arg: unknown) => typeof arg === 'string')
    && isAbsolute(plan.adapterArgv[0]), 'A pinned executable argv adapter is required');
  const source = resolve(plan.sourceRoot);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  assert(git('status', '--porcelain') === '' && git('rev-parse', 'HEAD') === plan.experiment.cleanCandidate, 'Clean candidate is required');
  assert(Array.isArray(plan.adapterInputs) && plan.adapterInputs.length > 0, 'Adapter files must be pinned');
  const verifyAdapter = async () => {
    for (const input of plan.adapterInputs) assert.equal(sha256(await readFile(resolve(input.path))), input.digest, 'Adapter input changed');
    assert.equal(git('rev-parse', 'HEAD'), plan.experiment.cleanCandidate);
    assert.equal(git('status', '--porcelain'), '');
  };
  await verifyAdapter();
  const bundle = loadFrozenRagCorpus(resolve(plan.corpusRoot), plan.experiment.corpusDigest);
  const policies = Object.fromEntries(['local', 'quality', 'research'].map(profile => {
    const policy = normalizeRetrievalPolicy(plan.candidatePolicies?.[profile]);
    assert.equal(policy.profile, profile, 'Frozen task policy profile drift');
    return [profile, policy];
  }));
  const policyDigests = Object.fromEntries(Object.entries(policies).map(([profile, policy]) => [profile, retrievalPolicyDigest(policy)]));
  assert.deepEqual(plan.experiment.arms.find((arm: { arm: string }) => arm.arm === 'full')?.policyDigests, policyDigests,
    'Experiment must freeze every full-arm candidate policy');
  const experiment = bindRagExperiment(bundle, plan.experiment);
  const output = resolve(outputDirectory); assert(!existsSync(output), 'Never overwrite an execution attempt');
  const participants = resolve(plan.participantRoot);
  const contains = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)); };
  assert(!contains(output, participants) && !contains(participants, output)
    && !contains(source, participants) && !contains(participants, source)
    && !contains(resolve(plan.corpusRoot), participants) && !contains(participants, resolve(plan.corpusRoot)), 'Participant and oracle/evidence roots must be disjoint');
  assert(!existsSync(participants), 'Each cohort requires a new participant root');
  await mkdir(join(output, 'attempts'), { recursive: true });
  await mkdir(participants, { recursive: true });
  await writeFile(join(output, 'experiment.json'), jsonBytes(experiment), { flag: 'wx' });
  await writeFile(join(output, 'plan.json'), jsonBytes(plan), { flag: 'wx' });
  if (plan.safetyPath) {
    const safety = await readFile(resolve(plan.safetyPath));
    assert.equal(sha256(safety), plan.safetyDigest, 'Frozen safety evidence changed');
    await writeFile(join(output, 'safety.json'), safety, { flag: 'wx' });
  }
  const sessions = new Set<string>(), attempts = [], attemptDigests: Record<string, string> = {};
  for (const slot of bundle.plan.slots) {
    await verifyAdapter();
    const id = sha256(slot.id).slice(7), workspace = join(participants, id);
    const materialized = materializeRagTask(bundle, slot.taskId, workspace, join(output, 'materialization', id),
      vault => `memory-wiki:${sha256((process.platform === 'win32' ? resolve(vault).toLowerCase() : resolve(vault)).replaceAll('\\', '/')).slice(7)}`,
      { heldOutRelease: plan.heldOutRelease });
    const envelope = bundle.policy.profiles[slot.profile].taskEnvelope;
    assert.equal(slot.envelopeDigest, sha256(jsonBytes(envelope)), 'Frozen per-slot budget drift');
    const adapterFile = join(output, 'attempts', `${id}.adapter.json`), startedAt = new Date().toISOString();
    const started = performance.now();
    let exitCode: number | null = null, timedOut = false, failureClass: string | undefined;
    try {
      const result = await runRagCommand(plan.adapterArgv, { cwd: workspace, timeoutMs: envelope.deadlineMs,
        log: join(output, 'attempts', `${id}.log`), env: { ...process.env, TEMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TEMP,
        TMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TMP,
        RAG_TASK_REQUEST: join(workspace, 'request.json'), RAG_TASK_WORKSPACE: workspace,
        RAG_TASK_ARM: slot.arm, RAG_TASK_PROFILE: slot.profile, RAG_TASK_REPORT: adapterFile,
        RAG_TASK_CANDIDATE: plan.experiment.cleanCandidate, RAG_EXPERIMENT_DIGEST: experiment.digest,
        RAG_TASK_BUDGET: JSON.stringify(envelope), RAG_TASK_SESSION_NONCE: randomUUID(),
        RAG_TASK_POLICY_JSON: slot.arm === 'full' ? JSON.stringify(policies[slot.profile]) : '' } });
      exitCode = result.exitCode; timedOut = result.timedOut;
    } catch { failureClass = 'adapter-start-failure'; }
    const elapsedMs = Math.round(performance.now() - started);
    let adapter: AdapterResult | undefined;
    try {
      adapter = JSON.parse(await readFile(adapterFile, 'utf8')) as AdapterResult;
      assert(adapter.candidate === plan.experiment.cleanCandidate && adapter.arm === slot.arm
        && adapter.experimentBindingDigest === experiment.digest && adapter.sessionId && !sessions.has(adapter.sessionId), 'Adapter identity drift');
      sessions.add(adapter.sessionId);
      assert(adapter.memoryWriteback === false && (slot.arm !== 'off' || adapter.backgroundRetrieval === false), 'Treatment authority drift');
      if (slot.arm === 'full') assert.equal(adapter.retrievalPolicyDigest, policyDigests[slot.profile], 'Actual task policy differs from the frozen candidate');
      assert(typeof adapter.safetyViolation === 'boolean', 'Actual safety observation required');
      assert(Number.isFinite(adapter.unknownReserveUsd) && adapter.unknownReserveUsd >= 0, 'Unknown-cost reserve missing');
      assert(['totalTokens', 'modelCalls', 'elapsedMs'].every(key => Number.isSafeInteger(adapter!.actualBudget?.[key as keyof AdapterResult['actualBudget']])
        && adapter!.actualBudget[key as keyof AdapterResult['actualBudget']] >= 0), 'Actual usage counters missing');
      if (adapter.actualBudget.totalTokens > envelope.maxTotalTokens || adapter.actualBudget.modelCalls > envelope.maxModelCalls
        || elapsedMs > envelope.deadlineMs) failureClass = 'budget-exceeded';
    } catch { failureClass ??= 'adapter-evidence-invalid'; }
    let grade: ReturnType<typeof gradeRagTaskArtifact>;
    try { grade = gradeRagTaskArtifact(bundle, slot.taskId, workspace, materialized.receiptPath); }
    catch (error) {
      failureClass ??= 'oracle-integrity';
      grade = { schema: 'ProjectRagTaskGrade/v1', actor: 'independent-repository-oracle', driven_by: 'agent',
        taskId: slot.taskId, corpusDigest: bundle.freezeDigest, query_result_match: null, passed: false, artifactDigest: null,
        issues: [{ kind: 'oracle-integrity', reason: error instanceof Error ? error.message : String(error) }], gradingMode: 'rejected-before-grading' };
    }
    if (timedOut) failureClass = 'timeout';
    else if (exitCode !== 0) failureClass ??= 'adapter-failed';
    else if (!grade.passed) failureClass ??= 'agent';
    const costs = adapter?.costs ?? { embedding: null, rerank: null, planning: null, generation: null, tools: null };
    const measured = ['embedding', 'rerank', 'planning', 'generation', 'tools'].every(stage => Number.isFinite(costs[stage]) && Number(costs[stage]) >= 0);
    if (!measured || adapter?.usageUnknown !== false) failureClass ??= 'usage-unavailable';
    if (measured && Object.values(costs).reduce<number>((sum, value) => sum + Number(value), 0)
      + (adapter?.unknownReserveUsd ?? envelope.unknownReserveUsd) > envelope.maximumTotalUsd) failureClass = 'budget-exceeded';
    const attempt = { schema: 'ProjectRagAttemptReceipt/v1', actor: 'codex/project-rag-task-runner', driven_by: 'agent',
      slotId: slot.id, corpusDigest: bundle.freezeDigest, experimentBindingDigest: experiment.digest,
      outcome: failureClass ? timedOut ? 'timeout' : 'fail' : 'pass', ...(failureClass ? { failureClass } : {}),
      grade, gradeDigest: sha256(jsonBytes(grade)), costs, usageUnknown: !measured || adapter?.usageUnknown !== false,
      unknownReserveUsd: adapter?.unknownReserveUsd ?? envelope.unknownReserveUsd,
      actualBudget: { totalTokens: adapter?.actualBudget?.totalTokens ?? null, modelCalls: adapter?.actualBudget?.modelCalls ?? null, elapsedMs },
      safetyViolation: adapter?.safetyViolation ?? null, startedAt, completedAt: new Date().toISOString(),
      capture: { status: grade.artifactDigest === null ? 'missing' : grade.passed ? 'delivered' : 'invalid',
        rawDigest: grade.artifactDigest ?? sha256('missing-artifact'), workspace,
        policyDigest: slot.arm === 'full' ? adapter?.retrievalPolicyDigest ?? null : null,
        materializationReceipt: materialized.receiptPath, outputPath: materialized.receipt.outputPath },
      adapterReportDigest: existsSync(adapterFile) ? sha256(readFileSync(adapterFile)) : null, exitCode };
    const bytes = jsonBytes(attempt); await writeFile(join(output, 'attempts', `${id}.json`), bytes, { flag: 'wx' });
    attemptDigests[slot.id] = sha256(bytes); attempts.push(attempt);
    await writeFile(join(output, 'progress.json'), jsonBytes({ candidate: plan.experiment.cleanCandidate,
      executedSlots: attempts.length, expectedSlots: bundle.plan.slots.length, lastOutcome: attempt.outcome }));
    // Infrastructure/usage gaps stop the cohort and retain every completed original slot.
    if (failureClass && failureClass !== 'agent') break;
  }
  await writeFile(join(output, 'task-executions.json'), jsonBytes({ schema: 'ProjectRagTaskExecutions/v1',
    actor: 'codex/project-rag-task-runner', driven_by: 'agent', candidate: plan.experiment.cleanCandidate,
    runs: attempts, experimentDigest: experiment.digest, attemptDigests, safetyDigest: plan.safetyDigest ?? null,
    evidenceDirectory: '.', complete: attempts.length === 540 }), { flag: 'wx' });
  if (attempts.length !== 540) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
