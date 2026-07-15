import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ElectronApplication } from '@playwright/test';
import { startQaMockOpenAiServer } from '../../openclaw_runtime/extensions/qa-lab/src/providers/mock-openai/server';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { message?: string } };
type ProviderRequest = Record<string, unknown>;
type SessionsListResult = { sessions?: Array<{ key?: string; agentId?: string }> };

type ContextBlockRow = {
  block_id: string;
  block_type: string;
  source_system: string;
  session_id: string | null;
  summary: string;
  full_content: string | null;
  presence_json: string;
  mutability: string;
  role_scope: string | null;
  invalid_at: number | null;
};

const MODEL_ID = 'gpt-5.5';
// Match QA Lab's proven OpenAI Responses harness. Using the dedicated mock
// provider exercises the normal embedded-agent tool loop without requiring
// the production OpenAI model-provider plugin.
const PROVIDER_ID = 'mock-openai';
const NOTE_MARKER = 'dcs-w5-note';
const OFF_PROMPT = 'DCS_W5_OFF: return the fixed off-path marker without tools.';
const MAIN_PROMPT = 'DCS_W5_MAIN: execute the scripted production wiring proof.';
const READ_ONLY_PROMPT = 'DCS_W5_READ_ONLY: read notes without modifying context.';
const DCS_TOOL_NAMES = ['context_read', 'context_search', 'context_write'] as const;

async function readProviderRequests(baseUrl: string): Promise<ProviderRequest[]> {
  const response = await fetch(`${baseUrl}/debug/requests`);
  if (!response.ok) throw new Error(`provider debug requests failed: ${response.status}`);
  const snapshots = await response.json() as Array<{ body?: ProviderRequest }>;
  return snapshots.map((snapshot) => snapshot.body ?? {});
}

function providerRequestDiagnostics(requests: ProviderRequest[]): string {
  const recent = requests.slice(-4).map((request) => ({
    model: request.model,
    stream: request.stream,
    instructions: typeof request.instructions === 'string'
      ? request.instructions.slice(-2_000)
      : undefined,
    input: Array.isArray(request.input) ? request.input : undefined,
    toolNames: Array.isArray(request.tools)
      ? request.tools.map((tool) => (tool && typeof tool === 'object' ? (tool as Record<string, unknown>).name : undefined))
      : undefined,
  }));
  return JSON.stringify(recent, null, 2).slice(-12_000);
}

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
          request: { allowPrivateNetwork: true },
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

