import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

// Decisions come from a local scripted provider; Host, Gateway, spawn, tools,
// subprocess cwd, session persistence, and worktree ownership are real owners.
for (const backend of ['inprocess', 'git'] as const) {
  test(`TF-0768 real ${backend} worker stays in the authorized checkout`, async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
    test.setTimeout(360_000);
    const workspace = join(userDataDir, 'workspace');
    await mkdir(workspace, { recursive: true });
    if (backend === 'git') {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, windowsHide: true, stdio: 'pipe' });
      git('init');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
    }
    const llm = await startScriptedLlm((text, results) => {
      if (!text.includes('S4-CHILD-WORKER')) return { text: 'S4 observer complete.' };
      if (results.s4cwd) return { text: 'S4-WORKER-DONE' };
      return { toolCall: { id: 's4cwd', name: 'exec', args: {
        command: 'node -e "require(\'node:fs\').writeFileSync(\'worker-cwd.json\',JSON.stringify({cwd:process.cwd(),marker:\'S4-WORKER\'}))"',
      } } };
    });
    // The provider server is evidence infrastructure owned by this test. It
    // must not keep the Playwright worker alive after the Electron tree exits.
    llm.server.unref();
    const baseConfig = buildMockProviderConfig(llm.port, workspace, { coding: { worktree: { backend } } });
    const openai = (baseConfig.models as { providers: { openai: { models: Array<Record<string, unknown>> } } }).providers.openai;
    openai.models[0]!.reasoning = true;
    const config = {
      ...baseConfig,
      tools: { profile: 'full', exec: { host: 'gateway', security: 'full', ask: 'off' } },
    };
    for (const dir of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'openclaw.json'), JSON.stringify(config));
    }
    let app: ElectronApplication | undefined;
    const evidence: Record<string, unknown> = {
      schema: 'CodingIsolationE2E/v1', driven_by: 'agent', actor: 'codex-coding-s4',
      realHumanEvidence: false, provider: 'scripted-local', backend, workspace,
    };
    try {
      app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
      await getStableWindow(app);
      await hostInvoke(app, 'workspaces', 'create', { name: 'S4 workspace', rootPath: workspace, permissionMode: 'fullAccess' });
      await startGateway(app);
      const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app!, 'gateway', 'rpc', { method, params, timeoutMs: 90_000 });
      const parent = await rpc<{ key: string; entry: { sessionId: string } }>('sessions.create', { agentId: 'main', label: 'S4 parent' });
      const request = {
        task: 'Exercise one isolated coding worker', sessionKey: parent.key, agentId: 'main',
        isolation: 'worktree', includeVerifier: false, expectedSessionGeneration: parent.entry.sessionId,
        workers: [{ roleName: 'implementer', task: 'S4-CHILD-WORKER: record the current working directory and finish.' }],
        delegationAdmission: {
          receiptId: 's4-e2e', idempotencyKey: 's4-e2e', taskRef: { kind: 'task-ledger', nodeId: 's4-fixture' },
          coordinator: { workspaceId: 's4-fixture', agentId: 'main', sessionKey: parent.key, sessionId: parent.entry.sessionId, bindingRevision: 1 },
        },
      };
      const plan = await rpc<{ plan: { isolation: string; workers: Array<{ isolation: string }> } }>('orchestrator.plan', request);
      expect(plan.plan.isolation).toBe('worktree');
      expect(plan.plan.workers[0]?.isolation).toBe('worktree');
      const run = await rpc<{ status: string; delegationReceipt: { children: Array<{
        childSessionKey: string; childRunId: string;
        isolation: { mode: string; backend: string; canonicalRoot: string; verifiedCheckout: boolean };
      }> } }>('orchestrator.run', request);
      evidence.run = run;
      expect(run.status).toBe('accepted');
      const child = run.delegationReceipt.children[0];
      expect(child.isolation).toMatchObject({ mode: 'worktree',
        backend: backend === 'git' ? 'git-worktree' : 'inprocess-worktree', verifiedCheckout: backend === 'git' });
      const childRoot = child.isolation.canonicalRoot;
      expect(childRoot).not.toBe(workspace);
      const persisted = await rpc<{ entry: { spawnedWorkspaceDir?: string; spawnedCwd?: string; spawnedBy?: string } }>('sessions.patch', { key: child.childSessionKey });
      evidence.persisted = persisted.entry;
      expect(resolve(persisted.entry.spawnedWorkspaceDir!)).toBe(resolve(childRoot));
      expect(resolve(persisted.entry.spawnedCwd!)).toBe(resolve(childRoot));
      const waits: Array<{ status: string; error?: unknown }> = [];
      evidence.childWaits = waits;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const terminal = await rpc<{ status: string; error?: unknown }>('agent.wait', { runId: child.childRunId, timeoutMs: 15_000 });
        waits.push(terminal);
        if (terminal.status !== 'timeout') break;
      }
      evidence.childHistory = await rpc('sessions.get', { key: child.childSessionKey, limit: 20 });
      expect(waits.at(-1)?.status, JSON.stringify(waits)).toBe('ok');
      expect(llm.log.some((entry) => entry.issued === 's4cwd')).toBe(true);
      expect(existsSync(join(childRoot, 'worker-cwd.json'))).toBe(true);
      const actual = JSON.parse(await readFile(join(childRoot, 'worker-cwd.json'), 'utf8'));
      expect(resolve(actual.cwd)).toBe(resolve(childRoot));
      expect(actual.marker).toBe('S4-WORKER');
      expect(existsSync(join(workspace, 'worker-cwd.json'))).toBe(false);
      evidence.actualWorker = actual;
      await expect(rpc('orchestrator.run', { ...request, expectedSessionGeneration: 'old-generation' })).rejects.toThrow(/generation/);
      await expect(rpc('orchestrator.run', { ...request, workspaceDir: userDataDir })).rejects.toThrow(/workspace/);
      evidence.status = 'pass';
    } finally {
      evidence.providerLog = llm.log;
      evidence.providerAnomalies = llm.anomalies;
      await writeFile(testInfo.outputPath('coding-isolation-e2e.json'), JSON.stringify(evidence, null, 2));
      llm.server.closeAllConnections();
      llm.server.closeIdleConnections();
      await Promise.race([
        new Promise<void>((resolveClose) => llm.server.close(() => resolveClose())),
        new Promise<void>((resolveClose) => setTimeout(resolveClose, 2_000)),
      ]);
    }
  });
}
