# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-chain-scope-faults.spec.ts >> project Ledger warnings stay unavailable in the task drawer and preserve the current draft
- Location: tests\e2e\session-chain-scope-faults.spec.ts:262:5

# Error details

```
Test timeout of 120000ms exceeded.
```

```
TimeoutError: electron.launch: Timeout 90000ms exceeded.
Call log:
  - <launching> "D:\tmp\clawx-audit-next-20261107\candidate\node_modules\.pnpm\electron@40.8.4\node_modules\electron\dist\electron.exe" "--inspect=0" "--remote-debugging-port=0" "--no-sandbox" "--user-data-dir=D:\ClawX-work\session-task-unified-relay-20261109\.tmp\e2e-runs\verse-claw-e2e-run-qzB38E\verse-claw-e2e-user-data-Vssjw2" "--lang=en-US" "--disable-gpu" "--disable-gpu-compositing" "--disable-software-rasterizer" "--in-process-gpu" "--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization" "--force-device-scale-factor=1" "D:\ClawX-work\session-task-unified-relay-20261109\dist-electron\main\index.js"
  - <launched> pid=47436
  - [pid=47436][out]
  - [pid=47436][err] Debugger listening on ws://127.0.0.1:57875/8af60772-ab4f-4093-bf5a-c616ee5d270f
  - [pid=47436][err] For help, see: https://nodejs.org/en/docs/inspector
  - <ws connecting> ws://127.0.0.1:57875/8af60772-ab4f-4093-bf5a-c616ee5d270f
  - <ws connected> ws://127.0.0.1:57875/8af60772-ab4f-4093-bf5a-c616ee5d270f
  - [pid=47436][err] Debugger attached.

```

# Test source

