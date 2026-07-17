/**
 * Host invoke security controls (P1-002 / F-SEC-005).
 * - Sender/session binding for host:invoke
 * - Payload size / depth / prototype pollution guards
 * - Renderer-safe error message sanitization
 */

export const HOST_INVOKE_MAX_PAYLOAD_BYTES = 1_048_576; // 1 MiB
export const HOST_INVOKE_MAX_DEPTH = 12;
export const HOST_INVOKE_MAX_KEYS_PER_OBJECT = 256;
export const HOST_INVOKE_MAX_ARRAY_LENGTH = 10_000;

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const PATH_LEAK_RE = /(?:[A-Za-z]:\\|\\|\/Users\/|\/home\/|\/var\/|\/tmp\/|file:\/\/)[^\s'"`]+/g;
const STACK_RE = /(?:^|\n)\s*at\s+[^\n]+/g;
const SECRETISH_RE = /(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi;

export type HostPayloadValidationFailure = {
  code: 'VALIDATION';
  message: string;
};

export function measurePayloadBytes(payload: unknown): number {
  if (payload === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch {
    // Circular / non-serializable payloads are rejected separately by depth walk.
    return Number.POSITIVE_INFINITY;
  }
}

export function validateHostPayload(
  payload: unknown,
  options: {
    maxBytes?: number;
    maxDepth?: number;
    maxKeysPerObject?: number;
    maxArrayLength?: number;
  } = {},
): HostPayloadValidationFailure | null {
  if (payload === undefined) return null;

  const maxBytes = options.maxBytes ?? HOST_INVOKE_MAX_PAYLOAD_BYTES;
  const maxDepth = options.maxDepth ?? HOST_INVOKE_MAX_DEPTH;
  const maxKeys = options.maxKeysPerObject ?? HOST_INVOKE_MAX_KEYS_PER_OBJECT;
  const maxArrayLength = options.maxArrayLength ?? HOST_INVOKE_MAX_ARRAY_LENGTH;

  const bytes = measurePayloadBytes(payload);
  if (bytes > maxBytes) {
    return { code: 'VALIDATION', message: 'Host request payload exceeds size limit' };
  }

  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): HostPayloadValidationFailure | null => {
    if (value === null || typeof value !== 'object') return null;
    if (depth > maxDepth) {
      return { code: 'VALIDATION', message: 'Host request payload exceeds max depth' };
    }
    if (seen.has(value as object)) {
      return { code: 'VALIDATION', message: 'Host request payload contains cycles' };
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      if (value.length > maxArrayLength) {
        return { code: 'VALIDATION', message: 'Host request payload array exceeds max length' };
      }
      for (const item of value) {
        const nested = walk(item, depth + 1);
        if (nested) return nested;
      }
      return null;
    }

    // Reject objects that inherit unexpected prototypes (beyond plain Object / null).
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Allow common structured clones like Date / Buffer / Uint8Array? Prefer plain JSON only for IPC.
      if (!(value instanceof Date) && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
        return { code: 'VALIDATION', message: 'Host request payload has unsupported prototype' };
      }
      return null;
    }

    const keys = Reflect.ownKeys(value as object);
    if (keys.length > maxKeys) {
      return { code: 'VALIDATION', message: 'Host request payload object exceeds max keys' };
    }
    for (const key of keys) {
      const keyText = typeof key === 'string' ? key : String(key);
      if (DANGEROUS_KEYS.has(keyText)) {
        return { code: 'VALIDATION', message: 'Host request payload contains dangerous keys' };
      }
      const nested = walk((value as Record<string | symbol, unknown>)[key as string], depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  return walk(payload, 0);
}

export function sanitizeHostErrorMessage(message: string): string {
  let next = String(message ?? 'Host request failed');
  next = next.replace(STACK_RE, '');
  next = next.replace(PATH_LEAK_RE, '[redacted-path]');
  next = next.replace(SECRETISH_RE, '[redacted-secret]');
  next = next.replace(/\s+/g, ' ').trim();
  if (!next) next = 'Host request failed';
  // Cap length so huge messages cannot leak bulk content.
  if (next.length > 280) next = next.slice(0, 277) + '...';
  return next;
}

export type HostSenderAuthorization = {
  /** Allowed BrowserWindow/WebContents ids for host:invoke. */
  allowedWebContentsIds: ReadonlySet<number>;
  /** Optional allowlist of senderFrame URL prefixes (e.g. app origin). Empty = skip URL check. */
  allowedUrlPrefixes?: readonly string[];
};

export type IpcSenderLike = {
  id?: number;
  isDestroyed?: () => boolean;
  getURL?: () => string;
  session?: { partition?: string };
};

export type IpcEventLike = {
  sender?: IpcSenderLike;
  senderFrame?: { url?: string } | null;
};

export function assertAuthorizedHostSender(
  event: IpcEventLike | undefined,
  auth: HostSenderAuthorization | undefined,
): HostPayloadValidationFailure | null {
  // Unit tests / internal dispatch without IPC event remain allowed when auth is unset.
  if (!auth) return null;
  if (!event?.sender) {
    return { code: 'VALIDATION', message: 'Host request missing sender' };
  }
  if (event.sender.isDestroyed?.()) {
    return { code: 'VALIDATION', message: 'Host request sender is destroyed' };
  }
  const senderId = event.sender.id;
  if (typeof senderId !== 'number' || !auth.allowedWebContentsIds.has(senderId)) {
    return { code: 'VALIDATION', message: 'Host request sender is not authorized' };
  }

  const prefixes = auth.allowedUrlPrefixes ?? [];
  if (prefixes.length > 0) {
    const url = event.senderFrame?.url || event.sender.getURL?.() || '';
    const ok = prefixes.some((prefix) => url === prefix || url.startsWith(prefix));
    if (!ok) {
      return { code: 'VALIDATION', message: 'Host request sender session is not authorized' };
    }
  }
  return null;
}
