#!/usr/bin/env node
// T-C0 (TF-0138) offline feasibility spike for the Context Loss Trace (T-C2 /
// TF-0129). Answers three questions against a REAL session, without touching
// src/ and without synthesising any transcript:
//
//   Q1  is the data that exists today enough to locate the discarded units?
//   Q2  can the five discard decisions T-C2 must classify be told apart?
//   Q3  which fields would T-C2 have to persist to close the gap?
//
// This script is deliberately read-only and desensitised: it emits digests,
// enum labels, and numeric metadata only. No transcript text, no summary body,
// no lineage free text, no absolute paths (§TF-0138 requirement-5).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

const SPIKE_VERSION = 'loss-trace-spike-v1';

// node:sqlite is a stable built-in on Node 22+. Imported dynamically so the
// JSONL half of the spike still runs where it is missing.
let sqliteModule = null;
try {
  sqliteModule = await import('node:sqlite');
} catch {
  sqliteModule = null;
}

// The five classes T-C2 requirement-3 must cover, with the production site that
// performs each drop. `session` = does the session JSONL record it at all.
const DISCARD_CLASSES = [
  {
    id: 'budget-drop',
    site: 'turn-injection-budget.ts chargeTurnInjection -> disposition "drop"',
    carrier: 'ContextCandidateLineage.reason (in-memory)',
  },
  {
    id: 'compaction',
    site: 'compaction-planning.ts droppedMessagesList / compaction entry',
    carrier: 'session JSONL compaction entry (persisted)',
  },
  {
    id: 'limitHistoryTurns',
    site: 'history.ts limitHistoryTurns hard truncation',
    carrier: 'none',
  },
  {
    id: 'archived',
    site: 'block-lifecycle.ts archiveLowHeatBlocks -> lifecycle_state',
    carrier: 'context_blocks.presence_json (SQLite)',
  },
  {
    id: 'skipChannels',
    site: 'context-candidate.ts recordContextCandidateSkip -> "skip-channel"',
    carrier: 'ContextCandidateLineage.reason (in-memory)',
  },
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
}

/** Desensitised reference for one transcript entry: never its content. */
function entryRef(entry) {
  return `ref:entry:${digest(entry.id ?? '')}`;
}

function textLengthOf(message) {
  if (!message || typeof message !== 'object') return 0;
  const content = message.content;
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      if (typeof part === 'string') total += part.length;
      else if (part && typeof part === 'object' && typeof part.text === 'string') {
        total += part.text.length;
      }
    }
    return total;
  }
  return 0;
}

function loadEntries(file) {
  const rows = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let unparseable = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      unparseable += 1;
    }
  }
  return { rows, unparseable };
}

/** Role of a transcript entry, as an enum label only. */
function roleOf(entry) {
  if (entry?.type !== 'message') return `<${entry?.type ?? 'unknown'}>`;
  const role = entry?.message?.role;
  return typeof role === 'string' ? role : '<no-role>';
}

function summariseCompression(details) {
  const c = details?.compression;
  if (!c || typeof c !== 'object') return null;
  return {
    tier: typeof c.tier === 'string' ? c.tier : null,
    strategy: typeof c.strategy === 'string' ? c.strategy : null,
    pressure: typeof c.pressure === 'number' ? c.pressure : null,
    tokensBefore: typeof c.tokensBefore === 'number' ? c.tokensBefore : null,
    warningCount: Array.isArray(c.warnings) ? c.warnings.length : 0,
    staleExcludedCount: typeof c.staleExcludedCount === 'number' ? c.staleExcludedCount : null,
    causalAnchorCount: typeof c.causalAnchorCount === 'number' ? c.causalAnchorCount : null,
    rehydratedFileCount: Array.isArray(c.rehydratedFiles) ? c.rehydratedFiles.length : 0,
  };
}

