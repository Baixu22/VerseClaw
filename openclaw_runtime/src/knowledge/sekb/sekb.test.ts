import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "../../agents/runtime/index.js";
import type { GlobalHookRunnerRegistry } from "../../plugins/hook-registry.types.js";
import type { PluginHookName, PluginHookRegistration } from "../../plugins/hook-types.js";
import { createHookRunner } from "../../plugins/hooks.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { DistillationTool } from "./distillation-tool.js";
import { installSekbHarnessHooks } from "./harness-integration.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { buildSekbOperatorReport } from "./operator-report.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { TrajectoryCapture } from "./trajectory-capture.js";
import type { Principle } from "./types.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SEKB-MVP", () => {
  it("stores trajectories and principles in shared SQLite and maintains a bounded active L1 index", () => {
    const store = createStore();
    const trajectoryId = randomUUID();
    store.save_trajectory({
      trajectory_id: trajectoryId,
      created_at: "2026-07-06T08:00:00.000Z",
      task_intent: "connect to PostgreSQL database",
      task_type: "config/db",
      context_fingerprint: ["postgresql", "node"],
      steps: [{ action: "inspect config", input: {}, output: {}, timestamp: "2026-07-06T08:00:01.000Z" }],
      outcome: "failure",
      error_signature: "ConnectionError::db_connection_refused::postgresql",
      cost: { tokens: 42, duration_seconds: 3, retries: 0 },
      distilled: false,
      distilled_into: [],
      expires_at: null,
      metadata: { source: "unit-test" },
    });

    const storedTrajectory = store.get_trajectory(trajectoryId);
    expect(storedTrajectory.task_intent).toBe("connect to PostgreSQL database");
    expect(store.query_trajectories({ task_type: "config/db", context_tags: ["postgresql"], outcome: "failure", distilled: false }))
      .toHaveLength(1);

    const principleId = store.save_principle(postgresPrinciple({ source_trajectories: [trajectoryId] }));
    const principle = store.get_principle(principleId);
    expect(principle.title).toBe("Check PG access");
    expect(principle.embedding).toBeNull();

    const index = store.get_index();
    expect(index).toContain("Check PG access");
    expect(index).toContain(principleId.slice(0, 8));
    expect(approxTokens(index)).toBeLessThanOrEqual(2_000);

    store.increment_retrieval_count(principleId);
    store.record_adoption(principleId, true);
    const counted = store.get_principle(principleId);
    expect(counted.retrieval_count).toBe(1);
    expect(counted.adoption_count).toBe(1);
    expect(counted.post_adoption_success).toBe(1);

    store.archive_principle(principleId);
    expect(store.get_index()).not.toContain("Check PG access");
  });

  it("captures a failed trajectory with compressed steps and cached deterministic error signatures", () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store, now: fixedClock() });
    const id = capture.start_trajectory("connect PostgreSQL", "config/db", ["postgresql"]);
    for (let step = 0; step < 55; step += 1) {
      capture.log_step(id, "tool.call", { step }, { ok: step < 54 });
    }

    const trajectory = capture.finish_trajectory(id, "failure", "could not connect to server: Connection refused (port 5432)");
    expect(trajectory.error_signature).toBe("ConnectionError::db_connection_refused::postgresql");
    expect(trajectory.steps).toHaveLength(11);
    expect(trajectory.steps[5]).toMatchObject({ action: "steps.compressed" });
    expect(store.get_trajectory(id).error_signature).toBe(trajectory.error_signature);

    const repeated = capture.extract_error_signature("could not connect to server: Connection refused (port 5432)");
    expect(repeated).toBe(trajectory.error_signature);
    expect(() => capture.finish_trajectory(capture.start_trajectory("bad", "config/db", []), "failure"))
      .toThrow(/raw_error/i);
  });

  it("retrieves advisory principles for similar tasks and error signatures", () => {
    const store = createStore();
    const principleId = store.save_principle(postgresPrinciple());
    store.save_principle({
      ...postgresPrinciple({ title: "Archive old notes", task_types: ["docs/write"], context_tags: ["markdown"] }),
      status: "archived",
    });

    const engine = new RetrievalEngine({ store });
    const taskMatches = engine.retrieve_for_task("configure database connection", "config/db", ["postgresql"], 5);
    expect(taskMatches.map((principle) => principle.principle_id)).toEqual([principleId]);
    expect(store.get_principle(principleId).retrieval_count).toBe(1);

    const errorMatches = engine.retrieve_for_error("ConnectionError::db_connection_refused::postgresql", ["postgresql"], 3);
    expect(errorMatches.map((principle) => principle.principle_id)).toEqual([principleId]);
    const formatted = engine.format_for_injection(errorMatches);
    expect(formatted).toContain("[Relevant SEKB principle 1] Check PG access");
    expect(formatted).toContain("Condition: When PostgreSQL reports Connection refused");
    expect(formatted).toContain("Action: Check pg_hba.conf and firewall rules");
    expect(formatted).toContain("Reason: Most connection refusals are environment");
    expect(formatted).not.toMatch(/[【】：]/u);

    const injector = engine.create_context_injector();
    expect(injector.for_task("system", "configure database connection", "config/db", ["postgresql"]))
      .toContain("Check PG access");
    expect(injector.for_error("ConnectionError::db_connection_refused::postgresql", ["postgresql"]))
      .toContain("[SEKB historical error advice]");
  });

  it("installs explicit SEKB harness hooks without blocking tool execution", async () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store, now: fixedClock() });
    const engine = new RetrievalEngine({ store });
    const target = createHookTarget();

    store.save_principle(postgresPrinciple());

    const uninstall = installSekbHarnessHooks(target, {
      enabled: true,
      capture,
      injector: engine.create_context_injector(),
      classifyTask: ({ prompt }) => ({
        task_intent: prompt,
        task_type: "config/db",
        context_tags: ["postgresql"],
      }),
    });

    const before = await target.emitHook("before_agent_start", {
      type: "before_agent_start",
      prompt: "configure database connection",
      systemPrompt: "system",
      resources: {},
    });
    expect(before?.systemPrompt).toContain("[Relevant SEKB principle 1]");

    await target.emitHook("tool_call", {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "shell",
      input: { command: "psql" },
    });
    const patch = await target.emitHook("tool_result", {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "shell",
      input: { command: "psql" },
      content: [{ type: "text", text: "could not connect to server: Connection refused (port 5432)" }],
      details: {},
      isError: true,
    });
    expect(patch?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("[SEKB historical error advice]"),
    });

    await target.emitEvent({ type: "agent_end", messages: [] });
    expect(store.query_trajectories({ task_type: "config/db", context_tags: ["postgresql"] }))
      .toHaveLength(1);
    uninstall();
  });

  it("adapts real OpenClaw plugin hook events into visible SEKB capture and advice", async () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store, now: fixedClock() });
    const engine = new RetrievalEngine({ store });
    const { target, runner, emitAdapterEvent } = createPluginHookHarness();

    store.save_principle(postgresPrinciple());

    const errors: unknown[] = [];
    const uninstall = installSekbHarnessHooks(target, {
      enabled: true,
      capture,
      injector: engine.create_context_injector(),
      classifyTask: ({ prompt }) => ({
        task_intent: prompt,
        task_type: "config/db",
        context_tags: ["postgresql"],
      }),
      onError: (error) => errors.push(error),
    });

    const before = await runner.runBeforeAgentStart(
      {
        prompt: "configure database connection",
        messages: [],
      },
      { runId: "run-failure" },
    );
    expect(before?.appendContext).toContain("[Relevant SEKB principle 1]");
    expect(before?.systemPrompt).toBeUndefined();

    const beforeTool = await runner.runBeforeToolCall(
      {
        toolName: "shell",
        params: { command: "psql" },
        runId: "run-failure",
        toolCallId: "call-1",
      },
      {
        toolName: "shell",
        runId: "run-failure",
        toolCallId: "call-1",
      },
    );
    expect(beforeTool?.block).not.toBe(true);

    const failedMessage = runner.runToolResultPersist(
      {
        toolName: "shell",
        toolCallId: "call-1",
        message: toolResultMessage({
          toolCallId: "call-1",
          toolName: "shell",
          text: "could not connect to server: Connection refused (port 5432)",
          isError: true,
        }),
      },
      {
        toolName: "shell",
        toolCallId: "call-1",
      },
    )?.message;
    expect(toolResultText(failedMessage)).toContain("[SEKB historical error advice]");

    await runner.runAgentEnd(
      {
        messages: failedMessage ? [failedMessage] : [],
        success: false,
        error: "could not connect to server: Connection refused (port 5432)",
        durationMs: 12,
      },
      { runId: "run-failure" },
    );

    const failedTrajectory = store.query_trajectories({
      task_type: "config/db",
      context_tags: ["postgresql"],
      outcome: "failure",
    })[0];
    expect(failedTrajectory?.error_signature).toBe(
      "ConnectionError::db_connection_refused::postgresql",
    );
    expect(failedTrajectory?.steps.map((step) => step.action)).toEqual([
      "tool.call",
      "tool.result",
    ]);

    await runner.runBeforeAgentStart(
      {
        prompt: "configure database connection",
        messages: [],
      },
      { runId: "run-success" },
    );
    await runner.runBeforeToolCall(
      {
        toolName: "shell",
        params: { command: "psql --version" },
        runId: "run-success",
        toolCallId: "call-2",
      },
      {
        toolName: "shell",
        runId: "run-success",
        toolCallId: "call-2",
      },
    );
    const successfulMessage = runner.runToolResultPersist(
      {
        toolName: "shell",
        toolCallId: "call-2",
        message: toolResultMessage({
          toolCallId: "call-2",
          toolName: "shell",
          text: "psql 16.0",
          isError: false,
        }),
      },
      {
        toolName: "shell",
        toolCallId: "call-2",
      },
    )?.message;
    expect(toolResultText(successfulMessage)).not.toContain("[SEKB historical error advice]");
    await runner.runAgentEnd(
      {
        messages: successfulMessage ? [successfulMessage] : [],
        success: true,
        durationMs: 7,
      },
      { runId: "run-success" },
    );

    await runner.runBeforeAgentStart(
      {
        prompt: "configure database connection",
        messages: [],
      },
      { runId: "run-abort" },
    );
    await emitAdapterEvent({ type: "abort" });

    expect(store.query_trajectories({ outcome: "success" })).toHaveLength(1);
    expect(store.query_trajectories({ outcome: "partial" })).toHaveLength(1);

    uninstall();

    const throwingHarness = createPluginHookHarness();
    const throwingUninstall = installSekbHarnessHooks(throwingHarness.target, {
      enabled: true,
      capture,
      injector: {
        for_task() {
          throw new Error("boom");
        },
        for_error() {
          throw new Error("boom");
        },
      },
      onError: (error) => errors.push(error),
    });
    const isolated = await throwingHarness.runner.runBeforeAgentStart(
      {
        prompt: "will not break the run",
        messages: [],
      },
      { runId: "run-isolated" },
    );
    expect(isolated).toBeUndefined();
    expect(errors).toHaveLength(1);

    throwingUninstall();
  });

  it("keeps distillation manual and marks trajectories only after confirmation", () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store, now: fixedClock() });
    const trajectoryId = capture.start_trajectory("connect PostgreSQL", "config/db", ["postgresql"]);
    capture.log_step(trajectoryId, "tool.call", "psql", "connection refused");
    capture.finish_trajectory(trajectoryId, "failure", "could not connect to server: Connection refused (port 5432)");

    const distiller = new DistillationTool({ store, now: fixedClock(new Date("2026-07-06T08:00:00.000Z")) });
    expect(distiller.suggest_principles_from_trajectories(null, 2)).toEqual([]);

    const principleId = distiller.confirm_and_save({
      cluster_summary: "PostgreSQL connection refused failures",
      source_trajectory_ids: [trajectoryId],
      suggested_principle: {
        title: "Check PG access",
        condition: "When PostgreSQL reports Connection refused",
        action: "Check pg_hba.conf and firewall rules, then verify the service is running",
        reason: "Most connection refusals are environment or configuration issues before code issues",
        task_types: ["config/db"],
        context_tags: ["postgresql"],
        criticality: "high",
      },
      confidence: 0.8,
    });

    expect(store.get_principle(principleId).created_by).toBe("human");
    const trajectory = store.get_trajectory(trajectoryId);
    expect(trajectory.distilled).toBe(true);
    expect(trajectory.distilled_into).toEqual([principleId]);
    expect(trajectory.expires_at).toBe("2026-10-04T08:00:00.000Z");

    distiller.reject_suggestion({
      cluster_summary: "too generic",
      source_trajectory_ids: [trajectoryId],
      suggested_principle: {},
      confidence: 0.1,
    }, "not actionable");
    expect(store.list_distillation_rejections()).toHaveLength(1);
  });

  it("builds a read-only SEKB operator report for manual distillation", () => {
    const store = createStore();
    const trajectoryId = randomUUID();
    store.save_trajectory({
      trajectory_id: trajectoryId,
      created_at: "2026-07-06T08:00:00.000Z",
      task_intent: "connect PostgreSQL",
      task_type: "config/db",
      context_fingerprint: ["postgresql"],
      steps: [],
      outcome: "failure",
      error_signature: "ConnectionError::db_connection_refused::postgresql",
      cost: { tokens: 0, duration_seconds: 1, retries: 0 },
      distilled: false,
      distilled_into: [],
      expires_at: null,
      metadata: {},
    });
    store.save_principle(postgresPrinciple({ source_trajectories: [trajectoryId] }));

    const report = buildSekbOperatorReport(store);
    expect(report.counts).toMatchObject({
      trajectories: 1,
      undistilledTrajectories: 1,
      activePrinciples: 1,
    });
    expect(report.undistilled[0]).toMatchObject({
      trajectory_id: trajectoryId,
      task_type: "config/db",
      outcome: "failure",
    });
    expect(report.indexPreview).toContain("Check PG access");
  });
});

