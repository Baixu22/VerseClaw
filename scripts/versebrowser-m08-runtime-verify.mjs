import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('@playwright/test');
const electronBinaryPath = require('electron');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = join(repoRoot, 'harness', 'specs', 'fixtures', 'versebrowser-reintegration', 'm08');
mkdirSync(evidenceDir, { recursive: true });
const runId = `m08-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
// This isolated home contains provider credentials; never create it in an addable source path.
const runRoot = mkdtempSync(join(tmpdir(), 'versebrowser-m08-runtime-'));
const homeDir = join(runRoot, 'home');
const userDataDir = join(runRoot, 'user-data');
const stateDir = join(runRoot, 'openclaw-state');
mkdirSync(join(homeDir, '.openclaw'), { recursive: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });
const configSource = join(process.env.USERPROFILE, '.openclaw', 'openclaw.json');
const llmEnvSource = 'D:/versebrowser/.local/config/third-party-llm.env';
if (!existsSync(configSource)) throw new Error(`OpenClaw config not found: ${configSource}`);
if (!existsSync(llmEnvSource)) throw new Error(`local model env not found: ${llmEnvSource}`);
const llmEnv = Object.fromEntries(readFileSync(llmEnvSource, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const llmBaseUrl = String(process.env.M08_LLM_BASE_URL || llmEnv.VERSE_LLM_BASE || '').replace(/\/$/, '');
const llmApiKey = String(process.env.M08_LLM_API_KEY || llmEnv.VERSE_LLM_KEY || '');
const llmModel = String(process.env.M08_LLM_MODEL || llmEnv.VERSE_LLM_MODEL || '');
if (!llmBaseUrl || !llmApiKey || !llmModel) throw new Error('local provider env incomplete');
const configTarget = join(homeDir, '.openclaw', 'openclaw.json');
const localConfig = JSON.parse(readFileSync(configSource, 'utf8'));
localConfig.models = localConfig.models && typeof localConfig.models === 'object' ? localConfig.models : {};
localConfig.models.providers = localConfig.models.providers && typeof localConfig.models.providers === 'object' ? localConfig.models.providers : {};
localConfig.models.providers['m08-local'] = {
  baseUrl: `${llmBaseUrl}/v1`,
  api: 'openai-responses',
  apiKey: llmApiKey,
  models: [{ id: llmModel, name: llmModel }],
};
const modelRef = `m08-local/${llmModel}`;
localConfig.agents = localConfig.agents && typeof localConfig.agents === 'object' ? localConfig.agents : {};
localConfig.agents.defaults = localConfig.agents.defaults && typeof localConfig.agents.defaults === 'object' ? localConfig.agents.defaults : {};
localConfig.agents.defaults.model = { ...(localConfig.agents.defaults.model || {}), primary: modelRef, fallbacks: [] };
localConfig.agents.list = Array.isArray(localConfig.agents.list) ? localConfig.agents.list : [];
if (localConfig.agents.list.length === 0) localConfig.agents.list.push({ id: 'main', default: true, model: { primary: modelRef } });
for (const agent of localConfig.agents.list) {
  if (agent && typeof agent === 'object') agent.model = { ...(agent.model || {}), primary: modelRef };
}
writeFileSync(configTarget, `${JSON.stringify(localConfig, null, 2)}\n`);
writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }, null, 2));

// Seed an isolated agent auth profile, then let the runtime's own doctor migrate it into its SQLite store.
const sourceHome = join(userDataDir, 'openclaw-source-home');
const sourceState = join(userDataDir, 'openclaw-source-state');
const sourceAgentDir = join(sourceHome, '.openclaw', 'agents', 'main', 'agent');
mkdirSync(sourceAgentDir, { recursive: true });
mkdirSync(sourceState, { recursive: true });
copyFileSync(configTarget, join(sourceHome, '.openclaw', 'openclaw.json'));
writeFileSync(join(sourceAgentDir, 'auth-profiles.json'), `${JSON.stringify({ version: 1, profiles: { 'm08-local:default': { type: 'api_key', provider: 'm08-local', key: llmApiKey } } }, null, 2)}\n`);
execFileSync(process.execPath, [join(repoRoot, 'openclaw_runtime', 'dist', 'entry.js'), 'doctor', '--fix', '--json'], {
  cwd: repoRoot,
  env: { ...process.env, OPENCLAW_HOME: sourceHome, OPENCLAW_STATE_DIR: sourceState, OPENCLAW_CONFIG_PATH: join(sourceHome, '.openclaw', 'openclaw.json') },
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 10 * 1024 * 1024,
});

const sessionKey = `agent:main:${runId}`;
const taskId = `${runId}-task`;
const pageId = `${runId}-page`;
const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><title>M08 Fixture</title></head><body><h1 id="heading">M08 FIXTURE READY</h1></body></html>');
});
await new Promise((resolveListen, reject) => {
  fixture.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolveListen());
});
const address = fixture.address();
if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
const fixtureUrl = `http://127.0.0.1:${address.port}/`;

