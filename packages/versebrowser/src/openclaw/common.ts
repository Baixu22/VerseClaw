/**
 * Shared built-in tool contracts and helpers (agent-browser subset).
 *
 * Extracted verbatim from openclaw_runtime/src/agents/tools/common.ts:
 * - AnyAgentTool (source lines 58-73)
 * - asToolParamsRecord (source lines 75-79)
 * - StringParamOptions (source lines 81-86)
 * - ToolInputError (source lines 93-100)
 * - ToolAuthorizationError (source lines 102-109)
 * - readStringParam (source lines 123-158)
 * - stringifyToolPayload / textResult / jsonResult (source lines 394-434)
 *
 * Adaptive: AgentTool/AgentToolResult are locally minimized so this package
 * does not pull the full OpenClaw runtime type graph.
 */
import type { TSchema } from "typebox";
import { readSnakeCaseParamRaw } from "./param-key.ts";

export type AgentToolResult<TDetails = unknown> = {
  content: Array<{ type: "text"; text: string }>;
  details: TDetails;
  progress?: unknown;
};

export type AgentTool<TParameters extends TSchema = TSchema, TResult = unknown> = {
  name: string;
  description: string;
  parameters: TParameters;
  execute?: (params: unknown, ctx?: unknown) => Promise<TResult> | TResult;
};

export type ErasedAgentToolExecute = {
  execute: (params: unknown, ctx?: unknown) => Promise<unknown> | unknown;
};

export type WriteRiskProfile = {
  writes?: readonly string[];
};

export type AnyAgentTool = Omit<AgentTool, "execute"> &
  ErasedAgentToolExecute & {
    label?: string;
    displaySummary?: string;
    prepareBeforeToolCallParams?: (
      params: unknown,
      ctx: { toolCallId?: string; hookContext?: unknown; signal?: AbortSignal },
    ) => unknown;
    finalizeBeforeToolCallParams?: (params: unknown, preparedParams: unknown) => unknown;
    /** A1 Stage 2: tool risk level (defaults to "readonly"). */
    risk?: "readonly" | "write" | "destructive";
    /** A1 Stage 2: static write-path declaration. */
    writeRiskProfile?: WriteRiskProfile;
  };

export function asToolParamsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

export type StringParamOptions = {
  required?: boolean;
  trim?: boolean;
  label?: string;
  allowEmpty?: boolean;
};

export class ToolInputError extends Error {
  readonly status: number = 400;

  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export class ToolAuthorizationError extends ToolInputError {
  override readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ToolAuthorizationError";
  }
}

function readParamRaw(params: Record<string, unknown>, key: string): unknown {
  return readSnakeCaseParamRaw(params, key);
}

export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string | undefined;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;
  const raw = readParamRaw(params, key);
  if (typeof raw !== "string") {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  return value;
}

export function stringifyToolPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  try {
    const encoded = JSON.stringify(payload, null, 2);
    if (typeof encoded === "string") {
      return encoded;
    }
  } catch {
    // Fall through to String(payload) for non-serializable values.
  }
  return String(payload);
}

export function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    details,
  };
}

export function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return textResult(JSON.stringify(payload, null, 2), payload);
}
