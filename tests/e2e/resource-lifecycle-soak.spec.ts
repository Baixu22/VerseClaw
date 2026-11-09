import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import type { Page } from '@playwright/test';
import { ProcessTreeSampler } from '../../openclaw_runtime/src/process/process-tree-sampler';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { checkWindowsProcesses, type WindowsProcessIdentity } from './fixtures/windows-process';

const smoke = process.env.RESOURCE_SOAK_SMOKE === '1';
const plan = { cycles: smoke ? 3 : 50, idleMs: smoke ? 0 : 300_000, recoveryMs: smoke ? 0 : 300_000, soakMs: smoke ? 0 : 1_800_000, sampleMs: 30_000, probeMs: 300_000 };
async function invoke(page: Page, module: string, action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return page.evaluate(async request => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), ...request }) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
    if (!result.ok) throw new Error(result.error?.message ?? 'Host request failed');
    return result.data;
  }, { module, action, payload });
}

test('repeated lifecycle, real idle recovery and separate sustained observation', async ({ launchElectronApp, homeDir }, testInfo) => {
  const root = join(homeDir, 'lifecycle'); await mkdir(root, { recursive: true });
  const script = join(root, 'tree.cjs');
  await writeFile(script, `const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[2],JSON.stringify({root:process.pid,child:child.pid}));setInterval(()=>{},1000);`);
  const app = await launchElectronApp({ skipSetup: true });
  const report: Record<string, unknown> = { driven_by: 'agent', actor: 'codex', smoke, plan, accountKey: `workspaceExec:${root}`, candidate: process.env.RESOURCE_SOAK_SOURCE, status: 'running', segments: [], cycles: [], observations: [], unknown: [] };
  const cycles = report.cycles as Array<Record<string, unknown>>;
  const observations = report.observations as Array<Record<string, unknown>>;
  const segments = report.segments as Array<Record<string, unknown>>;
  const save = () => writeFile(testInfo.outputPath('lifecycle.json'), JSON.stringify(report, null, 2));
  const sampler = new ProcessTreeSampler();
  let page: Page | undefined;
  let terminalId: string | undefined;
  let observerId: number | undefined;
  let ownedIdentities: WindowsProcessIdentity[] = [];
  let scope: { workspaceId: string; sessionKey: string } | undefined;
  try {
    await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true }, gatewayRpcByMethod: { 'sessions.list': { sessions: [] }, 'chat.history': { messages: [] }, '*': {} },
      hostApi: { '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main' }] } } });
    page = await getStableWindow(app);
    const created = await invoke(page, 'workspaces', 'create', { rootPath: root, name: 'Resource lifecycle', agentId: 'main', activeSessionKey: 'agent:main:lifecycle-soak', permissionMode: 'fullAccess' });
    const workspace = created.activeWorkspace as { id: string; activeSessionKey: string };
    scope = { workspaceId: workspace.id, sessionKey: workspace.activeSessionKey };
    await page.reload(); await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    const mainPid = await app.evaluate(() => process.pid);
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const snapshot = async (stage: string) => {
      const at = Date.now();
      const processTree = await sampler.sample({ rootPids: [mainPid] });
      let handles: unknown = null;
      try {
        const pids = processTree.processes?.map(p => p.pid) ?? [];
        if (pids.length) {
          const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ids=@($env:SOAK_PIDS.Split(",")|ForEach-Object{[int]$_}); @(Get-CimInstance Win32_Process|Where-Object{$ids -contains $_.ProcessId}|ForEach-Object{[pscustomobject]@{pid=$_.ProcessId;token=$_.CreationDate.ToFileTimeUtc().ToString();handles=$_.HandleCount}})|ConvertTo-Json -Compress'], { env: { ...process.env, SOAK_PIDS: pids.join(',') }, windowsHide: true, timeout: 20_000 });
          const rows = JSON.parse(stdout) as Array<{ pid: number; token: string; handles: number }>;
          const valid = rows.filter(row => processTree.processes?.some(p => p.pid === row.pid && p.creationToken === row.token));
          handles = { status: valid.length === pids.length ? 'ok' : 'partial', rows: valid, total: valid.reduce((n, row) => n + row.handles, 0) };
        }
      } catch (error) { (report.unknown as unknown[]).push({ stage, metric: 'handles', error: String(error) }); }
      const readOwner = () => app.evaluate(({ BrowserWindow }) => {
        const state = globalThis as Record<symbol, unknown>;
        const fabric = state[Symbol.for('openclaw.resourceFabric')] as { getDiagnostics(): unknown };
        const watcher = state[Symbol.for('openclaw.watcherHub')] as { getDiagnostics(): unknown } | undefined;
        return { memory: process.memoryUsage(), windows: BrowserWindow.getAllWindows().length, fabric: fabric.getDiagnostics(), watchers: watcher?.getDiagnostics() ?? null };
      });
      let owner: Awaited<ReturnType<typeof readOwner>>;
      for (let attempt = 1; ; attempt++) {
        try { owner = await readOwner(); break; }
        catch (error) {
          (report.unknown as unknown[]).push({ stage, metric: 'main-owner', attempt, at: Date.now(), error: String(error) }); await save();
          // Playwright rewrites non-JS inspector errors as context-destroyed.
          // Retry only this read; never replay lifecycle mutations.
          if (attempt >= 3 || !String(error).includes('Execution context was destroyed')) throw error;
          await new Promise(done => setTimeout(done, 250));
        }
      }
      const terminals = await invoke(page!, 'terminal', 'list', scope);
      const metrics = await cdp.send('Performance.getMetrics');
      const rendererHeap = metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
      const row = { at, sampledAt: Date.now(), stage, processTree, handles, owner, terminals, rendererHeap };
      observations.push(row); await save(); return row;
    };
    const cycle = async (index: number, stage: string) => {
      const at = Date.now(); const receiptPath = join(root, `pids-${stage}-${index}.json`);
      const record: Record<string, unknown> = { index, stage, startedAt: at, status: 'running' }; cycles.push(record); await save();
      const expectedSessionId = `lifecycle-${stage}-${index}`;
      const opened = await invoke(page!, 'terminal', 'open', { ...scope, expectedSessionId, command: `"${process.execPath}" "${script}" "${receiptPath}"`, keepOnLeave: true });
      expect(opened.success).toBe(true); terminalId = String(opened.sessionId); record.terminalId = terminalId;
      expect(opened.expectedSessionId).toBe(expectedSessionId);
      record.expectedSessionId = expectedSessionId;
      await expect(invoke(page!, 'terminal', 'write', { ...scope, sessionId: terminalId, expectedSessionId: 'stale-generation', data: 'forbidden' })).rejects.toThrow(/scope|generation/i);
      record.staleGenerationRejected = true;
      let receipt: { root: number; child: number } | undefined;
      await expect.poll(async () => { try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); return true; } catch { return false; } }, { timeout: 15_000 }).toBe(true);
      record.receipt = receipt;
      let terminalPid: number | undefined;
      await expect.poll(async () => {
        const state = await invoke(page!, 'terminal', 'status', { ...scope, sessionId: terminalId });
        terminalPid = typeof state.pid === 'number' ? state.pid : undefined;
        return terminalPid !== undefined;
      }, { timeout: 15_000 }).toBe(true);
      record.terminalPid = terminalPid;
      const tree = await sampler.sample({ rootPids: [terminalPid!, receipt!.root] });
      record.createdTree = tree; expect(tree.status).toBe('ok'); expect(tree.processes?.some(p => p.pid === receipt!.child)).toBe(true);
      const identities: WindowsProcessIdentity[] = tree.processes!.map(p => ({ pid: p.pid, creationTime: Number(BigInt(p.creationToken) / 10_000n - 11_644_473_600_000n) }));
      ownedIdentities = identities;
      observerId = await app.evaluate(async () => {
        const entries = Object.values(process.mainModule!.require('node:module')._cache) as Array<{ exports: { createHostReadObserverWindow?: () => Promise<Electron.BrowserWindow> } }>;
        const factory = entries.find(entry => typeof entry.exports?.createHostReadObserverWindow === 'function');
        if (!factory) throw new Error('Observer factory missing');
        return (await factory.exports.createHostReadObserverWindow!()).id;
      });
      record.observerId = observerId;
      record.observerClose = await app.evaluate(async ({ BrowserWindow }, data) => {
        const fabric = (globalThis as Record<symbol, unknown>)[Symbol.for('openclaw.resourceFabric')] as { runResource(resource: string, key: string, options: Record<string, unknown>, work: () => Promise<void>): Promise<void> };
        await fabric.runResource('workspaceExec', data.key, { phase: 'read', operationKey: 'lifecycle-probe' }, async () => {});
        const window = BrowserWindow.fromId(data.id); if (!window) throw new Error('Observer disappeared');
        const closed = new Promise<void>(done => window.once('closed', () => done())); window.close(); await closed;
        return { id: data.id, closedAt: Date.now(), destroyed: window.isDestroyed() };
      }, { id: observerId, key: root });
      // Compare ordering on the test process clock; Electron's Date.now can
      // differ by a millisecond even after its close receipt is delivered.
      record.observerCloseReceivedAt = Date.now();
      observerId = undefined;
      const cancelledAt = Date.now(); const started = performance.now();
      record.closeReceipt = await invoke(page!, 'terminal', 'close', { ...scope, sessionId: terminalId, expectedSessionId });
      record.closeMs = performance.now() - started; record.cancelledAt = cancelledAt;
      let exits: Awaited<ReturnType<typeof checkWindowsProcesses>>;
      const exitProbeErrors: Array<{ at: number; error: string }> = []; record.exitProbeErrors = exitProbeErrors;
      for (let attempt = 1; ; attempt++) {
        try { exits = await checkWindowsProcesses(identities); break; }
        catch (error) {
          exitProbeErrors.push({ at: Date.now(), error: String(error) }); await save();
          // The execution owner already returned its terminal receipt. Retry
          // only the identity observation; never resend kill or release capacity.
          if (attempt >= 3) throw error;
          await new Promise(done => setTimeout(done, 250));
        }
      }
      record.exits = exits;
      expect(exits.every(row => ['exited', 'replaced', 'terminated'].includes(row.status))).toBe(true);
      terminalId = undefined; ownedIdentities = [];
      record.exitObservedAt = Date.now(); record.cancelToExitMs = Number(record.exitObservedAt) - cancelledAt;
      const remaining = await invoke(page!, 'terminal', 'list', scope); record.remainingTerminals = remaining.sessions;
      expect(remaining.sessions).toEqual([]);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      record.status = 'pass'; record.endedAt = Date.now(); await save();
      console.log(`lifecycle ${stage} ${index} pass`);
    };
    const idle = async (name: string, durationMs: number, probes = false) => {
      const start = Date.now(); const segment = { name, start, minimumMs: durationMs, end: 0, elapsedMs: 0 }; segments.push(segment); await snapshot(name + ':start');
      let nextProbe = start + plan.probeMs; let probesRun = 0;
      while (Date.now() - start < durationMs) {
        await new Promise(done => setTimeout(done, Math.min(plan.sampleMs, durationMs - (Date.now() - start))));
        if (probes && Date.now() >= nextProbe && Date.now() - start < durationMs) { await cycle(++probesRun, 'soak'); nextProbe += plan.probeMs; }
        await snapshot(name + ':sample');
      }
      segment.end = Date.now(); segment.elapsedMs = segment.end - start; await snapshot(name + ':end'); await save();
    };
    await cycle(0, 'warmup'); await snapshot('warmup-complete');
    await idle('idle-before', plan.idleMs);
    for (let i = 1; i <= plan.cycles; i++) { await cycle(i, 'repeat'); if (i % 5 === 0 || i === plan.cycles) await snapshot('repeat-' + i); }
    await idle('idle-recovery', plan.recoveryMs);
    const recovered = await snapshot('recovered');
    const fabric = recovered.owner.fabric as { accounts: Record<string, { active: number; queued: number }> };
    expect(Object.values(fabric.accounts).every(account => account.active === 0 && account.queued === 0)).toBe(true);
    if (!smoke) {
      // Wait for the existing observation cadence after the real idle TTL;
      // do not invoke collection or change the production retention interval.
      await expect.poll(async () => app.evaluate((_electron, key) => {
        const owner = (globalThis as Record<symbol, unknown>)[Symbol.for('openclaw.resourceFabric')] as { getDiagnostics(): { accounts: Record<string, unknown> } };
        return key in owner.getDiagnostics().accounts;
      }, String(report.accountKey)), { timeout: 35_000 }).toBe(false);
      await snapshot('cold-account-collected');
    }
    await idle('sustained-observation', plan.soakMs, true);
    await snapshot('final');
    await page.screenshot({ path: testInfo.outputPath('lifecycle-final.png') });
    await cdp.detach(); report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = String(error); throw error; }
  finally {
    await save();
    if (page && terminalId) try { report.pendingTerminalClose = await invoke(page, 'terminal', 'close', { ...scope, sessionId: terminalId }); } catch (error) { report.pendingTerminalError = String(error); }
    if (observerId) try { await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), observerId); } catch (error) { report.observerCleanupError = String(error); }
    if (ownedIdentities.length) try { report.pendingOwnedCleanup = await checkWindowsProcesses(ownedIdentities, true); }
    catch (error) { report.pendingOwnedCleanupError = String(error); }
    try { report.cleanup = await closeElectronApp(app); } finally { await save(); }
  }
});
