#!/usr/bin/env node
// RC-03 real-receipt probe. The command is deliberately fail-closed: it only
// starts an external model call after the operator supplies an isolated state
// directory, an explicit provider/model, a credential environment variable,
// a non-sensitive message confirmation, and an explicit network confirmation.
// It never prints or stores child stdout/stderr, prompt text, or credentials.
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RC03_RECEIPT_PROBE_SCHEMA = "rc03-receipt-probe/v1";
export const RC03_RECEIPT_PROBE_EXIT = {
  passed: 0,
  failed: 1,
  blocked: 2,
  usage: 3,
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_MESSAGE_LENGTH = 512;
const MAX_ID_LENGTH = 128;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const CHILD_ENV_KEYS = [
  "OPENCLAW_HOME",
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_AGENT_DIR",
  "OPENCLAW_RC03_SEAL",
];

function usage() {
  return [
    "RC-03 real receipt probe",
    "",
    "  pnpm run dcs:receipt:probe -- --provider <id> --model <id>",
    "    --credential-env <ENV_NAME> --message <non-sensitive text>",
    "    --allow-network --confirm-non-sensitive [--state-dir <tmp dir>]",
    "    [--report <path>] [--keep-state] [--timeout <seconds>]",
    "",
    "The probe is BLOCKED unless every safety precondition is explicit.",
  ].join("\n");
}

export function parseProbeArgs(argv) {
  const options = {
    allowNetwork: false,
    confirmNonSensitive: false,
    keepState: false,
    timeoutSeconds: 120,
  };
  const valueOptions = new Set([
    "--provider",
    "--model",
    "--credential-env",
    "--message",
    "--state-dir",
    "--report",
    "--timeout",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true, options };
    if (arg === "--allow-network") {
      options.allowNetwork = true;
      continue;
    }
    if (arg === "--confirm-non-sensitive") {
      options.confirmNonSensitive = true;
      continue;
    }
    if (arg === "--keep-state") {
      options.keepState = true;
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    index += 1;
    const key = arg.slice(2).replaceAll("-", "");
    if (arg === "--credential-env") options.credentialEnv = value;
    else if (arg === "--state-dir") options.stateDir = value;
    else if (arg === "--allow-network") options.allowNetwork = value;
    else options[key] = value;
  }
  if (options.timeout !== undefined) {
    const timeout = Number(options.timeout);
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600) {
      throw new Error("--timeout must be an integer from 1 to 600 seconds");
    }
    options.timeoutSeconds = timeout;
    delete options.timeout;
  }
  return { help: false, options };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function defaultStateDir(env) {
  const stateOverride = env.OPENCLAW_STATE_DIR?.trim();
  if (stateOverride) return path.resolve(stateOverride);
  const home = env.OPENCLAW_HOME?.trim() || os.homedir();
  return path.resolve(home, ".openclaw");
}

function messageLooksSensitive(message) {
  return /(?:api[_ -]?key|access[_ -]?token|password|secret|private key|bearer\s+[A-Za-z0-9._-]+)/iu.test(message) ||
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]{20,}/u.test(message);
}

export function validateProbeRequest(options, env = process.env, tempRoot = os.tmpdir()) {
  const errors = [];
  for (const [name, value] of [["provider", options.provider], ["model", options.model]]) {
    if (typeof value !== "string" || !SAFE_ID_RE.test(value) || value.length > MAX_ID_LENGTH) {
      errors.push(`${name} must be a bounded explicit identifier`);
    }
  }
  if (typeof options.credentialEnv !== "string" || !ENV_NAME_RE.test(options.credentialEnv)) {
    errors.push("credential-env must be an uppercase environment variable name");
  } else if (!env[options.credentialEnv]?.trim()) {
    errors.push(`credential environment variable ${options.credentialEnv} is absent`);
  }
  if (typeof options.message !== "string" || options.message.trim().length === 0) {
    errors.push("message must be non-empty");
  } else {
    if (options.message.length > MAX_MESSAGE_LENGTH) errors.push("message exceeds the bounded probe limit");
    if (messageLooksSensitive(options.message)) errors.push("message matches a sensitive-content guard");
  }
  if (options.allowNetwork !== true) errors.push("--allow-network is required for a real provider call");
  if (options.confirmNonSensitive !== true) errors.push("--confirm-non-sensitive is required");
  if (env.VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH?.trim()) {
    errors.push("context enhancement kill switch is engaged");
  }

  if (options.stateDir !== undefined) {
    const requested = path.resolve(options.stateDir);
    if (!isInside(tempRoot, requested)) errors.push("state-dir must be inside the OS temporary directory");
    if (isInside(defaultStateDir(env), requested)) errors.push("state-dir may not be the shared/default OpenClaw state");
    if (existsSync(requested)) {
      try {
        if (readdirSync(requested).length > 0) errors.push("state-dir must be empty when supplied");
      } catch {
        errors.push("state-dir cannot be inspected");
      }
    }
  }
  return errors;
}

function createProbeState(options) {
  const stateDir = options.stateDir
    ? path.resolve(options.stateDir)
    : mkdtempSync(path.join(os.tmpdir(), "clawx-rc03-receipt-"));
  mkdirSync(stateDir, { recursive: true });
  const configPath = path.join(stateDir, "openclaw.json");
  writeFileSync(configPath, `${JSON.stringify({
    gateway: { mode: "local" },
    runtime: { rc03: { seal: true } },
  }, null, 2)}\n`, "utf8");
  return { stateDir, configPath };
}

function childEnvironment(stateDir, configPath, env) {
  const childEnv = { ...env };
  for (const key of CHILD_ENV_KEYS) delete childEnv[key];
  childEnv.OPENCLAW_HOME = stateDir;
  childEnv.OPENCLAW_STATE_DIR = stateDir;
  childEnv.OPENCLAW_CONFIG_PATH = configPath;
  childEnv.OPENCLAW_RC03_SEAL = "1";
  return childEnv;
}

export function resolveReceiptDatabasePath(stateDir) {
  const candidates = [
    path.join(stateDir, "state", "openclaw.sqlite"),
    path.join(stateDir, "openclaw.sqlite"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function readReceiptCounts(stateDir) {
  const databasePath = resolveReceiptDatabasePath(stateDir);
  if (!databasePath) return { databasePath: null, total: 0, byKind: {} };
  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const rows = db.prepare("SELECT kind, COUNT(*) AS count FROM runtime_receipts GROUP BY kind").all();
    const byKind = Object.fromEntries(rows.map((row) => [String(row.kind), Number(row.count)]));
    const total = Object.values(byKind).reduce((sum, count) => sum + count, 0);
    db.close();
    return { databasePath, total, byKind };
  } catch {
    return { databasePath, total: 0, byKind: {}, readError: true };
  }
}

export function buildProbeReport({ options, preflightErrors = [], childStatus = null, childError = false, receipts }) {
  const executed = preflightErrors.length === 0;
  const hasRealReceipt = executed && childStatus === 0 && receipts.total > 0;
  return {
    schema: RC03_RECEIPT_PROBE_SCHEMA,
    status: hasRealReceipt ? "PASS" : "BLOCKED",
    phase: hasRealReceipt ? "REAL_RECEIPT" : "NOT_EXECUTED",
    evidenceClass: hasRealReceipt ? "real-receipt" : "none",
    provider: options.provider ?? null,
    model: options.model ?? null,
    isolatedState: true,
    networkAuthorized: options.allowNetwork === true,
    nonSensitiveConfirmed: options.confirmNonSensitive === true,
    preflightErrors,
    execution: {
      attempted: executed,
      childExitCode: childStatus,
      childError,
    },
    receipts: {
      total: receipts.total,
      byKind: receipts.byKind,
      databaseFound: receipts.databasePath !== null,
    },
    note: hasRealReceipt
      ? "A real provider process exited successfully and produced receipts in an isolated state database."
      : "No real receipt evidence was accepted; missing prerequisites or absent receipts remain blocked.",
  };
}

function writeReport(report, reportPath) {
  if (!reportPath) return;
  const target = path.resolve(reportPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function runProbe(options) {
  const preflightErrors = validateProbeRequest(options);
  if (preflightErrors.length > 0) {
    const report = buildProbeReport({ options, preflightErrors, receipts: { total: 0, byKind: {}, databasePath: null } });
    writeReport(report, options.report);
    return { code: RC03_RECEIPT_PROBE_EXIT.blocked, report };
  }

  const { stateDir, configPath } = createProbeState(options);
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const modelRef = `${options.provider}/${options.model}`;
  const child = spawnSync(command, [
    "exec",
    "openclaw",
    "agent",
    "--local",
    "--json",
    "--agent",
    "main",
    "--session-id",
    `rc03-probe-${Date.now()}`,
    "--model",
    modelRef,
    "--message",
    options.message,
    "--timeout",
    String(options.timeoutSeconds),
  ], {
    cwd: ROOT,
    env: childEnvironment(stateDir, configPath, process.env),
    stdio: "ignore",
    timeout: options.timeoutSeconds * 1000 + 10_000,
    windowsHide: true,
  });
  const receipts = readReceiptCounts(stateDir);
  const report = buildProbeReport({
    options,
    childStatus: child.status,
    childError: Boolean(child.error),
    receipts,
  });
  writeReport(report, options.report);
  if (!options.keepState) rmSync(stateDir, { recursive: true, force: true });
  return { code: report.status === "PASS" ? RC03_RECEIPT_PROBE_EXIT.passed : RC03_RECEIPT_PROBE_EXIT.blocked, report };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseProbeArgs(argv);
    if (parsed.help) {
      console.log(usage());
      return RC03_RECEIPT_PROBE_EXIT.passed;
    }
    const result = runProbe(parsed.options);
    console.log(JSON.stringify(result.report));
    return result.code;
  } catch (error) {
    console.error(`usage error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    return RC03_RECEIPT_PROBE_EXIT.usage;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
