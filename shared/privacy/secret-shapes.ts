/**
 * secret-shapes.ts — single source of truth for secret-shaped text detection.
 *
 * Heuristic, shape-based detection only: this module answers "does this text
 * contain something that LOOKS like a credential?" for UI warning/highlighting
 * and for error-text redaction. It makes no claim about whether a matched
 * string is a real secret — UI copy must stay in "suspected / secret-shaped"
 * language (see shared/sensitive-content-boundary.ts, modelEcho surface).
 *
 * Performance contract (no polling anywhere):
 *  - `findSecretRanges` is a single O(n) pass per call; callers memoize and
 *    debounce instead of re-scanning on every keystroke.
 *  - Results are capped so highlight overlays never render unbounded spans.
 */

export type SecretShapeKind =
  | 'openai-project-key'
  | 'anthropic-key'
  | 'openai-key'
  | 'bearer-token'
  | 'canary'
  | 'github-token'
  | 'slack-token'
  | 'aws-access-key-id'
  | 'private-key-block';

export interface SecretShapeDefinition {
  kind: SecretShapeKind;
  /** Factory: regexes are stateful (lastIndex), never share instances. */
  create: () => RegExp;
  /** Replacement text used by redaction (ui-error-sanitize). */
  redact: (match: string) => string;
}

const REDACTED = '[REDACTED]';

export const SECRET_SHAPE_DEFINITIONS: readonly SecretShapeDefinition[] = [
  {
    kind: 'openai-project-key',
    create: () => /\bsk-proj-[A-Za-z0-9_-]{16,}\b/g,
    redact: () => 'sk-proj-' + REDACTED,
  },
  {
    kind: 'anthropic-key',
    create: () => /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    redact: () => 'sk-ant-' + REDACTED,
  },
  {
    kind: 'openai-key',
    create: () => /\bsk-[A-Za-z0-9]{20,}\b/g,
    redact: () => 'sk-' + REDACTED,
  },
  {
    kind: 'bearer-token',
    create: () => /\bBearer\s+[A-Za-z0-9._+=/-]{12,}\b/gi,
    redact: () => 'Bearer ' + REDACTED,
  },
  {
    kind: 'canary',
    create: () => /\b(?:CLAWX|OPENCLAW)_CANARY_[A-Za-z0-9_-]{6,}\b/g,
    redact: () => '[' + REDACTED.slice(1, -1) + '_CANARY]',
  },
  {
    kind: 'github-token',
    create: () => /\b(?:ghp_|gho_|ghs_|ghu_|github_pat_)[A-Za-z0-9_]{16,}\b/g,
    redact: (match) => (match.startsWith('github_pat_') ? 'github_pat_' : match.slice(0, 4)) + REDACTED,
  },
  {
    kind: 'slack-token',
    create: () => /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    redact: (match) => match.slice(0, 5) + REDACTED,
  },
  {
    kind: 'aws-access-key-id',
    create: () => /\bAKIA[0-9A-Z]{16}\b/g,
    redact: () => 'AKIA' + REDACTED,
  },
  {
    kind: 'private-key-block',
    create: () => /-----BEGIN\s+(?:[A-Z0-9]+\s+)?PRIVATE\s+KEY-----/g,
    redact: () => '-----' + REDACTED + '-----',
  },
] as const;

export interface SecretRange {
  start: number;
  end: number;
  kind: SecretShapeKind;
}

export const DEFAULT_SECRET_RANGE_CAP = 100;

/**
 * Single-pass, overlap-resolved secret-shape scan.
 *
 * Matches from all shapes are merged; when two shapes claim overlapping text
 * (e.g. `sk-proj-...` also starts like `sk-...`), the earlier-starting and
 * longer match wins. Output is sorted by `start` and capped at `cap` ranges so
 * highlight overlays stay cheap.
 */
export function findSecretRanges(text: string, cap: number = DEFAULT_SECRET_RANGE_CAP): SecretRange[] {
  if (!text) return [];
  const raw: SecretRange[] = [];
  for (const definition of SECRET_SHAPE_DEFINITIONS) {
    const pattern = definition.create();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      raw.push({ start: match.index, end: match.index + match[0].length, kind: definition.kind });
      if (raw.length > cap * 4) break;
    }
  }
  raw.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const merged: SecretRange[] = [];
  let lastEnd = -1;
  for (const range of raw) {
    if (range.start < lastEnd) continue;
    merged.push(range);
    lastEnd = range.end;
    if (merged.length >= cap) break;
  }
  return merged;
}

export interface SecretSummary {
  count: number;
  kinds: SecretShapeKind[];
}

/** Compact signature inputs for the dismissible advisory banner. */
export function summarizeSecretRanges(ranges: readonly SecretRange[]): SecretSummary {
  const kinds = Array.from(new Set(ranges.map((range) => range.kind))).sort();
  return { count: ranges.length, kinds };
}

export function secretSignature(summary: SecretSummary): string {
  return `${summary.kinds.join(',')}:${summary.count}`;
}

/**
 * Replace secret-shaped content with `[REDACTED]` variants.
 * Behavior-compatible successor of the inline replace chain that used to live
 * in ui-error-sanitize.ts.
 */
export function redactSecretShapes(text: string): string {
  const ranges = findSecretRanges(text, 1000);
  if (ranges.length === 0) return text;
  const byKind = new Map(SECRET_SHAPE_DEFINITIONS.map((definition) => [definition.kind, definition]));
  let cursor = 0;
  let output = '';
  for (const range of ranges) {
    const definition = byKind.get(range.kind);
    if (!definition) continue;
    const match = text.slice(range.start, range.end);
    output += text.slice(cursor, range.start) + definition.redact(match);
    cursor = range.end;
  }
  output += text.slice(cursor);
  return output;
}

