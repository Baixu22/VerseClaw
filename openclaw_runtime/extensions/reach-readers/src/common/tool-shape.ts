/**
 * ClawX agent 工具形状 —— 对齐 AnyAgentTool。
 *
 * 对照源：openclaw_runtime/src/agents/tools/common.ts (ClawX)
 * 以及 web-fetch.ts / agent-browser-tool.ts 的实际用法。
 *
 * 迁移到 ClawX 时：
 *   - AnyAgentTool 直接用 ClawX 的导出
 *   - jsonResult / readStringParam / asToolParamsRecord 用 ClawX 的同名导出
 *   - 本文件可整体删除
 */
import type { SchemaDescriptor } from './schema.js';

/** 工具执行结果：JSON 可序列化的对象。 */
export type ToolResult = Record<string, unknown>;

/** 工具执行函数签名 —— 对齐 ClawX execute(toolCallId, args)。 */
export type ToolExecute = (toolCallId: string, args: unknown) => Promise<ToolResult>;

/** AnyAgentTool —— 对齐 ClawX 的 AnyAgentTool。 */
export interface AnyAgentTool {
  label: string;
  name: string;
  description: string;
  parameters: SchemaDescriptor;
  execute: ToolExecute;
}

/** 把任意值安全转为参数记录。对齐 ClawX asToolParamsRecord。 */
export function asToolParamsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** 读必填字符串参数。对齐 ClawX readStringParam(required: true)。 */
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

/** 读可选字符串参数。 */
export function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const raw = params[key];
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value || undefined;
}

/** 读可选整数参数。 */
export function readOptionalInt(
  params: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  const raw = params[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  let v = Math.floor(raw);
  if (opts.min !== undefined) v = Math.max(opts.min, v);
  if (opts.max !== undefined) v = Math.min(opts.max, v);
  return v;
}

/** JSON 结果包装。对齐 ClawX jsonResult。 */
export function jsonResult(value: ToolResult): ToolResult {
  return value;
}

/** 工具失败时的标准返回结构。 */
export function errorResult(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return { status: 'error', success: false, error, ...extra };
}
