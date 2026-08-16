import test from "node:test";
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function startServer(args = []) {
  const env = { ...process.env, VERSESHELL_PROFILE: "product", VERSESHELL_CAPS: "" };
  delete env.AETHER_CAPS;
  const child = spawn(process.execPath, ["src/index.js", "--ae-path", "missing-verseshell-runtime", ...args], {
    cwd: ROOT,
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

async function nextJson(server, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const line = server.lines.shift();
    if (line) return JSON.parse(line);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("Timed out waiting for MCP response");
}

test("product startup smoke is usable without runtime capabilities", async () => {
  const server = startServer();
  try {
    send(server.child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verseshell-p1-03-smoke", version: "1.0.0" },
      },
    });
    const initialized = await nextJson(server);
    assert.equal(initialized.result.protocolVersion, "2024-11-05");
    send(server.child, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send(server.child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await nextJson(server);
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["verseshell_health"]);
    send(server.child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "verseshell_health", arguments: {} },
    });
    const health = await nextJson(server);
    const payload = JSON.parse(health.result.content[0].text);
    assert.equal(payload.compatibility_only, true);
    assert.equal(payload.profile, "product");
    assert.deepEqual(payload.capabilities_granted, []);
  } finally {
    server.stdout.close();
    server.child.kill();
  }
});

test("wildcard capability configuration fails before the server starts", async () => {
  const server = startServer(["--cap", "all"]);
  const exitCode = await new Promise((resolveExit) => server.child.once("exit", (code) => resolveExit(code)));
  assert.equal(exitCode, 1);
});
