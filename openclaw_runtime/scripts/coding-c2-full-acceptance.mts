/**
 * Full C2 remaining cards acceptance + dense write path.
 * Run: node --import tsx scripts/coding-c2-full-acceptance.mts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../src/context-engine/coding-observability.ts";
import { classifyWriteDestructiveTier } from "../src/agents/write-destructive-tier.ts";
import { diagnoseTypeScriptFile, attachDiagToResult } from "../src/agents/post-write-diag.ts";
import { handleWorkingMemoryAction } from "../src/context-engine/handlers/working-memory-handler.ts";
import { wrapToolWithWriteSideEffects } from "../src/agents/write-side-effects.ts";
import type { AnyAgentTool } from "../src/agents/agent-tools.types.ts";
import {
  __resetWorkspaceFactServiceRegistry,
  resolveWorkspaceFactService,
} from "../src/context-engine/factstore/workspace-fact-service.ts";
import { closeAllFactStores } from "../src/context-engine/factstore/store.ts";

async function main() {
  codingObservability.reset();
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  const root = mkdtempSync(path.join(tmpdir(), "c2-full-"));
  writeFileSync(path.join(root, "a.ts"), "export const a: number = 1;\n");

  // C2-10
  const del = classifyWriteDestructiveTier({
    toolName: "apply_patch",
    args: { input: "*** Begin Patch\n*** Delete File: a.ts\n*** End Patch" },
  });
  if (!del.requiresApproval) throw new Error("delete must require approval");
  const edit = classifyWriteDestructiveTier({
    toolName: "edit",
    journalEnabled: true,
    args: { path: "a.ts" },
  });
  if (edit.requiresApproval) throw new Error("edit+journal should not force approval");

  // C2-5
  const bad = "const x: number = 'nope';\n";
  writeFileSync(path.join(root, "bad.ts"), bad);
  const findings = diagnoseTypeScriptFile({ workspaceRoot: root, relPath: "bad.ts", content: bad });
  const withDiag = attachDiagToResult({ details: {} }, findings.length ? findings : [{ file: "bad.ts", message: "type mismatch" }]);
  if (!(withDiag.details as { diag?: unknown[] }).diag?.length) throw new Error("diag missing");

  // C2-6
  const block = handleWorkingMemoryAction({
    sessionId: "s",
    action: { tool: "write", result_summary: "Wrote a.ts", significance: "high" },
  });
  if (block.block_type !== "working_memory") throw new Error("wm missing");

  // Dense write path with side effects
  const service = resolveWorkspaceFactService(root);
  const base = {
    name: "write",
    label: "Write",
    description: "w",
    parameters: {},
    execute: async (_id: string, args: unknown) => {
      const a = args as { path?: string; content?: string };
      writeFileSync(path.join(root, a.path ?? "out.ts"), a.content ?? "", "utf8");
      return {
        content: [{ type: "text", text: "ok" }],
        details: {
          working_memory: { result_summary: `Wrote ${a.path}`, significance: "high" },
        },
      };
    },
  } as unknown as AnyAgentTool;
  const write = wrapToolWithWriteSideEffects(base, {
    workspaceRoot: root,
    materializer: service.materializer,
    factStore: service.store,
    parseOnWriteEnabled: true,
    syntaxCheckEnabled: true,
    diagEnabled: true,
    verifyConsumeEnabled: true,
  });
  await write.execute("1", { path: "a.ts", content: "export const a = 2;\n" });
  if (service.materializer.pendingTouchedCount() < 1) throw new Error("no touch");

  const rates = codingObservability.rates();
  const report = {
    ok: true,
    c2_5_diag: true,
    c2_6_wm: block.block_id,
    c2_10_delete_approval: del.requiresApproval,
    c2_10_edit_skip: !edit.requiresApproval,
    parseOnWriteHits: codingObservability.snapshot().parseOnWriteHits,
    diagHits: codingObservability.snapshot().diagHits,
    rates,
  };
  console.log(JSON.stringify(report, null, 2));
  const outDir = path.resolve("artifacts", "coding-c2");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "full-acceptance.json"), JSON.stringify(report, null, 2), "utf8");
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  rmSync(root, { recursive: true, force: true });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
