#!/usr/bin/env node
/**
 * SEKB local flag + inventory helper (CLI only, no GUI).
 *
 * Default: inventory / status only (does NOT enable SEKB).
 * Opt-in enable / disable only when explicitly requested.
 *
 * Usage:
 *   node scripts/sekb-enable-shadow-local.mjs
 *   node scripts/sekb-enable-shadow-local.mjs --inventory
 *   node scripts/sekb-enable-shadow-local.mjs --enable
 *   node scripts/sekb-enable-shadow-local.mjs --enable --target electron
 *   node scripts/sekb-enable-shadow-local.mjs --disable
 *   node scripts/sekb-enable-shadow-local.mjs --disable --target all
 *
 * Notes:
 * - Does not enable batch distillation, Phase C scheduler, or Phase D filtering.
 * - configure-deepseek remains independent; use --enable-sekb-shadow there.
 * - pnpm sekb:a5:inventory must stay inventory-only (no flag mutation).
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const electronStateDir = path.join(process.env.APPDATA || "", "Electron", "openclaw-source-state");
const electronCfg = path.join(electronStateDir, "openclaw.json");
const electronDb = path.join(electronStateDir, "state", "openclaw.sqlite");
const homeStateDir = path.join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw");
const homeCfg = path.join(homeStateDir, "openclaw.json");
const homeDb = path.join(homeStateDir, "state", "openclaw.sqlite");

function parseArgs(argv) {
  const options = {
    enable: false,
    disable: false,
    inventory: true,
    target: "electron", // electron | home | all
    shadow: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/sekb-enable-shadow-local.mjs [--inventory]
  node scripts/sekb-enable-shadow-local.mjs --enable [--target electron|home|all] [--no-shadow]
  node scripts/sekb-enable-shadow-local.mjs --disable [--target electron|home|all]

Default is inventory-only. Explicit --enable / --disable is required to mutate flags.
Batch / Phase C / Phase D stay off.`);
      process.exit(0);
    }
    if (arg === "--enable") {
      options.enable = true;
      continue;
    }
    if (arg === "--disable") {
      options.disable = true;
      continue;
    }
    if (arg === "--inventory") {
      options.inventory = true;
      continue;
    }
    if (arg === "--no-shadow") {
      options.shadow = false;
      continue;
    }
    if (arg === "--target") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --target");
      }
      i += 1;
      if (!["electron", "home", "all"].includes(value)) {
        throw new Error("--target must be electron|home|all");
      }
      options.target = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (options.enable && options.disable) {
    throw new Error("Pass only one of --enable or --disable");
  }
  return options;
}

function readCfg(cfgPath) {
  if (!existsSync(cfgPath)) return null;
  return JSON.parse(readFileSync(cfgPath, "utf8"));
}

function writeCfg(cfgPath, cfg) {
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

function sekbSlice(cfg) {
  return cfg?.runtime?.contextBlock?.sekb ?? null;
}

function mutateSekb(cfgPath, mode, shadowEnabled) {
  if (!existsSync(cfgPath)) {
    return { path: cfgPath, skipped: true, reason: "missing" };
  }
  const cfg = readCfg(cfgPath);
  cfg.runtime = cfg.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};
  cfg.runtime.contextBlock =
    cfg.runtime.contextBlock && typeof cfg.runtime.contextBlock === "object"
      ? cfg.runtime.contextBlock
      : {};
  const previous =
    cfg.runtime.contextBlock.sekb && typeof cfg.runtime.contextBlock.sekb === "object"
      ? cfg.runtime.contextBlock.sekb
      : {};

  if (mode === "enable") {
    cfg.runtime.contextBlock.sekb = {
      ...previous,
      enabled: true,
      // Keep batch off for grayscale capture + report only.
      batchDistillationAssistant: {
        ...(previous.batchDistillationAssistant && typeof previous.batchDistillationAssistant === "object"
          ? previous.batchDistillationAssistant
          : {}),
        enabled: false,
      },
      shadowEvaluation: {
        ...(previous.shadowEvaluation && typeof previous.shadowEvaluation === "object"
          ? previous.shadowEvaluation
          : {}),
        enabled: shadowEnabled,
      },
    };
  } else if (mode === "disable") {
    cfg.runtime.contextBlock.sekb = {
      ...previous,
      enabled: false,
      shadowEvaluation: {
        ...(previous.shadowEvaluation && typeof previous.shadowEvaluation === "object"
          ? previous.shadowEvaluation
          : {}),
        enabled: false,
      },
      batchDistillationAssistant: {
        ...(previous.batchDistillationAssistant && typeof previous.batchDistillationAssistant === "object"
          ? previous.batchDistillationAssistant
          : {}),
        enabled: false,
      },
    };
  }

  writeCfg(cfgPath, cfg);
  return {
    path: cfgPath,
    skipped: false,
    mode,
    sekb: sekbSlice(cfg),
  };
}

function inventory(dbPath, label) {
  if (!existsSync(dbPath)) {
    return { label, path: dbPath, exists: false };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sekb%'")
    .all()
    .map((row) => row.name);
  const counts = {};
  for (const name of tables) {
    counts[name] = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;
  }
  let bytes = null;
  try {
    bytes = statSync(dbPath).size;
  } catch {
    bytes = null;
  }
  db.close();
  return { label, path: dbPath, exists: true, tables, counts, bytes };
}

function targetsFor(target) {
  if (target === "home") return [{ cfg: homeCfg, label: "home" }];
  if (target === "all") {
    return [
      { cfg: electronCfg, label: "electron" },
      { cfg: homeCfg, label: "home" },
    ];
  }
  return [{ cfg: electronCfg, label: "electron" }];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const mutations = [];

  if (options.enable || options.disable) {
    const mode = options.enable ? "enable" : "disable";
    for (const entry of targetsFor(options.target)) {
      mutations.push({
        label: entry.label,
        ...mutateSekb(entry.cfg, mode, options.shadow),
      });
    }
  }

  const electronCfgPresent = existsSync(electronCfg);
  const homeCfgPresent = existsSync(homeCfg);
  const electronSekb = electronCfgPresent ? sekbSlice(readCfg(electronCfg)) : null;
  const homeSekb = homeCfgPresent ? sekbSlice(readCfg(homeCfg)) : null;

  const result = {
    authority: "local_ops_inventory_not_runtime_source_of_truth",
    mode: options.enable ? "enable" : options.disable ? "disable" : "inventory",
    mutated: mutations.length > 0,
    mutations,
    flags: {
      electron: {
        path: electronCfg,
        exists: electronCfgPresent,
        sekb: electronSekb,
      },
      home: {
        path: homeCfg,
        exists: homeCfgPresent,
        sekb: homeSekb,
      },
    },
    inventory: [inventory(electronDb, "electron-source-state"), inventory(homeDb, "home-openclaw")],
    notes: [
      "Default mode is inventory-only; pass --enable or --disable to mutate flags.",
      "pnpm dev Gateway uses Electron openclaw-source-state, not ~/.openclaw/state by default.",
      "Phase C/D and batch distillation remain off for grayscale observation.",
      "Rollback: node scripts/sekb-enable-shadow-local.mjs --disable",
    ],
  };
  console.log(JSON.stringify(result, null, 2));
}

main();
