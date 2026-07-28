# Electron E2E harness map — FP-P1-07 / FP-P1-11

## 1. `tests/e2e/runtime-launch-contract-fp-p0.spec.ts` — real gateway child under `VERSE_CLAW_E2E=1`

**Absolute path:** `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\runtime-launch-contract-fp-p0.spec.ts` (430 lines, 3 tests)

**The whole trick:** it does NOT change any env. It launches the standard fixture (which always sets `VERSE_CLAW_E2E=1`), then starts the gateway **explicitly by hand** through the host `gateway.start` IPC route. The file's own header says so:

```ts
/**
 * The gateway is started explicitly via the host `gateway.start` route because
 * VERSE_CLAW_E2E=1 skips auto-start (electron/main/index.ts). That is the known
 * obstacle recorded in FP-P0-04; starting it by hand is the real-gateway profile.
 */
```

**Profile / env used:** only `launchElectronApp({ skipSetup: true })` — i.e. the standard `tests/e2e/fixtures/electron.ts` fixture with isolated `homeDir` + `userDataDir`. The only env manipulation is *deletion* to make "absent" a real signal (`delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED`, `delete process.env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH`), restored in `finally`.

**The three-step real-gateway pattern (copy verbatim):**

```ts
async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('port allocation failed')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function ensureGatewayRunning(app: ElectronApplication, port: number): Promise<void> {
  const deadline = Date.now() + 180_000;
  let attempts = 0;
  let lastStatus: GatewayStatus | undefined;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (lastStatus.state !== 'starting' && attempts < 3) {
        attempts += 1;
        try {
          await hostInvoke<HostSuccess>(app, 'gateway', 'start');
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `gateway never became ready: ${JSON.stringify({ lastStatus, lastError, port })}`,
  );
}
```

Called from a test as:

```ts
const app = await launchElectronApp({ skipSetup: true });
const page = await getStableWindow(app);
await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

// ---- start a real gateway child ----
const port = await allocatePort();
const set = await hostInvoke<HostSuccess>(app, 'settings', 'set', {
  key: 'gatewayPort',
  value: port,
});
expect(set.success).toBe(true);
await ensureGatewayRunning(app, port);

const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
  method: 'runtime.flags.ack',
  params: {},
  timeoutMs: 30_000,
});
```

**Config seeding** must write BOTH copies — `~/.openclaw/openclaw.json` (the isolated `homeDir`) **and** `<userDataDir>/openclaw-source-state/openclaw.json`, because source-runtime isolation owns the gateway's real config:

```ts
const serialized = `${JSON.stringify(config, null, 2)}\n`;
const openclawDir = join(homeDir, '.openclaw');
const sourceStateDir = join(userDataDir, 'openclaw-source-state');
await mkdir(openclawDir, { recursive: true });
await mkdir(sourceStateDir, { recursive: true });
await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');
```

Timeouts used: `test.setTimeout(420_000)` per test.

## 2. Where `VERSE_CLAW_E2E` skips gateway auto-start, and the escape hatch

Four files reference it:

| File | Line | Effect |
|---|---|---|
| `electron/main/index.ts` | 71 | `const isE2EMode = process.env.VERSE_CLAW_E2E === '1';` — used at 18 sites |
| `electron/gateway/config-sync.ts` | 746 | `isE2E` skips `OPENCLAW_DEFER_STARTUP_SIDECARS` so `tools.effective` is available on the ready path |
| `electron/services/dcs-prod-flags-api.ts` | 242, 447 | default for `restartGateway` |
| `electron/services/agent-dev-api.ts` | 78 | enables agent-dev API |

**The auto-start skip** — `electron/main/index.ts:1230-1245`:

```ts
// Start Gateway automatically (this seeds missing bootstrap files with full templates)
const gatewayAutoStart = await getSetting('gatewayAutoStart');
if (!isE2EMode && gatewayAutoStart) {
  try {
    await syncAllProviderAuthToRuntime();
    logger.debug('Auto-starting Gateway...');
    await gatewayManager.start();
    logger.info('Gateway auto-start succeeded');
  } catch (error) { ... }
} else if (isE2EMode) {
  logger.info('Gateway auto-start skipped in E2E mode');
}
```

