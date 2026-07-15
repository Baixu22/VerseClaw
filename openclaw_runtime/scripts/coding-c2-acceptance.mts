/**
 * C2 closed-loop acceptance: parse-on-write, syntax check, stale guard, journal.
 * Run: node --import tsx scripts/coding-c2-acceptance.mts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { wrapToolWithWriteSideEffects } from "../src/agents/write-side-effects.ts";
import { wrapToolWithStaleWriteGuard, StaleWriteError } from "../src/agents/stale-write-guard.ts";
import {
  __resetWriteJournals,
  createUndoWriteTool,
  wrapToolWithWriteJournal,
} from "../src/agents/tools/write-journal.ts";
import {
  hashFileContent,
  recordSessionReadHash,
  __resetSessionReadHashes,
} from "../src/agents/session-read-hashes.ts";
import {
  __resetWorkspaceFactServiceRegistry,
  resolveWorkspaceFactService,
} from "../src/context-engine/factstore/workspace-fact-service.ts";
import { closeAllFactStores } from "../src/context-engine/factstore/store.ts";
import { codingObservability } from "../src/context-engine/coding-observability.ts";
import type { AnyAgentTool } from "../src/agents/agent-tools.types.ts";

function makeWrite(execute: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name: "write",
    label: "Write",
    description: "write",
    parameters: {},
    execute,
  } as unknown as AnyAgentTool;
}

async function main(): Promise<void> {
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  __resetSessionReadHashes();
  __resetWriteJournals();
  codingObservability.reset();

  const repoRoot = mkdtempSync(path.join(tmpdir(), "c2-accept-"));
  mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  const target = path.join(repoRoot, "src", "util.ts");
  writeFileSync(target, "export function util() { return 1; }\n", "utf8");

  const service = resolveWorkspaceFactService(repoRoot);
  const sessionId = "c2-accept-session";

  const base = makeWrite(async (_id, args) => {
    const content = String((args as { content?: string }).content ?? "");
    const filePath = String((args as { path?: string }).path ?? "");
    const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
    writeFileSync(abs, content, "utf8");
    return { content: [{ type: "text", text: "ok" }], details: {} };
  });

  let write = wrapToolWithWriteJournal(base, {
    workspaceRoot: repoRoot,
    sessionId,
    enabled: true,
  });
  write = wrapToolWithStaleWriteGuard(write, {
    workspaceRoot: repoRoot,
    sessionId,
    enabled: true,
    factStore: service.store,
  });
  write = wrapToolWithWriteSideEffects(write, {
    workspaceRoot: repoRoot,
    materializer: service.materializer,
    parseOnWriteEnabled: true,
    syntaxCheckEnabled: true,
  });

  const good = await write.execute("w1", {
    path: "src/util.ts",
    content: "export function util() { return 2; }\n",
  });
  if (service.materializer.pendingTouchedCount() < 1) {
    throw new Error("parse-on-write did not touch");
  }
  const goodDetails = good.details as {
    write_journal?: { undoable?: boolean };
    syntax_check?: string;
  };
  if (!goodDetails.write_journal?.undoable) {
    throw new Error("journal missing undoable mark");
  }
  if (goodDetails.syntax_check) {
    throw new Error("unexpected syntax_check on good write");
  }

  const badContent = "export function util( { return 3;\n";
  const bad = await write.execute("w2", {
    path: "src/util.ts",
    content: badContent,
  });
  const badDetails = bad.details as { syntax_check?: string };
  if (!badDetails.syntax_check?.startsWith("failed(")) {
    throw new Error(`expected syntax_check failed, got ${badDetails.syntax_check}`);
  }

  const undo = createUndoWriteTool({
    workspaceRoot: repoRoot,
    sessionId,
    enabled: true,
  });
  if (!undo) throw new Error("undo tool missing");
  await undo.execute("u1", { steps: 1 });
  const afterUndo = readFileSync(target, "utf8");
  if (afterUndo !== "export function util() { return 2; }\n") {
    throw new Error(`undo failed, content=${JSON.stringify(afterUndo)}`);
  }

  recordSessionReadHash(sessionId, "src/util.ts", hashFileContent(afterUndo));
  writeFileSync(target, "export function util() { return 99; }\n", "utf8");
  let blocked = false;
  try {
    await write.execute("w3", {
      path: "src/util.ts",
      content: "export function util() { return 4; }\n",
    });
  } catch (error) {
    blocked = error instanceof StaleWriteError || String(error).includes("Stale write");
  }
  if (!blocked) throw new Error("stale write was not blocked");

  const metrics = codingObservability.snapshot();
  const rates = codingObservability.rates();
  const report = {
    ok: true,
    parseOnWriteHits: metrics.parseOnWriteHits,
    syntaxCheckHits: metrics.syntaxCheckHits,
    staleBlocks: metrics.staleBlocks,
    journalSnapshots: metrics.journalSnapshots,
    undoCount: metrics.undoCount,
    journalLatencyMsMax: metrics.journalLatencyMsMax,
    rates,
  };
  console.log(JSON.stringify(report, null, 2));

  const outDir = path.resolve("artifacts", "coding-c2");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(report, null, 2), "utf8");

  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  __resetSessionReadHashes();
  __resetWriteJournals();
  rmSync(repoRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});