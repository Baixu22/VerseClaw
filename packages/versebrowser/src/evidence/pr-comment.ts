import { inlineMarkdown, inlineText, codeSpan, fencedBlock } from '../security/markdown.ts';
import { redactSecretsInValue } from '../security/redact-secrets.ts';
/**
 * GitHub PR / CI comment formatter for Evidence Packs and Trajectory Diagnosis.
 * Offline pure text — paths only, never inlines screenshots or HAR payloads.
 */
import type {
  DiagnosisReport,
  EvidenceRef,
  ExplainErrorResult,
  NetworkFailureSummary,
  ConsoleIncrementalDiff,
  VerifyReport,
} from '../contracts/index.ts';

export type PrCommentInput = {
  label?: string;
  packDir?: string;
  verify?: VerifyReport;
  diagnosis?: DiagnosisReport;
  explain?: ExplainErrorResult;
  networkFailures?: NetworkFailureSummary;
  consoleDiff?: ConsoleIncrementalDiff;
  summaryMarkdown?: string;
  evidence?: EvidenceRef[];
  screenshotCount?: number;
};

const MARKER = '<!-- versebrowser-evidence -->';

function primarySourceLine(explain?: ExplainErrorResult): string | undefined {
  const primary = explain?.primary;
  if (!primary) return undefined;
  if (primary.mapped && primary.source && primary.originalLine !== undefined) {
    return `${primary.source}:${primary.originalLine}`;
  }
  if (primary.url && primary.line !== undefined) {
    return `${primary.url}:${primary.line}`;
  }
  return undefined;
}

