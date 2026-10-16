/**
 * M4 runtime mode policy (m4-mode / m4-boundary / m4-revoke).
 * Default normal_restricted; upgrades are explicit, expiring, and revocable.
 * Fail-closed: missing bindings never grant elevated capability.
 */
import {
  isBoundaryGrantUsable,
  isControlledEnhancedAuthorized,
  isFullAccessContextAuthorized,
  isFullAccessAuthorized,
  isRuntimeReadonlyAuthorized,
  type BrowserAutomationMode,
  type BrowserAutomationGrant,
  type BoundaryGrantContext,
  type ToolAuthorizationContext,
  type ToolAuthorizationMode,
  NORMAL_TOOL_AUTHORIZATION_CONTEXT,
} from './tool-authorization.ts';

export type ModeUpgradeRequest = {
  sessionId: string;
  target: Extract<BrowserAutomationMode, 'controlled_enhanced' | 'full_access'>;
  reason?: string;
  ttlMs?: number;
  tabId?: number;
  origin?: string;
};

export type ModeUpgradeDecision =
  | { granted: true; context: ToolAuthorizationContext; mode: BrowserAutomationMode }
  | { granted: false; code: 'E_NEED_CONFIRM' | 'E_DENIED' | 'E_EXPIRED' | 'E_BAD_TARGET'; message: string };

