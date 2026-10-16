/**
 * Summary-first rendering budget for the one-shot page diagnosis pack
 * (`vb_diagnose_page`).
 *
 * Why: the pack is what an agent pays for on **every** turn, and the agent-loop
 * experiment showed the pack was *adding* ~44% tokens versus assembling the same
 * evidence by hand — the round-trips it saved cost less than a second, so the
 * context it added was a net loss.
 *
 * Rules:
 * 1. Budget the **content** (what enters the model), never the **data** (what
 *    stays on disk as evidence).
 * 2. The rendered markdown length is bounded by `maxChars` **by construction**:
 *    sections are allocated sequentially out of the remaining budget and each
 *    builder refuses to exceed its slice.
 * 3. Trimming must never hide a collection failure — "not observed" stays
 *    distinguishable from "observed clean", and that warning is mandatory.
 */

export type DiagnosePackBudget = {
  /** Hard cap on the rendered markdown. */
  maxChars: number;
  explainChars: number;
  snapshotChars: number;
  consoleLines: number;
  networkRows: number;
};

export const DEFAULT_DIAGNOSE_BUDGET: DiagnosePackBudget = Object.freeze({
  maxChars: 4000,
  explainChars: 900,
  snapshotChars: 1400,
  consoleLines: 4,
  networkRows: 4,
});

export type DiagnosePackNetworkRow = {
  method: string;
  url: string;
  status?: number;
  error?: string;
};

export type DiagnosePackInput = {
  collectionOverall: 'ok' | 'degraded' | 'failed';
  consoleCollection: string;
  networkCollection: string;
  consoleWatermarkMissing?: boolean;
  networkBaselineMissing?: boolean;
  consoleErrors: string[];
  consoleWarnings: string[];
  networkFailures: DiagnosePackNetworkRow[];
  networkCount: number;
  /** Mapped primary location, e.g. `src/promo.ts:14`. */
  primary?: string;
  /** Raw first error text when no mapping was available. */
  unmappedError?: string;
  explainContent?: string;
  snapshotText: string;
};

export type DiagnosePackRender = {
  markdown: string;
  chars: number;
  truncated: {
    explain: boolean;
    snapshot: boolean;
    console: boolean;
    network: boolean;
  };
};

type ListSection = { text: string; truncated: boolean; used: number };

/**
 * Build a bounded bullet list section. Never returns more than `budget` chars;
 * when rows do not fit, says how many were withheld instead of silently
 * dropping them.
 */
function buildListSection(
  title: string,
  rows: readonly string[],
  maxRows: number,
  budget: number,
  emptyText: string,
  moreSuffix: (hidden: number) => string,
): ListSection {
  const header = `\n\n${title}`;
  if (budget <= header.length) return { text: '', truncated: rows.length > 0, used: 0 };

  let text = header;
  let shown = 0;
  for (const row of rows) {
    if (shown >= maxRows) break;
    const line = `\n- ${row.slice(0, 300)}`;
    if (text.length + line.length > budget) break;
    text += line;
    shown += 1;
  }

  const hidden = rows.length - shown;
  if (rows.length === 0) {
    const line = `\n- ${emptyText}`;
    if (text.length + line.length <= budget) text += line;
  } else if (hidden > 0) {
    const line = `\n- ${moreSuffix(hidden)}`;
    if (text.length + line.length <= budget) text += line;
  }

  return { text, truncated: hidden > 0, used: text.length };
}

