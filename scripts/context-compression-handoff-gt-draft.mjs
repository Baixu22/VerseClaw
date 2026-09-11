#!/usr/bin/env node
/**
 * Ground-truth DRAFT generator for the handoff benchmark (agent drafts, user
 * locks). Deterministic: every field is composed from evidence-grounded
 * ledger facts (v7 extractor output), never invented. Drafts are marked
 * status=draft and MUST be reviewed and locked before use as evidence.
 *
 * Story classification per sample:
 *   pending   — pending-objective fact present (objective investigated, not executed)
 *   blocked   — unresolved failure chain with followUp dominates
 *   completed — latest outcome reports verified completion, nothing pending
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildRecoveryLedger, isUnresolvedFailureFact } from './context-compression-recovery-ledger.mjs';

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const clip = (text, max = 260) => {
  const value = String(text ?? '').replace(/\s+/gu, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

function probe(id, type, question, fact) {
  return {
    id,
    type,
    question,
    expectedAnswer: clip(fact.text, 200),
    evidence: fact.evidence ? { messageId: fact.evidence.messageId, line: fact.evidence.line } : undefined,
  };
}

function draftSample(sampleId, ledger) {
  const facts = ledger.expected ?? [];
  const objective = facts.find((item) => item.category === 'objective');
  const pending = facts.filter((item) => String(item.id).includes('pending-objective')).at(-1);
  const unresolved = facts.filter((item) => isUnresolvedFailureFact(item));
  const latestOutcome = facts.filter((item) => String(item.id).includes('latest-outcome')).at(-1);
  const testFacts = facts.filter((item) => item.category === 'test_result');
  const blockers = facts.filter((item) => item.category === 'blocker' && !item.failureSummary);
  const decisions = facts.filter((item) => item.category === 'decision');
  const fileFacts = facts.filter((item) => item.category === 'file_context' || item.category === 'file_mutation');

  const story = pending ? 'pending' : (unresolved.length && !latestOutcome ? 'blocked' : (latestOutcome ? 'completed' : undefined));
  if (!story) return undefined;

  const base = {
    sampleId,
    story,
    window: ledger.window,
    completedWork: [],
    rejectedPaths: [],
    probeQuestions: [],
  };

  if (story === 'pending') {
    const entryPoints = decisions.map((item) => clip(item.text, 160)).filter(Boolean).slice(0, 2);
    return {
      ...base,
      correctEndState: clip(`${objective ? `Objective: ${objective.text} ` : ''}${pending.text}`, 520),
      correctNextAction: {
        kind: 'execute_pending_objective',
        target: clip(objective?.text ?? pending.text, 180),
        params: {},
        rationale: clip(`The objective was investigated but not executed. Entry points already discovered: ${entryPoints.join(' | ') || 'see objective report'}. Execute via one of them and report the outcome.`, 320),
      },
      completedWork: [
        ...(objective ? [{ text: clip(`investigate: ${objective.text}`, 200), evidence: objective.evidence ? { messageId: objective.evidence.messageId, line: objective.evidence.line } : undefined }] : []),
        ...testFacts.slice(0, 1).map((item) => ({ text: clip(item.text, 200), evidence: item.evidence ? { messageId: item.evidence.messageId, line: item.evidence.line } : undefined })),
      ],
      rejectedPaths: [
        { text: 'treat the pending objective as already completed (it was not executed)', evidence: pending.evidence ? { messageId: pending.evidence.messageId, line: pending.evidence.line } : undefined },
      ],
      probeQuestions: [
        ...(objective ? [probe('q1', 'state', 'What is the current objective?', objective)] : []),
        probe('q2', 'state', 'Was the objective executed or only investigated?', pending),
        ...(blockers.length ? [probe('q3', 'constraint', 'What known limitation/blocker constrains the work?', blockers.at(-1))] : [probe('q3', 'constraint', 'What did the latest objective report conclude?', pending)]),
        ...(testFacts.length ? [probe('q4', 'constraint', 'What is the test/verification status?', testFacts.at(-1))] : [probe('q4', 'constraint', 'What is the current state of the objective?', pending)]),
      ].slice(0, 4),
    };
  }

  if (story === 'blocked') {
    const worst = unresolved.at(-1);
    const followUp = worst.failureSummary.followUp;
    const kind = /environment|invocation/i.test(worst.failureSummary.classification) ? 'repair_environment' : 'inspect_failure';
    return {
      ...base,
      correctEndState: clip(`${objective ? `Objective: ${objective.text} ` : ''}Blocked by unresolved failure: ${clip(worst.text, 300)}`, 520),
      correctNextAction: {
        kind,
        target: clip(followUp, 200),
        params: {},
        rationale: clip(`Failure classification: ${worst.failureSummary.classification}. ${followUp}`, 320),
      },
      completedWork: unresolved.slice(0, 2).map((item) => ({ text: clip(`diagnosed: ${item.text}`, 200), evidence: item.evidence ? { messageId: item.evidence.messageId, line: item.evidence.line } : undefined })),
      rejectedPaths: [
        { text: 'continue the blocked work as if the failure did not exist', evidence: worst.evidence ? { messageId: worst.evidence.messageId, line: worst.evidence.line } : undefined },
      ],
      probeQuestions: [
        ...(objective ? [probe('q1', 'state', 'What is the current objective?', objective)] : [probe('q1', 'state', 'What failure blocks the work?', worst)]),
        probe('q2', 'state', 'What failure currently blocks progress?', worst),
        probe('q3', 'constraint', 'What must happen before the blocked work can continue?', { ...worst, text: followUp }),
        ...(testFacts.length ? [probe('q4', 'constraint', 'What is the test/verification status?', testFacts.at(-1))] : [probe('q4', 'constraint', 'How is the failure classified?', { ...worst, text: worst.failureSummary.classification })]),
      ].slice(0, 4),
    };
  }

  // completed
  return {
    ...base,
    correctEndState: clip(`${objective ? `Objective: ${objective.text} ` : ''}Outcome: ${latestOutcome.text}`, 520),
    correctNextAction: {
      kind: 'decision',
      target: 'preserve validated outcome',
      params: {},
      rationale: clip(`The outcome is reported complete/verified: ${latestOutcome.text}`, 320),
    },
    completedWork: [
      { text: clip(latestOutcome.text, 200), evidence: latestOutcome.evidence ? { messageId: latestOutcome.evidence.messageId, line: latestOutcome.evidence.line } : undefined },
      ...(objective ? [{ text: clip(objective.text, 200), evidence: objective.evidence ? { messageId: objective.evidence.messageId, line: objective.evidence.line } : undefined }] : []),
    ],
    rejectedPaths: [
      { text: 'redo the completed work described in the outcome', evidence: latestOutcome.evidence ? { messageId: latestOutcome.evidence.messageId, line: latestOutcome.evidence.line } : undefined },
    ],
    probeQuestions: [
      ...(objective ? [probe('q1', 'state', 'What was the objective?', objective)] : [probe('q1', 'state', 'What is the reported outcome?', latestOutcome)]),
      probe('q2', 'state', 'What is the reported outcome?', latestOutcome),
      probe('q3', 'constraint', 'Should the completed work be redone?', { ...latestOutcome, text: 'No: the outcome is reported complete/verified; preserve it and do not repeat the work' }),
      ...(testFacts.length ? [probe('q4', 'constraint', 'What is the test/verification status?', testFacts.at(-1))] : [probe('q4', 'constraint', 'What files are relevant to the outcome?', fileFacts.at(-1) ?? latestOutcome)]),
    ].slice(0, 4),
  };
}

function main() {
  const manifestPath = resolve(argValue('--manifest'));
  const metaPath = resolve(argValue('--meta'));
  const outPath = resolve(argValue('--out'));
  if (!manifestPath || !metaPath || !outPath) throw new Error('usage: --manifest <m> --meta <m> --out <gt.json>');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const metaById = new Map((meta.entries ?? []).map((entry) => [entry.sampleId, entry]));
  const samples = {};
  const skipped = [];
  for (const sample of manifest.samples ?? []) {
    const metaEntry = metaById.get(sample.id);
    if (!metaEntry?.file) throw new Error(`${sample.id}: missing meta entry`);
    const ordinalIndex = Number(/^[A-Z](\d+)$/u.exec(String(sample.id))?.[1] ?? 1) - 1;
    const ledger = buildRecoveryLedger(metaEntry.file, sample.id, { windowSize: Number(sample.cohort?.turn ?? 200), ordinalIndex });
    const draft = draftSample(sample.id, ledger);
    if (!draft) {
      skipped.push(sample.id);
      continue;
    }
    samples[sample.id] = draft;
    console.error(`[gt-draft] ${sample.id}: story=${draft.story}`);
  }
  const gt = {
    schema: 'handoff-benchmark-ground-truth/v1',
    createdAt: new Date().toISOString(),
    status: 'draft',
    annotator: 'codex-agent deterministic draft (scripts/context-compression-handoff-gt-draft.mjs); pending semantic review and user lock',
    notes: [
      'Fields are composed verbatim from evidence-grounded ledger facts; review each sample before locking.',
      'story=pending|blocked|completed drives the correctNextAction shape.',
    ],
    samples,
  };
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(gt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outPath, drafted: Object.keys(samples).length, skipped }, null, 2));
}

main();