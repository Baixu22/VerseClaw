import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveExecDefaults } from "../exec-defaults.js";
import {
  summarizeUas06Canary,
  UAS06_ENGINEERING_SCENARIOS,
  type Uas06CanaryObservation,
} from "./single-plane-canary.js";

function observation(
  scenario: Uas06CanaryObservation["scenario"],
  overrides: Partial<Uas06CanaryObservation> = {},
): Uas06CanaryObservation {
  return {
    observationId: `engineering-${scenario}`,
    source: "engineering",
    cohortId: "internal-canary",
    cohortArm: "verseshell",
    scenario,
    eligibleLocal: true,
    executionHost: "verseshell",
    lifecycleOwner: "verseshell",
    nativeFallback: false,
    outcome: "completed",
    durationMs: 10,
    recoveryState:
      scenario === "cancel" || scenario === "timeout"
        ? "killed"
        : scenario === "restart"
          ? "lost"
          : "exited",
    unauthorizedExecutionCount: 0,
    duplicateProcessCount: 0,
    lostOutputBytes: 0,
    sensitiveOutputLeakCount: 0,
    ...(scenario === "rollback" ? { rollbackSucceeded: true } : {}),
    ...overrides,
  };
}

describe("UAS-06 single-plane canary evidence", () => {
  it("resolves global, agent, and session cohort scopes without taking other owners", () => {
    const globalConfig: OpenClawConfig = { tools: { exec: { host: "verseshell" } } };
    expect(resolveExecDefaults({ cfg: globalConfig, sandboxAvailable: false })).toMatchObject({
      host: "verseshell",
      effectiveHost: "verseshell",
    });

    const agentConfig: OpenClawConfig = {
      agents: {
        list: [{ id: "canary-agent", tools: { exec: { host: "verseshell" } } }],
      },
      tools: { exec: { host: "gateway" } },
    };
    expect(
      resolveExecDefaults({
        cfg: agentConfig,
        agentId: "canary-agent",
        sandboxAvailable: false,
      }),
    ).toMatchObject({ host: "verseshell", effectiveHost: "verseshell" });

    expect(
      resolveExecDefaults({
        cfg: { tools: { exec: { host: "gateway" } } },
        sessionEntry: { execHost: "verseshell" } as SessionEntry,
        sandboxAvailable: false,
      }),
    ).toMatchObject({ host: "verseshell", effectiveHost: "verseshell" });

    expect(resolveExecDefaults({ cfg: {}, sandboxAvailable: true })).toMatchObject({
      host: "auto",
      effectiveHost: "sandbox",
    });
    expect(
      resolveExecDefaults({
        cfg: { tools: { exec: { host: "node" } } },
        sandboxAvailable: false,
      }),
    ).toMatchObject({ host: "node", effectiveHost: "node" });
    expect(
      resolveExecDefaults({
        cfg: globalConfig,
        sandboxAvailable: false,
        elevatedRequested: true,
      }),
    ).toMatchObject({ host: "verseshell", effectiveHost: "gateway" });
  });

  it("keeps a complete engineering matrix below real canary qualification", () => {
    const summary = summarizeUas06Canary(
      UAS06_ENGINEERING_SCENARIOS.map((scenario) => observation(scenario)),
    );
    expect(summary).toMatchObject({
      status: "needs-real-canary",
      productGraduationAuthorized: false,
      counts: {
        engineering: UAS06_ENGINEERING_SCENARIOS.length,
        live: 0,
        eligibleCanaryLocal: UAS06_ENGINEERING_SCENARIOS.length,
        governedVerseShell: UAS06_ENGINEERING_SCENARIOS.length,
        nativeFallback: 0,
      },
      coverage: {
        governedLocalPercent: 100,
        missingEngineeringScenarios: [],
        providerUsagePercent: null,
      },
      hardVetoes: [],
      rollback: { observed: true, succeeded: true },
    });
    expect(summary.requiredNextEvidence).toContain("real internal cohort observations");
  });

  it("hard-vetoes a native fallback inside the selected cohort", () => {
    const summary = summarizeUas06Canary([
      observation("short", {
        executionHost: "gateway",
        lifecycleOwner: "native",
        nativeFallback: true,
      }),
    ]);
    expect(summary.status).toBe("blocked");
    expect(summary.hardVetoes).toEqual([
      "eligible-local-route-coverage-below-100-percent",
      "native-fallback-observed",
    ]);
  });

  it("requires actual provider usage and both arms for a real pair", () => {
    const engineering = UAS06_ENGINEERING_SCENARIOS.map((scenario) => observation(scenario));
    const baseline = observation("short", {
      observationId: "live-baseline",
      source: "live",
      cohortArm: "baseline",
      pairedTaskId: "task-1",
      eligibleLocal: false,
      executionHost: "gateway",
      lifecycleOwner: "native",
      providerUsage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
        actual: true,
      },
      humanRecoveryMinutes: 0,
    });
    const canary = observation("short", {
      observationId: "live-verseshell",
      source: "live",
      pairedTaskId: "task-1",
      providerUsage: {
        inputTokens: 9,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.009,
        actual: true,
      },
      humanRecoveryMinutes: 0,
    });
    expect(summarizeUas06Canary([...engineering, baseline, canary])).toMatchObject({
      status: "needs-real-canary",
      rollback: { realReviewedObserved: false, realReviewedSucceeded: false },
    });
    const operatorRollback = observation("rollback", {
      observationId: "live-operator-rollback",
      source: "live",
      operatorReviewed: true,
      providerUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        actual: true,
      },
      humanRecoveryMinutes: 1,
    });
    expect(
      summarizeUas06Canary([...engineering, baseline, canary, operatorRollback]),
    ).toMatchObject({
      status: "eligible-for-closeout-review",
      productGraduationAuthorized: false,
      counts: { realPairedTasks: 1, realProviderUsage: 3 },
      coverage: { providerUsagePercent: 100 },
      rollback: { realReviewedObserved: true, realReviewedSucceeded: true },
    });
  });

  it("hard-vetoes a scenario whose lifecycle result does not meet its gate", () => {
    const summary = summarizeUas06Canary([observation("timeout", { recoveryState: "exited" })]);
    expect(summary.status).toBe("blocked");
    expect(summary.hardVetoes).toContain("scenario-lifecycle-gate-failed");
  });
});
