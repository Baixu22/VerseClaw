#!/usr/bin/env node

// Validates OpenGrep rulepack metadata (security/opengrep/*.yml) so the
// aggregate check gate stays meaningful without hard-coding the rulepack in
// this script.
//
// The rulepack is optional in this repo: the scanner (scripts/run-opengrep.sh)
// degrades to a clear "recompile" error when the rulepack is absent, and there
// is no committed rulepack today. When the directory is absent this check
// passes (exit 0) with a notice; when present it validates:
//   - every *.yml rule file parses as YAML with a top-level `rules` array
//   - every rule carries id, message, severity, and languages
//   - every referenced rule id is unique across the pack
//
// Usage:
//   node scripts/check-opengrep-rule-metadata.mjs [--rules-dir <dir>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const REQUIRED_RULE_FIELDS = ["id", "message", "severity", "languages"];

function usage() {
  return ["Usage: node scripts/check-opengrep-rule-metadata.mjs [--rules-dir <dir>]", ""].join(
    "\n",
  );
}

/**
 * Validates one rulepack directory's rule metadata.
 */
export function validateRulepack(rulesDir) {
  const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  const ruleFiles = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/iu.test(entry.name))
    .map((entry) => path.join(rulesDir, entry.name));
  if (ruleFiles.length === 0) {
    return { ok: false, errors: [`no *.yml rule files in ${rulesDir}`], ruleCount: 0 };
  }

  const errors = [];
  const seenIds = new Set();
  let ruleCount = 0;
  for (const ruleFile of ruleFiles) {
    const content = fs.readFileSync(ruleFile, "utf8");
    let parsed;
    try {
      parsed = parseYaml(content);
    } catch (error) {
      errors.push(`${path.relative(repoRoot, ruleFile)}: invalid YAML (${String(error)})`);
      continue;
    }
    const rules = parsed?.rules;
    if (!Array.isArray(rules)) {
      errors.push(`${path.relative(repoRoot, ruleFile)}: missing top-level "rules" array`);
      continue;
    }
    for (const rule of rules) {
      ruleCount += 1;
      const missing = REQUIRED_RULE_FIELDS.filter((field) => !rule?.[field]);
      if (missing.length > 0) {
        errors.push(
          `${path.relative(repoRoot, ruleFile)}: rule ${JSON.stringify(rule?.id ?? "<unnamed>")} missing ${missing.join(", ")}`,
        );
      }
      const ruleId = rule?.id;
      if (ruleId && seenIds.has(ruleId)) {
        errors.push(`duplicate rule id ${JSON.stringify(ruleId)}`);
      }
      if (ruleId) {
        seenIds.add(ruleId);
      }
    }
  }
  return { ok: errors.length === 0, errors, ruleCount };
}

export async function main(argv = process.argv.slice(2)) {
  let rulesDir = path.join(repoRoot, "security", "opengrep");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--rules-dir") {
      const value = argv[index + 1];
      if (!value) {
        console.error(usage());
        process.exitCode = 2;
        return;
      }
      rulesDir = path.resolve(repoRoot, value);
      index += 1;
      continue;
    }
    if (argv[index] === "--help" || argv[index] === "-h") {
      console.log(usage());
      process.exitCode = 0;
      return;
    }
    console.error(`unknown argument: ${argv[index]}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  // The rulepack is optional in this repo (see scripts/run-opengrep.sh for the
  // scanner-side degradation). Absence is not a violation.
  if (!fs.existsSync(rulesDir)) {
    console.log(
      `check-opengrep-rule-metadata: no rulepack at ${path.relative(repoRoot, rulesDir) || "security/opengrep"} — skipped (ok)`,
    );
    return;
  }

  const result = validateRulepack(rulesDir);
  if (result.ok) {
    console.log(
      `check-opengrep-rule-metadata: OK (${result.ruleCount} rules in ${path.relative(repoRoot, rulesDir)})`,
    );
    return;
  }
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(
    /** @param {unknown} error */ (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
