/**
 * definePluginEntry stub —— ClawX openclaw/plugin-sdk/plugin-entry 替身。
 *
 * 迁移到 ClawX 时：
 *   import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
 *   import { AnyAgentTool } from "openclaw/.../common";
 * 并删除本文件。
 *
 * 对照源：openclaw_runtime/extensions/exa/index.ts (ClawX) 的 register(api) 用法。
 */
import type { AnyAgentTool } from './tool-shape.js';

export interface PluginApi {
  /** 对齐 ClawX api.registerTool(tool, { names })。 */
  registerTool(tool: AnyAgentTool, opts?: { names?: string[] }): void;
}

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  register(api: PluginApi): void;
}

/** 简单 stub：把 registerTool 调用收集到一个数组，供 demo runner 检查。 */
export function definePluginEntry(entry: PluginEntry): PluginEntry {
  return entry;
}

/** 测试用：构造一个收集器 api，返回 tools 数组。 */
export function createCollectingApi(): { api: PluginApi; tools: AnyAgentTool[] } {
  const tools: AnyAgentTool[] = [];
  const api: PluginApi = {
    registerTool(tool, _opts) {
      tools.push(tool);
    },
  };
  return { api, tools };
}
