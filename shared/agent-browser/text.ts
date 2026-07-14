/**
 * 抄写自 browser-ai-assistant-master/src/shared/utils/text.ts。
 * 零修改，仅调整文件位置便于 agent-browser 子系统复用。
 */

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateText(value: string, maxLength: number): TruncateResult {
  if (value.length <= maxLength) {
    return { text: value, truncated: false };
  }

  return { text: value.slice(0, maxLength), truncated: true };
}
