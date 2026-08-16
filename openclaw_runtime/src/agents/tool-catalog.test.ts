/**
 * Core tool catalog drift tripwires.
 *
 * The catalog drives profile allowlists, group expansion, and UI sections.
 * Tools constructed by the runtime but missing from the catalog are silently
 * filtered when a profile allowlist is active, so constructed OpenClaw tool
 * ids must stay cataloged here.
 */
import { describe, expect, it } from "vitest";
import {
  isKnownCoreToolId,
  listCoreToolSections,
  resolveCoreToolProfilePolicy,
} from "./tool-catalog.js";

/** Constructed OpenClaw-owned tool ids; each entry cites its construction site. */
const CONSTRUCTED_CORE_TOOL_IDS = [
  // openclaw-tools.ts -> tools/pdf-tool.ts createPdfTool
  "pdf",
  // openclaw-tools.ts -> tools/transcripts-tool.ts createTranscriptsTool
  "transcripts",
  // openclaw-tools.ts -> tools/agent-browser-tool.ts createAgentBrowserTool
  "agent_browser",
  // openclaw-tools.ts -> tools/automation-playbook-selector-tool.ts createAutomationPlaybookSelectorTool
  "select_automation_playbook",
  // agent-tools.ts -> tools/write-journal.ts UNDO_WRITE_TOOL_NAME
  "undo_write",
  // agent-tools.ts -> runtime-core/memory-query-tool.ts createMemoryQueryTool
  "memory_query",
  // agent-tools.ts -> tool-search.ts TOOL_SEARCH_* names
  "tool_search",
  "tool_search_code",
  "tool_describe",
  "tool_call",
  // code-mode.ts -> code-mode-control-tools.ts CODE_MODE_WAIT_TOOL_NAME
  "wait",
  // agent-tools.ts -> verseshell/result-tool.ts createVerseShellResultTool
  "verseshell_result",
  // agent-tools.ts -> verseshell/readonly-facade.ts CLAWX_VERSESHELL_FACADE
  "read_file",
  "search_content",
  "result_query",
] as const;

describe("core tool catalog", () => {
  it("has no duplicate ids across sections", () => {
    const ids = listCoreToolSections().flatMap((section) => section.tools.map((tool) => tool.id));
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("catalogs every constructed OpenClaw tool id (drift tripwire)", () => {
    for (const id of CONSTRUCTED_CORE_TOOL_IDS) {
      expect(isKnownCoreToolId(id), `CORE_TOOL_DEFINITIONS is missing "${id}"`).toBe(true);
    }
  });

  it("keeps every constructed coding-run tool in the coding profile", () => {
    const policy = resolveCoreToolProfilePolicy("coding");
    expect(policy?.allow).toBeDefined();
    const allow = new Set(policy?.allow ?? []);
    for (const id of CONSTRUCTED_CORE_TOOL_IDS) {
      expect(allow.has(id), `coding profile is missing "${id}"`).toBe(true);
    }
  });

  it("keeps built-in profile allowlists duplicate-free", () => {
    for (const profile of ["minimal", "coding", "messaging"] as const) {
      const allow = resolveCoreToolProfilePolicy(profile)?.allow ?? [];
      expect(allow, `${profile} allowlist`).toHaveLength(new Set(allow).size);
    }
  });
});
