#!/usr/bin/env node

// Explicit operator/developer-only readonly Runtime Event Log inspection utility.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, "..");
const inspectorModule = path.join(
  runtimeRoot,
  "dist",
  "runtime-core",
  "event-log-operator-inspection.js",
);

const usage = `Usage: node openclaw_runtime/scripts/inspect-runtime-event-log.mjs --persist --database <path> [--task <id>] [--session <key>] [--trace <id>] [--kind <kind>] [--limit <n>] [--json] [--config <json-file>]

Readonly inspection is default-off. It requires an explicit --persist flag and
an explicit --database <path> before it can open SQLite. Disabled or missing
inputs return bounded diagnostics and do not open, create, alter, or write
Runtime Event Log SQLite state.

This local developer utility reads only bounded event metadata, read status,
retention evidence, and non-authoritative resume comparison status from an
existing built OpenClaw runtime. It is not a Gateway, Electron, renderer,
provider, TaskLoop, or background integration.`;

function parseArgs(argv) {
  const options = {
    configPath: null,
    databasePath: null,
    json: false,
    kind: undefined,
    limit: undefined,
    persist: false,
    sessionKey: undefined,
    taskId: undefined,
    traceId: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (arg === "--persist") {
      options.persist = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--database" || arg === "--db") {
      options.databasePath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.configPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--task" || arg === "--taskId") {
      options.taskId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--session" || arg === "--sessionKey") {
      options.sessionKey = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--trace" || arg === "--traceId") {
      options.traceId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--kind") {
      options.kind = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = readPositiveInteger(readValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readPositiveInteger(value, flag) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function readConfig(options) {
  const baseConfig = options.configPath
    ? JSON.parse(readFileSync(path.resolve(options.configPath), "utf8"))
    : {};
  if (!options.persist) {
    return baseConfig;
  }
  return {
    ...baseConfig,
    runtime: {
      ...baseConfig.runtime,
      eventLog: {
        ...baseConfig.runtime?.eventLog,
        persist: true,
      },
    },
  };
}

function printText(result) {
  console.log(`Runtime Event Log readonly inspection: ${result.status}`);
  if (result.reason) {
    console.log(`Reason: ${result.reason}`);
  }
  console.log(
    `Events: ${result.stats.returned}/${result.stats.eventCount} (limit ${result.stats.limit}, read ${result.stats.readStatus})`,
  );
  console.log(`Legacy authoritative: ${result.resumeComparison.legacyAuthoritative}`);
  for (const diagnostic of result.diagnostics) {
    console.log(`Diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
  }
  for (const event of result.events) {
    console.log(
      `${event.eventId}\t${event.taskId}\t${event.kind}\t${event.timestamp}\t${event.sessionKey ?? ""}\t${event.runId ?? ""}\t${event.traceId ?? ""}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(inspectorModule)) {
    throw new Error(
      `Built inspector module not found at ${inspectorModule}. Run the OpenClaw runtime build before using this developer utility.`,
    );
  }
  const { inspectRuntimeEventLogForOperator } = await import(pathToFileURL(inspectorModule).href);
  const result = inspectRuntimeEventLogForOperator({
    config: readConfig(options),
    databasePath: options.databasePath ? path.resolve(options.databasePath) : undefined,
    taskId: options.taskId,
    sessionKey: options.sessionKey,
    traceId: options.traceId,
    kind: options.kind,
    limit: options.limit,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printText(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
