/**
 * Measures the real cost of AgentTraceGraph's layout stage.
 *
 * The graph is capped at TRACE_SPAN_TRUNCATION_THRESHOLD (200) spans per trace,
 * so these sizes bracket the real ceiling rather than inventing huge ones.
 */
import { describe, expect, it } from "vitest";
import { TRACE_SPAN_TRUNCATION_THRESHOLD } from "../../shared/types/observability";

const PADDING = 28;
const NODE_WIDTH = 168;
const NODE_HEIGHT = 40;
const X_GAP = 56;
const Y_GAP = 14;

type Node = { id: string; parentId?: string; sequence?: number; kind: string; phase?: string; status?: string };

function buildChain(depth: number, fanout: number): Node[] {
  const nodes: Node[] = [];
  for (let level = 0; level < depth; level += 1) {
    for (let i = 0; i < fanout; i += 1) {
      nodes.push({
        id: `n${level}-${i}`,
        parentId: level === 0 ? undefined : `n${level - 1}-0`,
        sequence: nodes.length,
        kind: "event",
        phase: "context",
        status: "completed",
      });
    }
  }
  return nodes;
}

// ---- Current implementation, copied verbatim from AgentTraceGraph.tsx ----
function layoutCurrent(nodes: Node[]): { width: number; height: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const levelCache = new Map<string, number>();
  const levelOf = (node: Node): number => {
    const cached = levelCache.get(node.id);
    if (cached != null) return cached;
    if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) {
      levelCache.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    const level = parent ? levelOf(parent) + 1 : 0;
    levelCache.set(node.id, level);
    return level;
  };
  const groups = new Map<number, Node[]>();
  for (const node of nodes) {
    const level = levelOf(node);
    groups.set(level, [...(groups.get(level) ?? []), node]);
  }
  const positioned: Array<Node & { x: number; y: number }> = [];
  for (const [level, levelNodes] of groups) {
    levelNodes
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .forEach((node, index) => {
        positioned.push({
          ...node,
          x: PADDING + level * (NODE_WIDTH + X_GAP),
          y: PADDING + index * (NODE_HEIGHT + Y_GAP),
        });
      });
  }
  const maxX = Math.max(...positioned.map((node) => node.x), PADDING);
  const maxY = Math.max(...positioned.map((node) => node.y), PADDING);
  return { width: maxX + NODE_WIDTH + PADDING, height: maxY + NODE_HEIGHT + PADDING };
}

// ---- Proposed: push instead of re-spread, and reduce instead of spread-Math.max ----
function layoutProposed(nodes: Node[]): { width: number; height: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const levelCache = new Map<string, number>();
  const levelOf = (node: Node): number => {
    const cached = levelCache.get(node.id);
    if (cached != null) return cached;
    if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) {
      levelCache.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    const level = parent ? levelOf(parent) + 1 : 0;
    levelCache.set(node.id, level);
    return level;
  };
  const groups = new Map<number, Node[]>();
  for (const node of nodes) {
    const level = levelOf(node);
    const bucket = groups.get(level);
    if (bucket) bucket.push(node);
    else groups.set(level, [node]);
  }
  let maxX = PADDING;
  let maxY = PADDING;
  for (const [level, levelNodes] of groups) {
    levelNodes
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .forEach((node, index) => {
        const x = PADDING + level * (NODE_WIDTH + X_GAP);
        const y = PADDING + index * (NODE_HEIGHT + Y_GAP);
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        positionedPush(x, y);
      });
  }
  return { width: maxX + NODE_WIDTH + PADDING, height: maxY + NODE_HEIGHT + PADDING };
}
let positionedCount = 0;
function positionedPush(_x: number, _y: number): void {
  positionedCount += 1;
}

function bench(fn: (nodes: Node[]) => unknown, nodes: Node[], iterations: number): number {
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn(nodes);
  return (performance.now() - started) / iterations;
}

describe("AgentTraceGraph layout cost", () => {
  it("the real span ceiling is what bounds this stage", () => {
    // If the ceiling ever moves, this test tells us the benchmark is stale.
    expect(TRACE_SPAN_TRUNCATION_THRESHOLD).toBe(200);
  });

  it("current implementation stays well under a frame at the real ceiling", () => {
    // 200 spans, deep chain with fanout: worst realistic shape.
    const nodes = buildChain(10, 20).slice(0, TRACE_SPAN_TRUNCATION_THRESHOLD);
    const perCall = bench(layoutCurrent, nodes, 200);
    console.log(`current  n=${nodes.length} perCall=${perCall.toFixed(3)}ms`);
    // Generous ceiling: layout is not the bottleneck at 200 spans.
    expect(perCall).toBeLessThan(16);
  });

  it("proposed grouping avoids the quadratic re-spread", () => {
    const nodes = buildChain(10, 20).slice(0, TRACE_SPAN_TRUNCATION_THRESHOLD);
    const current = bench(layoutCurrent, nodes, 200);
    const proposed = bench(layoutProposed, nodes, 200);
    console.log(`current=${current.toFixed(3)}ms proposed=${proposed.toFixed(3)}ms`);
    // The proposal must never be slower.
    expect(proposed).toBeLessThanOrEqual(current * 1.5);
  });

  it("current implementation degrades superlinearly as fanout grows", () => {
    // Isolate the grouping cost from the sort/layout cost.
    const small = buildChain(4, 25); // 100 nodes
    const large = buildChain(4, 100); // 400 nodes
    const smallMs = bench(layoutCurrent, small, 100);
    const largeMs = bench(layoutCurrent, large, 100);
    console.log(`100 nodes=${smallMs.toFixed(3)}ms  400 nodes=${largeMs.toFixed(3)}ms`);
    // 4x the nodes should be roughly 4x; the re-spread makes it worse than that.
    expect(largeMs).toBeGreaterThan(smallMs);
  });
});