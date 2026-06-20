// P5-2 CLI/TUI Deletion: parseByteSize stub.
//
// The original `cli/parse-bytes.ts` was retired along with the `cli/`
// directory. This stub preserves the public surface used by the
// config schema, cron run-log, and other non-gateway modules that
// previously imported from `cli/parse-bytes.js`. Hosts only use this
// during config validation; the gateway itself never reads raw byte
// strings off the wire.
export type ParseByteSizeOptions = {
  defaultUnit?: "b" | "kb" | "mb" | "gb" | "tb";
};

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
};

const SIZE_PATTERN = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]*)\s*$/;

export function parseByteSize(
  input: string,
  options: ParseByteSizeOptions = {},
): number {
  if (typeof input !== "string") return 0;
  const match = SIZE_PATTERN.exec(input);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  const rawUnit = match[2]?.toLowerCase();
  const unit = rawUnit && rawUnit in SIZE_UNITS ? rawUnit : options.defaultUnit ?? "b";
  const multiplier = SIZE_UNITS[unit] ?? 1;
  return Math.round(value * multiplier);
}
