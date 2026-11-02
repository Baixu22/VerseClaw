# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agency-role-promotion.spec.ts >> Agency role promotion >> reviews, approves, refreshes, and retires a separate config role
- Location: tests\e2e\agency-role-promotion.spec.ts:103:7

# Error details

```
Error: [FP-P3-05] openclaw_runtime/dist/entry.js is stale. 4875 src file(s) newer than dist.
Run `pnpm build:runtime` before E2E to avoid testing a stale bundle.
Sample stale files: openclaw_runtime\src\acp\approval-classifier.ts, openclaw_runtime\src\acp\client-helpers.ts, openclaw_runtime\src\acp\client.ts, openclaw_runtime\src\acp\commands.ts, openclaw_runtime\src\acp\control-plane\active-turns.ts (and 4870 more)
```

# Test source

```ts
  14  |   skipSeed?: boolean;
  15  |   flags?: string[];
  16  |   visualMode?: boolean;
  17  |   devScenario?: string;
  18  |   bootHoldMs?: number;
  19  |   settingsSectionDelayMs?: number;
  20  |   theme?: 'light' | 'dark' | 'system';
  21  |   env?: Record<string, string>;
  22  |   profileDir?: string;
  23  |   packaged?: boolean;
  24  |   executablePath?: string;
  25  | };
  26  |
  27  | type IpcMockConfig = {
  28  |   gatewayStatus?: Record<string, unknown>;
  29  |   gatewayRpc?: Record<string, unknown>;
  30  |   /** Plain method-name seam; `*` is the fallback for unlisted methods. */
  31  |   gatewayRpcByMethod?: Record<string, unknown>;
  32  |   /** Per-method response sequences; the last entry repeats. */
  33  |   gatewayRpcSequences?: Record<string, unknown[]>;
  34  |   /** Optional per-method delay in milliseconds for gatewayRpcByMethod. */
  35  |   gatewayRpcDelays?: Record<string, number>;
  36  |   hostApi?: Record<string, unknown>;
  37  |   /** Typed seam for the former `file:stat` flat handler. */
  38  |   fileStat?: Record<string, unknown>;
  39  |   /** Typed seam for the former `file:readText` flat handler. */
  40  |   fileReadText?: Record<string, unknown>;
  41  | };
  42  |
  43  | type ElectronFixtures = {
  44  |   workerDiagnostics: void;
  45  |   electronApp: ElectronApplication;
  46  |   page: Page;
  47  |   homeDir: string;
  48  |   userDataDir: string;
  49  |   launchElectronApp: (options?: LaunchElectronOptions) => Promise<ElectronApplication>;
  50  | };
  51  |
  52  | type AgentDevTestWindow = Window & {
  53  |   __CLAWX_TEST__?: {
  54  |     getSnapshot?: () => unknown;
  55  |     setHostApiReplay?: (config: unknown) => void;
  56  |     hostApiCalls?: unknown[];
  57  |   };
  58  | };
  59  |
  60  | function envWithoutUndefined(env: Record<string, string | undefined>): Record<string, string> {
  61  |   return Object.fromEntries(
  62  |     Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  63  |   );
  64  | }
  65  |
  66  | const repoRoot = resolve(process.cwd());
  67  | const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
  68  | const rendererEntryUrl = pathToFileURL(join(repoRoot, 'dist', 'index.html')).toString();
  69  |
  70  | // FP-P3-05: openclaw_runtime dist freshness guard.
  71  | // E2E must test the current source build, not a stale dist/entry.js bundle.
  72  | // If any src file is newer than dist/entry.js, fail-fast with a readable hint.
  73  | const runtimeSrcDir = join(repoRoot, 'openclaw_runtime', 'src');
  74  | const runtimeDistEntry = join(repoRoot, 'openclaw_runtime', 'dist', 'entry.js');
  75  |
  76  | let freshnessChecked = false;
  77  | async function assertRuntimeDistFresh(): Promise<void> {
  78  |   if (freshnessChecked) return; // check once per process
  79  |   freshnessChecked = true;
  80  |   let distMtimeMs: number;
  81  |   try {
  82  |     const st = await stat(runtimeDistEntry);
  83  |     distMtimeMs = st.mtimeMs;
  84  |   } catch {
  85  |     return; // dist missing → let the runtime path fall back to tsx; no staleness to check
  86  |   }
  87  |   const stale: string[] = [];
  88  |   async function walk(dir: string): Promise<void> {
  89  |     const { readdir } = await import('node:fs/promises');
  90  |     const entries = await readdir(dir, { withFileTypes: true });
  91  |     for (const entry of entries) {
  92  |       if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'test') continue;
  93  |       const full = join(dir, entry.name);
  94  |       if (entry.isDirectory()) {
  95  |         await walk(full);
  96  |       } else if (
  97  |         (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
  98  |         // Test/spec files are never inputs to the runtime bundle (entry.js), so a
  99  |         // test edited after the last build must not report the dist as stale.
  100 |         !/\.(test|spec)\.[cm]?[jt]s$/u.test(entry.name)
  101 |       ) {
  102 |         const st = await stat(full);
  103 |         if (st.mtimeMs > distMtimeMs) stale.push(full);
  104 |       }
  105 |     }
  106 |   }
  107 |   try {
  108 |     await walk(runtimeSrcDir);
  109 |   } catch {
  110 |     return; // src dir missing or unreadable → skip (not our job to fail here)
  111 |   }
  112 |   if (stale.length > 0) {
  113 |     const sample = stale.slice(0, 5).map((f) => f.replace(repoRoot + '\\', ''));
> 114 |     throw new Error(
      |           ^ Error: [FP-P3-05] openclaw_runtime/dist/entry.js is stale. 4875 src file(s) newer than dist.
  115 |       `[FP-P3-05] openclaw_runtime/dist/entry.js is stale. ${stale.length} src file(s) newer than dist.\n` +
  116 |         `Run \`pnpm build:runtime\` before E2E to avoid testing a stale bundle.\n` +
  117 |         `Sample stale files: ${sample.join(', ')}${stale.length > 5 ? ` (and ${stale.length - 5} more)` : ''}`,
  118 |     );
  119 |   }
  120 | }
  121 |
  122 | async function allocatePort(): Promise<number> {
  123 |   return await new Promise((resolvePort, reject) => {
  124 |     const server = createServer();
  125 |     server.once('error', reject);
  126 |     server.listen(0, '127.0.0.1', () => {
  127 |       const address = server.address();
  128 |       if (!address || typeof address === 'string') {
  129 |         server.close(() => reject(new Error('Failed to allocate an ephemeral port')));
  130 |         return;
  131 |       }
  132 |       const { port } = address;
  133 |       server.close((error) => {
  134 |         if (error) {
  135 |           reject(error);
  136 |           return;
  137 |         }
  138 |         resolvePort(port);
  139 |       });
  140 |     });
  141 |   });
  142 | }
  143 |
  144 | async function getStableWindow(app: ElectronApplication): Promise<Page> {
  145 |   const deadline = Date.now() + 30_000;
  146 |   let page = await app.firstWindow();
  147 |
  148 |   while (Date.now() < deadline) {
  149 |     const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
  150 |     const currentWindow = openWindows.at(-1) ?? page;
  151 |
  152 |     if (currentWindow && !currentWindow.isClosed()) {
  153 |       try {
  154 |         await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
  155 |         return currentWindow;
  156 |       } catch (error) {
  157 |         // A window that is not ready yet is expected while the app boots: this
  158 |         // helper's contract is to poll until the deadline, so a slow load must
  159 |         // not abort the loop. Only a window that actually closed is terminal.
  160 |         const message = String(error);
  161 |         if (!message.includes('has been closed') && !message.includes('Timeout')) {
  162 |           throw error;
  163 |         }
  164 |       }
  165 |     }
  166 |
  167 |     try {
  168 |       page = await app.waitForEvent('window', { timeout: 2_000 });
  169 |     } catch {
  170 |       // Keep polling until a stable window is available or the deadline expires.
  171 |     }
  172 |   }
  173 |
  174 |   throw new Error('No stable Electron window became available');
  175 | }
  176 |
  177 | /**
  178 |  * The sidebar's section actions are hover-revealed: `.section-heading-actions`
  179 |  * starts at `opacity: 0; pointer-events: none` and only flips to `auto` while
  180 |  * its heading is hovered. Clicking one of those 22x22 slots straight after a
  181 |  * bare `hover()` can race that flip, because the click's hit test resolves
  182 |  * `pointer-events` at the moment it runs and then reports the heading as
  183 |  * intercepting the pointer. Hover the heading and wait for the slot to actually
  184 |  * accept pointer events before touching it.
  185 |  */
  186 | export async function revealSectionHeadingActions(page: Page, index = 0): Promise<void> {
  187 |   const heading = page.locator('.section-heading').nth(index);
  188 |   await heading.hover();
  189 |   await expect(heading.locator('.section-heading-actions')).toHaveCSS('pointer-events', 'auto');
  190 | }
  191 |
  192 | /**
  193 |  * Reveals the hover-only action slot that owns `control`.
  194 |  *
  195 |  * The sidebar has several `.section-heading` blocks (the nav sections and the
  196 |  * conversations/projects section), each with its own hover-revealed actions, and
  197 |  * only one is revealed at a time. Revealing by index therefore only works when the
  198 |  * caller happens to know which heading owns the control: four specs clicked
  199 |  * `sidebar-session-organize` -- which lives in the conversations/projects heading,
  200 |  * not the first one -- after revealing index 0, so the slot kept
  201 |  * `pointer-events: none` and the click died on "<div class=\"section-heading\">
  202 |  * intercepts pointer events" once the sidebar had more than one heading. Resolve the
  203 |  * owning heading from the control itself instead.
  204 |  */
  205 | export async function revealSectionHeadingActionsFor(control: Locator): Promise<void> {
  206 |   // Hover the heading that owns the control, not the control itself: the slot
  207 |   // starts at `pointer-events: none`, and hovering an element that cannot receive
  208 |   // pointer events blocks until Playwright's own action timeout.
  209 |   const heading = control.locator(
  210 |     'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " section-heading ")][1]',
  211 |   );
  212 |   await expect(async () => {
  213 |     await heading.hover();
  214 |     await expect(control).toHaveCSS('pointer-events', 'auto', { timeout: 2_000 });
```