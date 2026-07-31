// @vitest-environment node
/**
 * TF-0002: production paths must use the single Context Orchestrator entry.
 * Low-level injectors remain internal; agent gateway + embedded attempt must
 * not call them directly.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

function productionTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = resolve(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(resolve(root, dir));
  return files;
}

describe("TF-0002 context orchestrator production entry scan", () => {
  it("embedded attempt imports orchestrator and not low-level compute*", () => {
    const src = read("openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts");
    expect(src).toMatch(/computeContextExtraSystemPrompt/);
    expect(src).toMatch(/context-orchestrator/);
    expect(src).not.toMatch(/computeVtokenExtraSystemPrompt/);
    expect(src).not.toMatch(/computeMemoryExtraSystemPrompt/);
  });

  it("gateway agent does not call low-level memory/vtoken injectors", () => {
    const src = read("openclaw_runtime/src/gateway/server-methods/agent.ts");
    expect(src).not.toMatch(/computeMemoryExtraSystemPrompt/);
    expect(src).not.toMatch(/computeVtokenExtraSystemPrompt/);
    expect(src).not.toMatch(/chat-turn-memory-injection/);
    expect(src).not.toMatch(/chat-turn-vtoken-injection/);
  });

  it("orchestrator is the only production composer of both stages", () => {
    const src = read("openclaw_runtime/src/context-engine/context-orchestrator.ts");
    expect(src).toMatch(/computeMemoryExtraSystemPrompt/);
    expect(src).toMatch(/computeVtokenExtraSystemPrompt/);
    expect(src).toMatch(/export async function computeContextExtraSystemPrompt/);
  });

  it("CVK systemPromptAddition is kill-switch gated in embedded attempt", () => {
    const src = read("openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts");
    expect(src).toMatch(/isContextEnhancementKillSwitchEngaged/);
    expect(src).toMatch(/contextEnhancementKilled/);
    expect(src).toMatch(/skipped assembly \(enhancement kill switch\)/);
  });

  it("production sources collect before one final Context Orchestrator projection", () => {
    const attempt = read("openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts");
    const compact = read("openclaw_runtime/src/agents/embedded-agent-runner/compact.ts");
    const extensions = read("openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts");
    expect(attempt).toMatch(/deferProjection:\s*true/);
    expect(attempt).toMatch(/collectContextOrchestratorCandidate/);
    expect(attempt).toMatch(/memoryEntriesFactory/);
    expect(attempt).not.toMatch(/reserveTurnInjectionCapacity/);
    expect(attempt).not.toMatch(/chargeTurnInjection/);
    expect(extensions).toMatch(/deferProjection:\s*true/);
    expect(extensions).toMatch(/finalizeContextOrchestratorTurn/);
    expect(extensions).toMatch(/before_agent_start/);
    expect(compact).toMatch(/injectionTurnId/);
    expect(compact).toMatch(/endContextOrchestratorTurn/);
    expect(compact).toMatch(/endTurnInjectionBudget/);

    for (const file of productionTypeScriptFiles("openclaw_runtime/src")) {
      if (
        file.endsWith("context-candidate.ts") ||
        file.endsWith("context-orchestrator.ts")
      ) {
        continue;
      }
      expect(readFileSync(file, "utf8"), file).not.toMatch(/projectContextCandidates/);
    }
  });

  it("no unattended SEKB auto-writeback workers in knowledge/sekb", () => {
    const files = productionTypeScriptFiles("openclaw_runtime/src/knowledge/sekb");
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/setInterval\s*\([^)]*writeback/i);
      expect(src, file).not.toMatch(/autoWriteback\s*=\s*true/);
      expect(src, file).not.toMatch(/enableAutoWriteback\s*\(/);
    }
  });

});
