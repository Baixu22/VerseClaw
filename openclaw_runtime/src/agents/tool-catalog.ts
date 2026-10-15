/**
 * Core tool catalog and profile defaults.
 * Drives built-in profile allowlists, group expansion, and UI section metadata
 * for OpenClaw-owned tools.
 */
import {
  CRON_TOOL_DISPLAY_SUMMARY,
  EXEC_TOOL_DISPLAY_SUMMARY,
  PROCESS_TOOL_DISPLAY_SUMMARY,
  SESSIONS_HISTORY_TOOL_DISPLAY_SUMMARY,
  SESSIONS_LIST_TOOL_DISPLAY_SUMMARY,
  SESSIONS_SEND_TOOL_DISPLAY_SUMMARY,
  SESSIONS_SPAWN_TOOL_DISPLAY_SUMMARY,
  SESSION_STATUS_TOOL_DISPLAY_SUMMARY,
  MISSION_LOOP_TOOL_DISPLAY_SUMMARY,
  TASK_LOOP_TOOL_DISPLAY_SUMMARY,
  TEAM_ORCHESTRATE_TOOL_DISPLAY_SUMMARY,
  UPDATE_PLAN_TOOL_DISPLAY_SUMMARY,
} from "./tool-description-presets.js";

/** Built-in tool profile ids exposed in config and UI. */
export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

/** Allow/deny policy generated from a built-in tool profile. */
type ToolProfilePolicy = {
  allow?: string[];
  deny?: string[];
};

type CoreToolSection = {
  id: string;
  label: string;
  tools: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

type CoreToolDefinition = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  profiles: ToolProfileId[];
  includeInOpenClawGroup?: boolean;
};

const CORE_TOOL_SECTION_ORDER: Array<{ id: string; label: string }> = [
  { id: "fs", label: "Files" },
  { id: "runtime", label: "Runtime" },
  { id: "web", label: "Web" },
  { id: "memory", label: "Memory" },
  { id: "sessions", label: "Sessions" },
  { id: "ui", label: "UI" },
  { id: "messaging", label: "Messaging" },
  { id: "automation", label: "Automation" },
  { id: "nodes", label: "Nodes" },
  { id: "agents", label: "Agents" },
  { id: "media", label: "Media" },
];

