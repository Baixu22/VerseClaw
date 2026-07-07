#!/usr/bin/env node
/**
 * Download and preprocess the LoCoMo dataset from the snap-research/locomo GitHub repository.
 *
 * Usage:
 *   node scripts/download-locomo.mjs
 *
 * Output:
 *   tests/fixtures/locomo/conversations.json  — preprocessed conversations
 *   tests/fixtures/locomo/questions.json      — preprocessed QA pairs
 *
 * Source: https://github.com/snap-research/locomo/blob/main/data/locomo10.json
 * License: CC BY 4.0
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "tests", "fixtures", "locomo");

const LOCOMO_RAW_URL =
  "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json";

async function downloadLocomo() {
  console.log("[locomo] Downloading from", LOCOMO_RAW_URL);
  const res = await fetch(LOCOMO_RAW_URL);
  if (!res.ok) {
    throw new Error(`Failed to download LoCoMo: ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();
  console.log("[locomo] Downloaded", raw.length, "conversations");
  return raw;
}

/**
 * Extract flat conversation turns from the nested LoCoMo session structure.
 *
 * LoCoMo raw format:
 *   sample.conversation.session_1: [{ speaker, dia_id, text }]
 *   sample.conversation.session_2: [...]
 *   sample.speakers: { speaker_a: "name", speaker_b: "name" }
 *   sample.session_1_date_time: "2023-01-15T10:00:00"
 */
function preprocessConversations(rawData) {
  const conversations = [];

  for (let idx = 0; idx < rawData.length; idx++) {
    const sample = rawData[idx];
    const conversationId = `conv_${idx}`;
    const speakerA = sample.speakers?.speaker_a ?? `Speaker_A_${idx}`;
    const speakerB = sample.speakers?.speaker_b ?? `Speaker_B_${idx}`;
    const speakers = [speakerA, speakerB];
    const turns = [];

    let turnId = 0;
    const conversation = sample.conversation ?? {};
    const sessionKeys = Object.keys(conversation)
      .filter((k) => k.startsWith("session_") && !k.includes("_date") && !k.includes("_summary"))
      .sort((a, b) => {
        const na = parseInt(a.replace("session_", ""), 10);
        const nb = parseInt(b.replace("session_", ""), 10);
        return na - nb;
      });

    for (const sessionKey of sessionKeys) {
      const sessionTurns = conversation[sessionKey];
      if (!Array.isArray(sessionTurns)) continue;
      for (const turn of sessionTurns) {
        const speakerName = turn.speaker === "speaker_a" ? speakerA : speakerB;
        turns.push({
          turnId: turnId++,
          speaker: speakerName,
          text: turn.text ?? "",
        });
      }
    }

    conversations.push({ conversationId, speakers, turns });
  }

  return conversations;
}

/**
 * Extract QA pairs from the LoCoMo sample structure.
 *
 * LoCoMo raw format:
 *   sample.qa: [{ question, answer, category, evidence }]
 */
function preprocessQuestions(rawData) {
  const questions = [];

  for (let convIdx = 0; convIdx < rawData.length; convIdx++) {
    const sample = rawData[convIdx];
    const conversationId = `conv_${convIdx}`;
    const qaPairs = sample.qa ?? [];

    for (let qIdx = 0; qIdx < qaPairs.length; qIdx++) {
      const qa = qaPairs[qIdx];
      let category = qa.category ?? "single_hop";
      if (category === "temporal" || category === "commonsense") {
        category = "open_ended";
      }
      if (!["single_hop", "multi_hop", "open_ended", "adversarial"].includes(category)) {
        category = "single_hop";
      }
      questions.push({
        questionId: `q_${questions.length}`,
        conversationId,
        question: qa.question ?? "",
        answer: qa.answer ?? "",
        category,
      });
    }
  }

  return questions;
}

async function main() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  let rawData;
  try {
    rawData = await downloadLocomo();
  } catch (err) {
    console.error("[locomo] Download failed:", err.message);
    console.error("[locomo] The synthetic fixture will remain in place.");
    console.error("[locomo] To use the real dataset, download manually from:");
    console.error("[locomo]   https://github.com/snap-research/locomo/tree/main/data");
    console.error("[locomo] Place locomo10.json in tests/fixtures/locomo/ and re-run:");
    console.error("[locomo]   node scripts/download-locomo.mjs --local");
    process.exit(1);
  }

  const conversations = preprocessConversations(rawData);
  const questions = preprocessQuestions(rawData);

  const conversationsPath = join(FIXTURE_DIR, "conversations.json");
  const questionsPath = join(FIXTURE_DIR, "questions.json");

  writeFileSync(conversationsPath, JSON.stringify(conversations, null, 2) + "\n", "utf-8");
  writeFileSync(questionsPath, JSON.stringify(questions, null, 2) + "\n", "utf-8");

  console.log("[locomo] Wrote", conversations.length, "conversations to", conversationsPath);
  console.log("[locomo] Wrote", questions.length, "questions to", questionsPath);

  const byCategory = {};
  for (const q of questions) {
    byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
  }
  console.log("[locomo] Questions by category:", byCategory);
}

main().catch((err) => {
  console.error("[locomo] Fatal error:", err);
  process.exit(1);
});
