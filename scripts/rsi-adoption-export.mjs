#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { resolveStateDbPath } from './rsi-feedback-export.mjs';

const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const evidenceKeys = ['schemaVersion', 'principleVersion', 'taskId', 'runId', 'sessionId', 'sessionKey',
  'experimentId', 'arm', 'repeat', 'trajectoryId', 'trigger', 'source', 'outcome', 'outcomeKind',
  'observationId', 'operation', 'actor', 'driven_by'];

function diagnostics(records) {
  return {
    missingTaskIdentity: records.filter((row) => row.evidence.taskId === null).length,
    missingExperimentIdentity: records.filter((row) => !row.evidence.experimentId || !row.evidence.arm || row.evidence.repeat === null).length,
    unknownOutcomes: records.filter((row) => row.evidence.trigger === 'outcome' && row.evidence.outcome === 'unknown').length,
    rejected: records.filter((row) => row.status === 'rejected').length,
    duplicates: records.reduce((sum, row) => sum + row.duplicateCount, 0),
    conflicts: records.reduce((sum, row) => sum + row.conflictCount, 0),
    rejections: records.reduce((sum, row) => sum + row.rejectionCount, 0),
  };
}

/** Read-only export of the shared SEKB owner; experimental coordinates are never inferred. */
export function exportAdoptionEvents({ dbPath = join(dirname(resolveStateDbPath()), 'state', 'openclaw.sqlite'), maxRows = 10000 } = {}) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new Error('invalid-max-rows');
  const report = { schemaVersion: 'RsiAdoptionExport/v1', generatedAt: new Date().toISOString(),
    driven_by: 'agent', actor: 'codex/rsi-adoption-export',
    source: { dbPath, state: 'absent', totalRows: 0, exportedRows: 0, truncated: false }, records: [], errors: [] };
  if (!existsSync(dbPath)) return { ...report, diagnostics: diagnostics([]) };
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sekb_attribution_events'").get();
    if (!table) return { ...report, source: { ...report.source, state: 'schema-absent' }, diagnostics: diagnostics([]) };
    const totalRows = Number(db.prepare('SELECT COUNT(*) AS count FROM sekb_attribution_events').get().count);
    const rows = db.prepare('SELECT * FROM sekb_attribution_events ORDER BY recorded_at, event_id LIMIT ?').all(maxRows);
    const records = rows.map((row) => {
      const evidence = JSON.parse(row.payload_json);
      // Unknown fields can contain raw payloads. Reject before including them in an export.
      if (Object.keys(evidence).some((key) => !evidenceKeys.includes(key))) throw new Error('unexpected-evidence-field');
      return { eventId: row.event_id, principleId: row.principle_id, evidence,
        runKey: row.run_key, payloadDigest: row.payload_digest,
        status: row.status, reason: row.reason, recordedAt: row.recorded_at,
        duplicateCount: row.duplicate_count, conflictCount: row.conflict_count,
        rejectionCount: row.rejection_count, firstRejection: row.first_rejection,
        lastConflict: row.last_conflict_json ? JSON.parse(row.last_conflict_json) : null };
    });
    return { ...report, source: { dbPath, state: 'present', totalRows, exportedRows: records.length, truncated: totalRows > records.length },
      records, diagnostics: diagnostics(records) };
  } catch {
    return { ...report, source: { ...report.source, state: 'unreadable' }, diagnostics: diagnostics([]), errors: [{ code: 'source-unreadable' }] };
  } finally { db?.close(); }
}

