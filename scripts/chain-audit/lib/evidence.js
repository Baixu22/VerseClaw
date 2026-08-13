#!/usr/bin/env node
/**
 * chain-audit evidence binding.
 * Every report is bound to the exact code/config that produced it, so a green
 * score can be traced back to HEAD/tree/build/config digests instead of an
 * anonymous run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function git(repoRoot, args) {
  try {
    const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

export function collectEnvironment(repoRoot, matrixText, rpcText) {
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  const branch = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git(repoRoot, ["status", "--porcelain=v1"]);
  const dirtyPaths = status ? status.split("\n").filter(Boolean) : [];
  const runtimeEntry = join(repoRoot, "openclaw_runtime", "dist", "entry.js");
  const stampPath = join(repoRoot, "openclaw_runtime", "dist", "build-stamp.json");
  let runtimeBuildStamp = null;
  if (existsSync(stampPath)) {
    try { runtimeBuildStamp = JSON.parse(readFileSync(stampPath, "utf8")); } catch { /* ignore */ }
  }
  return {
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    head,
    branch,
    treeDirty: dirtyPaths.length > 0,
    dirtyPathCount: dirtyPaths.length,
    dirtyPaths: dirtyPaths.slice(0, 50),
    matrixDigest: sha256(matrixText),
    rpcDigest: sha256(rpcText),
    runtimeEntryMtimeMs: existsSync(runtimeEntry) ? statSync(runtimeEntry).mtimeMs : null,
    runtimeBuildStamp,
  };
}
