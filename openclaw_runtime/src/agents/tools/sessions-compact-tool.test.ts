import { describe, expect, it, vi } from "vitest";
import {
  type ManualCompactionRequest,
  registerManualCompactionRequest,
} from "../manual-compaction-request.js";
import { createOpenClawTools } from "../openclaw-tools.js";
import { DEFAULT_TOOL_ALLOW } from "../sandbox/constants.js";
import { buildAgentSystemPrompt } from "../system-prompt.js";
import { resolveCoreToolProfiles } from "../tool-catalog.js";
import { resolveToolDisplay } from "../tool-display.js";
import { isLikelyMutatingToolName, isMutatingToolCall } from "../tool-mutation.js";
import { createSessionsCompactTool } from "./sessions-compact-tool.js";

function resultDetails(
  result: Awaited<ReturnType<ReturnType<typeof createSessionsCompactTool>["execute"]>>,
) {
  return result.details as Record<string, unknown>;
}

describe("sessions_compact tool", () => {
  it("exposes only optional instructions and no target session selector", () => {
    const tool = createSessionsCompactTool();
    const schema = tool.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(schema.properties ?? {})).toEqual(["customInstructions"]);
    expect(schema.required ?? []).toEqual([]);
    expect(resolveCoreToolProfiles("sessions_compact")).toEqual(["coding", "messaging"]);
    expect(DEFAULT_TOOL_ALLOW).toContain("sessions_compact");
    expect(isLikelyMutatingToolName("sessions_compact")).toBe(true);
    expect(isMutatingToolCall("sessions_compact", {})).toBe(true);
    expect(resolveToolDisplay({ name: "sessions_compact" }).title).toBe("Compact Session");

    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/workspace",
      toolNames: ["sessions_list", "sessions_compact"],
    });
    const compactLine =
      "- sessions_compact: Compact this current session after the active turn finishes; cannot target other sessions";
    expect(prompt).toContain(compactLine);
    expect(prompt.indexOf(compactLine)).toBeLessThan(prompt.indexOf("- sessions_list:"));
  });

  it("rejects use without a bound current session", async () => {
    const onRequest = vi.fn();
    const tool = createSessionsCompactTool({ onRequest });

    const result = await tool.execute("call-1", {});

    expect(resultDetails(result)).toMatchObject({
      status: "error",
      error: "No current session context",
    });
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("is published only when the runtime can defer a bound-session request", () => {
    const unsupported = createOpenClawTools({
      disablePluginTools: true,
      sessionId: "session-current",
      wrapBeforeToolCallHook: false,
    });
    const supported = createOpenClawTools({
      disablePluginTools: true,
      sessionId: "session-current",
      onManualCompactionRequest: () => "accepted",
      wrapBeforeToolCallHook: false,
    });

    expect(unsupported.map((tool) => tool.name)).not.toContain("sessions_compact");
    expect(supported.map((tool) => tool.name)).toContain("sessions_compact");
  });

  it("records one current-session request and keeps the first instructions", async () => {
    let pending: ManualCompactionRequest | undefined;
    const onRequest = vi.fn((request: ManualCompactionRequest) => {
      const registered = registerManualCompactionRequest(pending, request);
      pending = registered.pending;
      return registered.status;
    });
    const tool = createSessionsCompactTool({
      sessionId: "session-current",
      onRequest,
    });

    const first = await tool.execute("call-1", { customInstructions: "Preserve decisions" });
    const second = await tool.execute("call-2", {
      customInstructions: "Replace the first request",
      sessionKey: "agent:main:other",
    });

    expect(resultDetails(first)).toMatchObject({
      status: "accepted",
      session: "current",
      timing: "after_turn",
    });
    expect(resultDetails(second)).toMatchObject({ status: "already_requested" });
    expect(pending).toEqual({ customInstructions: "Preserve decisions" });
  });
});
