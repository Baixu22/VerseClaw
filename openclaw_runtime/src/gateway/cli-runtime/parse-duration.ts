// P5-2 CLI/TUI Deletion: parseDurationMs stub.
//
// The original `cli/parse-duration.ts` was retired along with the `cli/`
// directory. This stub preserves the public surface used by the
// config schema, cron maintenance, agents, and other non-gateway modules
// that previously imported from `cli/parse-duration.js`.
export type ParseDurationMsOptions = {
  defaultUnit?: "ms" | "s" | "m" | "h" | "d";
};

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const DURATION_PATTERN = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]*)\s*$/;

export function parseDurationMs(
  input: string | number,
  options: ParseDurationMsOptions = {},
): number {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : 0;
  }
  if (typeof input !== "string") return 0;
  const match = DURATION_PATTERN.exec(input);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  const rawUnit = match[2]?.toLowerCase();
  const unit = rawUnit && rawUnit in DURATION_UNITS ? rawUnit : options.defaultUnit ?? "ms";
  const multiplier = DURATION_UNITS[unit] ?? 1;
  return Math.round(value * multiplier);
}
