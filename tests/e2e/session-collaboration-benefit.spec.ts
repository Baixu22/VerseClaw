import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm, type LlmRequestLog } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility, establishCollaborationScope } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import { projectTaskTraceCosts, projectTaskTracePhases, type TaskMaterialObservation, type TaskTraceCostRecord } from '../../shared/task-system/trace';
import type { AutonomySessionScope, ScopedRunId } from '../../shared/types/identity-scope';
import { normalizeAutonomySessionScope, normalizeRunScope } from '../../shared/types/identity-scope';
import type { SessionCollaborationMessageReceipt } from '../../shared/types/session-collaboration-message';
import type { SessionCollaborationMaterialSummary } from '../../shared/types/session-collaboration-material';
import type { SessionCollaborationWatchResult } from '../../shared/types/session-collaboration-watch';

const fixtureDir = resolve('harness/specs/fixtures/session-collaboration-center/D4');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Lane = 'baseline' | 'collaboration';
type Terminal = { runId: string; status: string; startedAt?: number; endedAt?: number; text?: string; error?: string };
type Arm = {
  state: 'planned' | 'terminal' | 'unknown';
  error?: string;
  target?: AutonomySessionScope;
  taskNodeId?: string;
  run?: ScopedRunId;
  dispatchedAt?: number;
  elapsedMs?: number;
  receipt?: SessionCollaborationMessageReceipt | null;
  terminal?: Terminal;
  notice?: { receivedAt: number; owner: SessionCollaborationWatchResult };
  requests: Array<LlmRequestLog & { userText?: string; userTextSha256?: string }>;
  dispatchedTask?: string;
  sourceSha256?: string;
  calls: TaskTraceCostRecord[] | null;
  materialUse?: TaskMaterialObservation[];
  taskQueueMs?: number | null;
  rss: Array<{ at: number; bytes: number | null }>;
};

