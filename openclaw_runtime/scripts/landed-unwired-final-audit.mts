/**
 * TF-0463: final closeout audit for the landed-unwired wiring lane.
 *
 * Reads the authoritative production flag catalog, verifies every executor site
 * on disk, and writes an agent-driven audit report. No human traffic is claimed.
 *
 * Run from repo root:
 *   pnpm --dir openclaw_runtime exec tsx scripts/landed-unwired-final-audit.mts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DCS_PROD_FLAGS } from "../../shared/dcs/prod-flags-catalog.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "harness/specs/fixtures/landed-unwired-closeout");

type SiteAudit = {
  site: string;
  fileExists: true;
  lineInRange: true;
  lineText: string;
  fileSha256: string;
};

type EntryAudit = {
  id: string;
  wave: string;
  kind: string;
  risk: string;
  executorStatus: "wired" | "pending-wiring" | "missing";
  sites: SiteAudit[];
  deliberateNotWiredReason?: string;
};

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function auditSite(site: string): SiteAudit {
  const separator = site.lastIndexOf(":");
  if (separator <= 0) {
    throw new Error(`invalid executor site: ${site}`);
  }
  const relativePath = site.slice(0, separator);
  const lineText = site.slice(separator + 1);
  const lineNumber = Number(lineText);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(`invalid executor line number: ${site}`);
  }
  const absolutePath = path.join(repoRoot, relativePath);
  const content = readFileSync(absolutePath, "utf8");
  const lines = content.split(/\r?\n/u);
  if (lineNumber > lines.length) {
    throw new Error(`executor line out of range: ${site}`);
  }
  const line = lines[lineNumber - 1]?.trim() ?? "";
  if (!line) {
    throw new Error(`executor line is blank: ${site}`);
  }
  return {
    site,
    fileExists: true,
    lineInRange: true,
    lineText: line,
    fileSha256: sha256(content),
  };
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const entries: EntryAudit[] = [];
  for (const flag of DCS_PROD_FLAGS) {
    const status = flag.executor?.status ?? "missing";
    const sites = flag.executor?.status === "wired"
      ? (flag.executor.sites ?? []).map(auditSite)
      : [];
    entries.push({
      id: flag.id,
      wave: flag.wave,
      kind: flag.kind,
      risk: flag.risk,
      executorStatus: status,
      sites,
      ...(flag.executor?.status === "pending-wiring"
        ? { deliberateNotWiredReason: flag.executor.reason }
        : {}),
    });
  }

  const wiredCount = entries.filter((entry) => entry.executorStatus === "wired").length;
  const pendingCount = entries.filter((entry) => entry.executorStatus === "pending-wiring").length;
  const missingCount = entries.filter((entry) => entry.executorStatus === "missing").length;
  const generatedAt = new Date().toISOString();

  const report = {
    schemaVersion: 1,
    driven_by: "agent",
    actor: "codex",
    generatedAt,
    task: "TF-0463",
    totalEntries: entries.length,
    wiredCount,
    pendingCount,
    missingCount,
    trueUnwiredCount: missingCount,
    allSitesVerified: entries.every(
      (entry) =>
        entry.executorStatus === "pending-wiring" ||
        (entry.executorStatus === "wired" && entry.sites.length > 0),
    ),
    catalogSha256: sha256(
      readFileSync(path.join(repoRoot, "shared/dcs/prod-flags-catalog.ts"), "utf8"),
    ),
    entries,
    lineage: [
      { taskId: "TF-0454", title: "消灭 landed-unwired", status: "in_progress" },
      { taskId: "TF-0455", title: "接线裁定", status: "done" },
      { taskId: "TF-0456", title: "P0 目录漂移", commit: "5cb76bc0b", status: "done" },
      { taskId: "TF-0457", title: "executor 硬门禁", commit: "e99e51e62", status: "done" },
      { taskId: "TF-0458", title: "sekb-experience-shadow", commit: "21b1ab79a", status: "done" },
      { taskId: "TF-0459", title: "patch-flow advisory", commit: "be19c3c66", status: "done" },
      { taskId: "TF-0460", title: "patch-flow execution", commit: "d9d4f4227", status: "done" },
      { taskId: "TF-0461", title: "context-ladder migration", commit: "34e0263a2", status: "done" },
      { taskId: "TF-0462", title: "context-ladder assembler", commits: ["2d9cc81b7", "899ef0eae"], status: "done" },
      { taskId: "TF-0463", title: "final audit", status: "done" },
    ],
    notes: [
      "Every wired executor site was read from disk with its file SHA256 and line text.",
      "Pending-wiring entries, if any, must carry a deliberate reason.",
      "No human traffic or real-human evidence is claimed.",
    ],
  };

  writeFileSync(
    path.join(outDir, "audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  const markdown = [
    "# Landed-Unwired Final Audit",
    "",
    `- Generated at: ${generatedAt}`,
    "- Driven by: agent (codex)",
    `- Total entries: ${entries.length}`,
    `- Wired: ${wiredCount}`,
    `- Pending-wiring: ${pendingCount}`,
    `- Missing executor: ${missingCount}`,
    `- True unwired count: ${missingCount}`,
    "",
    "| ID | Wave | Kind | Risk | Executor | Sites |",
    "|---|---|---|---|---|---|",
    ...entries.map((entry) => {
      const sites = entry.sites.length > 0
        ? entry.sites.map((site) => `\`${site.site}\``).join(", ")
        : entry.deliberateNotWiredReason
          ? `deliberate: ${entry.deliberateNotWiredReason}`
          : "—";
      return `| ${entry.id} | ${entry.wave} | ${entry.kind} | ${entry.risk} | ${entry.executorStatus} | ${sites} |`;
    }),
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "report.md"), `${markdown}\n`, "utf8");

  console.log(JSON.stringify({
    totalEntries: entries.length,
    wiredCount,
    pendingCount,
    missingCount,
    allSitesVerified: report.allSitesVerified,
  }, null, 2));
}

main();
