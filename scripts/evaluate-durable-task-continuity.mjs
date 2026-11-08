import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createResponsesProvider } from "./lib/rsi-responses-provider.mjs";

const endpoint = process.env.TASK_EVAL_ENDPOINT,
  apiKey = process.env.TASK_EVAL_API_KEY;
if (!endpoint || !apiKey) throw new Error("TASK_EVAL_ENDPOINT and TASK_EVAL_API_KEY are required");
const models = (process.env.TASK_EVAL_MODELS ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
if (models.length < 2) throw new Error("Two explicitly configured models are required");
const output = resolve(process.env.TASK_EVAL_OUTPUT ?? join(tmpdir(), "durable-task-continuity"));
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite/package.json"))("esbuild");
const bundle = join(output, "task-runtime.cjs");
await build({
  stdin: {
    contents:
      'export * from "./shared/task-system/store.ts";export * from "./shared/task-system/identity.ts";export * from "./shared/task-system/runtime.ts";',
    resolveDir: process.cwd(),
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const {
  TaskSystemStore,
  resolveTaskDomain,
  createTaskRuntimeGuard,
  restoreTaskModelContext,
} = require(bundle);
const cases = [
  {
    objective: "Deliver the quarterly invoice export",
    target: "reports/invoices-742.csv",
    constraints: [
      "Use UTC timestamps",
      "Never change the tax calculation",
      "Include the pending invoices",
    ],
    nextAction: "Validate the exported row count",
  },
  {
    objective: "修复订单重试重复扣款",
    target: "src/payments/retry-583.ts",
    constraints: ["保留现有幂等键", "不改变退款逻辑", "增加重复回调测试"],
    nextAction: "运行重复回调回归测试",
  },
  {
    objective: "Add the opt-in local preview command",
    target: "tools/preview-916.mjs",
    constraints: [
      "Bind only to loopback",
      "Preserve the existing command flags",
      "Write no user credentials to logs",
    ],
    nextAction: "Verify shutdown releases the owned port",
  },
];
const schema = {
  type: "object",
  properties: {
    objective: { type: "string" },
    target: { type: "string" },
    constraints: { type: "array", items: { type: "string" } },
    nextAction: { type: "string" },
  },
  required: ["objective", "target", "constraints", "nextAction"],
  additionalProperties: false,
};
const rows = [];
const inputs = [];
for (const [index, item] of cases.entries()) {
  const root = await mkdtemp(join(output, "workspace-"));
  let store = new TaskSystemStore(resolveTaskDomain(root));
  const task = store.create(
    {
      ...item,
      acceptance: [
        {
          id: "criteria",
          description: "All original constraints retained",
          verification: { kind: "owner-receipt", owner: "evaluation" },
        },
      ],
    },
    `case-${index}`,
  ).task;
  const claim = store.claim(
    task.contract.taskNodeId,
    "evaluation-session",
    "generation",
    `claim-${index}`,
  ).claim;
  store.checkpoint(claim, {
    nextAction: item.nextAction,
    completed: ["Initial inspection complete"],
    unresolved: [],
    artifacts: [],
  });
  store.close();
  const guard = createTaskRuntimeGuard(root, "evaluation-session", "generation");
  const system =
    "Return only a JSON object with exactly objective:string, target:string, constraints:string[], nextAction:string. Copy exact strings from the authoritative task contract. nextAction must be a single string, never an array. Do not echo other contract fields. If missing, use empty strings and an empty array. Do not infer missing facts.";
  let restored;
  for (let compression = 0; compression < 10; compression++)
    restored = restoreTaskModelContext(guard, system);
  for (const value of [item.objective, item.target, ...item.constraints, item.nextAction])
    if (!restored.includes(value))
      throw new Error("Persistent context restoration lost a required field");
  inputs.push({
    index,
    expected: item,
    compactions: 10,
    restoredChars: restored.length,
    promptSha256: createHash("sha256").update(restored).digest("hex"),
  });
  for (const [modelIndex, model] of models.entries()) {
    const call = createResponsesProvider({
      endpoint,
      apiKey,
      model,
      timeoutMs: 120000,
      maxOutputTokens: 900,
      reasoningEffort: "low",
      jsonSchema: schema,
    });
    const arms =
      (index + modelIndex) % 2 ? ["protected", "summary-only"] : ["summary-only", "protected"];
    for (const arm of arms) {
      const started = performance.now();
      const row = { case: index, model, arm, compactions: 10, status: "incomplete" };
      try {
        const result = await call({
          instructions: arm === "protected" ? restored : system,
          input:
            "Conversation was compacted after a long investigation. The latest summary says: initial inspection complete; continue from the current task. Return the authoritative task fields.",
        });
        row.durationMs = performance.now() - started;
        row.response = result.response;
        row.responseSha256 = createHash("sha256")
          .update(JSON.stringify(result.rawResponse))
          .digest("hex");
        const answer = JSON.parse(result.response.text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        row.answer = answer;
        row.fields = {
          objective: answer.objective === item.objective,
          target: answer.target === item.target,
          constraints: JSON.stringify(answer.constraints) === JSON.stringify(item.constraints),
          nextAction: answer.nextAction === item.nextAction,
        };
        row.status = result.response.status === "completed" ? "completed" : "incomplete";
        row.allFieldsPreserved = Object.values(row.fields).every(Boolean);
        row.schemaConformant =
          typeof answer.objective === "string" &&
          typeof answer.target === "string" &&
          Array.isArray(answer.constraints) &&
          answer.constraints.every((x) => typeof x === "string") &&
          typeof answer.nextAction === "string" &&
          Object.keys(answer).sort().join(",") === "constraints,nextAction,objective,target";
      } catch (error) {
        row.error = String(error);
        row.durationMs = performance.now() - started;
      }
      rows.push(row);
      await writeFile(join(output, "rows.json"), JSON.stringify(rows, null, 2));
    }
  }
}
const summarize = (arm) => {
  const samples = rows.filter((r) => r.arm === arm);
  return {
    samples: samples.length,
    completed: samples.filter((r) => r.status === "completed").length,
    allFieldsPreserved: samples.filter((r) => r.status === "completed" && r.allFieldsPreserved)
      .length,
    schemaConformant: samples.filter((r) => r.status === "completed" && r.schemaConformant).length,
    incomplete: samples.filter((r) => r.status !== "completed").length,
  };
};
const report = {
  schema: "DurableTaskContinuityPairs/v1",
  driven_by: "agent",
  actor: "codex-task-evaluation",
  scope:
    "Synthetic lost-summary cases using the production context restoration function and live configured provider; product Gateway journey is verified separately",
  models,
  inputs,
  results: { protected: summarize("protected"), summaryOnly: summarize("summary-only") },
  rows,
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: join(output, "report.json"), results: report.results }));
if (
  report.results.protected.completed !== cases.length * models.length ||
  report.results.protected.allFieldsPreserved !== cases.length * models.length ||
  report.results.protected.schemaConformant !== cases.length * models.length
)
  process.exitCode = 1;
