import { Type } from "typebox";
import type { DiagnosticTraceContext } from "../../infra/diagnostic-trace-context.js";
import type { AnyAgentTool } from "../tools/common.js";
import { jsonResult } from "../tools/common.js";
import { resolveVerseShellFoundationRollout } from "../verseshell-foundation-flags.js";
import { stringEnum } from "../schema/typebox.js";
import { queryGovernedVerseShellResult } from "./governed-exec.js";

const VERSESHELL_RESULT_MODES = ["meta", "head", "tail", "slice", "grep", "raw"] as const;

const VerseShellResultSchema = Type.Object({
  handle: Type.String({ description: "result://sha256 artifact handle returned by exec." }),
  mode: stringEnum(VERSESHELL_RESULT_MODES),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  startLine: Type.Optional(Type.Integer({ minimum: 1 })),
  endLine: Type.Optional(Type.Integer({ minimum: 1 })),
  pattern: Type.Optional(Type.String({ maxLength: 500 })),
  maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});

export function createVerseShellResultTool(options: {
  cwd: string;
  agentId?: string;
  config?: unknown;
  trace?: DiagnosticTraceContext;
}): AnyAgentTool | null {
  const rollout = resolveVerseShellFoundationRollout({ config: options.config });
  const required = ["verifiedRuntime", "typedAci", "facade", "governedExec", "artifactResults"] as const;
  if (rollout.killSwitch.engaged || required.some((flag) => !rollout.enabled[flag])) return null;
  return {
    name: "verseshell_result",
    label: "VerseShell Result",
    displaySummary: "Read a bounded slice of a VerseShell result artifact",
    description:
      "Inspect a result:// artifact returned by an exec call. Prefer head, tail, or grep; use bounded raw only when reduced diagnostics are insufficient.",
    parameters: VerseShellResultSchema,
    risk: "readonly",
    execute: async (_toolCallId, args) => {
      const params = args as {
        handle: string;
        mode: GovernedVerseShellResultQueryOptions["mode"];
        lines?: number;
        startLine?: number;
        endLine?: number;
        pattern?: string;
        maxMatches?: number;
      };
      const observation = await queryGovernedVerseShellResult({
        handle: params.handle,
        mode: params.mode,
        cwd: options.cwd,
        agentId: options.agentId,
        trace: options.trace,
        lines: params.lines,
        startLine: params.startLine,
        endLine: params.endLine,
        pattern: params.pattern,
        maxMatches: params.maxMatches,
      });
      return jsonResult(observation);
    },
  };
}

type GovernedVerseShellResultQueryOptions = Parameters<typeof queryGovernedVerseShellResult>[0];