/** Artifact sections: names and item counts only, never the items themselves. */
function summariseArtifact(details) {
  const a = details?.artifact;
  if (!a || typeof a !== 'object') return null;
  const sections = {};
  for (const [key, value] of Object.entries(a)) {
    if (Array.isArray(value)) sections[key] = value.length;
    else if (typeof value === 'string') sections[key] = value.length > 0 ? 'present' : 'empty';
    else if (typeof value === 'number') sections[key] = value;
  }
  return sections;
}

/**
 * Reconstruct one loss event per compaction entry.
 *
 * Reload semantics come from session-history.ts:400-424: the latest compaction
 * replaces everything at or before its own index with `summary`, and only
 * entries after that index survive as tail messages. So the dropped set for a
 * compaction at index i is every message entry in [0, i). `firstKeptEntryId` is
 * persisted alongside, which gives us a second, independent boundary marker to
 * cross-check the positional one against.
 */
function traceCompactions(rows) {
  const events = [];
  for (let index = 0; index < rows.length; index += 1) {
    const entry = rows[index];
    if (entry?.type !== 'compaction') continue;

    const dropped = rows.slice(0, index).filter((row) => row?.type === 'message');
    const keptTail = rows.slice(index + 1).filter((row) => row?.type === 'message');

    const byRole = {};
    let droppedChars = 0;
    for (const row of dropped) {
      const role = roleOf(row);
      byRole[role] = (byRole[role] ?? 0) + 1;
      droppedChars += textLengthOf(row.message);
    }

    // Cross-check the two boundary markers. The reload path cuts positionally
    // (session-history.ts uses latestCompactionIndex + 1 and prepends the
    // summary), while firstKeptEntryId is carried as metadata. Measured on real
    // data, firstKeptEntryId names the compaction entry ITSELF, because that
    // entry is what survives as the compactionSummary message. So "self" and
    // "next" are both consistent readings; anything else is a real discrepancy.
    const nextEntry = rows[index + 1];
    const declaredFirstKept =
      typeof entry.firstKeptEntryId === 'string' ? entry.firstKeptEntryId : null;
    const interpretation =
      declaredFirstKept === null
        ? 'missing'
        : declaredFirstKept === entry.id
          ? 'self'
          : nextEntry !== undefined && declaredFirstKept === nextEntry.id
            ? 'next'
            : 'other';
    const boundary = {
      declaredFirstKeptRef: declaredFirstKept ? `ref:entry:${digest(declaredFirstKept)}` : null,
      positionalFirstKeptRef: nextEntry ? entryRef(nextEntry) : null,
      interpretation,
      markersAgree: interpretation === 'self' || interpretation === 'next',
    };


    events.push({
      compactionRef: entryRef(entry),
      compactionIndex: index,
      fromHook: entry.fromHook === true,
      tokensBefore: typeof entry.tokensBefore === 'number' ? entry.tokensBefore : null,
      summaryChars: typeof entry.summary === 'string' ? entry.summary.length : 0,
      summaryDigest: typeof entry.summary === 'string' ? `sha256:${digest(entry.summary)}` : null,
      droppedEntryCount: dropped.length,
      droppedChars,
      droppedByRole: byRole,
      keptTailCount: keptTail.length,
      boundary,
      compression: summariseCompression(entry.details),
      artifactSections: summariseArtifact(entry.details),
      // Per-unit attribution is the whole point of T-C2, so record what we can
      // actually say per dropped unit today: a ref, a role, and a size. There is
      // no per-unit reason available from this source.
      droppedUnits: dropped.map((row) => ({
        ref: entryRef(row),
        role: roleOf(row),
        chars: textLengthOf(row.message),
        reason: null,
      })),
    });
  }
  return events;
}

/**
 * Probe the production state DB for the two persisted carriers that a loss trace
 * would have to join against. Read-only, counts and enum labels only.
 *
 * `runtime_receipts` is the one table that already has the right shape
 * (selected_json / omitted_json / budget_json keyed by attempt + model call), so
 * whether it has rows decides Q1 for four of the five classes.
 */
