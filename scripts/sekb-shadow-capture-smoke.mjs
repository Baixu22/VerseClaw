/**
 * Local SEKB shadow capture smoke (no Phase C/D).
 * Uses DeepSeek chat to drive a few finished trajectories into the local state DB.
 * Does NOT fabricate dual-review labels.
 *
 * Usage:
 *   node scripts/sekb-shadow-capture-smoke.mjs [--count 5]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sekbDist = path.join(repoRoot, "openclaw_runtime", "dist", "knowledge", "sekb", "index.js");

function parseCount(argv) {
  const idx = argv.indexOf("--count");
  if (idx === -1) return 5;
  const n = Number(argv[idx + 1]);
  if (!Number.isFinite(n) || n < 1) throw new Error("--count must be a positive number");
  return Math.min(Math.floor(n), 30);
}

function ensureElectronStateDir() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const stateDir = path.join(appData, "Electron", "openclaw-source-state");
  return existsSync(stateDir) ? stateDir : null;
}

async function callDeepSeek(prompt) {
  const key = process.env.DEEPSEEK_API_KEY || process.env.CLAWX_DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set");
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CLAWX_DEEPSEEK_MODEL || "deepseek-chat",
      messages: [
        { role: "system", content: "You are a concise coding assistant for local SEKB capture smoke." },
        { role: "user", content: prompt },
      ],
      max_tokens: 180,
      temperature: 0.2,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || `DeepSeek HTTP ${res.status}`);
  }
  return body?.choices?.[0]?.message?.content?.trim() || "";
}

const scenarios = [
  {
    intent: "Explain how to enable SEKB shadow evaluation safely",
    task_type: "docs/config",
    tags: ["sekb", "shadow"],
    tools: false,
    outcome: "success",
    prompt: "In 3 bullets, how to enable SEKB shadowEvaluation without enabling capture filtering.",
  },
  {
    intent: "Draft a SQL count query for sekb_trajectories",
    task_type: "config/db",
    tags: ["sqlite", "sekb"],
    tools: true,
    outcome: "success",
    prompt: "Write one SQLite SELECT COUNT(*) query against sekb_trajectories.",
  },
  {
    intent: "Diagnose empty SEKB inventory",
    task_type: "ops/debug",
    tags: ["sekb", "inventory"],
    tools: true,
    outcome: "partial",
    prompt: "List 3 likely reasons sekb_trajectories count is 0 after enabling SEKB.",
  },
  {
    intent: "Simulate failed provider key check",
    task_type: "ops/auth",
    tags: ["provider", "auth"],
    tools: true,
    outcome: "failure",
    prompt: "Reply with a short error-style note that an API key is missing for a provider call.",
    forceError: "provider_auth_failed: missing or invalid api key for deepseek",
  },
  {
    intent: "Summarize dual-review promotion gates",
    task_type: "eval/protocol",
    tags: ["sekb", "a5"],
    tools: false,
    outcome: "success",
    prompt: "List the four quantitative gates for SEKB evaluable_for_promotion in one short paragraph.",
  },
];

async function main() {
  if (!existsSync(sekbDist)) {
    throw new Error(`Missing ${sekbDist}. Run: pnpm exec node scripts/build-openclaw-runtime.mjs --sekb-only`);
  }

  const count = parseCount(process.argv.slice(2));
  const electronState = ensureElectronStateDir();
  if (electronState && !process.env.OPENCLAW_STATE_DIR) {
    process.env.OPENCLAW_STATE_DIR = electronState;
  }

  const sekb = await import(pathToFileURL(sekbDist).href);
  const store = new sekb.KnowledgeStore();
  const capture = new sekb.TrajectoryCapture({ store, shadowEvaluation: true });

  const before = store.query_trajectories({}).length;
  const finished = [];

  for (let i = 0; i < count; i += 1) {
    const scenario = scenarios[i % scenarios.length];
    const id = capture.start_trajectory(scenario.intent, scenario.task_type, scenario.tags);
    let modelText = "";
    try {
      modelText = await callDeepSeek(scenario.prompt);
      if (scenario.tools) {
        capture.log_step(id, "tool.call", { tool: "deepseek.chat", prompt: scenario.prompt }, { queued: true });
        capture.log_step(
          id,
          "tool.result",
          { tool: "deepseek.chat" },
          { isError: Boolean(scenario.forceError), content: modelText.slice(0, 500) },
        );
      } else {
        capture.log_step(id, "model.reply", { prompt: scenario.prompt }, { content: modelText.slice(0, 500) });
      }
      const traj = capture.finish_trajectory(
        id,
        scenario.outcome,
        scenario.outcome === "failure" ? (scenario.forceError || "smoke_failure") : null,
      );
      finished.push({
        trajectory_id: traj.trajectory_id,
        outcome: traj.outcome,
        shadowScore: traj.metadata?.sekbShadow?.captureQuality?.score ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const traj = capture.finish_trajectory(id, "failure", message);
      finished.push({
        trajectory_id: traj.trajectory_id,
        outcome: traj.outcome,
        shadowScore: traj.metadata?.sekbShadow?.captureQuality?.score ?? null,
        error: message,
      });
    }
  }

  const after = store.query_trajectories({}).length;
  console.log(JSON.stringify({
    authority: "local_smoke_capture_not_dual_review_labels",
    stateDir: process.env.OPENCLAW_STATE_DIR || "(default ~/.openclaw)",
    before,
    after,
    created: after - before,
    finished,
    next: [
      "node scripts/sekb-enable-shadow-local.mjs --enable --target electron",
      "OPENCLAW_STATE_DIR=<same> pnpm sekb:hermes:export -- --key <local-key>",
      "OPENCLAW_STATE_DIR=<same> pnpm sekb:hermes:protocol -- --key <local-key> --sample-size 40",
      "Fill dual reviews only after real sampling; do not fabricate labels.",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
