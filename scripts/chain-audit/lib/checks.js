#!/usr/bin/env node
/**
 * chain-audit outcome-check engine.
 *
 * Every matrix task declares check names in `checks`. Each declared name is
 * resolved to concrete evidence:
 *
 *   tools.<name>          tool was called; by default it must also have succeeded
 *                         (isError=false). Per-tool `toolModes.<name>: "call"`
 *                         relaxes to call-only for probes that exercise errors.
 *   hasAnswer             at least one model round AND non-empty final answer.
 *   memory.available      memory_search/memory_get result indicates a usable index.
 *   answerContains.<i>    final answer text contains task.answerContains[i].
 *   fileCheck.<label>     task.fileChecks entry evaluated against workspace files.
 *   toolResult.<tool>     task.toolResultChecks entry: result text matches patterns.
 *
 * Unknown declared check names are a config error (fail closed): they are never
 * silently dropped. validateCheckNames() runs before any gateway/agent work.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function declaredChecks(task) {
  return Array.isArray(task.checks) && task.checks.length > 0 ? task.checks : ["hasAnswer"];
}

/** Throw a precise error when a declared check cannot be evaluated. */
export function validateCheckNames(task) {
  const names = declaredChecks(task);
  const fileLabels = new Set((task.fileChecks ?? []).map((f) => f.label));
  const answerCount = (task.answerContains ?? []).length;
  const toolResultTools = new Set((task.toolResultChecks ?? []).map((t) => t.tool));
  for (const n of names) {
    if (n === "hasAnswer" || n === "memory.available") continue;
    if (/^tools\.[A-Za-z0-9_]+$/.test(n)) continue;
    if (/^answerContains\.(\d+)$/.test(n)) {
      const idx = Number(n.split(".")[1]);
      if (Number.isInteger(idx) && idx >= 0 && idx < answerCount) continue;
    }
    if (/^fileCheck\.(.+)$/.test(n)) {
      if (fileLabels.has(n.slice("fileCheck.".length))) continue;
    }
    if (/^toolResult\.(.+)$/.test(n)) {
      if (toolResultTools.has(n.slice("toolResult.".length))) continue;
    }
    throw new Error(
      `chain-audit config error: task '${task.id}' declares check '${n}' but no matching spec exists. ` +
      `Add answerContains/fileChecks/toolResultChecks or remove the check (fail closed).`,
    );
  }
}

/** Build the check map for one task from transcript stats + workspace state. */
export function buildTaskChecks({ task, stats, transcriptRaw, workspace }) {
  const checks = {};
  const calls = stats?.toolCalls ?? [];
  const answer = stats?.answerText ?? "";
  const modelRounds = stats?.modelRounds ?? 0;
  const ctx = { task, calls, answer, raw: transcriptRaw ?? "", workspace, modelRounds };

  for (const name of declaredChecks(task)) {
    checks[name] = evaluateCheck(name, ctx);
  }

  const critical = Array.isArray(task.critical) ? task.critical : [];
  const criticalFailed = critical.filter((n) => checks[n] === false);
  return { checks, criticalFailed };
}

function evaluateCheck(name, ctx) {
  const { task, calls, answer, workspace } = ctx;
  const toolModes = task.toolModes ?? {};

  if (/^tools\./.test(name)) {
    const tool = name.slice("tools.".length);
    const mode = toolModes[tool] ?? task.toolMode ?? "success";
    const matched = calls.filter((c) => c.name === tool);
    if (matched.length === 0) return false;
    if (mode === "call") return true;
    // success mode is fail-closed: need an explicit isError=false result.
    return matched.some((c) => c.ok === true);
  }

  if (name === "hasAnswer") {
    return ctx.modelRounds > 0 && answer.trim().length > 0;
  }

  if (name === "memory.available") {
    const memoryCalls = calls.filter((c) => /^memory_(search|get)$/.test(c.name));
    return memoryCalls.some(
      (c) => c.ok === true && !/disabled|metadata is missing|unavailable|no index|not indexed/i.test(c.resultPreview ?? ""),
    );
  }

  if (/^answerContains\.(\d+)$/.test(name)) {
    const idx = Number(name.split(".")[1]);
    const marker = (task.answerContains ?? [])[idx];
    if (marker === undefined) return false;
    return answer.toLowerCase().includes(String(marker).toLowerCase());
  }

  if (/^fileCheck\.(.+)$/.test(name)) {
    const label = name.slice("fileCheck.".length);
    const spec = (task.fileChecks ?? []).find((f) => f.label === label);
    return spec ? evaluateFileSpec(spec, workspace) : false;
  }

  if (/^toolResult\.(.+)$/.test(name)) {
    const tool = name.slice("toolResult.".length);
    const spec = (task.toolResultChecks ?? []).find((t) => t.tool === tool);
    if (!spec) return false;
    const results = calls.filter((c) => c.name === tool);
    const okOnly = spec.okOnly !== false;
    return results.some((c) => {
      if (okOnly && c.ok !== true) return false;
      const text = c.resultPreview ?? "";
      return (spec.patterns ?? []).every((p) => new RegExp(p, "i").test(text));
    });
  }

  return false;
}

/** Evaluate a file-state / file-shape specification against the workspace. */
export function evaluateFileSpec(spec, workspace) {
  const p = join(workspace, spec.path);
  if (spec.state === "absent") return !existsSync(p);
  if (spec.state === "exists") return existsSync(p);
  let text = null;
  try { text = readFileSync(p, "utf8"); } catch { return false; }
  const positive = (spec.positive ?? []).every((re) => new RegExp(re).test(text));
  const negative = (spec.negative ?? []).every((re) => !new RegExp(re).test(text));
  return positive && negative;
}

/** Snapshot hashes for every fileCheck path of a task (before/after attribution). */
export function snapshotTaskFiles(task, workspace) {
  const out = {};
  for (const spec of task.fileChecks ?? []) {
    const p = join(workspace, spec.path);
    out[spec.path] = hashFile(p);
  }
  return out;
}

function hashFile(p) {
  try {
    return fnv1a(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
