/**
 * OpenClaw agent 工具适配层。
 *
 * 参数读取器保留 Agent Reach shadow 的调用结构；工具类型和结果使用公共
 * Plugin SDK，使所有 reader 返回正式的 AgentToolResult。
 */
import type { AnyAgentTool as OpenClawAgentTool } from 'openclaw/plugin-sdk/plugin-entry';
import { jsonResult as openClawJsonResult } from 'openclaw/plugin-sdk/provider-web-fetch';

export type AnyAgentTool = OpenClawAgentTool & {
  risk?: 'readonly' | 'write' | 'destructive';
};
export type AgentToolResult = ReturnType<typeof openClawJsonResult>;
export type ToolResult = AgentToolResult;

export function asToolParamsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; label?: string } = {},
): string {
  const raw = params[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (opts.required && !value) {
    throw new Error(`Missing required parameter: ${opts.label ?? key}`);
  }
  return value;
}

export function readOptionalString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value || undefined;
}

export function readOptionalInt(
  params: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  const raw = params[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  let value = Math.floor(raw);
  if (opts.min !== undefined) value = Math.max(opts.min, value);
  if (opts.max !== undefined) value = Math.min(opts.max, value);
  return value;
}

export function jsonResult(value: Record<string, unknown>): AgentToolResult {
  return openClawJsonResult(value);
}

export function errorResult(
  error: string,
  extra: Record<string, unknown> = {},
): AgentToolResult {
  return openClawJsonResult({ status: 'error', success: false, error, ...extra });
}
