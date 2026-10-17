/**
 * Electron multi-process attach (TF-0029).
 *
 * Target model mirrors Electron's process split:
 *   - main     (Node / app process — playwright electronApp.evaluate)
 *   - renderer (BrowserWindow webContents — page targets)
 *   - worker   (optional)
 *
 * Pure selection/reconnect logic is unit-testable without launching Electron.
 */

export type ElectronTargetKind = 'main' | 'renderer' | 'worker' | 'service-worker' | 'other';

export type ElectronTargetDescriptor = {
  /** CDP target id or stable synthetic id. */
  id: string;
  kind: ElectronTargetKind;
  /** Page/app URL when known. */
  url?: string;
  title?: string;
  /** True when the target is attached & healthy. */
  attached?: boolean;
  /** Last detach reason (normalized). */
  lastDetachReason?: string;
  /** BrowserWindow / webContents id when known. */
  windowId?: number;
};

export type AttachSelection = {
  target: ElectronTargetDescriptor | null;
  reason: string;
};

const INTERNAL_URL =
  /^(chrome|edge|about|devtools|chrome-extension|view-source|app|clawx):/iu;

/**
 * Internal / non-app pages (devtools, chrome://, app:// shell).
 * `file://` is allowed — Electron fixtures and asar UI load via file.
 * Browser-control URL policy is stricter and lives in core/browser-control.
 */
export function isRestrictedElectronUrl(url: string | undefined): boolean {
  if (!url) return false;
  return INTERNAL_URL.test(url.trim());
}

/**
 * Prefer a visible app renderer over internal/devtools targets.
 * Score: non-restricted http(s)/app content > titled renderer > any renderer > others.
 */
export function selectRendererTarget(
  targets: readonly ElectronTargetDescriptor[],
  options: { preferUrlIncludes?: string; excludeIds?: readonly string[] } = {},
): AttachSelection {
  const exclude = new Set(options.excludeIds ?? []);
  const candidates = targets.filter(
    (t) =>
      t.kind === 'renderer' &&
      !exclude.has(t.id) &&
      !isRestrictedElectronUrl(t.url),
  );

  if (candidates.length === 0) {
    return { target: null, reason: 'no attachable renderer target (restricted or empty list)' };
  }

  const prefer = options.preferUrlIncludes;
  const scored = candidates.map((t) => {
    let score = 0;
    if (t.url?.startsWith('http') || t.url?.startsWith('file:')) score += 2;
    if (t.title && t.title.trim()) score += 1;
    if (prefer && (t.url ?? '').includes(prefer)) score += 5;
    if (t.attached) score += 0.5;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return {
    target: scored[0].t,
    reason: `selected renderer ${scored[0].t.id} (score ${scored[0].score}, ${candidates.length} candidate(s))`,
  };
}

export function normalizeDetachReason(
  reason: string | undefined | null,
): 'canceled_by_user' | 'target_closed' | 'tab_removed' | 'disabled_by_user' | 'unknown' {
  switch (reason) {
    case 'canceled_by_user':
      return 'canceled_by_user';
    case 'target_closed':
      return 'target_closed';
    case 'replaced_with_devtools':
    case 'tab_removed':
      return 'tab_removed';
    case 'disabled_by_user':
      return 'disabled_by_user';
    default:
      return 'unknown';
  }
}

export type ReconnectPlan =
  | { action: 'reuse'; targetId: string; reason: string }
  | { action: 'rescan'; reason: string }
  | { action: 'fail'; reason: string };

/**
 * Session stability: after detach, decide whether to re-attach or fail closed.
 * Fail-closed when the only remaining targets are restricted internal pages.
 */
export function planReconnect(
  previous: ElectronTargetDescriptor | null,
  targets: readonly ElectronTargetDescriptor[],
  detachReason: string | undefined,
  attempts: number,
  maxAttempts = 3,
): ReconnectPlan {
  const reason = normalizeDetachReason(detachReason);
  if (reason === 'canceled_by_user' || reason === 'disabled_by_user') {
    return { action: 'fail', reason: `detach ${reason} — not auto-reconnecting` };
  }
  if (attempts >= maxAttempts) {
    return { action: 'fail', reason: `reconnect budget exhausted (${attempts}/${maxAttempts})` };
  }
  if (previous) {
    const same = targets.find((t) => t.id === previous.id && t.kind === 'renderer');
    if (same && !isRestrictedElectronUrl(same.url)) {
      return { action: 'reuse', targetId: same.id, reason: `target ${same.id} still present` };
    }
  }
  const selection = selectRendererTarget(targets, {
    ...(previous?.id ? { excludeIds: [] } : {}),
  });
  if (selection.target) {
    return {
      action: 'reuse',
      targetId: selection.target.id,
      reason: selection.reason,
    };
  }
  return {
    action: 'rescan',
    reason: 'no renderer yet — rescan (app may still be booting)',
  };
}

export type ElectronAttachState = {
  sessionId: string;
  targets: ElectronTargetDescriptor[];
  selectedId?: string;
  attached: boolean;
  reconnectAttempts: number;
  history: Array<{ at: string; event: string; detail?: string }>;
};

export function createAttachState(sessionId: string): ElectronAttachState {
  return {
    sessionId,
    targets: [],
    attached: false,
    reconnectAttempts: 0,
    history: [],
  };
}

export function recordAttachEvent(
  state: ElectronAttachState,
  event: string,
  detail?: string,
): ElectronAttachState {
  state.history.push({ at: new Date().toISOString(), event, ...(detail ? { detail } : {}) });
  // Keep a bounded timeline for Evidence.
  if (state.history.length > 50) state.history.splice(0, state.history.length - 50);
  return state;
}

/**
 * Actionable failure messages (TF-0029 acceptance).
 */
export function formatAttachFailure(
  state: ElectronAttachState,
  code: string,
  message: string,
): string {
  const kinds = state.targets.map((t) => `${t.kind}:${t.id}${t.url ? `(${t.url})` : ''}`).join(', ');
  return [
    `Electron attach failed [${code}]: ${message}`,
    `session=${state.sessionId} attached=${state.attached} selected=${state.selectedId ?? '-'}`,
    `targets: ${kinds || '(none)'}`,
    'hint: launch with --remote-debugging-port or use playwright _electron.launch; ensure a non-restricted renderer URL is loaded.',
  ].join('\n');
}

/** Classify a raw CDP targetInfo-like object. */
export function classifyTarget(info: {
  type?: string;
  url?: string;
  title?: string;
  targetId?: string;
  id?: string;
  attached?: boolean;
}): ElectronTargetDescriptor {
  const raw = (info.type ?? '').toLowerCase();
  let kind: ElectronTargetKind = 'other';
  if (raw === 'page' || raw === 'webview') kind = 'renderer';
  else if (raw === 'service_worker') kind = 'service-worker';
  else if (raw === 'worker' || raw === 'shared_worker') kind = 'worker';
  else if (raw === 'browser' || raw === 'node' || raw === 'main') kind = 'main';
  else if (raw === 'node' || (info.url ?? '').startsWith('file://') && !raw) kind = 'renderer';

  // Electron main often reports type "node" or "browser".
  if (raw === 'node') kind = 'main';

  return {
    id: info.targetId ?? info.id ?? `t-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    ...(info.url ? { url: info.url } : {}),
    ...(info.title ? { title: info.title } : {}),
    ...(info.attached !== undefined ? { attached: info.attached } : {}),
  };
}