function probeStateDb(dbPath) {
  if (!dbPath) return { probed: false, reason: 'no --state-db given' };
  if (!existsSync(dbPath)) return { probed: false, reason: 'state db not found' };
  let DatabaseSync;
  try {
    ({ DatabaseSync } = sqliteModule ?? {});
    if (!DatabaseSync) return { probed: false, reason: 'node:sqlite unavailable' };
  } catch {
    return { probed: false, reason: 'node:sqlite unavailable' };
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const tableNames = db
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((row) => row.name);
    const countOf = (table) =>
      tableNames.includes(table)
        ? db.prepare(`select count(*) as n from "${table}"`).get().n
        : null;

    const receiptRows = countOf('runtime_receipts');
    const blockRows = countOf('context_blocks');

    // lifecycle_state lives inside presence_json, so the archived class is only
    // observable if some row actually carries it.
    const lifecycle = {};
    if (blockRows) {
      for (const row of db.prepare('select presence_json from context_blocks').all()) {
        let parsed = {};
        try {
          parsed = row.presence_json ? JSON.parse(row.presence_json) : {};
        } catch {
          parsed = { '<unparseable>': true };
        }
        const state = parsed.lifecycle_state ?? parsed.lifecycleState ?? '<absent>';
        lifecycle[state] = (lifecycle[state] ?? 0) + 1;
      }
    }
    db.close();
    return {
      probed: true,
      dbRef: `ref:db:${digest(dbPath)}`,
      runtimeReceiptRows: receiptRows,
      contextBlockRows: blockRows,
      blockLifecycleStates: lifecycle,
    };
  } catch (error) {
    return { probed: false, reason: `probe failed: ${error.code ?? error.message}` };
  }
}

/**
 * Per-class observability verdict. This is Q2's answer, derived from what the
 * trace above could actually reconstruct plus where each carrier lives.
 */
function classifyObservability(events, dbProbe) {
  const sawCompaction = events.length > 0;
  const receiptsHaveRows = dbProbe.probed && (dbProbe.runtimeReceiptRows ?? 0) > 0;
  const archivedStates = dbProbe.blockLifecycleStates ?? {};
  const sawArchived = Object.keys(archivedStates).some(
    (state) => state !== '<absent>' && state !== 'active',
  );

  return DISCARD_CLASSES.map((cls) => {
    switch (cls.id) {
      case 'compaction':
        return {
          ...cls,
          observable: sawCompaction,
          perUnitReason: false,
          note: sawCompaction
            ? 'dropped set reconstructible from the compaction entry boundary; no per-unit reason field'
            : 'no compaction entry in this session',
        };
      case 'budget-drop':
      case 'skipChannels':
        return {
          ...cls,
          observable: receiptsHaveRows,
          perUnitReason: false,
          note: receiptsHaveRows
            ? 'runtime_receipts has rows: omitted refs recoverable, but the reason enum is not a receipt column'
            : 'lineage is in-memory and cleared at attempt end; runtime_receipts has no rows, so nothing survives',
        };
      case 'archived':
        return {
          ...cls,
          observable: sawArchived,
          perUnitReason: false,
          note: sawArchived
            ? 'lifecycle_state present in presence_json'
            : 'no block carries lifecycle_state; zero production archive writers, so the class has no instances',
        };
      case 'limitHistoryTurns':
        return {
          ...cls,
          observable: false,
          perUnitReason: false,
          note: 'hard slice with no record of what it cut; indistinguishable from a message never having existed',
        };
      default:
        return { ...cls, observable: false, perUnitReason: false, note: 'unclassified' };
    }
  });
}

