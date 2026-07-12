import type { BrowserWindow } from 'electron';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type {
  WorkspaceProfile,
  WorkspacePreviewMode,
  WorkspaceWebPreviewLaunchConfig,
  WorkspaceWebPreviewPackageManager,
  WorkspaceWebPreviewStatus,
} from '@shared/types/workspace';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import { isWebPreviewAnnotationEnabled } from '@shared/workspace-preview-policy';
import { isHtmlContentType, injectInspectorScript } from './web-preview-inspector';
import { isPathInsideWorkspace } from './workspace-permissions';
import type { TerminalSessionManager } from './terminal-session-manager';

export type WebPreviewRuntimeSnapshot = {
  success: boolean;
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  running?: boolean;
  mode?: WorkspacePreviewMode;
  status?: WorkspaceWebPreviewStatus;
  url?: string | null;
  previewId?: string | null;
  previewUrl?: string | null;
  targetUrl?: string | null;
  rootPath?: string | null;
  targetPath?: string | null;
  port?: number | null;
  processSessionId?: string | null;
  launchConfig?: WorkspaceWebPreviewLaunchConfig | null;
  error?: string;
};

type WebPreviewManagerContext = {
  mainWindow?: BrowserWindow | null;
  terminalManager?: TerminalSessionManager;
};

type StartInput = {
  workspace: WorkspaceProfile;
  mode?: WorkspacePreviewMode;
  targetPath?: string;
  url?: string;
  launchConfig?: WorkspaceWebPreviewLaunchConfig | null;
  approval?: PermissionApprovalEvent | null;
};

type RuntimeRecord = {
  workspaceId: string;
  mode: WorkspacePreviewMode;
  status: WorkspaceWebPreviewStatus;
  rootPath: string;
  targetPath: string | null;
  targetUrl: string | null;
  previewUrl: string | null;
  port: number | null;
  processSessionId: string | null;
  launchConfig: WorkspaceWebPreviewLaunchConfig | null;
  server: Server | null;
  previewId: string;
  logsSeq: number;
  error: string | null;
};

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'preview'];

function normalizeTargetPath(targetPath: string | undefined, workspaceRoot: string): string {
  if (targetPath?.trim()) return resolve(workspaceRoot, targetPath.trim());
  return workspaceRoot;
}

async function resolveRequestPath(root: string, requestUrl: string | undefined): Promise<string | null> {
  const url = new URL(requestUrl || '/', 'http://127.0.0.1');
  const decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  let candidate = resolve(root, decoded || '.');
  if (!isPathInsideWorkspace(candidate, root)) return null;
  const info = await stat(candidate).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) candidate = join(candidate, 'index.html');
  if (!isPathInsideWorkspace(candidate, root)) return null;
  return candidate;
}

function parsePortFromUrl(value: string | null): number | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}

function normalizeExternalUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error('URL is required');
  const raw = value.trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Preview URL must use http or https');
  }
  return parsed.toString();
}

function detectPackageManager(root: string): WorkspaceWebPreviewPackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'pnpm';
}

function commandFor(packageManager: WorkspaceWebPreviewPackageManager, scriptName: string): string {
  if (packageManager === 'npm') return `npm run ${scriptName}`;
  if (packageManager === 'yarn') return `yarn ${scriptName}`;
  if (packageManager === 'bun') return `bun run ${scriptName}`;
  return `pnpm run ${scriptName}`;
}

function detectDefaultPort(pkg: PackageJson): number | null {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const names = new Set(Object.keys(deps));
  if (names.has('vite') || names.has('@sveltejs/kit')) return 5173;
  if (names.has('astro')) return 4321;
  if (names.has('next') || names.has('nuxt') || names.has('react-scripts')) return 3000;
  return null;
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  const path = join(root, 'package.json');
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

function findLikelyUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s]*/i);
  if (!match) return null;
  return match[0].replace('0.0.0.0', '127.0.0.1');
}

export class WebPreviewManager {
  private readonly mainWindow: BrowserWindow | null;
  private readonly terminalManager?: TerminalSessionManager;
  private readonly runtimes = new Map<string, RuntimeRecord>();

