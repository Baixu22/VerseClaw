#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { sha256 } from './lib/agent-first-task-corpus.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

function fixtureArtifact(directory, entry, name) {
  assert(entry && present(entry.path) && /^sha256:[a-f0-9]{64}$/u.test(entry.sha256), `missing ${name} artifact`);
  const path = resolve(directory, entry.path), rel = relative(directory, path);
  assert(rel && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('..\\') && !rel.startsWith('../'), `${name} escapes evidence directory`);
  assert.equal(sha256(readFileSync(path)), entry.sha256, `${name} evidence changed`);
  return read(path);
}

export function verifyOperationalAcceptance(file, root = process.cwd()) {
  const acceptancePath = resolve(root, file), directory = dirname(acceptancePath), acceptance = read(acceptancePath);
  assert.equal(acceptance.schemaVersion, 'AgentFirstOperationalEvidence/v1', 'invalid operational acceptance schema');
  assert.equal(acceptance.driven_by, 'agent', 'operational acceptance must be agent-driven');
  assert(present(acceptance.actor) && present(acceptance.candidate?.commit) && present(acceptance.candidate?.tree), 'missing operational acceptance provenance');
  assert.equal(acceptance.candidate.dirty, false, 'operational acceptance requires a clean candidate');
  assert(Array.isArray(acceptance.requiredDrills) && acceptance.requiredDrills.length > 0, 'missing required drill list');
  assert(Array.isArray(acceptance.requiredProviderFaults) && acceptance.requiredProviderFaults.length > 0, 'missing provider fault list');
  assert(acceptance.claims && Object.values(acceptance.claims).every((value) => value === false), 'operational acceptance overclaims');

  const operational = fixtureArtifact(directory, acceptance.artifacts?.operational, 'operational');
  const faults = fixtureArtifact(directory, acceptance.artifacts?.providerFaults, 'provider faults');
  for (const report of [operational, faults]) {
    assert.equal(report.driven_by, 'agent', 'report must be agent-driven');
    assert(report.candidate && report.candidate.commit === acceptance.candidate.commit && report.candidate.tree === acceptance.candidate.tree, 'report candidate differs');
  }
  assert.equal(git(root, ['rev-parse', `${acceptance.candidate.commit}^{tree}`]), acceptance.candidate.tree, 'candidate tree does not match acceptance');
  try { git(root, ['merge-base', '--is-ancestor', acceptance.candidate.commit, 'HEAD']); }
  catch { assert.fail('acceptance candidate is not in the current history'); }

  assert.equal(operational.verdict?.operational, 'pass', 'operational verdict did not pass');
  assert(['not-run', 'pass-unpacked'].includes(operational.verdict?.distribution), 'invalid distribution verdict');
  assert.equal(operational.distribution?.status, operational.verdict.distribution, 'distribution status differs');
  for (const drill of acceptance.requiredDrills) {
    const result = operational.source?.drills?.[drill], observed = result?.observed ?? result?.state ?? result?.recoveryExport ?? result?.recovered;
    assert.equal(observed === true || (drill === 'gatewayRecovery' && ['running', 'healthy'].includes(result?.state)), true, `drill not observed: ${drill}`);
  }
  assert(operational.source?.cleanup && Object.values(operational.source.cleanup).every((value) => value === true), 'source cleanup is incomplete');
  if (operational.verdict.distribution === 'pass-unpacked') {
    assert.equal(operational.packaged?.core?.taskStatus, operational.source?.core?.taskStatus, 'packaged task effect differs');
    assert.equal(operational.packaged?.core?.gatewayReady, operational.source?.core?.gatewayReady, 'packaged gateway effect differs');
    assert(operational.packaged?.cleanup && Object.values(operational.packaged.cleanup).every((value) => value === true), 'packaged cleanup is incomplete');
  }

  const cases = Array.isArray(faults.cases) ? faults.cases : [];
  assert.equal(faults.status, 'pass', 'provider fault suite did not pass');
  for (const type of acceptance.requiredProviderFaults) {
    const row = cases.find((entry) => entry.type === type);
    assert(row, `provider fault missing: ${type}`);
    assert.equal(row.status, 'pass', `provider fault did not pass: ${type}`);
    assert(Number(row.faultRequests) > 0 && row.runtimeProbe?.settled === true, `provider fault was not observed: ${type}`);
    assert(Array.isArray(row.recovery?.messages) && row.recovery.messages.some((message) => message?.role === 'assistant' && message?.stopReason === 'stop'), `provider fault recovery missing: ${type}`);
  }
  return { schemaVersion: 'AgentFirstOperationalAcceptanceCheck/v1', operational: operational.verdict,
    drills: acceptance.requiredDrills.length, providerFaults: acceptance.requiredProviderFaults.length,
    distribution: operational.verdict.distribution, candidate: acceptance.candidate };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { acceptance: { type: 'string' }, root: { type: 'string' } } });
  try {
    if (!values.acceptance) throw new Error('--acceptance is required');
    const root = resolve(values.root ?? resolve(import.meta.dirname, '..'));
    console.log(JSON.stringify(verifyOperationalAcceptance(values.acceptance, root)));
  } catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}
