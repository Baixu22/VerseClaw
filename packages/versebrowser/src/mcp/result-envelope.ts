/**
 * Model-facing rendering of a `ToolResult` for the MCP transport.
 *
 * Contract (see `server.ts` header): **summary in `content`, evidence on disk.**
 * The transport previously did `JSON.stringify(result)`, which re-sent `data`
 * (the on-disk payload) and `evidence` to the model on every turn. Measured on
 * a real fixture:
 *
 *   verify_flow    content 644ch  →  envelope 9,116ch (14x)   diagnosis+prComment+evidence
 *   diagnose_page  content 1026ch →  envelope 3,935ch (3.8x)  full snapshot
 *
 * That cost is paid *per turn* in an agent loop (the agent loop calls
 * verify_flow ~2.4x per run), so it compounds. This module keeps small results
 * byte-identical and only stops the duplication when the envelope is large.
 */
import { redactToolResultPayload } from '../security/redact-secrets.ts';
import type { ToolResult, VerifyReport } from '../contracts/index.ts';

export type ToolResultEnvelopeBudget = {
  /** Above this, `data` is replaced by a shape digest. */
  maxChars: number;
  /** Hard ceiling for the digest form before evidence detail is dropped too. */
  hardMaxChars: number;
};

export const DEFAULT_ENVELOPE_BUDGET: ToolResultEnvelopeBudget = Object.freeze({
  maxChars: 6000,
  hardMaxChars: 12_000,
});

/**
 * Tools whose `data` payload is already written to disk as an Evidence Pack.
 * Their full payload is replaced by a digest **regardless of size**, with a
 * small decision retained for verify_flow — a character cap is a blunt
 * instrument: a verify_flow result serialized to 5,342 chars slipped under the
 * cap and re-sent the whole report (measured).
 *
 * Deliberately excluded: `vb_diagnose_page` (its pack is not written to disk)
 * and `vb_network_list` (its `data.requests` *is* the answer).
 */
export const EVIDENCE_BACKED_DATA_TOOLS: ReadonlySet<string> = new Set([
  'vb_verify_flow',
  'vb_diagnose',
  'vb_pr_comment',
  'vb_record_stop',
  'vb_evidence_write',
]);

/**
 * Tools whose `data` **is** the answer even when it is large, so the size path
 * must bound it instead of dropping it (TF-0110).
 *
 * `EVIDENCE_BACKED_DATA_TOOLS` above only governs the `dropData` path. The size
 * path (`full.length > maxChars`) used to drop `data` for *every* tool, which
 * contradicted this module's own note that `vb_network_list`'s `data.requests`
 * *is* the answer. Measured on a real page: `vb_network_list` returned 20 usable
 * rows at `limit=20` (4,489 chars) but **zero** rows at `limit=30` — the model
 * saw `"26 requests"` with no id, URL or status, and `vb_network_detail` (which
 * requires ids from that list) became impossible to call.
 */
const FIELD_STATE_TOOLS = new Set(['vb_type', 'vb_append', 'vb_select', 'vb_select_values', 'vb_check', 'vb_press']);
export const PAYLOAD_IS_ANSWER_TOOLS: ReadonlySet<string> = new Set([
  ...FIELD_STATE_TOOLS,
  'vb_network_list',
  'vb_network_detail',
  'vb_network_wait',
  'vb_upload',
  'vb_download',
  'vb_pages',
  'vb_dialogs',
  'vb_page_select',
  'vb_page_new',
  'vb_page_close',
  'vb_diagnose_page',
]);

export type EnvelopeOptions = {
  /** Force the digest form even when the payload is under budget. */
  dropData?: boolean;
  /** Bound the payload instead of dropping it (its `data` is the answer). */
  keepData?: boolean;
  /** Keep the small verification decision even when its full report is omitted. */
  keepVerifyDecision?: boolean;
  keepFieldChange?: boolean;
};