const launchArgs = [
  ...(process.platform === 'win32' && process.env.ELECTRON_DISABLE_SANDBOX === '1' ? ['--no-sandbox'] : []),
  `--user-data-dir=${userDataDir}`,
  '--lang=en-US',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-software-rasterizer',
  '--in-process-gpu',
  '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization',
  join(repoRoot, 'dist-electron', 'main', 'index.js'),
];
const app = await electron.launch({
  executablePath: String(electronBinaryPath),
  args: launchArgs,
  env: {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: join(homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LANGUAGE: 'en',
    VERSE_CLAW_E2E: '1',
    CLAWX_AGENT_DEV: '1',
    VERSE_CLAW_USER_DATA_DIR: userDataDir,
    VERSE_CLAW_E2E_SKIP_SETUP: '1',
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: join(homeDir, '.openclaw', 'openclaw.json'),
    TEMP: runRoot,
    TMP: runRoot,
  },
  timeout: 90_000,
});
const appOutput = [];
for (const stream of [app.process().stdout, app.process().stderr]) {
  stream?.on('data', (chunk) => {
    const text = String(chunk);
    appOutput.push(text);
    process.stderr.write(text);
  });
}


async function hostInvoke(page, module, action, payload, timeoutMs = 120_000) {
  return await page.evaluate(async ({ module, action, payload }) => {
    const bridge = window.verseClaw?.hostInvoke;
    if (!bridge) throw new Error('hostInvoke bridge unavailable');
    const response = await bridge({
      id: crypto.randomUUID(),
      module,
      action,
      ...(payload === undefined ? {} : { payload }),
    });
    if (!response.ok) throw new Error(response.error?.message || response.error?.code || 'hostInvoke failed');
    return response.data;
  }, { module, action, payload, timeoutMs });
}

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  const setup = page.getByTestId('setup-skip-button');
  if (await setup.isVisible().catch(() => false)) await setup.click();

  let gateway = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    gateway = await hostInvoke(page, 'gateway', 'status', undefined, 10_000).catch((error) => ({ error: String(error) }));
    if (gateway?.gatewayReady === true || gateway?.state === 'running') break;
    if (gateway?.state !== 'starting') await hostInvoke(page, 'gateway', 'start', undefined, 30_000).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  if (!(gateway?.gatewayReady === true || gateway?.state === 'running')) {
    throw new Error(`Gateway not ready: ${JSON.stringify(gateway)}`);
  }

  const preflightStartedAt = Date.now();
  const preflightOpen = await hostInvoke(page, 'agentBrowser', 'open', {
    url: fixtureUrl,
    mode: 'headless',
    profile: `${runId}-preflight`,
    sessionKey,
    agentId: 'main',
  }, 180_000);
  const preflightOpenMs = Date.now() - preflightStartedAt;
  if (preflightOpen?.session?.id) {
    await hostInvoke(page, 'agentBrowser', 'close', { sessionId: preflightOpen.session.id }, 30_000).catch(() => undefined);
  }

  const prompt = [
    'This is a controlled runtime verification.',
    `Call the agent_browser tool exactly once with action="open", url="${fixtureUrl}", mode="headless", profile="${runId}", taskId="${taskId}", pageId="${pageId}".`,
    'Do not call any other tool. After the tool result arrives, reply with exactly the text visible in the h1 element.',
  ].join(' ');
  const send = await hostInvoke(page, 'chat', 'sendWithMedia', {
    sessionKey,
    message: prompt,
    deliver: false,
    idempotencyKey: runId,
  }, 180_000);

  let history = null;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    history = await hostInvoke(page, 'gateway', 'rpc', {
      method: 'chat.history',
      params: { sessionKey, limit: 100 },
      timeoutMs: 10_000,
    }, 20_000).catch((error) => ({ error: String(error) }));
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    const assistantCount = messages.filter((message) => message?.role === 'assistant').length;
    const hasToolResult = messages.some((message) => message?.role === 'toolResult' || message?.role === 'tool');
    if (hasToolResult && assistantCount >= 2 && history?.inFlightRun === undefined) break;
    await page.waitForTimeout(1000);
  }

  const status = await hostInvoke(page, 'agentBrowser', 'status', undefined, 10_000);
  const messages = Array.isArray(history?.messages) ? history.messages : [];
  const serialized = JSON.stringify(messages);
  const ownerKey = sessionKey.toLowerCase();
  const ownedSessions = Array.isArray(status?.sessions)
    ? status.sessions.filter((session) => String(session?.sessionKey ?? '').toLowerCase() === ownerKey)
    : [];
  const assistantMessages = messages.filter((message) => message?.role === 'assistant');
  const toolMessages = messages.filter((message) => message?.role === 'tool');
  const result = {
    schemaVersion: 1,
    artifact: 'versebrowser-m08-real-runtime-result',
    driven_by: 'agent',
    actor: 'codex',
    runId,
    fixtureUrl,
    sessionKey,
    taskId,
    pageId,
    launchArgs,
    preflightOpen,
    preflightOpenMs,
    appOutput: appOutput.slice(-500),
    gateway,
    send,
    messageCount: messages.length,
    assistantMessages,
    toolMessages,
    ownedSessions,
    allSessions: status?.sessions ?? [],
    checks: {
      realModelResultReceived: assistantMessages.length > 0,
      toolCallObserved: serialized.includes('agent_browser'),
      toolResultContainsFixtureHeading: serialized.includes('M08 FIXTURE READY'),
      gatewayRequestCorrelationPresent: serialized.includes('gatewayRequestId'),
      taskCorrelationPresent: serialized.includes(taskId),
      pageCorrelationPresent: serialized.includes(pageId),
      sessionOwnershipPresent: ownedSessions.length > 0,
    },
    history,
  };
  result.status = Object.values(result.checks).every(Boolean) ? 'pass' : 'fail';
  writeFileSync(join(evidenceDir, 'm08-real-runtime-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
} finally {
  await app.close().catch(() => undefined);
  await new Promise((resolveClose) => fixture.close(() => resolveClose()));
  rmSync(runRoot, { recursive: true, force: true });
}


