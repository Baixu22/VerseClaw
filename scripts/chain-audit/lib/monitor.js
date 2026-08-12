#!/usr/bin/env node
/**
 * chain-audit 证据采集库
 * 从会话 transcript JSONL + gateway 日志中提取量化指标：
 * token 用量/缓存命中率/工具调用序列/压缩事件/错误。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AGENT_SESSIONS_DIR = () => join(homedir(), ".openclaw", "agents", "main", "sessions");

/** 读取最新（或指定）会话 transcript，解析为结构化指标。
 *  @param {string} transcriptPath
 *  @param {number} [startLine] 只分析该行之后的新增消息（任务级隔离，避免历史串扰）
 */
export function analyzeTranscript(transcriptPath, startLine = 0) {
  if (!existsSync(transcriptPath)) return null;
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
    toolCalls: [],          // {name, argsPreview, resultPreview}
    userMessages: 0,
    toolResultCount: 0,
    errors: [],             // 工具错误
    lastRole: null,
  };

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
            args: JSON.stringify(c.arguments ?? {}).slice(0, 120),
          });
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
      const txt = JSON.stringify(m.content || m.details || "");
      if (m.isError || /"error"/.test(txt)) {
        stats.errors.push({ tool: m.toolName, text: txt.slice(0, 200) });
      }
    } else if (m.role === "user") {
      stats.userMessages++;
    }
  }

  stats.cacheHitRate = stats.totalInput + stats.totalCacheRead > 0
    ? +(stats.totalCacheRead / (stats.totalInput + stats.totalCacheRead) * 100).toFixed(1)
    : 0;
  return stats;
}

/** 定位最新会话 transcript 文件（排除 trajectory）。 */
export function latestTranscript() {
  const dir = AGENT_SESSIONS_DIR();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && !f.includes("trajectory"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}

/** 从 gateway 日志提取关键事件（压缩/重载/错误/瓶颈）。 */
export function analyzeGatewayLog(logPath) {
  if (!existsSync(logPath)) return null;
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