/** Apply per-tool policy: retain decisions, omit the full on-disk reports. */
export function renderToolResultForTool(
  toolName: string,
  result: ToolResult,
  budget: ToolResultEnvelopeBudget = DEFAULT_ENVELOPE_BUDGET,
): string {
  if ((toolName === 'vb_click' || toolName === 'vb_pointer' || toolName === 'vb_drag' || FIELD_STATE_TOOLS.has(toolName)) && result.ok) {
    const redacted = redactToolResultPayload(result);
    const data = redacted.data as {session?:{id?:string;url?:string};observation?:Record<string,unknown>;targetChange?:unknown} | undefined;
    if (data?.observation && JSON.stringify(redacted,null,2).length > budget.maxChars) {
      const observation = { ...data.observation };
      let clipped = false;
      for (const key of ['beforeUrl','afterUrl']) if (typeof observation[key] === 'string' && observation[key].length > 500) { observation[key] = observation[key].slice(0,500); clipped = true; }
      const compact = JSON.stringify({ok:true,content:redacted.content.slice(0,500),...(redacted.content.length>500?{contentTruncated:true}:{}),data:{session:{id:data.session?.id},observation:{...observation,...(clipped?{truncated:true}:{})},...fieldFeedback(data),...(typeof data.targetChange==='string'?{targetChange:data.targetChange}:{})},...(Array.isArray(redacted.evidence)&&redacted.evidence.length?{evidence:redacted.evidence}:{}),dataOmitted:{reason:'Session details omitted; observation and bounded field feedback retained.'}});
      if (compact.length <= budget.hardMaxChars) return compact;
    }
  }
  if (toolName === 'vb_forms') {
    const compact = JSON.stringify(redactToolResultPayload(result));
    if (compact.length <= budget.maxChars) return compact;
  }
  // Payload-is-answer tools keep a bounded form of `data` even over budget; the
  // evidence-backed set omits full reports (verify keeps its decision fields).
  return renderToolResultText(result, budget, {
    dropData: EVIDENCE_BACKED_DATA_TOOLS.has(toolName),
    keepData: PAYLOAD_IS_ANSWER_TOOLS.has(toolName),
    keepVerifyDecision: toolName === 'vb_verify_flow',
    keepFieldChange: FIELD_STATE_TOOLS.has(toolName),
  });
}

function fieldFeedback(value: unknown): Record<string, unknown> | undefined {
  const change = (value as { fieldChange?: Record<string, unknown> } | undefined)?.fieldChange;
  if (!change || ![true, false, 'unknown'].includes(change.changed as never)) return undefined;
  const state = (value: unknown) => {
    if (!value || typeof value !== 'object') return undefined;
    const source = value as Record<string, unknown>;
    const values = Array.isArray(source.selectedValues) ? source.selectedValues.filter((entry): entry is string => typeof entry === 'string') : undefined;
    return {
      ...(typeof source.value === 'string' ? { value: source.value.slice(0, 120) } : {}),
      ...(typeof source.checked === 'boolean' ? { checked: source.checked } : {}),
      ...(values ? { selectedValues: values.slice(0, 8).map(value => value.slice(0, 120)), selectedValueCount: values.length } : {}),
      ...(source.valueRedacted ? { valueRedacted: true } : {}),
      ...(source.truncated || (typeof source.value === 'string' && source.value.length > 120) || values?.some(value => value.length > 120) || (values?.length ?? 0) > 8 ? { truncated: true } : {}),
    };
  };
  return { fieldChange: { before: state(change.before), after: state(change.after), changed: change.changed, ...(change.stateUnavailable ? { stateUnavailable: true } : {}) } };
}

