#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { KnowledgeStore } from '../openclaw_runtime/src/knowledge/sekb/knowledge-store.js';
import { TrajectoryCapture } from '../openclaw_runtime/src/knowledge/sekb/trajectory-capture.js';
import { DistillationTool } from '../openclaw_runtime/src/knowledge/sekb/distillation-tool.js';
import { RetrievalEngine } from '../openclaw_runtime/src/knowledge/sekb/retrieval-engine.js';
import { closeOpenClawStateDatabaseForTest } from '../openclaw_runtime/src/state/openclaw-state-db.js';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
assert(values.output, '--output required');
const output = resolve(values.output);
assert(output.toLowerCase().startsWith('d:\\tmp\\') || output.startsWith('D:/tmp/'), 'scratch-must-be-under-D-tmp');
assert(!existsSync(output), 'candidate-output-already-exists');
mkdirSync(output, { recursive: true });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sessionId = 'rsi-independent-training-20261106';
const cases = [
  { id: 'rsi-training-json-roundtrip-v1', intent: 'Serialize an object without losing null, false, zero or empty strings',
    initial: "const serialize=x=>Object.fromEntries(Object.entries(x).filter(([,v])=>v));",
    repaired: 'const serialize=x=>JSON.parse(JSON.stringify(x));',
    oracle: "assert.deepEqual(serialize({zero:0,no:false,empty:'',nothing:null,nested:{a:[1]}}),{zero:0,no:false,empty:'',nothing:null,nested:{a:[1]}});" },
  { id: 'rsi-training-array-copy-v1', intent: 'Sort a numeric array without mutating the caller input and preserve duplicates',
    initial: 'const sorted=x=>x.sort((a,b)=>a-b);',
    repaired: 'const sorted=x=>x.toSorted((a,b)=>a-b);',
    oracle: 'const input=[9,1,1]; assert.deepEqual(sorted(input),[1,1,9]); assert.deepEqual(input,[9,1,1]); assert.deepEqual(sorted([]),[]);' },
];
const corpus = JSON.parse(readFileSync(new URL('../harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json', import.meta.url), 'utf8'));
assert(cases.every(item => !corpus.tasks.some((task: {id:string}) => task.id === item.id)), 'training-evaluation-overlap');
const store = new KnowledgeStore({ database: { path: join(output, 'state.sqlite') } });
try {
  const capture = new TrajectoryCapture({ store });
  const records = cases.map(item => {
    const id = capture.start_trajectory(item.intent, 'coding/implementation', ['javascript', 'contracts'], {
      runtimeLineage: { schema: 'runtime-lineage.v1', sessionId, loopRunId: item.id, traceId: `trace-${item.id}` },
      driven_by: 'agent', actor: 'codex/rsi-independent-training', evidenceKind: 'agent-authored-training-fixture',
    });
    const results = (['initial', 'repaired'] as const).map(stage => {
      const source = "import assert from 'node:assert/strict';\n" + item[stage] + '\n' + item.oracle;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        cwd: output, windowsHide: true, encoding: 'utf8', timeout: 10000,
      });
      const observation = { stage, source, sourceDigest: digest(source), exitCode: result.status,
        stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null };
      capture.log_step(id, 'tool.result', { tool: 'node', stage, sourceDigest: observation.sourceDigest }, observation);
      assert.equal(result.status, stage === 'initial' ? 1 : 0, 'training-observation-mismatch');
      return observation;
    });
    capture.finish_trajectory(id, 'success');
    return { ...item, trajectoryId: id, results };
  });
  const distiller = new DistillationTool({ store });
  const suggestions = distiller.suggest_principles_from_trajectories(records.map(item => item.trajectoryId), 2);
  assert.equal(suggestions.length, 1);
  assert.equal(store.query_principles({ status: 'active' }).length, 0, 'premature-principle-write');
  const principleId = distiller.confirm_and_save(suggestions[0], {
    title: 'Preserve the caller contract when implementing a small change',
    condition: 'When implementing an API from a behavior contract and existing callers',
    action: 'Keep names, return shapes and caller-owned inputs stable. Preserve meaningful zero, false, empty and null values. Prefer standard-library operations with the required semantics. Check both ordinary and edge inputs before returning complete source files.',
    reason: 'Independent JSON roundtrip and array sorting exercises failed when values were filtered or caller inputs were mutated; standard-library repairs passed the same assertions.',
    task_types: ['coding/implementation'], context_tags: ['javascript', 'contracts'], pinned: true,
  }, { sessionId, requireSession: true, drivenBy: 'agent', actor: 'codex/rsi-independent-training', sourceSystem: 'sekb', integrityClaim: 'confirmed' });
  const engine = new RetrievalEngine({ store });
  const hits = engine.retrieve_for_task('implement an API preserving caller contracts', 'coding/implementation', ['javascript', 'contracts']);
  assert(hits.some(item => item.principle_id === principleId), 'candidate-not-recalled');
  const context = engine.format_for_injection(hits);
  const candidate = { id: principleId, kind: 'confirmed-sekb', sourceCaseIds: cases.map(item => item.id), context };
  write('candidate.json', candidate);
  write('provenance.json', { schemaVersion: 'RsiIndependentCandidate/v1', driven_by: 'agent', actor: 'codex/rsi-independent-training',
    createdAt: new Date().toISOString(), evidenceKind: 'agent-authored-training-fixture', realHumanEvidence: false,
    boundary: 'Two independently authored exercises executed by Node; no provider training or evaluation-task outcomes. Production SEKB capture, distillation, explicit agent confirmation, persistence and recall used in an isolated database.',
    candidateDigest: digest(JSON.stringify(candidate)), records, suggestion: suggestions[0], principle: store.get_principle(principleId),
    checks: { trainingCases: 2, expectedInitialFailures: 2, repairedPasses: 2, evaluationOverlap: 0, explicitAgentConfirmation: true } });
  console.log(JSON.stringify({ passed: true, candidateId: principleId, sourceCaseIds: candidate.sourceCaseIds, contextChars: context.length }));
} finally { closeOpenClawStateDatabaseForTest(); }
