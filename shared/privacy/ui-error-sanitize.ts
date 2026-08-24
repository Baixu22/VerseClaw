import { findSecretRanges, redactSecretShapes } from './secret-shapes';

/**
 * Sanitize error text for UI rendering.
 * Never include stack frames; strip secret-shaped content.
 *
 * Secret-shape patterns live in ./secret-shapes (single source of truth shared
 * with the composer/message highlight surfaces) so the two can never drift.
 */
export function sanitizeUiErrorText(input: unknown): string {
  let text: string;
  if (input instanceof Error) {
    text = String(input.message || 'Unexpected error');
  } else if (typeof input === 'string') {
    text = input;
  } else if (input == null) {
    text = 'Unexpected error';
  } else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = 'Unexpected error';
    }
  }

  text = text
    .split(/\r?\n/u)
    .filter((line) => !/^\s*at\s+\S+/u.test(line))
    .join('\n');

  text = redactSecretShapes(text);

  text = text.replace(/\s+/g, ' ').trim();
  if (!text) text = 'Unexpected error';
  if (text.length > 280) text = text.slice(0, 277) + '...';
  return text;
}

export function assertNoStackOrSecret(text: string): string[] {
  const failures: string[] = [];
  if (/\bat\s+\S+/u.test(text)) failures.push('stack-frame');
  for (const range of findSecretRanges(text, 200)) {
    if (range.kind === 'canary') failures.push('canary');
    else if (range.kind === 'bearer-token') failures.push('bearer');
    else if (
      range.kind === 'openai-key'
      || range.kind === 'openai-project-key'
      || range.kind === 'anthropic-key'
    ) failures.push('api-key');
  }
  return Array.from(new Set(failures));
}
