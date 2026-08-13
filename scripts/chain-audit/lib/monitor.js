#!/usr/bin/env node
/**
 * chain-audit evidence collection library.
 *
 * Parses session transcript JSONL + gateway logs into structured, evidence-grade
 * metrics. Tool calls are linked to their results through `toolCallId`, so a
 * tool that was merely invoked but errored is no longer reported as success.
 * Final answer text excludes the `NO_REPLY` sentinel used by the agent loop.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AGENT_SESSIONS_DIR = () => join(homedir(), ".openclaw", "agents", "main", "sessions");

export const NO_REPLY_SENTINEL = "NO_REPLY";

/** Extract readable text from a transcript content payload. */
export function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c?.text ?? c?.content ?? ""))
      .join("");
  }
  if (content && typeof content === "object") return content.text ?? content.content ?? "";
  return "";
}

/**
 * Analyze a session transcript.
 * @param {string|null} transcriptPath
 * @param {number} [startLine] only analyze lines after this offset (task isolation)
 * @returns {object|null} structured stats, or null when the transcript is missing
 */
export function analyzeTranscript(transcriptPath, startLine = 0) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  const target = lines.slice(startLine);

  const stats = {
    messageCount: 0,
    modelRounds: 0,
    totalInput: 0,
    totalCacheRead: 0,
    totalOutput: 0,
    totalCost: 0,
    maxCacheRead: 0,
    toolCalls: [], // { name, args, id, ok, isError, resultPreview }
    userMessages: 0,
    toolResultCount: 0,
    errors: [], // only real isError tool results
    lastRole: null,
    answerText: "",
    complete: false,
    matched: false,
  };

  // Pass 1: collect tool results by toolCallId for success/failure attribution.
  const toolResults = new Map();
  for (const line of target) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== "message") continue;
    const m = r.message;
    if (m?.role === "toolResult" && m.toolCallId) {
      toolResults.set(m.toolCallId, {
        isError: m.isError === true,
        toolName: m.toolName,
        text: extractText(m.content),
      });
    }
  }

  // Pass 2: build stats and attach results to tool calls.
  const answerParts = [];
  for (const line of target) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== "message") continue;
    const m = r.message;
    stats.messageCount++;
    stats.lastRole = m.role;

    if (m.role === "assistant") {
      for (const c of m.content || []) {
        if (c.type === "toolCall") {
          stats.toolCalls.push({
            name: c.name,
            args: safeStringify(c.arguments ?? {}).slice(0, 120),
            id: c.id ?? null,
            ok: null,
            isError: null,
            resultPreview: undefined,
          });
        } else if (c.type === "text" && typeof c.text === "string" && c.text.trim() && c.text.trim() !== NO_REPLY_SENTINEL) {
          answerParts.push(c.text.trim());
        }
      }
      if (m.usage) {
        stats.modelRounds++;
        stats.totalInput += m.usage.input || 0;
        stats.totalCacheRead += m.usage.cacheRead || 0;
        stats.totalOutput += m.usage.output || 0;
        stats.totalCost += m.usage.cost?.total || 0;
        stats.maxCacheRead = Math.max(stats.maxCacheRead, m.usage.cacheRead || 0);
      }
    } else if (m.role === "toolResult") {
      stats.toolResultCount++;
      if (m.isError === true) {
        stats.errors.push({ tool: m.toolName, text: extractText(m.content).slice(0, 200) });
      }
    } else if (m.role === "user") {
      stats.userMessages++;
    }
  }

  for (const tc of stats.toolCalls) {
    const tr = tc.id ? toolResults.get(tc.id) : undefined;
    tc.ok = tr ? !tr.isError : null; // null = no result seen yet (fail-closed)
    tc.isError = tr?.isError ?? null;
    tc.resultPreview = tr?.text ? tr.text.slice(0, 200) : undefined;
  }

  stats.answerText = answerParts.join("\n").trim();
  stats.hasFinalAnswer = stats.answerText.length > 0;
  stats.complete = stats.lastRole === "assistant";
  stats.errorCount = stats.errors.length;
  stats.cacheHitRate =
    stats.totalInput + stats.totalCacheRead > 0
      ? +((stats.totalCacheRead / (stats.totalInput + stats.totalCacheRead)) * 100).toFixed(1)
      : 0;
  return stats;
}

function safeStringify(value) {
  try { return JSON.stringify(value); } catch { return ""; }
}

/** Latest session transcript file (excludes trajectory). */
export function latestTranscript() {
  const dir = AGENT_SESSIONS_DIR();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && !f.includes("trajectory"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/** Extract key gateway-log events (compaction/reload/errors/bottlenecks). */
export function analyzeGatewayLog(logPath) {
  if (!logPath || !existsSync(logPath)) return null;
  const content = readFileSync(logPath, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const lines = content.split("\n");
  return {
    compactionEvents: lines.filter((l) => /compact|compression/i.test(l)),
    reloadEvents: lines.filter((l) => /\[reload\]/.test(l)),
    errorLines: lines.filter((l) => /error|fail|denied/i.test(l)).slice(-20),
    execDenied: lines.filter((l) => /exec denied/.test(l)).length,
    pluginToolsMs: extractStageMs(lines, "plugin-tools"),
    streamReadyMs: extractStageMs(lines, "stream-ready"),
    memoryPressure: lines.filter((l) => /memory pressure/.test(l)).slice(-3),
  };
}

function extractStageMs(lines, stageName) {
  for (const l of lines) {
    const m = l.match(new RegExp(`phase=${stageName} totalMs=(\\d+)`));
    if (m) return Number(m[1]);
  }
  return null;
}
