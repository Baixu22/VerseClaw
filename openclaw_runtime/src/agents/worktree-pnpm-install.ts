/**
 * C4-P: pnpm hardlink-aware worktree dependency install (opt-in).
 *
 * Default strategy is "none" — createWorktreeService never installs unless asked.
 * hardlink-modules: prefer hardlinks from base node_modules (pnpm-store style reuse).
 * pnpm-install: run pnpm install --prefer-offline (uses store hardlinks when available).
 *
 * Does NOT flip worktree.backend or isolation defaults.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Capability marker: C4-P hardlink install path is implemented (still opt-in). */
export const PRODUCTION_PNPM_HARDLINK_INSTALL = true as const;

export type WorktreeInstallStrategy = "none" | "hardlink-modules" | "pnpm-install";

export type WorktreeInstallResult = {
  ok: boolean;
  strategy: WorktreeInstallStrategy;
  hardlinksCreated: number;
  symlinksCreated: number;
  filesCopied: number;
  dirsCreated: number;
  pnpmRan: boolean;
  notes: string[];
};

export type InstallWorktreeDependenciesParams = {
  worktreeRoot: string;
  baseRoot: string;
  strategy?: WorktreeInstallStrategy;
  /** Max file hardlinks/copies for hardlink-modules (safety). Default 5000. */
  maxFiles?: number;
  /** Inject pnpm runner for tests. */
  execPnpm?: (args: string[], cwd: string) => void;
};

function walkAndLink(
  srcDir: string,
  destDir: string,
  counters: {
    hardlinksCreated: number;
    symlinksCreated: number;
    filesCopied: number;
    dirsCreated: number;
    filesSeen: number;
  },
  maxFiles: number,
  notes: string[],
): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  counters.dirsCreated += 1;

  for (const name of readdirSync(srcDir)) {
    if (counters.filesSeen >= maxFiles) {
      notes.push(`maxFiles=${maxFiles} reached; remaining entries skipped`);
      return;
    }
    const src = path.join(srcDir, name);
    const dest = path.join(destDir, name);
    let st;
    try {
      st = lstatSync(src);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkAndLink(src, dest, counters, maxFiles, notes);
      continue;
    }
    counters.filesSeen += 1;
    if (st.isSymbolicLink()) {
      try {
        const target = readlinkSync(src);
        symlinkSync(target, dest);
        counters.symlinksCreated += 1;
      } catch {
        try {
          copyFileSync(src, dest);
          counters.filesCopied += 1;
        } catch {
          // skip broken links
        }
      }
      continue;
    }
    if (!st.isFile()) continue;
    try {
      linkSync(src, dest);
      counters.hardlinksCreated += 1;
    } catch {
      try {
        copyFileSync(src, dest);
        counters.filesCopied += 1;
      } catch (err) {
        notes.push(`copy failed ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

function defaultExecPnpm(args: string[], cwd: string): void {
  execFileSync("pnpm", args, {
    cwd,
    stdio: "pipe",
    env: process.env,
    windowsHide: true,
  });
}

/**
 * Install / materialize dependencies into a worktree root.
 * strategy "none" is a no-op success (safe default).
 */
export function installWorktreeDependencies(
  params: InstallWorktreeDependenciesParams,
): WorktreeInstallResult {
  const strategy = params.strategy ?? "none";
  const notes: string[] = [];
  const result: WorktreeInstallResult = {
    ok: true,
    strategy,
    hardlinksCreated: 0,
    symlinksCreated: 0,
    filesCopied: 0,
    dirsCreated: 0,
    pnpmRan: false,
    notes,
  };

  if (strategy === "none") {
    notes.push("strategy=none: no install performed (safe default)");
    return result;
  }

  const worktreeRoot = path.resolve(params.worktreeRoot);
  const baseRoot = path.resolve(params.baseRoot);
  mkdirSync(worktreeRoot, { recursive: true });

  if (strategy === "hardlink-modules") {
    const srcNm = path.join(baseRoot, "node_modules");
    const destNm = path.join(worktreeRoot, "node_modules");
    if (!existsSync(srcNm)) {
      notes.push("base node_modules missing; hardlink-modules no-op with ok=false");
      result.ok = false;
      return result;
    }
    const counters = {
      hardlinksCreated: 0,
      symlinksCreated: 0,
      filesCopied: 0,
      dirsCreated: 0,
      filesSeen: 0,
    };
    walkAndLink(srcNm, destNm, counters, params.maxFiles ?? 5000, notes);
    result.hardlinksCreated = counters.hardlinksCreated;
    result.symlinksCreated = counters.symlinksCreated;
    result.filesCopied = counters.filesCopied;
    result.dirsCreated = counters.dirsCreated;
    notes.push(
      `hardlink-modules: hardlinks=${counters.hardlinksCreated} copies=${counters.filesCopied} symlinks=${counters.symlinksCreated}`,
    );
    result.ok = counters.hardlinksCreated + counters.filesCopied + counters.symlinksCreated > 0;
    if (!result.ok) notes.push("no files linked or copied from base node_modules");
    return result;
  }

  // pnpm-install
  const lock =
    existsSync(path.join(worktreeRoot, "pnpm-lock.yaml")) ||
    existsSync(path.join(baseRoot, "pnpm-lock.yaml"));
  // Ensure package.json exists in worktree for install smoke (copy minimal marker if absent)
  const wtPkg = path.join(worktreeRoot, "package.json");
  if (!existsSync(wtPkg) && existsSync(path.join(baseRoot, "package.json"))) {
    try {
      linkSync(path.join(baseRoot, "package.json"), wtPkg);
      result.hardlinksCreated += 1;
    } catch {
      try {
        copyFileSync(path.join(baseRoot, "package.json"), wtPkg);
        result.filesCopied += 1;
      } catch {
        notes.push("could not materialize package.json into worktree");
      }
    }
  }
  if (existsSync(path.join(baseRoot, "pnpm-lock.yaml")) && !existsSync(path.join(worktreeRoot, "pnpm-lock.yaml"))) {
    try {
      linkSync(path.join(baseRoot, "pnpm-lock.yaml"), path.join(worktreeRoot, "pnpm-lock.yaml"));
      result.hardlinksCreated += 1;
    } catch {
      try {
        copyFileSync(path.join(baseRoot, "pnpm-lock.yaml"), path.join(worktreeRoot, "pnpm-lock.yaml"));
        result.filesCopied += 1;
      } catch {
        // ignore
      }
    }
  }

  const args = ["install", "--prefer-offline"];
  if (lock) args.push("--frozen-lockfile");
  const run = params.execPnpm ?? defaultExecPnpm;
  try {
    run(args, worktreeRoot);
    result.pnpmRan = true;
    notes.push(`pnpm ${args.join(" ")} ok (store hardlinks when supported)`);
  } catch (err) {
    result.ok = false;
    result.pnpmRan = true;
    notes.push(`pnpm install failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

/**
 * Test helper: write a tiny fake node_modules tree under baseRoot for hardlink tests.
 */
export function seedFakeNodeModules(
  root: string,
  files: Record<string, string>,
): void {
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(root, "node_modules", ...rel.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content, "utf8");
  }
}