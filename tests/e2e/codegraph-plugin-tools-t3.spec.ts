import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

type ToolsCatalogResult = {
  groups?: Array<{
    id?: string;
    pluginId?: string;
    tools?: Array<{ id?: string; label?: string; description?: string; source?: string }>;
  }>;
};

type ToolsEffectiveResult = {
  agentId?: string;
  profile?: string;
  groups?: Array<{
    id?: string;
    source?: string;
    tools?: Array<{ id?: string; label?: string; description?: string; source?: string }>;
  }>;
};

type ToolsInvokeResult = {
  ok?: boolean;
  toolName?: string;
  source?: string;
  output?: unknown;
  success?: boolean;
  result?: unknown;
  error?: string | { code?: string; message?: string };
  blocked?: boolean;
};

type SessionsListResult = {
  sessions?: Array<{ key?: string; agentId?: string }>;
};

const CODEGRAPH_TOOLS = [
  'codegraph_decide',
  'codegraph_context_plan',
  'codegraph_explore',
  'codegraph_search',
  'codegraph_callers',
  'codegraph_callees',
  'codegraph_impact',
  'codegraph_status',
  'codegraph_sync',
  'codegraph_init',
  'codegraph_entrypoints',
  'codegraph_find_flow',
  'codegraph_minimal_context',
  'codegraph_git_stats',
  'codegraph_freshness',
] as const;

