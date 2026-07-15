/**
 * C6-2: compress oversized tool results; full text can be recovered via working_memory / context_read.
 */
import { codingObservability } from "../context-engine/coding-observability.js";

export const DEFAULT_TOOL_OUTPUT_CHAR_LIMIT = 4000;

export type CompressedToolOutput = {
  text: string;
  truncated: boolean;
  originalChars: number;
  summary: string;
  archiveKey?: string;
};

export function compressToolOutputText(
  text: string,
  options?: { limit?: number; archiveKey?: string },
): CompressedToolOutput {
  const limit = options?.limit ?? DEFAULT_TOOL_OUTPUT_CHAR_LIMIT;
  const originalChars = text.length;
  if (originalChars <= limit) {
    return {
      text,
      truncated: false,
      originalChars,
      summary: text.slice(0, Math.min(200, text.length)),
    };
  }
  codingObservability.recordCompactionLayer("tool_output_compress");
  const head = text.slice(0, Math.floor(limit * 0.7));
  const tail = text.slice(-Math.floor(limit * 0.2));
  const summary = `truncated ${originalChars} chars → ${limit}; head+tail kept`;
  return {
    text: `${head}\n…[truncated ${originalChars - limit} chars; use context_read working_memory to expand]…\n${tail}`,
    truncated: true,
    originalChars,
    summary,
    archiveKey: options?.archiveKey,
  };
}
