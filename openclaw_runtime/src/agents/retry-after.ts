/** Extracts a finite non-negative Retry-After lower bound from provider text. */
export function parseRetryAfterMsFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const milliseconds = /retry-after-ms\s*[:=]\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (milliseconds) {
    const value = Number(milliseconds[1]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const seconds = /retry-after\s*[:=]\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (seconds) {
    const value = Number(seconds[1]) * 1000;
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const delay = /(?:try again in|retry in|wait)\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)/i.exec(text);
  if (delay) {
    const value = Number(delay[1]) * (delay[2].toLowerCase().startsWith("m") ? 1 : 1000);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}