async function seedUserOpenClawOnly(
  homeDir: string,
  workspaceDir: string,
  baseUrl: string,
  enabled: boolean,
): Promise<void> {
  const openclawDir = join(homeDir, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  const serialized = `${JSON.stringify(buildOpenClawConfig(workspaceDir, baseUrl, enabled), null, 2)}\n`;
  await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
  // Intentionally do NOT pre-seed userData/openclaw-source-state/openclaw.json.
  // prepareSourceRuntimeIsolation + config-sync must carry runtime flags.
}

async function seedIsolatedWithoutRuntime(
  userDataDir: string,
  workspaceDir: string,
  baseUrl: string,
): Promise<void> {
  const sourceStateDir = join(userDataDir, 'openclaw-source-state');
  await mkdir(sourceStateDir, { recursive: true });
  const config = buildOpenClawConfig(workspaceDir, baseUrl, false);
  // Strip runtime so the user config is the only source of DCS flags.
  delete (config as { runtime?: unknown }).runtime;
  await writeFile(
    join(sourceStateDir, 'openclaw.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  );
}
async function seedOpenClaw(
  homeDir: string,
  userDataDir: string,
  workspaceDir: string,
  baseUrl: string,
  enabled: boolean,
): Promise<void> {
  const openclawDir = join(homeDir, '.openclaw');
  const sourceStateDir = join(userDataDir, 'openclaw-source-state');
  await mkdir(openclawDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  const serialized = `${JSON.stringify(buildOpenClawConfig(workspaceDir, baseUrl, enabled), null, 2)}\n`;
  await writeFile(join(openclawDir, 'openclaw.json'), serialized, 'utf8');
  // Source-runtime isolation owns the production Gateway config and SQLite DB.
  // Pre-seeding this file keeps runtime.contextBlock flags that config-sync does
  // not copy from the desktop-facing ~/.openclaw config.
  await writeFile(join(sourceStateDir, 'openclaw.json'), serialized, 'utf8');
}

async function hostInvoke<T>(app: ElectronApplication, module: string, action: string, payload: Record<string, unknown> | null = null): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    return await handler({}, { id: `w5-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 180_000;
  let startAttempts = 0;
  let lastStatus: { state?: string; gatewayReady?: boolean } | undefined;
  let lastStartAt = 0;

  while (Date.now() < deadline) {
    try {
      lastStatus = await hostInvoke<{ state?: string; gatewayReady?: boolean }>(app, 'gateway', 'status');
      if (lastStatus.gatewayReady === true || lastStatus.state === 'running') return;
      if (
        lastStatus.state !== 'starting'
        && startAttempts < 3
        && Date.now() - lastStartAt >= 10_000
      ) {
        startAttempts += 1;
        lastStartAt = Date.now();
        await hostInvoke(app, 'gateway', 'start').catch(() => undefined);
      }
    } catch {
      // The next poll reports whether the Electron-owned host route recovers.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`Gateway did not become ready: ${JSON.stringify({ lastStatus, startAttempts })}`);
}

async function createSession(app: ElectronApplication, label: string): Promise<string> {
  const uniqueLabel = `${label}-${randomUUID()}`;
  let lastError: unknown;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const listed = await hostInvoke<SessionsListResult>(app, 'gateway', 'rpc', {
        method: 'sessions.list', params: { agentId: 'main' }, timeoutMs: 60_000,
      });
      const existing = (listed.sessions ?? []).find((session) => typeof session.key === 'string' && session.key);
      if (existing?.key) return existing.key;
    } catch (error) {
      lastError = error;
    }
    try {
      const created = await hostInvoke<{ key?: string; sessionKey?: string }>(app, 'gateway', 'rpc', {
        method: 'sessions.create', params: { agentId: 'main', label: uniqueLabel }, timeoutMs: 60_000,
      });
      const key = created.key ?? created.sessionKey;
      if (key) return key;
      lastError = new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
    } catch {
      await ensureGatewayReady(app).catch(() => undefined);
      try {
        const raced = await hostInvoke<SessionsListResult>(app, 'gateway', 'rpc', {
          method: 'sessions.list', params: { agentId: 'main' }, timeoutMs: 60_000,
        });
        const existing = (raced.sessions ?? []).find((session) => typeof session.key === 'string' && session.key);
        if (existing?.key) return existing.key;
      } catch (listError) {
        lastError = listError;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw lastError instanceof Error ? lastError : new Error(`sessions.create failed: ${String(lastError)}`);
}

async function runAgent(
  app: ElectronApplication,
  sessionKey: string,
  message: string,
  providerBaseUrl: string,
): Promise<Record<string, unknown>> {
  // Reuse QA Lab's proven real Gateway coding-chat surface. This still runs
  // through the Electron-owned Gateway and embedded agent, while avoiding a
  // second test-only RPC loop around model tool continuations.
  const endpoint = await hostInvoke<{ token?: string; port?: number }>(app, 'gateway', 'controlUi');
  expect(endpoint.token).toBeTruthy();
  expect(endpoint.port).toBeTruthy();
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${endpoint.token}`,
      'content-type': 'application/json',
      'x-openclaw-agent': 'main',
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({
      model: 'openclaw/main',
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      }],
      max_output_tokens: 512,
      stream: false,
    }),
  });
  const text = await response.text();
  const diagnostics = response.ok ? '' : `\nmock provider requests:\n${providerRequestDiagnostics(await readProviderRequests(providerBaseUrl))}`;
  expect(response.ok, `${text}${diagnostics}`).toBe(true);
  return JSON.parse(text) as Record<string, unknown>;
}

function readContextRows(userDataDir: string): ContextBlockRow[] {
  const db = new DatabaseSync(join(userDataDir, 'openclaw-source-state', 'state', 'openclaw.sqlite'), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 30000;');
    return db.prepare(`SELECT block_id, block_type, source_system, session_id, summary, full_content,
      presence_json, mutability, role_scope, invalid_at FROM context_blocks ORDER BY block_type, block_id`).all() as ContextBlockRow[];
  } finally {
    db.close();
  }
}

async function waitForRows(userDataDir: string, expectedTypes: string[]): Promise<ContextBlockRow[]> {
  let rows: ContextBlockRow[] = [];
  await expect.poll(() => {
    try { rows = readContextRows(userDataDir); } catch { rows = []; }
    return expectedTypes.every((type) => rows.some((row) => row.block_type === type && row.invalid_at === null));
  }, { intervals: [500, 1_000, 2_000], timeout: 30_000 }).toBe(true);
  return rows;
}

function toolMetrics(requests: ProviderRequest[]): {
  requestCount: number;
  toolCount: number;
  schemaChars: number;
  schemaUtf8Bytes: number;
  codegraphCount: number;
} {
  const largest = requests
    .map((request) => Array.isArray(request.tools) ? request.tools as Array<Record<string, unknown>> : [])
    .sort((left, right) => right.length - left.length)[0] ?? [];
  const schema = JSON.stringify(largest);
  return {
    requestCount: requests.length,
    toolCount: largest.length,
    schemaChars: schema.length,
    schemaUtf8Bytes: Buffer.byteLength(schema, 'utf8'),
    codegraphCount: largest.filter((tool) => String(tool.name ?? '').startsWith('codegraph_')).length,
  };
}

function getToolSchema(requests: ProviderRequest[], name: string): Record<string, unknown> | undefined {
  for (const request of requests) {
    const tool = (Array.isArray(request.tools) ? request.tools : []).find((candidate) =>
      candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).name === name,
    );
    if (tool && typeof tool === 'object') return tool as Record<string, unknown>;
  }
  return undefined;
}