```ts
  277 | 
  278 | async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000) {
  279 |   const owned = electronProcesses.get(app);
  280 |   const errors: string[] = [];
  281 |   let launcher = owned?.launcher;
  282 |   if (!launcher) {
  283 |     try { launcher = app.process(); } catch (error) { errors.push(String(error)); }
  284 |   }
  285 |   let snapshotError: string | undefined;
  286 |   if (process.platform === 'win32' && owned) {
  287 |     try {
  288 |       const current = await bounded(app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics()
  289 |         .map(({ pid, creationTime }) => ({ pid, creationTime }))), 2_000, 'Electron process snapshot');
  290 |       owned.identities = [...new Map([...owned.identities, ...current]
  291 |         .map((entry) => [`${entry.pid}:${entry.creationTime}`, entry])).values()];
  292 |       await recordElectronProcesses(owned.userDataDir, current);
  293 |     } catch (error) { snapshotError = String(error); }
  294 |   }
  295 |   // Playwright must close its inspector before the Windows launcher exits.
  296 |   const closing = app.close().then(() => true, (error: unknown) => { errors.push(String(error)); return false; });
  297 |   let graceful = false;
  298 |   try { graceful = await bounded(closing, timeoutMs, 'Playwright close'); } catch { /* fall back to owned handles */ }
  299 |   let processes: WindowsProcessCheck[] = [];
  300 |   try {
  301 |     if (process.platform === 'win32' && owned) processes = await checkWindowsProcesses(owned.identities, true);
  302 |   } catch (error) { errors.push(String(error)); }
  303 |   if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
  304 |     // ChildProcess.kill uses the launcher's existing native handle on Windows.
  305 |     const exited = new Promise<void>((resolve) => launcher.once('exit', () => resolve()));
  306 |     try {
  307 |       launcher.kill('SIGKILL');
  308 |       await bounded(exited, timeoutMs, 'Electron launcher exit');
  309 |     } catch (error) { errors.push(String(error)); }
  310 |   }
  311 |   let closeSettled = false;
  312 |   try { closeSettled = await bounded(closing, 2_000, 'Playwright close after launcher exit'); }
  313 |   catch (error) { errors.push(String(error)); }
  314 |   if (owned && processes.some(({ status }) => status === 'alive')) {
  315 |     // A signalled Main can finish after the launcher's pipes close. Read the
  316 |     // same identities again before deciding whether this close left survivors.
  317 |     try { processes = await checkWindowsProcesses(owned.identities); }
  318 |     catch (error) { errors.push(String(error)); }
  319 |   }
  320 |   const launcherExited = Boolean(launcher && (launcher.exitCode !== null || launcher.signalCode !== null));
  321 |   const mainExited = process.platform === 'win32'
  322 |     ? Boolean(owned?.identities.length && processes.length === owned.identities.length
  323 |       && processes.every(({ status }) => status === 'exited' || status === 'replaced' || status === 'terminated'))
  324 |     : launcherExited;
  325 |   // Other E2E callers close sockets after this helper. Return exit confirmation
  326 |   // so those cleanups run even when a process or inspector cannot be closed.
  327 |   return { mainExited, launcherExited, graceful, closeSettled, processes, errors, ...(snapshotError ? { snapshotError } : {}) };
  328 | }
  329 | 
  330 | async function seedE2eSettings(userDataDir: string, theme?: LaunchElectronOptions['theme']): Promise<void> {
  331 |   const settingsPath = join(userDataDir, 'settings.json');
  332 |   let existing: Record<string, unknown> = {};
  333 |   try {
  334 |     await access(settingsPath);
  335 |     existing = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
  336 |     if (!theme) return;
  337 |   } catch {
  338 |     // Seed only once per isolated profile. Tests that switch language should
  339 |     // keep their persisted setting across relaunches in the same profile.
  340 |   }
  341 | 
  342 |   await writeFile(settingsPath, JSON.stringify({ language: 'en', ...existing, ...(theme ? { theme } : {}) }, null, 2), 'utf-8');
  343 | }
  344 | 
  345 | async function cleanupTempDir(path: string): Promise<void> {
  346 |   if (process.env.CLAWX_E2E_KEEP_TEMP === '1') {
  347 |     return;
  348 |   }
  349 | 
  350 |   try {
  351 |     await rm(path, { recursive: true, force: true });
  352 |   } catch (error) {
  353 |     const code = (error as NodeJS.ErrnoException)?.code;
  354 |     if (process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY')) {
  355 |       return;
  356 |     }
  357 |     throw error;
  358 |   }
  359 | }
  360 | 
  361 | async function launchVerseClawElectron(
  362 |   homeDir: string,
  363 |   userDataDir: string,
  364 |   options: LaunchElectronOptions = {},
  365 | ): Promise<ElectronApplication> {
  366 |   const profileDir = options.profileDir ?? userDataDir;
  367 |   if (!options.skipSeed) await seedE2eSettings(profileDir, options.theme);
  368 |   const hostApiPort = await allocatePort();
  369 |   const cdpPort = await allocatePort();
  370 |   const electronEnv = process.platform === 'linux'
  371 |     ? {
  372 |       ELECTRON_DISABLE_SANDBOX: '1',
  373 |       DISPLAY: process.env.DISPLAY || ':1',
  374 |     }
  375 |     : {};
  376 |   const pendingLaunch = await recordElectronLaunch(userDataDir);
> 377 |   const app = await electron.launch({
      |               ^ TimeoutError: electron.launch: Timeout 90000ms exceeded.
  378 |     executablePath: options.executablePath ?? String(electronBinaryPath),
  379 |     args: [
  380 |       // Windows runners cannot use the Chromium sandbox in this isolated E2E user-data context.
  381 |       ...(process.platform === 'win32' ? ['--no-sandbox'] : []),
  382 |       `--user-data-dir=${profileDir}`,
  383 |       '--lang=en-US',
  384 |       '--disable-gpu',
  385 |       '--disable-gpu-compositing',
  386 |       '--disable-software-rasterizer',
  387 |       '--in-process-gpu',
  388 |       '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization',
  389 |       ...(options.deviceScaleFactor ? [`--force-device-scale-factor=${options.deviceScaleFactor}`] : []),
  390 |       ...(options.packaged ? [] : [electronEntry]),
  391 |     ],
  392 |     env: envWithoutUndefined({
  393 |       ...process.env,
  394 |       ...electronEnv,
  395 |       ...options.env,
  396 |       HOME: homeDir,
  397 |       USERPROFILE: homeDir,
  398 |       APPDATA: join(homeDir, 'AppData', 'Roaming'),
  399 |       LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
  400 |       XDG_CONFIG_HOME: join(homeDir, '.config'),
  401 |       LANG: 'en_US.UTF-8',
  402 |       LC_ALL: 'en_US.UTF-8',
  403 |       LANGUAGE: 'en',
  404 |       VERSE_CLAW_E2E: '1',
  405 |       CLAWX_AGENT_DEV: '1',
  406 |       ...(options.flags?.length ? { CLAWX_FLAGS: options.flags.join(',') } : {}),
  407 |       ...(options.visualMode ? { CLAWX_VISUAL_MODE: '1' } : {}),
  408 |       ...(options.devScenario ? { CLAWX_DEV_SCENARIO: options.devScenario } : {}),
  409 |       ...(typeof options.bootHoldMs === 'number'
  410 |         ? { CLAWX_E2E_BOOT_HOLD_MS: String(Math.max(0, Math.round(options.bootHoldMs))) }
  411 |         : {}),
  412 |       ...(typeof options.settingsSectionDelayMs === 'number'
  413 |         ? { CLAWX_E2E_SETTINGS_SECTION_DELAY_MS: String(Math.max(0, Math.round(options.settingsSectionDelayMs))) }
  414 |         : {}),
  415 |       VERSE_CLAW_USER_DATA_DIR: profileDir,
  416 |       ...(options.skipSetup ? { VERSE_CLAW_E2E_SKIP_SETUP: '1' } : {}),
  417 |       VERSE_CLAW_PORT_CLAWX_HOST_API: String(hostApiPort),
  418 |       VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(cdpPort),
  419 |     }),
  420 |     timeout: 90_000,
  421 |   });
  422 |   const owned = { userDataDir, identities: [] as WindowsProcessIdentity[], launcher: app.process() };
  423 |   electronProcesses.set(app, owned);
  424 |   if (process.platform === 'win32') {
  425 |     try {
  426 |       const identities = await bounded(app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics()
  427 |         .map(({ pid, creationTime }) => ({ pid, creationTime }))), 5_000, 'Electron launch process snapshot');
  428 |       owned.identities = identities;
  429 |       await recordElectronProcesses(userDataDir, identities);
  430 |       await completeElectronLaunch(pendingLaunch);
  431 |     }
  432 |     catch (error) { await closeElectronApp(app); throw error; }
  433 |   }
  434 |   /*
  435 |    * The app's own output is otherwise swallowed, which makes a stalled turn
  436 |    * unattributable from the test side: the composer just goes idle and the
  437 |    * runtime's reason never leaves the process. Opt in with CLAWX_E2E_APP_LOGS=1
  438 |    * when diagnosing one.
  439 |    */
  440 |   if (process.env.CLAWX_E2E_APP_LOGS === '1') {
  441 |     app.process().stdout?.on('data', (chunk: Buffer) => {
  442 |       process.stderr.write(`[app:out] ${String(chunk)}`);
  443 |     });
  444 |     app.process().stderr?.on('data', (chunk: Buffer) => {
  445 |       process.stderr.write(`[app:err] ${String(chunk)}`);
  446 |     });
  447 |   }
  448 |   // Hosted runners can open the desktop window on a 1024px screen. Wait for
  449 |   // its creation before pinning content size; responsive specs can resize it.
  450 |   try {
  451 |     await app.firstWindow();
  452 |     await pinWindowContentSize(app, { width: 1280, height: 800 });
  453 |   } catch (error) {
  454 |     await closeElectronApp(app);
  455 |     throw error;
  456 |   }
  457 |   return app;
  458 | }
  459 | 
  460 | export const test = base.extend<ElectronFixtures>({
  461 |   workerDiagnostics: [async ({ browserName: _browserName }, provideDiagnostics, testInfo) => {
  462 |     const dir = process.env.CLAWX_E2E_RUN_ROOT;
  463 |     if (!dir) { await provideDiagnostics(); return; }
  464 |     // Write before the test and synchronously: a native abort bypasses teardown.
  465 |     // Do not include inherited environment variables or a user's configuration.
  466 |     process.report.directory = dir;
  467 |     process.report.reportOnFatalError = true;
  468 |     process.report.excludeEnv = true;
  469 |     const record = (phase: string) => appendFileSync(join(dir, `worker-${process.pid}.jsonl`), JSON.stringify({
  470 |       driven_by: 'agent', actor: 'playwright-worker', phase, time: new Date().toISOString(),
  471 |       pid: process.pid, ppid: process.ppid, execPath: process.execPath, node: process.version,
  472 |       workerIndex: testInfo.workerIndex, test: testInfo.titlePath, status: testInfo.status,
  473 |       memory: process.memoryUsage(), resources: process.resourceUsage(),
  474 |     }) + '\n');
  475 |     record('begin');
  476 |     const timer = setInterval(() => record('sample'), 5_000).unref();
  477 |     try { await provideDiagnostics(); } finally { clearInterval(timer); record('end'); }
```