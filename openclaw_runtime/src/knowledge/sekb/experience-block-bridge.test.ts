import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextBlockSink } from "../../context-engine/block.js";
import {
  buildExperienceBlock,
  handleConfirmAndSave,
} from "./experience-block-bridge.js";
import { DistillationTool } from "./distillation-tool.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DistillationSuggestion, Principle } from "./types.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makePrinciple(overrides: Partial<Principle> = {}): Principle {
  return {
    principle_id: "principle-001",
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z",
    title: "Check PG access",
    condition: "When connecting to PostgreSQL",
    action: "Verify connection string first",
    reason: "Connection failures often stem from access config",
    full_content:
      "When connecting to PostgreSQL, Verify connection string first because Connection failures often stem from access config.",
    task_types: ["config/db"],
    context_tags: ["postgresql", "node"],
    embedding: null,
    source_trajectories: ["traj-001"],
    created_by: "human",
    status: "active",
    retrieval_count: 0,
    adoption_count: 0,
    post_adoption_success: 0,
    criticality: "medium",
    pinned: false,
    metadata: {},
    ...overrides,
  };
}

function makeSuggestion(
  overrides: Partial<DistillationSuggestion> = {},
): DistillationSuggestion {
  return {
    cluster_summary: "Similar config/db trajectories (2)",
    source_trajectory_ids: ["traj-001", "traj-002"],
    suggested_principle: {
      title: "Check PG access",
      task_types: ["config/db"],
      context_tags: ["postgresql", "node"],
      criticality: "medium",
    },
    confidence: 0.85,
    ...overrides,
  };
}

