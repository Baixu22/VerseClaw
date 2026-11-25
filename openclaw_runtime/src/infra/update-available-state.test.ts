import { afterEach, expect, it, vi } from "vitest";
import {
  getUpdateAvailable,
  resetUpdateAvailableStateForTest,
  setUpdateAvailableCache,
} from "./update-available-state.js";

afterEach(resetUpdateAvailableStateForTest);

it("publishes changed updates once and shares the updater's existing state API", async () => {
  const updater = await import("./update-startup.js");
  expect(updater.getUpdateAvailable).toBe(getUpdateAvailable);
  expect(updater.resetUpdateAvailableStateForTest).toBe(resetUpdateAvailableStateForTest);
  const onUpdateAvailableChange = vi.fn();
  const next = { currentVersion: "1.0.0", latestVersion: "1.0.1", channel: "stable" };
  setUpdateAvailableCache({ next, onUpdateAvailableChange });
  expect(updater.getUpdateAvailable()).toBe(next);
  setUpdateAvailableCache({ next: { ...next }, onUpdateAvailableChange });
  expect(onUpdateAvailableChange).toHaveBeenCalledExactlyOnceWith(next);
  setUpdateAvailableCache({ next: { ...next, channel: "beta" }, onUpdateAvailableChange });
  setUpdateAvailableCache({ next: null, onUpdateAvailableChange });
  setUpdateAvailableCache({ next: null, onUpdateAvailableChange });
  expect(onUpdateAvailableChange).toHaveBeenCalledTimes(3);
  expect(onUpdateAvailableChange).toHaveBeenLastCalledWith(null);
  expect(updater.getUpdateAvailable()).toBeNull();
});