function firstFailureLine(diagnosis?: DiagnosisReport): string[] {
  if (!diagnosis || diagnosis.ok) {
    return ['_No failure points in recorded timeline._'];
  }
  const first = diagnosis.firstFailure;
  if (!first) return ['_No failure points in recorded timeline._'];
  const lines = [
    inlineMarkdown`- **kind**: ${inlineText(first.kind)}`,
    inlineMarkdown`- **name**: ${inlineText(first.name)}`,
    inlineMarkdown`- **when**: ${inlineText(first.at)}`,
    inlineMarkdown`- **summary**: ${truncate(inlineText(first.summary), 240)}`,
  ];
  return lines;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Render a GitHub-flavored markdown PR/CI comment.
 * Summary-first; binary evidence stays as paths under Evidence.
 */
export function formatPrComment(input: PrCommentInput): string {
  input = redactSecretsInValue(input);
  const outcome = input.verify?.outcome;
  const status =
    outcome === 'pass'
      ? 'PASS'
      : outcome === 'fail'
        ? 'FAIL'
        : outcome === 'unknown'
          ? 'UNKNOWN'
          : input.verify?.ok === true || (input.verify === undefined && input.diagnosis?.ok === true)
            ? 'PASS'
            : input.verify?.ok === false || (input.verify === undefined && input.diagnosis?.ok === false)
              ? 'FAIL'
              : 'RECORD';
  const title = inlineMarkdown`versebrowser ${inlineText(input.label ?? (input.verify ? 'verify_flow' : 'evidence'))}: ${status}`;

  const lines: string[] = [MARKER, inlineMarkdown`## ${title}`, ''];

  lines.push(inlineMarkdown`**Result:** ${status}`);
  if (input.verify?.collection && input.verify.collection.overall !== 'ok') {
    lines.push(
      inlineMarkdown`**Collection:** ${inlineText(input.verify.collection.overall)} (console=${inlineText(input.verify.collection.console)}, network=${inlineText(input.verify.collection.network)})`,
    );
    for (const note of input.verify.collection.notes) {
      lines.push(inlineMarkdown`- ${inlineText(note)}`);
    }
  }
  if (input.verify?.sessionId || input.diagnosis?.sessionId) {
    lines.push(inlineMarkdown`**Session:** ${inlineText(input.verify?.sessionId ?? input.diagnosis?.sessionId)}`);
  }
  if (input.packDir) {
    lines.push(inlineMarkdown`**Evidence pack:** ${codeSpan(input.packDir)}`);
  }
  lines.push('');

  const source = primarySourceLine(input.explain);
  if (source) {
    lines.push('### Source attribution', '', inlineMarkdown`- ${codeSpan(source)}`, '');
  }

  if (input.diagnosis && !input.diagnosis.ok && input.diagnosis.firstFailure) {
    lines.push(
      '### First failure',
      '',
      ...firstFailureLine(input.diagnosis),
      '',
    );
    if (input.diagnosis.failureCount > 1) {
      const extras = input.diagnosis.failures.slice(1, 6).map((failure) => {
        return inlineMarkdown`- #${inlineText(failure.index)} [${inlineText(failure.kind)}] ${inlineText(failure.name)}: ${truncate(inlineText(failure.summary), 120)}`;
      });
      const more =
        input.diagnosis.failureCount > 6
          ? [inlineMarkdown`- … +${input.diagnosis.failureCount - 6} more`]
          : [];
      lines.push('<details>', inlineMarkdown`<summary>More failures (${input.diagnosis.failureCount - 1})</summary>`, '', ...extras, ...more, '', '</details>', '');
    }
  } else if (input.diagnosis) {
    lines.push('### First failure', '', '_No failure points in recorded timeline._', '');
  }

  if (input.verify) {
    lines.push('### Checks', '');
    for (const item of input.verify.selectors) {
      lines.push(inlineMarkdown`- ${item.found ? '[ok]' : '[miss]'} ${codeSpan(item.selector)}`);
    }
    if (input.verify.expectations && input.verify.expectations.length > 0) {
      lines.push('', inlineMarkdown`**Business assertions:** ${input.verify.expectations.filter((e) => e.passed).length}/${input.verify.expectations.length}`);
      for (const item of input.verify.expectations.slice(0, 8)) {
        lines.push(inlineMarkdown`- ${item.passed ? '[ok]' : '[miss]'} ${inlineText(item.label)}${item.detail ? inlineMarkdown` — ${truncate(inlineText(item.detail), 120)}` : ''}`);
      }
    } else {
      lines.push('', '_Health signals only — no business assertions requested._');
    }
    if (input.networkFailures && input.networkFailures.count > 0) {
      lines.push('', inlineMarkdown`**Network failures:** ${input.networkFailures.count}`);
      for (const failure of input.networkFailures.failures.slice(0, 5)) {
        lines.push(inlineMarkdown`- ${inlineText(failure.method)} ${inlineText(failure.url)} → ${inlineText(failure.status ?? failure.error ?? 'failed')}`);
      }
    }
    if (input.consoleDiff && input.consoleDiff.newErrors.length > 0) {
      lines.push('', inlineMarkdown`**Console errors:** ${input.consoleDiff.newErrors.length}`);
      for (const err of input.consoleDiff.newErrors.slice(0, 5)) {
        lines.push(inlineMarkdown`- ${truncate(inlineText(err), 160)}`);
      }
    }
    lines.push('');
  }

  lines.push('### Evidence', '');
  if (input.packDir) {
    lines.push(inlineMarkdown`- pack directory: ${codeSpan(input.packDir)}`);
  }
  for (const ref of input.evidence ?? []) {
    if (ref.path) lines.push(inlineMarkdown`- ${inlineText(ref.kind)}: ${codeSpan(ref.path)}`);
  }
  if (input.screenshotCount && input.screenshotCount > 0) {
    lines.push(inlineMarkdown`- screenshots: ${input.screenshotCount} file(s) on disk (not inlined)`);
  }
  if (input.summaryMarkdown) {
    lines.push('', '<details>', '<summary>Raw summary</summary>', '', fencedBlock(truncate(input.summaryMarkdown, 2000), 'markdown'), '', '</details>');
  }

  lines.push(
    '',
    '_Generated by versebrowser Evidence Pack. Screenshots/HAR stay on disk; this comment is summary-only._',
  );

  return lines.join('\n');
}

/** Convenience: format from a full VerifyReport (+ optional diagnosis). */
export function formatVerifyPrComment(
  report: VerifyReport,
  options: { packDir?: string; diagnosis?: DiagnosisReport; explain?: ExplainErrorResult } = {},
): string {
  return formatPrComment({
    label: 'verify_flow',
    verify: report,
    diagnosis: options.diagnosis,
    explain: options.explain,
    networkFailures: report.networkFailures,
    consoleDiff: report.consoleDiff,
    summaryMarkdown: report.summaryMarkdown,
    evidence: report.evidence,
    screenshotCount: report.screenshotPaths.length,
    ...(options.packDir ? { packDir: options.packDir } : {}),
  });
}
