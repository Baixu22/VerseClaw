// P5-2 CLI/TUI Deletion: video generation live test helpers stub.
//
// The original `video-generation/live-test-helpers.ts` was retired.
// This stub preserves the public surface used by
// `plugin-sdk/testing.ts` so type checking stays green.
export const DEFAULT_LIVE_VIDEO_MODELS: readonly string[] = [];

export function resolveConfiguredLiveVideoModels(_config: unknown): readonly string[] {
  return DEFAULT_LIVE_VIDEO_MODELS;
}

export function resolveLiveVideoAuthStore(_config: unknown): unknown {
  return null;
}

export function resolveLiveVideoResolution(_value: unknown): string {
  return "720p";
}

export function canRunBufferBackedImageToVideoLiveLane(_config: unknown): boolean {
  return false;
}

export function canRunBufferBackedVideoToVideoLiveLane(_config: unknown): boolean {
  return false;
}
