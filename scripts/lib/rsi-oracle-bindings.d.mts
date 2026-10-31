export function gitBlob(root: string, revision: string, path: string): string | null;
export function classifyOracleBindings(
  root: string,
  testPaths: string[],
  baseCommit: string | null,
  referenceCommit: string | null,
): { hiddenSignalPaths: string[]; preexistingGuardPaths: string[] };
