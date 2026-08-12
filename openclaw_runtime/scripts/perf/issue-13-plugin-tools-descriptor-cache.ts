// Measures cold and warm plugin-tool descriptor resolution for GitHub issue #13.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { clearPluginLoaderCache } from "../../src/plugins/loader.js";
import { resetPluginRuntimeStateForTest } from "../../src/plugins/runtime.js";
import { resolvePluginTools } from "../../src/plugins/tools.js";
import type { OpenClawPluginToolContext } from "../../src/plugins/types.js";

type Options = {
  json: boolean;
  keepTemp: boolean;
  output?: string;
  runs: number;
  warmup: number;
};

type ResolutionSample = {
  durationMs: number;
  factoryCalls: number;
  toolCount: number;
};

type Sample = {
  cold: ResolutionSample;
  index: number;
  rssMb: number;
  warm: ResolutionSample;
};

type SummaryStats = {
  avg: number;
  max: number;
  min: number;
  p50: number;
  p95: number;
};

type Report = {
  issue: 13;
  method: {
    cache: string;
    fixture: string;
    process: string;
  };
  options: Omit<Options, "json" | "keepTemp">;
  residual: string;
  samples: Sample[];
  scenario: "issue-13-plugin-tools-descriptor-cache";
  summary: {
    coldDurationMs: SummaryStats;
    coldFactoryCalls: SummaryStats;
    rssMb: SummaryStats;
    warmDurationMs: SummaryStats;
    warmFactoryCalls: SummaryStats;
    warmReductionPercent: number;
  };
  tempRoot: string;
};

function parseFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parsePositiveInt(flag: string, fallback: number): number {
  const raw = parseFlagValue(flag);
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInt(flag: string, fallback: number): number {
  const raw = parseFlagValue(flag);
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return value;
}

function parseOptions(): Options {
  return {
    json: hasFlag("--json"),
    keepTemp: hasFlag("--keep-temp"),
    output: parseFlagValue("--output"),
    runs: parsePositiveInt("--runs", 5),
    warmup: parseNonNegativeInt("--warmup", 1),
  };
}

function printUsage(): void {
  process.stdout.write(`OpenClaw GitHub issue #13 plugin-tools descriptor cache benchmark

Usage:
  pnpm perf:issue-13 -- [options]
  node --import tsx scripts/perf/issue-13-plugin-tools-descriptor-cache.ts [options]

Options:
  --runs <n>       Measured fixture runs (default: 5)
  --warmup <n>     Warmup fixture runs (default: 1)
  --output <path>  Write JSON report
  --json           Print JSON report
  --keep-temp      Keep generated temporary plugin fixtures
  --help, -h       Show this text
`);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue));
  return round(sorted[index] ?? 0);
}

