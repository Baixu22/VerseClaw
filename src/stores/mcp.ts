import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type {
  McpServerCreatePayload,
  McpServerUpdatePayload,
} from '@shared/host-api/contract';
import type { McpServerConfig } from '@shared/types/mcp';

interface McpState {
  servers: McpServerConfig[];
  loading: boolean;
  error: string | null;
  fetchServers: () => Promise<void>;
  createServer: (input: McpServerCreatePayload) => Promise<void>;
  updateServer: (input: McpServerUpdatePayload) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  testServer: (id: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  heartbeat: (id: string) => Promise<Awaited<ReturnType<typeof hostApi.mcp.heartbeat>>>;
  listTools: (id: string) => Promise<Awaited<ReturnType<typeof hostApi.mcp.listTools>>>;
  reloadRuntime: (input?: Parameters<typeof hostApi.mcp.reloadRuntime>[0]) => Promise<Awaited<ReturnType<typeof hostApi.mcp.reloadRuntime>>>;
}

function applyServers(result: { servers?: McpServerConfig[] }) {
  return { servers: result.servers ?? [] };
}

export const useMcpStore = create<McpState>((set) => ({
  servers: [],
  loading: false,
  error: null,

  fetchServers: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApi.mcp.listServers();
      set({ ...applyServers(result), loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createServer: async (input) => {
    set({ error: null });
    try {
      const result = await hostApi.mcp.createServer(input);
      set(applyServers(result));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateServer: async (input) => {
    set({ error: null });
    try {
      const result = await hostApi.mcp.updateServer(input);
      set(applyServers(result));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteServer: async (id) => {
    set({ error: null });
    try {
      const result = await hostApi.mcp.deleteServer({ id });
      set(applyServers(result));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  testServer: async (id) => {
    return await hostApi.mcp.testServer({ id });
  },

  heartbeat: async (id) => {
    const result = await hostApi.mcp.heartbeat({ serverId: id });
    if (result.server) {
      set((state) => ({
        servers: state.servers.map((server) => (server.id === id ? result.server! : server)),
      }));
    }
    return result;
  },

  listTools: async (id) => {
    const result = await hostApi.mcp.listTools({ serverId: id });
    if (result.success) {
      set((state) => ({
        servers: state.servers.map((server) => (
          server.id === id
            ? { ...server, toolCount: result.tools.length, runtimeStatus: result.status }
            : server
        )),
      }));
    }
    return result;
  },

  reloadRuntime: async (input) => {
    return await hostApi.mcp.reloadRuntime(input);
  },
}));
