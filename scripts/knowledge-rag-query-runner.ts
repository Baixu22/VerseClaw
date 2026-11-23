import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runRagCommand } from './lib/project-rag-process.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const rows = [];
for (const query of bundle.queries) {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), plan.candidate);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
  const measurements: Record<string, unknown> = {};
  for (const arm of ['page', 'full']) {
    for (const input of plan.adapterInputs) assert.equal(sha256(readFileSync(resolve(input.path))), input.digest, 'Query adapter changed');
    const id = `${query.id}-${arm}`, report = join(output, id + '.raw.json');
    const args = plan.argv as string[];
    const result = await runRagCommand(args, { cwd: root, timeoutMs: bundle.policy.profiles[plan.profile].retrieval.deadlineMs,
      log: join(output, id + '.log'), env: { ...process.env, RAG_QUERY: query.question, RAG_QUERY_ID: query.id, RAG_QUERY_ARM: arm,
        RAG_QUERY_PROFILE: plan.profile, RAG_QUERY_REPORT: report, RAG_QUERY_CANDIDATE: plan.candidate,
        RAG_QUERY_POLICY_JSON: arm === 'full' ? JSON.stringify(candidatePolicy) : '',
        TEMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TEMP, TMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TMP } });
    writeFileSync(join(output, id + '.command.json'), jsonBytes({ actor: 'codex/project-rag-query', driven_by: 'agent',
      candidate: plan.candidate, queryId: query.id, arm, ...result }), { flag: 'wx' });
    assert.equal(result.timedOut, false, 'Original query deadline expired; evidence was preserved');
    assert.equal(result.exitCode, 0, 'Original query attempt failed; evidence was preserved');
    const observation = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(observation.candidate, plan.candidate); assert.equal(observation.queryId, query.id); assert.equal(observation.arm, arm);
    assert.equal(observation.profile, plan.profile);
    if (arm === 'full') assert.equal(observation.plan?.policyDigest, retrievalPolicyDigest(candidatePolicy), 'Actual owner policy differs from the frozen candidate');
    measurements[arm] = { ...gradeRagQuery(bundle, query.id, observation), rawDigest: sha256(readFileSync(report)) };
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), plan.candidate);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
  }
  rows.push({ queryId: query.id, ...measurements });
  writeFileSync(join(output, 'progress.json'), jsonBytes({ expectedQueries: 240, completedQueries: rows.length }));
}
writeFileSync(join(output, 'queries.json'), jsonBytes({ schema: 'ProjectRagQueryExecution/v1', actor: 'codex/project-rag-query',
  driven_by: 'agent', candidate: plan.candidate, corpusDigest: bundle.freezeDigest, profile: plan.profile, queries: rows }), { flag: 'wx' });

}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
