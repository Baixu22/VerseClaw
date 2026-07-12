/**
 * agent-reach-ts-shadow —— 汇总导出。
 *
 * 形状对齐 ClawX 的 definePluginEntry：
 *   import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
 *   export default definePluginEntry({ id, name, description, register(api) { ... } });
 *
 * 迁移到 ClawX 时：
 *   1. 把 src/common/* 换成 ClawX 的 typebox / AnyAgentTool / definePluginEntry
 *   2. 把本文件原样放到 openclaw_runtime/extensions/reach-readers/index.ts
 *   3. 在 TOOLS.clawx.md 加一节 ### Platform Readers 路由
 */
import type { AnyAgentTool } from './common/tool-shape.js';
import { definePluginEntry, type PluginEntry, type PluginApi } from './common/plugin-entry.js';
import { hydrateReachConfig } from './core/config.js';
import { configureReachBrowserBridge } from './core/browser-bridge.js';

import { webReadTool } from './tools/web.js';
import { rssReadTool } from './tools/rss.js';
import { v2exReadTool } from './tools/v2ex.js';
import { xueqiuReadTool } from './tools/xueqiu.js';
import { bilibiliReadTool } from './tools/bilibili.js';
import { youtubeReadTool } from './tools/youtube.js';
import { githubReadTool } from './tools/github.js';
import { twitterReadTool } from './tools/twitter.js';
import { xiaohongshuReadTool } from './tools/xiaohongshu.js';

/** 全部工具的清单 —— 对齐 ClawX 扩展的 register(api) 模式。 */
export const ALL_TOOLS: AnyAgentTool[] = [
  webReadTool,
  rssReadTool,
  v2exReadTool,
  xueqiuReadTool,
  bilibiliReadTool,
  youtubeReadTool,
  githubReadTool,
  twitterReadTool,
  xiaohongshuReadTool,
].map((tool) => ({ ...tool, risk: 'readonly' as const }));

/** 工具名 → 工具 的查找表（迁移到 ClawX 时由 api.registerTool 自动建立）。 */
export const TOOL_BY_NAME: Record<string, AnyAgentTool> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

/**
 * 插件入口 —— 迁移到 ClawX 时换成真正的 definePluginEntry。
 *
 * 对照 ClawX 用法（openclaw_runtime/extensions/exa/index.ts）：
 *   export default definePluginEntry({
 *     id: "reach-readers",
 *     name: "Reach Readers",
 *     register(api) {
 *       api.registerTool(webReadTool, { names: ["web_read"] });
 *       ...
 *     },
 *   });
 */
export const reachReadersPlugin: PluginEntry = definePluginEntry({
  id: 'reach-readers',
  name: 'Reach Readers',
  description: 'Per-platform content readers (yt-dlp, gh, bili-cli, opencli, rss, ...) — TS shadow of Agent Reach',
  register(api: PluginApi) {
    configureReachBrowserBridge(api.runtime.agentBrowser?.invoke);
    let hydration: ReturnType<typeof hydrateReachConfig> | undefined;
    for (const tool of ALL_TOOLS) {
      const configuredTool = {
        ...tool,
        async execute(...args: Parameters<typeof tool.execute>) {
          hydration ??= hydrateReachConfig({
            config: api.config,
            pluginConfig: api.pluginConfig,
          });
          await hydration;
          return tool.execute(...args);
        },
      };
      api.registerTool(configuredTool, { names: [tool.name] });
    }
  },
});

export default reachReadersPlugin;

// Re-export everything for programmatic use
export * from './common/schema.js';
export * from './common/tool-shape.js';
export * from './common/plugin-entry.js';
export * from './core/probe.js';
export * from './core/router.js';
export * from './core/config.js';
export * from './types.js';

export { webReadTool, rssReadTool, v2exReadTool, xueqiuReadTool, bilibiliReadTool,
         youtubeReadTool, githubReadTool, twitterReadTool, xiaohongshuReadTool } from './tools/index.js';
