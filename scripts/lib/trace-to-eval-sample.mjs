/**
 * G03: turn a redacted failure trace into a re-runnable eval sample.
 *
 * Explicit-trigger only: the caller passes the trace(s) it selected (for example
 * the most recent 7 days by run id) — this module never schedules or watches
 * anything. Each sample carries:
 * - an expected outcome (`before-fix: fail`, `after-fix: pass`);
 * - a bounded reproducer (a route/id, never a raw shell command);
 * - a digest for replay comparison;
 * and it refuses any trace that is not redacted (raw prompt / secret / auth
 * fields), so a promoted sample cannot leak the failure content.
 */

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/,
  /phc_[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const RAW_CONTENT_KEYS = ["prompt", "rawPrompt", "messages", "body", "authorization", "apiKey", "headers"];

export const TRACE_TO_EVAL_SCHEMA = "clawx.trace-to-eval.v1";

function sha256(value) {
  // Small dependency-free hash so the pure module has no node:crypto import.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

function isRedacted(trace) {
  const text = JSON.stringify(trace);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return { redacted: false, reason: `secret-like value matched ${pattern}` };
  }
  const stack = [trace];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (RAW_CONTENT_KEYS.includes(key)) return { redacted: false, reason: `raw content field present: ${key}` };
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }
  return { redacted: true };
}

/**
 * @param {{
 *   runId: string,
 *   createdAt: string,
 *   outcome: 'failure' | 'success' | 'refusal' | 'cancelled',
 *   reproducer: { kind: 'scenario' | 'route' | 'command-id', ref: string },
 *   signature: string,
 *   attempt?: number,
 * }} trace
 */
export function traceToEvalSample(trace) {
  if (!trace || typeof trace !== "object") {
    return { ok: false, diagnostics: [{ code: "invalid-trace", message: "trace must be an object" }] };
  }
  for (const field of ["runId", "createdAt", "outcome", "reproducer", "signature"]) {
    if (trace[field] === undefined || trace[field] === null) {
      return { ok: false, diagnostics: [{ code: "missing-field", message: `trace.${field} is required` }] };
    }
  }
  const redaction = isRedacted(trace);
  if (!redaction.redacted) {
    return { ok: false, diagnostics: [{ code: "trace-not-redacted", message: redaction.reason }] };
  }
  if (trace.outcome !== "failure" && trace.outcome !== "success" && trace.outcome !== "refusal" && trace.outcome !== "cancelled") {
    return { ok: false, diagnostics: [{ code: "invalid-outcome", message: `unknown outcome ${trace.outcome}` }] };
  }
  const allowedKinds = ["scenario", "route", "command-id"];
  if (!trace.reproducer || !allowedKinds.includes(trace.reproducer.kind) || typeof trace.reproducer.ref !== "string" || !trace.reproducer.ref) {
    return { ok: false, diagnostics: [{ code: "invalid-reproducer", message: "reproducer must be { kind: scenario|route|command-id, ref: string }" }] };
  }

  const id = `eval-${trace.outcome}-${trace.signature.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 48)}`;
  const sample = {
    schema: TRACE_TO_EVAL_SCHEMA,
    id,
    sourceRunId: trace.runId,
    createdAt: trace.createdAt,
    sourceOutcome: trace.outcome,
    expected: {
      // Before a fix the registered sample is expected to reproduce the failure.
      "before-fix": trace.outcome === "failure" ? "fail" : "pass",
      // After a fix the same reproducer must turn green (for a failure trace).
      "after-fix": trace.outcome === "failure" ? "pass" : "pass",
    },
    reproducer: { kind: trace.reproducer.kind, ref: trace.reproducer.ref },
    selector: { runId: trace.runId, attempt: trace.attempt ?? 0 },
  };
  const digest = sha256(JSON.stringify(sample));
  return { ok: true, sample: { ...sample, digest }, diagnostics: [] };
}

/** Explicit-trigger batch: convert selected traces only (never a watcher/scheduler). */
export function traceToEvalSamples(traces) {
  const samples = [];
  const rejected = [];
  for (const trace of traces ?? []) {
    const result = traceToEvalSample(trace);
    if (result.ok) samples.push(result.sample);
    else rejected.push({ runId: trace?.runId ?? null, diagnostics: result.diagnostics });
  }
  return { schema: TRACE_TO_EVAL_SCHEMA, samples, rejected };
}