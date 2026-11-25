// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { createTaskRuntimeGuard, restoreTaskModelContext, executeTaskGuarded,
  createTaskModelUsageRecorder } from '../../shared/task-system/runtime';
import { readTaskTrace } from '../../shared/task-system/trace';
import { projectCoordinatorScope, assertSystemExecutionAllowed } from '../../shared/task-system/project-coordinator';
import { createTaskLedgerWorkingContextProposal, createTaskLedgerWorkingContextDecision,
  projectTaskLedgerWorkingContext, emptyTaskLedgerWorkingContextSnapshot,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST } from '../../shared/task-ledger-working-context';
import { gradeAutonomyContinuation, sumAutonomyContinuationCosts, CONTINUATION_COST_FIELDS,
  CONTINUATION_COST_PHASES, type ContinuationCostEvent, type ContinuationObservation } from '../../shared/long-session-paired-evaluation';
import { buildDeterministicCompressionArtifact, type CompressionSemanticAtom } from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import { applyContextMessageReplacement } from '../../openclaw_runtime/src/context-engine/context-candidate';
import { buildObservationMaskingProjection } from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction';
import { createContextArchiveHandleForPayloadSync, verifyContextArchiveHandle } from '../../openclaw_runtime/src/context-engine/registry/context-item-registry';
import type { TaskContractInput } from '../../shared/task-system/types';
import type { TaskLedgerEvent } from '../../shared/types/task-ledger';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import type { AgentMessage } from '../../openclaw_runtime/packages/agent-core/src/types';

// Only external owner reads are supplied by the offline environment. The Main
// adapter, projection, recovery, validation and file/SQLite owners remain real.
const owners = vi.hoisted(() => ({ binding: vi.fn(), ledger: vi.fn(), working: vi.fn() }));
vi.mock('../../electron/services/workspaces-api', () => ({ getPersistedCoordinatorBinding: owners.binding }));
vi.mock('../../electron/services/task-ledger-service', () => ({ loadTaskLedgerSnapshot: owners.ledger }));
vi.mock('../../electron/services/task-ledger-working-context', () => ({ readTaskLedgerWorkingContext: owners.working }));
vi.mock('../../electron/utils/store', () => ({ getSetting: async () => true }));
vi.mock('../../electron/utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../../electron/services/resource-tracker', () => ({ getResourceTracker: vi.fn() }));
vi.mock('../../electron/utils/token-usage', () => ({ getSessionTokenUsageSummary: vi.fn() }));
vi.mock('../../electron/services/mock-provider', () => ({ handleMockChatSend: vi.fn() }));
vi.mock('../../electron/services/task-system-service', () => ({ persistentTaskChatContext: vi.fn() }));
vi.mock('../../electron/services/knowledge-read-scope', () => ({ prepareKnowledgeReadScope: vi.fn(), assertKnowledgeReadScopeCurrent: vi.fn() }));

