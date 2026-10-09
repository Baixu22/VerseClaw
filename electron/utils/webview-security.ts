/**
 * P2-004 / F-ISO-002: WebView attach / permission / navigation controls.
 * Pure policy helpers live here so unit tests do not need Electron runtime.
 * Side-effect registration is in registerWebViewSecurity().
 */

import { evaluateExternalNavigationUrl } from '../../shared/security/url-policy';

export type WebViewSrcDecision =
  | { allowed: true; href: string; kind: 'gateway-control' | 'about-blank' | 'local-app' }
  | { allowed: false; reason: string; code: 'empty' | 'disallowed-scheme' | 'disallowed-host' | 'invalid' };

export type WebViewPermissionDecision = {
  allowed: boolean;
  permission: string;
  reason: string;
};

/** Permissions that may be granted to first-party / trusted webview content. */
export const WEBVIEW_DEFAULT_DENIED_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'pointerLock',
  'fullscreen',
  'openExternal',
  'clipboard-read',
  'clipboard-sanitized-write',
  'display-capture',
  'mediaKeySystem',
  'idle-detection',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'window-management',
  'fileSystem',
  'file-system',
  'serial',
  'hid',
  'usb',
  'bluetooth',
  'clipboardReadWrite',
]);

/** Only localhost OpenClaw Gateway Control UI may be embedded via <webview>. */
export function isAllowedGatewayControlHost(hostname: string, port?: string | number | null): boolean {
  const host = hostname.trim().toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
    return false;
  }
  if (port == null || port === '') return true;
  const n = typeof port === 'number' ? port : Number(port);
  // The Gateway loopback port comes from shared/gateway-endpoint; any loopback
  // port is accepted here for the local control UI.
  return Number.isFinite(n) && n > 0 && n < 65536;
}

export function evaluateWebViewSrc(src: unknown): WebViewSrcDecision {
  if (typeof src !== 'string' || !src.trim()) {
    return { allowed: false, code: 'empty', reason: 'WebView src is required' };
  }
  const raw = src.trim();
  if (raw === 'about:blank') {
    return { allowed: true, href: 'about:blank', kind: 'about-blank' };
  }

  // file:// only for packaged local renderer assets if ever used in webview
  // (normally Control UI is http://127.0.0.1). Reject by default for isolation.
  if (/^file:/i.test(raw)) {
    return { allowed: false, code: 'disallowed-scheme', reason: 'file: WebView src is not allowed' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { allowed: false, code: 'invalid', reason: 'Malformed WebView src' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      allowed: false,
      code: 'disallowed-scheme',
      reason: `WebView protocol ${parsed.protocol} is not allowed`,
    };
  }

  if (!isAllowedGatewayControlHost(parsed.hostname, parsed.port || (protocol === 'https:' ? 443 : 80))) {
    return {
      allowed: false,
      code: 'disallowed-host',
      reason: `WebView host ${parsed.hostname} is not an allowed Gateway Control origin`,
    };
  }

  // Prefer http loopback for local Control UI; https loopback is also accepted.
  return {
    allowed: true,
    href: parsed.toString(),
    kind: 'gateway-control',
  };
}

export function evaluateWebViewPermission(
  permission: string,
  requestingUrl?: string,
): WebViewPermissionDecision {
  const normalized = permission.trim().toLowerCase();
  if (!normalized) {
    return { allowed: false, permission: permission, reason: 'Empty permission denied' };
  }

  // Default deny all elevated permissions. Control UI should not need camera/mic/etc.
  if (WEBVIEW_DEFAULT_DENIED_PERMISSIONS.has(normalized) || WEBVIEW_DEFAULT_DENIED_PERMISSIONS.has(permission)) {
    return {
      allowed: false,
      permission,
      reason: `WebView permission "${permission}" denied by default`,
    };
  }

  // If URL is provided and is not trusted gateway host, deny everything.
  if (requestingUrl) {
    const src = evaluateWebViewSrc(requestingUrl);
    if (!src.allowed) {
      return {
        allowed: false,
        permission,
        reason: `WebView permission denied for untrusted origin: ${src.reason}`,
      };
    }
  }

  // Allow only non-sensitive residual checks (e.g. accessibility-events) for trusted origins.
  // Still default-deny unknown elevated capabilities.
  const allowList = new Set([
    'accessibility-events',
    'clipboard-sanitized-write',
  ]);
  if (allowList.has(normalized)) {
    // clipboard-sanitized-write is in both sets intentionally? No - remove from deny if in allow.
    // Actually clipboard-sanitized-write is in DENIED set - keep denied for security.
  }

  return {
    allowed: false,
    permission,
    reason: `WebView permission "${permission}" denied by default (fail-closed)`,
  };
}

export function evaluateWebViewNavigation(url: unknown): {
  allowed: boolean;
  reason: string;
  href?: string;
} {
  if (typeof url === 'string' && url.trim() === 'about:blank') {
    return { allowed: true, reason: 'about:blank allowed', href: 'about:blank' };
  }
  const src = evaluateWebViewSrc(url);
  if (src.allowed) {
    return { allowed: true, reason: `Allowed ${src.kind}`, href: src.href };
  }
  // Also allow same-origin navigations within gateway once attached is validated via src.
  // External http(s) that is not gateway: deny (do not open via openExternal from webview).
  const external = evaluateExternalNavigationUrl(url);
  if (external.ok) {
    return {
      allowed: false,
      reason: 'External navigation from WebView is denied; use openExternalSafe from Main only',
      href: external.href,
    };
  }
  return { allowed: false, reason: src.reason };
}

export type WebViewAttachPrefs = {
  preload?: string | null;
  nodeIntegration?: boolean;
  nodeIntegrationInSubFrames?: boolean;
  contextIsolation?: boolean;
  webSecurity?: boolean;
  allowRunningInsecureContent?: boolean;
  experimentalFeatures?: boolean;
  partition?: string | null;
  src?: string | null;
};

export type WebViewAttachDecision = {
  allowed: boolean;
  reason: string;
  prefs?: {
    nodeIntegration: false;
    nodeIntegrationInSubFrames: false;
    contextIsolation: true;
    webSecurity: true;
    allowRunningInsecureContent: false;
    experimentalFeatures: false;
    /** Isolated partition; never share default session cookies with privileged partitions. */
    partition: string;
  };
};

export const WEBVIEW_CONTROL_PARTITION = 'persist:openclaw-control-ui';

export function evaluateWebViewAttach(prefs: WebViewAttachPrefs): WebViewAttachDecision {
  const srcDecision = evaluateWebViewSrc(prefs.src ?? '');
  if (!srcDecision.allowed) {
    return { allowed: false, reason: srcDecision.reason };
  }

  // Reject attempts to enable Node in the guest.
  if (prefs.nodeIntegration === true || prefs.nodeIntegrationInSubFrames === true) {
    return { allowed: false, reason: 'WebView nodeIntegration is forbidden' };
  }
  if (prefs.webSecurity === false) {
    return { allowed: false, reason: 'WebView webSecurity must remain enabled' };
  }
  if (prefs.allowRunningInsecureContent === true) {
    return { allowed: false, reason: 'WebView allowRunningInsecureContent is forbidden' };
  }

  // Preload in guest webviews is high risk; only allow empty/undefined (no guest preload).
  if (typeof prefs.preload === 'string' && prefs.preload.trim().length > 0) {
    return { allowed: false, reason: 'WebView guest preload is not allowed' };
  }

  return {
    allowed: true,
    reason: `WebView attach allowed for ${srcDecision.kind}`,
    prefs: {
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      partition: WEBVIEW_CONTROL_PARTITION,
    },
  };
}
