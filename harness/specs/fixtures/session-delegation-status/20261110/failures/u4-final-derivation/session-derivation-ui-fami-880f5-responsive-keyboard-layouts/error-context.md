# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: session-derivation-ui.spec.ts >> family navigation preserves 2/20/100 runtime children and responsive keyboard layouts
- Location: tests\e2e\session-derivation-ui.spec.ts:76:5

# Error details

```
Error: electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.
```

# Test source

```ts
  10  |   const response = await hostInvoke<{ result: TaskResolution }>(app, 'taskLedger', 'command', {
  11  |     workspaceId, command: { action: 'create', requestId, contract },
  12  |   });
  13  |   return response.result.task;
  14  | }
  15  | 
  16  | export async function observeSessionUi(app: ElectronApplication) {
  17  |   const errors: string[] = [];
  18  |   const attach = (page: import('@playwright/test').Page) => {
  19  |     page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  20  |     page.on('console', (message) => {
  21  |       if (message.type() === 'error') errors.push(message.text().slice(0, 5000));
  22  |     });
  23  |   };
  24  |   app.windows().forEach(attach);
  25  |   app.on('window', attach);
  26  |   return async (outputPath: (name: string) => string) => {
  27  |     const pages = [];
  28  |     for (const [index, page] of app.windows().entries()) {
  29  |       const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => 'unavailable');
  30  |       pages.push({ url: page.url(), body });
  31  |       await page.screenshot({ path: outputPath(`ui-diagnostic-${index}.png`), timeout: 5000 }).catch(() => undefined);
  32  |     }
  33  |     await writeFile(outputPath('ui-diagnostics.json'), JSON.stringify({ errors, pages }, null, 2));
  34  |   };
  35  | }
  36  | 
  37  | export async function configureSessionChainProvider(app: ElectronApplication, port: number) {
  38  |   await hostInvoke(app, 'gateway', 'stop');
  39  |   const now = new Date().toISOString();
  40  |   await hostInvoke(app, 'providers', 'save', { config: {
  41  |     id: 'session-chain-fixture', name: 'Agent session fixture', type: 'custom', apiProtocol: 'openai-completions',
  42  |     baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-coder', enabled: true, createdAt: now, updatedAt: now,
  43  |     modelProfile: { supportsReasoning: true, supportsVision: false, contextWindow: 128000, maxTokens: 4096 },
  44  |   }, apiKey: 'local-scripted-session-key' });
  45  |   await hostInvoke(app, 'providers', 'setDefault', { providerId: 'session-chain-fixture' });
  46  | }
  47  | 
  48  | /** Pin window content size; visual fixtures launch with a unit device scale. */
  49  | export async function setSessionChainViewport(app: ElectronApplication, size: { width: number; height: number }) {
  50  |   return app.evaluate(async ({ BrowserWindow }, target) => {
  51  |     const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  52  |     if (!win) throw new Error('No session window');
  53  |     if (win.isMaximized()) win.unmaximize();
  54  |     if (win.isFullScreen()) win.setFullScreen(false);
  55  |     win.setContentSize(target.width, target.height);
  56  |     await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  57  |     return win.webContents.executeJavaScript('({ width: window.innerWidth, height: window.innerHeight })');
  58  |   }, size);
  59  | }
  60  | 
  61  | export async function createSessionChainProject(app: ElectronApplication, rootPath: string, name: string) {
  62  |   await mkdir(rootPath, { recursive: true });
  63  |   const key = `agent:main:session-${Date.now()}-${name.toLowerCase().replace(/[^a-z]/g, '')}`;
  64  |   const result = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
  65  |     name, rootPath, agentId: 'main', activeSessionKey: key, permissionMode: 'fullAccess',
  66  |   });
  67  |   await hostInvoke(app, 'gateway', 'stop');
  68  |   await startGateway(app);
  69  |   const workspaceId = result.activeWorkspace.id;
  70  |   const session = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', {
  71  |     method: 'sessions.create', params: { key, agentId: 'main', label: `${name} coordinator` }, timeoutMs: 30_000,
  72  |   });
  73  |   return { workspaceId, rootPath, sessionKey: session.key, generation: session.sessionId };
  74  | }
  75  | 
  76  | export async function addSessionChainChildren(app: ElectronApplication, project: { workspaceId: string; sessionKey: string }, start: number, end: number) {
  77  |   const children: string[] = [];
  78  |   for (let index = start; index < end; index++) {
  79  |     const child = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', {
  80  |       method: 'sessions.create', params: { agentId: 'main', parentSessionKey: project.sessionKey,
  81  |         label: `Child ${index + 1} · ${'A long session title '.repeat(index === 0 ? 7 : 1)} · ${project.sessionKey.slice(-10)}` }, timeoutMs: 30_000,
  82  |     });
  83  |     await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: child.key,
  84  |       state: { draftInput: `Child ${index + 1} draft` } });
  85  |     children.push(child.key);
  86  |   }
  87  |   return children;
  88  | }
  89  | 
  90  | export async function instrumentSessionChainHost(app: ElectronApplication) {
  91  |   await app.evaluate(() => {
  92  |     const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
  93  |     const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
  94  |     const state = globalThis as unknown as {
  95  |       sessionChainCalls: Array<{ module?: string; action?: string; method?: string }>;
  96  |       sessionChainOriginalHost?: (event: unknown, request: unknown) => Promise<unknown>;
  97  |     };
  98  |     const original = state.sessionChainOriginalHost ?? handlers.get('host:invoke')!;
  99  |     state.sessionChainOriginalHost = original;
  100 |     state.sessionChainCalls = [];
  101 |     ipcMain.removeHandler('host:invoke');
  102 |     ipcMain.handle('host:invoke', (event, request: { module?: string; action?: string; payload?: { method?: string } }) => {
  103 |       state.sessionChainCalls.push({ module: request.module, action: request.action, method: request.payload?.method });
  104 |       return original(event, request);
  105 |     });
  106 |   });
  107 | }
  108 | 
  109 | export function readSessionChainHostCalls(app: ElectronApplication) {
> 110 |   return app.evaluate(() => (globalThis as unknown as { sessionChainCalls: Array<{ module?: string; action?: string; method?: string }> }).sessionChainCalls);
      |              ^ Error: electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.
  111 | }
  112 | 
  113 | /** Agent-driven transport fault after the real Main creation commit. */
  114 | export async function loseNextHandoffCreationResponse(app: ElectronApplication, operationId: string) {
  115 |   await app.evaluate((_electron, id) => {
  116 |     const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
  117 |     const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
  118 |     const original = handlers.get('host:invoke')!;
  119 |     ipcMain.removeHandler('host:invoke');
  120 |     ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string; payload?: { operationId?: string } }) => {
  121 |       const result = await original(event, request);
  122 |       if (request.module === 'sessions' && request.action === 'createHandoff' && request.payload?.operationId === id) {
  123 |         ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original);
  124 |         throw new Error('agent injected creation response loss');
  125 |       }
  126 |       return result;
  127 |     });
  128 |   }, operationId);
  129 | }
  130 | 
  131 | /** Fail one acknowledged-send persistence write in the isolated test profile. */
  132 | export async function failNextHandoffAcknowledgementWrite(app: ElectronApplication, operationId: string) {
  133 |   const storeModule = createRequire(resolve('package.json')).resolve('electron-store');
  134 |   await app.evaluate(({ app: electronApp }, { id, storeModule }) => {
  135 |     const module = process.mainModule!.require(storeModule);
  136 |     const Store = module.default ?? module;
  137 |     const path = process.mainModule!.require('node:path') as typeof import('node:path');
  138 |     const expectedPath = path.resolve(electronApp.getPath('userData'), 'workspaces.json');
  139 |     const descriptor = Object.getOwnPropertyDescriptor(Store.prototype, 'set');
  140 |     const original = Store.prototype.set;
  141 |     Object.defineProperty(Store.prototype, 'set', { configurable: true, writable: true,
  142 |       value: function (this: { path?: string }, key: unknown, value: unknown) {
  143 |         const profiles = Array.isArray(value) ? value as Array<{ handoffOperations?: Record<string, { phase?: string }> }> : [];
  144 |         if (this.path && path.resolve(this.path) === expectedPath && key === 'profiles'
  145 |           && profiles.some((profile) => profile.handoffOperations?.[id]?.phase === 'accepted')) {
  146 |           if (descriptor) Object.defineProperty(Store.prototype, 'set', descriptor);
  147 |           else delete Store.prototype.set;
  148 |           throw new Error('agent injected acknowledgement persistence failure');
  149 |         }
  150 |         return Reflect.apply(original, this, [key, value]);
  151 |       },
  152 |     });
  153 |   }, { id: operationId, storeModule });
  154 | }
  155 | 
```