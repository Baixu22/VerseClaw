#!/usr/bin/env node
/** Verifies the managed Codex runtime shipped at a plugin root without using PATH. */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { once } from "node:events";
import path from "node:path";
import {
  resolveManagedCodexAppServerPaths,
  resolveManagedCodexAppServerStartOptions,
} from "../openclaw_runtime/extensions/codex/src/app-server/managed-binary.ts";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function waitForInitialize(child, timeoutMs) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(
      () => finish(new Error(`app-server initialize timeout; stderr=${stderr}`)),
      timeoutMs,
    );
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1) finish(null, message);
        } catch {}
      }
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (!settled) {
        finish(
          new Error(
            `app-server exited before initialize: code=${code} signal=${signal} stderr=${stderr}`,
          ),
        );
      }
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "openclaw", title: "OpenClaw", version: "0.4.9-alpha.0" },
          capabilities: { experimentalApi: true },
        },
      }) + "\n",
    );
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
}

const args = parseArgs(process.argv.slice(2));
const pluginRoot = path.resolve(args["plugin-root"] ?? "build/openclaw-runtime/extensions/codex");
if (!fs.existsSync(path.join(pluginRoot, "openclaw.plugin.json"))) {
  throw new Error(`plugin root is missing openclaw.plugin.json: ${pluginRoot}`);
}
const codexHome = path.resolve(args["codex-home"] ?? path.join("build", "codex-home-tf0566"));
fs.mkdirSync(codexHome, { recursive: true });

const paths = resolveManagedCodexAppServerPaths({ pluginRoot, platform: process.platform });
const resolved = await resolveManagedCodexAppServerStartOptions(
  {
    transport: "stdio",
    command: "codex",
    commandSource: "managed",
    args: ["app-server", "--listen", "stdio://"],
    headers: {},
  },
  { pluginRoot, platform: process.platform },
);
const childEnv = { ...process.env, CODEX_HOME: codexHome };
const version = execFileSync(resolved.command, ["--version"], {
  encoding: "utf8",
  env: childEnv,
  windowsHide: true,
}).trim();
const child = spawn(resolved.command, resolved.args, {
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let initialize;
try {
  initialize = await waitForInitialize(child, 30000);
} finally {
  await stopChild(child);
}
const initializeResult = initialize.result ?? {};
const binary = fs.readFileSync(resolved.command);
const receipt = {
  schemaVersion: "CodexManagedRuntimeVerification/v1",
  generatedAt: new Date().toISOString(),
  driven_by: "agent",
  actor: "codex-harness-codex-authority-20261026",
  pluginRoot,
  candidateCommandPaths: paths.candidateCommandPaths,
  command: resolved.command,
  commandSource: resolved.commandSource,
  version,
  binary: {
    size: binary.length,
    sha256: createHash("sha256").update(binary).digest("hex"),
  },
  initialize: {
    userAgent: initializeResult.userAgent,
    codexHome: initializeResult.codexHome,
    platformFamily: initializeResult.platformFamily,
    platformOs: initializeResult.platformOs,
  },
  usedSystemPath: false,
  processCleanup: child.exitCode !== null || child.signalCode !== null,
};
if (!receipt.initialize.userAgent || !receipt.initialize.platformFamily) {
  throw new Error("initialize response did not include the required platform/userAgent fields");
}
const serialized = JSON.stringify(receipt, null, 2) + "\n";
if (args.out) {
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serialized);
}
process.stdout.write(serialized);
