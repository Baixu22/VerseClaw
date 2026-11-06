#!/usr/bin/env node
/**
 * Export recorded role-memory feedback into the RSI feedback-pilot input shape.
 *
 * Why: the pilot read `harness/specs/fixtures/rsi-feedback-loop/feedback-export.v1.json`
 * but nothing produced it, so the readout could only ever say "export absent".
 * Production feedback lives in the role-memory database
 * (`role_memory_feedback`), and a row can only be attributed to a task through
 * its injection (`role_memory_injections.task`). This export performs that join
 * and labels rows that have no case join instead of silently counting them.
 *
 * It never invents rows: a missing database, a missing table, or an empty table
 * produces an export with `source.state` set accordingly and `records: []`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FEEDBACK_EXPORT_PATH = 'harness/specs/fixtures/rsi-feedback-loop/feedback-export.v1.json';
const ACTOR = 'codex/rsi-feedback-export';

/** Match memory-store.ts: <resolveStateDir()>/role-memory.sqlite. --db overrides it. */
export function resolveStateDbPath(env = process.env) {
  const normalize = (value) => value?.trim() && !['null', 'undefined'].includes(value.trim()) ? value.trim() : undefined;
  const osHome = normalize(env.HOME) ?? normalize(env.USERPROFILE) ?? homedir();
  const expand = (path, home) => path.replace(/^~(?=$|[\\/])/u, home);
  const home = resolve(expand(normalize(env.OPENCLAW_HOME) ?? osHome, osHome));
  const stateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) return resolve(expand(stateDir, home), 'role-memory.sqlite');
  const current = join(home, '.openclaw'), legacy = join(home, '.clawdbot');
  const state = env.OPENCLAW_TEST_FAST !== '1' && !existsSync(current) && existsSync(legacy) ? legacy : current;
  return join(state, 'role-memory.sqlite');
}

function emptyExport(dbPath, state, note) {
  return {
    schemaVersion: 'RsiFeedbackExport/v1',
    generatedAt: new Date().toISOString(),
    driven_by: 'agent',
    actor: ACTOR,
    source: { dbPath, state, note },
    records: [],
  };
}

/**
 * @param {{dbPath?: string, maxRows?: number}} [options]
 */
export function exportFeedback(options = {}) {
  const dbPath = options.dbPath ?? resolveStateDbPath();
  const maxRows = options.maxRows ?? 5000;
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error('invalid-max-rows');
  if (!existsSync(dbPath)) return emptyExport(dbPath, 'absent', 'state database not found');

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (caught) {
    return emptyExport(dbPath, 'unreadable', caught instanceof Error ? caught.message : String(caught));
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('role_memory_feedback', 'role_memory_injections')").all();
    if (tables.length !== 2) return emptyExport(dbPath, 'schema-absent', 'role_memory_feedback or role_memory_injections table not found');
    const totalRows = Number(db.prepare('SELECT COUNT(*) AS count FROM role_memory_feedback').get().count);
    const rows = db
      .prepare(
        `SELECT f.id, f.injection_id, f.card_id, f.role_name, f.outcome, f.task_success, f.created_at,
                i.task AS case_id
           FROM role_memory_feedback f
           LEFT JOIN role_memory_injections i ON i.id = f.injection_id
          ORDER BY f.created_at DESC, f.id
          LIMIT ?`,
      )
      .all(maxRows);
    return {
      schemaVersion: 'RsiFeedbackExport/v1',
      generatedAt: new Date().toISOString(),
      driven_by: 'agent',
      actor: ACTOR,
      source: {
        dbPath,
        state: 'present',
        totalRows, exportedRows: rows.length, truncated: totalRows > rows.length,
        note: 'Left join role_memory_injections on injection_id; caseId is the recorded injection task.',
      },
      records: rows.map((row) => ({
        id: row.id,
        injectionId: row.injection_id ?? null,
        cardId: row.card_id ?? null,
        caseId: typeof row.case_id === 'string' && row.case_id.trim() ? row.case_id : null,
        roleName: row.role_name ?? null,
        outcome: row.outcome ?? 'unknown',
        taskSuccess: ['success', 'partial', 'failure', 'unknown'].includes(row.task_success) ? row.task_success : 'unknown',
        createdAt: row.created_at ?? null,
      })),
    };
  } catch (caught) {
    return emptyExport(dbPath, 'unreadable', caught instanceof Error ? caught.message : String(caught));
  } finally {
    db.close();
  }
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      out: { type: 'string' },
      'max-rows': { type: 'string' },
      write: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  try {
    const maxRows = values['max-rows'] ? Number(values['max-rows']) : undefined;
    const exported = exportFeedback({ dbPath: values.db ? resolve(values.db) : undefined, maxRows });
    const target = values.out ? resolve(values.out) : join(ROOT, FEEDBACK_EXPORT_PATH);
    if (values.write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
    }
    const summary = {
      passed: exported.source.state !== 'unreadable',
      sourceState: exported.source.state,
      rows: exported.records.length,
      withCaseId: exported.records.filter((record) => record.caseId !== null).length,
      target: values.write ? target : null,
    };
    console.log(JSON.stringify(values.json ? summary : summary, null, 2));
    process.exitCode = summary.passed ? 0 : 1;
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : String(caught));
    process.exitCode = 1;
  }
}
