/**
 * V-1 (D2) verification: SEKB terminal task_phase_change → TrajectoryCapture.
 * Verify-only — does not modify production code.
 *
 * Run: OPENCLAW_SEKB_ENABLED=1 node --import tsx scripts/coding-v1-sekb-verify.mts
 */
import {
  clearTaskStateHandlerConfig,
  runAgentHarnessTaskPhaseChangeHook,
  setTaskStateHandlerConfig,
} from "../src/agents/harness/lifecycle-hook-helpers.js";
import {
  isSekbEnabled,
  resolveEmbeddedSekbRuntime,
} from "../src/agents/embedded-agent-runner/sekb-runtime.js";
import { resolveEmbeddedDcsExtensionDeps } from "../src/agents/embedded-agent-runner/dcs-extension-deps.js";

type Evidence = {
  ok: boolean;
  conclusion: "D2_cleared" | "gap";
  gap?: string;
  sekbEnabled: boolean;
  depsHasTrajectoryCapture: boolean;
  trajectories: Array<{
    trajectory_id: string;
    task_intent: string;
    task_type: string;
    outcome: string;
    context_fingerprint: string[];
  }>;
  anchors: string[];
};

async function main(): Promise<void> {
  process.env.OPENCLAW_SEKB_ENABLED = "1";
  const env = process.env;
  const sekbEnabled = isSekbEnabled(undefined, env);
  const runtime = resolveEmbeddedSekbRuntime({ env });
  const depsResolution = resolveEmbeddedDcsExtensionDeps({
    prompt: "V-1 verify terminal phase capture",
    env,
    workspaceRoot: process.cwd(),
  });
  const deps = depsResolution.deps;

  const anchors = [
    "openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts:resolveEmbeddedSekbRuntime",
    "openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts:isSekbEnabled/resolveEmbeddedSekbRuntime",
    "openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:buildTaskStateFactory setTaskStateHandlerConfig.trajectoryCapture",
    "openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts:runAgentHarnessTaskPhaseChangeHook terminal capture",
    "openclaw_runtime/src/agents/task-loop-controller.ts:emitTaskLoopTaskPhaseChange",
    "openclaw_runtime/src/knowledge/sekb/trajectory-capture.ts:start_trajectory/finish_trajectory",
  ];

  if (!sekbEnabled || !runtime || !deps?.trajectoryCapture) {
    const evidence: Evidence = {
      ok: false,
      conclusion: "gap",
      gap: !sekbEnabled
        ? "OPENCLAW_SEKB_ENABLED did not enable SEKB"
        : !runtime
          ? "resolveEmbeddedSekbRuntime returned undefined under OPENCLAW_SEKB_ENABLED=1"
          : "dcs-extension-deps did not attach trajectoryCapture under SEKB enable",
      sekbEnabled,
      depsHasTrajectoryCapture: Boolean(deps?.trajectoryCapture),
      trajectories: [],
      anchors,
    };
    console.log(JSON.stringify(evidence, null, 2));
    process.exit(1);
  }

  clearTaskStateHandlerConfig();
  setTaskStateHandlerConfig({
    contextBlockSink: deps.contextBlockSink,
    workingMemoryStore: deps.workingMemoryStore,
    trajectoryCapture: deps.trajectoryCapture,
    objective: "V-1 SEKB terminal phase verification",
  });

  try {
    // Simulate orchestration terminal transition (completed).
    await runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "agent:v1:main",
        taskId: "v1-task-1",
        fromStatus: "verifying",
        toStatus: "completed",
      },
      ctx: { runId: "v1-run-1", sessionId: "agent:v1:main" },
    });

    const listed = runtime.store.query_trajectories({});
    const trajectories = listed.map((t) => ({
      trajectory_id: t.trajectory_id,
      task_intent: t.task_intent,
      task_type: t.task_type,
      outcome: t.outcome,
      context_fingerprint: t.context_fingerprint,
    }));

    const hasTerminal = trajectories.some(
      (t) =>
        t.outcome === "success" &&
        t.task_type === "agent/task" &&
        t.context_fingerprint.includes("completed"),
    );

    const evidence: Evidence = {
      ok: hasTerminal,
      conclusion: hasTerminal ? "D2_cleared" : "gap",
      gap: hasTerminal
        ? undefined
        : "runAgentHarnessTaskPhaseChangeHook with trajectoryCapture did not persist a terminal success trajectory (gap in lifecycle-hook-helpers.ts:246-260 or store persistence)",
      sekbEnabled,
      depsHasTrajectoryCapture: true,
      trajectories,
      anchors,
    };
    console.log(JSON.stringify(evidence, null, 2));
    if (!hasTerminal) process.exit(2);
  } finally {
    clearTaskStateHandlerConfig();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});