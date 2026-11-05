import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { TaskLedgerAgentActionPayload, TaskLedgerAgentActionResult, TaskLedgerCompletionClaimPayload, TaskLedgerCompletionClaimResult } from '@shared/host-api/contract';
import type { TaskLedgerSnapshot, TaskLedgerCompletionCheckpoint, TaskLedgerCompletionCheckReceipt } from '@shared/types/task-ledger';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

test('TF-0672 actual Main/Gateway refuses digest self-proof and records missing-owner rejection with historical replay', async ({ launchElectronApp, homeDir }, testInfo) => {
  test.setTimeout(300_000);
  const processTemp = join(homeDir, 'native-process-temp');
  await mkdir(processTemp, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { TEMP: processTemp, TMP: processTemp } });
  try {
    await getStableWindow(app);
    const active = await hostInvoke<{ activeWorkspace: { id: string; rootPath: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id, root = active.activeWorkspace.rootPath;
    await mkdir(root, { recursive: true });
    // Only this isolated workspace is prepared. No product permission default changes.
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    // Fixture preparation only. This journey tests completion admission, not a
    // shell-provider installation; all completion RPC/ledger calls below are real.
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, timeout: 30_000, stdio: 'pipe' });
    git(['init', '--initial-branch=main']);
    await writeFile(join(root, 'a3-source.txt'), 'A3 actual owner negative control\n');
    git(['add', 'a3-source.txt']);
    git(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'A3 isolated source']);
    // Source-runtime isolation inherits this actual workspace at Gateway launch.
    await startGateway(app);
    await expect.poll(async () => {
      try { await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} }); return true; }
      catch (error) { if (String(error).includes('unavailable during gateway startup')) return false; throw error; }
    }, { timeout: 120_000 }).toBe(true);
    const created = await hostInvoke<{ key?: string; sessionKey?: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label: 'A3 owner-negative journey' } });
    const sessionKey = created.key ?? created.sessionKey;
    if (!sessionKey) throw new Error('No actual owner session');
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: sessionKey, sessionKey });
    const activity = await hostInvoke<{ snapshot: { session: { sessionId: string } } }>(app, 'gateway', 'rpc', { method: 'session.activitySnapshot', params: { workspaceId, sessionKey } });
    const scope = { workspaceId, projectId: workspaceId, sessionKey, sessionGeneration: activity.snapshot.session.sessionId };
    const ack = await hostInvoke<{ childPid: number; gatewayGeneration: string }>(app, 'gateway', 'rpc', { method: 'runtime.flags.ack', params: {} });
    const status = await hostInvoke<{ connectedAt: number }>(app, 'gateway', 'status');
    const before = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    const task = await hostInvoke<TaskLedgerAgentActionResult>(app, 'taskLedger', 'applyAgentAction', { operationId: 'a3-actual-create', expectedRevision: before.snapshot.eventsCount,
      scope, runtimeGeneration: ack.gatewayGeneration, runtimeOwner: { childPid: ack.childPid, connectedAt: status.connectedAt },
      action: { type: 'create', node: { title: 'Actual A3 completion negative control' } } } as TaskLedgerAgentActionPayload);
    const taskNodeId = task.snapshot.nodes.find(node => node.title === 'Actual A3 completion negative control')!.id;
    const oldDigestClaim = { workspaceId, claim: { schema: 'TaskCompletionClaim/v1', taskId: taskNodeId, candidateDigest: 'a'.repeat(64),
      generation: 'never-existed-session-generation', verifierDigest: 'b'.repeat(64), effectDigest: 'b'.repeat(64), priorStatus: 'todo' } };
    await expect(hostInvoke(app, 'taskLedger', 'submitCompletion', oldDigestClaim)).rejects.toThrow('VALIDATION');
    const refs = await hostInvoke<{ checkpoint: unknown }>(app, 'gateway', 'rpc', { method: 'task_loop.completionEvidence',
      params: { workspaceId, sessionKey, checkpointId: 'missing-a3-checkpoint' } });
    await testInfo.attach('a3-owner-source-facts', { body: JSON.stringify({ activeWorkspace: active.activeWorkspace, refs }), contentType: 'application/json' });
    expect(refs.checkpoint).toBeNull();
    const claim = { operationId: 'a3-actual-rejected-completion', expectedRevision: task.snapshot.eventsCount,
      taskRef: { owner: 'task-ledger', taskNodeId, scope }, checkpointId: 'missing-a3-checkpoint', verificationRunIds: ['missing-a3-check-run'] } as TaskLedgerCompletionClaimPayload;
    const rejected = await hostInvoke<TaskLedgerCompletionClaimResult>(app, 'taskLedger', 'submitCompletion', claim);
    expect(rejected.operationDecision).toMatchObject({ accepted: false, driven_by: 'agent', gaps: ['task-loop-owner-unavailable'] });
    expect(rejected.snapshot.nodes.find(node => node.id === taskNodeId)?.status).toBe('review');
    await hostInvoke(app, 'gateway', 'stop');
    const replay = await hostInvoke<TaskLedgerCompletionClaimResult>(app, 'taskLedger', 'submitCompletion', claim);
    expect(replay.receipt.replayed).toBe(true); expect(replay.operationDecision).toEqual(rejected.operationDecision);
    const dir = join(homeDir, '.openclaw', 'task-ledgers', 'workspaces');
    const evidence = { driven_by: 'agent', actor: 'codex-a3-electron', candidate: process.env.CLAWX_E2E_CANDIDATE ?? 'dirty-development',
      scope, ack, beforeRevision: before.snapshot.eventsCount, oldDigestClaimRejected: true, checkpoint: refs, rejected, replay,
      ledgerRoot: dir, acceptanceLimits: ['Negative admission only; this journey does not prove the positive independent verification chain'] };
    const file = testInfo.outputPath('a3-owner-negative.json');
    await writeFile(file, JSON.stringify(evidence, null, 2));
    expect(JSON.parse(await readFile(file, 'utf8')).rejected.operationDecision.accepted).toBe(false);
    await testInfo.attach('a3-owner-negative', { path: file, contentType: 'application/json' });
  } finally { await closeElectronApp(app); }
});

