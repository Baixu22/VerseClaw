// P5-2 CLI/TUI Deletion: media-generation live test helpers stub.
//
// The original `media-generation/live-test-helpers.ts` was retired.
// This stub preserves the public surface used by
// `plugin-sdk/testing.ts` so type checking stays green.
export function parseLiveCsvFilter(_value: string): string[] {
  return [];
}

export function parseProviderModelMap(_value: string): Record<string, string> {
  return {};
}

export function redactLiveApiKey(_value: string): string {
  return "[redacted]";
}
