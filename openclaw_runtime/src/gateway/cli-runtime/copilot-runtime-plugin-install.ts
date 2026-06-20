// P5-2 CLI/TUI Deletion: copilot runtime plugin install stub.
//
// The original `commands/copilot-runtime-plugin-install.ts` was retired
// along with the `commands/` directory. This stub preserves the
// public surface used by the dynamic `await import(...)` in
// `plugins/provider-auth-choice.ts`.

export type EnsureCopilotRuntimePluginParams<TConfig = unknown> = {
  cfg: TConfig;
  model: string;
  prompter: unknown;
  runtime: unknown;
  workspaceDir?: string;
};

export type EnsureCopilotRuntimePluginResult<TConfig = unknown> = {
  cfg: TConfig;
  installed: boolean;
};

export async function ensureCopilotRuntimePluginForModelSelection<TConfig = unknown>(
  params: EnsureCopilotRuntimePluginParams<TConfig>,
): Promise<EnsureCopilotRuntimePluginResult<TConfig>> {
  return { cfg: params.cfg, installed: false };
}
