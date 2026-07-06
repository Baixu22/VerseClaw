import { getResourceTracker } from '../services/resource-tracker';

export function createResourceTrackerApi() {
  const tracker = getResourceTracker();

  return {
    list: async () => {
      return tracker.list();
    },
    stop: async (payload: { resourceId: string }) => {
      return tracker.stopResource(payload.resourceId);
    },
    stopAll: async () => {
      return tracker.stopAll();
    },
  };
}
