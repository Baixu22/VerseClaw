import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emitDiagnosticEvent,
  resetDiagnosticEventsForTest,
  waitForDiagnosticEventsDrained,
} from "../infra/diagnostic-events.js";
import {
  admitProviderEndpointRequest,
  configureProviderEndpointHealth,
  resetProviderEndpointHealth,
} from "../agents/provider-endpoint-health.js";
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
    resetProviderEndpointHealth();
    startDiagnosticStabilityRecorder();
  });

  afterEach(() => {
    stopDiagnosticStabilityRecorder();
    resetDiagnosticEventsForTest();
    resetDiagnosticStabilityRecorderForTest();
    resetProviderEndpointHealth();
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

  it("attaches sanitized provider endpoint health snapshots when a breaker is configured", () => {
    configureProviderEndpointHealth({
      windowMs: 1_000,
      maxFailuresPerWindow: 2,
      cooldownMs: 5_000,
      now: () => 10_000,
    });
    // Drive one breaker to open through the same public admission API the
    // transport uses, then confirm diagnostics.stability exposes it.
    const group = {
      groupId: "https://api.deepseek.com#secret-account",
      endpoint: "https://api.deepseek.com",
      account: "secret-account",
      provider: "deepseek",
      api: "openai-completions",
    };
    for (let i = 0; i < 2; i++) {
      const admission = admitProviderEndpointRequest(group);
      if (admission.ok) admission.ticket.record("failure");
    }
    const snapshot = getDiagnosticStabilitySnapshot();
    const health = snapshot.summary.providerEndpointHealth;
    expect(health).toMatchObject([
      { endpoint: "https://api.deepseek.com", provider: "deepseek", state: "open", trips: 1 },
    ]);
    expect(JSON.stringify(health)).not.toContain("secret-account");
    expect(JSON.stringify(health)).not.toContain(group.groupId);
  });
});
