import { describe, expect, it } from "vitest";
import { __testing as beforeToolCallTesting } from "../../openclaw_runtime/src/agents/agent-tools.before-tool-call";
import {
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
  evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent,
  type RuntimeFailureDestructiveOperationGuardPreflightCandidate,
} from "../../openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot";

type HoldoutCase = {
  id: string;
  category:
    | "expected_edit"
    | "expected_deletion"
    | "normal_completed_repair"
    | "completed_test_repair"
    | "sanitized_or_inconclusive_touched_path"
    | "legitimate_fixture_mutation"
    | "slow_test_command"
    | "known_dev_server_like_long_running";
  candidate: RuntimeFailureDestructiveOperationGuardPreflightCandidate;
};

const BASE_PROVENANCE = {
  replayRefs: ["fixture:tests/fixtures/runtime-replay/success.json"],
  scorecardRefs: ["scorecard:aggregate:improved"],
  touchedPathRefs: ["touched-path:fixture-owned"],
  failureRefs: ["failure:none"],
  evidenceRefs: ["evidence:holdout-regression"],
  phase5FindingRefs: ["phase5:future-active-candidate:holdout"],
};

describe("destructive_operation_guard holdout regression expansion", () => {
  it("keeps every expanded holdout non-blocking when the pilot is enabled", () => {
    for (const holdout of holdoutCases()) {
      const decision = evaluateComponentDecision({
        flagEnabled: true,
        tool: {
          name: "code_mode_exec",
          kind: "code_mode_exec",
          mutationCapable: true,
        },
        candidate: holdout.candidate,
      });

      expect(decision, holdout.id).toMatchObject({
        action: "allow",
        reason: "trigger_not_qualified",
      });
    }
  });

  it("keeps every expanded holdout on the legacy allow path when the pilot flag is off", () => {
    for (const holdout of holdoutCases()) {
      expect(evaluateComponentDecision({
        flagEnabled: false,
        tool: {
          name: "code_mode_exec",
          kind: "code_mode_exec",
          mutationCapable: true,
        },
        candidate: holdout.candidate,
      }), holdout.id).toEqual({
        action: "allow",
        reason: "flag_disabled",
        legacyBehavior: true,
      });
    }
  });

  it("keeps expected deletion non-blocking even with deleted path and Phase 5 block metadata", () => {
    const expectedDeletion = holdoutByCategory("expected_deletion");

    expect(expectedDeletion.candidate.signals.deletedTouchedPathMetadata).toBe(true);
    expect(expectedDeletion.candidate.signals.phase5FutureBlockCandidate).toBe(true);
    expect(expectedDeletion.candidate.futureActiveCandidate).toEqual({
      action: "block",
      requiresAcceptedSpec: true,
    });
    expect(expectedDeletion.candidate.signals.wrongFileEditScorecardFail).not.toBe(true);
    expect(expectedDeletion.candidate.signals.unnecessaryEditScorecardFail).not.toBe(true);

    expect(evaluateComponentDecision({
      flagEnabled: true,
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
      candidate: expectedDeletion.candidate,
    })).toMatchObject({
      action: "allow",
      reason: "trigger_not_qualified",
    });
  });

  it("keeps slow test and dev-server-like metadata from becoming shell pattern blocks", () => {
    for (const category of ["slow_test_command", "known_dev_server_like_long_running"] as const) {
      const holdout = holdoutByCategory(category);
      const payload = JSON.stringify(holdout.candidate);

      expect(payload).toMatch(category === "slow_test_command" ? /pnpm test/ : /dev-server-like/);
      expect(evaluateComponentDecision({
        flagEnabled: true,
        tool: {
          name: "code_mode_exec",
          kind: "code_mode_exec",
          mutationCapable: true,
        },
        candidate: holdout.candidate,
      }), holdout.id).toMatchObject({
        action: "allow",
        reason: "trigger_not_qualified",
      });
    }
  });

  it("preserves preflight hook allow behavior for flag-off and flag-on holdouts", async () => {
    const params = { command: "synthetic holdout command" };

    for (const holdout of holdoutCases()) {
      await expect(beforeToolCallTesting.runBeforeToolCallHook({
        toolName: "code_mode_exec",
        params,
        toolKind: "code_mode_exec",
        ctx: {
          config: {},
          toolGovernance: {
            destructiveOperationGuard: {
              preflightCandidate: holdout.candidate,
            },
          },
        },
      }), `${holdout.id}:flag-off`).resolves.toEqual({ blocked: false, params });

      await expect(beforeToolCallTesting.runBeforeToolCallHook({
        toolName: "code_mode_exec",
        params,
        toolKind: "code_mode_exec",
        ctx: {
          config: {
            runtime: {
              toolGovernance: {
                destructiveOperationGuard: {
                  preflight: { enabled: true },
                },
              },
            },
          },
          toolGovernance: {
            destructiveOperationGuard: {
              preflightCandidate: holdout.candidate,
            },
          },
        },
      }), `${holdout.id}:flag-on`).resolves.toEqual({ blocked: false, params });
    }
  });

  it("keeps a positive control block when every accepted trigger signal is present", () => {
    const decision = evaluateComponentDecision({
      flagEnabled: true,
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
      candidate: positiveControlCandidate(),
    });

    expect(decision).toMatchObject({
      action: "block",
      deniedReason: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
    });
  });
});

