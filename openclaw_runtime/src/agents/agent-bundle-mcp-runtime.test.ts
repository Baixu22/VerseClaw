import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * TF-0113: the catalog memo used to have only two invalidation paths
 * (`tools/list_changed` and `dispose()`), so a server whose transport dropped
 * without notifying kept having its tools declared to the model.
 *
 * These tests drive that through a real MCP handshake over in-memory transports
 * rather than a hand-rolled fake, so the client-side `onclose` fires for the same
 * reason it fires in production: the peer went away.
 */

type FakeServer = {
  clientTransport: Transport;
  serverTransport: InMemoryTransport;
  server: McpServer;
  /** Counts client handshakes, so a test can assert a session was reused. */
  connectCount: () => number;
};

const registry = new Map<string, FakeServer>();

vi.mock("./mcp-transport.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp-transport.js")>();
  return {
    ...actual,
    resolveMcpTransport: (serverName: string) => {
      const entry = registry.get(serverName);
      if (!entry) {
        return null;
      }
      return {
        transport: entry.clientTransport,
        description: `in-memory ${serverName}`,
        transportType: "stdio" as const,
        connectionTimeoutMs: 5_000,
        requestTimeoutMs: 5_000,
        supportsParallelToolCalls: false,
      };
    },
  };
});

const { createSessionMcpRuntime } = await import("./agent-bundle-mcp-runtime.js");

async function startFakeServer(serverName: string, toolNames: string[]): Promise<FakeServer> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: `fake-${serverName}`, version: "0.0.0" });
  for (const toolName of toolNames) {
    server.tool(
      toolName,
      `tool ${toolName} on ${serverName}`,
      { value: z.string().optional() },
      () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );
  }
  let connects = 0;
  const originalStart = serverTransport.start.bind(serverTransport);
  serverTransport.start = async () => {
    connects += 1;
    await originalStart();
  };
  await server.connect(serverTransport);
  const entry: FakeServer = {
    clientTransport,
    serverTransport,
    server,
    connectCount: () => connects,
  };
  registry.set(serverName, entry);
  return entry;
}

function runtimeFor(serverNames: string[]) {
  return createSessionMcpRuntime({
    sessionId: `tf0113-${serverNames.join("-")}`,
    workspaceDir: process.cwd(),
    cfg: {
      mcp: {
        servers: Object.fromEntries(
          serverNames.map((name) => [name, { command: "node", args: ["--version"] }]),
        ),
      },
    } as never,
  });
}

function toolNamesOf(catalog: { tools: { serverName: string; toolName: string }[] }) {
  return catalog.tools.map((tool) => `${tool.serverName}:${tool.toolName}`).toSorted();
}

afterEach(async () => {
  for (const entry of registry.values()) {
    await entry.server.close().catch(() => {});
  }
  registry.clear();
  vi.restoreAllMocks();
});
describe("bundle-mcp catalog invalidation on transport loss (TF-0113)", () => {
  it("drops a server's tools from the declared surface after its transport closes", async () => {
    const alpha = await startFakeServer("alpha", ["ping"]);
    const runtime = runtimeFor(["alpha"]);

    const first = await runtime.getCatalog();
    expect(toolNamesOf(first)).toEqual(["alpha:ping"]);
    // Memoized: a second call must not rebuild.
    expect(await runtime.getCatalog()).toBe(first);

    // The server process dies. Nothing sends tools/list_changed.
    await alpha.server.close();
    await vi.waitFor(() => {
      expect(runtime.peekCatalog()).toBeNull();
    });

    const second = await runtime.getCatalog();
    expect(second).not.toBe(first);
    expect(toolNamesOf(second)).toEqual([]);
    expect(second.servers.alpha).toBeUndefined();

    await runtime.dispose();
  });

  it("fails callTool fast after close removes the session", async () => {
    const alpha = await startFakeServer("alpha", ["ping"]);
    const runtime = runtimeFor(["alpha"]);

    await runtime.getCatalog();
    await alpha.server.close();
    await vi.waitFor(() => {
      expect(runtime.peekCatalog()).toBeNull();
    });

    await expect(runtime.callTool("alpha", "ping", {})).rejects.toThrow(
      /bundle-mcp server "alpha" is not connected/,
    );
  });

  it("keeps the other servers' cached tools when one transport closes", async () => {
    await startFakeServer("alpha", ["ping"]);
    const beta = await startFakeServer("beta", ["pong", "peek"]);
    const runtime = runtimeFor(["alpha", "beta"]);

    const first = await runtime.getCatalog();
    expect(toolNamesOf(first)).toEqual(["alpha:ping", "beta:peek", "beta:pong"]);
    expect(beta.connectCount()).toBe(1);

    await registry.get("alpha")!.server.close();
    await vi.waitFor(() => {
      expect(runtime.peekCatalog()).toBeNull();
    });

    const second = await runtime.getCatalog();
    // Only the lost server leaves the surface; beta is untouched.
    expect(toolNamesOf(second)).toEqual(["beta:peek", "beta:pong"]);
    expect(second.servers.beta?.toolCount).toBe(2);
    expect(second.servers.alpha).toBeUndefined();
    // The whole point of per-server granularity: beta's session was reused, so one
    // dead server cannot amplify into a full re-handshake of every other server.
    expect(beta.connectCount()).toBe(1);

    await runtime.dispose();
  });

  it("leaves list_changed invalidation working (req-3 regression guard)", async () => {
    const alpha = await startFakeServer("alpha", ["ping"]);
    const runtime = runtimeFor(["alpha"]);

    const first = await runtime.getCatalog();
    expect(toolNamesOf(first)).toEqual(["alpha:ping"]);

    alpha.server.tool(
      "ping2",
      "second tool",
      { value: z.string().optional() },
      () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );
    await vi.waitFor(() => {
      expect(runtime.peekCatalog()).toBeNull();
    });

    const second = await runtime.getCatalog();
    expect(toolNamesOf(second)).toEqual(["alpha:ping", "alpha:ping2"]);
    // Still the same live transport, so no reconnect was needed.
    expect(alpha.connectCount()).toBe(1);

    await runtime.dispose();
  });

  it("keeps the session reusable after a recoverable onerror", async () => {
    const alpha = await startFakeServer("alpha", ["ping"]);
    const runtime = runtimeFor(["alpha"]);
    const closeSpy = vi.spyOn(alpha.clientTransport, "close");

    const first = await runtime.getCatalog();
    expect(toolNamesOf(first)).toEqual(["alpha:ping"]);
    expect(alpha.clientTransport.onerror).toBeTypeOf("function");

    alpha.clientTransport.onerror?.(new Error("recoverable transport error"));
    expect(runtime.peekCatalog()).toBeNull();

    const second = await runtime.getCatalog();
    expect(toolNamesOf(second)).toEqual(["alpha:ping"]);
    expect(alpha.connectCount()).toBe(1);
    expect(closeSpy).not.toHaveBeenCalled();

    await runtime.dispose();
  });

  it("does not invalidate again after dispose (idempotent, no generation churn)", async () => {
    await startFakeServer("alpha", ["ping"]);
    const runtime = runtimeFor(["alpha"]);
    await runtime.getCatalog();

    await runtime.dispose();
    // dispose() already tore the transport down; the close handler must be a no-op
    // rather than resurrecting state on a disposed runtime.
    await registry.get("alpha")!.server.close();
    expect(runtime.peekCatalog()).toBeNull();
    await expect(runtime.getCatalog()).rejects.toThrow();
  });
});
