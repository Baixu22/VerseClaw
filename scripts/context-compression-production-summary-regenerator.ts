/**
 * P6-A production-summary regeneration probe.
 *
 * Uses the real agent-core compact() path with the updated evidence-fidelity
 * prompts, plus per-sample critic repair guidelines, to generate new production
 * summaries for the frozen production-manifest-30 samples.
 *
 * COMPACTION_API_KEY is read from the environment only and is never written.
 *
 * Run from openclaw_runtime so tsx resolves its node_modules:
 *   pnpm --dir openclaw_runtime exec tsx \
 *     D:/verse_claw_worktree_compact/scripts/context-compression-production-summary-regenerator.ts \
 *     --manifest D:/verse_claw_worktree_compact/reports/context-compression/production-manifest-30.json \
 *     --meta D:/verse_claw_worktree_compact/reports/context-compression/production-summaries-30-generated.meta.json \
 *     --guidelines D:/verse_claw_worktree_compact/reports/context-compression/failure-guidelines-p6-a-phase2-reasoner.json \
 *     --out-dir D:/verse_claw_worktree_compact/artifacts/p6-data-prep/production-summaries-v2/generated \
 *     --out-jsonl D:/verse_claw_worktree_compact/reports/context-compression/production-summaries-30-v2.jsonl \
 *     --limit 3
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import {
  DEFAULT_COMPACTION_SETTINGS,
  compact,
  prepareCompaction,
  type CompactionPreparation,
} from "../openclaw_runtime/packages/agent-core/src/index.js";
import {
  buildRecoveryLedger,
  ledgerText,
} from "./context-compression-recovery-ledger.mjs";

const require = createRequire(import.meta.url);
const sdk = require("../openclaw_runtime/node_modules/openclaw/dist/plugin-sdk/agent-sessions.js");

type Guideline = {
  sampleIds?: string[];
  severity?: string;
  canonicalIdentity?: string;
  repairGuideline?: string;
};

type MetaEntry = {
  sampleId: string;
  file?: string;
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

function providerConfig(): { apiKey: string; baseUrl: string; model: string; provider: string } {
  const compatible = Boolean(process.env.COMPACTION_BASE_URL || process.env.COMPACTION_API_KEY || process.env.COMPACTION_PROVIDER);
  const configuredBaseUrl = (
    process.env.COMPACTION_BASE_URL?.trim()
    || process.env.DEEPSEEK_BASE_URL?.trim()
    || "https://api.deepseek.com/v1"
  ).replace(/\/+$/u, "");
  let baseUrl = configuredBaseUrl;
  try {
    const parsed = new URL(configuredBaseUrl);
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/v1";
    baseUrl = parsed.toString().replace(/\/+$/u, "");
  } catch {
    // Keep the original value so fetch reports the malformed endpoint clearly.
  }
  return {
    apiKey: process.env.COMPACTION_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "",
    baseUrl,
    model: process.env.COMPACTION_MODEL?.trim() || "deepseek-chat",
    provider: process.env.COMPACTION_PROVIDER?.trim() || (compatible ? "openai-compatible" : "deepseek"),
  };
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function buildCustomInstructions(sampleId: string, guidelines: Guideline[], limit = 4): string {
  const sampleGuidelines = guidelines.filter((item) => item.sampleIds?.includes(sampleId));
  if (sampleGuidelines.length === 0) {
    return "Follow the compaction prompt evidence-fidelity rules exactly. Preserve every explicit user deliverable, completed work item, exact error, verification result, and pending next action. Do not state numeric repetition or attempt counts unless you counted each occurrence in the transcript; when uncertain write repeatedly. Do not add unsupported facts, permissions, cost/risk, or intent.";
  }
  const parts = sampleGuidelines.slice(0, limit).map((item) => {
    const identity = (item.canonicalIdentity ?? "").trim().slice(0, 260);
    const repair = (item.repairGuideline ?? "").trim().slice(0, 420);
    return `- [${item.severity ?? "critical"}] Preserve this critic-identified atom: ${identity}${repair ? `\n  Repair: ${repair}` : ""}`;
  });
  return [
    "P6-A critic repair focus for this exact session. Apply these repairs without copying stale or superseded branches:",
    ...parts,
    "Also follow the global rules: do not state numeric repetition or attempt counts unless you counted each occurrence in the transcript and the count is exact; when uncertain write repeatedly. Never invent permissions, cost/risk, or intent not present in the transcript; preserve exact paths, commands, errors, exit codes, test counts, verification evidence, and pending final-report content.",
  ].join("\n");
}

async function completeSimple(messages: any, context: any, options: any) {
  const providerConfigValue = providerConfig();
  const bodyMessages = [
    ...(context.systemPrompt ? [{ role: "system", content: context.systemPrompt }] : []),
    ...(context.messages ?? []).flatMap((msg: any) => {
      const content = msg.content ?? "";
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((block: any) =>
                  block?.type === "text" && block.text ? block.text : "",
                )
                .join("\n")
            : String(content);
      return [
        {
          role:
            msg.role === "assistant"
              ? "assistant"
              : msg.role === "tool"
                ? "tool"
                : "user",
          content: text,
        },
      ];
    }),
  ];
  const response = await fetch(`${providerConfigValue.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfigValue.apiKey}`,
    },
    body: JSON.stringify({
      model: providerConfigValue.model,
      messages: bodyMessages,
      max_tokens: options?.maxTokens ?? 8192,
      temperature: 0,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`compaction provider ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const data: any = await response.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: providerConfigValue.provider,
    model: providerConfigValue.model,
    usage: {
      input: data?.usage?.prompt_tokens ?? 0,
      output: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    stopReason: data?.choices?.[0]?.finish_reason === "length" ? "length" : "end",
    timestamp: Date.now(),
  };
}

async function main() {
  const provider = providerConfig();
  if (!provider.apiKey) throw new Error("COMPACTION_API_KEY is not set");

  const manifestPath = resolve(argValue("--manifest") ?? "reports/context-compression/production-manifest-30.json");
  const metaPath = resolve(argValue("--meta") ?? "reports/context-compression/production-summaries-30-generated.meta.json");
  const guidelinesPath = resolve(
    argValue("--guidelines") ??
      "reports/context-compression/failure-guidelines-p6-a-phase2-reasoner.json",
  );
  const outDir = resolve(
    argValue("--out-dir") ?? "artifacts/p6-data-prep/production-summaries-v2/generated",
  );
  const outJsonl = resolve(
    argValue("--out-jsonl") ??
      "reports/context-compression/production-summaries-30-v2.jsonl",
  );
  const limit = parseNumber(argValue("--limit"), Number.POSITIVE_INFINITY);
  const only = argValue("--only")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const manifest = readJson(manifestPath);
  const meta = readJson(metaPath);
  const guidelines = readJson(guidelinesPath).guidelines ?? [];
  const metaBySample = new Map<string, MetaEntry>(
    (meta.entries ?? []).map((entry: MetaEntry) => [entry.sampleId, entry]),
  );

  mkdirSync(outDir, { recursive: true });
  const rows: Array<{ sampleId: string; compressedSummary: string }> = [];
  let generated = 0;
  let failed = 0;

  let ordinalIndex = 0;
  for (const sample of manifest.samples ?? []) {
    const sampleId = String(sample.id);
    if (only?.length && !only.includes(sampleId)) {
      ordinalIndex += 1;
      continue;
    }
    if (generated >= limit) break;
    const file = metaBySample.get(sampleId)?.file;
    if (!file) {
      console.error(`${sampleId}: missing meta file path`);
      failed += 1;
      continue;
    }
    try {
      const raw: any[] = sdk
        .loadEntriesFromFile(file)
        .filter((entry: any) => entry.type !== "session" && entry.type !== "compaction");
      const entries: any[] = JSON.parse(JSON.stringify(raw));
      const settings: any = {
        ...DEFAULT_COMPACTION_SETTINGS,
        contextWindow: 32000,
        keepRecentTokens: 120,
      };
      const prepared: any = prepareCompaction(entries as any, settings);
      if (!prepared.ok || !prepared.value) {
        throw new Error(`prepareCompaction failed: ${JSON.stringify(prepared)}`);
      }
      const prep: CompactionPreparation = prepared.value as any;
      const model: any = {
        id: provider.model,
        name: provider.model,
        api: "openai-completions",
        provider: provider.provider,
        baseUrl: provider.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 64000,
        maxTokens: 8192,
      };
      const customInstructions = buildCustomInstructions(sampleId, guidelines);
      const result: any = await compact(
        prep,
        model,
        provider.apiKey,
        undefined,
        customInstructions,
        undefined,
        undefined,
        undefined,
        { completeSimple },
      );
      if (!result.ok) throw result.error;
      const recoveryLedger = buildRecoveryLedger(file, sampleId, {
        windowSize: Number(sample.cohort?.turn ?? 200),
        ordinalIndex,
      });
      const baseSummary = String(result.value.summary ?? "");
      const summary = `${baseSummary}

${ledgerText(recoveryLedger)}`.trim();
      if (!summary.trim()) throw new Error("empty summary");
      const record = {
        sampleId,
        file,
        summary,
        customInstructions,
        recoveryLedger: {
          factCount: recoveryLedger.expected.length,
          unverifiedClaims: recoveryLedger.unverifiedClaims,
          window: recoveryLedger.window,
        },
        details: result.value.details,
        tokensBefore: result.value.tokensBefore,
      };
      writeFileSync(
        `${outDir}/${sampleId}.json`,
        `${JSON.stringify(record, null, 2)}\n`,
        "utf8",
      );
      rows.push({ sampleId, compressedSummary: summary });
      console.log(`${sampleId}: generated chars=${summary.length} ledgerFacts=${recoveryLedger.expected.length}`);
      generated += 1;
      ordinalIndex += 1;
    } catch (error) {
      console.error(`${sampleId}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      failed += 1;
    }
  }

  mkdirSync(resolve(outJsonl).replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  writeFileSync(
    outJsonl,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`,
    "utf8",
  );
  writeFileSync(
    `${outJsonl}.meta.json`,
    `${JSON.stringify(
      {
        schema: "p6-production-summaries-generated/v2",
        generatedAt: new Date().toISOString(),
        count: rows.length,
        failed,
        manifest: manifestPath,
        guidelines: guidelinesPath,
        source:
          "agent-core compact() with updated evidence-fidelity prompts + per-sample critic repair instructions + deterministic recovery ledger (deepseek-chat; contextWindow=32000; keepRecentTokens=120)",
        entries: rows.map((row) => {
          const file = metaBySample.get(row.sampleId)?.file;
          return {
            sampleId: row.sampleId,
            file,
            summaryChars: row.compressedSummary.length,
            basename: file ? basename(file) : undefined,
          };
        }),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`generated=${generated} failed=${failed} out=${outJsonl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
