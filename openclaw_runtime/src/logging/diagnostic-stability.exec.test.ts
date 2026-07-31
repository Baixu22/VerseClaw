import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitDiagnosticEvent,
  resetDiagnosticEventsForTest,
  waitForDiagnosticEventsDrained,
} from "../infra/diagnostic-events.js";
import {
  getDiagnosticStabilitySnapshot,
  resetDiagnosticStabilityRecorderForTest,
  startDiagnosticStabilityRecorder,
  stopDiagnosticStabilityRecorder,
} from "./diagnostic-stability.js";

describe("exec diagnostic stability", () => {
  beforeEach(() => {
    resetDiagnosticEventsForTest();
    resetDiagnosticStabilityRecorderForTest();
    startDiagnosticStabilityRecorder();
  });

  afterEach(() => {
    stopDiagnosticStabilityRecorder();
    resetDiagnosticEventsForTest();
    resetDiagnosticStabilityRecorderForTest();
  });

  it("retains execution-plane fields without retaining command contents", async () => {
    emitDiagnosticEvent({
      type: "exec.process.completed",
      target: "host",
      selectedHost: "verseshell",
      executionHost: "verseshell",
      lifecycleOwner: "verseshell",
      cohortRoute: "verseshell-single-plane",
      nativeFallback: false,
      recoveryState: "exited",
      mode: "child",
      outcome: "completed",
      durationMs: 25,
      commandLength: 19,
      exitCode: 0,
      timedOut: false,
    });
    await waitForDiagnosticEventsDrained();

    const [event] = getDiagnosticStabilitySnapshot({ type: "exec.process.completed" }).events;
    expect(event).toMatchObject({
      type: "exec.process.completed",
      target: "host",
      selectedHost: "verseshell",
      executionHost: "verseshell",
      lifecycleOwner: "verseshell",
      cohortRoute: "verseshell-single-plane",
      nativeFallback: false,
      recoveryState: "exited",
      durationMs: 25,
      commandLength: 19,
      exitCode: 0,
      timedOut: false,
    });
    expect(event).not.toHaveProperty("command");
  });
});
