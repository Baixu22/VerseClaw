import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { __testing as beforeToolCallTesting } from "../../openclaw_runtime/src/agents/agent-tools.before-tool-call";
import {
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH,
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_RUNTIME_COMPONENT_SCHEMA_VERSION,
  evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent,
  resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled,
  runtimePreflightComponentMetadata,
  type RuntimeFailureDestructiveOperationGuardPreflightCandidate,
} from "../../openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot";

const VALID_CANDIDATE: RuntimeFailureDestructiveOperationGuardPreflightCandidate = {
  ruleId: "destructive_operation_guard",
  toolName: "code_mode_exec",
  toolCallId: "tool-call-1",
  futureActiveCandidate: {
    action: "block",
    requiresAcceptedSpec: true,
  },
  signals: {
    deletedTouchedPathMetadata: true,
    wrongFileEditScorecardFail: true,
    phase5FutureBlockCandidate: true,
    falseBlockCorpusPassing: true,
  },
  provenance: {
    replayRefs: ["replay:positive-deleted-and-scorecard-fail"],
    scorecardRefs: ["scorecard:metric:wrong_file_edit:fail"],
    touchedPathRefs: ["touched-path:deleted"],
    failureRefs: ["failure:wrong-file-edit"],
    evidenceRefs: ["evidence:destructive-operation-guard"],
    phase5FindingRefs: ["phase5:future-active-candidate:block"],
  },
};