**Escape hatch = the manual `gateway.start` host route.** There is no env override; `isE2EMode` gates only *auto*-start, not `gatewayManager.start()` itself. So `hostInvoke(app, 'gateway', 'start')` (and `'restart'`) reaches a real child. This is the profile every FP spec uses.

**Second escape hatch, for flags** — `electron/services/dcs-prod-flags-api.ts:239-242`:

```ts
// Default: restart gateway in product so env/config-sync apply.
// E2E skips auto-restart (gateway is not auto-started); pass restartGateway:true to force.
const restartGateway =
  typeof payload.restartGateway === 'boolean'
    ? payload.restartGateway
    : process.env.VERSE_CLAW_E2E !== '1';
```

So an E2E must pass `restartGateway: true` explicitly to `dcsProdFlags.setFlag` / `setDcsPreview` (line 447 is the same pattern for `setDcsPreview`).

Other `isE2EMode` sites that matter: DevTools suppressed (line ~881), `ensureVerseClawContext` / identity seeding / CLI auto-install / bundled-skill trimming all skipped (975, 996, 1055-1096, 1251-1258), and macOS-specific behavior at 1341.

## 3. `tests/e2e/dcs-production-wiring-w5.spec.ts` — `startQaMockOpenAiServer`

**Spec path:** `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\dcs-production-wiring-w5.spec.ts` (3 tests, `timeout: 480_000`)

**Definition:** `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\extensions\qa-lab\src\providers\mock-openai\server.ts:3393` — it is *not* an e2e helper, it is QA Lab runtime code imported across the repo boundary:

```ts
import { startQaMockOpenAiServer } from '../../openclaw_runtime/extensions/qa-lab/src/providers/mock-openai/server';
```

Signature and return:

```ts
export async function startQaMockOpenAiServer(params?: { host?: string; port?: number }) {
  const host = params?.host ?? "127.0.0.1";
  const scenarioState: MockScenarioState = {
    subagentFanoutPhase: 0,
    subagentHandoffSpawned: false,
    dcsW5MainActive: false,
    dcsW5MainPhase: 0,
    dcsW5ReadOnlyPhase: 0,
  };
  // ... createServer( ... ) ...
  return {
    baseUrl: `http://${host}:${address.port}`,
    async stop() { await closeQaHttpServer(server); },
  };
}
```

Routes it serves: `GET /healthz|/readyz`, `GET /v1/models` (returns `gpt-5.5`, `gpt-5.5-alt`, `gpt-image-1`, …), `POST /v1/responses` (OpenAI Responses API, SSE when `body.stream === true`), `POST /v1/images/generations`, `POST /v1/audio/transcriptions`, plus debug introspection: **`GET /debug/requests`**, `GET /debug/last-request`, `GET /debug/image-generations`.

**It is prompt-scripted**, not a dumb echo. Scenario regexes at `server.ts:221-223` and the branch at `server.ts:2030-2076`:

```ts
const QA_DCS_W5_OFF_PROMPT_RE = /DCS_W5_OFF: return the fixed off-path marker without tools/i;
const QA_DCS_W5_MAIN_PROMPT_RE = /DCS_W5_MAIN: execute the scripted production wiring proof/i;
const QA_DCS_W5_READ_ONLY_PROMPT_RE = /DCS_W5_READ_ONLY: read notes without modifying context/i;
```

```ts
if (QA_DCS_W5_MAIN_PROMPT_RE.test(allInputText)) {
  scenarioState.dcsW5MainActive = true;
}
if (scenarioState.dcsW5MainActive) {
  const scriptedCalls: Array<[string, Record<string, unknown>]> = [
    ["context_read", { block_type: "notes" }],
    ["context_write", { operation: "delete", content: "must-not-write" }],
    ["context_write", { operation: "replace", content: "dcs-w5-note" }],
    ["context_read", { block_type: "notes" }],
    ["context_search", { query: "dcs-w5-note", limit: 5 }],
  ];
  const next = scriptedCalls[scenarioState.dcsW5MainPhase];
  scenarioState.dcsW5MainPhase += 1;
  if (next) return buildToolCallEventsWithArgs(next[0], next[1]);
  scenarioState.dcsW5MainActive = false;
  const text = "DCS_W5_ON_OK";
  return buildAssistantEvents([{ id: "msg_mock_dcs_w5_on", phase: "final_answer",
    streamDeltas: splitMockStreamingText(text), text }]);
}
```

**Critical caveat for a new spec:** adding a new scripted scenario requires editing `openclaw_runtime/.../mock-openai/server.ts`. FP-P1-11's own task doc says to reuse this; FP-P1-04 instead built a self-contained scripted LLM in the test file (see §5) — that avoids touching runtime code.

**Provider wiring — `buildOpenClawConfig` (spec lines 68-108), copy verbatim:**

```ts
const MODEL_ID = 'gpt-5.5';
const PROVIDER_ID = 'mock-openai';

