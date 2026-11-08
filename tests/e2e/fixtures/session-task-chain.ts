import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { hostInvoke, startGateway } from './fp-p1-harness';
import { writeFile } from 'node:fs/promises';
import type { TaskContractInput, TaskResolution, TaskView } from '../../../shared/task-system/types';

export async function createSessionChainTask(app: ElectronApplication, workspaceId: string, requestId: string, contract: TaskContractInput): Promise<TaskView> {
  const response = await hostInvoke<{ result: TaskResolution }>(app, 'taskLedger', 'command', {
    workspaceId, command: { action: 'create', requestId, contract },
  });
  return response.result.task;
}

export async function observeSessionUi(app: ElectronApplication) {
  const errors: string[] = [];
  const attach = (page: import('@playwright/test').Page) => {
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 5000));
    });
  };
  app.windows().forEach(attach);
  app.on('window', attach);
  return async (outputPath: (name: string) => string) => {
    const pages = [];
    for (const [index, page] of app.windows().entries()) {
      const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => 'unavailable');
      pages.push({ url: page.url(), body });
      await page.screenshot({ path: outputPath(`ui-diagnostic-${index}.png`), timeout: 5000 }).catch(() => undefined);
    }
    await writeFile(outputPath('ui-diagnostics.json'), JSON.stringify({ errors, pages }, null, 2));
  };
}

export async function configureSessionChainProvider(app: ElectronApplication, port: number) {
  await hostInvoke(app, 'gateway', 'stop');
  const now = new Date().toISOString();
  await hostInvoke(app, 'providers', 'save', { config: {
    id: 'session-chain-fixture', name: 'Agent session fixture', type: 'custom', apiProtocol: 'openai-completions',
    baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-coder', enabled: true, createdAt: now, updatedAt: now,
    modelProfile: { supportsReasoning: true, supportsVision: false, contextWindow: 128000, maxTokens: 4096 },
  }, apiKey: 'local-scripted-session-key' });
  await hostInvoke(app, 'providers', 'setDefault', { providerId: 'session-chain-fixture' });
}

/** Pin window content size; visual fixtures launch with a unit device scale. */
export async function setSessionChainViewport(app: ElectronApplication, size: { width: number; height: number }) {
  return app.evaluate(async ({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (!win) throw new Error('No session window');
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    win.setContentSize(target.width, target.height);
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    return win.webContents.executeJavaScript('({ width: window.innerWidth, height: window.innerHeight })');
  }, size);
}

export async function createSessionChainProject(app: ElectronApplication, rootPath: string, name: string) {
  await mkdir(rootPath, { recursive: true });
  const key = `agent:main:session-${Date.now()}-${name.toLowerCase().replace(/[^a-z]/g, '')}`;
  const result = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
    name, rootPath, agentId: 'main', activeSessionKey: key, permissionMode: 'fullAccess',
  });
  await hostInvoke(app, 'gateway', 'stop');
  await startGateway(app);
  const workspaceId = result.activeWorkspace.id;
  const session = await hostInvoke<{ key: string; sessionId: string }>(app, 'gateway', 'rpc', {
    method: 'sessions.create', params: { key, agentId: 'main', label: `${name} coordinator` }, timeoutMs: 30_000,
  });
  return { workspaceId, rootPath, sessionKey: session.key, generation: session.sessionId };
}

export async function addSessionChainChildren(app: ElectronApplication, project: { workspaceId: string; sessionKey: string }, start: number, end: number) {
  const children: string[] = [];
  for (let index = start; index < end; index++) {
    const child = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', {
      method: 'sessions.create', params: { agentId: 'main', parentSessionKey: project.sessionKey,
        label: `Child ${index + 1} · ${'A long session title '.repeat(index === 0 ? 7 : 1)} · ${project.sessionKey.slice(-10)}` }, timeoutMs: 30_000,
    });
    await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: child.key,
      state: { draftInput: `Child ${index + 1} draft` } });
    children.push(child.key);
  }
  return children;
}

export async function instrumentSessionChainHost(app: ElectronApplication) {
  await app.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
    const state = globalThis as unknown as {
      sessionChainCalls: Array<{ module?: string; action?: string; method?: string }>;
      sessionChainOriginalHost?: (event: unknown, request: unknown) => Promise<unknown>;
    };
    const original = state.sessionChainOriginalHost ?? handlers.get('host:invoke')!;
    state.sessionChainOriginalHost = original;
    state.sessionChainCalls = [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', (event, request: { module?: string; action?: string; payload?: { method?: string } }) => {
      state.sessionChainCalls.push({ module: request.module, action: request.action, method: request.payload?.method });
      return original(event, request);
    });
  });
}

export function readSessionChainHostCalls(app: ElectronApplication) {
  return app.evaluate(() => (globalThis as unknown as { sessionChainCalls: Array<{ module?: string; action?: string; method?: string }> }).sessionChainCalls);
}

/** Agent-driven transport fault after the real Main creation commit. */
export async function loseNextHandoffCreationResponse(app: ElectronApplication, operationId: string) {
  await app.evaluate((_electron, id) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers;
    const original = handlers.get('host:invoke')!;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: { module?: string; action?: string; payload?: { operationId?: string } }) => {
      const result = await original(event, request);
      if (request.module === 'sessions' && request.action === 'createHandoff' && request.payload?.operationId === id) {
        ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original);
        throw new Error('agent injected creation response loss');
      }
      return result;
    });
  }, operationId);
}

/** Fail one acknowledged-send persistence write in the isolated test profile. */
export async function failNextHandoffAcknowledgementWrite(app: ElectronApplication, operationId: string) {
  const storeModule = createRequire(resolve('package.json')).resolve('electron-store');
  await app.evaluate(({ app: electronApp }, { id, storeModule }) => {
    const module = process.mainModule!.require(storeModule);
    const Store = module.default ?? module;
    const path = process.mainModule!.require('node:path') as typeof import('node:path');
    const expectedPath = path.resolve(electronApp.getPath('userData'), 'workspaces.json');
    const descriptor = Object.getOwnPropertyDescriptor(Store.prototype, 'set');
    const original = Store.prototype.set;
    Object.defineProperty(Store.prototype, 'set', { configurable: true, writable: true,
      value: function (this: { path?: string }, key: unknown, value: unknown) {
        const profiles = Array.isArray(value) ? value as Array<{ handoffOperations?: Record<string, { phase?: string }> }> : [];
        if (this.path && path.resolve(this.path) === expectedPath && key === 'profiles'
          && profiles.some((profile) => profile.handoffOperations?.[id]?.phase === 'accepted')) {
          if (descriptor) Object.defineProperty(Store.prototype, 'set', descriptor);
          else delete Store.prototype.set;
          throw new Error('agent injected acknowledgement persistence failure');
        }
        return Reflect.apply(original, this, [key, value]);
      },
    });
  }, { id: operationId, storeModule });
}
