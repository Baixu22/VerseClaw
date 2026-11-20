export type SystemControlState = {
  revision: number;
  paused: boolean;
  inFlightPolicy: 'settle-admitted-effects';
  updatedAt: string | null;
  recentRequests: Array<{ requestId: string; paused: boolean }>;
};
export type SystemControlChange = { expectedRevision: number; requestId: string; paused: boolean };

export function normalizeSystemControl(value: unknown): SystemControlState {
  if (value == null) return { revision: 0, paused: false, inFlightPolicy: 'settle-admitted-effects', updatedAt: null, recentRequests: [] };
  const state = value as Partial<SystemControlState>;
  if (!Number.isSafeInteger(state.revision) || state.revision! < 0 || typeof state.paused !== 'boolean'
    || state.inFlightPolicy !== 'settle-admitted-effects' || !Array.isArray(state.recentRequests)
    || state.recentRequests.some(request => !request || typeof request.requestId !== 'string' || typeof request.paused !== 'boolean')) {
    throw new Error('SYSTEM_CONTROL_UNAVAILABLE');
  }
  return state as SystemControlState;
}