test('TF-0672 actual TaskLoop/check/effect/archive owners admit the exact candidate and invalidate subsequent source drift', async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
  test.setTimeout(360_000);
  const workspace = join(homeDir, 'a3-positive-source');
  await mkdir(workspace, { recursive: true });
  const git = (args: string[]) => execFileSync('git', args, { cwd: workspace, windowsHide: true, timeout: 30_000, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  await writeFile(join(workspace, '.gitignore'), '.openclaw/\n.ae/\n');
  await writeFile(join(workspace, 'source.txt'), 'A3 expected contract\n');
  await writeFile(join(workspace, 'verify.cjs'), 'const fs=require("node:fs"),assert=require("node:assert/strict"); assert.equal(fs.readFileSync("source.txt","utf8"),"A3 expected contract\\n"); console.log("A3 candidate contract actually verified");\n');
  git(['add', '.']); git(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'A3 positive isolated candidate']);
  const llm = await startScriptedLlm(prompt => {
    if (prompt.includes('You are the OpenClaw task-loop self-check reviewer.')) return { text: JSON.stringify({
      decision: 'complete', confidence: 0.95, missingEvidence: [], verificationGaps: [], risks: [], controlSignals: [],
      validationState: { status: 'passed', checks: ['scripted scenario report'], evidenceRefs: [], summary: 'Scenario control; actual check owner still must run the program' },
      acceptanceStatus: { status: 'satisfied', criteria: ['exact source contract'], gaps: [] }, contextSummary: 'Scripted TaskLoop gate; independent actual check remains required',
    }) };
    return { text: '## Summary\nAgent-driven fixed scenario inspected the unchanged candidate.\n## Files Touched\nsource.txt\n## Tests Run\nnode verify.cjs (report only; independent host execution remains required)\n## Follow-up Candidates\nnone\n## Risks\nnone\nverificationVerdict=pass' };
  });
  const cfg = buildMockProviderConfig(llm.port, workspace);
  // This scripted endpoint accepts the role effort protocol. Its responses are
  // scenario controls, with no claim of model reasoning quality.
  const model = ((cfg.models as { providers: { openai: { models: Array<Record<string, unknown>> } } }).providers.openai.models[0]);
  model.reasoning = true;
  model.compat = { supportsReasoningEffort: true, supportedReasoningEfforts: ['low', 'medium', 'high'] };
  const agents = cfg.agents as { defaults: Record<string, unknown> };
  agents.defaults.taskLoop = { maxIterations: 1, maxRepairIterations: 0 };
  agents.defaults.subagents = { maxConcurrent: 2, runTimeoutSeconds: 90 };
  cfg.tools = { exec: { host: 'gateway', security: 'full', ask: 'off' } };
  await mkdir(join(userDataDir, 'openclaw-source-state'), { recursive: true });
  await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), JSON.stringify(cfg));
  await writeFile(join(userDataDir, 'openclaw-source-state', 'openclaw.json'), JSON.stringify(cfg));
  const processTemp = join(homeDir, 'native-process-temp');
  await mkdir(processTemp, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { TEMP: processTemp, TMP: processTemp, OPENCLAW_CONTEXT_ARCHIVE_DIR: join(homeDir, '.openclaw', 'context-archives') } });
  try {
    await getStableWindow(app);
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id;
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess', rootPath: workspace });
    await startGateway(app);
    await expect.poll(async () => {
      try { await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} }); return true; }
      catch { return false; }
    }, { timeout: 120_000 }).toBe(true);
    const created = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label: 'A3 real positive acceptance' } });
    const sessionKey = created.key;
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: sessionKey, sessionKey });
    // The program is frozen at intake. No command/verifier/verdict is accepted by submitCompletion.
    const command = process.platform === 'win32' ? "& '" + process.execPath.replaceAll("'", "''") + "' verify.cjs; exit $LASTEXITCODE" : "'" + process.execPath + "' verify.cjs";
    type Loop = { loopRunId: string; status: string; taskLedgerRootId: string; iteration: number; phase: string; subagentEvidence: unknown[]; evidenceGate: unknown };
    const pending = hostInvoke<{ loop: Loop }>(
      app, 'gateway', 'rpc', { method: 'task_loop.run', timeoutMs: 240_000, params: { task: 'Verify unchanged source contract for A3', sessionKey, workspaceId, agentId: 'main',
        taskLedgerRootId: 'a3-actual-positive-task', includeVerifier: true, maxWorkers: 1, templateId: 'quick-development',
        acceptance: ['exact source contract'], verificationChecks: [{ acceptanceIndex: 0, command }] } }).then(result => ({ result }), error => ({ error: String(error) }));
    // Host calls have their own bounded observation timeout. Follow the same
    // actual loop owner instead of restarting an execution after that timeout.
    let loopRunId: string | undefined;
    await expect.poll(async () => {
      const ledger = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
      loopRunId = ledger.snapshot.nodes.find(node => node.id === 'a3-actual-positive-task')?.metadata?.runId as string | undefined;
      return Boolean(loopRunId);
    }, { timeout: 30_000 }).toBe(true);
    let loop: { loop: Loop } | undefined;
    await expect.poll(async () => {
      loop = await hostInvoke<{ loop: Loop }>(app, 'gateway', 'rpc', { method: 'task_loop.status', params: { loopRunId } });
      return loop.loop.status !== 'running';
    }, { timeout: 180_000, intervals: [1000, 2000, 3000] }).toBe(true);
    if (!loop) throw new Error('No actual TaskLoop terminal state');
    const completedLoop = loop.loop;
    const invocation = await pending;
    await testInfo.attach('a3-actual-task-loop', { body: JSON.stringify({ ...loop, invocation, providerRequests: llm.log, anomalies: llm.anomalies }), contentType: 'application/json' });
    expect(completedLoop.status).toBe('complete');
    const checkpointId = 'task-loop:' + completedLoop.loopRunId + ':iteration:' + completedLoop.iteration + ':' + completedLoop.phase;
    const facts = await hostInvoke<{ checkpoint: TaskLedgerCompletionCheckpoint; scope: unknown }>(app, 'gateway', 'rpc', { method: 'task_loop.completionEvidence', params: { workspaceId, sessionKey, checkpointId } });
    expect(facts.checkpoint).not.toBeNull();
    expect(facts.checkpoint.reviewer.runId).not.toBe(facts.checkpoint.workerRunIds[0]);
    const mainLifecycleIds = ['task-loop:' + completedLoop.loopRunId + ':goal', 'task-loop:' + completedLoop.loopRunId + ':task'];
    await expect.poll(async () => {
      const snapshot = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', {});
      return mainLifecycleIds.every(id => snapshot.snapshot.nodes.some(node => node.id === id && node.progress === 100 && node.status === 'review'));
    }, { timeout: 30_000 }).toBe(true);
    const before = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(before.snapshot.nodes.find(node => node.id === completedLoop.taskLedgerRootId)?.status).not.toBe('done');
    const verified = await hostInvoke<{ receipt: TaskLedgerCompletionCheckReceipt; replayed: boolean; state: string; reason?: string }>(app, 'gateway', 'rpc', {
      method: 'task_loop.verifyCompletion', timeoutMs: 120_000, params: { workspaceId, sessionKey, checkpointId, checkId: facts.checkpoint.requiredCheckIds[0], verificationRunId: 'a3-actual-positive-check' } });
    await testInfo.attach('a3-actual-execution-receipt', { body: JSON.stringify(verified), contentType: 'application/json' });
    expect(verified, JSON.stringify(verified)).toMatchObject({ state: 'completed', replayed: false, receipt: { status: 'verified', exitCode: 0, owner: 'task-loop-exec-effect' } });
    const current = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    const claim = { operationId: 'a3-actual-positive-completion', expectedRevision: current.snapshot.eventsCount, taskRef: facts.checkpoint.taskRef, checkpointId, verificationRunIds: [verified.receipt.verificationRunId] };
    const accepted = await hostInvoke<TaskLedgerCompletionClaimResult>(app, 'taskLedger', 'submitCompletion', claim);
    expect(accepted.operationDecision.accepted).toBe(true);
    expect(accepted.snapshot.nodes.find(node => node.id === completedLoop.taskLedgerRootId)).toMatchObject({ status: 'done', completionReadback: { state: 'accepted' } });
    const replay = await hostInvoke<TaskLedgerCompletionClaimResult>(app, 'taskLedger', 'submitCompletion', claim);
    expect(replay.receipt.replayed).toBe(true); expect(replay.operationDecision).toEqual(accepted.operationDecision);
    const other = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', { method: 'sessions.create',
      params: { agentId: 'main', label: 'A3 selection readback control' } });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: other.key, sessionKey: other.key });
    const selectedElsewhere = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(selectedElsewhere.snapshot.nodes.find(node => node.id === completedLoop.taskLedgerRootId)).toMatchObject({ status: 'done', completionReadback: { state: 'accepted' } });
    const activity = await hostInvoke<{ snapshot: { tasks: Array<{ id: string; status: string }> } }>(app, 'sessionActivity', 'snapshot', { workspaceId, sessionKey });
    expect(activity.snapshot.tasks.find(task => task.id === completedLoop.taskLedgerRootId)?.status).toBe('completed');
    await expect(hostInvoke(app, 'taskLedger', 'submitCompletion', { ...claim, operationId: 'a3-inactive-owner-new-claim',
      expectedRevision: selectedElsewhere.snapshot.eventsCount })).rejects.toThrow('VALIDATION');
    const original = accepted.snapshot.nodes.find(node => node.id === completedLoop.taskLedgerRootId)!;
    const lifecycle = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'appendEvents', {
      workspaceId, events: [{ type: 'node_created', actor: 'assistant', taskId: 'wrong-caller-id', payload: { node: {
        id: original.id, kind: 'task', title: 'Late generic lifecycle replacement', status: 'doing',
        createdAt: original.createdAt, updatedAt: original.updatedAt,
      } } }],
    });
    expect(lifecycle.snapshot.nodes.find(node => node.id === original.id)).toMatchObject({ kind: original.kind, title: original.title,
      status: 'done', completionDecision: accepted.operationDecision, completionReadback: { state: 'accepted' } });
    await writeFile(join(workspace, 'source.txt'), 'A3 changed unverified source\n');
    const drifted = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    expect(drifted.snapshot.nodes.find(node => node.id === completedLoop.taskLedgerRootId)).toMatchObject({ status: 'review', completionReadback: { state: 'invalidated' } });
    const manualDropped = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'updateNode', { workspaceId, nodeId: original.id, patch: { status: 'dropped' } });
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: sessionKey, sessionKey });
    await expect(hostInvoke(app, 'taskLedger', 'submitCompletion', { ...claim, operationId: 'a3-new-claim-after-drop',
      expectedRevision: manualDropped.snapshot.eventsCount })).rejects.toThrow('VALIDATION');
    const droppedReplay = await hostInvoke<TaskLedgerCompletionClaimResult>(app, 'taskLedger', 'submitCompletion', claim);
    expect(droppedReplay.operationDecision).toEqual(accepted.operationDecision);
    expect(droppedReplay.snapshot.nodes.find(node => node.id === original.id)?.status).toBe('dropped');
    await testInfo.attach('a3-positive-admission-and-drift', { body: JSON.stringify({ driven_by: 'agent', actor: 'codex-a3-electron', source: git(['rev-parse', 'HEAD']).toString().trim(),
      provider: 'scripted scenario; no model-quality claim', facts, verified, accepted, replay, selectedElsewhere, activity, lifecycle,
      inactiveNewClaimRejected: true, drifted, manualDropped, droppedNewClaimRejected: true, droppedReplay }), contentType: 'application/json' });
  } finally {
    await testInfo.attach('a3-provider-scenario-log', { body: JSON.stringify({ log: llm.log, anomalies: llm.anomalies }), contentType: 'application/json' });
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app); llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
