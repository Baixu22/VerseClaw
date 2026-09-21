// Runs the repository check lanes selected by CLI arguments.
import { performance } from "node:perf_hooks";
import { printTimingSummary } from "./lib/check-timing-summary.mjs";
import { runManagedCommand } from "./lib/managed-child-process.mjs";

/**
 * Returns command usage text for the aggregate check runner.
 */
export function usage() {
  return [
    "Usage: node scripts/check.mjs [--timed] [--include-architecture] [--include-test-types] [--typecheck-scope=core|prod|all]",
    "",
    "Runs the local check graph: guard preflights, typecheck, lint, and policy guards.",
    "",
    "Options:",
    "  --timed                 Print timing summary even when checks pass.",
    "  --include-architecture  Run architecture import-cycle checks instead of runtime cycles.",
    "  --include-test-types    Typecheck production and test sources (alias for --typecheck-scope=all).",
    "  --typecheck-scope=SCOPE core = runtime production core only; prod (default) = core + extensions;",
    "                          all = production + test sources. Bounded nodes use core; release freeze uses all.",
    "  --typecheck-core        Bare alias for --typecheck-scope=core (use this when invoked via pnpm,",
    "                          which intercepts --flag=value forms before they reach the script).",
    "  -h, --help              Show this help.",
  ].join("\n");
}

/**
 * Parses aggregate check runner arguments.
 */
export function parseCheckArgs(argv) {
  const args = {
    help: false,
    includeArchitecture: false,
    includeTestTypes: false,
    // Typecheck scope: "core" = runtime production core only (tsgo:core);
    // "prod" (default) = core + extensions (tsgo:prod); "all" = + test types
    // (tsgo:all). A bounded acceptance node (e.g. TF-0029 self-contained
    // baseline) may run "core"; the full extension + test-type sweep is owned
    // by the release-freeze node (TF-0041). --include-test-types is kept as an
    // alias for --typecheck-scope=all so existing callers are unaffected.
    typecheckScope: null,
    timed: false,
  };
  for (const arg of argv) {
    if (arg === "--timed") {
      args.timed = true;
    } else if (arg === "--include-architecture") {
      args.includeArchitecture = true;
    } else if (arg === "--include-test-types") {
      args.includeTestTypes = true;
    } else if (arg.startsWith("--typecheck-scope=")) {
      const value = arg.slice("--typecheck-scope=".length);
      if (!["core", "prod", "all"].includes(value)) {
        throw new Error(`--typecheck-scope must be core|prod|all (got: ${value})\n\n${usage()}`);
      }
      args.typecheckScope = value;
    } else if (arg === "--typecheck-core") {
      // No-`=` boolean alias for --typecheck-scope=core. pnpm intercepts
      // `--flag=value` forms as its own config and they never reach this
      // script when invoked as `pnpm ... check --typecheck-scope=core`, so a
      // spawned acceptance gate must use this bare-flag form.
      args.typecheckScope = "core";
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  return args;
}

// Resolve the effective typecheck scope + its pnpm script. Explicit
// --typecheck-scope wins; otherwise --include-test-types maps to "all" and the
// default is "prod" (unchanged historical behavior).
export function resolveTypecheckScope(args) {
  const scope = args.typecheckScope ?? (args.includeTestTypes ? "all" : "prod");
  const script = scope === "core" ? "tsgo:core" : scope === "all" ? "tsgo:all" : "tsgo:prod";
  const name = scope === "core" ? "typecheck core" : scope === "all" ? "typecheck all" : "typecheck prod";
  return { scope, script, name };
}

/**
 * Runs selected repository check lanes.
 */
export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseCheckArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log(usage());
    process.exitCode = 0;
    return;
  }

  const tailChecks = [
    { name: "webhook body guard", args: ["lint:webhook:no-low-level-body-read"] },
    { name: "runtime action config guard", args: ["check:no-runtime-action-load-config"] },
    !args.includeArchitecture
      ? {
          name: "deprecated API usage guard",
          args: ["check:deprecated-api-usage"],
        }
      : null,
    { name: "temp path guard", args: ["check:temp-path-guardrails"] },
    { name: "pairing store guard", args: ["lint:auth:no-pairing-store-group"] },
    { name: "pairing account guard", args: ["lint:auth:pairing-account-scope"] },
    args.includeArchitecture
      ? { name: "architecture import cycles", args: ["check:architecture"] }
      : { name: "runtime import cycles", args: ["check:import-cycles"] },
  ].filter(Boolean);

  const stages = [
    {
      name: "preflight guards",
      parallel: true,
      commands: [
        { name: "conflict markers", args: ["check:no-conflict-markers"] },
        { name: "changelog attributions", args: ["check:changelog-attributions"] },
        {
          name: "guarded extension wildcard re-exports",
          args: ["lint:extensions:no-guarded-wildcard-reexports"],
        },
        {
          name: "plugin-sdk wildcard re-exports",
          args: ["lint:extensions:no-plugin-sdk-wildcard-reexports"],
        },
        {
          name: "deprecated channel access seams",
          args: ["lint:extensions:no-deprecated-channel-access"],
        },
        { name: "media download helper guard", args: ["check:media-download-helpers"] },
        { name: "runtime sidecar loader guard", args: ["check:runtime-sidecar-loaders"] },
        { name: "tool display", args: ["tool-display:check"] },
        { name: "host env policy", args: ["check:host-env-policy:swift"] },
        { name: "opengrep rule metadata", args: ["check:opengrep-rule-metadata"] },
        { name: "duplicate scan target coverage", args: ["dup:check:coverage"] },
        { name: "npm shrinkwrap guard", args: ["deps:shrinkwrap:check"] },
        { name: "package patch guard", args: ["deps:patches:check"] },
      ],
    },
    {
      name: "typecheck",
      parallel: false,
      commands: [
        (() => {
          const tc = resolveTypecheckScope(args);
          return { name: tc.name, args: [tc.script] };
        })(),
      ],
    },
    {
      name: "lint",
      parallel: false,
      commands: [{ name: "lint", args: ["lint"] }],
    },
    {
      name: "policy guards",
      parallel: true,
      commands: tailChecks,
    },
  ];

  const timings = [];
  let exitCode = 0;

  for (const stage of stages) {
    console.error(`\n[check] ${stage.name}`);
    const results = stage.parallel
      ? await Promise.all(stage.commands.map((command) => runCommand(command)))
      : await runSerial(stage.commands);

    timings.push(...results);
    const failed = results.find((result) => result.status !== 0);
    if (failed) {
      exitCode = failed.status;
      break;
    }
  }

  if (args.timed || exitCode !== 0) {
    printSummary(timings);
  }

  process.exitCode = exitCode;
}