export type BoundaryConfirmRequest = {
  id: string;
  tabId: number;
  origin: string;
  toolCallId: string;
  scopeKey: string;
  grants: BrowserAutomationGrant[];
  selectedChoiceIds: string[];
  otherText?: string;
  ttlMs?: number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class RuntimeModePolicy {
  private modes = new Map<string, BrowserAutomationMode>();
  private auth = new Map<string, ToolAuthorizationContext>();
  private boundaryGrants = new Map<string, BoundaryGrantContext>();

  getMode(sessionId: string): BrowserAutomationMode {
    return this.modes.get(sessionId) ?? 'normal_restricted';
  }

  getAuth(sessionId: string): ToolAuthorizationContext {
    return this.auth.get(sessionId) ?? NORMAL_TOOL_AUTHORIZATION_CONTEXT;
  }

  /**
   * Request elevation. Without confirmed=true this is a dry-run that returns
   * E_NEED_CONFIRM so hosts can show a HITL gate before granting.
   */
  requestUpgrade(request: ModeUpgradeRequest & { confirmed?: boolean }): ModeUpgradeDecision {
    if (request.target !== 'controlled_enhanced' && request.target !== 'full_access') {
      return { granted: false, code: 'E_BAD_TARGET', message: `unsupported target mode: ${String(request.target)}` };
    }
    if (!request.confirmed) {
      return {
        granted: false,
        code: 'E_NEED_CONFIRM',
        message: `elevation to ${request.target} requires explicit human confirmation`,
      };
    }

    const now = Date.now();
    const ttl = request.ttlMs ?? DEFAULT_TTL_MS;
    const mode: BrowserAutomationMode = request.target;
    const authMode: ToolAuthorizationMode =
      request.target === 'full_access' ? 'full_access' : 'controlled_enhanced';
    const context: ToolAuthorizationContext = {
      mode: authMode,
      createdAt: now,
      expiresAt: now + ttl,
      ...(request.tabId !== undefined ? { tabId: request.tabId } : {}),
      ...(request.origin ? { origin: request.origin } : {}),
      ...(request.reason ? { reason: request.reason } : {}),
    };

    this.modes.set(request.sessionId, mode);
    this.auth.set(request.sessionId, context);
    return { granted: true, context, mode };
  }

  /** Drop elevated rights immediately; mode falls back to normal_restricted. */
  revoke(sessionId: string): { mode: BrowserAutomationMode; revoked: boolean } {
    const had = this.modes.get(sessionId) !== undefined && this.modes.get(sessionId) !== 'normal_restricted';
    this.modes.delete(sessionId);
    this.auth.delete(sessionId);
    this.boundaryGrants.delete(sessionId);
    return { mode: 'normal_restricted', revoked: had };
  }

  confirmBoundary(sessionId: string, request: BoundaryConfirmRequest): BoundaryGrantContext | {
    denied: true;
    code: 'E_NEED_CONFIRM' | 'E_EXPIRED';
    message: string;
  } {
    if (!request.selectedChoiceIds.length && !request.otherText) {
      return {
        denied: true,
        code: 'E_NEED_CONFIRM',
        message: 'boundary confirmation requires at least one selected choice',
      };
    }
    const now = Date.now();
    const grant: BoundaryGrantContext = {
      id: request.id,
      tabId: request.tabId,
      origin: request.origin,
      toolCallId: request.toolCallId,
      scopeKey: request.scopeKey,
      grants: request.grants,
      selectedChoiceIds: request.selectedChoiceIds,
      ...(request.otherText ? { otherText: request.otherText } : {}),
      createdAt: now,
      expiresAt: now + (request.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.boundaryGrants.set(sessionId, grant);
    return grant;
  }

  isBoundaryUsable(
    sessionId: string,
    binding: { tabId?: number; origin?: string },
    now = Date.now(),
  ): boolean {
    return isBoundaryGrantUsable(
      this.boundaryGrants.get(sessionId),
      binding.tabId,
      binding.origin,
      now,
    );
  }

  /** Capability checks — all fail-closed on missing/expired bindings. */
  canRuntimeRead(sessionId: string, tabId: number | undefined, now = Date.now()): boolean {
    return isRuntimeReadonlyAuthorized(this.getAuth(sessionId), tabId, now);
  }

  /**
   * TF-0105: session-level runtime-read check for callers with no numeric tab
   * binding. The host engine binds the grant to a tab (`canRuntimeRead`); the
   * standalone playwright driver has no tabId, so this is the honest weaker
   * check the facade can make: an unexpired read-level grant on the session.
   * `full_access` is deliberately **not** accepted — a deep read is not a
   * full-access tool (same fail-closed mapping the host engine uses).
   */
  canRuntimeReadSession(sessionId: string, now = Date.now()): boolean {
    const auth = this.getAuth(sessionId);
    if (auth.mode !== 'controlled_enhanced' && auth.mode !== 'runtime_readonly') {
      return false;
    }
    if (auth.expiresAt !== undefined && auth.expiresAt <= now) {
      return false;
    }
    return true;
  }

  canControlledEnhanced(sessionId: string, tabId: number | undefined, now = Date.now()): boolean {
    return isControlledEnhancedAuthorized(this.getAuth(sessionId), tabId, now);
  }

  canFullAccess(
    sessionId: string,
    binding: { tabId?: number; origin?: string; expectedTabId?: number; expectedOrigin?: string },
    now = Date.now(),
  ): boolean {
    const auth = this.getAuth(sessionId);
    const modeOk = isFullAccessAuthorized(auth, binding.tabId, now);
    return isFullAccessContextAuthorized({
      modeOk,
      tabId: binding.tabId,
      origin: binding.origin,
      expectedTabId: binding.expectedTabId ?? auth.tabId,
      expectedOrigin: binding.expectedOrigin ?? auth.origin,
      expiresAt: auth.expiresAt,
      now,
    });
  }

  /** Snapshot for timeline / audit. Never includes grant secrets. */
  describe(sessionId: string): {
    mode: BrowserAutomationMode;
    authMode: ToolAuthorizationMode;
    expiresAt?: number;
    reason?: string;
    hasBoundaryGrant: boolean;
  } {
    const auth = this.getAuth(sessionId);
    return {
      mode: this.getMode(sessionId),
      authMode: auth.mode,
      ...(auth.expiresAt !== undefined ? { expiresAt: auth.expiresAt } : {}),
      ...(auth.reason ? { reason: auth.reason } : {}),
      hasBoundaryGrant: this.boundaryGrants.has(sessionId),
    };
  }
}

/** Page-derived text must never be treated as instructions (G5). */
export function markUntrustedPageText(text: string): {
  text: string;
  provenance: 'page_content';
  untrusted: true;
  policy: 'do_not_escalate_to_instruction';
} {
  return {
    text,
    provenance: 'page_content',
    untrusted: true,
    policy: 'do_not_escalate_to_instruction',
  };
}
