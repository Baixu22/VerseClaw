import { describe, expect, it, vi } from "vitest";
import {
  createExternalProvenance,
  createTrustedProvenance,
} from "../../../../shared/security/content-provenance.js";
import { createAgentBrowserTool } from "./agent-browser-tool.js";

const RECEIVED_AT = "2026-08-21T00:00:00.000Z";
const external = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:article-1",
  receivedAt: RECEIVED_AT,
});

function readJsonResult(result: unknown): Record<string, unknown> | undefined {
  const record = result as { content?: Array<{ text?: string }> };
  const text = record.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
}

describe("agent_browser external-access provenance boundary", () => {
  it.each([
    ["open", { action: "open", connectionMode: "auto-connect", allowExternalBrowser: true }],
    [
      "command",
      {
        action: "command",
        args: ["snapshot"],
        connectionMode: "external-profile",
        externalProfile: "Default",
        allowExternalBrowser: true,
      },
    ],
  ])("denies an external %s request before bridge invocation", async (_label, args) => {
    const invoke = vi.fn();
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    await expect(tool!.execute("call-1", args)).rejects.toMatchObject({
      name: "ToolAuthorizationError",
      status: 403,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed when provenance is missing", async () => {
    const invoke = vi.fn();
    const tool = createAgentBrowserTool({ invoke });

    await expect(
      tool!.execute("call-1", {
        action: "open",
        connectionMode: "cdp",
        cdpEndpoint: "9222",
        allowExternalBrowser: true,
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps managed browsing usable even when allowExternalBrowser is present", async () => {
    const invoke = vi.fn(async (action, payload, _correlation) => ({ action, payload }));
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    const result = await tool!.execute("call-1", {
      action: "open",
      url: "https://example.com",
      connectionMode: "managed",
      allowExternalBrowser: true,
    });

    expect(readJsonResult(result)).toMatchObject({
      action: "open",
      payload: {
        url: "https://example.com",
        connectionMode: "managed",
        allowExternalBrowser: true,
      },
    });
  });

  it("preserves direct operator external browser selection", async () => {
    const invoke = vi.fn(async (action, payload, _correlation) => ({ action, payload }));
    const tool = createAgentBrowserTool({
      contentProvenanceContext: {
        provenance: createTrustedProvenance({
          sourceKind: "user-direct",
          sourceId: "user-direct:request-1",
          receivedAt: RECEIVED_AT,
        }),
      },
      invoke,
    });

    await tool!.execute("call-1", {
      action: "open",
      connectionMode: "cdp",
      cdpEndpoint: "9222",
      allowExternalBrowser: true,
    });

    expect(invoke).toHaveBeenCalledWith(
      "open",
      { connectionMode: "cdp", cdpEndpoint: "9222", allowExternalBrowser: true },
      { gatewayRequestId: undefined, toolCallId: "call-1" },
    );
  });
});

describe("agent_browser existing-session effect provenance boundary", () => {
  it("allows external content to click a Main-verified managed session", async () => {
    const invoke = vi.fn(async (action, payload, _correlation) =>
      action === "status"
        ? { success: true, sessions: [{ id: "s1", connection: { mode: "managed" } }] }
        : { success: true, action, payload },
    );
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    await tool!.execute("call-1", {
      action: "click",
      sessionId: "s1",
      selector: "#next",
    });

    expect(invoke.mock.calls).toEqual([
      ["status", {}],
      ["click", { sessionId: "s1", selector: "#next" }, { gatewayRequestId: undefined, toolCallId: "call-1" }],
    ]);
  });

  it.each(["auto-connect", "cdp", "external-profile"])(
    "denies external content clicking an existing %s session",
    async (mode) => {
      const invoke = vi.fn(async () => ({
        success: true,
        sessions: [{ id: "s1", connection: { mode } }],
      }));
      const tool = createAgentBrowserTool({
        contentProvenanceContext: { provenance: external },
        invoke,
      });

      await expect(
        tool!.execute("call-1", {
          action: "click",
          sessionId: "s1",
          selector: "#publish",
          connectionMode: "managed",
        }),
      ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
      expect(invoke.mock.calls).toEqual([["status", {}]]);
    },
  );

  it.each([
    ["missing session", { success: true, sessions: [] }],
    ["missing connection", { success: true, sessions: [{ id: "s1" }] }],
    ["malformed response", { success: true, sessions: "invalid" }],
    ["missing success marker", { sessions: [{ id: "s1", connection: { mode: "managed" } }] }],
    [
      "failed response",
      { success: false, sessions: [{ id: "s1", connection: { mode: "managed" } }] },
    ],
  ])("fails closed for %s status metadata", async (_label, statusResult) => {
    const invoke = vi.fn(async () => statusResult);
    const tool = createAgentBrowserTool({ invoke });

    await expect(
      tool!.execute("call-1", {
        action: "click",
        sessionId: "s1",
        selector: "#publish",
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(invoke.mock.calls).toEqual([["status", {}]]);
  });

  it("fails closed when the status lookup fails", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("bridge unavailable");
    });
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    await expect(
      tool!.execute("call-1", {
        action: "click",
        sessionId: "s1",
        selector: "#publish",
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(invoke.mock.calls).toEqual([["status", {}]]);
  });

  it("keeps direct operator clicks on the existing path without a preflight", async () => {
    const invoke = vi.fn(async (action, payload) => ({ success: true, action, payload }));
    const tool = createAgentBrowserTool({
      contentProvenanceContext: {
        provenance: createTrustedProvenance({
          sourceKind: "user-direct",
          sourceId: "user-direct:click-1",
          receivedAt: RECEIVED_AT,
        }),
      },
      invoke,
    });

    await tool!.execute("call-1", {
      action: "click",
      sessionId: "s1",
      selector: "#publish",
    });

    expect(invoke.mock.calls).toEqual([
      ["click", { sessionId: "s1", selector: "#publish" }, { gatewayRequestId: undefined, toolCallId: "call-1" }],
    ]);
  });

  it("allows external content to type into a Main-verified managed session without exposing text to status", async () => {
    const invoke = vi.fn(async (action, payload, _correlation) =>
      action === "status"
        ? { success: true, sessions: [{ id: "s-type", connection: { mode: "managed" } }] }
        : { success: true, action, payload },
    );
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    await tool!.execute("call-1", {
      action: "type",
      sessionId: "s-type",
      selector: "#search",
      text: "secret-looking text",
      clear: true,
    });

    expect(invoke.mock.calls).toEqual([
      ["status", {}],
      [
        "type",
        { sessionId: "s-type", selector: "#search", text: "secret-looking text", clear: true },
        { gatewayRequestId: undefined, toolCallId: "call-1" },
      ],
    ]);
  });

  it("denies external content typing into an existing external session before sending text", async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      sessions: [{ id: "s-type", connection: { mode: "cdp" } }],
    }));
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    await expect(
      tool!.execute("call-1", {
        action: "type",
        sessionId: "s-type",
        selector: "#password",
        text: "should-not-reach-bridge",
      }),
    ).rejects.toMatchObject({
      name: "ToolAuthorizationError",
      status: 403,
      message: expect.not.stringContaining("should-not-reach-bridge"),
    });
    expect(invoke.mock.calls).toEqual([["status", {}]]);
  });

  it.each([
    ["missing session", { success: true, sessions: [] }],
    ["missing connection", { success: true, sessions: [{ id: "s-type" }] }],
    ["malformed response", { success: true, sessions: "invalid" }],
    ["missing success marker", { sessions: [{ id: "s-type", connection: { mode: "managed" } }] }],
    [
      "failed response",
      { success: false, sessions: [{ id: "s-type", connection: { mode: "managed" } }] },
    ],
  ])("fails type closed for %s status metadata", async (_label, statusResult) => {
    const invoke = vi.fn(async () => statusResult);
    const tool = createAgentBrowserTool({ invoke });

    await expect(
      tool!.execute("call-1", {
        action: "type",
        sessionId: "s-type",
        selector: "#search",
        text: "must-not-cross",
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(invoke.mock.calls).toEqual([["status", {}]]);
  });

  it("fails type closed when the status lookup fails", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("bridge unavailable");
    });
    const tool = createAgentBrowserTool({
      contentProvenanceContext: { provenance: external },
      invoke,
    });

    await expect(
      tool!.execute("call-1", {
        action: "type",
        sessionId: "s-type",
        selector: "#search",
        text: "must-not-cross",
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(invoke.mock.calls).toEqual([["status", {}]]);
  });
});
