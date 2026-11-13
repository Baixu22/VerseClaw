import type { AgentMessage } from "../openclaw_runtime/src/agents/runtime/index.js";
import { RECALL_TOOL_DEF } from "./context-inline-spill-benefit-input.mjs";

export const ANCHORED_RECALL_TOOL_DEF = {
  ...RECALL_TOOL_DEF,
  description: "The target is the original exec output archive in the initial visible context. Copy that archive_uri and checksum, then keep that same pair for every page. Archives from later routine health checks or previous recall projections are distractors. If the initial context has no archive pair, return {\"value\":null} without guessing a handle. Start at offset 0 with max_chars 5500. When the requested exact value is absent, continue with offset equal to the preceding offset plus returned content.length; if that page was cleared by projection, use the preceding requested offset plus max_chars. Stop immediately after reading the exact value and output only {\"value\":\"exact value\"}. After at most 3 recalls without it, output {\"value\":null}. Call only once per response.",
};

export type AnchorPolicyState = { anchor: { uri: string; checksum: string } | null; calls: number; offset: number };
export function createAnchorPolicyState(): AnchorPolicyState { return { anchor: null, calls: 0, offset: 0 }; }

/** Scripted comparison: all evidence comes from the actual visible input. */
export function anchoredDeterministicTurn(input: readonly Record<string, unknown>[], state: AnchorPolicyState) {
  const prompt = String(input[0]?.content ?? "");
  if (state.calls === 0 && state.anchor === null) {
    const uri = prompt.match(/context-archive:\/\/[^\s"<>;,]+/)?.[0];
    const checksum = prompt.match(/sha256:[a-f0-9]{64}/)?.[0];
    if (uri && checksum) state.anchor = { uri, checksum };
  }
  const visible = [prompt];
  for (const item of input.filter(item => item.type === "function_call_output")) {
    try {
      const output = JSON.parse(String(item.output));
      if (output.ok === true && typeof output.content === "string") visible.push(output.content);
    } catch {}
  }
  for (const text of visible) {
    const value = text.match(/private_evidence=([^\r\n]+)\r?\n/)?.[1];
    if (value) return { text: JSON.stringify({ value }), toolCalls: [] };
  }
  if (!state.anchor || state.calls >= 3) return { text: '{"value":null}', toolCalls: [] };
  const call = { callId: "det-anchor-" + state.calls, name: "context_archive_recall",
    arguments: { archive_uri: state.anchor.uri, checksum: state.anchor.checksum, offset: state.offset, max_chars: 5500 } };
  state.calls++;
  state.offset += 5500;
  return { text: "", toolCalls: [call] };
}

export function buildBenefitPressure(turn: number, filler: string, source: "user" | "tool"): AgentMessage[] {
  const tool = (id: string, text: string) => ({ role: "toolResult", toolName: "exec", toolCallId: id,
    content: [{ type: "text", text }], isError: false, timestamp: 1 }) as AgentMessage;
  const log = "Additional context for the remaining checks: " + filler.repeat(40);
  const continued = { role: "assistant", content: [{ type: "text", text: "Acknowledged. Continuing with the remaining verification steps." }], timestamp: 1 } as AgentMessage;
  const followup = { role: "user", content: source === "user" ? log : "Continue verification using the new tool observations.", timestamp: 1 } as AgentMessage;
  return [continued, followup, ...(source === "tool" ? [tool("pressure-log-" + turn, log)] : []),
    tool("distractor-1-" + turn, filler.repeat(33)), tool("distractor-2-" + turn, filler.repeat(33))];
}
