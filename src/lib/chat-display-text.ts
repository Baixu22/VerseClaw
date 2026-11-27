const MASK = '••••••';

export type SecretRange = { start: number; end: number };

/** Offsets use textarea selection coordinates (UTF-16 code units). */
export function chatSecretRanges(text: string): SecretRange[] {
  const ranges: SecretRange[] = [];
  function add(start: number, value: string) {
    if (value.length) ranges.push({ start, end: start + value.length });
  }
  for (const match of text.matchAll(/(https?:\/\/)([^\s/?#@]+)@/gi)) add(match.index + match[1].length, match[2]);
  for (const match of text.matchAll(/(\bBearer[ \t]+)([A-Za-z0-9._~+/=-]+)/gi)) add(match.index + match[1].length, match[2]);
  const assignment = /((?:\b[\w-]{0,64}?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)|[?&](?:key|token|secret|sig))["']?[ \t]*[:=][ \t]*)(?:"((?:\\.|[^"\\\n])*)(?:"|$)|'((?:\\.|[^'\\\n])*)(?:'|$)|([^\s,;&)`"'<>}\]*]+))/gim;
  for (const match of text.matchAll(assignment)) {
    const quoted = match[2] ?? match[3];
    add(match.index + match[1].length + (quoted === undefined ? 0 : 1), quoted ?? match[4]);
  }
  for (const match of text.matchAll(/\b(?:sk-(?:proj-|ant-)?|github_pat_|gh[pousr]_|sk_(?:live|test)_|xox[baprs]-|AIza|npm_|hf_)[a-zA-Z0-9_-]+/g)) add(match.index, match[0]);
  const merged: SecretRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(range.end, previous.end);
    else merged.push(range);
  }
  return merged;
}

export function maskChatSelection(text: string, ranges: SecretRange[], start = 0, end = text.length, preserveLength = false): string {
  if (start >= end) return '';
  let result = '';
  let cursor = start;
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) continue;
    const left = Math.max(start, range.start);
    const right = Math.min(end, range.end);
    result += text.slice(cursor, left) + (preserveLength ? '•'.repeat(right - left) : MASK);
    cursor = right;
  }
  return result + text.slice(cursor, end);
}

export function maskChatSecrets(text: string): string {
  return maskChatSelection(text, chatSecretRanges(text));
}
