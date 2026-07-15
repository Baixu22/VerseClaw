/**
 * C6-2: compress oversized tool results; full text can be recovered via
 * working_memory / context_read expansion.
 */
import { codingObservability } from "../context-engine/coding-observability.js";
import { dcsObservability } from "../context-engine/dcs-observability.js";

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
      ...(options?.archiveKey ? { archiveKey: options.archiveKey } : {}),
    };
  }
  codingObservability.recordCompactionLayer("tool_output_compress");
  dcsObservability.recordContextLadderAction("tool_output_compress");
  const headLen = Math.floor(limit * 0.7);
  const tailLen = Math.floor(limit * 0.2);
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const omitted = originalChars - headLen - tailLen;
  const summary = `truncated ${originalChars} chars -> ~${limit}; head+tail kept`;
  const marker = `\n...[truncated ${omitted} chars; use context_read working_memory to expand]...\n`;
  return {
    text: `${head}${marker}${tail}`,
    truncated: true,
    originalChars,
    summary,
    ...(options?.archiveKey ? { archiveKey: options.archiveKey } : {}),
  };
}

/**
 * Build a working_memory-friendly full-content payload so truncated tool output
 * remains recoverable via context_read (caller still performs the Block write).
 */
export function buildToolOutputArchivePayload(params: {
  originalText: string;
  compressed: CompressedToolOutput;
  toolName?: string;
}): string {
  return JSON.stringify({
    kind: "tool_output_archive",
    toolName: params.toolName ?? "unknown",
    truncated: params.compressed.truncated,
    originalChars: params.compressed.originalChars,
    summary: params.compressed.summary,
    archiveKey: params.compressed.archiveKey,
    full_content: params.originalText,
  });
}
