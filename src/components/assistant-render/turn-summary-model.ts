import type { GeneratedFile } from '@/lib/generated-files';
import type { UserRunCard } from '@/pages/Chat/execution-projection';

export type TurnSummaryHighlightKind = 'task' | 'report' | 'source';

export type TurnSummaryHighlight = {
  kind: TurnSummaryHighlightKind;
  label: string;
  detail?: string;
};

export type TurnSummaryModel = {
  id: string;
  title: string;
  status: 'completed' | 'error';
  counts: {
    tasks: number;
    reports: number;
    sources: number;
    orchestrations: number;
  };
  highlights: TurnSummaryHighlight[];
  defaultCollapsed: boolean;
};

const LONG_REPLY_THRESHOLD = 1600;
const STEP_COLLAPSE_THRESHOLD = 3;
const MAX_TITLE_LENGTH = 140;
const MAX_HIGHLIGHTS = 3;

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleFromReply(finalReplyText: string): string {
  const normalized = finalReplyText
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}|\*|-|\d+\.)\s+/u, '').trim())
    .find(Boolean) ?? '';
  const compacted = compactText(normalized);
  if (compacted.length <= MAX_TITLE_LENGTH) return compacted;
  return `${compacted.slice(0, MAX_TITLE_LENGTH - 3)}...`;
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url;
  }
}

function uniqueSources(card: UserRunCard): TurnSummaryHighlight[] {
  const seen = new Set<string>();
  const sources: TurnSummaryHighlight[] = [];
  for (const step of card.steps) {
    if (!step.url || seen.has(step.url)) continue;
    seen.add(step.url);
    sources.push({
      kind: 'source',
      label: sourceDomain(step.url),
      detail: step.url,
    });
  }
  return sources;
}

function taskHighlights(card: UserRunCard): TurnSummaryHighlight[] {
  return card.steps
    .filter((step) => step.kind !== 'message')
    .map((step) => ({
      kind: 'task' as const,
      label: step.label,
      detail: step.detail ? compactText(step.detail) : undefined,
    }))
    .filter((step) => step.label.trim().length > 0);
}

export function buildTurnSummaryModel(input: {
  card: UserRunCard;
  finalReplyText: string;
  generatedFiles: GeneratedFile[];
}): TurnSummaryModel | null {
  const { card, finalReplyText, generatedFiles } = input;
  if (card.active) return null;

  const sources = uniqueSources(card);
  const hasCollapseSignal =
    card.steps.length >= STEP_COLLAPSE_THRESHOLD
    || generatedFiles.length > 0
    || sources.length > 0
    || card.orchestrations.length > 0
    || compactText(finalReplyText).length > LONG_REPLY_THRESHOLD;

  if (!hasCollapseSignal) return null;

  const reportHighlights: TurnSummaryHighlight[] = generatedFiles.map((file) => ({
    kind: 'report',
    label: file.fileName,
    detail: file.action,
  }));
  const highlights = [
    ...reportHighlights,
    ...sources,
    ...taskHighlights(card),
  ].slice(0, MAX_HIGHLIGHTS);

  return {
    id: card.runKey,
    title: titleFromReply(finalReplyText),
    status: card.steps.some((step) => step.status === 'error') ? 'error' : 'completed',
    counts: {
      tasks: card.steps.length,
      reports: generatedFiles.length,
      sources: sources.length,
      orchestrations: card.orchestrations.length,
    },
    highlights,
    defaultCollapsed: true,
  };
}
