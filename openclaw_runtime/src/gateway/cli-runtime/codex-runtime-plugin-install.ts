// P5-2 CLI/TUI Deletion: codex runtime plugin install stub.
//
// The original `commands/codex-runtime-plugin-install.ts` was retired
// along with the `commands/` directory. This stub preserves the
// public surface used by the dynamic `await import(...)` in
// `plugins/provider-auth-choice.ts` so type checking and the headless
// runtime path stay green.

export const CODEX_RUNTIME_PLUGIN_ID = "codex-runtime";

export type EnsureCodexRuntimePluginParams<TConfig = unknown> = {
  cfg: TConfig;
  model: string;
  prompter: unknown;
  runtime: unknown;
  workspaceDir?: string;
};

export type EnsureCodexRuntimePluginResult<TConfig = unknown> = {
  cfg: TConfig;
  installed: boolean;
};

export async function ensureCodexRuntimePluginForModelSelection<TConfig = unknown>(
  params: EnsureCodexRuntimePluginParams<TConfig>,
): Promise<EnsureCodexRuntimePluginResult<TConfig>> {
  return { cfg: params.cfg, installed: false };
}