function buildOpenClawConfig(workspaceDir: string, baseUrl: string, enabled: boolean): Record<string, unknown> {
  return {
    gateway: {
      mode: 'local',
      controlUi: { enabled: false },
      http: { endpoints: { responses: { enabled: true } } },
    },
    runtime: {
      contextBlock: enabled
        ? { 'working-memory': { enabled: true }, 'tool-registry': { enabled: true }, sekb: { enabled: false } }
        : { sekb: { enabled: false } },
    },
    tools: { profile: 'coding' },
    agents: {
      defaults: {
        model: { primary: `${PROVIDER_ID}/${MODEL_ID}` },
        models: {
          [`${PROVIDER_ID}/${MODEL_ID}`]: {
            params: { openaiWsWarmup: false, transport: 'sse' },
          },
        },
        workspace: workspaceDir,
      },
      list: [{ id: 'main', default: true, workspace: workspaceDir }],
    },
    models: {
      providers: {
        [PROVIDER_ID]: {
          api: 'openai-responses',
          apiKey: { source: 'env', provider: 'default', id: 'OPENAI_API_KEY' },
          baseUrl,
          request: { allowPrivateNetwork: true },   // <-- REQUIRED for 127.0.0.1
          models: [{
            id: MODEL_ID,
            name: MODEL_ID,
            api: 'openai-responses',
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          }],
        },
      },
    },
  };
}
```

The `baseUrl` passed in is always **`${provider.baseUrl}/v1`**.

**Env required around a mock-provider turn:**

```ts
const previousSekb = process.env.OPENCLAW_SEKB_ENABLED;
const previousOpenAiKey = process.env.OPENAI_API_KEY;
const previousNoProxy = process.env.NO_PROXY;
process.env.OPENCLAW_SEKB_ENABLED = '0';
process.env.OPENAI_API_KEY = 'w5-test-key';   // satisfies apiKey.source:'env'
process.env.NO_PROXY = '127.0.0.1,localhost'; // otherwise a corporate proxy eats it
```
(all restored in `finally`, plus `await provider.stop()`).

**Running a REAL agent turn (spec lines 299-326) — two-phase `chat.send` + `agent.wait`:**

```ts
async function runAgent(app, sessionKey, message): Promise<Record<string, unknown>> {
  const run = await hostInvoke<AgentRunResult>(app, 'gateway', 'rpc', {
    method: 'chat.send',
    params: {
      message, agentId: 'main', sessionKey, deliver: false, promptMode: 'full',
      timeoutMs: 240_000,
      idempotencyKey: `dcs-w5-${Date.now()}-${Math.random()}`,
    },
    timeoutMs: 30_000,
  });
  expect(run.runId, JSON.stringify(run)).toBeTruthy();

  const wait = await hostInvoke<AgentWaitResult>(app, 'gateway', 'rpc', {
    method: 'agent.wait',
    params: { runId: run.runId, timeoutMs: 240_000 },
    timeoutMs: 250_000,
  });
  expect(wait.status, JSON.stringify(wait)).toBe('ok');
  return { runId: run.runId, status: wait.status, stopReason: wait.stopReason };
}
```

Full sequence inside a W5 test: `configureIsolatedGatewayPort(app)` → `hostInvoke(app,'workspaces','create',{name,rootPath:workspaceDir,permissionMode:'fullAccess'})` → `restartGatewayForW5(app, gatewayPort)` → `createSession(app, label)` (tries `sessions.list` then `sessions.create`, race-tolerant) → `runAgent(...)` → `readProviderRequests(provider.baseUrl)`.

Introspection of what the model actually saw:

```ts
async function readProviderRequests(baseUrl: string): Promise<ProviderRequest[]> {
  const response = await fetch(`${baseUrl}/debug/requests`);
  if (!response.ok) throw new Error(`provider debug requests failed: ${response.status}`);
  const snapshots = await response.json() as Array<{ body?: ProviderRequest }>;
  return snapshots.map((snapshot) => snapshot.body ?? {});
}
```

W5 also reads the gateway's SQLite directly: `join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite')` via `node:sqlite` `DatabaseSync` `{ readOnly: true }`, `PRAGMA busy_timeout = 30000`, table `context_blocks`.

