import {
  inspectRuntimeMemorySanitizedEpisodes,
  type RuntimeMemoryInspectionOpenReadOnlyDatabase,
  type RuntimeMemorySanitizedEpisodeInspectionResult,
} from "./memory-persistence.js";

export type RuntimeMemoryOperatorInspectionOptions = {
  config?: unknown;
  databasePath?: string;
  limit?: number;
  maxEpisodes?: number;
  now?: () => number;
  openReadOnlyDatabase?: RuntimeMemoryInspectionOpenReadOnlyDatabase;
};

export type RuntimeMemoryOperatorInspectionResult =
  RuntimeMemorySanitizedEpisodeInspectionResult;

export function inspectRuntimeMemoryForOperator(
  options: RuntimeMemoryOperatorInspectionOptions,
): RuntimeMemoryOperatorInspectionResult {
  return inspectRuntimeMemorySanitizedEpisodes({
    config: options.config,
    database: options.databasePath ? { path: options.databasePath } : undefined,
    limit: options.limit,
    maxEpisodes: options.maxEpisodes,
    now: options.now,
    openReadOnlyDatabase: options.openReadOnlyDatabase,
  });
}