const CORE_TOOL_DEFINITIONS: CoreToolDefinition[] = [
  {
    id: "read",
    label: "read",
    description: "Read file contents",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "ls",
    label: "ls",
    description: "List directory contents",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "write",
    label: "write",
    description: "Create or overwrite files",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "edit",
    label: "edit",
    description: "Make precise edits",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "apply_patch",
    label: "apply_patch",
    description: "Patch files",
    sectionId: "fs",
    profiles: ["coding"],
  },
  {
    id: "read_file",
    label: "read_file",
    description: "Read a workspace file through the VerseShell read-only facade",
    sectionId: "fs",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "read_files",
    label: "read_files",
    description: "Read several workspace files in one bounded call through the VerseShell read-only facade",
    sectionId: "fs",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "search_content",
    label: "search_content",
    description: "Search file contents through the VerseShell read-only facade",
    sectionId: "fs",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "result_query",
    label: "result_query",
    description: "Query a VerseShell result artifact handle by mode (meta/head/tail/slice/grep)",
    sectionId: "fs",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "undo_write",
    label: "undo_write",
    description: "Restore the previous snapshot of a file from the write journal",
    sectionId: "fs",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "exec",
    label: "exec",
    description: EXEC_TOOL_DISPLAY_SUMMARY,
    sectionId: "runtime",
    profiles: ["coding"],
  },
  {
    id: "process",
    label: "process",
    description: PROCESS_TOOL_DISPLAY_SUMMARY,
    sectionId: "runtime",
    profiles: ["coding"],
  },
  {
    id: "wait",
    label: "wait",
    description: "Resume a suspended Code Mode run returned by exec",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "verseshell_result",
    label: "verseshell_result",
    description: "Inspect a result:// artifact returned by exec (bounded slice)",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tool_search",
    label: "tool_search",
    description: "Search the session tool catalog by name or description",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tool_search_code",
    label: "tool_search_code",
    description: "Run JavaScript in the Tool Search sandbox to query the session tool catalog",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tool_describe",
    label: "tool_describe",
    description: "Show the schema and description of a tool found via tool_search",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tool_call",
    label: "tool_call",
    description: "Invoke a tool found via tool_search",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "code_execution",
    label: "code_execution",
    description: "Run sandboxed remote analysis",
    sectionId: "runtime",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "web_search",
    label: "web_search",
    description: "Search the web",
    sectionId: "web",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "web_fetch",
    label: "web_fetch",
    description: "Fetch web content",
    sectionId: "web",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "x_search",
    label: "x_search",
    description: "Search X posts",
    sectionId: "web",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "memory_search",
    label: "memory_search",
    description: "Semantic search",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "memory_get",
    label: "memory_get",
    description: "Read memory files",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "memory_query",
    label: "memory_query",
    description: "Search the agent's long-term memory store for stored facts",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_read",
    label: "context_read",
    description: "Read full context blocks on demand",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_archive_recall",
    label: "context_archive_recall",
    description: "Read a bounded excerpt from a masked observation archive",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_search",
    label: "context_search",
    description: "Search context blocks by entity/query",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_write",
    label: "context_write",
    description: "Update agent notes context block",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_understand",
    label: "context_understand",
    description: "Build a ContextPack for a coding goal",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_impact",
    label: "context_impact",
    description: "Analyze callers/callees and blast radius",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_reuse",
    label: "context_reuse",
    description: "Find existing helpers before writing new code",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "context_verify",
    label: "context_verify",
    description: "Review a diff for related tests and blast radius",
    sectionId: "memory",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_compact",
    label: "sessions_compact",
    description: "Compact the current session after this turn",
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_list",
    label: "sessions_list",
    description: SESSIONS_LIST_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_history",
    label: "sessions_history",
    description: SESSIONS_HISTORY_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_send",
    label: "sessions_send",
    description: SESSIONS_SEND_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "task_loop",
    label: "task_loop",
    description: TASK_LOOP_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "mission_loop",
    label: "mission_loop",
    description: MISSION_LOOP_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "team_orchestrate",
    label: "team_orchestrate",
    description: TEAM_ORCHESTRATE_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_spawn",
    label: "sessions_spawn",
    description: SESSIONS_SPAWN_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "sessions_yield",
    label: "sessions_yield",
    description: "End turn to receive sub-agent results",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "subagents",
    label: "subagents",
    description: "Manage sub-agents",
    sectionId: "sessions",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "session_status",
    label: "session_status",
    description: SESSION_STATUS_TOOL_DISPLAY_SUMMARY,
    sectionId: "sessions",
    profiles: ["minimal", "coding", "messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "browser",
    label: "browser",
    description: "Control web browser",
    sectionId: "ui",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "agent_browser",
    label: "agent_browser",
    description: "Drive the internal Agent Browser for web automation",
    sectionId: "ui",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "canvas",
    label: "canvas",
    description: "Control node Canvas surfaces when the Canvas plugin is enabled",
    sectionId: "ui",
    profiles: [],
  },
  {
    id: "message",
    label: "message",
    description: "Send messages",
    sectionId: "messaging",
    profiles: ["messaging"],
    includeInOpenClawGroup: true,
  },
  {
    id: "heartbeat_respond",
    label: "heartbeat_respond",
    description: "Record heartbeat outcomes",
    sectionId: "automation",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "cron",
    label: "cron",
    description: CRON_TOOL_DISPLAY_SUMMARY,
    sectionId: "automation",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "select_automation_playbook",
    label: "select_automation_playbook",
    description: "Pick a browser-automation playbook for the current request",
    sectionId: "automation",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "gateway",
    label: "gateway",
    description: "Gateway control",
    sectionId: "automation",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "nodes",
    label: "nodes",
    description: "Nodes + devices",
    sectionId: "nodes",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "agents_list",
    label: "agents_list",
    description: "List agents",
    sectionId: "agents",
    profiles: [],
    includeInOpenClawGroup: true,
  },
  {
    id: "get_goal",
    label: "get_goal",
    description: "Get current thread goal",
    sectionId: "agents",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "create_goal",
    label: "create_goal",
    description: "Create a thread goal",
    sectionId: "agents",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "update_goal",
    label: "update_goal",
    description: "Complete or block a thread goal",
    sectionId: "agents",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "update_plan",
    label: "update_plan",
    description: UPDATE_PLAN_TOOL_DISPLAY_SUMMARY,
    sectionId: "agents",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "skill_workshop",
    label: "skill_workshop",
    description:
      "Create, update, revise, list, inspect, apply, reject, or quarantine Skill Workshop proposals",
    sectionId: "agents",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "image",
    label: "image",
    description: "Image understanding",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "image_generate",
    label: "image_generate",
    description: "Image generation",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "music_generate",
    label: "music_generate",
    description: "Music generation",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "video_generate",
    label: "video_generate",
    description: "Video generation",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "pdf",
    label: "pdf",
    description: "Convert HTML to PDF documents",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "transcripts",
    label: "transcripts",
    description: "Start, stop, import, summarize, or inspect meeting transcripts",
    sectionId: "media",
    profiles: ["coding"],
    includeInOpenClawGroup: true,
  },
  {
    id: "tts",
    label: "tts",
    description: "Text-to-speech conversion",
    sectionId: "media",
    profiles: [],
    includeInOpenClawGroup: true,
  },
];

const CORE_TOOL_BY_ID = new Map<string, CoreToolDefinition>(
  CORE_TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
);

function listCoreToolIdsForProfile(profile: ToolProfileId): string[] {
  return CORE_TOOL_DEFINITIONS.filter((tool) => tool.profiles.includes(profile)).map(
    (tool) => tool.id,
  );
}

const CORE_TOOL_PROFILES: Record<ToolProfileId, ToolProfilePolicy> = {
  minimal: {
    allow: listCoreToolIdsForProfile("minimal"),
  },
  coding: {
    allow: [...listCoreToolIdsForProfile("coding"), "bundle-mcp"],
  },
  messaging: {
    allow: [...listCoreToolIdsForProfile("messaging"), "bundle-mcp"],
  },
  full: {
    allow: ["*"],
  },
};

function buildCoreToolGroupMap() {
  const sectionToolMap = new Map<string, string[]>();
  for (const tool of CORE_TOOL_DEFINITIONS) {
    const groupId = `group:${tool.sectionId}`;
    const list = sectionToolMap.get(groupId) ?? [];
    list.push(tool.id);
    sectionToolMap.set(groupId, list);
  }
  const openclawTools = CORE_TOOL_DEFINITIONS.filter((tool) => tool.includeInOpenClawGroup).map(
    (tool) => tool.id,
  );
  return {
    "group:openclaw": openclawTools,
    ...Object.fromEntries(sectionToolMap.entries()),
  };
}

/** Built-in core tool groups keyed by group id. */
export const CORE_TOOL_GROUPS: Record<string, string[]> = buildCoreToolGroupMap();

/** Profile options shown in model/tool configuration UIs. */
export const PROFILE_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "coding", label: "Coding" },
  { id: "messaging", label: "Messaging" },
  { id: "full", label: "Full" },
] as const;