## 4. Shared helpers / fixtures

`tests/e2e/fixtures/` contains exactly three files:

| Path | Role |
|---|---|
| `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\fixtures\electron.ts` | 535 lines — **the** Electron fixture. Exports `test`, `expect`, `closeElectronApp`, `getStableWindow`, `completeSetup`, `installIpcMocks`, `openAgentDevScenario`, `getAgentDevSnapshot`, `configureAgentDevHostReplay`, `getAgentDevHostCalls` |
| `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\fixtures\a11y.ts` | `scanBasicAccessibility(page)` |
| `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\fixtures\fp-p1-harness.ts` | **NEW, untracked, currently imported by ZERO specs** — see §5 |

Also: `tests/e2e/chat-history-rpc.ts` (tiny param builder), `tests/helpers/find-free-port.ts`, `tests/fixtures/launch-contract-matrix.ts`.

**App launch** — fixture `test.extend` provides `homeDir`, `userDataDir`, `launchElectronApp`, `electronApp`, `page`. `homeDir`/`userDataDir` are fresh `mkdtemp` dirs, cleaned up unless `CLAWX_E2E_KEEP_TEMP=1`. The launcher (`electron.ts:156-210`):

```ts
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');

return await electron.launch({
  executablePath: electronBinaryPath,
  args: [
    '--lang=en-US', '--disable-gpu', '--disable-gpu-compositing',
    '--disable-software-rasterizer', '--in-process-gpu',
    '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization',
    electronEntry,
  ],
  env: {
    ...process.env,
    ...electronEnv,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: join(homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: 'en',
    VERSE_CLAW_E2E: '1',            // <-- always set; cannot be opted out per-test
    CLAWX_AGENT_DEV: '1',
    ...(options.flags?.length ? { CLAWX_FLAGS: options.flags.join(',') } : {}),
    ...(options.visualMode ? { CLAWX_VISUAL_MODE: '1' } : {}),
    ...(options.devScenario ? { CLAWX_DEV_SCENARIO: options.devScenario } : {}),
    VERSE_CLAW_USER_DATA_DIR: userDataDir,
    ...(options.skipSetup ? { VERSE_CLAW_E2E_SKIP_SETUP: '1' } : {}),
    VERSE_CLAW_PORT_CLAWX_HOST_API: String(hostApiPort),
    VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(cdpPort),
  },
  timeout: 90_000,
});
```

`LaunchElectronOptions` = `{ skipSetup?, flags?, visualMode?, devScenario?, bootHoldMs?, settingsSectionDelayMs?, theme? }`. Note `VERSE_CLAW_E2E: '1'` is unconditional — a spec cannot disable it via the fixture, which is exactly why the manual `gateway.start` route is the only real-gateway path.

**RPC from a test** — every FP spec re-declares the identical `hostInvoke`, reaching into Playwright's `app.evaluate` and pulling the registered `host:invoke` handler out of `ipcMain._invokeHandlers`, synthesizing a fake event with a real `webContents` sender so the sender-auth check passes:

