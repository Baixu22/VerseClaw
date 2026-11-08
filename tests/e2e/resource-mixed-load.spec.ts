import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { ProcessTreeSampler } from '../../openclaw_runtime/src/process/process-tree-sampler';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const fixturePath = resolve(__dirname, '../../harness/specs/fixtures/resource-mixed-load-20261108/workload.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  id: string; tasks: number; phases: string[]; historyMessages: number; streamEvents: number; streamIntervalMs: number;
  remoteDelayMs: number; corpusLines: number; buildModules: number; logBytes: number; retainedPressureBytes: number;
  keyboardText: string; scrolls: number; scrollDelta: number; scrollIntervalMs: number;
};
const workers = Number(process.env.RESOURCE_MIXED_WORKERS ?? '1');
const windows = Number(process.env.RESOURCE_MIXED_WINDOWS ?? '1');
const sessionKey = 'agent:main:main';
type RendererProbe = { recording: boolean; inputLatencies: number[]; inputEvents: Array<{ at: number; durationMs: number; target: string | null }>; scrollEvents: Array<{ at: number; durationMs: number; top: number }>; longTasks: number[]; longTaskEvents: Array<{ at: number; durationMs: number }> };

async function invoke(page: Page, module: string, action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return page.evaluate(async request => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), ...request }) as { ok: boolean; data: Record<string, unknown>; error?: { message: string } };
    if (!result.ok) throw new Error(result.error?.message ?? 'Host request failed');
    return result.data;
  }, { module, action, payload });
}

async function processSnapshot(sampler: ProcessTreeSampler, pid: number) {
  const tree = await sampler.sample({ rootPids: [pid] });
  const pids = tree.processes?.map(row => row.pid) ?? [];
  let handles: unknown = { status: 'unavailable', reason: 'platform' };
  if (process.platform === 'win32' && pids.length) {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ids=@($env:RESOURCE_MIXED_PIDS.Split(",") | ForEach-Object {[int]$_}); @(Get-CimInstance Win32_Process | Where-Object {$ids -contains $_.ProcessId} | ForEach-Object {[pscustomobject]@{pid=$_.ProcessId;token=$_.CreationDate.ToFileTimeUtc().ToString();handles=$_.HandleCount}}) | ConvertTo-Json -Compress'],
    { env: { ...process.env, RESOURCE_MIXED_PIDS: pids.join(',') }, windowsHide: true, timeout: 20_000 });
    const rows = JSON.parse(stdout) as Array<{ pid: number; token: string; handles: number }>;
    const matched = rows.filter(row => tree.processes?.some(p => p.pid === row.pid && p.creationToken === row.token));
    handles = { status: matched.length === pids.length ? 'ok' : 'partial', rows: matched, total: matched.reduce((n, row) => n + row.handles, 0) };
  }
  return { tree, handles };
}

