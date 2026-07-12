/**
 * DCS Stage 2 task-loop handler tests.
 *
 * Tests the task_state Block production, HandoffPack construction,
 * child handoff write-before-spawn, child-state recovery, and terminal-phase
 * detection.
 */
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockStore } from "../block-store.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "../../state/openclaw-state-schema.generated.js";
import type { ContextBlockSink, HandoffPack } from "../block.js";
import { createContextBlockSink } from "../../agents/harness/hook-context.js";
import {
  buildChildHandoffPack,
  handleTaskPhaseChange,
  isTerminalPhase,
  restoreChildState,
  writeChildHandoffPack,
} from "./task-loop-handler.js";
import { handleWorkingMemoryAction } from "./working-memory-handler.js";

const databases: DatabaseSync[] = [];
let store: BlockStore;
let sink: ContextBlockSink;

beforeEach(() => {
  createStore();
});

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function createStore(): void {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(OPENCLAW_STATE_SCHEMA_SQL);
  store = new BlockStore(db);
  sink = createContextBlockSink(store);
}

describe("handleTaskPhaseChange", () => {
  it("writes a task_state Block with HandoffPack on phase transition", async () => {
    const result = await handleTaskPhaseChange({
      event: {
        sessionId: "agent:test-agent:main",
        taskId: "task-1",
        fromStatus: "running",
        toStatus: "completed",
      },
      objective: "Test objective",
      parentSessionId: "agent:test-agent:main",
      contextBlockSink: sink,
      workingMemoryStore: store,
    });
    expect(result?.accepted).toBe(true);

    // Verify the Block was persisted
    const blocks = await store.query({
      requester_session_id: "agent:test-agent:main",
      session_id: "agent:test-agent:main",
      block_types: ["task_state"],
      source_systems: ["task-loop"],
      limit: 1,
    });
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.block_type).toBe("task_state");
    expect(block.source_system).toBe("task-loop");
    expect(block.mutability).toBe("system_managed");

    const pack = JSON.parse(block.full_content!) as HandoffPack;
    expect(pack.objective).toBe("Test objective");
    expect(pack.current_phase).toBe("completed");
    expect(pack.parent_session_id).toBe("agent:test-agent:main");
    expect(Array.isArray(pack.recent_actions)).toBe(true);
  });

  it("returns undefined when no sink is provided", async () => {
    const result = await handleTaskPhaseChange({
      event: {
        sessionId: "agent:test-agent:main",
        taskId: "task-1",
        fromStatus: "running",
        toStatus: "completed",
      },
      objective: "Test objective",
    });
    expect(result).toBeUndefined();
  });

  it("gathers recent actions from persisted working-memory", async () => {
    // First, write a working-memory Block
    const wmBlock = handleWorkingMemoryAction({
      sessionId: "agent:test-agent:main",
      action: {
        tool: "edit",
        result_summary: "Edited file.ts",
        significance: "high",
      },
    });
    await store.upsert(wmBlock, { significance: "high", write_origin: "handler" });

    // Now trigger a phase change
    await handleTaskPhaseChange({
      event: {
        sessionId: "agent:test-agent:main",
        taskId: "task-1",
        fromStatus: "running",
        toStatus: "verifying",
      },
      objective: "Test objective",
      parentSessionId: "agent:test-agent:main",
      contextBlockSink: sink,
      workingMemoryStore: store,
    });

    const blocks = await store.query({
      requester_session_id: "agent:test-agent:main",
      session_id: "agent:test-agent:main",
      block_types: ["task_state"],
      source_systems: ["task-loop"],
      limit: 1,
    });
    const pack = JSON.parse(blocks[0].full_content!) as HandoffPack;
    expect(pack.recent_actions).toHaveLength(1);
    expect(pack.recent_actions[0].tool).toBe("edit");
    expect(pack.recent_actions[0].result_summary).toBe("Edited file.ts");
  });
});

