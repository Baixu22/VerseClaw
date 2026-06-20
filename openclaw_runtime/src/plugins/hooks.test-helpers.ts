// P5-2 CLI/TUI Deletion: plugin hooks test helpers stub.
//
// The original `plugins/hooks.test-helpers.ts` was retired. This stub
// preserves the public surface used by `plugin-sdk/testing.ts` so type
// checking stays green. Implementations are no-ops because the runtime
// no longer hosts a CLI.
export function createMockPluginRegistry(): Record<string, unknown> {
  return {};
}

export const pluginHooksTestHelpers: Record<string, unknown> = {};
