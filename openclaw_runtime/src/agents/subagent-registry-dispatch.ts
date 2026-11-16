/** Advances the existing registry's prepared requests after owner terminal facts. */
import { countActiveRunsForSessionFromRuns } from './subagent-registry-queries.js';
import type { SubagentRunRecord } from './subagent-registry.types.js';
import { readFrozenWorkerOutput, buildWorkerOutputHandoffArtifact, resolveHandoffArtifactPrompt, type WorkerOutputHandoffArtifact } from './handoff-artifacts.js';

export type QueuedSubagentDispatchResult =
  | { status: 'accepted'; runId: string }
  | { status: 'rejected' | 'unknown'; error: string };

function waveReadiness(entry: SubagentRunRecord, runs: Map<string, SubagentRunRecord>): 'ready' | 'waiting' | 'failed' {
  const meta = entry.orchestration;
  if (!meta?.taskNodeId || !meta.executionWave || !meta.executionWaves || !meta.taskGraph) return 'failed';
  const expected = meta.executionWaves.filter(wave => wave.wave < meta.executionWave!)
    .flatMap(wave => wave.taskNodeIds)
    .filter(id => !meta.taskGraph!.nodes.find(node => node.taskNodeId === id)?.isVerifier);
  for (const id of expected) {
    const predecessors = [...runs.values()].filter(run =>
      run.controllerSessionKey === entry.controllerSessionKey && run.requesterSessionId === entry.requesterSessionId
      && run.orchestration?.orchestrationRunId === meta.orchestrationRunId && run.orchestration.taskNodeId === id);
    if (!predecessors.length || predecessors.some(run => !Number.isFinite(run.endedAt))) return 'waiting';
    if (predecessors.some(run => run.outcome?.status !== 'ok' || run.pauseReason === 'sessions_yield')) return 'failed';
  }
  return 'ready';
}

function bindQueuedHandoff(entry: SubagentRunRecord, runs: Map<string, SubagentRunRecord>): 'ready' | 'waiting' | 'failed' {
  const meta = entry.orchestration;
  if (meta?.handoffArtifactsMode !== 'on') return 'ready';
  const graph = meta.taskGraph;
  const node = graph?.nodes.find(value => value.taskNodeId === meta.taskNodeId);
  if (!graph || !node || !entry.queuedDispatch) return 'failed';
  const incoming = graph.edges.filter(edge => edge.type === 'handoff' && edge.to === node.taskNodeId);
  if (!incoming.length) return 'ready';
  if (meta.handoffArtifacts?.length) return resolveHandoffArtifactPrompt({ node, plan: { taskGraph: graph },
    orchestrationRunId: meta.orchestrationRunId, ownerSessionKey: entry.requesterSessionKey, artifacts: meta.handoffArtifacts }).status === 'ready' ? 'ready' : 'failed';
  const artifacts: WorkerOutputHandoffArtifact[] = [];
  for (const edge of incoming) {
    const predecessor = [...runs.values()].find(run => run.controllerSessionKey === entry.controllerSessionKey
      && run.requesterSessionId === entry.requesterSessionId && run.orchestration?.orchestrationRunId === meta.orchestrationRunId
      && run.orchestration.taskNodeId === edge.from);
    if (!predecessor || !predecessor.orchestration) return 'waiting';
    const identity = { orchestrationRunId: meta.orchestrationRunId, taskGraphId: graph.graphRunId,
      ownerSessionKey: entry.requesterSessionKey, fromTaskId: edge.from, fromRole: predecessor.orchestration.roleName,
      fromRoleInstanceId: predecessor.orchestration.roleInstanceId, toTaskId: node.taskNodeId, toRole: node.roleName,
      attempt: predecessor.orchestration.attempt ?? 1, childRunId: predecessor.runId, childSessionKey: predecessor.childSessionKey };
    const capture = readFrozenWorkerOutput(identity, predecessor);
    if (capture.status === 'unavailable') {
      if (capture.reason === 'run-not-terminal' || capture.reason === 'missing-output' && predecessor.completion?.capturedAt === undefined) return 'waiting';
      return 'failed';
    }
    const artifact = buildWorkerOutputHandoffArtifact({ identity, capture });
    if (artifact.state !== 'ready') return 'failed';
    artifacts.push(artifact);
  }
  const prompt = resolveHandoffArtifactPrompt({ node, plan: { taskGraph: graph }, orchestrationRunId: meta.orchestrationRunId,
    ownerSessionKey: entry.requesterSessionKey, artifacts });
  if (prompt.status !== 'ready') return 'failed';
  meta.handoffArtifacts = artifacts;
  entry.queuedDispatch.params.extraSystemPrompt = [entry.queuedDispatch.params.extraSystemPrompt, prompt.prompt].filter(Boolean).join('\n\n');
  return 'ready';
}

