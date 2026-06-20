// P5-2 CLI/TUI Deletion: music generation live test helpers stub.
//
// The original `music-generation/live-test-helpers.ts` was retired.
// This stub preserves the public surface used by
// `plugin-sdk/testing.ts` so type checking stays green.
export const DEFAULT_LIVE_MUSIC_MODELS: readonly string[] = [];

export function resolveConfiguredLiveMusicModels(_config: unknown): readonly string[] {
  return DEFAULT_LIVE_MUSIC_MODELS;
}

export function resolveLiveMusicAuthStore(_config: unknown): unknown {
  return null;
}
