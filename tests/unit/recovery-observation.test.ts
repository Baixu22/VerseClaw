// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("../e2e/fixtures/electron", () => ({ closeElectronApp: vi.fn() }));
import { observeRecoveryVerdict } from "../e2e/fixtures/recovery-contract-probe";

it("retains the last actual stalled state and timeout instead of discarding the trial", async () => {
  let reads = 0;
  const observation = await observeRecoveryVerdict(
    () => ({ revision: ++reads, state: "stalled" }),
    () => false,
    1,
  );
  expect(observation.timedOut).toBe(true);
  expect(observation.error).toContain("timed out");
  expect(observation.value).toEqual({ revision: reads, state: "stalled" });
  expect(reads).toBeGreaterThan(1);
});
it("preserves a reached recovery verdict without a timeout", async () => {
  expect(
    await observeRecoveryVerdict(
      () => ({ state: "reconcile" }),
      (value) => value.state === "reconcile",
      1000,
    ),
  ).toEqual({ value: { state: "reconcile" }, timedOut: false, error: "" });
});