export function renderDiagnosePack(
  input: DiagnosePackInput,
  budget: DiagnosePackBudget = DEFAULT_DIAGNOSE_BUDGET,
): DiagnosePackRender {
  const truncated = { explain: false, snapshot: false, console: false, network: false };

  // ---- Mandatory: collection status, counts, primary, incompleteness warning.
  const mandatoryLines: string[] = [
    '# page diagnosis',
    `- collection: ${input.collectionOverall} (console=${input.consoleCollection}, network=${input.networkCollection})`,
    `- console errors: ${input.consoleErrors.length}`,
    `- network failures: ${input.networkCount}`,
  ];
  if (input.consoleWatermarkMissing) {
    mandatoryLines.push('- ! console watermark missing; judging all retained lines');
  }
  if (input.networkBaselineMissing) {
    mandatoryLines.push('- ! network baseline missing; judging all retained requests');
  }
  if (input.consoleWarnings.length > 0) {
    mandatoryLines.push(`- console warnings: ${input.consoleWarnings.length}`);
  }
  if (input.primary) {
    mandatoryLines.push(`- primary: ${input.primary}`);
  } else if (input.unmappedError) {
    mandatoryLines.push(`- primary: (unmapped) ${input.unmappedError.slice(0, 120)}`);
  } else {
    mandatoryLines.push('- primary: (none observed)');
  }
  if (input.collectionOverall !== 'ok') {
    mandatoryLines.push(
      '',
      `> collection incomplete (${input.collectionOverall}) — do not treat empty lists as "no errors"`,
    );
  }
  const mandatory = mandatoryLines.join('\n');
  if (mandatory.length > budget.maxChars) {
    // Degenerate budget: keep the mandatory head and say it was cut.
    const clipped = `${mandatory.slice(0, Math.max(0, budget.maxChars - 12))}\n…[cut]`;
    return { markdown: clipped, chars: clipped.length, truncated: { ...truncated, explain: true, snapshot: true } };
  }

  const snapshotHeader = '\n\n## Snapshot\n';
  const hasSnapshot = input.snapshotText.trim().length > 0;
  const snapshotBody = hasSnapshot ? input.snapshotText.trim() : '(empty)';
  const snapshotPointer = `${snapshotHeader}(omitted — content budget reached; full text in data.snapshot)`;
  // Reserve room for the pointer up front: a dropped section must never be
  // silent (same discipline as "collection failure is never a silent PASS").
  const snapshotReserve = hasSnapshot
    ? Math.min(snapshotPointer.length, Math.max(0, budget.maxChars - mandatory.length))
    : 0;

  let remaining = budget.maxChars - mandatory.length - snapshotReserve;
  const parts: string[] = [mandatory];

  // ---- Priority 1: explain (the mapped frame is the actionable part).
  const explainBody = input.explainContent?.trim() || '(no error text)';
  const explainHeader = '\n\n## Explain\n';
  const explainAllowance = Math.min(budget.explainChars, Math.max(0, remaining - explainHeader.length));
  if (explainAllowance > 0) {
    const body = explainBody.slice(0, explainAllowance);
    const cut = explainBody.length - body.length;
    const suffix = cut > 0 ? `\n…[truncated ${cut} chars; full text in data.explain]` : '';
    const section = `${explainHeader}${body}${suffix}`;
    if (section.length <= remaining) {
      parts.push(section);
      remaining -= section.length;
      truncated.explain = cut > 0;
    }
  } else {
    truncated.explain = true;
  }

  // ---- Priority 2: console errors.
  const consoleSection = buildListSection(
    '## Console errors',
    input.consoleErrors,
    budget.consoleLines,
    remaining,
    input.consoleCollection === 'ok' ? 'none' : '(not observed — collection incomplete)',
    (hidden) => `(+${hidden} more; full list in data.consoleDiff.newErrors)`,
  );
  if (consoleSection.text) {
    parts.push(consoleSection.text);
    remaining -= consoleSection.used;
  }
  truncated.console = consoleSection.truncated;

  // ---- Priority 3: network failures.
  const networkRows = input.networkFailures.map(
    (row) => `${row.method} ${row.url} -> ${row.status ?? row.error ?? 'failed'}`,
  );
  const networkSection = buildListSection(
    '## Network failures',
    networkRows,
    budget.networkRows,
    remaining,
    input.networkCollection === 'ok' ? 'none' : '(not observed — collection incomplete)',
    (hidden) => `(+${hidden} more; full list in data.networkFailures.failures)`,
  );
  if (networkSection.text) {
    parts.push(networkSection.text);
    remaining -= networkSection.used;
  }
  truncated.network = networkSection.truncated;

  // ---- Priority 4: snapshot (bulkiest, most recoverable from data.snapshot).
  const snapshotBudget = remaining + snapshotReserve;
  const snapshotAllowance = Math.min(
    budget.snapshotChars,
    Math.max(0, snapshotBudget - snapshotHeader.length),
  );
  let snapshotEmitted = false;
  if (snapshotAllowance > 0) {
    const body = snapshotBody.slice(0, snapshotAllowance);
    const cut = snapshotBody.length - body.length;
    const suffix = cut > 0 ? `\n…[truncated ${cut} chars; full text in data.snapshot]` : '';
    const section = `${snapshotHeader}${body}${suffix}`;
    if (section.length <= snapshotBudget) {
      parts.push(section);
      snapshotEmitted = true;
      truncated.snapshot = cut > 0;
    }
  }
  if (!snapshotEmitted && hasSnapshot && snapshotPointer.length <= snapshotBudget) {
    parts.push(snapshotPointer);
    truncated.snapshot = true;
  }

  const markdown = parts.join('');
  return { markdown, chars: markdown.length, truncated };
}
