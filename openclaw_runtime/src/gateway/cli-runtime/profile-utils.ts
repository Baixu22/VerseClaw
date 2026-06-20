// P5-2 CLI/TUI Deletion: Profile name normalizer stub.
//
// The original `cli/profile-utils.ts` was retired along with the `cli/`
// directory. This stub preserves the public surface used by
// `cli-runtime/command-format.ts` (and other gateway CLI-formatting
// helpers) so the gateway can render profile-prefixed commands.
export function normalizeProfileName(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}
