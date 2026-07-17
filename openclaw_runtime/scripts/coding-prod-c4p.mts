/**
 * Goal C / C4-P: pnpm hardlink worktree install acceptance (opt-in).
 * Defaults: isolation shared, backend inprocess, install strategy none.
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  PRODUCTION_GIT_WORKTREE_HARDENED,
  PRODUCTION_PNPM_HARDLINK_INSTALL,
} from "../src/agents/worktree-service.ts";
import {
  installWorktreeDependencies,
  seedFakeNodeModules,
} from "../src/agents/worktree-pnpm-install.ts";
import { resolveWorktreeBackend } from "../src/context-engine/coding-runtime-flags.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-c4p");

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

function main(): void {
  mkdirSync(outDir, { recursive: true });
  __resetWorktreeRegistry();
  const root = mkdtempSync(path.join(tmpdir(), "c4p-accept-"));
  try {
    assert(PRODUCTION_PNPM_HARDLINK_INSTALL === true, "C4-P capability flag");
    assert(PRODUCTION_GIT_WORKTREE_HARDENED === true, "C4-H still hardened");
    assert(resolveWorktreeBackend() === "inprocess", "backend default inprocess");
    assert(normalizeIsolationMode(undefined) === "shared", "isolation default shared");

    seedFakeNodeModules(root, {
      "demo/package.json": '{"name":"demo"}',
      "demo/index.js": "module.exports=1;\n",
    });

    const none = installWorktreeDependencies({
      worktreeRoot: path.join(root, "wt-none"),
      baseRoot: root,
      strategy: "none",
    });
    assert(none.ok && none.pnpmRan === false, "none strategy no-op");

    const hl = installWorktreeDependencies({
      worktreeRoot: path.join(root, "wt-hl"),
      baseRoot: root,
      strategy: "hardlink-modules",
    });
    assert(hl.ok, "hardlink-modules ok");
    assert(hl.hardlinksCreated + hl.filesCopied >= 2, "linked files");
    assert(
      readFileSync(path.join(root, "wt-hl", "node_modules", "demo", "index.js"), "utf8").includes(
        "module",
      ),
      "content",
    );

    let pnpmArgs: string[] | null = null;
    const pnpm = installWorktreeDependencies({
      worktreeRoot: path.join(root, "wt-pnpm"),
      baseRoot: root,
      strategy: "pnpm-install",
      execPnpm: (args) => {
        pnpmArgs = args;
      },
    });
    assert(pnpm.ok && pnpm.pnpmRan, "pnpm-install injected ok");
    assert(pnpmArgs?.[0] === "install", "pnpm install");
    assert(pnpmArgs?.includes("--prefer-offline") === true, "prefer-offline");

    const svc = createWorktreeService(root);
    const noInstall = svc.create("plain");
    assert((noInstall as { install?: unknown }).install === undefined, "create default no install");
    const withInstall = svc.create("with-hl", { installStrategy: "hardlink-modules" });
    assert(withInstall.install?.ok === true, "create+hardlink");

    const acceptance = {
      ok: true,
      card: "C4-P",
      completionClass: "done (hard)",
      productionPnpmHardlinkInstall: true,
      productionGitWorktreeHardened: true,
      defaultIsolationShared: true,
      backendDefault: "inprocess",
      installDefaultNone: true,
      hardlinkModulesWorks: true,
      pnpmPreferOfflinePath: true,
      defaultsUnchanged: true,
      residual: [
        "worktree.backend remains inprocess by default",
        "installStrategy default none (no auto pnpm on create)",
      ],
      sha: gitShortSha(),
      ts: new Date().toISOString(),
    };

    writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(acceptance, null, 2) + "\n");
    writeFileSync(
      path.join(outDir, "gates.json"),
      JSON.stringify(
        {
          ok: true,
          productionPnpmHardlinkInstall: true,
          backendDefault: "inprocess",
          isolationDefaultShared: true,
          installDefaultNone: true,
          noDefaultFlagFlip: true,
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      path.join(outDir, "report.json"),
      JSON.stringify({ ...acceptance, samples: { none, hl, pnpm } }, null, 2) + "\n",
    );
    console.log(JSON.stringify(acceptance, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
    __resetWorktreeRegistry();
  }
}

main();