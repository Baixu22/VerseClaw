/**
 * Bash command execution with streaming support and cancellation.
 *
 * This module provides a unified bash execution implementation used by:
 * - AgentSession.executeBash() for interactive and RPC modes
 * - Direct calls from modes that need bash execution
 */

import { sanitizeBinaryOutput } from "../shell-utils.js";
import { stripAnsi } from "../utils/ansi.js";
import type { BashOperations } from "./tools/bash-operations.js";
import { createPrivateTempWriter } from "./tools/private-temp-file.js";
import { ByteTail } from "../byte-tail.js";
import { DEFAULT_MAX_BYTES, truncateTail } from "./tools/truncate.js";

// ============================================================================
// Types
// ============================================================================

export interface BashExecutorOptions {
  /** Callback for streaming output chunks (already sanitized) */
  onChunk?: (chunk: string) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface BashResult {
  /** Combined stdout + stderr output (sanitized, possibly truncated) */
  output: string;
  /** Process exit code (undefined if killed/cancelled) */
  exitCode: number | undefined;
  /** Whether the command was cancelled via signal */
  cancelled: boolean;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Path to temp file containing full output (if output exceeded truncation threshold) */
  fullOutputPath?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a bash command using custom BashOperations.
 * Used for remote execution (SSH, containers, etc.).
 */
export async function executeBashWithOperations(
  command: string,
  cwd: string,
  operations: BashOperations,
  options?: BashExecutorOptions,
): Promise<BashResult> {
  const maxOutputBytes = DEFAULT_MAX_BYTES * 2;
  const output = new ByteTail(maxOutputBytes);

  let tempFilePath: string | undefined;
  let tempFileStream: ReturnType<typeof createPrivateTempWriter> | undefined;
  let writeError: unknown;
  let totalBytes = 0;

  const ensureTempFile = () => {
    if (tempFilePath) {
      return;
    }
    const tempFile = createPrivateTempWriter("openclaw-bash");
    tempFilePath = tempFile.path;
    tempFileStream = tempFile;
    tempFileStream.write(output.text());
  };

  const closeTempFile = async () => {
    if (!tempFileStream) {
      return;
    }
    const stream = tempFileStream;
    tempFileStream = undefined;
    stream.close();
  };

  const decoder = new TextDecoder();

  const onData = (data: Buffer) => {
    totalBytes += data.length;

    // Sanitize: strip ANSI, replace binary garbage, normalize newlines
    const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(
      /\r/g,
      "",
    );

    // Start writing to temp file if exceeds threshold
    try {
      if (!writeError && totalBytes > DEFAULT_MAX_BYTES) ensureTempFile();
      if (!writeError) tempFileStream?.write(text);
    } catch (error) { writeError = error; }

    // Keep rolling buffer
    output.append("combined", text);

    // Stream to callback
    if (options?.onChunk) {
      options.onChunk(text);
    }
  };

  try {
    const result = await operations.exec(command, cwd, {
      onData,
      signal: options?.signal,
    });

    const fullOutput = output.text();
    const truncationResult = truncateTail(fullOutput);
    if (truncationResult.truncated) {
      ensureTempFile();
    }
    await closeTempFile();
    if (writeError) throw writeError;
    const cancelled = options?.signal?.aborted ?? false;

    return {
      output: truncationResult.truncated ? truncationResult.content : fullOutput,
      exitCode: cancelled ? undefined : (result.exitCode ?? undefined),
      cancelled,
      truncated: truncationResult.truncated || output.omittedBytes > 0,
      fullOutputPath: tempFilePath,
    };
  } catch (err) {
    // Check if it was an abort
    if (options?.signal?.aborted) {
      const fullOutput = output.text();
      const truncationResult = truncateTail(fullOutput);
      if (truncationResult.truncated) {
        ensureTempFile();
      }
      await closeTempFile();
      return {
        output: truncationResult.truncated ? truncationResult.content : fullOutput,
        exitCode: undefined,
        cancelled: true,
        truncated: truncationResult.truncated || output.omittedBytes > 0,
        fullOutputPath: tempFilePath,
      };
    }

    await closeTempFile();

    throw err;
  }
}