async function runSerial(commands) {
  const results = [];
  for (const command of commands) {
    const result = await runCommand(command);
    results.push(result);
    if (result.status !== 0) {
      break;
    }
  }
  return results;
}

/**
 * pnpm's verify-deps-before-run nests a `pnpm install` before every script
 * when it cannot confirm deps are current. Under the parallel preflight stage
 * that means several concurrent nested installs racing on the virtual store's
 * `.pnpm/lock.yaml` — Windows reports EPERM/ENOTEMPTY and gates fail
 * non-deterministically. The repo already opts out of this check for long-run
 * gates (see artifacts/runtime-long-stability/report.json command lines); the
 * aggregate check does the same so guard execution is deterministic.
 */
const PNPM_NO_DEPS_VERIFY = "--config.verify-deps-before-run=false";

/**
 * Runs one managed check command and returns timing/status details.
 */
export async function runCommand(command, runManagedCommandImpl = runManagedCommand) {
  const startedAt = performance.now();
  let status = 1;
  try {
    status = await runManagedCommandImpl({
      args: [PNPM_NO_DEPS_VERIFY, ...command.args],
      bin: "pnpm",
    });
  } catch (error) {
    console.error(error);
  }
  return {
    name: command.name,
    durationMs: performance.now() - startedAt,
    status,
  };
}

function printSummary(timings) {
  printTimingSummary("check", timings);
}

if (import.meta.main) {
  await main();
}
