// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_DISPOSITION_ENTRIES } from '../../shared/dcs/component-disposition-catalog';
import { DCS_WRITABLE_FLAG_SPECS } from '../../shared/dcs/prod-flags-control';
import { createModelCapabilityStaticManifest } from '../../shared/model-capability-profile';
import { resolveVerseShellFoundationRollout } from '../../openclaw_runtime/src/agents/verseshell-foundation-flags';
import { UAS06_ENGINEERING_SCENARIOS } from '../../openclaw_runtime/src/agents/verseshell/single-plane-canary';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

type DispositionEntry = {
  id: string;
  disposition: string;
  owner: string;
  visibility?: string;
  visibilityReason?: string;
  userEntry?: unknown;
  coverage?: {
    routePaths?: readonly string[];
    settingsSectionIds?: readonly string[];
    settingsPanelIds?: readonly string[];
    dcsFlagIds?: readonly string[];
  };
};

const entries = COMPONENT_DISPOSITION_ENTRIES as readonly DispositionEntry[];

function entryOf(id: string): DispositionEntry {
  const found = entries.find((entry) => entry.id === id);
  expect(found, 'disposition entry ' + id + ' must exist').toBeTruthy();
  return found!;
}

describe('TF-0504 execution/evidence substrate stays internal', () => {
  it('keeps exactly one governed local executor inside the eligible-local domain', () => {
    const dir = 'openclaw_runtime/src/agents/verseshell';
    const files = fs
      .readdirSync(path.join(process.cwd(), dir))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    const spawnOwners = files.filter((name) => read(dir + '/' + name).includes('node:child_process'));
    expect(spawnOwners).toEqual(['process-manager.ts']);
  });

  it('keeps out-of-domain execution owners distinct instead of merging them', () => {
    const canary = read('openclaw_runtime/src/agents/verseshell/single-plane-canary.ts');
    expect(canary).toContain('executionHost: "gateway" | "sandbox" | "node" | "verseshell";');
    expect(canary).toContain('lifecycleOwner: "native" | "sandbox" | "node" | "verseshell" | "legacy-verseshell";');
  });

  it('declares the VerseShell adapter and the observability recorder as internal with no user entry', () => {
    const adapter = entryOf('component.verseshell-execution-adapter');
    expect(adapter.disposition).toBe('internal');
    expect(adapter.visibility).toBe('internal');
    expect(adapter.userEntry).toBeNull();
    expect(String(adapter.visibilityReason)).toMatch(/must not expose a second user-visible executor/i);
    expect(adapter.coverage?.routePaths ?? []).toHaveLength(0);
    expect(adapter.coverage?.settingsPanelIds ?? []).toHaveLength(0);

    const recorder = entryOf('component.observability-recorder');
    expect(recorder.disposition).toBe('internal');
    expect(recorder.visibility).toBe('internal');
    expect(recorder.userEntry).toBeNull();
    expect(String(recorder.visibilityReason)).toMatch(/records but never authorizes or executes/i);
    expect(recorder.coverage?.routePaths ?? []).toHaveLength(0);
    expect(recorder.coverage?.settingsPanelIds ?? []).toHaveLength(0);
  });

  it('covers cancel, timeout, PTY, pipes, restart and rollback in the lifecycle matrix', () => {
    for (const scenario of ['cancel', 'timeout', 'pty', 'stdin', 'background', 'restart', 'rollback', 'short', 'long']) {
      expect(UAS06_ENGINEERING_SCENARIOS, 'scenario ' + scenario).toContain(scenario);
    }
    const canary = read('openclaw_runtime/src/agents/verseshell/single-plane-canary.ts');
    for (const veto of [
      'native-fallback-observed',
      'unauthorized-execution-observed',
      'duplicate-process-observed',
      'lost-output-observed',
      'sensitive-output-leak-observed',
      'scenario-lifecycle-gate-failed',
    ]) {
      expect(canary, 'hard veto ' + veto).toContain(veto);
    }
  });

  it('exposes no user-facing product toggle for VerseShell, RC-03 or the event log', () => {
    const writableIds = DCS_WRITABLE_FLAG_SPECS.map((spec) => spec.id);
    expect(writableIds.filter((id) => /verseshell|rc03|event-?log/i.test(id))).toEqual([]);
    expect(writableIds).not.toContain('verseshell-patch-preview');
    expect(writableIds).not.toContain('rc03-seal');
  });

  it('never enables a native fallback and fails closed on the kill switch', () => {
    const withCompatibility = resolveVerseShellFoundationRollout({
      config: { verseShellFoundation: { compatibilityNativeFallback: true, governedExec: true, verifiedRuntime: true } },
      env: {},
    });
    expect(withCompatibility.governedExecNativeFallback).toBe(false);
    expect(withCompatibility.shadowAccess).not.toBe('write');

    const killed = resolveVerseShellFoundationRollout({
      config: { verseShellFoundation: { governedExec: true, verifiedRuntime: true, readOnlyShadow: true } },
      env: { VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH: '1' },
    });
    expect(killed.killSwitch.engaged).toBe(true);
    expect(Object.values(killed.enabled).every((value) => value === false)).toBe(true);
    expect(killed.shadowAccess).toBe('disabled');
  });

  it('does not self-describe the internal substrate as a user-visible capability', () => {
    const manifest = createModelCapabilityStaticManifest();
    const forbidden = /\b(?:VerseShell|RC-03|Observability recorder|event[- ]log|VToken)\b/iu;
    const leaked = manifest.entries
      .filter((entry) => entry.visibility === 'user')
      .filter((entry) => forbidden.test(entry.displayName))
      .map((entry) => entry.capabilityId);
    expect(leaked).toEqual([]);
    expect(manifest.entries.find((entry) => entry.capabilityId === 'component.verseshell-execution-adapter')?.visibility).toBe('internal');
    expect(manifest.entries.find((entry) => entry.capabilityId === 'component.observability-recorder')?.visibility).toBe('internal');
  });
});