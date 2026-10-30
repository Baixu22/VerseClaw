import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { parseArgs } from 'node:util';
import { loadLoopFiles, validateLoopContract, LOOP_NEGATIVE_CONTROLS } from './agent-first-evaluation-loop.mjs';
import { sha256 } from './agent-first-task-corpus.mjs';
import { isMainEntrypoint } from './entrypoint.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const closedPort = (port) => new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => { socket.destroy(); resolve(true); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});

export async function executeLoopControl(job, directory) {
  const control = LOOP_NEGATIVE_CONTROLS.find((entry) => entry.id === job.task.executor.controlId);
  assert(control, 'registered control required');
  const draft = structuredClone(loadLoopFiles(job.sourceRoot));
  control.prepare?.(draft);
  assert.deepEqual(validateLoopContract(draft).violations, [], 'the negative control baseline must be valid');
  control.mutate(draft);
  const violations = validateLoopContract(draft).violations;
  const actual = violations.some((entry) => entry.code === control.expectedCode);
  const trace = [{ kind: 'inspect', effect: 'inspect', authorized: true, trialId: job.trialId, source: 'grader-owned-control', controlId: control.id, expectedCode: control.expectedCode, observedCodes: violations.map((entry) => entry.code) }];
  return { source: 'environment', evidenceKind: 'executed-harness-control', taskId: job.task.id, trialId: job.trialId, conditions: [{ id: job.task.oracle.conditions[0].id, actual }], events: trace, cleanup: { gatewayPortClosed: true, noGatewayStarted: true }, raw: { violations }, isolation: { workspace: join(directory, 'workspace'), noGitMetadata: !existsSync(join(directory, 'workspace', '.git')), historyVisible: false } };
}

export async function executeQaScenario(job, directory) {
  const runtimeRoot = join(job.sourceRoot, 'openclaw_runtime');
  const qa = await import(pathToFileURL(join(runtimeRoot, 'dist/extensions/qa-lab/api.js')));
  const trace = [];
  const outputDir = join(runtimeRoot, '.artifacts', 'agent-first-trials', job.runId, job.trialId);
  const result = await qa.runQaSuite({
    repoRoot: runtimeRoot, outputDir, providerMode: 'mock-openai', scenarioIds: [job.task.executor.scenarioId],
    concurrency: 1, controlUiEnabled: false, startLab: qa.startQaLabServer,
    primaryModel: 'mock-openai/gpt-5.5', alternateModel: 'mock-openai/gpt-5.5', fastMode: false,
    gatewayConfigPatch: { tools: { fs: { workspaceOnly: true } } },
    onFlowEvent: (event) => {
      const effect = event.kind === 'assert' ? 'inspect' : event.call.startsWith('fs.write') ? 'write' : event.call.startsWith('fs.') || event.call.startsWith('read') ? 'read' : 'inspect';
      trace.push({ ...event, effect, authorized: job.task.permissions.effects.includes(effect), trialId: job.trialId, source: 'qa-flow-owner' });
    },
  });
  const summary = read(result.summaryPath);
  assert.deepEqual(summary.run.scenarioIds, [job.task.executor.scenarioId]);
  assert.equal(summary.counts.total, 1);
  const scenario = summary.scenarios[0];
  let proof = null;
  try { proof = JSON.parse(scenario.steps.at(-1)?.details ?? 'null'); } catch { /* failed flow has no final proof */ }
  const observed = trace.filter((entry) => entry.kind === 'assert');
  const conditions = job.task.oracle.conditions.map((condition, index) => ({
    id: condition.id,
    actual: observed[index]?.expression === condition.expression ? observed[index].actual : null,
  }));
  const qaCopy = join(directory, 'qa');
  cpSync(outputDir, qaCopy, { recursive: true });
  let port = null;
  let historyVisible = null;
  if (proof?.tempRoot) {
    const rel = relative(join(directory, 'temp'), proof.tempRoot);
    assert(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'), 'QA profile escaped the trial temporary root');
    const cfg = read(join(proof.tempRoot, 'openclaw.json'));
    port = cfg.gateway.port;
    try { execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: proof.workspaceDir, stdio: 'ignore', windowsHide: true }); historyVisible = true; }
    catch { historyVisible = false; }
    if (proof.workspaceDir) {
      for (const suffix of ['.proof.json', '.events.json']) {
        const name = job.task.executor.scenarioId + suffix;
        cpSync(join(proof.workspaceDir, name), join(directory, name));
      }
    }
  }
  return { source: 'gateway', evidenceKind: 'scripted-provider-real-runtime', taskId: job.task.id, trialId: job.trialId, conditions, events: trace,
    cleanup: { gatewayPort: port, gatewayPortClosed: port ? await closedPort(port) : false },
    isolation: { workspace: proof?.workspaceDir ?? null, tempRoot: proof?.tempRoot ?? null, noGitMetadata: proof?.workspaceDir ? !existsSync(join(proof.workspaceDir, '.git')) : null, historyVisible },
    raw: { summary, proof, observedAssertions: observed, workspaceOnly: true, flowStatus: scenario.status, unexpectedStep: scenario.steps.some((step) => step.status !== 'pass') },
    metrics: { flowOperations: trace.filter((entry) => entry.kind === 'call' && entry.phase === 'complete').length } };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { job: { type: 'string' }, 'trial-dir': { type: 'string' } } });
  const job = read(values.job);
  const directory = values['trial-dir'];
  mkdirSync(directory, { recursive: true });
  const empty = readdirSync(join(directory, 'workspace')).length === 0;
  const startedAt = new Date().toISOString();
  let observation, error = null;
  try {
    assert(empty, 'the trial workspace must start empty');
    if (sha256(readFileSync(join(job.sourceRoot, job.task.source.path))) !== job.task.source.sha256) {
      throw Object.assign(new Error('Frozen task source changed before execution'), { failureClass: 'task' });
    }
    const adapter = await import(pathToFileURL(join(job.sourceRoot, job.adapter.entrypoint)));
    assert.equal(typeof adapter[job.adapter.export], 'function', 'registered execution adapter required');
    observation = await adapter[job.adapter.export](job, directory);
  } catch (caught) {
    error = { message: String(caught?.message ?? caught), code: caught?.code ?? null, failureClass: caught?.failureClass ?? 'infrastructure' };
    observation = { source: 'environment', taskId: job.task.id, trialId: job.trialId, conditions: [], events: [], cleanup: { gatewayPortClosed: false } };
  }
  write(join(directory, 'final-state.json'), observation);
  writeFileSync(join(directory, 'trace.jsonl'), (observation.events ?? []).map((event) => JSON.stringify({ driven_by: 'agent', actor: 'agent-first-trial-worker', ...event })).join('\n') + '\n');
  write(join(directory, 'worker.json'), { schemaVersion: 'AgentFirstTrialWorker/v1', driven_by: 'agent', actor: 'agent-first-trial-worker', taskId: job.task.id, trialId: job.trialId,
    startedAt, completedAt: new Date().toISOString(), error, isolation: { emptyWorkspaceAtStart: empty, gitHistoryAtStart: false, home: process.env.HOME, temp: process.env.TEMP, workspace: join(directory, 'workspace') }, usage: process.resourceUsage() });
  if (error) process.exitCode = 1;
}