function evaluateComponentDecision(input: {
  flagEnabled: boolean;
  tool: {
    name: string;
    kind?: string;
    mutationCapable: boolean;
  };
  candidate?: RuntimeFailureDestructiveOperationGuardPreflightCandidate;
}) {
  return evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent({
    config: input.flagEnabled
      ? {
          runtime: {
            toolGovernance: {
              destructiveOperationGuard: {
                preflight: { enabled: true },
              },
            },
          },
        }
      : undefined,
    tool: input.tool,
    candidate: input.candidate,
  }).decision;
}

function holdoutByCategory(category: HoldoutCase["category"]): HoldoutCase {
  const holdout = holdoutCases().find((entry) => entry.category === category);
  expect(holdout).toBeDefined();
  if (!holdout) {
    throw new Error(`Missing holdout category ${category}.`);
  }
  return holdout;
}

function holdoutCases(): HoldoutCase[] {
  return [
    {
      id: "holdout-expected-edit-modified-target",
      category: "expected_edit",
      candidate: holdoutCandidate("holdout-expected-edit-modified-target", {
        deletedTouchedPathMetadata: false,
        phase5FutureBlockCandidate: false,
        falseBlockCorpusPassing: true,
      }, {
        touchedPathRefs: ["touched-path:modified:src/expected-edit-fixture.ts"],
      }),
    },
    {
      id: "holdout-expected-deletion-phase5-metadata",
      category: "expected_deletion",
      candidate: holdoutCandidate("holdout-expected-deletion-phase5-metadata", {
        deletedTouchedPathMetadata: true,
        phase5FutureBlockCandidate: true,
        falseBlockCorpusPassing: true,
      }, {
        replayRefs: ["fixture:tests/fixtures/runtime-replay/success.json"],
        scorecardRefs: ["scorecard:metric:wrong_file_edit:pass", "scorecard:metric:unnecessary_edit:pass"],
        touchedPathRefs: ["touched-path:deleted:src/expected-remove-fixture.ts"],
        phase5FindingRefs: ["phase5:futureActiveCandidate:block:expected-deletion-holdout"],
      }),
    },
    {
      id: "holdout-normal-completed-repair",
      category: "normal_completed_repair",
      candidate: holdoutCandidate("holdout-normal-completed-repair", {
        deletedTouchedPathMetadata: false,
        phase5FutureBlockCandidate: true,
        falseBlockCorpusPassing: true,
      }, {
        touchedPathRefs: ["touched-path:modified:src/repair-target.ts"],
      }),
    },
    {
      id: "holdout-completed-test-repair",
      category: "completed_test_repair",
      candidate: holdoutCandidate("holdout-completed-test-repair", {
        deletedTouchedPathMetadata: false,
        phase5FutureBlockCandidate: false,
        falseBlockCorpusPassing: true,
      }, {
        replayRefs: ["fixture:tests/fixtures/runtime-replay/test-failure-after-repair.json"],
        touchedPathRefs: ["touched-path:modified:tests/unit/repair-target.test.ts"],
      }),
    },
    {
      id: "holdout-sanitized-inconclusive-path",
      category: "sanitized_or_inconclusive_touched_path",
      candidate: holdoutCandidate("holdout-sanitized-inconclusive-path", {
        deletedTouchedPathMetadata: false,
        phase5FutureBlockCandidate: true,
        falseBlockCorpusPassing: true,
      }, {
        touchedPathRefs: ["touched-path:[redacted-path]:inconclusive"],
      }),
    },
    {
      id: "holdout-legitimate-fixture-mutation",
      category: "legitimate_fixture_mutation",
      candidate: holdoutCandidate("holdout-legitimate-fixture-mutation", {
        deletedTouchedPathMetadata: true,
        phase5FutureBlockCandidate: true,
        falseBlockCorpusPassing: true,
      }, {
        replayRefs: ["fixture:tests/fixtures/runtime-replay/dirty-workspace.json"],
        scorecardRefs: ["scorecard:metric:wrong_file_edit:pass", "scorecard:metric:unnecessary_edit:pass"],
        touchedPathRefs: ["touched-path:deleted:tests/fixtures/runtime-replay/generated-fixture.tmp"],
      }),
    },
    {
      id: "holdout-slow-test-command",
      category: "slow_test_command",
      candidate: holdoutCandidate("holdout-slow-test-command", {
        deletedTouchedPathMetadata: false,
        phase5FutureBlockCandidate: false,
        falseBlockCorpusPassing: true,
      }, {
        replayRefs: ["fixture:tests/fixtures/runtime-replay/test-failure-after-repair.json"],
        evidenceRefs: ["tool-command:pnpm test -- --runInBand", "duration:600000ms"],
        touchedPathRefs: ["touched-path:none"],
      }),
    },
    {
      id: "holdout-known-dev-server-like-long-running",
      category: "known_dev_server_like_long_running",
      candidate: holdoutCandidate("holdout-known-dev-server-like-long-running", {
        deletedTouchedPathMetadata: false,
        phase5FutureBlockCandidate: false,
        falseBlockCorpusPassing: true,
      }, {
        evidenceRefs: ["tool-command:vite --host 127.0.0.1", "known-dev-server-like-long-running"],
        touchedPathRefs: ["touched-path:none"],
        phase5FindingRefs: ["phase5:long-running-process:dev-server-like"],
      }),
    },
  ];
}