describe("destructive_operation_guard default-off preflight pilot", () => {
  it("exposes a stable controlled runtime preflight component contract", () => {
    expect(runtimePreflightComponentMetadata()).toEqual({
      schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_RUNTIME_COMPONENT_SCHEMA_VERSION,
      componentId: "destructive_operation_guard.runtime_preflight_component",
      layer: "runtime_core_tool_governance_preflight",
      activeRuntimeLayer: "mutation_capable_tool_invocation_preflight",
      runtimeComponent: true,
      defaultOff: true,
      productionReady: false,
      defaultOnApproved: false,
      allowedOwner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
      callerSuppliedOwner: false,
      flagPath: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH,
      activeOwnerExpansionApproved: false,
    });
  });

  it("does not export the low-level evaluator as a second runtime entrypoint", async () => {
    const moduleExports = await import(
      "../../openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot"
    );

    expect("evaluateRuntimeFailureDestructiveOperationGuardPreflight" in moduleExports)
      .toBe(false);
  });

  it("evaluates controlled runtime component decisions without changing flag-off legacy behavior", () => {
    const baseInput = {
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
      candidate: VALID_CANDIDATE,
    } as const;

    expect(evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent(baseInput))
      .toMatchObject({
        metadata: {
          runtimeComponent: true,
          defaultOff: true,
          productionReady: false,
          defaultOnApproved: false,
        },
        decision: {
          action: "allow",
          reason: "flag_disabled",
          legacyBehavior: true,
        },
      });

    expect(evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent({
      ...baseInput,
      config: {
        runtime: {
          toolGovernance: {
            destructiveOperationGuard: {
              preflight: { enabled: true },
            },
          },
        },
      },
    })).toMatchObject({
      decision: {
        action: "block",
        deniedReason: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
      },
    });
  });

  it("resolves omitted and non-true config values as disabled", () => {
    expect(resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled()).toBe(false);
    expect(resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled({ runtime: {} })).toBe(false);
    expect(resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled({
      runtime: {
        toolGovernance: {
          destructiveOperationGuard: {
            preflight: {},
          },
        },
      },
    })).toBe(false);
    expect(resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled({
      runtime: {
        toolGovernance: {
          destructiveOperationGuard: {
            preflight: { enabled: false },
          },
        },
      },
    })).toBe(false);
    expect(resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled({
      runtime: {
        toolGovernance: {
          destructiveOperationGuard: {
            preflight: { enabled: true },
          },
        },
      },
    })).toBe(true);
  });

  it("keeps flag-off behavior on the legacy allow path", () => {
    const decision = evaluateComponentDecision({
      flagEnabled: false,
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
      candidate: VALID_CANDIDATE,
    });

    expect(decision).toEqual({
      action: "allow",
      reason: "flag_disabled",
      legacyBehavior: true,
    });
  });

  it("allows non-mutation-capable tools, missing candidates, and invalid candidates", () => {
    expect(evaluateComponentDecision({
      flagEnabled: true,
      tool: {
        name: "readonly_status",
        mutationCapable: false,
      },
      candidate: { ...VALID_CANDIDATE, toolName: "readonly_status" },
    })).toMatchObject({ action: "allow", reason: "tool_not_mutation_capable" });

    expect(evaluateComponentDecision({
      flagEnabled: true,
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
    })).toMatchObject({ action: "allow", reason: "candidate_missing" });

    expect(evaluateComponentDecision({
      flagEnabled: true,
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
      candidate: { ...VALID_CANDIDATE, toolName: "other_tool" },
    })).toMatchObject({ action: "allow", reason: "candidate_invalid" });
  });

  it("does not trigger on deleted path alone, missing scorecard failures, or failing false-block corpus", () => {
    const baseInput = {
      flagEnabled: true,
      tool: {
        name: "code_mode_exec",
        kind: "code_mode_exec",
        mutationCapable: true,
      },
    } as const;

    expect(evaluateComponentDecision({
      ...baseInput,
      candidate: {
        ...VALID_CANDIDATE,
        signals: {
          deletedTouchedPathMetadata: true,
          phase5FutureBlockCandidate: false,
          falseBlockCorpusPassing: false,
        },
      },
    })).toMatchObject({ action: "allow", reason: "trigger_not_qualified" });

    expect(evaluateComponentDecision({
      ...baseInput,
      candidate: {
        ...VALID_CANDIDATE,
        signals: {
          deletedTouchedPathMetadata: true,
          phase5FutureBlockCandidate: true,
          falseBlockCorpusPassing: true,
        },
      },
    })).toMatchObject({ action: "allow", reason: "trigger_not_qualified" });

    expect(evaluateComponentDecision({
      ...baseInput,
      candidate: {
        ...VALID_CANDIDATE,
        signals: {
          deletedTouchedPathMetadata: true,
          wrongFileEditScorecardFail: true,
          phase5FutureBlockCandidate: true,
          falseBlockCorpusPassing: false,
        },
      },
    })).toMatchObject({ action: "allow", reason: "trigger_not_qualified" });
  });

  it("blocks only a fully evidence-qualified trigger and emits bounded sanitized diagnostics", () => {
    const decision = evaluateComponentDecision({
      flagEnabled: true,
      tool: {
        name: "Code Mode Exec",
        kind: "code_mode_exec",
        inputKind: "shell",
        mutationCapable: true,
      },
      candidate: {
        ...VALID_CANDIDATE,
        toolName: "Code Mode Exec",
        toolCallId: "tool-call-1\nwith-tab\t",
        provenance: {
          replayRefs: [
            "C:\\Users\\27933\\Desktop\\clawx\\ClawX\\private\\secret.ts",
            "/home/me/private/secret.ts",
          ],
          scorecardRefs: ["scorecard:metric:wrong_file_edit:fail sk-secretShouldBeRedacted123456789"],
          touchedPathRefs: ["touched-path:deleted ghp_secretShouldBeRedacted123456789"],
        },
      },
    });

    expect(decision).toMatchObject({
      action: "block",
      deniedReason: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
      diagnostics: {
        ruleId: "destructive_operation_guard",
        owner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
        flagPath: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH,
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        toolInputKind: "shell",
        toolCallId: "tool-call-1 with-tab",
      },
    });

    const payload = JSON.stringify(decision);
    expect(payload).toContain("[redacted-path]");
    expect(payload).toContain("[redacted-secret]");
    expect(payload).not.toContain("secret.ts");
    expect(payload).not.toContain("secretShouldBeRedacted");
    expect(new TextEncoder().encode(payload).length).toBeLessThan(4096);
  });

  it("integrates only with mutation-capable runBeforeToolCallHook preflight when explicitly enabled", async () => {
    const params = { command: "synthetic fixture command" };

    await expect(beforeToolCallTesting.runBeforeToolCallHook({
      toolName: "code_mode_exec",
      params,
      toolKind: "code_mode_exec",
      ctx: {
        config: {},
        toolGovernance: {
          destructiveOperationGuard: {
            preflightCandidate: VALID_CANDIDATE,
          },
        },
      },
    })).resolves.toEqual({ blocked: false, params });

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
            preflightCandidate: VALID_CANDIDATE,
          },
        },
      },
    })).resolves.toMatchObject({
      blocked: true,
      kind: "veto",
      deniedReason: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
      params,
    });

    await expect(beforeToolCallTesting.runBeforeToolCallHook({
      toolName: "code_mode_exec",
      params,
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
            preflightCandidate: VALID_CANDIDATE,
          },
        },
      },
    })).resolves.toEqual({ blocked: false, params });

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
      },
    })).resolves.toEqual({ blocked: false, params });
  });

  it("keeps the active consumer bounded to the mutation-capable tool invocation preflight owner", () => {
    const moduleNeedle =
      "failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot";
    const activeDecisionNeedles = [
      "evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent",
      "RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER",
    ];
    const allowedRuntimeHits = [
      "openclaw_runtime/src/agents/agent-tools.before-tool-call.ts",
      "openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts",
      "openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts",
      "openclaw_runtime/src/runtime-core/index.ts",
    ].sort();

    const runtimeHits = sourceHits("openclaw_runtime/src", [moduleNeedle, ...activeDecisionNeedles])
      .filter((file) => !file.startsWith("openclaw_runtime/src/config/"))
      .sort();

    expect(runtimeHits).toEqual(allowedRuntimeHits);

    const deniedRoots = [
      "openclaw_runtime/src/agents/task-loop-controller.ts",
      "openclaw_runtime/src/acp",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/auto-reply",
      "openclaw_runtime/src/channels",
      "openclaw_runtime/src/plugin-sdk",
      "openclaw_runtime/src/tasks",
      "electron/main",
      "electron/services",
      "src",
      "scripts",
    ];

    const deniedHits = deniedRoots.flatMap((root) =>
      sourceHits(root, [moduleNeedle, ...activeDecisionNeedles])
        .filter((file) => file !== "openclaw_runtime/src/agents/agent-tools.before-tool-call.ts")
    );

    expect(deniedHits).toEqual([]);
  });
});

function evaluateComponentDecision(input: {
  flagEnabled: boolean;
  tool: {
    name: string;
    kind?: string;
    inputKind?: string;
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

function sourceHits(root: string, needles: string[]): string[] {
  const absoluteRoot = join(process.cwd(), root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }
  const files = statSync(absoluteRoot).isDirectory() ? collectSourceFiles(absoluteRoot) : [absoluteRoot];
  return files.flatMap((file) => sourceFileHits(file, needles));
}

function sourceFileHits(file: string, needles: string[]): string[] {
  const absoluteFile = isAbsolute(file) ? file : join(process.cwd(), file);
  if (!existsSync(absoluteFile)) {
    return [];
  }
  const content = readFileSync(absoluteFile, "utf8");
  if (!needles.some((needle) => content.includes(needle))) {
    return [];
  }
  return [relative(process.cwd(), absoluteFile).replaceAll("\\", "/")];
}

function collectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git", "coverage"].includes(entry.name)) {
        return [];
      }
      return collectSourceFiles(child);
    }
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [child] : [];
  });
}
