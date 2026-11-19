// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHORITY_COMPONENTS } from '@shared/component-authority-manifest';
import {
  COMPONENT_DISPOSITION_ENTRIES,
  type ComponentDispositionEntry,
} from '@shared/dcs/component-disposition-catalog';
import { DCS_PROD_FLAGS } from '@shared/dcs/prod-flags-catalog';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const disposition = (id: string): ComponentDispositionEntry => {
  const found = COMPONENT_DISPOSITION_ENTRIES.find((entry) => entry.id === id);
  if (!found) throw new Error('Missing disposition: ' + id);
  return found;
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(root, dir))) {
    const full = resolve(root, dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(relative(root, full)));
    else if (/\.(ts|tsx)$/u.test(name) && !/\.(test|spec)\.(ts|tsx)$/u.test(name)) out.push(relative(root, full));
  }
  return out;
}

describe('TF-0493 context authority closeout', () => {
  it('keeps context assembly, request guarding and the enhancement gate internal', () => {
    for (const id of [
      'component.context-runtime-kit',
      'component.dcs-context-authority',
      'component.dcs-assembler-adapter',
      'component.provider-request-guard',
      'component.context-enhancement-gate',
    ]) {
      expect(disposition(id)).toMatchObject({ disposition: 'internal', visibility: 'internal', userEntry: null });
    }
    const authorities = new Set(AUTHORITY_COMPONENTS.map((component) => component.id));
    for (const id of ['context-runtime-kit', 'dcs-context-authority', 'provider-request-guard', 'context-enhancement-gate']) {
      expect(authorities.has(id), id).toBe(true);
    }
  });

  it('turns C6 into an explicit internal API with no permanent experiment toggle', () => {
    const c6 = disposition('component.c6-context-ladder');
    expect('experimentOwner' in c6).toBe(false);
    expect('expiry' in c6).toBe(false);
    expect(c6).toMatchObject({
      disposition: 'internal',
      visibility: 'internal',
      currentMode: 'opt-in',
      targetDefaultMode: 'internal',
    });
    const flag = DCS_PROD_FLAGS.find((entry) => entry.id === 'context-ladder');
    expect(flag).toMatchObject({ kind: 'api', risk: 'api-only', defaultValue: false, executor: { status: 'wired' } });
    expect(flag?.enable).toContain('AssembleRequest contextLadder');
  });

  it('removes every renderer VToken bridge switch and independent product panel', () => {
    const files = [...sourceFiles('src/pages'), ...sourceFiles('src/components')];
    const violations = files.filter((file) => /VtokenBridgePanel|settings-vtoken-bridge|developer\.vtokenBridge/u.test(read(file)));
    expect(violations).toEqual([]);
    expect(() => read('src/components/settings/VtokenBridgePanel.tsx')).toThrow();
    expect(disposition('component.vtoken-bridge')).toMatchObject({
      disposition: 'retired',
      visibility: 'retired',
      userEntry: null,
      currentConsumers: ['retired compatibility API', 'vtoken package tests'],
    });
  });

  it('finalizes one shared budget projection through the existing production owners', () => {
    const extensions = read('openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts');
    const attempt = read('openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts');
    const compact = read('openclaw_runtime/src/agents/embedded-agent-runner/compact.ts');
    expect(extensions.match(/finalizeContextOrchestratorTurn\(\{/gu)).toHaveLength(1);
    expect(extensions).toContain('before_agent_start');
    expect(attempt).toContain('computeContextExtraSystemPrompt');
    expect(attempt).toContain('endContextOrchestratorTurn');
    expect(compact).toContain('endTurnInjectionBudget');
    expect(read('openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts')).toContain('client.pack({');
    const vtokenClient = read('openclaw_runtime/src/context-engine/vtoken-rpc-client.ts');
    expect(vtokenClient).toContain('"vt.pack"');
    expect(vtokenClient).not.toContain('"vt.open"');
    expect(read('openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts')).not.toContain('vt.open');
  });

  it('retains per-model-call receipts across tool loop, retry, fallback, compact, fork and handoff', () => {
    const acceptance = read('openclaw_runtime/src/agents/rc03-entry-transitions.acceptance.test.ts');
    for (const caseName of ['plain turn', 'tool loop', 'same-provider retry', 'provider fallback', 'compact', 'fork', 'handoff']) {
      expect(acceptance).toContain(caseName);
    }
    const seal = read('openclaw_runtime/src/context-engine/rc03-seal.test.ts');
    expect(seal).toContain('creates one stable plan per attempt with explicit attempt/model-call/wire-attempt identity');
    expect(seal).toContain('persists a correlated ContextReceipt/v1 and WireReceipt/v1');
  });
});
