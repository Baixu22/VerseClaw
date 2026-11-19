import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import type { TaskView } from '../../shared/task-system/types';
import { getOpenClawProviderKeyForType } from '../../electron/utils/provider-keys';
import { createHash } from 'node:crypto';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';
import { DatabaseSync } from 'node:sqlite';

test('a project repairs a failed check and closes its newly reviewed candidate without another user prompt', async ({ launchElectronApp, userDataDir }, info) => {
  test.setTimeout(480_000);
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
  const sourceCandidate = git('rev-parse', 'HEAD');
  const sourceDirty = git('status', '--porcelain');
  if (process.env.CLAWX_P4_EXPECTED_HEAD) {
    expect(sourceCandidate).toBe(process.env.CLAWX_P4_EXPECTED_HEAD); expect(sourceDirty).toBe('');
  }
  const root = info.outputPath('project');
  await mkdir(root, { recursive: true });
  const check = "const fs=require('node:fs');const assert=require('node:assert/strict');assert.equal(fs.readFileSync('result.txt','utf8'),'repaired result\\n');console.log('verified result');\n";
  await writeFile(join(root, 'check.cjs'), check);
  git('init', '-b', 'main', root);
  git('-C', root, 'add', 'check.cjs');
  git('-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture check');
  let reviewComplete: (runId: string) => boolean;
  const yieldedReviews = new Set<string>();
  type WorkerReceipt = { childRunId: string; childSessionKey: string; isolation: { backend: string; canonicalRoot: string } };
  const workerRuns: Array<{ repair: boolean; child: WorkerReceipt; admission: unknown; record?: SubagentRunRecord }> = [];
  let dispatchWorker: (repair: boolean, taskNodeId: string) => Promise<void>;
  let checkWorker: (repair: boolean) => Promise<boolean>;
  const llm = await startScriptedLlm(async (text, results) => {
    const call = (id: string, name: string, args: Record<string, unknown>) => ({ toolCall: { id, name, args } });
    const workerMatch = /P4-WORKER-(INITIAL|REPAIR)/.exec(text);
    if (workerMatch && !Object.hasOwn(results, 'p4start')) {
      const repair = workerMatch[1] === 'REPAIR';
      const id = repair ? 'p4workerrepairwrite' : 'p4workerinitialwrite';
      if (!Object.hasOwn(results, id)) return call(id, 'write', { path: 'result.txt', content: repair ? 'repaired result\n' : 'broken result\n' });
      return { text: repair ? 'P4-WORKER-REPAIR-DONE' : 'P4-WORKER-INITIAL-DONE' };
    }
    const settleCheck = (id: string) => {
      const sessionId = /Command still running \(session ([^,\s)]+)/.exec(results[id] ?? '')?.[1];
      if (!sessionId) return undefined;
      for (let attempt = 0; attempt < 8; attempt++) {
        const pollId = `${id}poll${attempt}`;
        if (!Object.hasOwn(results, pollId)) return call(pollId, 'process', { action: 'poll', sessionId, timeout: 20000 });
        if (results[pollId].includes('Process exited with')) return undefined;
      }
      throw new Error(`The check process did not finish: ${id}`);
    };
    if (text.includes('Independently review this submitted project candidate.') && !Object.hasOwn(results, 'p4start')) {
      const fixed = text.includes('p4fixed');
      const id = fixed ? 'reviewfixedread' : 'reviewbrokenread';
      if (!Object.hasOwn(results, id)) return call(id, 'read', { path: 'result.txt' });
      expect(results[id]).toContain(fixed ? 'repaired result' : 'broken result');
      expect(results[id]).not.toMatch(/"status":\s*"error"|ENOENT|permission denied/i);
      const checkId = `${id}check`;
      if (!Object.hasOwn(results, checkId)) return call(checkId, 'read', { path: 'check.cjs' });
      expect(results[checkId]).toContain('assert.equal');
      return { text: results[id].includes('repaired result') ? 'Read the repaired bytes from disk. verificationVerdict=pass'
        : 'The result does not satisfy check.cjs. verificationVerdict=repair_required' };
    }
    if (!Object.hasOwn(results, 'p4start')) return call('p4start', 'task_control', { action: 'start', requestId: 'p4task', contract: {
      objective: 'Repair and independently review the project result', target: 'result.txt', constraints: ['Change result.txt only'], maxRepairAttempts: 1,
      acceptance: [
        { id: 'test', description: 'The integrated result passes the check', verification: {
          kind: 'tool-result', tool: 'exec', command: 'node check.cjs', files: ['result.txt', 'check.cjs'], exitCode: 0,
        } },
        { id: 'review', description: 'An independent reviewer reads the candidate', verification: {
          kind: 'owner-receipt', owner: 'subagent-verifier', files: ['result.txt', 'check.cjs'],
        } },
      ],
    } });
    const pendingBroken = settleCheck('p4testbroken');
    if (pendingBroken) return pendingBroken;
    const task = JSON.parse(results.p4start) as TaskView;
    if (!workerRuns.some(run => !run.repair)) {
      await dispatchWorker(false, task.contract.taskNodeId);
      return call('p4workerinitialyield', 'sessions_yield', {});
    }
    if (!(await checkWorker(false))) return call('p4workerinitialyield', 'sessions_yield', {});
    const steps: Array<[string, string, Record<string, unknown>]> = [
      ['p4testbroken', 'exec', { command: 'node check.cjs', yieldMs: 10000 }],
      ['p4submitbroken', 'task_control', { action: 'submit', candidate: 'p4broken' }],
      ['p4reviewbroken', 'task_control', { action: 'review', candidate: 'p4broken', requestId: 'p4reviewbroken' }],
    ];
    for (const [id, name, args] of steps) if (!Object.hasOwn(results, id)) return call(id, name, args);
    if (!yieldedReviews.has('broken') || !reviewComplete(JSON.parse(results.p4reviewbroken).runId)) {
      yieldedReviews.add('broken'); return call('p4yieldbroken', 'sessions_yield', {});
    }
    const pendingFixed = settleCheck('p4testfixed');
    if (pendingFixed) return pendingFixed;
    if (Object.hasOwn(results, 'p4repair')) {
      if (!workerRuns.some(run => run.repair)) {
        await dispatchWorker(true, task.contract.taskNodeId);
        return call('p4workerrepairyield', 'sessions_yield', {});
      }
      if (!(await checkWorker(true))) return call('p4workerrepairyield', 'sessions_yield', {});
    }
    const repair: Array<[string, string, Record<string, unknown>]> = [
      ['p4acceptbroken', 'task_control', { action: 'accept', candidate: 'p4broken' }],
      ['p4repair', 'task_control', { action: 'repair', candidate: 'p4broken', requestId: 'p4repair', reason: 'The check failed and reviewer requested repair' }],
      ['p4testfixed', 'exec', { command: 'node check.cjs', yieldMs: 10000 }],
      ['p4submitfixed', 'task_control', { action: 'submit', candidate: 'p4fixed' }],
      ['p4oldreview', 'task_control', { action: 'accept', candidate: 'p4fixed' }],
      ['p4reviewfixed', 'task_control', { action: 'review', candidate: 'p4fixed', requestId: 'p4reviewfixed' }],
    ];
    for (const [id, name, args] of repair) if (!Object.hasOwn(results, id)) return call(id, name, args);
    if (!yieldedReviews.has('fixed') || !reviewComplete(JSON.parse(results.p4reviewfixed).runId)) {
      yieldedReviews.add('fixed'); return call('p4yieldfixed', 'sessions_yield', {});
    }
    if (!Object.hasOwn(results, 'p4acceptfixed')) return call('p4acceptfixed', 'task_control', { action: 'accept', candidate: 'p4fixed' });
    if (!Object.hasOwn(results, 'p4history')) {
      const task = JSON.parse(results['p4start']) as TaskView;
      return call('p4history', 'task_control', { action: 'history', taskNodeId: task.contract.taskNodeId });
    }
    return { text: 'P4 completed: check.cjs passed and an independent reviewer read the repaired candidate. One repair used. No remaining acceptance gaps. Broader scenarios were not run. Ready for the publisher to review.' };
  });
  const app = await launchElectronApp({ skipSetup: true });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-project-closeout', sourceCandidate,
    sourceTree: git('rev-parse', 'HEAD^{tree}'), sourceDirty: Boolean(sourceDirty), provider: 'local-scripted', status: 'running' };
  try {
    await getStableWindow(app); await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, root, 'Closeout project');
    evidence.project = project;
    // The native subagent model owner resolves this fixture provider for workers and reviewer.
    const config = await hostInvoke<{ hash: string }>(app, 'gateway', 'rpc', { method: 'config.get', params: {} });
    await hostInvoke(app, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: config.hash,
      raw: JSON.stringify({ runtime: { coding: { worktree: { backend: 'inprocess' } } }, agents: { defaults: { subagents: {
        model: `${getOpenClawProviderKeyForType('custom', 'custom-sessionc')}/mock-coder`,
      } } } }), note: 'P4 worker fixture' } });
    const registryPath = join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite');
    const readWorker = (runId: string) => {
      const db = new DatabaseSync(registryPath, { readOnly: true });
      try {
        const row = db.prepare('SELECT payload_json FROM subagent_runs WHERE run_id=?').get(runId);
        return typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) as SubagentRunRecord : undefined;
      } finally { db.close(); }
    };
    reviewComplete = runId => {
      if (!runId) throw new Error('Reviewer dispatch did not return a run id');
      const record = readWorker(runId);
      if (!record?.endedAt) return false;
      const ledger = new TaskSystemStore(resolveTaskDomain(root));
      try { return ledger.delegationForChild(record.childSessionKey)?.phase === 'returned'; }
      finally { ledger.close(); }
    };
    dispatchWorker = async (repair, taskNodeId) => {
      const task = `P4-WORKER-${repair ? 'REPAIR' : 'INITIAL'}: write ${repair ? 'repaired' : 'broken'} result to result.txt and finish.`;
      if (!repair) {
        const binding = await hostInvoke<{ success: boolean; binding?: { bindingRevision: number }; error?: string }>(app, 'workspaces', 'bindCoordinator', {
          workspaceId: project.workspaceId, sessionKey: project.sessionKey, agentId: 'main', expectedRevision: 0,
          taskLedgerNodeIds: [taskNodeId], environment: { kind: 'local', rootPath: root }, archiveRestorePolicy: 'restore',
        });
        expect(binding.success, binding.error).toBe(true);
        evidence.binding = binding;
      }
      const admission = await hostInvoke<{ status: string; delegationReceipt: { children: WorkerReceipt[] } }>(app, 'gateway', 'rpc', {
        method: 'orchestrator.run', timeoutMs: 90_000, params: {
          task, sessionKey: project.sessionKey, agentId: 'main', expectedSessionGeneration: project.generation,
          isolation: 'worktree', includeVerifier: false, maxWorkers: 1, allowAutoRepair: false,
          workers: [{ roleName: 'implementer', task, writeSet: ['result.txt'], isolation: 'worktree',
            modelRef: `${getOpenClawProviderKeyForType('custom', 'custom-sessionc')}/mock-coder` }],
          delegationAdmission: { receiptId: repair ? 'p4-repair-worker' : 'p4-initial-worker',
            idempotencyKey: repair ? 'p4-repair-worker' : 'p4-initial-worker', taskRef: { kind: 'task-ledger', nodeId: taskNodeId },
            coordinator: { workspaceId: project.workspaceId, agentId: 'main', sessionKey: project.sessionKey,
              sessionId: project.generation, bindingRevision: 1 } },
        },
      });
      expect(admission.status, JSON.stringify(admission)).toBe('accepted');
      expect(admission.delegationReceipt.children).toHaveLength(1);
      const child = admission.delegationReceipt.children[0];
      expect(child.isolation.backend).toBe('inprocess-worktree');
      expect(child.isolation.canonicalRoot.toLowerCase()).not.toBe(root.toLowerCase());
      workerRuns.push({ repair, child, admission });
    };
    checkWorker = async repair => {
      const worker = workerRuns.find(run => run.repair === repair)!;
      if (worker.record) return true;
      const record = readWorker(worker.child.childRunId);
      if (!record?.endedAt || !record.orchestration?.worktreeMergeProcessedAt) return false;
      expect(record.outcome?.status, JSON.stringify(record.outcome)).toBe('ok');
      expect(record.orchestration.worktreeMergeStatus, record.orchestration.worktreeMergeReason).toBe('merged');
      expect(record.orchestration.worktreeMergeJournalRef).toBeTruthy();
      const content = repair ? 'repaired result\n' : 'broken result\n';
      expect(await readFile(join(root, 'result.txt'), 'utf8')).toBe(content);
      expect(record.orchestration.worktreeMergeHashes?.['result.txt']).toBe(createHash('sha256').update(content).digest('hex'));
      worker.record = record;
      return true;
    };
    const page = await getStableWindow(app); await page.reload();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await page.getByTestId('chat-composer-input').fill('Deliver the checked project result, repair one failure and independently verify it.');
    await page.getByTestId('chat-composer-send').click();
    await expect(page.getByText(/P4 completed: check.cjs passed/)).toBeVisible({ timeout: 390_000 });
    const result = (id: string) => llm.log.find(row => Object.hasOwn(row.toolResults, id))?.toolResults[id];
    const task = JSON.parse(result('p4start')!) as TaskView;
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      expect(store.get(task.contract.taskNodeId).contract.state).toBe('done');
      const events = store.history(task.contract.taskNodeId, 0, 500);
      expect(events.filter(event => event.kind === 'repair_started')).toHaveLength(1);
      expect(events.filter(event => event.kind === 'accepted')).toHaveLength(1);
      expect(events.filter(event => event.kind === 'review_dispatched')).toHaveLength(2);
      expect(result('p4acceptbroken')).toContain('TASK_VERIFIER_NOT_APPROVED');
      expect(result('p4oldreview')).toMatch(/TASK_VERIFIER_(SUBMISSION_CHANGED|RUN_MISSING)/);
      const transcriptPath = join(userDataDir, 'openclaw-source-state', 'agents', 'main', 'sessions', `${project.generation}.jsonl`);
      const transcript = (await readFile(transcriptPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const yields = transcript.filter(entry => entry.type === 'custom_message' && entry.customType === 'openclaw.sessions_yield');
      expect(yields.length).toBeGreaterThanOrEqual(4);
      expect(yields.every(entry => entry.details?.source === 'sessions_yield')).toBe(true);
      expect(transcript.filter(entry => entry.message?.toolName === 'sessions_yield')
        .some(entry => /TASK_EXECUTION_NOT_RUNNING|TASK_REPAIR_REQUIRED/.test(JSON.stringify(entry.message)))).toBe(false);
      evidence.yieldReadback = { transcriptPath, events: yields };
      expect(await readFile(join(root, 'result.txt'), 'utf8')).toBe('repaired result\n');
      expect(llm.log.filter(row => row.issued === 'reviewbrokenread')).toHaveLength(1);
      expect(llm.log.filter(row => row.issued === 'reviewfixedread')).toHaveLength(1);
      evidence.task = store.get(task.contract.taskNodeId); evidence.events = events;
      evidence.receipts = store.getTaskEvidence(task.contract.taskNodeId);
      const db = new DatabaseSync(registryPath, { readOnly: true });
      try { evidence.reviewers = db.prepare("SELECT run_id,child_session_key,requester_session_key,outcome_json,payload_json FROM subagent_runs WHERE requester_session_key=? AND json_extract(payload_json,'$.orchestration.isVerifier')=1").all(project.sessionKey); }
      finally { db.close(); }
      expect(workerRuns).toHaveLength(2);
      expect(workerRuns.every(run => run.record?.orchestration?.worktreeMergeStatus === 'merged')).toBe(true);
      expect(llm.log.filter(row => row.issued === 'p4workerinitialwrite')).toHaveLength(1);
      expect(llm.log.filter(row => row.issued === 'p4workerrepairwrite')).toHaveLength(1);
      evidence.workerRuns = workerRuns;
      evidence.status = 'passed';
    } finally { store.close(); }
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    evidence.providerLog = llm.log; evidence.anomalies = llm.anomalies;
    evidence.workerRuns = workerRuns;
    await writeFile(info.outputPath('closeout-readback.json'), JSON.stringify(evidence, null, 2));
    await captureUi(name => info.outputPath(name));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
