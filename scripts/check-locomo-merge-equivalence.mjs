#!/usr/bin/env node
// Issue #144: verify the cached/fresh LoCoMo tails are one shared implementation.
//
// The end-to-end LoCoMo A/B is NOT a reproducible equivalence oracle: the
// evaluator's reflect re-retrieval returns facts in an unstable order and the
// shared escalation/reflect budgets are consumed in completion order, so two
// runs of identical code already differ (~40 report fields). This check instead
// verifies the property the issue actually needs -- that merging the two
// mirrored tails preserved each path's injected semantics and removed the
// duplication.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(repoRoot, "tests/unit/runtime-memory-locomo-full-500.test.ts");
const source = readFileSync(target, "utf8");
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const count = (marker) => (source.match(new RegExp(esc(marker), "gu")) ?? []).length;

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail ?? null });

check("single shared tail implementation", count("const runSharedQuestionTail = async (") === 1);
check("both retrieval paths call the shared tail",
  count("runSharedQuestionTail(item, questionId, queryPlan, {") === 2);

check("cached injects cached hop answers as level1 hints",
  source.includes("level1ReasoningHints: cachedSelfAskHopAnswers"));
check("cached captures re-retrieved facts", source.includes("captureReRetrievedFacts: true"));
check("cached keeps its full-pipeline re-retrieval",
  source.includes("indexForReflect.searchWithEmbedding(") && source.includes("50,\n                      OPTIMAL_HYBRID_FUSION"));

check("fresh sends no hop-answer hints", source.includes("level1ReasoningHints: []"));
check("fresh does not capture re-retrieved facts", source.includes("captureReRetrievedFacts: false"));
check("fresh keeps its plain top-10 re-retrieval",
  source.includes("10,\n                    OPTIMAL_HYBRID_FUSION"));
check("fresh still writes the dev-slice retrieval cache", source.includes("captureRetrievalCache: fullEval"));

for (const marker of [
  "Stage 4: Reflect Agent — critique",
  "judgeWithUnifiedPrompt(",
  "computeContextRecall(",
  "rewriteQueryForRetrieval(",
  "classifyErrorTaxonomy(",
  "extractFinalAnswer(",
]) {
  check(`de-duplicated: ${marker}`, count(marker) === 1, `occurrences=${count(marker)}`);
}

check("cached retrieval path still present", source.includes("cachedQuestion.retrievalCache"));
check("fresh retrieval path still present", source.includes("devSliceCacheWrites.push("));

const failed = checks.filter((entry) => !entry.ok);
if (failed.length > 0) {
  console.error("LoCoMo cached/fresh merge equivalence check failed:");
  for (const entry of failed) console.error(`- ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`);
  process.exit(1);
}
console.log(
  `LoCoMo cached/fresh merge equivalence passed (${checks.length} checks, ${source.split(/\r?\n/u).length} lines)`,
);