/**
 * T-C1 (TF-0128) A2-fix per lane-2 review 47cb57a81: the config form of the
 * enhancement kill switch must reach the shadow audit gate at the production
 * call site.
 *
 * The production wiring is
 *   isCompactionDamageAuditEnabled(resolveKillSwitchConfig(process.env), process.env)
 * in compaction-safeguard.ts. Before the A2 fix the call site passed a
 * hardcoded `undefined` as the config, so an operator engaging
 * `runtime.contextEnhancement.killSwitch` in openclaw.json stopped the
 * assembler/enhancements but not this shadow audit (the env form of the kill
 * switch worked; the config form did not).
 *
 * This test exercises the exact production wiring against a real config file,
 * which needs the filesystem; it therefore lives outside the unit-fast shard
 * (classified `filesystem-state`), alongside compaction-safeguard-p6.test.ts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPACTION_DAMAGE_AUDIT_ENV,
  isCompactionDamageAuditEnabled,
} from "./compaction-damage-rules.js";
import {
  resetKillSwitchConfigCache,
  resolveKillSwitchConfig,
} from "../../context-engine/kill-switch-config-source.js";

let tempDir: string | undefined;

afterEach(() => {
  resetKillSwitchConfigCache();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("T-C1 A2-fix: config-form kill switch reaches the production audit gate", () => {
  it("stays off when the on-disk config engages the kill switch, even with the audit env on", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf0128-killswitch-"));
    const configPath = path.join(tempDir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ runtime: { contextEnhancement: { killSwitch: true } } }),
      "utf-8",
    );
    resetKillSwitchConfigCache();
    const env = {
      [COMPACTION_DAMAGE_AUDIT_ENV]: "1",
      OPENCLAW_CONFIG_PATH: configPath,
    };
    expect(isCompactionDamageAuditEnabled(resolveKillSwitchConfig(env), env)).toBe(false);
  });

  it("control: with the kill switch absent the same wiring resolves to on", () => {
    // Proves the resolved config actually reaches the gate (the previous
    // assertion is not vacuously false because of an unreadable config).
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf0128-killswitch-"));
    const configPath = path.join(tempDir, "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify({ runtime: {} }), "utf-8");
    resetKillSwitchConfigCache();
    const env = {
      [COMPACTION_DAMAGE_AUDIT_ENV]: "1",
      OPENCLAW_CONFIG_PATH: configPath,
    };
    expect(isCompactionDamageAuditEnabled(resolveKillSwitchConfig(env), env)).toBe(true);
  });
});