function holdoutCandidate(
  toolCallId: string,
  signals: RuntimeFailureDestructiveOperationGuardPreflightCandidate["signals"],
  provenanceOverrides: Partial<RuntimeFailureDestructiveOperationGuardPreflightCandidate["provenance"]> = {},
): RuntimeFailureDestructiveOperationGuardPreflightCandidate {
  return {
    ruleId: "destructive_operation_guard",
    toolName: "code_mode_exec",
    toolCallId,
    futureActiveCandidate: {
      action: "block",
      requiresAcceptedSpec: true,
    },
    signals,
    provenance: {
      ...BASE_PROVENANCE,
      ...provenanceOverrides,
    },
  };
}

function positiveControlCandidate(): RuntimeFailureDestructiveOperationGuardPreflightCandidate {
  return holdoutCandidate("positive-control-evidence-qualified-block", {
    deletedTouchedPathMetadata: true,
    wrongFileEditScorecardFail: true,
    phase5FutureBlockCandidate: true,
    falseBlockCorpusPassing: true,
  }, {
    replayRefs: ["fixture:tests/fixtures/runtime-replay/dirty-workspace.json"],
    scorecardRefs: ["scorecard:metric:wrong_file_edit:fail"],
    touchedPathRefs: ["touched-path:deleted:src/generated-delete-target.ts"],
    phase5FindingRefs: ["phase5:futureActiveCandidate:block:positive-control"],
  });
}
