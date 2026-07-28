import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOpenClawCodingTools } from "./agent-tools.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "fp-p2-05-agent-tools-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
  writeFileSync(path.join(root, "result.txt"), "before\n");
  return root;
}

async function executeWrite(params: {
  workspaceRoot: string;
  config: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const tools = createOpenClawCodingTools({
    workspaceDir: params.workspaceRoot,
    cwd: params.workspaceRoot,
    sessionId: "fp-p2-05-session",
    sessionKey: "agent:main:main",
    config: params.config as never,
  });
  const write = tools.find((tool) => tool.name === "write");
  if (!write) {
    throw new Error("write tool missing");
  }
  const result = await write.execute("write-call", {
    path: "result.txt",
    content: "after\n",
  });
  return (result.details ?? {}) as Record<string, unknown>;
}

describe("FP-P2-05 canonical exec wiring", () => {
  it("inherits exec security denial without rolling back the write", async () => {
    const workspaceRoot = makeWorkspace();
    const details = await executeWrite({
      workspaceRoot,
      config: {
        runtime: { coding: { autoVerify: { enabled: true, timeoutSeconds: 15 } } },
        tools: { profile: "full", exec: { mode: "deny", security: "deny", ask: "off" } },
      },
    });
    expect(readFileSync(path.join(workspaceRoot, "result.txt"), "utf8")).toBe("after\n");
    expect((details.verify_tests as Record<string, unknown>).execution).toMatchObject({
      status: "denied",
    });
  });

  it("does not bypass a policy that removes exec from the final tool surface", async () => {
    const workspaceRoot = makeWorkspace();
    const details = await executeWrite({
      workspaceRoot,
      config: {
        runtime: { coding: { autoVerify: { enabled: true } } },
        tools: { profile: "full", deny: ["exec"] },
      },
    });
    expect(readFileSync(path.join(workspaceRoot, "result.txt"), "utf8")).toBe("after\n");
    expect((details.verify_tests as Record<string, unknown>).execution).toMatchObject({
      status: "unavailable",
    });
  });
});
