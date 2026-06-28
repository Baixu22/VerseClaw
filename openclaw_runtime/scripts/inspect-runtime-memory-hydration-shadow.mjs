#!/usr/bin/env node

// Explicit developer/research-only readonly Runtime Memory read-hydration shadow utility.
// It calls the built Phase 21 helper and prints diagnostics-only sanitized output.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(scriptDir, "..");
const hydrationModule = path.join(
  runtimeRoot,
  "dist",
  "runtime-core",
  "memory-read-hydration-shadow.js",
);

const usage = `Usage: node openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs --persist --read-shadow --database <path> [--limit <n>] [--max-facts <n>] [--json] [--config <json-file>]

Readonly read-hydration shadow is default-off. Required flags: explicit --persist flag, explicit --read-shadow flag, and explicit --database <path>.
All three are required before it can open SQLite. Disabled or missing inputs return bounded
diagnostics and do not open, create, migrate, or write Runtime Memory SQLite
state.

This local developer/research utility reads only sanitized episode summaries,
sanitized fact projections, stats, diagnostics, and authority boundary markers
from an existing built OpenClaw runtime. Output is diagnostics-only. It does not
affect runtime behavior, does not provide durable fact authority or runtime
authority, and is not a Gateway, Electron, renderer, provider, TaskLoop, prompt,
service, listener, or daemon integration.
No runtime authority.

Build prerequisite:
  node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`;

function parseArgs(argv) {
  const options = {
    configPath: null,
    databasePath: null,
    json: false,
    limit: undefined,
    maxFacts: undefined,
    persist: false,
    readShadow: false,
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
    if (arg === "--read-shadow") {
      options.readShadow = true;
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
    if (arg === "--limit" || arg === "--max-episodes" || arg === "--maxEpisodes") {
      options.limit = readPositiveInteger(readValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--max-facts" || arg === "--maxFacts") {
      options.maxFacts = readPositiveInteger(readValue(argv, index, arg), arg);
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
  console.log(`Runtime Memory readonly read-hydration shadow: ${result.status}`);
  if ("reason" in result) {
    console.log(`Reason: ${result.reason}`);
  }
  console.log(
    `Episodes: ${result.stats.episodesReturned}/${result.stats.episodeCount} (limit ${result.stats.episodeLimit})`,
  );
  console.log(
    `Facts: ${result.stats.factsReturned}/${result.stats.factCount} (limit ${result.stats.factLimit})`,
  );
  console.log(
    `Authority: diagnosticsOnly=${result.authority.diagnosticsOnly}; readonly=${result.authority.readonly}; noRuntimeAuthority=${result.authority.noRuntimeAuthority}; noDurableFactAuthority=${result.authority.noDurableFactAuthority}`,
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
  for (const fact of result.facts) {
    console.log(
      `${fact.factId}\t${fact.recordKind}\t${fact.taskId ?? ""}\t${fact.subject}\t${fact.predicate}\t${fact.confidence}\t${fact.verificationStatus}`,
    );
    console.log(fact.objectSummary);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(hydrationModule)) {
    throw new Error(
      `Built hydration shadow module not found at ${hydrationModule}. Run: node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`,
    );
  }
  const { readRuntimeMemoryHydrationShadow } = await import(
    pathToFileURL(hydrationModule).href
  );
  const result = readRuntimeMemoryHydrationShadow({
    config: readConfig(options),
    databasePath: options.databasePath ? path.resolve(options.databasePath) : undefined,
    readShadow: options.readShadow,
    limit: options.limit,
    maxFacts: options.maxFacts,
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
