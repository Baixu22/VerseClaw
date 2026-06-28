#!/usr/bin/env node

// Explicit operator/developer-only readonly Runtime Memory inspection utility.
// It reads sanitized episode summaries only through the Phase 16 helper surface.
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
  "memory-operator-inspection.js",
);

const usage = `Usage: node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs --persist --database <path> [--limit <n>] [--json] [--config <json-file>]

Readonly inspection is default-off. It requires an explicit --persist flag and
an explicit --database <path> before it can open SQLite. Disabled or missing
inputs return bounded diagnostics and do not open, create, migrate, or write
Runtime Memory SQLite state.

This local developer utility reads only sanitized episode summaries/statistics
from an existing built OpenClaw runtime. It does not affect runtime behavior,
does not provide durable fact authority or runtime authority, and is not a
Gateway, Electron, renderer, provider, TaskLoop, prompt, service, listener, or
daemon integration.`;

function parseArgs(argv) {
  const options = {
    configPath: null,
    databasePath: null,
    json: false,
    limit: undefined,
    persist: false,
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
    if (arg === "--limit" || arg === "--maxEpisodes") {
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
      memory: {
        ...baseConfig.runtime?.memory,
        persist: true,
      },
    },
  };
}

function printText(result) {
  console.log(`Runtime Memory readonly inspection: ${result.status}`);
  if ("reason" in result) {
    console.log(`Reason: ${result.reason}`);
  }
  console.log(
    `Episodes: ${result.stats.returned}/${result.stats.episodeCount} (limit ${result.stats.limit})`,
  );
  for (const diagnostic of result.diagnostics) {
    console.log(`Diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
  }
  for (const episode of result.episodes) {
    console.log(
      `${episode.episodeId}\t${episode.taskId}\t${episode.kind}\t${episode.reference_time}\t${episode.redactionStatus}`,
    );
    console.log(episode.boundedSummary);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(inspectorModule)) {
    throw new Error(
      `Built inspector module not found at ${inspectorModule}. Run the OpenClaw runtime build before using this developer utility.`,
    );
  }
  const { inspectRuntimeMemoryForOperator } = await import(pathToFileURL(inspectorModule).href);
  const result = inspectRuntimeMemoryForOperator({
    config: readConfig(options),
    databasePath: options.databasePath ? path.resolve(options.databasePath) : undefined,
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