/** Q3: the fields T-C2 would have to persist, derived from the gaps above. */
function fieldGap(verdicts) {
  const gaps = [
    {
      field: 'discardClass',
      values: DISCARD_CLASSES.map((c) => c.id),
      why: 'no carrier records which of the five paths dropped a unit; compaction is inferable only because it is the one path with a persisted entry',
      carrierProposal: 'new column on the loss-trace row, not a receipt column',
    },
    {
      field: 'unitRef',
      values: ['ref:entry:<digest>', 'ref:block:<digest>', 'ref:memory:<factId>'],
      why: 'ContextReceipt.omitted already carries refs, but only for candidates that reached the budget; compaction-dropped transcript entries never enter that path',
      carrierProposal: 'reuse the existing ref shape so digests stay comparable across carriers',
    },
    {
      field: 'droppedAtTurn / droppedAtCall',
      values: ['turnId', 'attemptIndex', 'modelCallIndex'],
      why: 'runtime_receipts already keys by attempt/model call; the session JSONL has no turn identity at all, so the two sources cannot be joined today',
      carrierProposal: 'persist the same triple on the loss-trace row',
    },
    {
      field: 'reason',
      values: [
        'collected',
        'applied',
        'duplicate',
        'empty',
        'budget-truncate',
        'budget-drop',
        'flag-off',
        'kill-switch',
        'skip-channel',
      ],
      why: 'ContextCandidateLineage.reason already exists with exactly the enum a trace needs, but it dies with the in-memory collection',
      carrierProposal: 'persist the existing enum verbatim; requirement-5 forbids free text, and this enum is already free-text-free',
    },
    {
      field: 'charsRequested / charsApplied',
      values: ['int', 'int'],
      why: 'already in lineage and in ContextReceipt.budget; needed to size the loss, and cheap to carry',
      carrierProposal: 'reuse the ReceiptBudget chars shape',
    },
    {
      field: 'compactionBoundary',
      values: ['firstKeptEntryId', 'positionalIndex', 'interpretation'],
      why: 'two boundary markers exist and they are only consistent under a convention that is nowhere written down: measured on real data firstKeptEntryId names the compaction entry itself, not the entry after it, because that entry survives as the compactionSummary message',
      carrierProposal: 'persist both markers plus the resolved interpretation so a trace never has to re-guess the convention',
    },
  ];
  const unobservable = verdicts.filter((v) => !v.observable).map((v) => v.id);
  return { gaps, unobservableClasses: unobservable };
}

/**
 * requirement-5 self-check. The report must carry digests, refs, enum labels and
 * numbers only, so scan the serialised output for the things that must never
 * appear in it. A non-empty finding list is a hard failure, not a warning.
 *
 * Scoped to the data-derived subtree. The static rubric in this file (class
 * descriptors, verdict notes, field-gap rationales) is authored prose that is
 * reviewed by reading the script; including it would make the long-string check
 * fire on its own explanations and train the reader to ignore the result.
 */
