import test from "node:test";
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const AE_PATH = resolve(REPO_ROOT, "resources", "bin", "win32-x64", "ae.exe");

function startServer() {
  const env = { ...process.env };
  delete env.VERSESHELL_CAPS;
  const child = spawn(process.execPath, [
    "src/index.js",
    "--ae-path", AE_PATH,
    "--workspace", REPO_ROOT,
    "--profile", "product",
    "--cap", "file.read",
    "--no-compact",
  ], {
    cwd: PACKAGE_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = createInterface({ input: child.stdout });
  const lines = [];
  stdout.on("line", (line) => lines.push(line));
  return { child, stdout, lines };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function nextJson(server, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const line = server.lines.shift();
    if (line) return JSON.parse(line);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("Timed out waiting for MCP response");
}

test("file.read grant reaches the pinned runtime without widening the tool boundary", async () => {
  const server = startServer();
  try {
    send(server.child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verseshell-p1-03-runtime-smoke", version: "1.0.0" },
      },
    });
    const initialized = await nextJson(server);
    assert.equal(initialized.result.protocolVersion, "2024-11-05");
    send(server.child, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send(server.child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await nextJson(server);
    const names = listed.result.tools.map((tool) => tool.name);
    assert.ok(names.includes("verseshell_file_read"));
    assert.ok(!names.includes("verseshell_file_write"));
    assert.ok(!names.includes("verseshell_platform_summary"));

    send(server.child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "verseshell_health", arguments: {} },
    });
    const health = await nextJson(server);
    const healthPayload = JSON.parse(health.result.content[0].text);
    assert.equal(healthPayload.runtime_policy, "agent_strict");
    assert.deepEqual(healthPayload.capabilities_granted, ["file.read"]);

    send(server.child, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "verseshell_file_read",
        arguments: { path: "resources/verseshell/manifest.json" },
      },
    });
    const fileRead = await nextJson(server);
    assert.equal(fileRead.result.isError, undefined);
    assert.match(fileRead.result.content[0].text, /operation_catalog/);
  } finally {
    server.stdout.close();
    server.child.kill();
  }
});