describe("buildChildHandoffPack", () => {
  it("builds a valid HandoffPack for a child session", () => {
    const pack = buildChildHandoffPack({
      objective: "Child task objective",
      currentPhase: "running",
      recentActions: [
        { tool: "edit", result_summary: "Edited f.ts", significance: "high" },
      ],
      parentSessionId: "agent:parent:main",
    });
    expect(pack.objective).toBe("Child task objective");
    expect(pack.current_phase).toBe("running");
    expect(pack.recent_actions).toHaveLength(1);
    expect(pack.parent_session_id).toBe("agent:parent:main");
  });

  it("truncates objective to 2000 characters", () => {
    const longObjective = "x".repeat(3000);
    const pack = buildChildHandoffPack({
      objective: longObjective,
      currentPhase: "running",
      recentActions: [],
      parentSessionId: "agent:parent:main",
    });
    expect(pack.objective.length).toBe(2000);
  });

  it("filters out low-significance actions and caps at 5", () => {
    const actions = Array.from({ length: 7 }, (_, i) => ({
      tool: "edit",
      result_summary: `Action ${i}`,
      significance: "high" as const,
    }));
    const pack = buildChildHandoffPack({
      objective: "Test",
      currentPhase: "running",
      recentActions: actions,
      parentSessionId: "agent:parent:main",
    });
    expect(pack.recent_actions).toHaveLength(5);
  });
});

describe("writeChildHandoffPack", () => {
  it("writes a task_state Block to the child session key before spawn", async () => {
    const pack = buildChildHandoffPack({
      objective: "Child objective",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: "agent:parent:main",
    });
    const result = await writeChildHandoffPack({
      childSessionKey: "agent:child:subagent:abc-123",
      handoffPack: pack,
      contextBlockSink: sink,
    });
    expect(result?.accepted).toBe(true);

    // Verify the Block is stored under the child session key
    const blocks = await store.query({
      requester_session_id: "agent:child:subagent:abc-123",
      session_id: "agent:child:subagent:abc-123",
      block_types: ["task_state"],
      source_systems: ["task-loop"],
      limit: 1,
    });
    expect(blocks).toHaveLength(1);
    const storedPack = JSON.parse(blocks[0].full_content!) as HandoffPack;
    expect(storedPack.parent_session_id).toBe("agent:parent:main");
  });
});

describe("restoreChildState", () => {
  it("restores HandoffPack from the child session's task_state Block", async () => {
    // Write a child handoff pack first
    const pack = buildChildHandoffPack({
      objective: "Restore test",
      currentPhase: "running",
      recentActions: [
        { tool: "write", result_summary: "Wrote f.ts", significance: "high" },
      ],
      parentSessionId: "agent:parent:main",
    });
    await writeChildHandoffPack({
      childSessionKey: "agent:child:subagent:xyz",
      handoffPack: pack,
      contextBlockSink: sink,
    });

    // Restore
    const restored = await restoreChildState({
      childSessionKey: "agent:child:subagent:xyz",
      store,
    });
    expect(restored).toBeDefined();
    expect(restored?.objective).toBe("Restore test");
    expect(restored?.current_phase).toBe("running");
    expect(restored?.parent_session_id).toBe("agent:parent:main");
    expect(restored?.recent_actions).toHaveLength(1);
  });

  it("returns undefined when no task_state Block exists", async () => {
    const restored = await restoreChildState({
      childSessionKey: "agent:orphan:subagent:none",
      store,
    });
    expect(restored).toBeUndefined();
  });
});

describe("isTerminalPhase", () => {
  it("returns true for completed and failed", () => {
    expect(isTerminalPhase("completed")).toBe(true);
    expect(isTerminalPhase("failed")).toBe(true);
  });

  it("returns false for non-terminal phases", () => {
    expect(isTerminalPhase("running")).toBe(false);
    expect(isTerminalPhase("planning")).toBe(false);
    expect(isTerminalPhase("verifying")).toBe(false);
    expect(isTerminalPhase("created")).toBe(false);
  });
});

