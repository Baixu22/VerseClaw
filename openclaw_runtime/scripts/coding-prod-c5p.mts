/**
 * Goal C / C5-P: patch-flow default orchestration residual (keep-off).
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, writeFileSync as w } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { assessPatchFlowDefaultGraduation } from "../src/agents/patch-flow-graduation.ts";
import {
  isCodingPatchFlowDefault,
  isCodingSymbolLeaseEnabled,
  resolveSymbolLeaseMode,
} from "../src/context-engine/coding-runtime-flags.ts";
import { MULTI_PROCESS_WAL_HARDENED } from "../src/context-engine/factstore/symbol-lease.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-c5p");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const root = mkdtempSync(path.join(tmpdir(), "c5p-accept-"));
  try {
    w(path.join(root, "t.txt"), "x\n");
    assert(isCodingPatchFlowDefault() === false, "patchFlow default false");
    assert(isCodingSymbolLeaseEnabled() === false, "lease default false");
    assert(resolveSymbolLeaseMode() === "memory", "lease mode memory");
    assert(MULTI_PROCESS_WAL_HARDENED === true, "C5-H hardened still true");

    const decision = await assessPatchFlowDefaultGraduation({
      productSoakApproved: false,
      cwdForSmoke: root,
    });
    assert(decision.patchFlowDefault === false, "decision default false");
    assert(decision.recommendation === "keep-off", "keep-off");
    assert(decision.meetsGate === false, "meetsGate false");
    assert(decision.defaultsUnchanged === true, "defaults unchanged");

    const acceptance = {
      ok: true,
      card: "C5-P",
      completionClass: decision.completionClass,
      patchFlowDefault: false,
      recommendation: decision.recommendation,
      meetsGate: false,
      capabilityReady: decision.capabilityReady,
      multiProcessWalHardened: true,
      symbolLeaseDefault: false,
      defaultsUnchanged: true,
      residual: decision.residual,
      howToOptIn: decision.howToOptIn,
      sha: gitShortSha(),
      ts: new Date().toISOString(),
    };

    writeFileSync(path.join(outDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n");
    writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(acceptance, null, 2) + "\n");
    writeFileSync(
      path.join(outDir, "gates.json"),
      JSON.stringify(
        {
          ok: true,
          patchFlowDefault: false,
          recommendation: "keep-off",
          meetsGate: false,
          noDefaultFlagFlip: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify(acceptance, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});