export function createSubagentDispatchQueue(options: {
  runs: Map<string, SubagentRunRecord>;
  persist(): void;
  refresh?(): void;
  claim?(entry: SubagentRunRecord, cap: number, claim: () => void): boolean;
  capacity(entry: SubagentRunRecord): number;
  dispatch(entry: SubagentRunRecord): Promise<QueuedSubagentDispatchResult>;
  accepted(entry: SubagentRunRecord, runId: string): void;
  rejected(entry: SubagentRunRecord, error: string): Promise<void>;
  warn(error: unknown): void;
}) {
  // Transient serialization only. The original registry rows hold every pending
  // request and claim; clearing this helper cannot make an active request free.
  let draining: Promise<void> | undefined;
  let rerun = false;
  const drain = (): Promise<void> => {
    if (draining) { rerun = true; return draining; }
    draining = (async () => {
      do {
        rerun = false;
        options.refresh?.();
        const pending = [...options.runs.values()].filter(entry => entry.queuedDispatch && !entry.dispatchPending && !Number.isFinite(entry.endedAt))
          .sort((a, b) => a.createdAt - b.createdAt || a.runId.localeCompare(b.runId));
        for (const entry of pending) {
          if (options.runs.get(entry.runId) !== entry || !entry.queuedDispatch || entry.dispatchPending || Number.isFinite(entry.endedAt)) continue;
          const readiness = waveReadiness(entry, options.runs);
          if (readiness === 'waiting') continue;
          if (readiness === 'failed') {
            await options.rejected(entry, 'orchestration predecessor failed or was cancelled');
            continue;
          }
          const handoff = bindQueuedHandoff(entry, options.runs);
          if (handoff === 'waiting') continue;
          if (handoff === 'failed') { await options.rejected(entry, 'frozen predecessor handoff unavailable or mismatched'); continue; }
          const controller = entry.controllerSessionKey ?? entry.requesterSessionKey;
          const cap = Math.min(entry.queuedDispatch.maxChildren, options.capacity(entry));
          if (!Number.isSafeInteger(cap) || cap < 1) {
            await options.rejected(entry, 'effective subagent capacity unavailable');
            continue;
          }
          // Publish before the first await. A lost ack or restart preserves this
          // claim; only a terminal owner receipt permits another execution.
          const claim = () => {
            entry.dispatchPending = true;
            entry.execution = { status: 'pending' };
            try { options.persist(); }
            catch (error) {
              delete entry.dispatchPending;
              entry.execution = { status: 'queued' };
              throw error;
            }
          };
          if (options.claim) { if (!options.claim(entry, cap, claim)) continue; }
          else { if (countActiveRunsForSessionFromRuns(options.runs, controller) >= cap) continue; claim(); }
          let result: QueuedSubagentDispatchResult;
          try { result = await options.dispatch(entry); }
          catch (error) { result = { status: 'unknown', error: String(error) }; }
          if (result.status === 'accepted') {
            // Owner cancellation may have completed while the RPC was in flight.
            options.accepted(entry, result.runId);
          } else if (result.status === 'rejected') {
            await options.rejected(entry, result.error);
          } else {
            if (Number.isFinite(entry.endedAt) || options.runs.get(entry.runId) !== entry) continue;
            entry.execution = { ...entry.execution, status: 'interrupted', interruptedAt: Date.now(),
              interruptionReason: 'lost-execution-context' };
            options.persist();
            options.warn(result.error);
          }
        }
      } while (rerun);
    })().finally(() => { draining = undefined; });
    return draining;
  };
  return { drain };
}