async function hostInvokeRaw(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<HostResponse<unknown>> {
  return await app.evaluate(async (_electron, request) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const handler = handlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');

    return await handler({}, {
      id: `t3-codegraph-raw-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      module: request.module,
      action: request.action,
      payload: request.payload,
    });
  }, { module, action, payload }) as HostResponse<unknown>;
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await hostInvokeRaw(app, module, action, payload);
  if (!response.ok) {
    throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  }
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const status = await hostInvoke<{ state?: string; gatewayReady?: boolean }>(app, 'gateway', 'status');
  if (status.state !== 'running' && status.state !== 'starting') {
    await hostInvoke(app, 'gateway', 'start').catch(() => undefined);
  }
  await expect.poll(async () => {
    const next = await hostInvoke<{ state?: string; gatewayReady?: boolean }>(app, 'gateway', 'status');
    return next.gatewayReady === true || next.state === 'running';
  }, {
    intervals: [2_000, 5_000, 10_000],
    timeout: 180_000,
  }).toBe(true);
}

async function seedOpenClawPlugins(homeDir: string): Promise<void> {
  const openclawDir = join(homeDir, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), `${JSON.stringify({
    gateway: { mode: 'local', controlUi: { enabled: false } },
    plugins: {
      enabled: true,
      allow: ['codegraph'],
      entries: {
        codegraph: { enabled: true },
      },
    },
    agents: {
      defaults: {
        model: { primary: 'mock/mock-model' },
        workspace: '',
      },
      list: [{ id: 'main' }],
    },
    models: {
      providers: {},
    },
  }, null, 2)}\n`, 'utf8');
}

function collectToolIds(
  groups: Array<{ tools?: Array<{ id?: string }> }> | undefined,
): string[] {
  const ids: string[] = [];
  for (const group of groups ?? []) {
    for (const tool of group.tools ?? []) {
      if (typeof tool.id === 'string' && tool.id) ids.push(tool.id);
    }
  }
  return ids;
}

function measureToolSchemas(groups: ToolsCatalogResult['groups'] | ToolsEffectiveResult['groups']): {
  toolCount: number;
  schemaChars: number;
  schemaUtf8Bytes: number;
  codegraphCount: number;
} {
  const allIds = collectToolIds(groups);
  const codegraphIds = allIds.filter((id) => id.startsWith('codegraph_'));
  const schemaJson = JSON.stringify(groups ?? []);
  return {
    toolCount: allIds.length,
    schemaChars: schemaJson.length,
    schemaUtf8Bytes: Buffer.byteLength(schemaJson, 'utf8'),
    codegraphCount: codegraphIds.length,
  };
}

function extractOutputText(result: ToolsInvokeResult): string {
  const payload = result.output ?? result.result ?? result;
  try {
    return typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

async function waitForToolsCatalog(
  app: ElectronApplication,
  timeoutMs = 180_000,
): Promise<ToolsCatalogResult> {
  let lastError: unknown;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const catalog = await hostInvoke<ToolsCatalogResult>(app, 'gateway', 'rpc', {
        method: 'tools.catalog',
        params: { agentId: 'main', includePlugins: true },
        timeoutMs: 90_000,
      });
      return catalog;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`tools.catalog failed after retries: ${String(lastError)}`);
}

async function listMainSessionKey(app: ElectronApplication): Promise<string | null> {
  const listed = await hostInvoke<SessionsListResult>(app, 'gateway', 'rpc', {
    method: 'sessions.list',
    params: { agentId: 'main' },
    timeoutMs: 60_000,
  });
  const existing = (listed.sessions ?? []).find((session) => typeof session.key === 'string' && session.key);
  return existing?.key ?? null;
}

async function createMainSessionKey(app: ElectronApplication): Promise<string> {
  // sessions.create without an explicit key builds agent:<id>:dashboard:<uuid>.
  // Labels must be unique: a fixed label can collide if create is retried after a
  // partial success or if the UI already claimed the same display label.
  const created = await hostInvoke<{ key?: string; sessionKey?: string; ok?: boolean }>(app, 'gateway', 'rpc', {
    method: 'sessions.create',
    params: {
      agentId: 'main',
      label: `t3-codegraph-e2e-${randomUUID()}`,
    },
    timeoutMs: 60_000,
  });
  if (typeof created.key === 'string' && created.key) return created.key;
  if (typeof created.sessionKey === 'string' && created.sessionKey) return created.sessionKey;
  throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);
}

async function resolveMainSessionKey(app: ElectronApplication): Promise<string> {
  // Prefer an existing main session (UI dashboard often seeds one). Never fall back
  // to the well-known "agent:main:main" string - tools.effective requires a real
  // persisted session entry and rejects unknown keys hard.
  //
  // Interleave list + create: skip-path tests may not call tools.catalog first, so
  // the UI may not have a dashboard session yet. Creating early avoids burning the
  // whole budget on empty list polls. On RPC timeout, re-check gateway readiness.
  const deadline = Date.now() + 180_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const existing = await listMainSessionKey(app);
      if (existing) return existing;
    } catch (error) {

      const message = error instanceof Error ? error.message : String(error);
      if (/RPC timeout|timed out|unavailable during gateway startup/i.test(message)) {
        try {
          await ensureGatewayReady(app);
        } catch {
          // gateway re-check failed; retry loop continues
        }
      }
    }

    // Create a real dashboard session when none exists yet (skip-path E2E).
    try {
      return await createMainSessionKey(app);
    } catch (error) {
      lastError = error;
      // Concurrent UI create/list races: re-list before the next create attempt.
      try {
        const raced = await listMainSessionKey(app);
        if (raced) return raced;
      } catch (listError) {
        lastError = listError;
        const message = listError instanceof Error ? listError.message : String(listError);
        if (/RPC timeout|timed out|unavailable during gateway startup/i.test(message)) {
          try {
            await ensureGatewayReady(app);
          } catch (readyError) {
            lastError = readyError;
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`failed to resolve a real main session key: ${String(lastError)}`);
}

async function waitForToolsEffective(
  app: ElectronApplication,
  sessionKey: string,
  timeoutMs = 240_000,
): Promise<ToolsEffectiveResult> {
  // tools.effective is startup-gated until source-runtime sidecars finish.
  // Under VERSE_CLAW_E2E, isolation skips defer so this becomes available on the ready path.
  let lastError: unknown;
  let activeSessionKey = sessionKey;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const inventory = await hostInvoke<ToolsEffectiveResult>(app, 'gateway', 'rpc', {
        method: 'tools.effective',
        params: { agentId: 'main', sessionKey: activeSessionKey },
        timeoutMs: 60_000,
      });
      return inventory;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (/unknown session key/i.test(message)) {
        // Session store may still be bootstrapping; re-resolve a real key once.
        try {
          activeSessionKey = await resolveMainSessionKey(app);
        } catch (resolveError) {
          lastError = resolveError;
        }
      } else if (!/unavailable during gateway startup|RPC timeout|timed out/i.test(message)) {
        // Non-startup failures still retry briefly in case the gateway is racing.
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`tools.effective failed after retries: ${String(lastError)}`);
}

test.describe('T3 CodeGraph plugin tools via real Electron Gateway', () => {
  test('default launch registers 15 unique CodeGraph tools and can invoke codegraph_decide', async ({
    homeDir,
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    await seedOpenClawPlugins(homeDir);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-t3-codegraph-ws-'));
    await writeFile(join(workspaceDir, 'hello.ts'), 'export const hello = () => "world";\n', 'utf8');

    const previousSkip = process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;
    delete process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      await hostInvoke(app, 'workspaces', 'create', {
        name: 'T3 CodeGraph Default',
        rootPath: workspaceDir,
        permissionMode: 'fullAccess',
      });

      await ensureGatewayReady(app);

      const catalog = await waitForToolsCatalog(app);
      const catalogMetrics = measureToolSchemas(catalog.groups);
      const catalogCodegraph = collectToolIds(catalog.groups).filter((id) => id.startsWith('codegraph_'));
      const uniqueCatalog = new Set(catalogCodegraph);

      // Helper-only metrics for T3 acceptance evidence (not production code).
      console.log('[t3-codegraph-metrics:default-catalog]', JSON.stringify(catalogMetrics));

      expect(
        uniqueCatalog.size,
        `expected 15 unique codegraph tools in catalog, got ${[...uniqueCatalog].join(',')}`,
      ).toBe(15);
      expect(catalogCodegraph).toEqual(expect.arrayContaining([...CODEGRAPH_TOOLS]));
      expect(catalogCodegraph.length).toBe(15);

      // Agent-visible surface (honors OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS).
      const sessionKey = await resolveMainSessionKey(app);
      const effective = await waitForToolsEffective(app, sessionKey);
      const effectiveMetrics = measureToolSchemas(effective.groups);
      const effectiveCodegraph = collectToolIds(effective.groups).filter((id) => id.startsWith('codegraph_'));
      console.log('[t3-codegraph-metrics:default-effective]', JSON.stringify({
        ...effectiveMetrics,
        sessionKey,
        profile: effective.profile,
      }));
      expect(
        new Set(effectiveCodegraph).size,
        `expected 15 unique codegraph tools in effective inventory, got ${effectiveCodegraph.join(',')}`,
      ).toBe(15);

      const decide = await hostInvoke<ToolsInvokeResult>(app, 'gateway', 'rpc', {
        method: 'tools.invoke',
        params: {
          name: 'codegraph_decide',
          args: {
            userIntent: 'locate the hello export',
            operationType: 'locate',
            workspacePath: workspaceDir,
          },
          agentId: 'main',
          sessionKey,
        },
        timeoutMs: 120_000,
      });

      const text = extractOutputText(decide);
      const errorText = typeof decide.error === 'string'
        ? decide.error
        : decide.error?.message ?? '';
      expect(
        decide.ok === true
        || decide.success === true
        || /decision|mode|strategy|plan|search|context|codegraph|shouldUseCodeGraph|mustReadSource/i.test(text),
      ).toBe(true);
      expect(`${errorText} ${text}`.toLowerCase()).not.toMatch(/mock only|not implemented|fake fixture/);
      expect(text.length).toBeGreaterThan(20);
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousSkip === undefined) delete process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;
      else process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS = previousSkip;
    }
  });

  test('explicit OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS=1 hides CodeGraph agent tools', async ({
    homeDir,
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    await seedOpenClawPlugins(homeDir);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-t3-codegraph-skip-'));
    await writeFile(join(workspaceDir, 'hello.ts'), 'export const hello = () => "world";\n', 'utf8');

    const previousSkip = process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;
    process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS = '1';

    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      await hostInvoke(app, 'workspaces', 'create', {
        name: 'T3 CodeGraph Skip',
        rootPath: workspaceDir,
        permissionMode: 'fullAccess',
      });
      await ensureGatewayReady(app);

      // Warm the Gateway RPC path before sessions.* on the skip launch. Catalog is
      // a discovery surface and may still list plugin metadata under skip; agent
      // visibility is proven only via tools.effective below.
      await waitForToolsCatalog(app, 120_000);

      // Agent-visible inventory must omit plugin tools when the Runtime-native
      // skip switch is set. tools.catalog is a discovery surface and may still
      // list plugin metadata; tools.invoke can also bypass the skip when the
      // caller names an explicit tool (gatewayRequestedTools allowlist).
      const sessionKey = await resolveMainSessionKey(app);
      const effective = await waitForToolsEffective(app, sessionKey);
      const metrics = measureToolSchemas(effective.groups);
      const codegraphIds = collectToolIds(effective.groups).filter((id) => id.startsWith('codegraph_'));

      console.log('[t3-codegraph-metrics:skip-effective]', JSON.stringify({
        ...metrics,
        sessionKey,
        profile: effective.profile,
        codegraphIds,
      }));

      expect(
        codegraphIds.length,
        `expected 0 codegraph tools under skip, got ${codegraphIds.join(',')}`,
      ).toBe(0);

      // Spot-check: a direct agent-style effective surface stays free of all 15 names.
      for (const toolName of CODEGRAPH_TOOLS) {
        expect(codegraphIds).not.toContain(toolName);
      }
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
      if (previousSkip === undefined) delete process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS;
      else process.env.OPENCLAW_SKIP_AGENT_PLUGIN_TOOLS = previousSkip;
    }
  });
});