/** Resolves the allow/deny policy for a built-in tool profile. */
export function resolveCoreToolProfilePolicy(profile?: string): ToolProfilePolicy | undefined {
  if (!profile) {
    return undefined;
  }
  const resolved = CORE_TOOL_PROFILES[profile as ToolProfileId];
  if (!resolved) {
    return undefined;
  }
  if (!resolved.allow && !resolved.deny) {
    return undefined;
  }
  return {
    allow: resolved.allow ? [...resolved.allow] : undefined,
    deny: resolved.deny ? [...resolved.deny] : undefined,
  };
}

/** Lists core tools grouped into UI sections. */
export function listCoreToolSections(): CoreToolSection[] {
  return CORE_TOOL_SECTION_ORDER.map((section) => ({
    id: section.id,
    label: section.label,
    tools: CORE_TOOL_DEFINITIONS.filter((tool) => tool.sectionId === section.id).map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
    })),
  })).filter((section) => section.tools.length > 0);
}

/** Lists built-in profile ids that include a core tool. */
export function resolveCoreToolProfiles(toolId: string): ToolProfileId[] {
  const tool = CORE_TOOL_BY_ID.get(toolId);
  if (!tool) {
    return [];
  }
  return [...tool.profiles];
}

/** Returns true when a tool id is a known core tool. */
export function isKnownCoreToolId(toolId: string): boolean {
  return CORE_TOOL_BY_ID.has(toolId);
}
