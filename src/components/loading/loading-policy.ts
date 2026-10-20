export type LoadingStrategy = 'none' | 'quiet' | 'structural';

export type LoadingSurfaceId =
  | 'agents'
  | 'skills'
  | 'channels'
  | 'cron'
  | 'models'
  | 'billing'
  | 'observability'
  | 'inbox'
  | 'task-ledger'
  | 'clawgraph'
  | 'knowledge'
  | 'settings-section'
  | 'route-chunk';

export type LoadingPolicy = {
  strategy: LoadingStrategy;
  delayMs: number;
  buildMs?: number;
};

export const LOADING_POLICY: Record<LoadingSurfaceId, LoadingPolicy> = {
  agents: { strategy: 'structural', delayMs: 240, buildMs: 720 },
  skills: { strategy: 'structural', delayMs: 240, buildMs: 720 },
  channels: { strategy: 'structural', delayMs: 240, buildMs: 720 },
  cron: { strategy: 'structural', delayMs: 240, buildMs: 720 },
  models: { strategy: 'structural', delayMs: 200, buildMs: 520 },
  billing: { strategy: 'structural', delayMs: 200, buildMs: 520 },
  observability: { strategy: 'structural', delayMs: 200, buildMs: 520 },
  inbox: { strategy: 'quiet', delayMs: 200 },
  'task-ledger': { strategy: 'quiet', delayMs: 200 },
  clawgraph: { strategy: 'quiet', delayMs: 200 },
  knowledge: { strategy: 'quiet', delayMs: 200 },
  'settings-section': { strategy: 'quiet', delayMs: 200 },
  'route-chunk': { strategy: 'quiet', delayMs: 200 },
};

export function getLoadingPolicy(surfaceId: LoadingSurfaceId): LoadingPolicy {
  return LOADING_POLICY[surfaceId];
}