function verificationDecision(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const report = value as VerifyReport;
  if (!['pass', 'fail', 'unknown'].includes(report.outcome)) return undefined;
  const failed = [
    ...(Array.isArray(report.selectors) ? report.selectors : []).filter((item) => !item.found).map((item) => ({ label: item.selector, detail: item.detail ?? 'not found' })),
    ...(Array.isArray(report.expectations) ? report.expectations : []).filter((item) => !item.passed).map((item) => ({ label: item.label, detail: item.detail ?? 'expectation failed' })),
  ];
  const notes = (Array.isArray(report.collection?.notes) ? report.collection.notes : [])
    .filter((note): note is string => typeof note === 'string');
  const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}…` : text;
  return {
    schemaVersion: report.schemaVersion,
    ok: report.ok,
    outcome: report.outcome,
    collection: report.collection && {
      console: report.collection.console, network: report.collection.network, overall: report.collection.overall,
      // Tolerate a report whose `notes` is missing or not an array: the envelope must never throw
      // on a caller-visible result (measured 2026-10-14 - `notes.slice` crashed the whole envelope,
      // and `toTextResult` has no try/catch, so the failure replaced the ToolResult entirely).
      notes: notes.slice(0, 3).map((note) => clip(note, 200)),
      notesTruncated: notes.length > 3 || notes.some((note) => note.length > 200),
    },
    failedCheckCount: failed.length,
    failedChecks: failed.slice(0, 3).map((item) => ({ label: clip(item.label, 100), detail: clip(item.detail, 240) })),
    failedChecksTruncated: failed.length > 3 || failed.some((item) => item.label.length > 100 || item.detail.length > 240),
    consoleErrorCount: Array.isArray(report.consoleDiff?.newErrors) ? report.consoleDiff.newErrors.length : 0,
    networkFailureCount: report.networkFailures?.count ?? 0,
  };
}

type EvidenceLike = { kind?: string; label?: string; path?: string; mimeType?: string };

function evidencePaths(evidence: unknown): EvidenceLike[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.slice(0, 12).map((entry) => {
    const ref = (entry ?? {}) as Record<string, unknown>;
    return {
      ...(typeof ref.kind === 'string' ? { kind: ref.kind } : {}),
      ...(typeof ref.label === 'string' ? { label: ref.label } : {}),
      ...(typeof ref.path === 'string' ? { path: ref.path } : {}),
      ...(typeof ref.mimeType === 'string' ? { mimeType: ref.mimeType } : {}),
    };
  });
}

/**
 * TF-0110: what was withheld, as an explicit, self-describing digest.
 *
 * This used to be a bare `keys: { field: <int> }` where each int was the
 * serialized **character count** of that field. A field named `keys` holding
 * unexplained integers reads like "number of entries" — a real acceptance run
 * misread `files: 77` as "77 file entries" when the manifest held 1. The unit is
 * now in the field name and array entry counts are reported directly, because
 * that is the number a reader actually wants.
 */
function digest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const chars = JSON.stringify(entry ?? null).length;
    out[key] = Array.isArray(entry)
      ? { entries: entry.length, chars }
      : { chars };
  }
  return out;
}

/**
 * TF-0110: keep `data` but make it fit — used for tools whose payload is the
 * answer. Arrays (the common shape: request lists, detail lists) are trimmed
 * from the tail until the envelope fits `hardMaxChars`, and the trim is
 * **declared** (`dataTruncated`) so a short list is never mistaken for a
 * complete one. Returns null when even a minimal form cannot be built, so the
 * caller falls back to the digest path rather than emitting something wrong.
 */
function renderBoundedPayload(
  redacted: Record<string, unknown>,
  budget: ToolResultEnvelopeBudget,
): string | null {
  const data = redacted.data;
  if (!data || typeof data !== 'object') return null;

  const build = (value: unknown, truncation: Record<string, unknown> | null): string =>
    JSON.stringify(
      {
        ok: redacted.ok,
        content: redacted.content,
        ...(redacted.error ? { error: redacted.error } : {}),
        data: value,
        ...(truncation ? { dataTruncated: truncation } : {}),
        ...(Array.isArray(redacted.evidence) ? { evidence: evidencePaths(redacted.evidence) } : {}),
      },
      null,
      2,
    );

  // Shrink whichever array-valued field is largest — that is where the bulk is.
  const source = data as Record<string, unknown>;
  const arrayKeys = Object.keys(source).filter((key) => Array.isArray(source[key]));
  if (arrayKeys.length === 0) {
    const whole = build(data, null);
    return whole.length <= budget.hardMaxChars ? whole : null;
  }

  const pick = () => {
    let best = '';
    let bestSize = -1;
    for (const key of arrayKeys) {
      const size = JSON.stringify(source[key] ?? null).length;
      if (size > bestSize) {
        bestSize = size;
        best = key;
      }
    }
    return best;
  };

  const trimmed: Record<string, { entriesKept: number; entriesTotal: number }> = {};
  for (;;) {
    const candidate = build(source, Object.keys(trimmed).length > 0 ? { dropped: trimmed } : null);
    if (candidate.length <= budget.hardMaxChars) return candidate;
    const key = pick();
    const arr = source[key] as unknown[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // Drop in growing steps so a huge list converges in a few attempts.
    const total = trimmed[key]?.entriesTotal ?? arr.length + (trimmed[key]?.entriesKept ?? 0);
    const drop = Math.max(1, Math.ceil(arr.length / 4));
    const next = arr.slice(0, arr.length - drop);
    if (next.length === 0) {
      // Even an empty array does not fit alongside content; give up to the digest.
      source[key] = [];
      if (
        build(source, { dropped: { ...trimmed, [key]: { entriesKept: 0, entriesTotal: total } } }).length >
        budget.hardMaxChars
      ) {
        return null;
      }
      trimmed[key] = { entriesKept: 0, entriesTotal: total };
      continue;
    }
    source[key] = next;
    trimmed[key] = { entriesKept: next.length, entriesTotal: total };
  }
}

/**
 * Render a tool result as the text an MCP client receives.
 * Small results are unchanged; large ones drop the duplicated payload and keep
 * the summary, the evidence pointers, and a digest saying what was withheld.
 */
export function renderToolResultText(
  result: ToolResult,
  budget: ToolResultEnvelopeBudget = DEFAULT_ENVELOPE_BUDGET,
  options: EnvelopeOptions = {},
): string {
  const base = result.ok
    ? result
    : { ok: false, content: result.content, error: result.error };
  const redacted = redactToolResultPayload(
    base as Parameters<typeof redactToolResultPayload>[0],
  );

  const full = JSON.stringify(redacted, null, 2);
  const hasData = Object.prototype.hasOwnProperty.call(redacted, 'data');
  // Under budget — and nothing to de-duplicate — send it as-is.
  if (full.length <= budget.maxChars && !(options.dropData === true && hasData)) return full;

  // TF-0110: a payload-is-answer tool keeps a **bounded** form of `data` instead
  // of losing it. Dropping it would leave e.g. `vb_network_list` reporting
  // "26 requests" with no id/url/status, which also makes `vb_network_detail`
  // impossible to call (it requires ids from that list).
  if (options.keepData === true && hasData && options.dropData !== true) {
    const bounded = renderBoundedPayload(redacted, budget);
    if (bounded !== null) return bounded;
  }

  // Over budget: `data` duplicates what the summary already says (and what is
  // already on disk), so it goes first — replaced by a digest, not silently lost.
  const {
    data,
    evidence: rawEvidence,
    ...rest
  } = redacted as Record<string, unknown> & { data?: unknown; evidence?: unknown };
  const decision = options.keepVerifyDecision ? verificationDecision(data) : options.keepFieldChange ? fieldFeedback(data) : undefined;
  const lean = {
    ...rest,
    ...(decision ? { data: decision } : {}),
    // Keep the pointers (kind/label/path); drop ids/timestamps/sizes the model
    // never uses — they stay in `data` and on disk.
    ...(Array.isArray(rawEvidence) ? { evidence: evidencePaths(rawEvidence) } : {}),
    dataOmitted: decision ? { reason: options.keepVerifyDecision ? 'Full verification report is in report.json beside the summary evidence; data retains the bounded decision.' : 'Field feedback was clipped; retained state marks truncation and preserves the observed change flag.' } : {
      reason:
        'payload omitted from model context (summary in content; follow evidence pointers when present); ' +
        'fieldSizes maps each field to { chars } (serialized size) and { entries } for arrays',
      bytes: JSON.stringify(data ?? null).length,
      fieldSizes: digest(data),
    },
  };
  const leanText = JSON.stringify(lean, null, 2);
  if (leanText.length <= budget.hardMaxChars) return leanText;

  // Still too big: keep the summary (bounded to fit), the evidence pointers and
  // the digest. Evidence must survive truncation — a dropped pointer is exactly
  // the "silent omission" this project forbids.
  const evidence = evidencePaths(rawEvidence);
  const dataOmitted = (lean as { dataOmitted: unknown }).dataOmitted;
  const contentText = String(redacted.content ?? '');
  const build = (contentValue: string): string =>
    JSON.stringify(
      {
        ok: redacted.ok,
        content: contentValue,
        ...(decision ? { data: decision } : {}),
        ...(redacted.error ? { error: redacted.error } : {}),
        evidence,
        dataOmitted,
      },
      null,
      2,
    );

  const scaffold = build('');
  if (scaffold.length > budget.hardMaxChars) {
    // Degenerate budget: the scaffold alone does not fit; keep the head, mark it.
    const marker = `\n…[envelope truncated at ${budget.hardMaxChars} chars]`;
    return `${scaffold.slice(0, Math.max(0, budget.hardMaxChars - marker.length))}${marker}`;
  }

  let minimal = build(contentText);
  if (minimal.length > budget.hardMaxChars) {
    const note = (hidden: number): string => `\n…[content truncated; ${hidden} chars withheld]`;
    let allowance = Math.max(
      0,
      contentText.length - (minimal.length - budget.hardMaxChars) - note(0).length,
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clipped = `${contentText.slice(0, allowance)}${note(contentText.length - allowance)}`;
      const candidate = build(clipped);
      minimal = candidate;
      if (candidate.length <= budget.hardMaxChars) break;
      const overflow = candidate.length - budget.hardMaxChars;
      if (allowance <= overflow) {
        minimal = build(note(contentText.length));
        break;
      }
      allowance -= overflow + 16;
    }
  }
  return minimal;
}
