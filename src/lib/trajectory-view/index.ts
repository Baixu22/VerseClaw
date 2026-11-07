import { hostApi } from '../host-api';
import { hostEvents } from '../host-events';
import { TrajectoryViewFeed } from './feed';
export { TrajectoryViewFeed, type TrajectoryView } from './feed';
export type { LifecycleData } from './lifecycle';

export const trajectoryViewFeed = new TrajectoryViewFeed({
  history: (input) => hostApi.observability.trajectoryHistory(input),
  subscribe: (listener) => hostEvents.onObservabilityTrajectoryEvent?.((event) => listener(event as Parameters<typeof listener>[0])) ?? (() => {}),
});
