import { inlineMarkdown, inlineText } from '../security/markdown.ts';
import { redactSecretsInValue } from '../security/redact-secrets.ts';
/**
 * Trajectory Diagnosis Pack (m3-diagnosis).
 * Locate the first failure point in a timeline and emit diagnosis.md / diagnosis.json.
 */
import { mkdir } from 'node:fs/promises';
import { writeEvidenceText, writeEvidenceJson } from './output.ts';
import { join } from 'node:path';
import type {
  DiagnosisFailurePoint,
  DiagnosisReport,
  TimelineEvent,
  TimelineRecord,
} from '../contracts/index.ts';
import { EVIDENCE_PACK_SCHEMA_VERSION, PACK_FILES } from './schema.ts';

export type DiagnoseOptions = {
  dir: string;
  timeline: TimelineRecord;
  /** Extra assertion-style failures (e.g. verify selectors / console baseline). */
  assertionFailures?: Array<{ name: string; summary: string; at?: string }>;
  contextWindow?: number;
};

function isFailureEvent(event: TimelineEvent): boolean {
  if (event.ok === false) return true;
  if (event.kind === 'network') {
    const status = typeof event.detail?.status === 'number' ? event.detail.status : undefined;
    if (status !== undefined && status >= 400) return true;
    if (event.detail?.failed === true) return true;
  }
  if (event.kind === 'console') {
    const level = String(event.detail?.level ?? '').toLowerCase();
    if (level === 'error') return true;
  }
  return false;
}

function summarizeEvent(event: TimelineEvent): string {
  const detail = event.detail ? JSON.stringify(event.detail) : '';
  return detail.length > 200 ? `${event.name} ${detail.slice(0, 200)}...` : `${event.name}${detail ? ` ${detail}` : ''}`;
}

export function diagnoseTimeline(options: DiagnoseOptions): DiagnosisReport {
  const { timeline, assertionFailures = [], contextWindow = 3 } = redactSecretsInValue(options);
  const events = timeline.events;
  const failures: DiagnosisFailurePoint[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (!isFailureEvent(event)) continue;
    const start = Math.max(0, i - contextWindow);
    const end = Math.min(events.length, i + contextWindow + 1);
    failures.push({
      index: event.seq,
      kind: event.kind,
      name: event.name,
      at: event.at,
      summary: summarizeEvent(event),
      context: events.slice(start, end),
    });
  }

  for (const assertion of assertionFailures) {
    failures.push({
      index: Number.MAX_SAFE_INTEGER,
      kind: 'assertion',
      name: assertion.name,
      at: assertion.at ?? new Date().toISOString(),
      summary: assertion.summary,
    });
  }

  failures.sort((a, b) => a.index - b.index);
  const firstFailure = failures[0];
  const ok = failures.length === 0;
  const createdAt = new Date().toISOString();

  const report: DiagnosisReport = {
    schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
    createdAt,
    ...(timeline.sessionId ? { sessionId: timeline.sessionId } : {}),
    ok,
    failureCount: failures.length,
    ...(firstFailure ? { firstFailure } : {}),
    failures,
    summaryMarkdown: formatDiagnosisSummary(ok, firstFailure, failures),
  };
  return report;
}

export async function writeDiagnosisPack(dir: string, report: DiagnosisReport): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeEvidenceText(dir, join(dir, PACK_FILES.diagnosis), report.summaryMarkdown);
  await writeEvidenceJson(dir, join(dir, PACK_FILES.diagnosisJson), report);
  return dir;
}

function formatDiagnosisSummary(
  ok: boolean,
  firstFailure: DiagnosisFailurePoint | undefined,
  failures: DiagnosisFailurePoint[],
): string {
  const lines: string[] = [
    inlineMarkdown`# trajectory diagnosis ${ok ? 'CLEAN' : 'FAIL'}`,
    '',
    ok
      ? 'No failure points detected in the recorded timeline.'
      : inlineMarkdown`Failure points: ${failures.length}. First failure at seq=${firstFailure?.index} (${inlineText(firstFailure?.kind)}).`,
  ];

  if (firstFailure) {
    lines.push(
      '',
      '## First failure',
      '',
      inlineMarkdown`- **when**: ${inlineText(firstFailure.at)}`,
      inlineMarkdown`- **kind**: ${inlineText(firstFailure.kind)}`,
      inlineMarkdown`- **name**: ${inlineText(firstFailure.name)}`,
      inlineMarkdown`- **summary**: ${inlineText(firstFailure.summary)}`,
    );
    if (firstFailure.context?.length) {
      lines.push('', '### Context', '');
      for (const event of firstFailure.context) {
        const mark = event.seq === firstFailure.index ? '>>>' : '   ';
        lines.push(
          inlineMarkdown`${mark} #${event.seq} ${inlineText(event.at)} [${inlineText(event.kind)}] ${inlineText(event.name)}${event.ok === false ? ' FAIL' : ''}`,
        );
      }
    }
  }

  if (failures.length > 1) {
    lines.push('', '## Other failures');
    for (const failure of failures.slice(1, 11)) {
      lines.push(inlineMarkdown`- #${failure.index} [${inlineText(failure.kind)}] ${inlineText(failure.name)}: ${inlineText(failure.summary)}`);
    }
    if (failures.length > 11) lines.push(inlineMarkdown`- … +${failures.length - 11} more`);
  }

  lines.push(
    '',
    '## Recommendation',
    ok
      ? 'No recorded failure was found. Check the verification outcome and collection status before accepting the task; a clean timeline alone does not establish success.'
      : 'Start at the first failure — later failures are often cascade effects. Use explain_error on any console frame, then re-verify.',
  );

  return lines.join('\n');
}