test('frozen mixed work retains completion, keyboard and scrolling', async ({ launchElectronApp, homeDir }, testInfo) => {
  expect([1, 4, 8]).toContain(workers); expect([1, 2]).toContain(windows);
  const root = join(homeDir, 'mixed-work'); await mkdir(root, { recursive: true });
  const corpus = Array.from({ length: fixture.corpusLines }, (_, i) => `${i}: ${i % 17 === 0 ? 'NEEDLE' : 'ordinary'} ${'content '.repeat(20)}`).join('\n');
  const corpusPath = join(root, 'corpus.txt'); await writeFile(corpusPath, corpus);
  for (let i = 0; i < fixture.buildModules; i++) await writeFile(join(root, `m${i}.ts`), `export const value${i}: string = ${JSON.stringify(`module-${i}-` + 'value '.repeat(512))};\n`);
  const entry = Array.from({ length: fixture.buildModules }, (_, i) => `import {value${i}} from './m${i}';`).join('\n') + `\nconsole.log([${Array.from({ length: fixture.buildModules }, (_, i) => `value${i}`).join(',')}].join(''));`;
  await writeFile(join(root, 'main.ts'), entry);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, windowsHide: true });
  const esbuild = createRequire(__filename).resolve('esbuild');
  const buildScript = join(root, 'build.cjs');
  await writeFile(buildScript, `
    const cp=require('node:child_process'), nativeSpawn=cp.spawn, services=[], exits=[];
    const keepAlive=setInterval(()=>{},1000);
    cp.spawn=(...args)=>{const child=nativeSpawn(...args), row={pid:child.pid,closed:false,code:null,signal:null};services.push(row);
      exits.push(new Promise(resolve=>child.once('close',(code,signal)=>{Object.assign(row,{closed:true,code,signal});resolve();})));return child;};
    (async()=>{const compiler=require(${JSON.stringify(esbuild)});const result=await compiler.build({entryPoints:[${JSON.stringify(join(root, 'main.ts'))}],bundle:true,platform:'node',write:false,minify:true});
      const digest=require('node:crypto').createHash('sha256').update(result.outputFiles[0].contents).digest('hex');compiler.stop();await Promise.all(exits);
      process.stdout.write(JSON.stringify({digest,services}));})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearInterval(keepAlive));
  `);
  const expectedBuild = (JSON.parse(execFileSync(process.execPath, [buildScript], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })) as { digest: string }).digest;
  const expectedCorpus = createHash('sha256').update(corpus).digest('hex');
  const server = createServer((request, response) => {
    if (request.url === '/wait') setTimeout(() => response.end('remote-receipt'), fixture.remoteDelayMs);
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Mixed work observer</title><input aria-label="Observer input"><main style="height:4000px">Agent-driven resource workload</main>'); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('HTTP fixture unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  const history = Array.from({ length: fixture.historyMessages / 2 }, (_, i) => [
    { id: `u-${i}`, role: 'user', content: `Historical request ${i}`, timestamp: 1700000000000 + i * 1000 },
    { id: `a-${i}`, role: 'assistant', content: `Historical reply ${i}\n\n${'Completed paragraph with **markdown** and code.\n'.repeat(5)}`, timestamp: 1700000000500 + i * 1000 },
  ]).flat();
  const runId = 'mixed-load';
  const finalText = Array.from({ length: fixture.streamEvents }, (_, i) => `word${String(i + 1).padStart(3, '0')} `).join('');
  const app = await launchElectronApp({ skipSetup: true });
  const report: Record<string, unknown> = { driven_by: 'agent', actor: 'codex', fixtureId: fixture.id, fixtureSha256: createHash('sha256').update(await readFile(fixturePath)).digest('hex'),
    workers, windows, variant: process.env.RESOURCE_MIXED_VARIANT, sourceCommit: process.env.RESOURCE_MIXED_SOURCE, status: 'running',
    expected: { build: expectedBuild, corpus: expectedCorpus, retrieval: Math.ceil(fixture.corpusLines / 17), logBytes: fixture.logBytes },
    semantics: 'Scripted agent workers on the actual Main Fabric; real file/search/git/log/esbuild work; local HTTP wait; frozen chat history/stream; 128MiB controlled retained memory.' };
  let pageForCleanup: Page | undefined;
  try {
    const rpcFixture = { gatewayStatus: { state: 'running', gatewayReady: true },
      gatewayRpcByMethod: { 'sessions.list': { sessions: [{ key: sessionKey, displayName: 'Mixed work' }] }, 'chat.history': { messages: history }, 'chat.send': { runId }, '*': {} },
      hostApi: {
        [JSON.stringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'Main' }] },
        [JSON.stringify(['providers', 'accounts', null])]: [{ id: 'fixture', vendorId: 'anthropic', label: 'Fixture', authMode: 'api_key', model: 'fixture-model', enabled: true, isDefault: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
        [JSON.stringify(['providers', 'accountKeyInfo', null])]: [{ accountId: 'fixture', hasKey: true, keyMasked: 'fixture' }],
        [JSON.stringify(['providers', 'vendors', null])]: [],
        [JSON.stringify(['providers', 'getDefaultAccount', null])]: { accountId: 'fixture' },
        [JSON.stringify(['chat', 'sendWithMedia', null])]: { success: true, result: { runId } },
      } };
    await installIpcMocks(app, rpcFixture);
    const page = await getStableWindow(app);
    pageForCleanup = page;
    await page.addInitScript(() => {
      const probe: RendererProbe = { recording: false, inputLatencies: [], inputEvents: [], scrollEvents: [], longTasks: [], longTaskEvents: [] };
      (window as unknown as { __mixedProbe: RendererProbe }).__mixedProbe = probe;
      new PerformanceObserver(list => {
        if (probe.recording) for (const entry of list.getEntries()) { probe.longTasks.push(entry.duration); probe.longTaskEvents.push({ at: performance.timeOrigin + entry.startTime, durationMs: entry.duration }); }
      }).observe({ type: 'longtask', buffered: true });
      window.addEventListener('keydown', event => {
        if (!probe.recording) return; const start = event.timeStamp; const at = performance.timeOrigin + start;
        const target = event.target instanceof Element ? event.target.getAttribute('data-testid') : null;
        requestAnimationFrame(() => { const durationMs = performance.now() - start; probe.inputLatencies.push(durationMs); probe.inputEvents.push({ at, durationMs, target }); });
      }, true);
      document.addEventListener('wheel', event => {
        const target = event.target instanceof Element ? event.target.closest('[data-testid="chat-scroll-container"]') : null;
        if (!probe.recording || !target) return;
        const start = event.timeStamp; const at = performance.timeOrigin + start;
        requestAnimationFrame(() => probe.scrollEvents.push({ at, durationMs: performance.now() - start, top: target.scrollTop }));
      }, { capture: true, passive: true });
    });
    await invoke(page, 'workspaces', 'create', { rootPath: root, name: 'Mixed workload', agentId: 'main', activeSessionKey: sessionKey, permissionMode: 'readOnly' });
    await page.reload();
    const input = page.getByTestId('chat-composer-input'); await expect(input).toBeEnabled({ timeout: 40_000 });
    await expect(page.getByText('Historical reply 99', { exact: false })).toBeAttached();
    if (windows === 2) {
      await app.evaluate((_electron, data) => {
        const modules = Object.values(process.mainModule!.require('node:module')._cache) as Array<{ exports: { approveBrowserPrivateNetwork?: (input: { sessionId: string; origin: string }) => unknown } }>;
        const owner = modules.find(module => typeof module.exports?.approveBrowserPrivateNetwork === 'function');
        if (!owner) throw new Error('Browser approval owner missing');
        return owner.exports.approveBrowserPrivateNetwork!(data);
      }, { sessionId: sessionKey, origin });
      const opened = await invoke(page, 'agentBrowser', 'open', { sessionKey, url: origin, mode: 'visible', profile: 'mixed-load' });
      expect(opened.success).toBe(true);
    }
    const observedWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length);
    expect(observedWindows).toBe(windows);
    const pid = await app.evaluate(() => process.pid); const sampler = new ProcessTreeSampler();
    report.processBefore = await processSnapshot(sampler, pid);
    await page.bringToFront();
    await input.fill('Start measured mixed work'); await page.getByTestId('chat-composer-send').click();
    const measuredUser = { id: 'mixed-user', role: 'user', content: 'Start measured mixed work', timestamp: Date.now() };
    // A history refresh must reflect the send already accepted by the simulated
    // backend. Returning the pre-send transcript can replace the active view.
    await installIpcMocks(app, { ...rpcFixture, gatewayRpcByMethod: { ...rpcFixture.gatewayRpcByMethod, 'chat.history': { messages: [...history, measuredUser] } } });
    await expect(input).toHaveValue('');
    const scroll = page.getByTestId('chat-scroll-container');
    const bounds = await scroll.boundingBox(); if (!bounds) throw new Error('Missing scroller bounds');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await input.focus();
    await expect(input).toBeFocused();
    report.focusBeforeTyping = await input.evaluate(element => ({ attached: true, focused: document.activeElement === element, value: (element as HTMLTextAreaElement).value }));
    await page.evaluate(() => { (window as unknown as { __mixedProbe: RendererProbe }).__mixedProbe.recording = true; });
    const admittedWork = await app.evaluate(async ({ app: electronApp, BrowserWindow }, data) => {
      const nodeRequire = process.mainModule!.require.bind(process.mainModule);
      const fs = nodeRequire('node:fs/promises') as typeof import('node:fs/promises');
      const { spawn } = nodeRequire('node:child_process') as typeof import('node:child_process');
      const { createHash } = nodeRequire('node:crypto') as typeof import('node:crypto');
      const { performance } = nodeRequire('node:perf_hooks') as typeof import('node:perf_hooks');
      type Account = { active: number; queued: number; limit: number };
      type Owner = { runResource<T>(resource: string, key: string, options: Record<string, unknown>, work: (lease: { queuedMs: number }) => Promise<T>): Promise<T>; getDiagnostics(): { accounts: Record<string, Account>; fair: boolean } };
      const fabric = (globalThis as Record<symbol, unknown>)[Symbol.for('openclaw.resourceFabric')] as Owner;
      if (!fabric) throw new Error('Main ResourceFabric owner missing');
      const pressure = Buffer.alloc(data.fixture.retainedPressureBytes, 1);
      const events: Array<Record<string, unknown>> = [], samples: Array<Record<string, unknown>> = [];
      (globalThis as Record<string, unknown>).__mixedWorkRaw = { events, samples };
      let ownedChildren = 0, exitedChildren = 0;
      const child = async (file: string, args: string[]): Promise<Buffer> => {
        ownedChildren++;
        return new Promise((done, reject) => {
          const proc = spawn(file, args, { cwd: data.root, windowsHide: true, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
          const chunks: Buffer[] = []; let error = '';
          proc.stdout.on('data', part => chunks.push(Buffer.from(part))); proc.stderr.on('data', part => { error += String(part); });
          proc.once('error', reject);
          proc.once('close', code => { exitedChildren++; if (code === 0) done(Buffer.concat(chunks)); else reject(new Error(`Child exit ${code}: ${error}`)); });
        });
      };
      const sample = () => samples.push({ at: Date.now(), memory: process.memoryUsage(), metrics: electronApp.getAppMetrics(), accounts: fabric.getDiagnostics() });
      const cpu = process.cpuUsage(); const started = performance.now(); const startedAt = Date.now();
      const timer = setInterval(sample, 250); sample();
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', { sessionKey: data.sessionKey, runId: data.runId, type: 'run.started', seq: 0, startedAt: Date.now() });
      const stream = new Promise<void>(done => {
        let index = 0;
        const interval = setInterval(() => {
          index++;
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', { sessionKey: data.sessionKey, runId: data.runId, type: 'assistant.delta', seq: index, delta: `word${String(index).padStart(3, '0')} ` });
          if (index === data.fixture.streamEvents) { clearInterval(interval); done(); }
        }, data.fixture.streamIntervalMs);
      });
      const runningWork = (async () => { try {
        await Promise.all(Array.from({ length: data.workers }, async (_, worker) => {
          for (let id = worker; id < data.fixture.tasks; id += data.workers) {
            const kind = data.fixture.phases[id % data.fixture.phases.length]; const requested = performance.now();
            const phase = kind === 'remote-wait' ? 'remote-wait' : ['read', 'retrieval', 'git'].includes(kind) ? 'read' : 'execution';
            await fabric.runResource('workspaceExec', data.root, { phase, tenant: `agent-${worker}`, qos: 'interactive', timeoutMs: 60_000 }, async lease => {
              const admitted = performance.now(); let receipt: unknown;
              if (kind === 'remote-wait') { receipt = await (await fetch(data.origin + '/wait')).text(); if (receipt !== 'remote-receipt') throw new Error('Wait receipt mismatch'); }
              else if (kind === 'read' || kind === 'retrieval') {
                const content = await fs.readFile(data.corpusPath);
                if (kind === 'read') { receipt = createHash('sha256').update(content).digest('hex'); if (receipt !== data.expectedCorpus) throw new Error('Read digest mismatch'); }
                else { receipt = (content.toString().match(/NEEDLE/g) ?? []).length; if (receipt !== Math.ceil(data.fixture.corpusLines / 17)) throw new Error('Search result mismatch'); }
              } else if (kind === 'git') {
                receipt = (await child('git', ['status', '--porcelain', '--untracked-files=all'])).toString(); if (!String(receipt).includes('corpus.txt')) throw new Error('Git receipt missing corpus');
              } else if (kind === 'log') {
                const output = await child(data.nodePath, ['-e', `process.stdout.write('L'.repeat(${data.fixture.logBytes}))`]);
                if (output.length !== data.fixture.logBytes || output.some(byte => byte !== 76)) throw new Error('Log receipt mismatch'); receipt = output.length;
              } else if (kind === 'build') {
                const build = JSON.parse((await child(data.nodePath, [data.buildScript])).toString()) as { digest: string; services: Array<{ pid: number; closed: boolean }> };
                receipt = build;
                if (build.digest !== data.expectedBuild || !build.services.length || build.services.some(service => !service.closed)) throw new Error('Build receipt or service exit mismatch');
              } else throw new Error('Unknown workload phase');
              events.push({ id, worker, kind, phase, queuedMs: lease.queuedMs, serviceMs: performance.now() - admitted, totalMs: performance.now() - requested, receipt, receiptVerified: true, status: 'success' });
            }).catch(error => { events.push({ id, worker, kind, phase, status: 'failed', error: String(error), totalMs: performance.now() - requested, receiptVerified: false }); });
          }
        }));
        const elapsedMs = performance.now() - started; const endedAt = Date.now();
        const cpuDelta = process.cpuUsage(cpu); clearInterval(timer);
        const diagnostics = fabric.getDiagnostics(); const account = diagnostics.accounts[`workspaceExec:${data.root}`];
        const result = { events, samples, elapsedMs, startedAt, endedAt, ownedChildren, exitedChildren, cpu: cpuDelta, active: account.active, queued: account.queued, fair: diagnostics.fair, pressureBytes: pressure.length };
        (globalThis as Record<string, unknown>).__mixedWorkRaw = result;
        await stream; return result;
      } finally { clearInterval(timer); await stream; } })();
      // Return only the start receipt; renderer interaction must not wait for
      // either the workload result or a slow first stream render.
      (globalThis as Record<string, unknown>).__mixedWorkPromise = runningWork;
      void runningWork.catch(() => {});
      return { startedAt };
    }, { fixture, workers, root, nodePath: process.execPath, corpusPath, expectedCorpus, expectedBuild, buildScript, origin, sessionKey, runId });
    report.workStartedAt = admittedWork.startedAt;
    const running = app.evaluate(async () => await (globalThis as Record<string, unknown>).__mixedWorkPromise as { events: Array<Record<string, unknown>>; endedAt: number });
    // Observe errors immediately while interacting with the renderer.
    const outcome = running.then(value => { report.work = value; return { value }; }, error => { report.workError = String(error); return { error: String(error) }; });
    const inputStartedAt = Date.now();
    // Wheel events do not steal the composer's focus; measure both native input
    // paths concurrently so short workloads still contain both interactions.
    const typing = page.keyboard.type(fixture.keyboardText, { delay: 8 });
    for (let i = 0; i < fixture.scrolls; i++) {
      await page.mouse.wheel(0, i < fixture.scrolls / 2 ? -fixture.scrollDelta : fixture.scrollDelta);
      await new Promise(done => setTimeout(done, fixture.scrollIntervalMs));
    }
    await typing;
    const work = await outcome; if ('error' in work) throw new Error(work.error); report.work = work.value;
    const samples = await page.evaluate(() => { const probe = (window as unknown as { __mixedProbe: RendererProbe }).__mixedProbe; probe.recording = false; return probe; });
    const scrolls = samples.scrollEvents;
    report.renderer = { inputStartedAt, scrolls, samples };
    expect(samples.inputEvents.every(event => event.target === 'chat-composer-input')).toBe(true);
    await expect(input).toHaveValue(fixture.keyboardText);
    expect(work.value.events.every(event => event.status === 'success')).toBe(true);
    expect(inputStartedAt).toBeLessThan(work.value.endedAt);
    expect(scrolls[0].at).toBeLessThan(work.value.endedAt);
    await expect(page.getByText('word240', { exact: false })).toBeAttached();
    expect((await page.getByText('word240', { exact: false }).last().innerText()).trim()).toBe(finalText.trim());
    await installIpcMocks(app, { ...rpcFixture, gatewayRpcByMethod: { ...rpcFixture.gatewayRpcByMethod, 'chat.history': { messages: [...history,
      measuredUser,
      { id: 'mixed-final', role: 'assistant', content: finalText, timestamp: Date.now() },
    ] } } });
    await app.evaluate(({ BrowserWindow }, data) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('chat:runtime-event', { sessionKey: data.sessionKey, runId: data.runId, type: 'run.ended', seq: data.events + 1, status: 'completed', endedAt: Date.now() });
        win.webContents.send('gateway:chat-message', { sessionKey: data.sessionKey, runId: data.runId, state: 'final', message: { id: 'mixed-final', role: 'assistant', content: data.finalText } });
      }
    }, { sessionKey, runId, events: fixture.streamEvents, finalText });
    await expect(input).toBeEnabled(); await expect(input).toHaveValue(fixture.keyboardText);
    await expect(page.getByTestId('chat-composer-send')).toBeVisible();
    await expect(page.getByTestId('chat-intervention-interrupt')).toHaveCount(0);
    report.renderer = { inputRetained: await input.inputValue() === fixture.keyboardText, finalTextCorrect: true, terminalCompleted: true, inputStartedAt, samples, scrolls };
    report.processAfter = await processSnapshot(sampler, pid);
    await page.screenshot({ path: testInfo.outputPath('mixed-load.png') });
    report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = String(error); throw error; }
  finally {
    const capture = async <T>(operation: Promise<T>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Failure capture timeout')), 5000); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    if (report.status !== 'pass') {
      try { report.partialWork = await capture(app.evaluate(() => (globalThis as Record<string, unknown>).__mixedWorkRaw ?? null)); }
      catch (error) { report.partialWorkError = String(error); }
      if (pageForCleanup) try { report.partialRenderer = await capture(pageForCleanup.evaluate(() => (window as unknown as { __mixedProbe: RendererProbe }).__mixedProbe)); }
      catch (error) { report.partialRendererError = String(error); }
    }
    await writeFile(testInfo.outputPath('measurement.json'), JSON.stringify(report, null, 2));
    try { report.cleanup = await closeElectronApp(app); }
    finally {
      server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
      await writeFile(testInfo.outputPath('measurement.json'), JSON.stringify(report, null, 2));
    }
  }
});
