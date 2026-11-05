/** Child process for crash-window proof. Never imported by production code. */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { toToolDefinitions } from "../agent-tool-definition-adapter.js";
import type { AgentMessage, AgentTool } from "../runtime/index.js";
import { SessionManager } from "../sessions/session-manager.js";
import { redispatchPendingToolCalls } from "./redispatch.js";
import { authorizePendingToolRecovery } from "./recovery.js";
import { readOpenExecutionPhases, settleOrphanedExecutionPhases } from "./store.js";
import { recordAssistantToolDispatches } from "./tool-boundary.js";

const [dir, stage] = process.argv.slice(2);
if (!dir || !stage) throw new Error("dir and stage required");
const session = SessionManager.open(join(dir, "transcript.jsonl"), dir);
const identity = {
  sessionKey: "agent:main:crash-proof",
  sessionId: session.getSessionId(),
  runId: stage,
};
const effectFile = join(dir, "effects.txt");
function park() {
  writeFileSync(join(dir, "ready.json"), JSON.stringify({ pid: process.pid, stage }));
  setInterval(() => {}, 1_000);
  return new Promise<never>(() => {});
}
const assistant = {
  role: "assistant",
  content: [
    { type: "toolCall", id: "original-call", name: "write", arguments: { value: "EFFECT" } },
  ],
  stopReason: "toolUse",
  api: "anthropic-messages",
  provider: "scripted",
  model: "scripted",
  timestamp: 1,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
} satisfies AgentMessage;
const [definition] = toToolDefinitions(
  [
    {
      name: "write",
      label: "write",
      description: "Crash proof effect",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (_id, args) => {
        if (stage === "pending") await park();
        appendFileSync(effectFile, `${(args as { value: string }).value}\n`);
        if (stage === "effect") await park();
        return { content: [{ type: "text", text: "persisted actual result" }], details: {} };
      },
    },
  ],
  identity,
);
const tool: AgentTool = {
  ...definition,
  execute: (id, args, signal, onUpdate) =>
    definition.execute(id, args, signal, onUpdate, undefined as never),
};

if (stage !== "resume") {
  session.appendMessage({ role: "user", content: "perform the effect", timestamp: 0 });
  session.appendMessage(assistant);
  recordAssistantToolDispatches(assistant, identity);
  if (stage === "dispatch") await park();
}

try {
  settleOrphanedExecutionPhases();
  authorizePendingToolRecovery({ ...identity, messages: session.buildSessionContext().messages });
  await redispatchPendingToolCalls({
    ...identity,
    context: { systemPrompt: "", messages: session.buildSessionContext().messages, tools: [tool] },
    config: {},
    appendResult: (message) => {
      if (stage === "committed") {
        // Kill after the adapter committed but before any result is persisted.
        writeFileSync(join(dir, "ready.json"), JSON.stringify({ pid: process.pid, stage }));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      return session.appendMessage(message);
    },
  });
  if (stage !== "resume") await park();
  writeOutcome("resumed");
} catch (error) {
  writeOutcome("reconcile", String(error));
}
function writeOutcome(status: string, error?: string) {
  const messages = SessionManager.open(join(dir, "transcript.jsonl"), dir).buildSessionContext()
    .messages;
  writeFileSync(
    join(dir, "outcome.json"),
    JSON.stringify(
      {
        status,
        error,
        effects: existsSync(effectFile)
          ? readFileSync(effectFile, "utf8").trim().split("\n").filter(Boolean).length
          : 0,
        realResults: messages.filter((m) => m.role === "toolResult" && !m.isError).length,
        rows: readOpenExecutionPhases(identity.sessionKey).map((row) => ({
          phase: row.phase,
          recovery: JSON.parse(row.recovery_json),
        })),
        driven_by: "agent",
        actor: "redispatch-process-test",
        realHumanEvidence: false,
      },
      null,
      2,
    ),
  );
}