describe("DCS Stage 5 experience-block-bridge", () => {
  describe("buildExperienceBlock", () => {
    it("constructs an experience Block with spec-mandated fields", () => {
      const block = buildExperienceBlock({
        principle: makePrinciple(),
        suggestion: makeSuggestion(),
        sessionId: "agent:alpha:main",
        now: new Date("2026-07-12T00:00:00.000Z"),
      });

      expect(block.block_type).toBe("experience");
      expect(block.source_system).toBe("sekb");
      expect(block.session_id).toBe("agent:alpha:main");
      expect(block.mutability).toBe("system_managed");
      expect(block.compression_depth).toBe(0);
      expect(block.entity_extraction_status).toBe("empty");
    });

    it("presence follows the spec: always_on=false, on_demand expand_tool=context_search, background=true", () => {
      const block = buildExperienceBlock({
        principle: makePrinciple(),
        suggestion: makeSuggestion(),
        sessionId: "session-a",
      });

      expect(block.presence).toEqual({
        always_on: false,
        on_demand: { expand_tool: "context_search", auto_register: false },
        background: true,
      });
    });

    it("full_content is the principle's full_content", () => {
      const principle = makePrinciple({ full_content: "Custom principle content" });
      const block = buildExperienceBlock({
        principle,
        suggestion: makeSuggestion(),
        sessionId: "session-a",
      });

      expect(block.full_content).toBe("Custom principle content");
    });

    it("entities are task_types + context_tags", () => {
      const principle = makePrinciple({
        task_types: ["config/db", "debugging"],
        context_tags: ["postgresql", "node"],
      });
      const block = buildExperienceBlock({
        principle,
        suggestion: makeSuggestion(),
        sessionId: "session-a",
      });

      expect(block.entities).toEqual(
        expect.arrayContaining(["config/db", "debugging", "postgresql", "node"]),
      );
    });

    it("summary follows the spec format", () => {
      const principle = makePrinciple({ title: "Check PG access" });
      const block = buildExperienceBlock({
        principle,
        suggestion: makeSuggestion(),
        sessionId: "session-a",
      });

      expect(block.summary).toBe("## Experience\nCheck PG access");
    });

    it("block_id is deterministic for session + principle", () => {
      const block = buildExperienceBlock({
        principle: makePrinciple({ principle_id: "principle-001" }),
        suggestion: makeSuggestion(),
        sessionId: "agent:alpha:main",
      });

      expect(block.block_id).toBe(
        "experience:sekb:agent:alpha:main:principle-001",
      );
    });
  });

  describe("handleConfirmAndSave", () => {
    it("returns undefined when no sink is provided", async () => {
      const result = await handleConfirmAndSave({
        principle: makePrinciple(),
        suggestion: makeSuggestion(),
        sessionId: "session-a",
        contextBlockSink: undefined,
      });
      expect(result).toBeUndefined();
    });

    it("writes an experience Block through the sink with confirmed=true and confidence", async () => {
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const suggestion = makeSuggestion({ confidence: 0.85 });
      const result = await handleConfirmAndSave({
        principle: makePrinciple(),
        suggestion,
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      expect(result).toEqual({ accepted: true });
      expect(sink).toHaveBeenCalledTimes(1);
      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { block_type: string; source_system: string };
        admission: {
          confirmed: boolean;
          confidence: number;
          write_origin: string;
        };
      }>;
      expect(writeArg[0].block.block_type).toBe("experience");
      expect(writeArg[0].block.source_system).toBe("sekb");
      expect(writeArg[0].admission).toEqual({
        confirmed: true,
        confidence: 0.85,
        write_origin: "handler",
      });
    });

    it("propagates accepted=false when BlockStore rejects", async () => {
      const sink: ContextBlockSink = vi.fn(async () => [
        { accepted: false, reason: "experience_requires_confirmation" },
      ]);
      const result = await handleConfirmAndSave({
        principle: makePrinciple(),
        suggestion: makeSuggestion(),
        sessionId: "session-a",
        contextBlockSink: sink,
      });

      expect(result).toEqual({ accepted: false });
    });
  });

  describe("ANTI-8: suggest_principles_from_trajectories must NOT write Blocks", () => {
    it("advisory results never invoke ContextBlockSink", () => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), "openclaw-sekb-anti8-"),
      );
      tempRoots.push(root);
      const store = new KnowledgeStore({
        database: { path: path.join(root, "openclaw.sqlite") },
      });

      const trajectoryId = "traj-anti-8";
      store.save_trajectory({
        trajectory_id: trajectoryId,
        created_at: "2026-07-12T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });
      store.save_trajectory({
        trajectory_id: "traj-anti-8-b",
        created_at: "2026-07-12T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });

      const tool = new DistillationTool({ store });
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );

      // Advisory path: suggest_principles_from_trajectories does NOT accept a sink
      // and must not write any Block. Only confirm_and_save writes experience Blocks.
      const suggestions = tool.suggest_principles_from_trajectories();

      expect(suggestions.length).toBeGreaterThan(0);
      // The sink was never invoked because suggest_principles_from_trajectories
      // has no sink parameter and no code path to ContextBlockSink.
      expect(sink).not.toHaveBeenCalled();
    });
  });

  describe("confirm_and_save integration with ContextBlockSink", () => {
    it("writes an experience Block through the sink when sink + sessionId are provided", async () => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), "openclaw-sekb-integ-"),
      );
      tempRoots.push(root);
      const store = new KnowledgeStore({
        database: { path: path.join(root, "openclaw.sqlite") },
      });
      // Seed the trajectories that confirm_and_save will mark as distilled.
      for (const id of ["traj-001", "traj-002"]) {
        store.save_trajectory({
          trajectory_id: id,
          created_at: "2026-07-12T00:00:00.000Z",
          task_intent: "connect to PostgreSQL",
          task_type: "config/db",
          context_fingerprint: ["postgresql"],
          steps: [],
          outcome: "failure",
          error_signature: null,
          cost: { tokens: 10, duration_seconds: 1, retries: 0 },
          distilled: false,
          distilled_into: [],
          expires_at: null,
          metadata: {},
        });
      }

      const tool = new DistillationTool({ store });
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const suggestion = makeSuggestion({ confidence: 0.9 });

      const principleId = tool.confirm_and_save(suggestion, null, {
        contextBlockSink: sink,
        sessionId: "session-integ",
      });

      // confirm_and_save returns synchronously; the sink call is fire-and-forget.
      expect(typeof principleId).toBe("string");
      expect(principleId.length).toBeGreaterThan(0);
      // Wait for the fire-and-forget promise to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sink).toHaveBeenCalledTimes(1);
      const writeArg = (sink as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        block: { block_type: string; source_system: string; session_id: string };
        admission: {
          confirmed: boolean;
          confidence: number;
          write_origin: string;
        };
      }>;
      expect(writeArg[0].block.block_type).toBe("experience");
      expect(writeArg[0].block.source_system).toBe("sekb");
      expect(writeArg[0].block.session_id).toBe("session-integ");
      expect(writeArg[0].admission).toEqual({
        confirmed: true,
        confidence: 0.9,
        write_origin: "handler",
      });
    });

    it("does NOT invoke sink when sessionId is missing (defensive guard)", async () => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), "openclaw-sekb-nosession-"),
      );
      tempRoots.push(root);
      const store = new KnowledgeStore({
        database: { path: path.join(root, "openclaw.sqlite") },
      });
      store.save_trajectory({
        trajectory_id: "traj-nosession",
        created_at: "2026-07-12T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });

      const tool = new DistillationTool({ store });
      const sink: ContextBlockSink = vi.fn(async (writes) =>
        writes.map(() => ({ accepted: true })),
      );
      const suggestion = makeSuggestion({
        source_trajectory_ids: ["traj-nosession"],
      });

      tool.confirm_and_save(suggestion, null, { contextBlockSink: sink });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sink).not.toHaveBeenCalled();
    });

    it("best-effort: returns principleId even when sink throws synchronously", async () => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), "openclaw-sekb-throw-"),
      );
      tempRoots.push(root);
      const store = new KnowledgeStore({
        database: { path: path.join(root, "openclaw.sqlite") },
      });
      store.save_trajectory({
        trajectory_id: "traj-throw",
        created_at: "2026-07-12T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });

      const tool = new DistillationTool({ store });
      const throwingSink: ContextBlockSink = vi.fn(async () => {
        throw new Error("BlockStore unavailable");
      });
      const suggestion = makeSuggestion({
        source_trajectory_ids: ["traj-throw"],
      });

      const principleId = tool.confirm_and_save(suggestion, null, {
        contextBlockSink: throwingSink,
        sessionId: "session-throw",
      });

      // The SEKB save must succeed even if the sink throws.
      expect(typeof principleId).toBe("string");
      expect(principleId.length).toBeGreaterThan(0);
      // Principle is persisted in the SEKB store.
      expect(store.get_principle(principleId)).toBeDefined();
      // Wait for the fire-and-forget catch to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(throwingSink).toHaveBeenCalledTimes(1);
    });

    it("best-effort: returns principleId even when sink rejects (accepted=false)", async () => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), "openclaw-sekb-reject-"),
      );
      tempRoots.push(root);
      const store = new KnowledgeStore({
        database: { path: path.join(root, "openclaw.sqlite") },
      });
      store.save_trajectory({
        trajectory_id: "traj-reject",
        created_at: "2026-07-12T00:00:00.000Z",
        task_intent: "connect to PostgreSQL",
        task_type: "config/db",
        context_fingerprint: ["postgresql"],
        steps: [],
        outcome: "failure",
        error_signature: null,
        cost: { tokens: 10, duration_seconds: 1, retries: 0 },
        distilled: false,
        distilled_into: [],
        expires_at: null,
        metadata: {},
      });

      const tool = new DistillationTool({ store });
      const rejectingSink: ContextBlockSink = vi.fn(async () => [
        { accepted: false, reason: "experience_requires_confirmation" },
      ]);
      const suggestion = makeSuggestion({
        source_trajectory_ids: ["traj-reject"],
      });

      const principleId = tool.confirm_and_save(suggestion, null, {
        contextBlockSink: rejectingSink,
        sessionId: "session-reject",
      });

      expect(typeof principleId).toBe("string");
      expect(principleId.length).toBeGreaterThan(0);
      expect(store.get_principle(principleId)).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejectingSink).toHaveBeenCalledTimes(1);
    });
  });
});
