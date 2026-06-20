// P5-2 CLI/TUI Deletion: wizard i18n stub.
//
// The original `wizard/i18n/index.ts` was retired along with the
// `wizard/` directory. This stub preserves the public surface used
// by `plugins/provider-auth-choice.ts` (`t`) so the type checker and
// runtime import chain stay green. The stub returns the key
// unchanged, which is safe for a headless runtime that has no
// localized prompt strings of its own.

export function t(key: string, params?: Record<string, string | number>): string {
  if (!params) return key;
  return key.replace(/\{(\w+)\}/g, (_m, name) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

export type WizardI18nKey = string;