```ts
async function hostInvoke<T>(
  app: ElectronApplication, module: string, action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = (await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require(
      'electron',
    ) as typeof import('electron');
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `fp-p1-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}
```

Gateway JSON-RPC is `hostInvoke(app, 'gateway', 'rpc', { method, params, timeoutMs })`. `installIpcMocks` in the fixture is the *opposite* profile (stubs `host:invoke`) — do not use it for FP-P1-07/11.

## 5. Existing `fp-p*` specs and their setup pattern

| Spec (all under `tests/e2e/`) | Task | Gateway | LLM |
|---|---|---|---|
| `runtime-launch-contract-fp-p0.spec.ts` | FP-P0-01/02/03/04/05 | real, manual start | none |
| `config-schema-parity-fp-p0-06.spec.ts` | FP-P0-06 | real, manual start | none |
| `setup-first-run-fp-p1-01.spec.ts` | FP-P1-01 | real | local `/models` HTTP server w/ bearer auth |
| `workspace-preflight-fp-p1-02.spec.ts` | FP-P1-02 | real | same `/models` server; `dialog.showOpenDialog` stubbed |
| `dcs-preview-optin-fp-p1-03.spec.ts` | FP-P1-03 | real | none — drives real Settings DOM |
| `coding-loop-fp-p1-04.spec.ts` | FP-P1-04 | real | **self-contained scripted OpenAI-completions server** |
| `support-bundle-fp-p1-06.spec.ts` | FP-P1-06 | real | none |
| `dcs-flag-ack-tuning-fp-p1-09.spec.ts` | FP-P1-09 | real, restarted per iteration | none |

Uniform shape across all eight: `mkdtemp` workspace → write config to both `~/.openclaw/openclaw.json` and `<userDataDir>/openclaw-source-state/openclaw.json` → `launchElectronApp({ skipSetup: true })` → `getStableWindow` + `expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 })` → allocate port → `settings.set gatewayPort` → poll `gateway.status` / call `gateway.start` → assert → `finally { closeElectronApp(app); rm(workspaceDir); restore env }`. Each duplicates `allocatePort`/`hostInvoke`/`startGateway` locally. Evidence is emitted as `console.log('[fp-p1-XX-…]', JSON.stringify(...))` with an eslint-disable comment.

**FP-P1-04 is the closest template for FP-P1-07/11** — it is the only spec that drives a real agent turn with tools. `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\coding-loop-fp-p1-04.spec.ts`. Its scripted LLM decides the next tool from which of its own call-ids already have tool results in the transcript — self-contained, no runtime edit:

```ts
function nextAction(userText: string, results: Record<string, string>) {
  if (userText.includes('FIX-THE-BUG')) {
    if (!('call-read' in results)) {
      return { toolCall: { id: 'call-read', name: 'read', args: { path: 'util.js' } } };
    }
    if (!('call-edit' in results)) {
      return { toolCall: { id: 'call-edit', name: 'edit', args: {
        path: 'util.js', edits: [{ oldText: '  return a - b;', newText: FIXED_LINE }],
      } } };
    }
    if (!('call-bash' in results)) {
      return { toolCall: { id: 'call-bash', name: 'bash', args: { command: 'node --check util.js' } } };
    }
    return { text: 'Fixed add() to use a + b; syntax check ran. Review the diff above.' };
  }
  ...
}
```

FP-P1-04's turn driver goes through `chat.sendWithMedia` (not `chat.send` + `agent.wait`) and polls the **LLM server's own log** for completion:

```ts
await hostInvoke<Record<string, unknown>>(app, 'chat', 'sendWithMedia', {
  sessionKey: 'agent:main:main',
  message,
  idempotencyKey: `fp-p1-04-${Date.now()}-${Math.random()}`,
});
// then poll `log` for a `text:` entry matching finalMarker, +2s flush
```

It already emits the FP-P1-11 anchor:

```ts
const ack = await hostInvoke<Record<string, unknown>>(app, 'gateway', 'rpc', {
  method: 'runtime.flags.ack', params: {}, timeoutMs: 30_000,
});
const budget = (ack as { injectionBudget?: { counters?: Record<string, number> } }).injectionBudget;
console.log('[fp-p1-04-budget]', JSON.stringify(budget));
expect(budget?.counters?.turns ?? 0).toBeGreaterThan(0);
```

`test.setTimeout(1_500_000)`.

### The already-extracted shared harness — use this

`C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\fixtures\fp-p1-harness.ts` (286 lines, untracked, **zero importers today**) is FP-P1-04's pattern already generalized, and its header names FP-P1-07 route A explicitly. Exports:

- `MOCK_MODEL_ID = 'mock-coder'`
- `allocatePort()`, `hostInvoke<T>(app, module, action, payload)`
- `startGateway(app, { port? }): Promise<number>` — 240s deadline, up to 10 start attempts
- `startScriptedLlm(script: LlmScript)` → `{ server, port, log }`; `LlmScript = (userText, toolResults) => { toolCall?, text? }`. Serves `/v1/models` and `/chat/completions`, supports SSE + non-streaming, records `LlmRequestLog[] = { turn, toolResults, issued }`
- `buildMockProviderConfig(llmPort, workspaceDir, extraRuntime = {})` — openai-completions provider at `http://127.0.0.1:${llmPort}/v1`, `working-memory` + `tool-registry` enabled, `coding.staleWriteGuard.enabled`, `skipBootstrap: true`, `skills.allowBundled: []`. The `extraRuntime` spread is the hook for FP-P1-11's extra injection sources.
- `sendTurn(app, log, message, finalMarker)`