function createStore(): KnowledgeStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-test-"));
  tempRoots.push(root);
  return new KnowledgeStore({ database: { path: path.join(root, "openclaw.sqlite") } });
}

function fixedClock(date = new Date("2026-07-06T08:00:00.000Z")): () => Date {
  return () => new Date(date);
}

function createHookTarget() {
  const hooks = new Map<string, Array<(event: unknown) => unknown>>();
  const subscribers: Array<(event: unknown) => unknown> = [];
  return {
    on(type: string, handler: (event: unknown) => unknown) {
      hooks.set(type, [...(hooks.get(type) ?? []), handler]);
      return () => hooks.set(type, (hooks.get(type) ?? []).filter((entry) => entry !== handler));
    },
    subscribe(listener: (event: unknown) => unknown) {
      subscribers.push(listener);
      return () => {
        const index = subscribers.indexOf(listener);
        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    },
    async emitHook(type: string, event: unknown) {
      let latest;
      for (const handler of hooks.get(type) ?? []) {
        latest = await handler(event);
      }
      return latest as { systemPrompt?: string; content?: Array<{ type: "text"; text: string }> } | undefined;
    },
    async emitEvent(event: unknown) {
      for (const listener of subscribers) {
        await listener(event);
      }
    },
  };
}

function createPluginHookHarness() {
  const registry: GlobalHookRunnerRegistry = {
    plugins: [{ id: "sekb-test", status: "loaded" }],
    hooks: [],
    typedHooks: [],
  };
  const subscribers: Array<(event: unknown) => unknown | Promise<unknown>> = [];
  const target = {
    on(type: string, handler: (event: unknown, context?: unknown) => unknown | Promise<unknown>) {
      const registration = {
        pluginId: "sekb-test",
        hookName: type as PluginHookName,
        handler,
        source: "unit-test",
      } as PluginHookRegistration;
      registry.typedHooks.push(registration);
      return () => {
        const index = registry.typedHooks.indexOf(registration);
        if (index >= 0) {
          registry.typedHooks.splice(index, 1);
        }
      };
    },
    subscribe(listener: (event: unknown) => unknown | Promise<unknown>) {
      subscribers.push(listener);
      return () => {
        const index = subscribers.indexOf(listener);
        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    },
  };
  const runner = createHookRunner(registry, {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  return {
    target,
    runner,
    async emitAdapterEvent(event: unknown) {
      for (const subscriber of subscribers) {
        await subscriber(event);
      }
    },
  };
}

function toolResultMessage(params: {
  toolCallId: string;
  toolName: string;
  text: string;
  isError: boolean;
}): Extract<AgentMessage, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    content: [{ type: "text", text: params.text }],
    details: {},
    isError: params.isError,
    timestamp: Date.parse("2026-07-06T08:00:00.000Z"),
  };
}

function toolResultText(message: AgentMessage | undefined): string {
  if (!message || message.role !== "toolResult") {
    return "";
  }
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function postgresPrinciple(overrides: Partial<Principle> = {}): Principle {
  const now = "2026-07-06T08:00:00.000Z";
  return {
    principle_id: overrides.principle_id ?? randomUUID(),
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    title: overrides.title ?? "Check PG access",
    condition: overrides.condition ?? "When PostgreSQL reports Connection refused",
    action: overrides.action ?? "Check pg_hba.conf and firewall rules, then verify the service is running",
    reason: overrides.reason ?? "Most connection refusals are environment or configuration issues before code issues",
    full_content: overrides.full_content ??
      "When PostgreSQL reports Connection refused, check pg_hba.conf and firewall rules, then verify the service is running because most connection refusals are environment or configuration issues before code issues.",
    task_types: overrides.task_types ?? ["config/db"],
    context_tags: overrides.context_tags ?? ["postgresql"],
    embedding: overrides.embedding ?? null,
    source_trajectories: overrides.source_trajectories ?? [],
    created_by: overrides.created_by ?? "human",
    status: overrides.status ?? "active",
    retrieval_count: overrides.retrieval_count ?? 0,
    adoption_count: overrides.adoption_count ?? 0,
    post_adoption_success: overrides.post_adoption_success ?? 0,
    criticality: overrides.criticality ?? "high",
    pinned: overrides.pinned ?? false,
    metadata: overrides.metadata ?? {},
  };
}

function approxTokens(value: string): number {
  return Math.ceil(value.length / 4);
}
