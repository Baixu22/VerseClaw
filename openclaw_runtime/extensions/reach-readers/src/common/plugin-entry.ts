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

export type PluginApi = Pick<OpenClawPluginApi, 'config' | 'pluginConfig' | 'registerTool'> & {
  runtime: OpenClawPluginApi['runtime'] & {
    agentBrowser: {
      invoke(params: {
        action: string;
        payload: Record<string, unknown>;
        timeoutMs?: number;
        signal?: AbortSignal;
      }): Promise<unknown>;
    };
  };
};
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
  } as unknown as Parameters<typeof defineOpenClawPluginEntry>[0]) as unknown as PluginEntry;
}

export function createCollectingApi(): { api: PluginApi; tools: AnyAgentTool[] } {
  const tools: AnyAgentTool[] = [];
  const api: PluginApi = {
    config: {},
    pluginConfig: {},
    runtime: {
      agentBrowser: { invoke: async () => { throw new Error('agent browser unavailable'); } },
      mediaUnderstanding: {
        transcribeAudioFile: async () => ({ text: undefined }),
      },
    } as unknown as PluginApi['runtime'],
    registerTool(tool) {
      if (typeof tool !== 'function') tools.push(tool);
    },
  };
  return { api, tools };
}