const ROOT = resolve(import.meta.dirname, '../..');
const EVIDENCE = join(ROOT, 'harness/specs/fixtures/autonomy-context-system/baseline/v1');
const ACTOR = 'codex/autonomy-context-tf0955';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fileHash = (path: string) => hash(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
const fixturePath = join(ROOT, 'tests/unit/fixtures/autonomy-context-baseline.v2.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { clock: string; cases: Scenario[]; legacyFixture: { path: string; sha256: string } };
const policy = JSON.parse(readFileSync(join(EVIDENCE, 'frozen-evaluation-policy.json'), 'utf8'));
const results: Array<Record<string, unknown>> = [];
const runRoot = process.env.CLAWX_C01_OUTPUT
  ? resolve(process.env.CLAWX_C01_OUTPUT)
  : mkdtempSync(join(tmpdir(), 'autonomy-context-c01-'));
mkdirSync(runRoot, { recursive: true });
const rawFile = join(runRoot, 'offline-run.json');
if (existsSync(rawFile)) throw new Error('C01_RUN_ALREADY_EXISTS: choose a new output directory');

type Scenario = {
  id: string; family: string; split: string; taskGoal: string;
  owner: { sessionKey: string; generation: string; workspaceId: string };
  rawInput: { old: string; new: string; exact: string; observation: string; decision: string;
    excludedDecision: string; fallbackDecision: string; temporaryTurn: number; temporaryFormat: string;
    experience: { title: string; status: string; stage: string; action: string }; firstFailure: string };
  remainingBudget: { actions: number; readbacks: number; readbackBytes: number };
  oracle: { assertions: ContinuationObservation };
  negativeControl: { field: string; replacement: string };
};
type ExecutableScenario = Omit<Scenario, 'oracle' | 'negativeControl'>;
type Arm = 'current' | 'simple-masking';
type Step = { action: string; outcome: unknown };

function taskContract(s: ExecutableScenario, value = s.rawInput.new): TaskContractInput {
  return { objective: s.taskGoal, target: 'result.txt', constraints: [JSON.stringify({ value })],
    acceptance: [{ id: 'independent', description: 'Owner-verifiable output', verification: {
      kind: 'file-sha256', path: 'result.txt', sha256: hash(value),
    } }] };
}

function readRestored(prompt: string): { core: { revision: number; constraints: string[] }; progress: { nextAction: string; completed: string[] } } {
  const text = prompt.split('\n<PERSISTENT_TASK_CONTRACT>\n')[1]?.split('\n</PERSISTENT_TASK_CONTRACT>')[0];
  if (!text) throw new Error('SCRIPT_MISSING_OWNER_CONTEXT');
  const lines = text.split('\n');
  return { core: JSON.parse(lines[1]), progress: JSON.parse(lines.at(-1)!) };
}

function stateAtom(s: ExecutableScenario, input: Partial<CompressionSemanticAtom>): CompressionSemanticAtom {
  return { id: s.id, type: 'decision', canonicalIdentity: s.id, severity: 'critical', confidence: 1,
    scope: 'session', polarity: 'positive', status: 'verified', text: s.rawInput.decision,
    evidenceRefs: [{ type: 'manual', ref: `fixture:${s.id}` }], ...input };
}

async function preview(s: ExecutableScenario, root: string, artifact: ReturnType<typeof buildDeterministicCompressionArtifact>, native = false) {
  owners.binding.mockResolvedValue({ workspaceId: s.owner.workspaceId, sessionKey: s.owner.sessionKey,
    agentId: 'main', state: 'active', sessionGeneration: s.owner.generation, bindingRevision: 1,
    environment: { canonicalRoot: root }, activeTaskNodeId: s.id, taskLedgerReferences: [] });
  owners.ledger.mockResolvedValue({ schemaVersion: 1, workspaceId: s.owner.workspaceId, nodes: [], edges: [], sessionLinks: [], eventsCount: 0 });
  owners.working.mockResolvedValue(emptyTaskLedgerWorkingContextSnapshot());
  const rpc = vi.fn(async (method: string) => {
    if (method === 'sessions.describe') return { session: { sessionId: s.owner.generation } };
    if (method === 'sessions.compressionArtifact') return { checkpointId: s.id, artifact };
    if (method === 'memory.surface') return { accepted: [], candidates: [], counts: { modelVisible: 0 } };
    if (method === 'session.activitySnapshot') return { snapshot: { policy: { backend: { effective: { value: { ownsNativeCompaction: native } } } } } };
    throw new Error(`C01_NETWORK_CALL_FORBIDDEN:${method}`);
  });
  const { createChatApi } = await import('../../electron/services/chat-api');
  const api = createChatApi({ gatewayManager: { rpc } as never });
  return api.continuityPreview({ workspaceId: s.owner.workspaceId, sessionKey: s.owner.sessionKey,
    activeTaskNodeId: s.id, knowledgeReferences: s.family === 'experience' ? [{ id: `sekb:${s.id}`,
      title: s.rawInput.experience.title, lookup: `sekb:${s.id}`, freshnessLevel: 'stale',
      matchedClaimStatus: s.rawInput.experience.status, corpus: 'memory' }] : [] });
}

/** The executor gets frozen task/environment inputs, never the oracle or expected observations. */
async function continueScenario(s: ExecutableScenario, arm: Arm, repetition: number) {
  if (!policy.offline.defaultSplits.includes(s.split)) throw new Error('C01_FINAL_HOLDOUT_SEALED');
  const root = join(runRoot, `${s.id}-${arm}-${repetition}`);
  mkdirSync(root, { recursive: true });
  const steps: Step[] = [];
  const step = async <T>(action: string, operation: () => T | Promise<T>): Promise<T> => {
    if (steps.length >= s.remainingBudget.actions) throw new Error('C01_ACTION_BUDGET_EXCEEDED');
    try { const value = await operation(); steps.push({ action, outcome: value ?? null }); return value; }
    catch (error) { steps.push({ action, outcome: { error: String(error) } }); throw error; }
  };
  const rejected = async (action: string, operation: () => unknown, code: string) => {
    try { await step(action, operation); return false; }
    catch (error) { if (!String(error).includes(code)) throw error; return true; }
  };
  let store = new TaskSystemStore(resolveTaskDomain(root));
  const task = store.create(taskContract(s, s.family === 'revision' ? s.rawInput.old : s.rawInput.new), 'create').task;
  let claim = store.claim(task.contract.taskNodeId, s.owner.sessionKey, s.owner.generation, 'claim').claim!;
  store.checkpoint(claim, { nextAction: 'verify', completed: [s.rawInput.firstFailure], unresolved: ['independent evidence missing'], artifacts: [] });
  let guard = createTaskRuntimeGuard(root, claim.sessionKey, claim.generation);
  const messages = [{ role: 'user', content: s.taskGoal, timestamp: 1 },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'observation-call', name: 'read', arguments: {} }], timestamp: 2 },
    { role: 'toolResult', toolCallId: 'observation-call', toolName: 'read', content: [{ type: 'text', text: s.rawInput.observation }], timestamp: 3 }] as AgentMessage[];
  const masking = await buildObservationMaskingProjection({ enabled: arm === 'simple-masking', messages,
    sessionId: s.id, archiveRoot: join(root, 'archives'), minChars: 1000, preserveNewestObservationCount: 0 });
  if (masking.maskedCount) steps.push({ action: 'mask-and-verify-observation', outcome: masking.archiveHandles });
  const restored = () => restoreTaskModelContext(guard, 'Continue from the current owner.');
  const write = async (value: string) => step('write-result', () => executeTaskGuarded(guard, 'output', 'write', () => {
    writeFileSync(join(root, 'result.txt'), value); return { written: true };
  }));
  let observed: ContinuationObservation = {};
  let production: unknown;
  try {
    switch (s.family) {
      case 'revision': {
        const oldGuard = guard;
        store.revise(claim.taskNodeId, 1, taskContract(s));
        const staleRejected = await rejected('old-model-call', () => restoreTaskModelContext(oldGuard, 'old projection'), 'TASK_STALE_OWNER');
        claim = store.claim(claim.taskNodeId, claim.sessionKey, claim.generation, 'reclaim').claim!;
        guard = createTaskRuntimeGuard(root, claim.sessionKey, claim.generation);
        production = restored();
        const current = readRestored(String(production));
        await write(JSON.parse(current.core.constraints[0]).value);
        observed = { revision: current.core.revision, output: readFileSync(join(root, 'result.txt'), 'utf8'), staleRejected };
        break;
      }
      case 'negative':
      case 'temporary': {
        const temporary = s.family === 'temporary';
        const atom = stateAtom(s, temporary
          ? { type: 'constraint', text: s.rawInput.temporaryFormat, scope: `turn:${s.rawInput.temporaryTurn}` }
          : { polarity: 'negative' });
        const artifact = buildDeterministicCompressionArtifact({ messages: masking.messages, semanticAtoms: [atom] });
        const result = await preview(s, root, artifact);
        if (!result.pack) throw new Error(`C01_PREVIEW_MISSING:${result.reason}`);
        const item = result.pack.items.find(item => item.kind === (temporary ? 'constraint' : 'decision'));
        // This deliberately simple scripted consumer treats a plain decision as
        // actionable and session constraints as current. Lost fields are visible.
        const record = item as unknown as { polarity?: string; scope?: { kind: string; key?: string }; text?: string } | undefined;
        const value = temporary ? (record?.scope?.kind === 'turn' ? 'plain' : record?.text ?? 'plain')
          : (record?.polarity === 'negative' ? s.rawInput.fallbackDecision : record?.text ?? s.rawInput.fallbackDecision);
        await write(value);
        production = { artifact, preview: result };
        observed = temporary ? { output: readFileSync(join(root, 'result.txt'), 'utf8'), scopeRetained: record?.scope?.kind === 'turn' }
          : { chosen: readFileSync(join(root, 'result.txt'), 'utf8'), repeatedInvestigations: value === s.rawInput.excludedDecision ? 1 : 0, polarityRetained: record?.polarity === atom.polarity };
        break;
      }
      case 'exact': {
        const handle = masking.archiveHandles[0] ?? createContextArchiveHandleForPayloadSync({ sessionId: s.id,
          itemId: `ctx:${s.id}`, payload: [{ type: 'text', text: s.rawInput.observation }], archiveRoot: join(root, 'archives') });
        const read = await step('archive-recall', () => verifyContextArchiveHandle(handle));
        if (read.ok) {
          const payload = read.payload as Array<{ text: string }>;
          await write(payload[0].text.split('\n')[0]);
        }
        production = { handle, read, messages: masking.messages };
        observed = { output: existsSync(join(root, 'result.txt')) ? readFileSync(join(root, 'result.txt'), 'utf8') : null,
          archiveVerified: read.ok, toolPairPreserved: (masking.messages[2] as { toolCallId?: string }).toolCallId === 'observation-call' };
        break;
      }
      case 'unknown-effect': {
        let sideEffects = 0;
        await rejected('write-timeout', () => executeTaskGuarded(guard, 'unknown', 'write', () => {
          sideEffects++; writeFileSync(join(root, 'effect.txt'), 'applied without receipt'); throw new Error('receipt timeout');
        }), 'receipt timeout');
        store.close(); store = new TaskSystemStore(resolveTaskDomain(root));
        production = restored();
        const replayRejected = await rejected('retry-write', () => executeTaskGuarded(guard, 'retry', 'write', () => { sideEffects++; }), 'TASK_RECONCILIATION_REQUIRED');
        observed = { replayRejected, sideEffects, pending: store.get(claim.taskNodeId).pendingOperations };
        break;
      }
      case 'experience': {
        const artifact = buildDeterministicCompressionArtifact({ messages: masking.messages });
        const result = await preview(s, root, artifact);
        const items = result.pack?.items.filter(item => item.kind === 'knowledge-ref') ?? [];
        // Navigation-only references do not contain condition/action in this
        // entry point. A scripted eager consumer exposes the consequence.
        const adoption = items.length > 0;
        await write(adoption ? s.rawInput.experience.action : 'inspect');
        production = result;
        observed = { adoption, output: readFileSync(join(root, 'result.txt'), 'utf8'),
          sourceStateRetained: items.every(item => item.freshness === 'stale' && item.evidenceRefs.includes('claim:superseded')) };
        break;
      }
      case 'concurrent': {
        await step('first-revision', () => store.revise(claim.taskNodeId, 1, taskContract(s)));
        const revisionConflict = await rejected('second-revision', () => store.revise(claim.taskNodeId, 1, taskContract(s, s.rawInput.old)), 'TASK_REVISION_CONFLICT');
        const edited = [...masking.messages, { role: 'user', content: 'owner revision changed', timestamp: 4 }] as AgentMessage[];
        const plan = { original: messages, replacement: [{ role: 'user', content: 'old compact view', timestamp: 5 }] as AgentMessage[] };
        // Change the prefix as a concurrent edit would; appended history alone is supported.
        edited[0] = { role: 'user', content: 'revised user request', timestamp: 6 };
        const next = applyContextMessageReplacement(edited, plan);
        production = { next, contract: store.get(claim.taskNodeId).contract };
        observed = { revision: store.get(claim.taskNodeId).contract.revision, revisionConflict, historyReplacementApplied: next !== edited };
        break;
      }
      case 'delegation': {
        const childSessionKey = `${claim.sessionKey}-child`;
        store.prepareWriterDelegation(claim, { delegationId: s.id, childSessionKey, childGeneration: 'child-g', childWorktree: root,
          childRunId: 'child-run', mode: 'writer' });
        store.recordDelegationDispatch(childSessionKey, 'child-run', 'dispatched');
        const childGuard = createTaskRuntimeGuard(root, childSessionKey, 'child-g');
        const child = store.binding(childSessionKey, 'child-g')!.claim!;
        store.checkpoint(child, { nextAction: 'verify', completed: ['worker claims all done'], unresolved: ['independent verification required'], artifacts: [] });
        const returned = store.returnDelegatedWriter(childSessionKey, { runId: 'child-run', endedAt: Date.now(), outcome: 'done', parentGeneration: claim.generation });
        const childWriteRejected = await rejected('late-child-write', () => executeTaskGuarded(childGuard, 'child-late', 'write', () => {}), 'TASK_REFERENCE_READ_ONLY');
        guard = createTaskRuntimeGuard(root, claim.sessionKey, claim.generation);
        production = restored();
        await write(readRestored(String(production)).progress.nextAction);
        observed = { returned: returned?.phase === 'returned', taskDone: store.get(claim.taskNodeId).contract.state === 'done',
          output: readFileSync(join(root, 'result.txt'), 'utf8'), childWriteRejected };
        break;
      }
      case 'same-name': {
        const other = store.create({ ...taskContract(s, s.rawInput.old), target: 'other.txt' }, 'same-name-other').task;
        store.claim(other.contract.taskNodeId, 'other-session', 'other-generation', 'other-claim');
        store.selectReference(other.contract.taskNodeId, 'observer', 'observer-g', 'reference');
        const observerGuard = createTaskRuntimeGuard(root, 'observer', 'observer-g');
        const foreignWriteRejected = await rejected('reference-write', () => executeTaskGuarded(observerGuard, 'foreign', 'write', () => {}), 'TASK_CLAIM_REQUIRED');
        production = restored();
        await write(JSON.parse(readRestored(String(production)).core.constraints[0]).value);
        observed = { output: readFileSync(join(root, 'result.txt'), 'utf8'), foreignReadOnly: store.binding('observer', 'observer-g')?.referenceOnly === true, foreignWriteRejected };
        break;
      }
      case 'generation': {
        const oldGuard = guard;
        const newClaim = store.handoff(claim, `${claim.sessionKey}-next`, `${claim.generation}-next`).claim!;
        const oldWriteRejected = await rejected('old-owner-write', () => executeTaskGuarded(oldGuard, 'old-write', 'write', () => {}), 'TASK_STALE_OWNER');
        guard = createTaskRuntimeGuard(root, newClaim.sessionKey, newClaim.generation);
        production = restored();
        await write(JSON.parse(readRestored(String(production)).core.constraints[0]).value);
        observed = { oldWriteRejected, output: readFileSync(join(root, 'result.txt'), 'utf8'), epochAdvanced: newClaim.epoch > claim.epoch };
        break;
      }
      case 'readback': {
        const handle = createContextArchiveHandleForPayloadSync({ sessionId: s.id, itemId: `ctx:${s.id}`, payload: s.rawInput.exact, archiveRoot: join(root, 'archives') });
        const wrong = await step('read-checksum-mismatch', () => verifyContextArchiveHandle({ ...handle, checksum: `sha256:${'0'.repeat(64)}` }));
        const missing = await step('read-missing-source', () => verifyContextArchiveHandle({ ...handle, uri: handle.uri.replace(/[^/]+$/, 'missing.context-archive.json') }));
        production = { wrong, missing };
        observed = { checksumRejected: !wrong.ok && wrong.reason === 'checksum_mismatch', missingRejected: !missing.ok && missing.reason === 'missing', output: null, attempts: 2 };
        break;
      }
      case 'native': {
        const artifact = buildDeterministicCompressionArtifact({ messages: masking.messages, semanticAtoms: [stateAtom(s, {})] });
        const result = await preview(s, root, artifact, true);
        production = { preview: result, restored: restored() };
        const compressionItems = result.pack?.items.filter(item => item.source === 'compression-artifact').length ?? 0;
        observed = { compressionItems, ownerRevision: readRestored(restored()).core.revision, wireObserved: null, hostApplied: compressionItems > 0 };
        await step('continue-native-owner-contract', () => observed.ownerRevision);
        break;
      }
      case 'cost': {
        const guardWithRun = createTaskRuntimeGuard(root, claim.sessionKey, claim.generation, 'cost-run');
        store.beginRun(claim, 'cost-run');
        const recorder = createTaskModelUsageRecorder(guardWithRun);
        const costs: ContinuationCostEvent[] = CONTINUATION_COST_PHASES.map((phase, i) => ({ id: phase, phase, basis: 'fixture', terminal: 'done',
          values: { inputTokens: i === 0 ? 40 : 5, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 5, costUsd: i === 0 ? 0.4 : 0.2, wallMs: 10 } }));
        for (const event of costs) {
          recorder.start(event.id, 'offline-fixture', 'scripted-continuation/v1');
          recorder.finish(event.id, { terminal: 'done', usage: { input: event.values.inputTokens!, output: 20, cacheRead: 0, cacheWrite: 5,
            total: event.values.inputTokens! + 25 }, costUsd: event.values.costUsd, priceVersion: 'fixture-price-v1', toolCallIdHashes: [], endedAt: Date.now() });
        }
        const complete = readTaskTrace(store, { taskNodeId: claim.taskNodeId }, () => 'fixture');
        recorder.start('missing-usage', 'offline-fixture', 'scripted-continuation/v1');
        const incomplete = readTaskTrace(store, { taskNodeId: claim.taskNodeId }, () => 'fixture');
        const summed = sumAutonomyContinuationCosts(costs);
        production = { completeCosts: complete.costs, incompleteCosts: incomplete.costs, fixtureCosts: costs, summed };
        observed = { inputReduced: summed.total.inputTokens! < 100, completeCostHigher: complete.costs.totalUsd! > 1,
          unknownTotal: incomplete.costs.totalUsd, costBenefit: complete.costs.totalUsd! <= .9 };
        store.endRun(claim, 'cost-run');
        await step('retain-full-cost-decision', () => writeFileSync(join(root, 'cost-decision.json'), JSON.stringify(observed)));
        break;
      }
      case 'restart': {
        const id = claim.taskNodeId;
        store.close(); store = new TaskSystemStore(resolveTaskDomain(root));
        guard = createTaskRuntimeGuard(root, claim.sessionKey, claim.generation);
        production = restored();
        await write(JSON.parse(readRestored(String(production)).core.constraints[0]).value);
        const off = await buildObservationMaskingProjection({ enabled: false, messages, sessionId: s.id, archiveRoot: join(root, 'archives') });
        observed = { output: readFileSync(join(root, 'result.txt'), 'utf8'), firstFailureRetained: store.get(id).checkpoint!.completed.includes(s.rawInput.firstFailure),
          offParity: JSON.stringify(off.messages) === JSON.stringify(messages), sameTask: store.binding(claim.sessionKey, claim.generation)?.contract.taskNodeId === id };
        break;
      }
      case 'isolation': {
        const foreignRoot = join(root, 'foreign'); mkdirSync(foreignRoot);
        const profile = { id: s.owner.workspaceId, rootPath: root, projectCoordinatorSessionKey: claim.sessionKey,
          coordinatorBindings: { [claim.sessionKey]: { state: 'active', workspaceId: s.owner.workspaceId,
            sessionKey: claim.sessionKey, sessionGeneration: claim.generation, environment: { canonicalRoot: root } } } } as unknown as WorkspaceProfile;
        const own = projectCoordinatorScope(profile, claim.sessionKey, claim.generation, root);
        const foreignRejected = await rejected('foreign-project', () => projectCoordinatorScope(profile, claim.sessionKey, claim.generation, foreignRoot), 'TASK_SESSION_DOMAIN_MISMATCH');
        const staleRejected = await rejected('stale-generation', () => projectCoordinatorScope(profile, claim.sessionKey, 'stale', root), 'TASK_GENERATION_STALE');
        const ownerPath = join(root, 'workspace-owner.json');
        writeFileSync(ownerPath, JSON.stringify({ systemControl: { paused: true } }));
        vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', ownerPath);
        let systemPauseRejected: boolean;
        try { systemPauseRejected = await rejected('paused-system', () => assertSystemExecutionAllowed(), 'SYSTEM_EXECUTION_PAUSED'); }
        finally { vi.unstubAllEnvs(); }
        production = own;
        observed = { ownAllowed: own.workspaceId === s.owner.workspaceId, foreignRejected, staleRejected, systemPauseRejected };
        break;
      }
      default: throw new Error(`C01_UNKNOWN_FAMILY:${s.family}`);
    }
    const raw = { actor: ACTOR, driven_by: 'agent', production, steps, observed, owner: store.get(claim.taskNodeId), history: store.history(claim.taskNodeId) };
    const rawPath = join(root, 'trace.json');
    writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    // Reopen the actual trace and task output; the grader does not grade a planned result.
    const readback = JSON.parse(readFileSync(rawPath, 'utf8'));
    expect(readback.steps.length).toBe(steps.length);
    return { observed: readback.observed as ContinuationObservation, steps: steps.map(entry => entry.action), rawPath, rawSha256: hash(readFileSync(rawPath)),
      projectedChars: JSON.stringify(masking.messages).length, originalChars: JSON.stringify(messages).length, maskedCount: masking.maskedCount };
  } finally { store.close(); }
}