  constructor(ctx: WebPreviewManagerContext = {}) {
    this.mainWindow = ctx.mainWindow ?? null;
    this.terminalManager = ctx.terminalManager;
  }

  registerWorkspace(_workspace: WorkspaceProfile): void {
    // Runtime is created lazily on start; keeping this hook mirrors terminal lifecycle.
  }

  async stopForWorkspace(workspaceId: string, reason = 'workspace-switch'): Promise<void> {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) return;
    await this.closeRuntime(runtime, reason);
  }

  async detect(workspace: WorkspaceProfile, targetPath?: string): Promise<{ configs: WorkspaceWebPreviewLaunchConfig[]; preferred: WorkspaceWebPreviewLaunchConfig | null; rootPath: string }> {
    const root = workspace.rootPath;
    const pkg = await readPackageJson(root);
    if (!pkg?.scripts) return { configs: [], preferred: null, rootPath: root };
    const packageManager = detectPackageManager(root);
    const expectedPort = detectDefaultPort(pkg);
    const configs = SCRIPT_PRIORITY
      .filter((scriptName) => typeof pkg.scripts?.[scriptName] === 'string')
      .map((scriptName) => ({
        mode: 'devServer' as const,
        name: `${packageManager} ${scriptName}`,
        cwd: root,
        command: commandFor(packageManager, scriptName),
        packageManager,
        scriptName,
        expectedPort,
        source: 'packageScripts' as const,
      }));
    if (configs.length === 0 && targetPath) {
      return { configs: [], preferred: null, rootPath: root };
    }
    return { configs, preferred: configs[0] ?? null, rootPath: root };
  }

  async start(input: StartInput): Promise<WebPreviewRuntimeSnapshot> {
    const mode = input.mode ?? input.launchConfig?.mode ?? 'static';
    await this.stopForWorkspace(input.workspace.id, 'replaced');
    if (mode === 'externalUrl') return await this.startExternalUrl(input);
    if (mode === 'devServer') return await this.startDevServer(input);
    return await this.startStatic(input);
  }

  status(workspaceId: string): WebPreviewRuntimeSnapshot {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime) return { success: true, running: false, status: 'idle', url: null, previewUrl: null, targetUrl: null };
    return this.snapshot(runtime);
  }

  private async startStatic(input: StartInput): Promise<WebPreviewRuntimeSnapshot> {
    const targetPath = normalizeTargetPath(input.targetPath, input.workspace.rootPath);
    if (!isPathInsideWorkspace(targetPath, input.workspace.rootPath)) {
      return { success: false, error: 'Preview target must be inside the active workspace' };
    }
    const info = await stat(targetPath);
    const root = info.isDirectory() ? targetPath : resolve(targetPath, '..');
    const previewId = randomUUID();
    const server = createServer((req, res) => {
      void this.serveStaticRequest(root, req, res).catch((error) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
    await listen(server);
    const address = server.address() as AddressInfo;
    const previewUrl = `http://127.0.0.1:${address.port}/`;
    const runtime = this.createRuntime({
      workspaceId: input.workspace.id,
      mode: 'static',
      status: 'running',
      rootPath: root,
      targetPath,
      targetUrl: previewUrl,
      previewUrl,
      port: address.port,
      processSessionId: null,
      launchConfig: {
        mode: 'static',
        name: 'Static preview',
        cwd: root,
        command: null,
        expectedPort: address.port,
        source: 'manual',
      },
      server,
      previewId,
    });
    this.runtimes.set(input.workspace.id, runtime);
    this.emitStatus(runtime);
    return this.snapshot(runtime);
  }

  private async startExternalUrl(input: StartInput): Promise<WebPreviewRuntimeSnapshot> {
    const targetUrl = normalizeExternalUrl(input.url ?? input.launchConfig?.command ?? undefined);
    const previewId = randomUUID();
    const { server, previewUrl, port } = await this.startProxy(
      targetUrl,
      previewId,
      isWebPreviewAnnotationEnabled('externalUrl'),
    );
    const runtime = this.createRuntime({
      workspaceId: input.workspace.id,
      mode: 'externalUrl',
      status: 'running',
      rootPath: input.workspace.rootPath,
      targetPath: null,
      targetUrl,
      previewUrl,
      port,
      processSessionId: null,
      launchConfig: input.launchConfig ?? {
        mode: 'externalUrl',
        name: targetUrl,
        cwd: input.workspace.rootPath,
        command: targetUrl,
        expectedPort: parsePortFromUrl(targetUrl),
        source: 'externalUrl',
      },
      server,
      previewId,
    });
    this.runtimes.set(input.workspace.id, runtime);
    this.emitStatus(runtime);
    return this.snapshot(runtime);
  }

  private async startDevServer(input: StartInput): Promise<WebPreviewRuntimeSnapshot> {
    const detected = await this.detect(input.workspace, input.targetPath);
    const launchConfig = input.launchConfig ?? detected.preferred;
    if (!launchConfig?.command) {
      return { success: false, status: 'error', error: 'No dev server launch config found' };
    }
    if (!this.terminalManager) {
      return { success: false, status: 'error', error: 'Terminal manager unavailable for dev server preview' };
    }
    const terminal = this.terminalManager.open({
      workspace: input.workspace,
      sessionKey: input.workspace.activeSessionKey,
      cwd: launchConfig.cwd ?? input.workspace.rootPath,
      kind: 'webPreviewDevServer',
      command: launchConfig.command,
    });
    const expectedPort = launchConfig.expectedPort ?? null;
    const targetUrl = expectedPort ? `http://127.0.0.1:${expectedPort}/` : null;
    const previewId = randomUUID();
    const { server, previewUrl, port } = await this.startProxy(
      targetUrl ?? 'http://127.0.0.1:3000/',
      previewId,
      isWebPreviewAnnotationEnabled('devServer'),
    );
    const runtime = this.createRuntime({
      workspaceId: input.workspace.id,
      mode: 'devServer',
      status: 'running',
      rootPath: input.workspace.rootPath,
      targetPath: input.targetPath ?? null,
      targetUrl: targetUrl ?? 'http://127.0.0.1:3000/',
      previewUrl,
      port,
      processSessionId: terminal.sessionId,
      launchConfig,
      server,
      previewId,
    });
    this.runtimes.set(input.workspace.id, runtime);
    this.emitStatus(runtime);
    return this.snapshot(runtime);
  }

  handleTerminalOutput(workspaceId: string, data: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    const runtime = this.runtimes.get(workspaceId);
    if (!runtime || runtime.mode !== 'devServer') return;
    runtime.logsSeq += 1;
    const url = findLikelyUrl(data);
    if (url && url !== runtime.targetUrl) {
      runtime.targetUrl = url;
      runtime.port = parsePortFromUrl(url);
      this.emitStatus(runtime);
    }
    this.emit(HOST_EVENT_CHANNELS.webPreview.devServerOutput, {
      workspaceId,
      mode: runtime.mode,
      status: runtime.status,
      previewId: runtime.previewId,
      previewUrl: runtime.previewUrl,
      targetUrl: runtime.targetUrl,
      port: runtime.port,
      processSessionId: runtime.processSessionId,
      launchConfig: runtime.launchConfig,
      error: runtime.error,
      data,
      stream,
      seq: runtime.logsSeq,
    });
  }

  private async serveStaticRequest(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const filePath = await resolveRequestPath(root, req.url);
    if (!filePath || !existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const fileInfo = await stat(filePath).catch(() => null);
    if (!fileInfo?.isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const contentType = MIME_BY_EXT[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isHtmlContentType(contentType)) {
      const html = await readFile(filePath, 'utf8');
      res.end(html);
      return;
    }
    createReadStream(filePath).pipe(res);
  }

  private async startProxy(targetUrl: string, previewId: string, inspectorEnabled: boolean): Promise<{ server: Server; previewUrl: string; port: number }> {
    const baseUrl = new URL(targetUrl);
    const server = createServer((req, res) => {
      void this.proxyHttpRequest(baseUrl, previewId, inspectorEnabled, req, res).catch((error) => {
        res.statusCode = 502;
        res.end(String(error));
      });
    });
    server.on('upgrade', (req, socket, head) => {
      const target = new URL(req.url || '/', baseUrl);
      const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
      const upstream = netConnect(port, target.hostname, () => {
        upstream.write(`${req.method} ${target.pathname}${target.search} HTTP/${req.httpVersion}\r\n`);
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) upstream.write(`${name}: ${entry}\r\n`);
          } else if (value !== undefined) {
            upstream.write(`${name}: ${value}\r\n`);
          }
        }
        upstream.write('\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
    });
    await listen(server);
    const address = server.address() as AddressInfo;
    return { server, previewUrl: `http://127.0.0.1:${address.port}/`, port: address.port };
  }

  private async proxyHttpRequest(baseUrl: URL, previewId: string, inspectorEnabled: boolean, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = new URL(req.url || '/', baseUrl);
    const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest;
    await new Promise<void>((resolvePromise) => {
      const proxyReq = requestImpl(target, {
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
        },
      }, (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        proxyRes.on('end', () => {
          const headers = { ...proxyRes.headers };
          delete headers['content-security-policy'];
          delete headers['x-frame-options'];
          const contentType = headers['content-type'];
          const body = Buffer.concat(chunks);
          if (inspectorEnabled && isHtmlContentType(contentType)) {
            delete headers['content-length'];
            res.writeHead(proxyRes.statusCode ?? 200, headers);
            res.end(injectInspectorScript(body.toString('utf8'), previewId));
          } else {
            res.writeHead(proxyRes.statusCode ?? 200, headers);
            res.end(body);
          }
          resolvePromise();
        });
      });
      proxyReq.on('error', (error) => {
        res.statusCode = 502;
        res.end(String(error));
        resolvePromise();
      });
      req.pipe(proxyReq);
    });
  }

  private createRuntime(input: Omit<RuntimeRecord, 'logsSeq' | 'error'>): RuntimeRecord {
    return { ...input, logsSeq: 0, error: null };
  }

  private async closeRuntime(runtime: RuntimeRecord, reason: string): Promise<void> {
    runtime.status = 'stopping';
    this.emitStatus(runtime);
    await closeServer(runtime.server);
    if (runtime.processSessionId) {
      try {
        this.terminalManager?.close(runtime.processSessionId, reason === 'workspace-switch' ? 'workspace-switch' : 'user-close');
      } catch {
        // noop
      }
    }
    runtime.status = 'stopped';
    runtime.server = null;
    runtime.previewUrl = null;
    this.runtimes.delete(runtime.workspaceId);
    this.emitStatus(runtime);
  }

  private snapshot(runtime: RuntimeRecord): WebPreviewRuntimeSnapshot {
    return {
      success: true,
      running: runtime.status === 'running' || runtime.status === 'starting',
      mode: runtime.mode,
      status: runtime.status,
      url: runtime.previewUrl,
      previewId: runtime.previewId,
      previewUrl: runtime.previewUrl,
      targetUrl: runtime.targetUrl,
      rootPath: runtime.rootPath,
      targetPath: runtime.targetPath,
      port: runtime.port,
      processSessionId: runtime.processSessionId,
      launchConfig: runtime.launchConfig,
      error: runtime.error ?? undefined,
    };
  }

  private emitStatus(runtime: RuntimeRecord): void {
    this.emit(HOST_EVENT_CHANNELS.webPreview.statusChanged, {
      workspaceId: runtime.workspaceId,
      mode: runtime.mode,
      status: runtime.status,
      previewId: runtime.previewId,
      previewUrl: runtime.previewUrl,
      targetUrl: runtime.targetUrl,
      port: runtime.port,
      processSessionId: runtime.processSessionId,
      launchConfig: runtime.launchConfig,
      error: runtime.error,
    });
  }

  private emit(channel: string, payload: unknown): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(channel, payload);
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
}

function closeServer(server: Server | null): Promise<void> {
  return new Promise((resolvePromise) => {
    if (!server) {
      resolvePromise();
      return;
    }
    server.close(() => resolvePromise());
  });
}

export function createWebPreviewManager(ctx: WebPreviewManagerContext = {}): WebPreviewManager {
  return new WebPreviewManager(ctx);
}