function stats(values: number[]): SummaryStats {
  if (values.length === 0) {
    return { avg: 0, max: 0, min: 0, p50: 0, p95: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    avg: round(total / values.length),
    max: round(Math.max(...values)),
    min: round(Math.min(...values)),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function buildFixturePluginSource(countFile: string): string {
  return `const fs = require("node:fs");
const countFile = ${JSON.stringify(countFile)};
module.exports = {
  register(api) {
    api.registerTool(() => {
      const count = Number(fs.readFileSync(countFile, "utf8") || "0") + 1;
      fs.writeFileSync(countFile, String(count), "utf8");
      return {
        name: "fixture_tool",
        description: "Issue 13 plugin descriptor cache fixture tool",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "fixture" }] }),
      };
    }, { name: "fixture_tool" });
  },
};
`;
}

async function createFixture(root: string): Promise<{
  agentDir: string;
  context: OpenClawPluginToolContext;
  countFile: string;
  env: NodeJS.ProcessEnv;
}> {
  const pluginId = "issue-13-descriptor-cache-fixture";
  const countFile = path.join(root, "factory-count.txt");
  const stateDir = path.join(root, "state");
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  const config = {
    plugins: {
      enabled: true,
      entries: { [pluginId]: { enabled: true } },
      load: { paths: [root] },
    },
  };
  await Promise.all([
    mkdir(stateDir, { recursive: true }),
    mkdir(workspaceDir, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    writeFile(countFile, "0", "utf8"),
    writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({
        name: pluginId,
        openclaw: { extensions: ["./index.cjs"] },
        version: "1.0.0",
      })}\n`,
      "utf8",
    ),
    writeFile(
      path.join(root, "openclaw.plugin.json"),
      `${JSON.stringify({
        configSchema: { type: "object" },
        contracts: { tools: ["fixture_tool"] },
        id: pluginId,
        name: "Issue 13 Descriptor Cache Fixture",
      })}\n`,
      "utf8",
    ),
    writeFile(path.join(root, "index.cjs"), buildFixturePluginSource(countFile), "utf8"),
  ]);
  return {
    agentDir,
    context: {
      agentDir,
      agentId: "main",
      config,
      deliveryContext: { channel: "test", to: "user" },
      messageChannel: "test",
      requesterSenderId: "sender",
      runtimeConfig: config,
      sandboxed: false,
      workspaceDir,
    },
    countFile,
    env: {
      ...process.env,
      OPENCLAW_BUNDLED_PLUGINS_DIR: undefined,
      OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
      OPENCLAW_HOME: path.join(root, "home"),
      OPENCLAW_STATE_DIR: stateDir,
      VITEST: "true",
    },
  };
}

async function readFactoryCalls(countFile: string): Promise<number> {
  return Number.parseInt(await readFile(countFile, "utf8"), 10) || 0;
}

async function resolveFixtureTools(params: {
  context: OpenClawPluginToolContext;
  countFile: string;
  env: NodeJS.ProcessEnv;
}): Promise<ResolutionSample> {
  const beforeFactoryCalls = await readFactoryCalls(params.countFile);
  const started = performance.now();
  const tools = resolvePluginTools({
    context: params.context,
    env: params.env,
    toolAllowlist: ["fixture_tool"],
  });
  const durationMs = performance.now() - started;
  const afterFactoryCalls = await readFactoryCalls(params.countFile);
  return {
    durationMs: round(durationMs),
    factoryCalls: afterFactoryCalls - beforeFactoryCalls,
    toolCount: tools.length,
  };
}

async function runOne(tempRoot: string, index: number): Promise<Sample> {
  const fixtureRoot = await mkdtemp(path.join(tempRoot, `run-${index}-`));
  clearPluginLoaderCache();
  resetPluginRuntimeStateForTest();
  try {
    const fixture = await createFixture(fixtureRoot);
    const cold = await resolveFixtureTools(fixture);
    const warm = await resolveFixtureTools(fixture);
    if (cold.toolCount !== 1 || warm.toolCount !== 1) {
      throw new Error(
        `expected one tool per resolution, got cold=${cold.toolCount} warm=${warm.toolCount}`,
      );
    }
    if (cold.factoryCalls !== 1 || warm.factoryCalls !== 0) {
      throw new Error(
        `descriptor cache contract failed, factory calls cold=${cold.factoryCalls} warm=${warm.factoryCalls}`,
      );
    }
    return {
      cold,
      index,
      rssMb: round(process.memoryUsage().rss / 1024 / 1024),
      warm,
    };
  } finally {
    clearPluginLoaderCache();
    resetPluginRuntimeStateForTest();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function summarize(samples: Sample[]): Report["summary"] {
  const coldDurationMs = stats(samples.map((sample) => sample.cold.durationMs));
  const warmDurationMs = stats(samples.map((sample) => sample.warm.durationMs));
  return {
    coldDurationMs,
    coldFactoryCalls: stats(samples.map((sample) => sample.cold.factoryCalls)),
    rssMb: stats(samples.map((sample) => sample.rssMb)),
    warmDurationMs,
    warmFactoryCalls: stats(samples.map((sample) => sample.warm.factoryCalls)),
    warmReductionPercent:
      coldDurationMs.avg === 0 ? 0 : round((1 - warmDurationMs.avg / coldDurationMs.avg) * 100),
  };
}

function printHuman(report: Report): void {
  process.stdout.write(
    [
      `scenario: ${report.scenario}`,
      `runs: ${report.options.runs}`,
      `coldDurationMs: avg=${report.summary.coldDurationMs.avg} p50=${report.summary.coldDurationMs.p50} p95=${report.summary.coldDurationMs.p95}`,
      `warmDurationMs: avg=${report.summary.warmDurationMs.avg} p50=${report.summary.warmDurationMs.p50} p95=${report.summary.warmDurationMs.p95}`,
      `warmReductionPercent: ${report.summary.warmReductionPercent}`,
      `coldFactoryCalls: avg=${report.summary.coldFactoryCalls.avg}`,
      `warmFactoryCalls: avg=${report.summary.warmFactoryCalls.avg}`,
      `rssMb: avg=${report.summary.rssMb.avg} max=${report.summary.rssMb.max}`,
      ...(report.options.output ? [`output: ${report.options.output}`] : []),
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }
  const options = parseOptions();
  const tempRoot = await mkdtemp(path.join(tmpdir(), "openclaw-issue-13-"));
  try {
    for (let index = 0; index < options.warmup; index += 1) {
      await runOne(tempRoot, -index - 1);
    }
    const samples: Sample[] = [];
    for (let index = 0; index < options.runs; index += 1) {
      samples.push(await runOne(tempRoot, index));
    }
    const report: Report = {
      issue: 13,
      method: {
        cache: "process-local descriptor cache keyed by plugin registry generation",
        fixture: "temporary manifest plugin with a counted registered tool factory",
        process: "single Node process; each sample resets plugin runtime state",
      },
      options: { output: options.output, runs: options.runs, warmup: options.warmup },
      residual:
        "This is a process-local plugin tool-list benchmark. It is not a live Gateway stream-ready or RSS A/B measurement.",
      samples,
      scenario: "issue-13-plugin-tools-descriptor-cache",
      summary: summarize(samples),
      tempRoot,
    };
    if (options.output) {
      await mkdir(path.dirname(options.output), { recursive: true });
      await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHuman(report);
    }
  } finally {
    if (!options.keepTemp) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