const LEAK_PATTERNS = [
  { id: 'credential', pattern: /\bsk-[A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/u },
  { id: 'absolute-path-win', pattern: /[A-Za-z]:\\\\?[A-Za-z0-9_.\\-]/u },
  { id: 'absolute-path-posix', pattern: /"\/(?:home|Users|root|var|etc)\//u },
  { id: 'session-uuid', pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u },
];

function desensitisationCheck(dataDerived) {
  const serialised = JSON.stringify(dataDerived);
  const findings = [];
  for (const { id, pattern } of LEAK_PATTERNS) {
    const match = serialised.match(pattern);
    if (match) findings.push({ id, atIndex: match.index ?? -1 });
  }
  // Long free-text runs are the other leak shape: every legitimate string in the
  // data-derived subtree is a digest, ref, enum label, or short key.
  const longStrings = [...serialised.matchAll(/"([^"\\]{160,})"/gu)].length;
  if (longStrings > 0) findings.push({ id: 'long-string', count: longStrings });
  return findings;
}

function main() {
  const sessionArg = argValue('--session');
  if (!sessionArg) {
    console.error(
      'usage: node scripts/context-loss-trace-spike.mjs --session <session.jsonl>' +
        ' [--state-db <openclaw.sqlite>] [--out <report.json>]',
    );
    process.exit(2);
  }
  const sessionPath = resolve(sessionArg);
  if (!existsSync(sessionPath)) {
    console.error(`session not found: ${basename(sessionPath)}`);
    process.exit(2);
  }

  const { rows, unparseable } = loadEntries(sessionPath);
  const messages = rows.filter((row) => row?.type === 'message');
  const userTurns = messages.filter((row) => row?.message?.role === 'user').length;
  const events = traceCompactions(rows);
  const dbProbe = probeStateDb(argValue('--state-db'));
  const verdicts = classifyObservability(events, dbProbe);
  const q3 = fieldGap(verdicts);

  const report = {
    spikeVersion: SPIKE_VERSION,
    node: process.version,
    session: {
      ref: `ref:session:${digest(basename(sessionPath, '.jsonl'))}`,
      entryCount: rows.length,
      messageCount: messages.length,
      userTurns,
      compactionCount: events.length,
      unparseableLines: unparseable,
    },
    q1_locatable: {
      compactionDropsReconstructible: events.length > 0,
      unitsLocated: events.reduce((sum, event) => sum + event.droppedEntryCount, 0),
      unitsWithReason: 0,
      persistedCarrierRows: dbProbe.probed ? dbProbe.runtimeReceiptRows : null,
    },
    q2_distinguishable: {
      classesTotal: DISCARD_CLASSES.length,
      classesObservable: verdicts.filter((v) => v.observable).length,
      classesWithPerUnitReason: verdicts.filter((v) => v.perUnitReason).length,
      verdicts,
    },
    q3_fieldGap: q3,
    stateDbProbe: dbProbe,
    lossEvents: events,
  };

  const leaks = desensitisationCheck({
    session: report.session,
    q1: report.q1_locatable,
    stateDbProbe: report.stateDbProbe,
    lossEvents: report.lossEvents,
  });
  report.desensitisation = {
    scope: 'data-derived subtree (session, q1, stateDbProbe, lossEvents)',
    patternsChecked: LEAK_PATTERNS.length,
    findings: leaks,
  };
  const finalSerialised = JSON.stringify(report, null, 2);

  const outPath = argValue('--out');
  if (outPath) writeFileSync(resolve(outPath), `${finalSerialised}\n`, 'utf8');

  console.log(`# ${SPIKE_VERSION} on ${report.session.ref}`);
  console.log(
    `entries=${report.session.entryCount} messages=${report.session.messageCount}` +
      ` userTurns=${report.session.userTurns} compactions=${report.session.compactionCount}`,
  );
  console.log('');
  console.log('## Q1 can the discarded units be located');
  console.log(
    `  units located = ${report.q1_locatable.unitsLocated}` +
      `  units carrying a reason = ${report.q1_locatable.unitsWithReason}` +
      `  persisted receipt rows = ${report.q1_locatable.persistedCarrierRows}`,
  );
  for (const event of events) {
    console.log(
      `  ${event.compactionRef} idx=${event.compactionIndex} dropped=${event.droppedEntryCount}` +
        ` chars=${event.droppedChars} keptTail=${event.keptTailCount}` +
        ` tokensBefore=${event.tokensBefore} boundary=${event.boundary.interpretation}` +
        `/agree=${event.boundary.markersAgree}`,
    );
    console.log(`    byRole=${JSON.stringify(event.droppedByRole)}`);
    console.log(`    compression=${JSON.stringify(event.compression)}`);
  }
  console.log('');
  console.log('## Q2 can the five discard classes be told apart');
  for (const verdict of verdicts) {
    console.log(
      `  ${verdict.observable ? 'YES' : 'NO '} ${verdict.id.padEnd(18)} ${verdict.note}`,
    );
  }
  console.log('');
  console.log('## Q3 fields T-C2 would have to persist');
  for (const gap of q3.gaps) console.log(`  ${gap.field}`);
  console.log(`  unobservable classes: ${q3.unobservableClasses.join(', ') || 'none'}`);
  console.log('');
  console.log('## desensitisation self-check');
  console.log(
    `  patterns=${LEAK_PATTERNS.length} findings=${leaks.length}` +
      (leaks.length ? ` ${JSON.stringify(leaks)}` : ' (clean)'),
  );
  if (outPath) console.log(`  report written: ${basename(outPath)}`);
  process.exit(leaks.length > 0 ? 1 : 0);
}

main();