describe('C01 frozen continuation baseline', () => {
  it('pins all fifteen families and seals the final holdout before execution', async () => {
    const matrix = JSON.parse(readFileSync(join(EVIDENCE, 'scenario-matrix.json'), 'utf8'));
    expect(fileHash(fixturePath)).toBe(matrix.fixtureLfSha256);
    expect(hash(readFileSync(join(ROOT, fixture.legacyFixture.path)))).toBe(fixture.legacyFixture.sha256);
    expect(new Set(fixture.cases.map(entry => entry.family)).size).toBe(15);
    expect(fixture.cases).toHaveLength(45);
    for (const split of ['train', 'development', 'final-holdout']) {
      expect(policy.splits[split]).toEqual(fixture.cases.filter(entry => entry.split === split).map(entry => entry.id));
      expect(policy.splits[split]).toHaveLength(15);
    }
    const { oracle: _oracle, negativeControl: _negative, ...heldout } = fixture.cases.find(entry => entry.split === 'final-holdout')!;
    await expect(continueScenario(heldout, 'current', 0)).rejects.toThrow('C01_FINAL_HOLDOUT_SEALED');
    expect(policy.arms.filter((arm: { status: string }) => arm.status === 'planned').map((arm: { id: string }) => arm.id)).toEqual(['working-projection', 'conditioned']);
  });

  for (const scenario of fixture.cases.filter(entry => policy.offline.defaultSplits.includes(entry.split))) {
    it(`${scenario.id}: executes both arms twice and reads the resulting artifacts`, async () => {
      const { oracle, negativeControl, ...input } = scenario;
      for (const arm of ['current', 'simple-masking'] as const) {
        const first = await continueScenario(input, arm, 1);
        const second = await continueScenario(input, arm, 2);
        expect(second.observed).toEqual(first.observed);
        expect(first.steps.length).toBeLessThanOrEqual(input.remainingBudget.actions);
        const grade = gradeAutonomyContinuation(oracle.assertions, first.observed);
        const corrupted = { ...first.observed, [negativeControl.field]: negativeControl.replacement };
        const negativeGrade = gradeAutonomyContinuation(oracle.assertions, corrupted);
        expect(negativeGrade.failed).toContain(negativeControl.field);
        const expectedValue = oracle.assertions[negativeControl.field];
        const semanticMutation = typeof expectedValue === 'boolean' ? !expectedValue
          : typeof expectedValue === 'number' ? expectedValue + 1 : expectedValue === null ? 0 : `${expectedValue}-wrong`;
        expect(gradeAutonomyContinuation(oracle.assertions, oracle.assertions).status).toBe('pass');
        expect(gradeAutonomyContinuation(oracle.assertions, { ...oracle.assertions,
          [negativeControl.field]: semanticMutation }).failed).toContain(negativeControl.field);
        const row = { id: scenario.id, family: scenario.family, split: scenario.split, arm,
          actor: ACTOR, driven_by: 'agent', measurementBasis: 'offline-scripted-continuation', ...first,
          inputDigest: hash(JSON.stringify(input)),
          replayRawPath: second.rawPath, replayRawSha256: second.rawSha256,
          grade, negativeControl: { ...negativeControl, semanticMutation, detected: true },
          structural: { assertions: oracle.assertions, observed: first.observed },
          modelBehavior: { kind: 'scripted-probe', actions: first.steps }, productTaskGrade: null,
          attribution: { retrieval: first.steps.some(action => action.includes('read') || action.includes('recall')),
            citation: null, adoption: first.observed.adoption ?? null, operationSuccess: first.observed.output === null ? false : null,
            independentTaskGrade: grade.status },
          costs: sumAutonomyContinuationCosts([{ id: 'unmeasured-offline', phase: 'execution', basis: 'unmeasured', terminal: 'unknown',
            values: Object.fromEntries(CONTINUATION_COST_FIELDS.map(field => [field, null])) as ContinuationCostEvent['values'] }]),
        };
        results.push(row);
      }
    }, 60_000);
  }

  it('retains uncertain Working Context as unconfirmed after owner acceptance', () => {
    const issuedAt = fixture.clock;
    const proposal = createTaskLedgerWorkingContextProposal({ proposalId: 'uncertain', field: 'ConfirmedFacts', value: ['not independently checked'],
      version: 1, actor: 'assistant', taskId: 'task-a', trust: 'uncertain', evidenceRefs: [{ type: 'manual', ref: 'worker-result' }], createdAt: issuedAt });
    const decision = createTaskLedgerWorkingContextDecision({ proposalId: 'uncertain', field: 'ConfirmedFacts', version: 1, decision: 'accepted',
      actor: 'system', taskId: 'task-a', policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST, createdAt: issuedAt });
    if (!proposal.ok || !decision.ok) throw new Error('fixture working-context events invalid');
    const projected = projectTaskLedgerWorkingContext([{ ...proposal.event, id: 'proposal' }, { ...decision.event, id: 'decision' }] as TaskLedgerEvent[]);
    expect(projected.fields.ConfirmedFacts.current?.trust).toBe('uncertain');
  });

  it('keeps missing grades and every unmeasured cost component unknown', () => {
    expect(gradeAutonomyContinuation({ completed: true }, {})).toMatchObject({ status: 'unknown', unknown: ['completed'] });
    expect(gradeAutonomyContinuation({ completed: true }, { completed: false })).toMatchObject({ status: 'fail' });
    expect(() => gradeAutonomyContinuation({}, {})).toThrow('ORACLE_EMPTY');
    expect(sumAutonomyContinuationCosts([]).total.costUsd).toBeNull();
    const events: ContinuationCostEvent[] = CONTINUATION_COST_PHASES.map(phase => ({ id: phase, phase, terminal: 'done', basis: 'fixture',
      values: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costUsd: .1, wallMs: 1 } }));
    expect(sumAutonomyContinuationCosts(events).total).toEqual({ inputTokens: 5, outputTokens: 10, cacheReadTokens: 15, cacheWriteTokens: 20, costUsd: .5, wallMs: 5 });
    for (const field of CONTINUATION_COST_FIELDS) {
      const unknown = structuredClone(events); unknown[1].values[field] = null;
      expect(sumAutonomyContinuationCosts(unknown).total[field]).toBeNull();
    }
    expect(() => sumAutonomyContinuationCosts([...events, events[0]])).toThrow('COST_DUPLICATE');
    expect(() => sumAutonomyContinuationCosts([{ ...events[0], values: { ...events[0].values, costUsd: -1 } }])).toThrow('COST_INVALID');
    expect(sumAutonomyContinuationCosts(events).providerMeasured).toBe(false);
  });
});

afterAll(() => {
  const report = { schema: 'AutonomyContextOfflineRun/v1', actor: ACTOR, driven_by: 'agent', generatedAt: new Date().toISOString(),
    fixtureSha256: fileHash(fixturePath), policySha256: fileHash(join(EVIDENCE, 'frozen-evaluation-policy.json')), hashScheme: 'sha256-utf8-lf',
    families: [...new Set(results.map(row => row.family))], rows: results, executedRows: results.length,
    semanticDigest: hash(JSON.stringify(results.map(row => ({ id: row.id, arm: row.arm, observed: row.observed, grade: row.grade })))),
    heldoutExecuted: 0, liveProviderCalls: 0, liveQuality: 'not-measured', productTaskResult: 'not-measured',
    plannedArms: ['working-projection', 'conditioned'] };
  writeFileSync(rawFile, JSON.stringify(report, null, 2));
  const disk = JSON.parse(readFileSync(rawFile, 'utf8'));
  expect(disk.executedRows).toBe(results.length);
  expect(disk.executedRows).toBe(60);
});
