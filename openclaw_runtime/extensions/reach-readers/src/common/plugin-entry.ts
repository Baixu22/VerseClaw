/**
 * OpenClaw plugin entry adapter.
 *
 * Production delegates to the public Plugin SDK. The collecting API remains a
 * deliberately narrow test helper for registration characterization.
 */
import {
  definePluginEntry as defineOpenClawPluginEntry,
  type OpenClawPluginApi,
} from 'openclaw/plugin-sdk/plugin-entry';
import type { AnyAgentTool } from './tool-shape.js';

export type PluginApi = Pick<OpenClawPluginApi, 'config' | 'pluginConfig' | 'registerTool'>;
export type PluginEntry = Omit<ReturnType<typeof defineOpenClawPluginEntry>, 'register'> & {
  register(api: PluginApi): void;
};

export function definePluginEntry(
  entry: Omit<Parameters<typeof defineOpenClawPluginEntry>[0], 'register'> & {
    register(api: PluginApi): void;
  },
): PluginEntry {
  return defineOpenClawPluginEntry({
    ...entry,
    register: entry.register,
  } as Parameters<typeof defineOpenClawPluginEntry>[0]) as PluginEntry;
}

export function createCollectingApi(): { api: PluginApi; tools: AnyAgentTool[] } {
  const tools: AnyAgentTool[] = [];
  const api: PluginApi = {
    config: {},
    pluginConfig: {},
    registerTool(tool) {
      if (typeof tool !== 'function') tools.push(tool);
    },
  };
  return { api, tools };
}
