import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';
import type { ElectronApplication } from '@playwright/test';
import { expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

for (const backend of ['inprocess', 'git'] as const) {
  for (const concurrent of [false, true]) {
    test(`TF-0769 ${backend} ${concurrent ? 'rejects concurrent edits' : 'merges deletion and rename'}`, async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
      test.setTimeout(360_000);
      const workspace = join(userDataDir, 'workspace');
      await mkdir(workspace, { recursive: true });
      writeFileSync(join(workspace, 'a.txt'), 'original a');
      writeFileSync(join(workspace, 'b.txt'), 'original b');
      if (backend === 'git') {
        const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, windowsHide: true, stdio: 'pipe' });
        git('init'); git('add', 'a.txt', 'b.txt');
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
      }
      let raceInjected = false;
      const llm = await startScriptedLlm((text, results) => {
        if (!text.includes('S5-MERGE-WORKER')) return { text: 'S5 observer complete.' };
        if (results.s5merge) return { text: 'S5-WORKER-DONE' };
        if (concurrent && !raceInjected) {
          writeFileSync(join(workspace, 'a.txt'), 'concurrent user edit');
          raceInjected = true;
        }
        return { toolCall: { id: 's5merge', name: 'exec', args: {
          command: "node -e \"const f=require('node:fs');f.unlinkSync('a.txt');f.renameSync('b.txt','c.txt')\"",
        } } };
      });
      llm.server.unref();
      const config = buildMockProviderConfig(llm.port, workspace, { coding: { worktree: { backend } } });
      (config.models as { providers: { openai: { models: Array<Record<string, unknown>> } } }).providers.openai.models[0]!.reasoning = true;
      const fullConfig = { ...config, tools: { profile: 'full', exec: { host: 'gateway', security: 'full', ask: 'off' } } };
      for (const dir of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'openclaw.json'), JSON.stringify(fullConfig));
      }
      const evidence: Record<string, unknown> = { schema: 'CodingWorktreeMerge/v1', driven_by: 'agent',
        actor: 'codex-coding-s5', realHumanEvidence: false, provider: 'scripted-local', backend, concurrent, workspace };
      let app: ElectronApplication | undefined;
      try {
        app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
        await getStableWindow(app);
        await hostInvoke(app, 'workspaces', 'create', { name: 'S5 workspace', rootPath: workspace, permissionMode: 'fullAccess' });
        await startGateway(app);
        const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app!, 'gateway', 'rpc', { method, params, timeoutMs: 90_000 });
        const parent = await rpc<{ key: string; entry: { sessionId: string } }>('sessions.create', { agentId: 'main', label: 'S5 parent' });
        const run = await rpc<{ status: string; delegationReceipt: { children: Array<{ childRunId: string; childSessionKey: string; isolation: { canonicalRoot: string } }> } }>('orchestrator.run', {
          task: 'Merge one coding worker', sessionKey: parent.key, agentId: 'main', isolation: 'worktree', includeVerifier: false,
          expectedSessionGeneration: parent.entry.sessionId,
          workers: [{ roleName: 'implementer', task: 'S5-MERGE-WORKER: delete a.txt and rename b.txt to c.txt, then finish.', writeSet: ['a.txt', 'b.txt', 'c.txt'] }],
          delegationAdmission: { receiptId: 's5-e2e', idempotencyKey: 's5-e2e', taskRef: { kind: 'task-ledger', nodeId: 's5' },
            coordinator: { workspaceId: 's5', agentId: 'main', sessionKey: parent.key, sessionId: parent.entry.sessionId, bindingRevision: 1 } },
        });
        evidence.run = run;
        expect(run.status).toBe('accepted');
        const child = run.delegationReceipt.children[0];
        let terminal: { status: string } | undefined;
        for (let n = 0; n < 8; n++) {
          terminal = await rpc('agent.wait', { runId: child.childRunId, timeoutMs: 15_000 });
          if (terminal?.status !== 'timeout') break;
        }
        evidence.terminal = terminal;
        expect(terminal?.status).toBe('ok');
        const registryPath = join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite');
        const readRun = (): SubagentRunRecord | undefined => {
          let db: DatabaseSync | undefined;
          try {
            db = new DatabaseSync(registryPath, { readOnly: true });
            const row = db.prepare('SELECT payload_json FROM subagent_runs WHERE run_id = ?').get(child.childRunId);
            return typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) : undefined;
          }
          catch { return undefined; }
          finally { db?.close(); }
        };
        await expect.poll(() => readRun()?.orchestration?.worktreeMergeStatus, { timeout: 45_000 }).toBe(concurrent ? 'conflict' : 'merged');
        evidence.persistedRun = readRun();
        evidence.parentFiles = { a: existsSync(join(workspace, 'a.txt')) ? readFileSync(join(workspace, 'a.txt'), 'utf8') : null,
          b: existsSync(join(workspace, 'b.txt')) ? readFileSync(join(workspace, 'b.txt'), 'utf8') : null,
          c: existsSync(join(workspace, 'c.txt')) ? readFileSync(join(workspace, 'c.txt'), 'utf8') : null };
        expect(evidence.parentFiles).toEqual(concurrent
          ? { a: 'concurrent user edit', b: 'original b', c: null }
          : { a: null, b: null, c: 'original b' });
        if (!concurrent) expect(readRun()?.orchestration?.worktreeMergeJournalRef).toBeTruthy();
        expect(raceInjected).toBe(concurrent);
        evidence.status = 'pass';
      } finally {
        evidence.providerLog = llm.log;
        evidence.providerAnomalies = llm.anomalies;
        await writeFile(testInfo.outputPath('coding-merge-e2e.json'), JSON.stringify(evidence, null, 2));
        llm.server.closeAllConnections(); llm.server.closeIdleConnections();
        await Promise.race([new Promise<void>((done) => llm.server.close(() => done())), new Promise<void>((done) => setTimeout(done, 2000))]);
      }
    });
  }
}
