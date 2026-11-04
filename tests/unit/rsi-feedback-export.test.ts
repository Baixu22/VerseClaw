// @vitest-environment node
// TF-0654: the pilot's input must come from recorded feedback, not from a
// hand-written fixture. These tests pin the export's join and its honesty when
// the state database or the table is absent.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';

import { exportFeedback, resolveStateDbPath } from '../../scripts/rsi-feedback-export.mjs';

const TEMP_ROOT = 'D:/tmp';
const created: string[] = [];

function tempDb(rows: Array<{ id: string; injectionId: string | null; cardId: string | null; outcome: string; task?: string | null }>): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TEMP_ROOT, 'rsi-feedback-export-'));
  created.push(dir);
  const dbPath = join(dir, 'openclaw.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE role_memory_injections (id TEXT PRIMARY KEY, role_name TEXT, task TEXT, session_key TEXT, card_ids_json TEXT, reasons_json TEXT, budget_json TEXT, estimated_tokens_json TEXT, truncated INTEGER, created_at TEXT);
    CREATE TABLE role_memory_feedback (id TEXT PRIMARY KEY, injection_id TEXT, card_id TEXT, role_name TEXT, outcome TEXT, task_success TEXT, note TEXT, actor_json TEXT, created_at TEXT);`);
  for (const row of rows) {
    if (row.injectionId) {
      db.prepare('INSERT INTO role_memory_injections (id, role_name, task, created_at) VALUES (?, ?, ?, ?)')
        .run(row.injectionId, 'coder', row.task ?? null, '2026-11-03T00:00:00Z');
    }
    db.prepare('INSERT INTO role_memory_feedback (id, injection_id, card_id, role_name, outcome, task_success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.injectionId, row.cardId, 'coder', row.outcome, 'success', '2026-11-03T00:00:01Z');
  }
  db.close();
  return dbPath;
}

afterAll(() => {
  for (const path of created) {
    if (!resolve(path).startsWith(`${resolve(TEMP_ROOT)}${sep}rsi-feedback-export-`)) throw new Error('unexpected temporary cleanup path');
    rmSync(path, { recursive: true, force: true });
  }
});

describe('rsi feedback export', () => {
  it('review regression: resolves the role-memory producer database, not the shared state database', () => {
    expect(resolveStateDbPath({ OPENCLAW_STATE_DIR: 'D:/tmp/rsi-feedback-state' }))
      .toBe(resolve('D:/tmp/rsi-feedback-state/role-memory.sqlite'));
    expect(resolveStateDbPath({ OPENCLAW_HOME: 'D:/tmp/rsi-feedback-home' }))
      .toBe(resolve('D:/tmp/rsi-feedback-home/.openclaw/role-memory.sqlite'));
  });

  it('review regression: preserves task-success states instead of turning unknown into failure', () => {
    const dbPath = tempDb([{ id: 'f1', injectionId: 'i1', cardId: 'c1', outcome: 'neutral', task: 'task-1' }]);
    const db = new DatabaseSync(dbPath);
    try {
      for (const value of ['success', 'partial', 'failure', 'unknown']) {
        db.prepare('UPDATE role_memory_feedback SET task_success = ?').run(value);
        expect(exportFeedback({ dbPath }).records[0].taskSuccess).toBe(value);
      }
    } finally { db.close(); }
  });

  it('joins feedback rows to recorded task ids through the injection', () => {
    const dbPath = tempDb([
      { id: 'f1', injectionId: 'i1', cardId: 'c1', outcome: 'helpful', task: 'TF-0274' },
      { id: 'f2', injectionId: 'i2', cardId: 'c2', outcome: 'harmful', task: null },
      { id: 'f3', injectionId: null, cardId: 'c3', outcome: 'neutral' },
    ]);
    const exported = exportFeedback({ dbPath });

    expect(exported.source.state).toBe('present');
    expect(exported.driven_by).toBe('agent');
    expect(exported.records).toHaveLength(3);
    const byId = Object.fromEntries(exported.records.map((record) => [record.id, record]));
    expect(byId.f1.caseId).toBe('TF-0274');
    expect(byId.f2.caseId).toBeNull();
    expect(byId.f3.injectionId).toBeNull();
    expect(byId.f3.caseId).toBeNull();
  });

  it('reports an absent database instead of fabricating rows', () => {
    const exported = exportFeedback({ dbPath: join(TEMP_ROOT, 'rsi-feedback-export-does-not-exist.sqlite') });

    expect(exported.source.state).toBe('absent');
    expect(exported.records).toEqual([]);
    expect(exported.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('labels a missing join schema and a truncated export', () => {
    const dbPath = tempDb([
      { id: 'f1', injectionId: 'i1', cardId: 'c1', outcome: 'helpful', task: 'one' },
      { id: 'f2', injectionId: 'i2', cardId: 'c2', outcome: 'neutral', task: 'two' },
    ]);
    expect(exportFeedback({ dbPath, maxRows: 1 }).source).toMatchObject({ totalRows: 2, exportedRows: 1, truncated: true });
    const db = new DatabaseSync(dbPath);
    db.exec('DROP TABLE role_memory_injections');
    db.close();
    expect(exportFeedback({ dbPath }).source.state).toBe('schema-absent');
  });
});
