import { createHash } from 'node:crypto';

const REQUIRED_FIELDS = ['runId', 'createdAt', 'outcome', 'reproducer', 'signature'];
const ALLOWED_REPRODUCER_KINDS = new Set(['scenario', 'route', 'command-id']);
const REDACTED_FIELD_NAMES = new Set([
  'prompt',
  'messages',
  'body',
  'authorization',
  'apikey',
  'headers',
  'rawprompt',
]);
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\bphc_[A-Za-z0-9_-]{8,}/,
  /\bghp_[A-Za-z0-9_-]{8,}/,
  /\bAKIA[A-Z0-9]{12,}\b/,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
];

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function normalizeFieldName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function containsSecretLikeContent(value) {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretLikeContent);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => {
      if (REDACTED_FIELD_NAMES.has(normalizeFieldName(key))) {
        return true;
      }
      return containsSecretLikeContent(child);
    });
  }
  return false;
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
}

function makeDigest(trace) {
  return createHash('sha256').update(canonicalize(trace), 'utf8').digest('hex').slice(0, 16);
}

function diagnostic(code, message) {
  return message === undefined ? { code } : { code, message };
}

function validOutcome(outcome) {
  return ['failure', 'success', 'refusal', 'refused', 'cancelled', 'canceled'].includes(outcome);
}

/**
 * Convert one already-redacted trace into an evaluation sample.
 *
 * The converter deliberately copies only the bounded fields required for replay;
 * it never includes the source trace or its signature in the returned sample.
 *
 * @param {Record<string, unknown>} trace
 * @returns {{ok: true, sample: Record<string, unknown>} | {ok: false, diagnostics: Array<{code: string, message?: string}>}}
 */
export function traceToEvalSample(trace) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    return {
      ok: false,
      diagnostics: [diagnostic('missing-field', 'trace must be an object')],
    };
  }

  const missingField = REQUIRED_FIELDS.find((field) => isMissing(trace[field]));
  if (missingField) {
    return {
      ok: false,
      diagnostics: [diagnostic('missing-field', `missing required field: ${missingField}`)],
    };
  }

  if (containsSecretLikeContent(trace)) {
    return {
      ok: false,
      diagnostics: [diagnostic('trace-not-redacted', 'trace contains raw or secret-like content')],
    };
  }

  const reproducer = trace.reproducer;
  if (!reproducer || typeof reproducer !== 'object' || Array.isArray(reproducer)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-reproducer', 'reproducer must be an object')],
    };
  }

  const { kind, ref } = reproducer;
  if (!ALLOWED_REPRODUCER_KINDS.has(kind) || (typeof ref !== 'string' && typeof ref !== 'number') || String(ref).trim() === '') {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-reproducer', 'reproducer kind or ref is invalid')],
    };
  }

  if (!validOutcome(trace.outcome)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-outcome', `unsupported outcome: ${String(trace.outcome)}`)],
    };
  }

  const attemptValue = trace.attempt === undefined || trace.attempt === null ? 1 : trace.attempt;
  if (!Number.isInteger(attemptValue) || attemptValue <= 0) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-attempt', 'attempt must be a positive integer')],
    };
  }

  const beforeFix = trace.outcome === 'failure' ? 'fail' : 'pass';
  return {
    ok: true,
    sample: {
      sourceRunId: trace.runId,
      expected: {
        'before-fix': beforeFix,
        'after-fix': 'pass',
      },
      reproducer: {
        kind,
        ref,
      },
      selector: {
        runId: trace.runId,
        attempt: attemptValue,
      },
      digest: makeDigest(trace),
    },
  };
}

/**
 * Convert a caller-selected collection of traces while preserving input order.
 *
 * @param {Array<Record<string, unknown>>} traces
 * @returns {{samples: Array<Record<string, unknown>>, rejected: Array<{runId: unknown, diagnostics: Array<{code: string, message?: string}>}>}}
 */
export function traceToEvalSamples(traces) {
  if (!Array.isArray(traces)) {
    return {
      samples: [],
      rejected: [],
    };
  }

  const samples = [];
  const rejected = [];
  for (const trace of traces) {
    const result = traceToEvalSample(trace);
    if (result.ok) {
      samples.push(result.sample);
    } else {
      rejected.push({
        runId: trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.runId ?? null : null,
        diagnostics: result.diagnostics,
      });
    }
  }
  return { samples, rejected };
}

export default traceToEvalSamples;
