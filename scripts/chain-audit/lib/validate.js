#!/usr/bin/env node
/**
 * chain-audit configuration validation (fail closed).
 * Runs before any gateway/agent work so a malformed matrix or RPC probe list
 * can never silently drop checks.
 */
import { validateCheckNames } from "./checks.js";

export function collectMatrixErrors(matrix) {
  const errors = [];
  if (!matrix || !Array.isArray(matrix.chains) || matrix.chains.length === 0) {
    return ["matrix.json must contain a non-empty 'chains' array"];
  }
  const chainIds = new Set();
  const taskIds = new Set();
  for (const chain of matrix.chains) {
    if (!chain.id || chainIds.has(chain.id)) errors.push(`duplicate/missing chain id: ${chain.id}`);
    chainIds.add(chain.id);
    if (!Array.isArray(chain.tasks) || chain.tasks.length === 0) {
      errors.push(`chain '${chain.id}' has no tasks`);
      continue;
    }
    for (const task of chain.tasks) {
      const fullId = `${chain.id}/${task.id}`;
      if (!task.id || taskIds.has(fullId)) errors.push(`duplicate/missing task id: ${fullId}`);
      taskIds.add(fullId);
      if (typeof task.message !== "string" || !task.message.trim()) {
        errors.push(`task '${fullId}' is missing a message`);
      }
      if (!Array.isArray(task.checks) || task.checks.length === 0) {
        errors.push(`task '${fullId}' must declare at least one check`);
      } else {
        try { validateCheckNames(task); } catch (e) { errors.push(e.message); }
      }
      if (task.timeoutMs !== undefined && (!Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0)) {
        errors.push(`task '${fullId}' has invalid timeoutMs`);
      }
      for (const fc of task.fileChecks ?? []) {
        if (!fc.label || !fc.path) {
          errors.push(`task '${fullId}' fileCheck requires label and path`);
          continue;
        }
        for (const [k, arr] of [["positive", fc.positive ?? []], ["negative", fc.negative ?? []]]) {
          for (const re of arr) {
            try { new RegExp(re); } catch { errors.push(`task '${fullId}' fileCheck '${fc.label}' has invalid ${k} regex: ${re}`); }
          }
        }
      }
      for (const tr of task.toolResultChecks ?? []) {
        if (!tr.tool || !Array.isArray(tr.patterns) || tr.patterns.length === 0) {
          errors.push(`task '${fullId}' toolResultChecks require tool + patterns`);
          continue;
        }
        for (const re of tr.patterns) {
          try { new RegExp(re, "i"); } catch { errors.push(`task '${fullId}' toolResult '${tr.tool}' has invalid pattern: ${re}`); }
        }
      }
    }
  }
  return errors;
}

export function collectRpcErrors(config) {
  const errors = [];
  if (!config || !Array.isArray(config.groups) || config.groups.length === 0) {
    return ["rpc-checks.json must contain a non-empty 'groups' array"];
  }
  const groupIds = new Set();
  for (const group of config.groups) {
    if (!group.id || groupIds.has(group.id)) errors.push(`duplicate/missing rpc group id: ${group.id}`);
    groupIds.add(group.id);
    const entries = [
      ...(group.checks ?? []).map((c) => ({ ...c, mode: "normal" })),
      ...(group.adminOnly ?? []).map((c) => ({ ...c, mode: "deny" })),
      ...(group.adminOk ?? []).map((c) => ({ ...c, mode: "allow" })),
    ];
    if (entries.length === 0) errors.push(`rpc group '${group.id}' has no checks`);
    const sigs = new Set();
    for (const c of entries) {
      if (typeof c.method !== "string" || !c.method) errors.push(`rpc group '${group.id}' has an entry without method`);
      const sig = `${c.mode}|${c.method}|${JSON.stringify(c.params ?? {})}`;
      if (sigs.has(sig)) errors.push(`rpc group '${group.id}' has duplicate ${c.mode} probe for ${c.method}`);
      sigs.add(sig);
      if (typeof c.expectError === "string" && c.expectError.length > 0) {
        try { new RegExp(c.expectError, "i"); } catch { errors.push(`rpc group '${group.id}' ${c.method} has invalid expectError regex`); }
      }
      if (c.expect !== undefined && (typeof c.expect !== "object" || c.expect === null)) {
        errors.push(`rpc group '${group.id}' ${c.method} 'expect' must be an object`);
      }
    }
  }
  return errors;
}