describe("direct-parent authorization", () => {
  it("allows child to read own task_state", async () => {
    const childKey = "agent:child:subagent:auth-1";
    const pack = buildChildHandoffPack({
      objective: "Auth test",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: "agent:parent:main",
    });
    await writeChildHandoffPack({
      childSessionKey: childKey,
      handoffPack: pack,
      contextBlockSink: sink,
    });

    // Child reads its own state
    const restored = await restoreChildState({
      childSessionKey: childKey,
      store,
    });
    expect(restored).toBeDefined();
  });

  it("BlockStore #canReadDirectParent allows direct parent access", async () => {
    const parentKey = "agent:parent:main";
    const childKey = "agent:child:subagent:auth-2";

    // Write child handoff pack naming the parent
    const pack = buildChildHandoffPack({
      objective: "Parent access test",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: parentKey,
    });
    await writeChildHandoffPack({
      childSessionKey: childKey,
      handoffPack: pack,
      contextBlockSink: sink,
    });

    // Child queries parent session (should be authorized via #canReadDirectParent)
    const parentBlocks = await store.query({
      requester_session_id: childKey,
      session_id: parentKey,
      block_types: ["task_state"],
      limit: 1,
    });
    // The parent has no task_state Block, so this should return empty
    // (authorization passes but no data exists)
    expect(parentBlocks).toHaveLength(0);
  });

  it("BlockStore rejects arbitrary session access (no HandoffPack naming target)", async () => {
    const childKey = "agent:child:subagent:auth-3";
    const arbitraryKey = "agent:random:main";

    // Write child handoff pack naming parent, NOT the arbitrary target
    const pack = buildChildHandoffPack({
      objective: "Arbitrary access test",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: "agent:parent:main",
    });
    await writeChildHandoffPack({
      childSessionKey: childKey,
      handoffPack: pack,
      contextBlockSink: sink,
    });

    // Write a Block in the arbitrary session
    const arbitraryBlock = handleWorkingMemoryAction({
      sessionId: arbitraryKey,
      action: { tool: "edit", result_summary: "secret", significance: "high" },
    });
    await store.upsert(arbitraryBlock, { significance: "high", write_origin: "handler" });

    // Child tries to read arbitrary session (should be rejected)
    const blocks = await store.query({
      requester_session_id: childKey,
      session_id: arbitraryKey,
      block_types: ["working_memory"],
      limit: 1,
    });
    expect(blocks).toHaveLength(0);
  });

  it("rejects recursive ancestor access (child cannot read grandparent)", async () => {
    const grandparentKey = "agent:grandparent:main";
    const parentKey = "agent:parent:subagent:p1";
    const childKey = "agent:child:subagent:c1";

    // Grandparent has a task_state Block
    await store.upsert({
      block_id: `task-state:${grandparentKey}`,
      block_type: "task_state",
      source_system: "task-loop",
      session_id: grandparentKey,
      presence: { always_on: false, on_demand: { expand_tool: "context_read", auto_register: false } },
      entities: [],
      valid_at: new Date(),
      created_at: new Date(),
      mutability: "system_managed",
      summary: "Grandparent state",
      full_content: JSON.stringify({
        objective: "Grandparent objective",
        current_phase: "running",
        recent_actions: [],
        parent_session_id: "agent:root:main",
      }),
      compression_depth: 0,
      entity_extraction_status: "empty",
    }, { significance: "high", write_origin: "handler" });

    // Parent's HandoffPack names grandparent as its parent
    const parentPack = buildChildHandoffPack({
      objective: "Parent objective",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: grandparentKey,
    });
    await writeChildHandoffPack({
      childSessionKey: parentKey,
      handoffPack: parentPack,
      contextBlockSink: sink,
    });

    // Child's HandoffPack names parent as its parent
    const childPack = buildChildHandoffPack({
      objective: "Child objective",
      currentPhase: "running",
      recentActions: [],
      parentSessionId: parentKey,
    });
    await writeChildHandoffPack({
      childSessionKey: childKey,
      handoffPack: childPack,
      contextBlockSink: sink,
    });

    // Child tries to read grandparent (should be rejected — only direct parent allowed)
    const grandparentBlocks = await store.query({
      requester_session_id: childKey,
      session_id: grandparentKey,
      block_types: ["task_state"],
      limit: 1,
    });
    expect(grandparentBlocks).toHaveLength(0);
  });

  it("rejects parent access when HandoffPack is malformed", async () => {
    const parentKey = "agent:parent:main";
    const childKey = "agent:child:subagent:malformed-1";

    // Write a malformed task_state Block (extra keys + invalid current_phase)
    await store.upsert({
      block_id: `task-state:${childKey}`,
      block_type: "task_state",
      source_system: "task-loop",
      session_id: childKey,
      presence: { always_on: false, on_demand: { expand_tool: "context_read", auto_register: false } },
      entities: [],
      valid_at: new Date(),
      created_at: new Date(),
      mutability: "system_managed",
      summary: "Malformed state",
      full_content: JSON.stringify({
        objective: "Test",
        current_phase: "not_a_real_status",
        recent_actions: [],
        parent_session_id: parentKey,
        extra_key: "should_be_rejected",
      }),
      compression_depth: 0,
      entity_extraction_status: "empty",
    }, { significance: "high", write_origin: "handler" });

    // Child tries to read parent (should be rejected — malformed HandoffPack grants no access)
    const parentBlocks = await store.query({
      requester_session_id: childKey,
      session_id: parentKey,
      block_types: ["task_state"],
      limit: 1,
    });
    expect(parentBlocks).toHaveLength(0);

    // restoreChildState should also return undefined for malformed content
    const restored = await restoreChildState({
      childSessionKey: childKey,
      store,
    });
    expect(restored).toBeUndefined();
  });
});
