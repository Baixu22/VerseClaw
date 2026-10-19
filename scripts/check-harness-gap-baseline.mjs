#!/usr/bin/env node
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseFrontmatter } from '../harness/src/specs.mjs';

const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const exactFile = (value) => nonempty(value) && !/[:\\*?{}\[\]]/.test(value)
  && value.split('/').every((part) => part && part !== '.' && part !== '..')
  && /\.[a-z0-9]+$/i.test(value);
const digest = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Optional current-source checks are separate from snapshot structure: later packets
// may intentionally change production files without rewriting this historical baseline.
export function verifyReferences(references, readText) {
  const errors = [];
  for (const [id, ref] of Object.entries(references)) {
    if (!exactFile(ref?.path)) { errors.push('unsafe source path: ' + id); continue; }
    try {
      const text = readText(ref.path).replace(/\r\n/g, '\n');
      if (digest(text) !== ref.sha256) errors.push('source digest drift: ' + ref.path);
      if (text.split('\n')[ref.line - 1]?.trim() !== ref.anchor) {
        errors.push('source anchor drift: ' + ref.path);
      }
    } catch {
      errors.push('source missing or unreadable: ' + ref.path);
    }
  }
  return errors;
}

export function validateBaseline(data, readText) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  if (!data || !Array.isArray(data.slots) || !Array.isArray(data.packets)
      || [...data.slots, ...data.packets].some((item) => !item || typeof item !== 'object' || Array.isArray(item))
      || !data.references || typeof data.references !== 'object' || Array.isArray(data.references)) {
    return { ok: false, scope: 'B00', level: 'structure', errors: ['invalid inventory shape'] };
  }
  const { slots, packets, references } = data;
  check(data.schemaVersion === 1 && data.scope === 'B00-source-baseline-not-runtime-acceptance', 'invalid scope/version');
  check(data.driven_by === 'agent' && nonempty(data.actor), 'agent attribution required');
  check(/^[a-f0-9]{40}$/.test(data.sourceBaseline?.commit ?? '')
    && /^[a-f0-9]{40}$/.test(data.sourceBaseline?.tree ?? ''), 'source candidate identity required');
  check(data.sourceBaseline?.hashFormat === 'sha256-utf8-lf', 'source hash format required');
  check(data.experimentParameters?.scope === 'test-fixture-only; not production defaults', 'experiment/default separation required');
  check(['live_ready', 'product_approved', 'default_on'].every((key) => data.productLocks?.values?.[key] === false), 'product locks must remain false');
  check(same(slots.map((s) => s?.id).sort(), Array.from({ length: 30 }, (_, i) => 'HG' + String(i + 1).padStart(2, '0'))), 'exactly HG01-HG30 required');
  const codes = packets.map((p) => p?.code);
  check(codes.length === 29 && new Set(codes).size === 29 && codes.every((code) => /^[A-Z]\d{2}$/.test(code)), '29 unique packet codes required');
  check(new Set(packets.map((p) => p?.taskId)).size === 29, 'unique task ownership required');
  const refIds = (ids) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => references[id]);
  for (const [id, ref] of Object.entries(references)) {
    check(exactFile(ref?.path) && /^[a-f0-9]{64}$/.test(ref?.sha256 ?? '')
      && Number.isInteger(ref?.line) && ref.line > 0 && nonempty(ref?.anchor), 'invalid source reference: ' + id);
  }
  for (const slot of slots) {
    check(slot && (codes.includes(slot.owner) || slot.owner === 'B00'), 'unknown owner: ' + slot?.id);
    check(nonempty(slot?.topic) && nonempty(slot?.observation) && nonempty(slot?.decision), 'incomplete slot: ' + slot?.id);
    check(refIds(slot?.sourceRefs), 'missing slot source: ' + slot?.id);
    check(['partial', 'existing-narrow', 'unverified', 'constraint', 'source-incomplete'].includes(slot?.assessment), 'invalid assessment: ' + slot?.id);
    const missing = ['HG22', 'HG27'].includes(slot?.id);
    check(slot?.sourceStatus === (missing ? 'not-recovered' : 'summary-reconstructed'), 'invalid source status: ' + slot?.id);
    if (missing) check(slot.owner === 'B00' && slot.originalText === null && slot.assessment === 'source-incomplete', 'missing source invented: ' + slot.id);
    else check(slot?.owner !== 'B00' && packets.find((p) => p.code === slot?.owner)?.primarySlots?.includes(slot?.id), 'slot owner mismatch: ' + slot?.id);
  }
  check(slots.find((s) => s?.id === 'HG26')?.assessment === 'constraint', 'HG26 is a constraint, not a defect');
  for (const packet of packets) {
    const label = packet?.code;
    check(same(packet?.primarySlots, slots.filter((s) => s?.owner === label).map((s) => s.id)), 'packet primary slots mismatch: ' + label);
    check(/^TF-\d{4}$/.test(packet?.taskId ?? '') && nonempty(packet?.title), 'invalid task identity: ' + label);
    check(refIds(packet?.entryRefs) && nonempty(packet?.boundary), 'explicit entry required: ' + label);
    check(exactFile(packet?.spec?.path) && packet.spec.path.startsWith('harness/specs/tasks/')
      && ['existing', 'planned'].includes(packet.spec.state), 'invalid task spec: ' + label);
    check(Array.isArray(packet?.reuseSpecs) && packet.reuseSpecs.every(exactFile), 'invalid reused specs: ' + label);
    check(Array.isArray(packet?.candidateFiles) && packet.candidateFiles.length > 0
      && packet.candidateFiles.every((f) => exactFile(f?.path) && ['existing', 'planned'].includes(f?.state)), 'exact candidate files required: ' + label);
    check(Array.isArray(packet?.testTargets) && packet.testTargets.length > 0
      && packet.testTargets.every((t) => nonempty(t?.target) && ['existing', 'planned', 'command', 'missing-legacy'].includes(t?.state)), 'test targets required: ' + label);
    check(Array.isArray(packet?.nonGoals) && packet.nonGoals.length > 0 && packet.nonGoals.every(nonempty), 'non-goals required: ' + label);
  }
  const pilots = packets.filter((p) => p?.pilotContract);
  check(pilots.length === 6, 'six independent pilot contracts required');
  for (const packet of pilots) {
    check(Array.isArray(packet.pilotContract.acceptance) && packet.pilotContract.acceptance.length > 0
      && packet.pilotContract.acceptanceReused === false, 'pilot acceptance cannot be reused: ' + packet.code);
  }
  check(Array.isArray(data.historicalEvidence) && data.historicalEvidence.length > 0
    && data.historicalEvidence.every((e) => e.reusableForCurrentAcceptance === false && references[e.ref]), 'historical evidence must not imply current acceptance');
  check(data.sourceRecovery?.result === 'not-recovered'
    && same(data.sourceRecovery?.slots, ['HG22', 'HG27'])
    && Array.isArray(data.sourceRecovery?.checks) && data.sourceRecovery.checks.length > 0, 'source recovery boundary required');

  // Do not dereference unsafe/malformed paths even when the caller supplied a reader.
  if (readText && errors.length === 0) {
    errors.push(...verifyReferences(references, readText));
    try {
      const plan = readText(references.plan.path);
      const owners = new Map([...plan.matchAll(/^\| (HG\d{2}) \| [^|]+ \| ([^|]+) \|/gm)].map((m) => [m[1], m[2].trim()]));
      check(owners.size === 30 && slots.every((s) => owners.get(s.id) === s.owner), 'owner mapping differs from design');
      const phaseCodes = [...plan.matchAll(/^\| [BESLGV] \| [^|]+ \| ([^|]+) \|/gm)]
        .flatMap((m) => m[1].split('、').map((s) => s.trim())).filter((s) => s !== 'B00').sort();
      check(same(phaseCodes, [...codes].sort()), 'packet set differs from design');
      for (const packet of packets) {
        for (const spec of [...packet.reuseSpecs, ...(packet.spec.state === 'existing' ? [packet.spec.path] : [])]) {
          if (!nonempty(parseFrontmatter(readText(spec)).data.id)) errors.push('invalid existing spec: ' + spec);
        }
        for (const file of packet.candidateFiles.filter((f) => f.state === 'existing')) readText(file.path);
        for (const test of packet.testTargets.filter((t) => t.state === 'existing')) {
          if (!exactFile(test.target)) { errors.push('invalid test path: ' + test.target); continue; }
          readText(test.target);
        }
        if (packet.pilotContract) {
          const original = parseFrontmatter(readText(packet.spec.path)).data;
          for (const key of ['acceptance', 'requiredTests', 'requiredProfiles']) {
            check(same(original[key], packet.pilotContract[key]), 'original pilot gate changed: ' + packet.code + '/' + key);
          }
        }
      }
    } catch (error) {
      errors.push('source/spec read failed: ' + error.message);
    }
  }
  return { ok: errors.length === 0, scope: 'B00', level: readText ? 'current-sources' : 'structure',
    counts: { slots: slots.length, packets: packets.length, references: Object.keys(references).length }, errors };
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const root = resolve(process.argv[3] ?? '.');
    const inventory = resolve(process.argv[2] ?? 'docs/dev/harness-gap-closure/source-inventory.json');
    const report = validateBaseline(JSON.parse(readFileSync(inventory, 'utf8')), (file) => readFileSync(resolve(root, file), 'utf8'));
    console.log(JSON.stringify({ ...report, actor: 'codex-baseline-verifier', driven_by: 'agent' }, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, scope: 'B00', actor: 'codex-baseline-verifier', driven_by: 'agent', errors: [error.message] }));
    process.exitCode = 1;
  }
}