Two routes for FP-P1-07/11, and they differ materially:
- **Route A (fp-p1-harness / FP-P1-04 style):** `openai-completions` + `chat.sendWithMedia`, scripted in the test file. No runtime edits. Already written.
- **Route W5 (`startQaMockOpenAiServer`):** `openai-responses` + `chat.send`/`agent.wait`, scenario lives in `openclaw_runtime/extensions/qa-lab/src/providers/mock-openai/server.ts` and gives you `/debug/requests` introspection for free — but a new prompt scenario means editing runtime code. FP-P1-11's task doc recommends this one; FP-P1-04's precedent argues for A.

### FP-P1-11 specifics

`injectionBudget` is produced by `openclaw_runtime/src/context-engine/runtime-flag-ack.ts` — type at line 121, `readInjectionBudgetEvidence()` at line 275, wired at line 377. It reads `dcsObservability.snapshot()` and exposes `{ totalChars, precedence, dropAlertRatio, counters: { turns, killedTurns, appliedChars, requestedChars, droppedChars, truncatedChars, dropAlerts } }`.

**Gap the implementer must close:** FP-P1-11 acceptance requires `byChannel` and `degradationOrder`. Those exist on `TurnInjectionAccounting` in `openclaw_runtime/src/context-engine/turn-injection-budget.ts` (lines 117, 119, 229-267) but are **NOT** in the `runtime.flags.ack` payload — only the flat scalar counters are. Asserting "≥2 sources appear in `byChannel`" needs `readInjectionBudgetEvidence()` extended first.

### Trap: the Electron-side mock provider short-circuit

`electron/services/chat-api.ts:371` calls `handleMockChatSend` **before** any gateway RPC, returning a fixed `MOCK_PROVIDER_RESPONSE` and skipping the real turn entirely. Gate (`electron/services/mock-provider.ts:27`):

```ts
export function isMockProviderEnabled(): boolean {
  return process.env.OPENCLAW_TEST_ENABLE_MOCK_PROVIDER === '1'
    && typeof process.env.VERSE_CLAW_USER_DATA_DIR === 'string'
    && process.env.VERSE_CLAW_USER_DATA_DIR.trim().length > 0
    && process.env.VERSE_CLAW_OPENCLAW_RUNTIME === 'source'
    && !app.isPackaged;
}
```

`VERSE_CLAW_USER_DATA_DIR` is always set by the fixture, so **`OPENCLAW_TEST_ENABLE_MOCK_PROVIDER` must never be `1`** in an FP-P1-07/11 run — otherwise no real turn happens and every budget counter stays 0.

## 6. `test:e2e` / `test:e2e:run`

`C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\package.json`:

```json
"test:e2e": "pnpm run build:vite && playwright test",
"test:e2e:run": "playwright test",
"test:e2e:headed": "pnpm run build:vite && playwright test --headed",
```

`build:vite` = `node --max-old-space-size=6144 ./node_modules/vite/bin/vite.js build`, with `prebuild:vite` = `node scripts/generate-ext-bridge.mjs`. So `test:e2e` rebuilds the renderer (`dist/`) first; `test:e2e:run` assumes it is current. Neither builds `dist-electron/main/index.js`, which the fixture launches — that comes from the separate electron build, so a stale `dist-electron` silently tests old main-process code.

`playwright.config.ts`: `testDir: './tests/e2e'`, `fullyParallel: false`, `workers: 1`, `timeout: 90_000` (hence every FP spec's own `test.setTimeout`), `expect.timeout: 15_000`, retries 2 on CI, trace/screenshot/video retained on failure.

Task docs prescribe `pnpm run test:e2e:run tests/e2e/<spec>.spec.ts --workers=1`, with artifacts to `artifacts/first-product-preview/FP-P1-07/`.