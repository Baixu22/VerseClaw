/**
 * Standalone facade factory — TF-0020 Live MCP without host injection.
 *
 * Resolution order:
 *   1. Host-injected facade (MCP deps.facade) — never touches this module
 *   2. Electron/host createAgentBrowserApi when available
 *   3. playwright-core auto-start (this module)
 *   4. Explicit no-driver (VERSEBROWSER_NO_DRIVER=1) → E_NO_SESSION_API with actionable hint
 */
import { AgentBrowserFacade } from './facade.ts';
import { profileForDriver, profileFromHostApi } from './driver-profile.ts';
import type { AgentBrowserHostApi } from '../types/host-api.ts';
import type { SemanticGateway } from './semantic-browser.ts';
import { getWorkspaceRoot } from '../host/workspace-paths.ts';

export type StandaloneFacadeOptions = {
  semanticGateway?: SemanticGateway;
  allowedOrigins?: readonly string[];
  allowedUploadPaths?: readonly string[];
  allowedDownloadPaths?: readonly string[];
  /** Upstream single-request budget; omitted keeps the 10 s default. */
  transferTimeoutMs?: number;
  backend?: 'legacy' | 'upstream';
  workspaceRoot?: string;
  /** Force playwright even if a host API factory exists. */
  preferPlaywright?: boolean;
  executablePath?: string;
  evidenceRoot?: string;
  /**
   * TF-0097: keep sessions in a detached browser recorded under
   * `<workspace>/.ae/sessions/<id>/` so they survive the process (CLI multi-step).
   */
  persistentSessions?: boolean;
};

export type StandaloneFacadeResult = {
  facade: AgentBrowserFacade;
  driver: 'host-api' | 'playwright' | 'upstream' | 'none';
  hint?: string;
};

/**
 * Build a live facade for MCP/CLI standalone processes.
 * Throws only when no driver can be started; callers map that to E_NO_SESSION_API.
 */
export async function createStandaloneFacade(
  options: StandaloneFacadeOptions = {},
): Promise<StandaloneFacadeResult> {
  if (options.backend !== undefined && options.backend !== 'legacy' && options.backend !== 'upstream') throw new Error('E_BACKEND_CONFIG: expected legacy or upstream');
  if (options.semanticGateway !== undefined && options.backend !== 'upstream') throw new Error('E_SEMANTIC_CONFIG: semantic gateway requires the upstream backend');
  if (options.allowedOrigins !== undefined && options.backend !== 'upstream') throw new Error('E_UPSTREAM_CONFIG: origin grants require upstream backend');
  if (options.allowedUploadPaths !== undefined && options.backend !== 'upstream') throw new Error('E_UPSTREAM_CONFIG: upload grants require upstream backend');
  if (options.allowedDownloadPaths !== undefined && options.backend !== 'upstream') throw new Error('E_UPSTREAM_CONFIG: download grants require upstream backend');
  const workspaceRoot = getWorkspaceRoot(options.workspaceRoot);
  if (process.env.VERSEBROWSER_NO_DRIVER === '1') {
    return {
      facade: new AgentBrowserFacade({
        api: createNoopApi(),
        workspaceRoot,
        driverProfile: profileForDriver('none'),
        ...(options.evidenceRoot ? { evidenceRoot: options.evidenceRoot } : {}),
      }),
      driver: 'none',
      hint:
        'VERSEBROWSER_NO_DRIVER=1 — live tools disabled. Unset it to auto-start playwright-core, or inject a host facade.',
    };
  }

  if (!options.preferPlaywright && options.backend !== 'upstream') {
    try {
      const { createAgentBrowserApi } = await import('./api.ts');
      const api = createAgentBrowserApi();
      // Probe: host API without Electron/cli binary still works for offline-ish paths;
      // open() will surface driver errors. Prefer playwright when Electron is absent.
      const hasElectronApp = await detectElectron();
      if (hasElectronApp) {
        return {
          facade: new AgentBrowserFacade({
            api,
            workspaceRoot,
            driverProfile: profileFromHostApi(api),
            ...(options.evidenceRoot ? { evidenceRoot: options.evidenceRoot } : {}),
          }),
          driver: 'host-api',
        };
      }
    } catch {
      // fall through to playwright
    }
  }

  try {
    const { createPlaywrightHostApi } = await import('./playwright-host-api.ts');
    const api = await createPlaywrightHostApi({
      upstream: options.backend === 'upstream',
      ...(options.semanticGateway ? { semanticGateway: options.semanticGateway } : {}),
      ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
      ...(options.allowedUploadPaths !== undefined ? { allowedUploadPaths: options.allowedUploadPaths } : {}),
      ...(options.allowedDownloadPaths !== undefined ? { allowedDownloadPaths: options.allowedDownloadPaths } : {}),
      ...(options.transferTimeoutMs !== undefined ? { transferTimeoutMs: options.transferTimeoutMs } : {}),
      workspaceRoot,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      ...(options.persistentSessions ? { persistent: true } : {}),
    });
    return {
      facade: new AgentBrowserFacade({
        api,
        workspaceRoot,
        driverProfile: profileForDriver(options.backend === 'upstream' ? 'upstream' : 'playwright', Boolean(options.semanticGateway)),
        ...(options.evidenceRoot ? { evidenceRoot: options.evidenceRoot } : {}),
      }),
      driver: options.backend === 'upstream' ? 'upstream' : 'playwright',
    };
  } catch (error) {
    if ((error as { code?: string })?.code === 'E_NODE_RUNTIME') throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to start playwright-core driver: ${message}. ` +
        `Install chromium (npx playwright-core install chromium) or set executablePath, ` +
        `or set VERSEBROWSER_NO_DRIVER=1 for offline-only tools.`,
    );
  }
}

async function detectElectron(): Promise<boolean> {
  try {
    const electron = await import('electron');
    const app = (electron as { app?: { getPath?: (name: string) => string } }).app;
    return typeof app?.getPath === 'function';
  } catch {
    return false;
  }
}

function createNoopApi(): AgentBrowserHostApi {
  const deny = (method: string) => () => {
    const err = new Error(
      `${method}: no live driver. ${process.env.VERSEBROWSER_NO_DRIVER === '1' ? 'VERSEBROWSER_NO_DRIVER=1 is set.' : 'No driver available.'} Unset VERSEBROWSER_NO_DRIVER or inject createPlaywrightHostApi().`,
    ) as Error & { code?: string };
    err.code = 'E_NO_SESSION_API';
    throw err;
  };
  return new Proxy({} as AgentBrowserHostApi, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return deny(prop);
    },
  });
}
