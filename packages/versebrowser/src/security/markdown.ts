import { redactSecretsInText } from './redact-secrets.ts';

/** Page-controlled fields are inline data; only the formatter owns block structure. */
function inlineValue(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function inlineText(value: unknown): string {
  return inlineValue(value).trim();
}

/** Template literals own structure; every interpolated field is redacted inline data. */
export function inlineMarkdown(parts: TemplateStringsArray, ...values: unknown[]): string {
  return parts.reduce((text, part, index) => text + (index ? inlineValue(redactSecretsInText(String(values[index - 1] ?? ''))) : '') + part, '');
}

/** CommonMark delimiters must be longer than every backtick run in the content. */
export function codeSpan(value: unknown): string {
  const text = inlineText(value);
  const fence = '`'.repeat(Math.max(1, ...(text.match(/`+/g) ?? []).map(run => run.length + 1)));
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

export function fencedBlock(value: string, language: '' | 'markdown' = ''): string {
  const fence = '`'.repeat(Math.max(3, ...(value.match(/`{3,}/g) ?? []).map(run => run.length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
}
