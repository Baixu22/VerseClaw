type VisibleMessage = { role: string; content?: unknown; toolCallId?: string };

export function contentText(message: VisibleMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

export function textOf(messages: readonly VisibleMessage[]): string {
  return messages.map((message) => message.role + ": " + contentText(message)).join("\n\n");
}

export function pairedSessionId(fixtureId: string, arm: string, repetition: number): string {
  return "benefit-" + fixtureId + "-" + (arm === "retention-off" ? "recall-stable" : arm) + "-" + repetition;
}

/** Each protocol output comes only from this turn's production projection. */
export function buildProjectedEvalInput(
  visible: readonly VisibleMessage[],
  history: readonly Record<string, unknown>[],
  question: string,
): Array<Record<string, unknown>> {
  const outputIds = new Set(history.filter((item) => item.type === "function_call_output").map((item) => String(item.call_id)));
  const outputs = new Map(visible.filter((message) => message.role === "toolResult" && message.toolCallId).map((message) => [message.toolCallId!, contentText(message)]));
  const context = textOf(visible.filter((message) => !(message.role === "toolResult" && outputIds.has(message.toolCallId ?? ""))));
  const prompt = [
    "You are completing a real task. Only the context below is visible to you.",
    "If the exact information is not present and cannot be retrieved, answer null.",
    "Archived tool output can be retrieved with the context_archive_recall tool using the archive_uri and checksum shown in the context.",
    "If the first excerpt does not contain the exact value, page further with the offset argument before concluding it is absent.",
    "Call context_archive_recall at most once per turn and at most 3 times in total. Additional parallel calls are rejected.",
    'As soon as you obtain the exact value, stop recalling and immediately output only JSON. If you still cannot obtain it after at most 3 recalls, output {"value":null}.',
    'Answer with strict JSON only: {"value": string|null}',
    "", "TASK:", question, "", "VISIBLE CONTEXT:", context,
  ].join("\n");
  const protocol = history.map((item) => {
    const callId = String(item.call_id ?? "");
    if (item.type === "function_call") {
      return { type: "function_call", call_id: callId, name: String(item.name ?? ""), arguments: String(item.arguments ?? "{}") };
    }
    if (item.type === "function_call_output") {
      return { type: "function_call_output", call_id: callId, output: outputs.get(callId) ?? JSON.stringify({ ok: false, diagnostics: [{ code: "projection_omitted" }] }) };
    }
    throw new Error("Unsupported eval protocol history item");
  });
  return [{ role: "user", content: prompt }, ...protocol];
}
