/**
 * M4 vault policy: credentials must never enter LLM context.
 * Redact common secret shapes from any tool-facing text/JSON payload.
 */
import { redactSensitiveUrlLikeString } from './net-policy/redact-sensitive-url.ts';
// The canonical secret-name check lives in a leaf module so the URL redactor can share it without a
// cycle (redact-sensitive-url.ts is imported here).
import { SECRET_KEY_PATTERN, isSensitiveNetworkName } from './secret-names.ts';

export { isSensitiveNetworkName } from './secret-names.ts';

/**
 * C96/TF-0123: the module's own key checks used to consult `SECRET_KEY_PATTERN` only, so the
 * network-alias names (`session`/`sid`/`csrf`/`xsrf`) and the field-family extras (`otp`/`pin`)
 * passed through every rule here - measured 2026-10-14: `session=...`, `{"sid": "..."}` and
 * `redactSecretsInValue({ otp: '...' })` all kept their values while `token`/`api_key` were
 * redacted. One predicate now serves all three rules.
 */
/**
 * For a structured *key*, the network aliases must match the whole name. `sessionId` is a
 * documented non-secret identifier the model needs (a test pins it), and the substring form of
 * `isSensitiveNetworkName` would redact it; `session` / `sid` / `csrf` / `xsrf` on their own are
 * secret. Free text keeps the substring check, where the key really is the token before `=`/`:`.
 */
const ALIAS_KEY_PATTERN = /^(?:session|sid|csrf|xsrf)$/i;
function isSensitiveFieldKey(name: string): boolean {
  return isSensitiveNetworkName(name);
}
function isSensitiveValueKey(name: string): boolean {
  return SECRET_KEY_PATTERN.test(name) || ALIAS_KEY_PATTERN.test(name) || /^(?:otp|pin)$/i.test(name);
}

const INLINE_SECRET_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // JWT-ish first so later rules cannot swallow the marker
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: '[REDACTED_JWT]' },
  // Bearer / Basic auth headers before key-value (Authorization: Bearer <token>)
  { re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: '$1 [REDACTED]' },
  // key: value / "key": "value" where key looks secret
  {
    re: /(?<![\w.-])("?(?:[\w.-]*(?:password|passwd|secret|token|api[-_]?key|authorization|credential|private[-_]?key|cookie|session|csrf|xsrf)[\w.-]*|pass|auth|sid|otp|pin)"?\s*[:=]\s*)("?)([^"'\s,;}]+)\2/gi,
    replace: '$1$2[REDACTED]$2',
  },
];

export const REDACTED = '[REDACTED]';

/** Redact secrets from a free-form string (console text, stack, markdown). */
export function redactSecretsInText(text: string): string {
  // Keep complete quoted values together; the unquoted rule must not leave their tail.
  // The key group is **bounded**. An unbounded `[\w.-]+` followed by `\s*([:=])` backtracks
  // character by character at every start position when the input is one long delimiter-free token:
  // measured 2026-10-14, 20,000 chars -> 0.24 s, 80,000 -> 4.3 s (quadratic), and a 1.2 MB single-token
  // tool result hung the whole envelope for minutes. A 256-char cap keeps every real key (config
  // paths, env var names, header names) while making the scan linear: 1.2 MB -> 0.34 s.
  let out = text.replace(/([\w.-]{1,256}|"[\w.-]{1,256}")\s*([:=])\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
    (match, key: string, separator: string, value: string) => isSensitiveFieldKey(key.replaceAll('"', ''))
      ? `${key}${separator}${value[0]}${REDACTED}${value[0]}` : match);
  out = out.replace(/^([ \t]*)([\w-]+)(:[ \t]*)([^\r\n]*)/gm,
    (match, indent: string, name: string, separator: string) => isSensitiveLineName(name)
      ? `${indent}${name}${separator}${REDACTED}` : match);
  for (const { re, replace } of INLINE_SECRET_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out.replace(/https?:\/\/[^\s"'<>]+/gu, redactSensitiveUrlLikeString);
}

/**
 * The line-start rule uses whole-word aliases.
 *
 * `isSensitiveNetworkName` matches `session|sid|csrf|xsrf|otp|pin` as **substrings**, which is
 * right for `sid=...` but wrong for an English word that merely contains one: measured
 * 2026-10-14, `consider:`, `president:`, `residue:`, `pinto:`, `inside:` and `beside:` were all
 * redacted because of `sid`/`pin`. The credential half of the check stays a substring match so
 * `X-Api-Key` / `client_secret` still fire.
 */
const SENSITIVE_LINE_ALIAS = /^(?:session|sid|csrf|xsrf|otp|pin)$/i;
function isSensitiveLineName(name: string): boolean {
  return SECRET_KEY_PATTERN.test(name) || SENSITIVE_LINE_ALIAS.test(name);
}

/** Serialize only after structured redaction, retaining JSON containers and scalar types. */
export function serializeRedactedJson(value: unknown): string {
  return JSON.stringify(redactSecretsInValue(value), null, 2);
}

/** Deep-redact secrets from a JSON-serializable value. Never mutates input. */
export function redactSecretsInValue<T>(value: T): T {
  return redactValue(value) as T;
}

/** Only a scalar can be a credential; a `session`/`cookie` object is a container. */
function isScalar(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecretsInText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sensitivePair = typeof record.name === 'string' && isSensitiveNetworkName(record.name);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (/^cookies$/i.test(key) && Array.isArray(entry)) {
        out[key] = entry.map(cookie => cookie && typeof cookie === 'object'
          ? { ...redactValue(cookie) as Record<string, unknown>, value: REDACTED } : REDACTED);
      } else if ((key === 'value' && sensitivePair) ||
        (isSensitiveValueKey(key) && isScalar(entry))) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue(entry);
      }
    }
    return out;
  }
  return value;
}

/**
 * Wrap a ToolResult-like payload so content + data never leak secrets.
 * Evidence paths are kept (paths are not secrets).
 */
export function redactToolResultPayload(payload: {
  ok: boolean;
  content: string;
  data?: unknown;
  evidence?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}): typeof payload {
  return {
    ...payload,
    content: redactSecretsInText(payload.content),
    ...(payload.data !== undefined ? { data: redactSecretsInValue(payload.data) } : {}),
    ...(payload.error
      ? {
          error: {
            ...payload.error,
            message: redactSecretsInText(payload.error.message),
            ...(payload.error.details
              ? { details: redactSecretsInValue(payload.error.details) }
              : {}),
          },
        }
      : {}),
  };
}
