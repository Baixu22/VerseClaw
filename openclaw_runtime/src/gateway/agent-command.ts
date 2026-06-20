// P5-1 Dependency Extraction: agentCommand and agentCommandFromIngress.
//
// This barrel re-exports the agent command entry points from agents/ (the
// long-term home) so the gateway can consume them through
// gateway/agent-command.ts without each gateway file importing the legacy
// commands/agent.js re-export barrel. The agents/ implementation stays put
// (it is not slated for deletion); only the commands/agent.js indirection
// is removed from the gateway import graph so P5-2 can later delete the
// commands/ directory safely.
export {
  agentCommand,
  agentCommandFromIngress,
} from "../agents/agent-command.js";