function collectToolOutputStrings(requests: ProviderRequest[]): string[] {
  const outputs: string[] = [];
  for (const request of requests) {
    if (!Array.isArray(request.input)) continue;
    for (const item of request.input) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (record.type === 'function_call_output' && typeof record.output === 'string') {
        outputs.push(record.output);
      }
    }
  }
  return outputs;
}

function parseToolOutput(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

test.describe('DCS W5 production wiring via real Windows Electron Gateway', () => {
  test.describe.configure({ timeout: 480_000 });

  test('default-off exposes on-demand context tools without leaking always-on DCS blocks', async ({ homeDir, userDataDir, launchElectronApp }) => {
    test.setTimeout(420_000);
    const provider = await startQaMockOpenAiServer();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-w5-off-'));
    await seedOpenClaw(homeDir, userDataDir, workspaceDir, `${provider.baseUrl}/v1`, false);
    const previousSekb = process.env.OPENCLAW_SEKB_ENABLED;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousNoProxy = process.env.NO_PROXY;
    process.env.OPENCLAW_SEKB_ENABLED = '0';
    process.env.OPENAI_API_KEY = 'w5-test-key';
    process.env.NO_PROXY = '127.0.0.1,localhost';
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await hostInvoke(app, 'workspaces', 'create', { name: 'DCS W5 Off', rootPath: workspaceDir, permissionMode: 'fullAccess' });
      await ensureGatewayReady(app);
      const sessionKey = await createSession(app, 'dcs-w5-off');
      await runAgent(app, sessionKey, OFF_PROMPT, provider.baseUrl);

      const providerRequests = await readProviderRequests(provider.baseUrl);
      const metrics = toolMetrics(providerRequests);
      console.log('[dcs-w5-metrics:off]', JSON.stringify(metrics));
      for (const name of DCS_TOOL_NAMES) expect(getToolSchema(providerRequests, name), `${name} missing from provider tools`).toBeTruthy();
      expect(metrics.toolCount).toBeGreaterThanOrEqual(DCS_TOOL_NAMES.length);

      let rows: ContextBlockRow[] = [];
      try { rows = readContextRows(userDataDir); } catch { rows = []; }
      const leaked = rows.filter((row) => ['working_memory', 'tool_registry', 'task_state'].includes(row.block_type))
        .filter((row) => JSON.parse(row.presence_json).always_on === true);
      expect(leaked, JSON.stringify(rows, null, 2)).toEqual([]);
      expect(rows.some((row) => row.block_type === 'experience')).toBe(false);
    } finally {
      await closeElectronApp(app);
      await provider.stop();
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousSekb === undefined) delete process.env.OPENCLAW_SEKB_ENABLED;
      else process.env.OPENCLAW_SEKB_ENABLED = previousSekb;
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = previousNoProxy;
    }
  });

  test('enabled flags persist real tool/notes blocks and context_read is non-destructive', async ({ homeDir, userDataDir, launchElectronApp }) => {
    test.setTimeout(480_000);
    const provider = await startQaMockOpenAiServer();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-w5-on-'));
    await seedOpenClaw(homeDir, userDataDir, workspaceDir, `${provider.baseUrl}/v1`, true);
    const previousSekb = process.env.OPENCLAW_SEKB_ENABLED;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousNoProxy = process.env.NO_PROXY;
    process.env.OPENCLAW_SEKB_ENABLED = '0';
    process.env.OPENAI_API_KEY = 'w5-test-key';
    process.env.NO_PROXY = '127.0.0.1,localhost';
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await hostInvoke(app, 'workspaces', 'create', { name: 'DCS W5 On', rootPath: workspaceDir, permissionMode: 'fullAccess' });
      await ensureGatewayReady(app);
      const sessionKey = await createSession(app, 'dcs-w5-on');
      await runAgent(app, sessionKey, MAIN_PROMPT, provider.baseUrl);

      let providerRequests = await readProviderRequests(provider.baseUrl);
      const metrics = toolMetrics(providerRequests);
      console.log('[dcs-w5-metrics:on]', JSON.stringify(metrics));
      for (const name of DCS_TOOL_NAMES) expect(getToolSchema(providerRequests, name), `${name} missing`).toBeTruthy();

      const contextWrite = getToolSchema(providerRequests, 'context_write');
      const parameters = contextWrite?.parameters as Record<string, unknown> | undefined;
      const properties = parameters?.properties as Record<string, unknown> | undefined;
      expect(properties).toBeTruthy();
      expect(properties).not.toHaveProperty('role');
      expect(properties).not.toHaveProperty('block_type');

      const toolOutputStrings = collectToolOutputStrings(providerRequests);
      const toolOutputs = toolOutputStrings.map(parseToolOutput).filter((output): output is Record<string, unknown> => output !== null);
      const rejectedWrite = toolOutputs.find((output) => output.accepted === false);
      const acceptedWrite = toolOutputs.find((output) => output.accepted === true && output.role === 'implementer');
      expect(rejectedWrite?.reason).toBe("invalid operation 'delete' (expected append|replace|clear)");
      expect(acceptedWrite?.whitelist).toEqual(['planner', 'architect', 'implementer']);
      expect(toolOutputStrings.join('\n')).toContain(NOTE_MARKER);

      const rows = await waitForRows(userDataDir, ['tool_registry', 'notes']);
      expect(rows.some((row) => row.block_type === 'experience')).toBe(false);
      const notes = rows.filter((row) => row.block_type === 'notes' && row.invalid_at === null);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ source_system: 'agent-notes', mutability: 'agent_writable', full_content: NOTE_MARKER });
      expect(rows.filter((row) => row.source_system === 'agent-notes').every((row) => row.block_type === 'notes')).toBe(true);

      const before = rows.filter((row) => row.block_type === 'notes');
      await runAgent(app, sessionKey, READ_ONLY_PROMPT, provider.baseUrl);
      providerRequests = await readProviderRequests(provider.baseUrl);
      const after = readContextRows(userDataDir).filter((row) => row.block_type === 'notes');
      expect(after).toEqual(before);
      expect(JSON.stringify(providerRequests.slice(-2))).toContain('context_read');
      expect(readContextRows(userDataDir).some((row) => row.block_type === 'experience')).toBe(false);
    } finally {
      await closeElectronApp(app);
      await provider.stop();
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousSekb === undefined) delete process.env.OPENCLAW_SEKB_ENABLED;
      else process.env.OPENCLAW_SEKB_ENABLED = previousSekb;
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = previousNoProxy;
    }
  });
  test('config-sync copies user runtime.contextBlock flags into openclaw-source-state', async ({ homeDir, userDataDir, launchElectronApp }) => {
    test.setTimeout(300_000);
    const provider = await startQaMockOpenAiServer();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-w5-sync-'));
    // User-facing config has DCS flags enabled; isolated config starts without runtime.
    await seedUserOpenClawOnly(homeDir, workspaceDir, `${provider.baseUrl}/v1`, true);
    await seedIsolatedWithoutRuntime(userDataDir, workspaceDir, `${provider.baseUrl}/v1`);
    const previousSekb = process.env.OPENCLAW_SEKB_ENABLED;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousNoProxy = process.env.NO_PROXY;
    process.env.OPENCLAW_SEKB_ENABLED = '0';
    process.env.OPENAI_API_KEY = 'w5-test-key';
    process.env.NO_PROXY = '127.0.0.1,localhost';
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      // Gateway launch runs prepareSourceRuntimeIsolation which must merge runtime.
      await ensureGatewayReady(app);

      const isolatedPath = join(userDataDir, 'openclaw-source-state', 'openclaw.json');
      const isolated = JSON.parse(await readFile(isolatedPath, 'utf8')) as {
        runtime?: {
          contextBlock?: Record<string, { enabled?: boolean }>;
        };
      };
      expect(isolated.runtime?.contextBlock?.['working-memory']?.enabled, JSON.stringify(isolated.runtime)).toBe(true);
      expect(isolated.runtime?.contextBlock?.['tool-registry']?.enabled).toBe(true);
      expect(isolated.runtime?.contextBlock?.sekb?.enabled).toBe(false);
    } finally {
      await closeElectronApp(app);
      await provider.stop();
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousSekb === undefined) delete process.env.OPENCLAW_SEKB_ENABLED;
      else process.env.OPENCLAW_SEKB_ENABLED = previousSekb;
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = previousNoProxy;
    }
  });
});
