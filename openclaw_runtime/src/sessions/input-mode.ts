import type { AgentMessage } from "../agents/runtime/index.js";
import { resolveInputMode, type InputMode } from "../agents/input-classifier.js";

export type InputModeAction =
  | { mode: "interrupt"; abort: true; message: AgentMessage }
  | { mode: "guide"; abort: false; steeringMessages: AgentMessage[] }
  | { mode: "queue"; abort: false; followUpMessages: AgentMessage[] };

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

export function createInputModeAction(input: string, explicitMode?: InputMode): InputModeAction {
  const mode = resolveInputMode(input, explicitMode);
  const message = userMessage(input);
  if (mode === "interrupt") {
    return { mode, abort: true, message };
  }
  if (mode === "queue") {
    return { mode, abort: false, followUpMessages: [message] };
  }
  return {
    mode,
    abort: false,
    steeringMessages: [{ ...message, content: [{ type: "text", text: `Non-interrupting guidance: ${input}` }] }],
  };
}