/** Independently recompute receipt identities, digests and export diagnostics. */
export function validateAdoptionExport(report) {
  const errors = [...(report?.errors ?? [])];
  const fail = (code, eventId) => errors.push({ code, ...(eventId ? { eventId } : {}) });
  if (report?.schemaVersion !== 'RsiAdoptionExport/v1' || report.driven_by !== 'agent' || !Array.isArray(report.records)) {
    return { passed: false, errors: [{ code: 'export-schema' }] };
  }
  if (report.source.exportedRows !== report.records.length || report.source.totalRows < report.records.length ||
    report.source.truncated !== (report.source.totalRows > report.records.length)) fail('row-count');
  for (const row of report.records) {
    const e = row.evidence;
    if (!e || e.schemaVersion !== 'RsiExperienceAttribution/v1' || e.driven_by !== 'agent' ||
      Object.keys(e).some((key) => !evidenceKeys.includes(key))) { fail('evidence-schema', row.eventId); continue; }
    const runKey = digest([e.taskId, e.runId, e.sessionId, e.sessionKey, e.experimentId, e.arm, e.repeat, e.runId ? null : e.trajectoryId]);
    const eventId = digest([runKey, row.principleId, e.principleVersion, e.trigger, e.source,
      e.operation?.toolCallId ?? null, e.outcomeKind, e.observationId]);
    if (row.runKey !== runKey || row.eventId !== eventId) fail('event-identity', row.eventId);
    if (row.payloadDigest !== digest({ ...e, trajectoryId: null })) fail('payload-digest', row.eventId);
    if (![row.duplicateCount, row.conflictCount, row.rejectionCount].every((value) => Number.isSafeInteger(value) && value >= 0)) fail('diagnostic-count', row.eventId);
    if (row.rejectionCount > 0 && !row.firstRejection) fail('rejection-history', row.eventId);
    if (row.status === 'accepted' && (!e.runId || (!e.sessionId && !e.sessionKey))) fail('accepted-identity-missing', row.eventId);
    if (!['accepted', 'rejected'].includes(row.status) || !['retrieved', 'operation', 'cited', 'adopted', 'outcome'].includes(e.trigger) ||
      !['unknown', 'success', 'failure'].includes(e.outcome)) fail('receipt-state', row.eventId);
    if (row.status === 'accepted') {
      const expectedSource = ['cited', 'adopted'].includes(e.trigger) ? 'agent' : e.outcomeKind === 'task' ? 'grader' : 'runtime';
      if (e.source !== expectedSource) fail('receipt-source', row.eventId);
      if (e.outcomeKind === 'task' && !e.taskId) fail('graded-task-identity', row.eventId);
      if ((e.experimentId || e.arm || e.repeat !== null) && (!e.experimentId || !e.arm || e.repeat === null || !e.taskId)) fail('experimental-identity', row.eventId);
      if (!report.source.truncated) {
        const related = report.records.filter((candidate) => candidate.status === 'accepted' && candidate.runKey === row.runKey &&
          candidate.principleId === row.principleId && candidate.evidence.principleVersion === e.principleVersion);
        if (e.trigger !== 'retrieved' && !related.some((candidate) => candidate.evidence.trigger === 'retrieved')) fail('provenance-unexposed', row.eventId);
        if (e.trigger === 'adopted' && (!e.operation?.observed || e.operation.succeeded !== true || !related.some((candidate) =>
          candidate.evidence.trigger === 'operation' && candidate.evidence.operation?.toolCallId === e.operation.toolCallId &&
          candidate.evidence.operation?.toolName === e.operation.toolName && candidate.evidence.operation?.observed &&
          candidate.evidence.operation?.succeeded === true))) fail('provenance-operation', row.eventId);
      }
    }
  }
  if (new Set(report.records.map((row) => row.eventId)).size !== report.records.length) fail('duplicate-event');
  if (JSON.stringify(ordered(report.diagnostics)) !== JSON.stringify(ordered(diagnostics(report.records)))) fail('diagnostics-drift');
  return { passed: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const input = value('--input');
  const report = input ? JSON.parse(readFileSync(input, 'utf8')) : exportAdoptionEvents({
    ...(value('--db') ? { dbPath: value('--db') } : {}), ...(value('--max-rows') ? { maxRows: Number(value('--max-rows')) } : {}),
  });
  const validation = validateAdoptionExport(report);
  const passed = validation.passed && report.source.state === 'present';
  if (value('--out')) writeFileSync(value('--out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(args.includes('--check') ? { passed, source: report.source, diagnostics: report.diagnostics, errors: validation.errors } : report, null, 2));
  if (args.includes('--check') && !passed) process.exitCode = 1;
}
