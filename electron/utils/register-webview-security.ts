/**
 * P2-004 / F-ISO-002: Register WebView attach/permission/navigation handlers
 * on the Electron app/session. Safe to call once during initialize().
 */

import { app, session, type WebContents, type Session } from 'electron';
import { logger } from './logger';
import {
  evaluateWebViewAttach,
  evaluateWebViewNavigation,
  evaluateWebViewPermission,
  WEBVIEW_CONTROL_PARTITION,
} from './webview-security';

let registered = false;

type DenialHandler = (entry: {
  kind: 'attach' | 'permission' | 'permission-check' | 'navigation' | 'window-open';
  detail: string;
  url?: string;
}) => void;

const defaultDenialHandler: DenialHandler = (entry) => {
  logger.warn(`[webview-security] deny ${entry.kind}: ${entry.detail}${entry.url ? ` (${entry.url})` : ''}`);
};

function hardenWebContents(contents: WebContents, onDeny: DenialHandler): void {
  contents.setWindowOpenHandler(({ url }) => {
    onDeny({ kind: 'window-open', detail: 'WebView/window.open denied', url });
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const decision = evaluateWebViewNavigation(url);
    if (!decision.allowed) {
      event.preventDefault();
      onDeny({ kind: 'navigation', detail: decision.reason, url });
    }
  });

  // Guest pages should not open new windows or navigate outside allowlist.
  contents.on('will-redirect', (event, url) => {
    const decision = evaluateWebViewNavigation(url);
    if (!decision.allowed) {
      event.preventDefault();
      onDeny({ kind: 'navigation', detail: `redirect blocked: ${decision.reason}`, url });
    }
  });
}

function installSessionPermissionHandlers(targetSession: Session, onDeny: DenialHandler): void {
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = typeof details?.requestingUrl === 'string' ? details.requestingUrl : undefined;
    const decision = evaluateWebViewPermission(permission, requestingUrl);
    if (!decision.allowed) {
      onDeny({
        kind: 'permission',
        detail: decision.reason,
        url: requestingUrl,
      });
    }
    callback(decision.allowed);
  });

  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const decision = evaluateWebViewPermission(permission, requestingOrigin);
    if (!decision.allowed) {
      onDeny({
        kind: 'permission-check',
        detail: decision.reason,
        url: requestingOrigin,
      });
    }
    return decision.allowed;
  });
}

/**
 * Install process-wide WebView security. Idempotent.
 */
export function registerWebViewSecurity(options: { onDeny?: DenialHandler } = {}): void {
  if (registered) return;
  registered = true;
  const onDeny = options.onDeny ?? defaultDenialHandler;

  // Default session + dedicated Control UI partition.
  installSessionPermissionHandlers(session.defaultSession, onDeny);
  try {
    installSessionPermissionHandlers(session.fromPartition(WEBVIEW_CONTROL_PARTITION), onDeny);
  } catch (error) {
    logger.warn('[webview-security] failed to install partition permission handlers', error);
  }

  app.on('web-contents-created', (_event, contents) => {
    // Harden every webContents; attach gate is additional for <webview> guests.
    hardenWebContents(contents, onDeny);

    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const decision = evaluateWebViewAttach({
        preload: typeof webPreferences.preload === 'string' ? webPreferences.preload : null,
        nodeIntegration: webPreferences.nodeIntegration === true,
        nodeIntegrationInSubFrames: webPreferences.nodeIntegrationInSubFrames === true,
        contextIsolation: webPreferences.contextIsolation !== false,
        webSecurity: webPreferences.webSecurity !== false,
        allowRunningInsecureContent: webPreferences.allowRunningInsecureContent === true,
        experimentalFeatures: webPreferences.experimentalFeatures === true,
        partition: typeof params.partition === 'string' ? params.partition : null,
        src: typeof params.src === 'string' ? params.src : null,
      });

      if (!decision.allowed || !decision.prefs) {
        event.preventDefault();
        onDeny({
          kind: 'attach',
          detail: decision.reason,
          url: typeof params.src === 'string' ? params.src : undefined,
        });
        return;
      }

      // Force hardened preferences regardless of renderer-supplied values.
      webPreferences.nodeIntegration = decision.prefs.nodeIntegration;
      webPreferences.nodeIntegrationInSubFrames = decision.prefs.nodeIntegrationInSubFrames;
      webPreferences.contextIsolation = decision.prefs.contextIsolation;
      webPreferences.webSecurity = decision.prefs.webSecurity;
      webPreferences.allowRunningInsecureContent = decision.prefs.allowRunningInsecureContent;
      webPreferences.experimentalFeatures = decision.prefs.experimentalFeatures;
      delete (webPreferences as { preload?: string }).preload;
      params.partition = decision.prefs.partition;
    });
  });

  logger.info('[webview-security] WebView attach/permission/navigation controls registered (P2-004)');
}

export function __resetWebViewSecurityRegistrationForTests(): void {
  registered = false;
}
