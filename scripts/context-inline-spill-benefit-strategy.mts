import type { AgentMessage } from "../openclaw_runtime/src/agents/runtime/index.js";
import { EVAL_RECALL_PAGE_MAX_CHARS, RECALL_TOOL_DEF } from "./context-inline-spill-benefit-input.mjs";

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

type NavigationInput = Record<string, unknown>;
type NavigationArguments = { archive_uri: string; checksum: string; offset: number; max_chars: number };
export const VISIBLE_RECALL_NAVIGATION_RULE = "The requested exact value is the value of the complete private_evidence field in visible recall content. Read that field and return only a JSON object whose value property contains its exact text. Stop reading pages when the field is visible. Filenames and checksums identify archives. Call once per response and request at most three recalls.";
const parseNavigationObject = (text: unknown): NavigationInput | null => {
  try { const value = JSON.parse(String(text)); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
  catch { return null; }
};
const validNavigationPair = (args: NavigationInput) => typeof args.archive_uri === "string" && /^context-archive:\/\/[^\s"<>;,]+$/.test(args.archive_uri)
  && typeof args.checksum === "string" && /^sha256:[a-f0-9]{64}$/.test(args.checksum);

/** No oracle or history argument: every selector addresses this exact visible request. */
export function buildVisibleRecallNavigation(input: readonly NavigationInput[]) {
  const calls = input.flatMap((item, index) => item.type === "function_call" && item.name === "context_archive_recall"
    ? [{ item, index, args: parseNavigationObject(item.arguments) }] : []);
  const first = calls.find(call => call.args && validNavigationPair(call.args));
  const text = String(input[0]?.content ?? "");
  const uri = text.match(/context-archive:\/\/[^\s"<>;,]+/)?.[0];
  const checksum = text.match(/sha256:[a-f0-9]{64}/)?.[0];
  const pair = first ? { uri: String(first.args!.archive_uri), checksum: String(first.args!.checksum) }
    : uri && checksum ? { uri, checksum } : null;
  const same = calls.filter(call => pair && call.args && call.args.archive_uri === pair.uri && call.args.checksum === pair.checksum);
  let fieldSourceIndex: number | null = null;
  let fieldCallId: string | null = null;
  for (const call of same) {
    const index = input.findIndex(item => item.type === "function_call_output" && item.call_id === call.item.call_id);
    const output = index < 0 ? null : parseNavigationObject(input[index]!.output);
    if (output?.ok === true && typeof output.content === "string" && /private_evidence=[^\r\n]+\r?\n/.test(output.content)) {
      fieldSourceIndex = index; fieldCallId = String(call.item.call_id); break;
    }
  }
  const last = same.at(-1);
  let offset = 0, validOffset = true;
  let offsetSourceIndex: number | null = null;
  if (last) {
    const args = last.args!;
    const outputIndex = input.findIndex(item => item.type === "function_call_output" && item.call_id === last.item.call_id);
    const output = outputIndex < 0 ? null : parseNavigationObject(input[outputIndex]!.output);
    if (output?.ok === true && typeof output.content === "string" && Number.isSafeInteger(output.offset) && Number(output.offset) >= 0) {
      offset = Number(output.offset) + output.content.length; offsetSourceIndex = outputIndex;
    } else if (Number.isSafeInteger(args.offset ?? 0) && Number(args.offset ?? 0) >= 0 && Number.isSafeInteger(args.max_chars)
      && Number(args.max_chars) >= 1 && Number(args.max_chars) <= EVAL_RECALL_PAGE_MAX_CHARS) {
      const omitted = !output || (Array.isArray(output.diagnostics) && output.diagnostics.some(item => item?.code === "projection_omitted"));
      offset = Number(args.offset ?? 0) + (output?.ok === false && !omitted ? 0 : Number(args.max_chars)); offsetSourceIndex = last.index;
    } else validOffset = false;
    validOffset = validOffset && Number.isSafeInteger(offset) && offset >= 0;
  }
  const recommendedArguments: NavigationArguments | null = pair && calls.length < 3 && fieldSourceIndex === null && validOffset
    ? { archive_uri: pair.uri, checksum: pair.checksum, offset, max_chars: EVAL_RECALL_PAGE_MAX_CHARS } : null;
  const navigation = { source: first ? "visible-call-metadata" : pair ? "visible-context" : "no-visible-reference",
    targetSourceIndex: first?.index ?? (pair ? 0 : null), offsetSourceIndex, fieldSourceIndex, fieldCallId,
    recallsUsed: calls.length, recommendedArguments };
  const instruction = VISIBLE_RECALL_NAVIGATION_RULE + " " + (fieldSourceIndex !== null
    ? "A complete field is visible in " + JSON.stringify({ call_id: fieldCallId, input_index: fieldSourceIndex }) + ". Read that visible content and answer now; no next page is needed."
    : recommendedArguments ? "If the field is absent, the next sequential page of the original exec archive is shown below. Later health-check and recall-projection archives are unrelated. Decide whether to recall using these visible navigation arguments: " + JSON.stringify(recommendedArguments)
      : "No usable next page remains in this navigation strategy. If the exact field is absent, return only {\"value\":null}.")
    + " Recalls already requested: " + calls.length + "/3.";
  return { input: [...input, { role: "user", content: instruction }], navigation };
}

export function navigatedDeterministicTurn(input: readonly NavigationInput[]) {
  const { navigation } = buildVisibleRecallNavigation(input);
  if (navigation.fieldSourceIndex !== null) {
    const output = parseNavigationObject(input[navigation.fieldSourceIndex]!.output)!;
    const value = String(output.content).match(/private_evidence=([^\r\n]+)\r?\n/)?.[1];
    if (value) return { text: JSON.stringify({ value }), toolCalls: [] };
  }
  const args = navigation.recommendedArguments;
  return args ? { text: "", toolCalls: [{ callId: "det-visible-" + input.length, name: "context_archive_recall", arguments: args }] }
    : { text: '{"value":null}', toolCalls: [] };
}
