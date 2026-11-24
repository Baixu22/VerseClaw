import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runRagCommand } from './lib/project-rag-process.mjs';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadFrozenRagCorpus, jsonBytes, sha256 } from './lib/project-rag-corpus.mjs';
import { gradeRagQuery } from './lib/project-rag-query-grade.mjs';
import { normalizeRetrievalPolicy, retrievalPolicyDigest } from '../openclaw_runtime/src/knowledge/retrieval/policy';

async function main() {
const [planPath, outputPath] = process.argv.slice(2);
assert(planPath && outputPath, 'Usage: knowledge-rag-query-runner <plan.json> <new-output>');
const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
assert(plan.schema === 'ProjectRagQueryExecutionPlan/v1' && Array.isArray(plan.argv)
  && plan.argv.length > 0 && plan.argv.every((part: unknown) => typeof part === 'string')
  && isAbsolute(plan.argv[0]) && Array.isArray(plan.adapterInputs) && plan.adapterInputs.length > 0);
const root = resolve(plan.sourceRoot), output = resolve(outputPath);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), plan.candidate);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
const bundle = loadFrozenRagCorpus(resolve(plan.corpusRoot), plan.corpusDigest);
assert(['local', 'quality', 'research'].includes(plan.profile), 'Invalid frozen query profile');
const candidatePolicy = normalizeRetrievalPolicy(plan.candidatePolicy);
assert.equal(candidatePolicy.profile, plan.profile, 'Evaluation policy profile drift');
assert(plan.heldOutRelease?.corpusDigest === bundle.freezeDigest, 'Held-out corpus binding mismatch');
if (bundle.queries.some(query => query.split === 'held-out')) assert(plan.heldOutRelease?.cleanCandidate === plan.candidate
  && plan.heldOutRelease.calibrationFrozen === true && /^sha256:[a-f0-9]{64}$/.test(plan.heldOutRelease.calibrationReceiptDigest), 'Held-out release required');
mkdirSync(output, { recursive: false });
writeFileSync(join(output, 'plan.json'), jsonBytes(plan), { flag: 'wx' });
const rows: Array<Record<string, unknown>> = [];
let partialQuery: Record<string, unknown> | null = null;
let attempt: { queryId: string; arm: string | null; stage: string } | null = null;
let failure: ({ queryId: string; arm: string | null; stage: string; reason: string }) | null = null;
const save = (complete = false) => {
  writeFileSync(join(output, 'queries.next.json'), jsonBytes({ schema: 'ProjectRagQueryExecution/v1',
    actor: 'codex/project-rag-query', driven_by: 'agent', candidate: plan.candidate, corpusDigest: bundle.freezeDigest,
    profile: plan.profile, complete, expectedQueries: bundle.queries.length, completedQueries: rows.length,
    queries: rows, partialQuery, failure }));
  renameSync(join(output, 'queries.next.json'), join(output, 'queries.json'));
  writeFileSync(join(output, 'progress.json'), jsonBytes({ expectedQueries: bundle.queries.length, completedQueries: rows.length }));
};
save();
try {
for (const query of bundle.queries) {
  partialQuery = { queryId: query.id };
  attempt = { queryId: query.id, arm: null, stage: 'source' };
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), plan.candidate);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
  for (const arm of ['page', 'full']) {
    attempt = { queryId: query.id, arm, stage: 'adapter' };
    for (const input of plan.adapterInputs) assert.equal(sha256(readFileSync(resolve(input.path))), input.digest, 'Query adapter changed');
    const id = `${query.id}-${arm}`, report = join(output, id + '.raw.json');
    const args = plan.argv as string[];
    attempt.stage = 'command';
    save();
    const started = performance.now();
    let result: Awaited<ReturnType<typeof runRagCommand>>;
    try {
    result = await runRagCommand(args, { cwd: root, timeoutMs: bundle.policy.profiles[plan.profile].retrieval.deadlineMs,
      log: join(output, id + '.log'), env: { ...process.env, RAG_QUERY: query.question, RAG_QUERY_ID: query.id, RAG_QUERY_ARM: arm,
        RAG_QUERY_PROFILE: plan.profile, RAG_QUERY_REPORT: report, RAG_QUERY_CANDIDATE: plan.candidate,
        RAG_QUERY_POLICY_JSON: arm === 'full' ? JSON.stringify(candidatePolicy) : '',
        TEMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TEMP, TMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TMP } });
    } catch (error) {
      writeFileSync(join(output, id + '.command.json'), jsonBytes({ actor: 'codex/project-rag-query', driven_by: 'agent',
        candidate: plan.candidate, queryId: query.id, arm, exitCode: null, timedOut: null,
        durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }), { flag: 'wx' });
      throw error;
    }
    writeFileSync(join(output, id + '.command.json'), jsonBytes({ actor: 'codex/project-rag-query', driven_by: 'agent',
      candidate: plan.candidate, queryId: query.id, arm, ...result }), { flag: 'wx' });
    assert.equal(result.timedOut, false, 'Original query deadline expired; evidence was preserved');
    assert.equal(result.exitCode, 0, 'Original query attempt failed; evidence was preserved');
    attempt.stage = 'observation';
    const raw = readFileSync(report), observation = JSON.parse(raw.toString('utf8'));
    attempt.stage = 'identity';
    assert.equal(observation.candidate, plan.candidate); assert.equal(observation.queryId, query.id); assert.equal(observation.arm, arm);
    assert.equal(observation.profile, plan.profile);
    attempt.stage = 'policy';
    if (arm === 'full') assert.equal(observation.plan?.policyDigest, retrievalPolicyDigest(candidatePolicy), 'Actual owner policy differs from the frozen candidate');
    attempt.stage = 'grading';
    partialQuery[arm] = { ...gradeRagQuery(bundle, query.id, observation), rawDigest: sha256(raw) };
    attempt.stage = 'source';
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), plan.candidate);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
    save();
  }
  rows.push(partialQuery); partialQuery = null;
  save();
}
} catch (error) {
  failure = { queryId: attempt!.queryId, arm: attempt!.arm, stage: attempt!.stage,
    reason: error instanceof Error ? error.message : String(error) };
  throw error;
} finally { save(failure === null && rows.length === bundle.queries.length); }

}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
