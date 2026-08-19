// Runtime Lifecycle Governance — process-level session admission gate.
//
// Phase 0 foundation. This registry is intentionally default-off: production
// entry points call `acquireSessionAdmissionPermit`, which is a no-op unless
// RUNTIME_LIFECYCLE_ADMISSION_ENABLED is truthy. The registry itself has no
// user-visible behavior in the default configuration.
import { isTruthyEnvValue } from "../infra/env.js";
import { parseAgentSessionKey } from "../routing/session-key.js";

export const RUNTIME_LIFECYCLE_ADMISSION_ENABLED_ENV = "RUNTIME_LIFECYCLE_ADMISSION_ENABLED";

/** Side-effect entry-point kinds that must take an admission permit. */
export type SessionAdmissionKind =
  | "chat-send"
  | "sessions-send"
  | "sessions-steer"
  | "reply-turn"
  | "embedded-agent"
  | "subagent-spawn"
  | "acp-spawn"
  | "exec-spawn"
  | "verseshell-spawn"
  | "goal-wake-arm"
  | "goal-wake-ack";

/**
 * Lifecycle identity. `scopeKey` is deliberately not part of identity:
 * reset/delete fencing must distinguish session generations.
 */
export type SessionAdmissionIdentity = {
  agentId: string;
  canonicalSessionKey: string;
  expectedSessionId: string;
};

export type SessionAdmissionPermit = {
  identity: SessionAdmissionIdentity;
  kind: SessionAdmissionKind;
  release: () => void;
};

export class SessionAdmissionFencedError extends Error {
  constructor(identity: SessionAdmissionIdentity) {
    super(
      `session admission is fenced for ${identity.canonicalSessionKey} (${identity.expectedSessionId})`,
    );
    this.name = "SessionAdmissionFencedError";
  }
}

export class SessionAdmissionIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionAdmissionIdentityError";
  }
}

type AdmissionEntry = {
  active: number;
  fenced: boolean;
  fenceToken: object | null;
  totalPermits: number;
  totalRejectedWhileFenced: number;
};

type FenceHandle = {
  identity: SessionAdmissionIdentity;
  token: object;
  release: () => void;
};

function identityKey(identity: SessionAdmissionIdentity): string {
  return JSON.stringify([
    identity.agentId,
    identity.canonicalSessionKey,
    identity.expectedSessionId,
  ]);
}

function assertIdentity(identity: SessionAdmissionIdentity): void {
  if (!identity.agentId.trim()) {
    throw new SessionAdmissionIdentityError("admission identity requires agentId");
  }
  if (!identity.canonicalSessionKey.trim()) {
    throw new SessionAdmissionIdentityError("admission identity requires canonicalSessionKey");
  }
  if (!identity.expectedSessionId.trim()) {
    throw new SessionAdmissionIdentityError("admission identity requires expectedSessionId");
  }
}

function defaultIdentity(identity: Omit<SessionAdmissionIdentity, "agentId"> & { agentId?: string }): SessionAdmissionIdentity {
  const agentId = identity.agentId?.trim()
    || parseAgentSessionKey(identity.canonicalSessionKey)?.agentId?.trim();
  if (!agentId) {
    throw new SessionAdmissionIdentityError(
      `unable to resolve agentId for admission identity ${identity.canonicalSessionKey}`,
    );
  }
  return {
    agentId,
    canonicalSessionKey: identity.canonicalSessionKey.trim(),
    expectedSessionId: identity.expectedSessionId.trim(),
  };
}

const noopRelease = (): void => {};

/**
 * Process-level registry. JavaScript's single-threaded turn semantics make the
 * fenced check + active counter increment atomic with respect to `fence()`.
 */
export class SessionAdmissionRegistry {
  readonly #entries = new Map<string, AdmissionEntry>();

  acquirePermit(identityInput: Omit<SessionAdmissionIdentity, "agentId"> & {
    agentId?: string;
  }, kind: SessionAdmissionKind): () => void {
    const identity = defaultIdentity(identityInput);
    void kind;
    assertIdentity(identity);
    const key = identityKey(identity);
    const entry = this.#entry(key);
    if (entry.fenced) {
      entry.totalRejectedWhileFenced += 1;
      throw new SessionAdmissionFencedError(identity);
    }
    entry.active += 1;
    entry.totalPermits += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.active = Math.max(0, entry.active - 1);
    };
  }

  /**
   * Atomically closes the entry point, then waits for in-flight admission
   * critical sections to drain. Returns an exclusive token; `release()` (or
   * `removeFence`) reopens the identity.
   */
  async fence(identityInput: Omit<SessionAdmissionIdentity, "agentId"> & {
    agentId?: string;
  }): Promise<FenceHandle> {
    const identity = defaultIdentity(identityInput);
    assertIdentity(identity);
    const key = identityKey(identity);
    const entry = this.#entry(key);
    if (entry.fenced) {
      throw new SessionAdmissionFencedError(identity);
    }
    const token = {};
    entry.fenced = true;
    entry.fenceToken = token;
    while (entry.active > 0) {
      // Yield the microtask/event loop so in-flight critical sections can
      // release; no new permit can enter because fenced was set first.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    let released = false;
    return {
      identity,
      token,
      release: () => {
        if (released) return;
        released = true;
        if (entry.fenceToken === token && entry.active === 0) {
          entry.fenced = false;
          entry.fenceToken = null;
        }
      },
    };
  }

  isFenced(identity: SessionAdmissionIdentity): boolean {
    const key = identityKey(identity);
    return this.#entries.get(key)?.fenced === true;
  }

  removeFence(identity: SessionAdmissionIdentity): void {
    const key = identityKey(identity);
    const entry = this.#entries.get(key);
    if (!entry) return;
    entry.fenced = false;
    entry.fenceToken = null;
  }

  snapshot(identity: SessionAdmissionIdentity): AdmissionEntry | undefined {
    const key = identityKey(identity);
    const entry = this.#entries.get(key);
    return entry ? { ...entry } : undefined;
  }

  clearForTests(): void {
    this.#entries.clear();
  }

  #entry(key: string): AdmissionEntry {
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = {
        active: 0,
        fenced: false,
        fenceToken: null,
        totalPermits: 0,
        totalRejectedWhileFenced: 0,
      };
      this.#entries.set(key, entry);
    }
    return entry;
  }
}

export const sessionAdmissionRegistry = new SessionAdmissionRegistry();

export function sessionAdmissionEnabled(): boolean {
  return isTruthyEnvValue(process.env[RUNTIME_LIFECYCLE_ADMISSION_ENABLED_ENV]);
}

/**
 * Production entry-point hook. Default-off no-op; when enabled it acquires a
 * real permit and throws `SessionAdmissionFencedError` for a closed identity.
 */
export function acquireSessionAdmissionPermit(
  identity: Omit<SessionAdmissionIdentity, "agentId"> & { agentId?: string },
  kind: SessionAdmissionKind,
): () => void {
  if (!sessionAdmissionEnabled()) return noopRelease;
  return sessionAdmissionRegistry.acquirePermit(identity, kind);
}
