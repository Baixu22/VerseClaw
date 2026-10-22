const MARKER_RE = /\[VerseGit risk evidence_id=([^\s\]]+) binding_id=([^\s\]]+) child_run_id=([^\s\]]+) tool_call_id=([^\s\]]+) coverage=([^\s\]]+) basis=sha256:([a-f0-9]{64}) candidate=([^\s\]]+)\]/gu;

export type VerseGitFeedbackMarker = {
  evidenceId: string;
  bindingId: string;
  childRunId: string;
  toolCallId: string;
  coverage: string;
  basisSha256: string;
  candidateId: string | null;
};

function contentText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const message = value as { content?: unknown };
  if (!Array.isArray(message.content)) return '';
  return message.content
    .flatMap((entry) => entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'text'
      ? [String((entry as { text?: unknown }).text ?? '')]
      : [])
    .join('\n');
}

export function extractVerseGitFeedbackMarkers(value: unknown): VerseGitFeedbackMarker[] {
  const text = contentText(value);
  if (!text) return [];
  const markers: VerseGitFeedbackMarker[] = [];
  for (const match of text.matchAll(MARKER_RE)) {
    markers.push({
      evidenceId: match[1]!,
      bindingId: match[2]!,
      childRunId: match[3]!,
      toolCallId: match[4]!,
      coverage: match[5]!,
      basisSha256: match[6]!,
      candidateId: match[7] === 'none' ? null : match[7]!,
    });
    if (markers.length >= 4) break;
  }
  return markers;
}
