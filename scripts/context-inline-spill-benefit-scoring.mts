/** Pure scoring/statistics helpers for the Inline/Spill benefit eval. */

export type ParsedAnswer = { ok: boolean; value: string | null };

export function parseAnswer(text: string): ParsedAnswer {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return { ok: false, value: null };
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as { value?: unknown };
    if (parsed.value === null) return { ok: true, value: null };
    if (typeof parsed.value === "string") return { ok: true, value: parsed.value };
    return { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

/** Wilson score interval at 95% for a binomial proportion. */
export function wilson(pass: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959963984540054;
  const p = pass / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function binom(n: number, k: number): number {
  let out = 1;
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1);
  return out;
}

/** Exact two-sided McNemar (binomial) test over discordant pairs. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binom(n, i);
  return Math.min(1, (2 * tail) / Math.pow(2, n));
}

/** pass^k over per-task all-repetitions success. */
export function passAtK(perTask: Array<boolean[]>): number {
  if (perTask.length === 0) return 0;
  return perTask.filter((runs) => runs.length > 0 && runs.every(Boolean)).length / perTask.length;
}
