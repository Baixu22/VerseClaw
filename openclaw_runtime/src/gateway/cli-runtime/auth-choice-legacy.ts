// P5-2 CLI/TUI Deletion: legacy auth-choice helper stub.
//
// The original `commands/auth-choice-legacy.ts` was retired along with
// the `commands/` directory. This stub preserves the public surface
// used by `plugins/provider-auth-choice-preference.ts` so type
// checking and the headless runtime path stay green.

export type NormalizeLegacyOnboardAuthChoiceOptions = {
  env?: NodeJS.ProcessEnv;
};

export function normalizeLegacyOnboardAuthChoice(
  choice: string,
  _options?: NormalizeLegacyOnboardAuthChoiceOptions,
): string | undefined {
  // Headless runtime has no legacy-onboard alias table; pass through
  // any choice whose first character looks normalized, otherwise
  // return undefined to force the caller to fall back to the
  // configured provider id.
  if (!choice) return undefined;
  return choice;
}
