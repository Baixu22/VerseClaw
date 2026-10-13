/**
 * #182: how much of VToken's input is already in the system prompt.
 *
 * VToken is fed `markdownSources`/`toolSchemas` that are built from the same
 * bootstrap files and the same `effectiveTools` the system prompt renders into
 * `# Project Context` and `## Tooling` (see `attempt.ts`), so the two can overlap
 * almost completely. This module is measurement only: it decides nothing and
 * changes no bytes. It exists so the "should VToken keep re-packing content the
 * prompt already carries?" decision can be made on a real number instead of on a
 * reading of the code.
 */
export type VtokenPromptOverlap = {
  sourceCount: number;
  overlappingSourceCount: number;
  overlappingSourceChars: number;
  toolSchemaCount: number;
  overlappingToolSchemaCount: number;
};

/**
 * Compare paths/tool names case- and separator-insensitively: the prompt renders
 * workspace-remapped paths and `markdownSources` keep the bootstrap file's own
 * spelling, so a byte comparison would under-report the overlap on Windows.
 */
/**
 * Case- and separator-insensitive key, exported because the VToken call site
 * reuses it to drop exactly the sources the prompt already renders. Sharing the
 * normalizer is what keeps the measurement and the cut from drifting apart.
 */
export function normalizeVtokenOverlapKey(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

export function computeVtokenPromptOverlap(params: {
  markdownSources: readonly { sourcePath: string; text: string }[];
  toolSchemaNames: readonly string[];
  promptSourcePaths: readonly string[];
  promptToolNames: readonly string[];
}): VtokenPromptOverlap {
  const promptPaths = new Set(
    params.promptSourcePaths
      .map(normalizeVtokenOverlapKey)
      .filter((entry) => entry.length > 0),
  );
  const promptTools = new Set(
    params.promptToolNames
      .map(normalizeVtokenOverlapKey)
      .filter((entry) => entry.length > 0),
  );

  let overlappingSourceCount = 0;
  let overlappingSourceChars = 0;
  for (const source of params.markdownSources) {
    if (!promptPaths.has(normalizeVtokenOverlapKey(source.sourcePath))) {
      continue;
    }
    overlappingSourceCount += 1;
    overlappingSourceChars += source.text.length;
  }

  let overlappingToolSchemaCount = 0;
  for (const name of params.toolSchemaNames) {
    if (promptTools.has(normalizeVtokenOverlapKey(name))) {
      overlappingToolSchemaCount += 1;
    }
  }

  return {
    sourceCount: params.markdownSources.length,
    overlappingSourceCount,
    overlappingSourceChars,
    toolSchemaCount: params.toolSchemaNames.length,
    overlappingToolSchemaCount,
  };
}