const arm = (): Arm => ({ state: 'planned', requests: [], calls: null, rss: [] });
test('collects paired owner observations for direct reading and shared material reuse', async ({ launchElectronApp }, info) => {
  test.setTimeout(600_000);
  const rawFixture = await readFile(join(fixtureDir, 'benchmark.json'));
  const fixture = JSON.parse(rawFixture.toString()) as {
    pairCount: number;
    input: { path: string; contents: string; task: string; result: string };
    provider: { kind: string; model: string };
    resources: { lanesInFlight: number; workers: number; retries: number; mainRssIntervalMs: number };
  };
  const pairs = Array.from({ length: fixture.pairCount }, (_, index) => ({
    id: index + 1, order: (index % 2 ? ['collaboration', 'baseline'] : ['baseline', 'collaboration']) as Lane[],
    baseline: arm(), collaboration: arm(),
  }));
  const evidence = {
    schemaVersion: 'SessionCollaborationBenefitSamples/v1',
    driven_by: 'agent', actor: 'session-collaboration-benefit',
    sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    scriptSha256: digest(await readFile(info.file)), fixtureSha256: digest(rawFixture),
    inputSha256: digest(fixture.input.contents), fixture, pairs,
    workspace: null as { id: string; root: string; publisher: AutonomySessionScope } | null,
    materialDigest: null as string | null,
    firstFailure: null as string | null,
  };
  const rawPath = info.outputPath('benefit-raw-pairs.json');
  const summaryPath = info.outputPath('benefit-summary.json');
  const save = async () => {
    await mkdir(dirname(rawPath), { recursive: true });
    await writeFile(rawPath, JSON.stringify(evidence, null, 2));
  };
  const summarize = async () => {
    const summary = execFileSync(process.execPath, [join(fixtureDir, 'summarize.mjs'), rawPath], { encoding: 'utf8' });
    await writeFile(summaryPath, summary);
    return JSON.parse(summary) as { quality: { comparablePairs: number; correctBaseline: number; correctCollaboration: number } };
  };
  let lane: Lane | null = null;
  const requestInputs = new Map<number, { userText: string; userTextSha256: string }>();
  const codeFrom = (text: string) => /verification-code:\s*([A-Z]+-\d+)/.exec(text)?.[1];
  const provider = await startScriptedLlm((text, tools, index) => {
    requestInputs.set(index, { userText: text, userTextSha256: digest(text) });
    if (!lane || !text.includes(fixture.input.task)) return { text: 'Agent-driven fixture session ready.' };
    if (lane === 'baseline') {
      if (!tools['d4-direct-read']) return { toolCall: { id: 'd4-direct-read', name: 'read', args: { path: fixture.input.path } } };
      return { text: codeFrom(tools['d4-direct-read']) ?? 'Source code unavailable' };
    }
    const found = tools['d4-search'];
    if (!found) return { toolCall: { id: 'd4-search', name: 'sessions_list', args: { materials: { search: 'Recorded observation' } } } };
    const material = (JSON.parse(found).items as Pick<SessionCollaborationMaterialSummary, 'source' | 'ref'>[])[0];
    if (!material) return { text: 'Shared material unavailable' };
    if (!tools['d4-material']) return { toolCall: { id: 'd4-material', name: 'sessions_list',
      args: { materials: { target: material.source, ref: material.ref } } } };
    return { text: codeFrom(tools['d4-material']) ?? 'Source code unavailable' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await save();
    await configureSessionChainProvider(app, provider.port);
    const publisher = await createCollaborationProject(app, info.outputPath('workspace'), 'Paired measurement');
    evidence.workspace = { id: publisher.workspaceId, root: publisher.rootPath, publisher: publisher.scope };
    await enableCollaborationFixtureVisibility(app);
    await writeFile(join(publisher.rootPath, fixture.input.path), fixture.input.contents);
    const store = new TaskSystemStore(resolveTaskDomain(publisher.rootPath));
    try {
      const source = store.sessionSnapshot(publisher.sessionKey, publisher.generation).task?.claim;
      if (!source) throw new Error('Paired publisher claim unavailable');
      const material = store.publishSharedMaterial(source, { id: 'paired-source-material', kind: 'artifact',
        summary: fixture.input.contents, evidenceRefs: [], sensitivity: 'internal',
        artifactRefs: [{ path: fixture.input.path, sha256: evidence.inputSha256 }],
      }, 'scripted-pair-publication', () => publisher.scope);
      evidence.materialDigest = material.contentDigest;
      for (const pair of pairs) {
        for (const variant of pair.order) {
          const record = pair[variant];
          const key = `d4:${pair.id}:${variant}`;
          let sampler: ReturnType<typeof setInterval> | undefined;
          let pending: Promise<void> | undefined;
          let providerStart = provider.log.length;
          const sample = () => {
            pending ??= app.evaluate(() => process.memoryUsage().rss)
              .then(bytes => { record.rss.push({ at: Date.now(), bytes }); },
                () => { record.rss.push({ at: Date.now(), bytes: null }); })
              .finally(() => { pending = undefined; });
            return pending;
          };
          try {
            const session = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', {
              method: 'sessions.create', params: { agentId: 'main', label: key },
            });
            const owner = { workspaceId: publisher.workspaceId, sessionKey: session.key, generation: session.sessionId, rootPath: publisher.rootPath };
            await hostInvoke(app, 'workspaces', 'saveState', { id: owner.workspaceId, sessionKey: owner.sessionKey, state: {} });
            await establishCollaborationScope(app, owner);
            const target = normalizeAutonomySessionScope({ ...publisher.scope, sessionKey: session.key, sessionGeneration: session.sessionId },
              { ...publisher.scope, sessionKey: session.key, sessionGeneration: session.sessionId } as AutonomySessionScope);
            record.target = target;
            const { task } = store.create({ objective: fixture.input.task, constraints: [], target: fixture.input.path,
              businessKey: 'collaboration-benefit', occurrenceKey: key,
              acceptance: [{ id: 'code', description: 'Return the exact original code', verification: { kind: 'owner-receipt', owner: 'paired-fixture' } }],
            }, key);
            record.taskNodeId = task.contract.taskNodeId;
            store.claim(task.contract.taskNodeId, session.key, session.sessionId, `${key}:claim`);
            const sender = await hostInvoke<{ source: { scope: AutonomySessionScope } }>(app, 'sessions', 'collaborationSender');
            normalizeAutonomySessionScope(sender.source.scope, publisher.scope);

            await sample();
            sampler = setInterval(() => void sample(), fixture.resources.mainRssIntervalMs);
            lane = variant;
            providerStart = provider.log.length;
            const started = performance.now();
            record.dispatchedAt = Date.now();
            record.dispatchedTask = fixture.input.task;
            record.sourceSha256 = digest(await readFile(join(publisher.rootPath, fixture.input.path)));
            if (variant === 'baseline') {
              const accepted = await hostInvoke<{ runId: string }>(app, 'gateway', 'rpc', { method: 'sessions.send', params: {
                key: owner.sessionKey, expectedSessionId: owner.generation, workspaceId: owner.workspaceId, workspaceDir: owner.rootPath,
                message: record.dispatchedTask, idempotencyKey: key,
              } });
              record.run = normalizeRunScope({ scope: target, runId: accepted.runId });
            } else {
              const accepted = await hostInvoke<{ receipt: SessionCollaborationMessageReceipt | null }>(app, 'sessions', 'sendCollaborationMessage', {
                id: key, expectedSource: publisher.scope, target, purpose: 'request', message: record.dispatchedTask,
              });
              record.receipt = accepted.receipt;
              if (!accepted.receipt?.run) throw new Error('Original collaboration run unavailable');
              record.run = accepted.receipt.run;
              normalizeAutonomySessionScope({ ...record.run.scope, sessionGeneration: target.sessionGeneration }, target);
            }
            const run = record.run;
            const watcher = hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', {
              id: `${key}:watch`, condition: 'run-terminal', run, timeoutMs: 25_000,
              query: { requester: publisher.scope, target, limit: 1 },
            }).then(reply => ({ receivedAt: Date.now(), owner: reply.watch }), () => undefined);
            record.terminal = await hostInvoke<Terminal>(app, 'gateway', 'rpc', { method: 'agent.wait',
              params: { runId: run.runId, timeoutMs: 60_000 }, timeoutMs: 65_000 });
            record.elapsedMs = performance.now() - started;
            if (record.terminal.status === 'timeout') throw new Error('Original run terminal is unresolved');
            if (record.terminal.status === 'ok' && (record.terminal.runId !== run.runId || typeof record.terminal.text !== 'string'))
              throw new Error('Original run final reply is unavailable');
            record.state = 'terminal';
            record.notice = await watcher;
            const trace = store.traceSnapshot(task.contract.taskNodeId);
            record.taskQueueMs = projectTaskTracePhases(trace.events).queue.durationMs;
            record.calls = projectTaskTraceCosts(trace).records.filter(call => call.call.runId === run.runId &&
              call.call.credential.sessionKey === session.key && call.call.credential.generation === session.sessionId);
            record.materialUse = trace.events.filter(event => event.kind === 'material_observation')
              .map(event => event.payload as TaskMaterialObservation)
              .filter(observation => observation.run?.runId === run.runId && observation.ref.contentDigest === material.contentDigest);
            if (record.terminal.status !== 'ok') evidence.firstFailure ??= record.terminal.error ?? record.terminal.status;
          } catch (error) {
            record.state = 'unknown';
            record.error = error instanceof Error ? error.message : String(error);
            evidence.firstFailure ??= record.error;
            throw error;
          } finally {
            lane = null;
            if (sampler) clearInterval(sampler);
            await pending;
            if (record.dispatchedAt !== undefined) {
              await sample();
              record.requests = provider.log.slice(providerStart).map((request, index) => ({ ...request, ...requestInputs.get(providerStart + index) }));
            }
            await save();
          }
        }
      }
    } finally { store.close(); }
    const complete = await summarize();
    expect(complete.quality).toEqual({ comparablePairs: fixture.pairCount, correctBaseline: fixture.pairCount, correctCollaboration: fixture.pairCount });
  } catch (error) {
    evidence.firstFailure ??= error instanceof Error ? error.message : String(error);
    await save();
    await summarize().catch(() => undefined);
    throw error;
  } finally {
    try { await save(); }
    finally { await closeElectronApp(app); await provider.close(); }
  }
});
