// P5-2 CLI/TUI Deletion: onboarding plugin install stub.
//
// The original `commands/onboarding-plugin-install.ts` was retired
// along with the `commands/` directory. This stub preserves the
// public surface used by `plugins/provider-auth-choice.ts` and other
// plugin modules to type-check and the headless runtime path stay
// green. The generic `TConfig` parameter keeps callers that need a
// strongly-typed config (e.g. `OpenClawConfig`) free of `as` casts.

export type OnboardPluginInstallParams<TConfig = unknown> = {
  cfg: TConfig;
  entry?: { pluginId: string; [key: string]: unknown };
  prompter: unknown;
  runtime: unknown;
  workspaceDir?: string;
};

export type OnboardPluginInstallResult<TConfig = unknown> = {
  cfg: TConfig;
  installed: boolean;
};

export async function ensureOnboardingPluginInstalled<TConfig = unknown>(
  params: OnboardPluginInstallParams<TConfig>,
): Promise<OnboardPluginInstallResult<TConfig>> {
  return { cfg: params.cfg, installed: false };
}
