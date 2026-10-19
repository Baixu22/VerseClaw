// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const registryPath = resolve(
  process.cwd(),
  'harness/specs/fixtures/tf0343-tf0344-deferred-scope/registry.json',
);

type DeferredItem = {
  id: string;
  ownerTask: 'TF-0343' | 'TF-0344';
  disposition: 'deferred';
  implemented: boolean;
  trigger: string;
  activationGate: string[];
  evidence: string[];
};

type Registry = {
  schema: string;
  driven_by: string;
  currentState: string;
  implementedInThisCycle: boolean;
  activationPolicy: Record<string, boolean>;
  items: DeferredItem[];
};

function loadRegistry(): Registry {
  return JSON.parse(readFileSync(registryPath, 'utf8')) as Registry;
}

describe('VerseBrowser deferred scope activation gate', () => {
  it('keeps every registered enhancement deferred and unimplemented', () => {
    const registry = loadRegistry();
    expect(registry.schema).toBe('clawx.versebrowser-deferred-scope/v1');
    expect(registry.driven_by).toBe('agent');
    expect(registry.currentState).toBe('deferred');
    expect(registry.implementedInThisCycle).toBe(false);
    expect(registry.items.length).toBeGreaterThan(0);
    expect(registry.items.every((item) => item.disposition === 'deferred')).toBe(true);
    expect(registry.items.every((item) => item.implemented === false)).toBe(true);
  });

  it('requires a real task, minimal reproduction, independent verdict and per-driver acceptance', () => {
    const policy = loadRegistry().activationPolicy;
    expect(policy).toMatchObject({
      requiresExplicitTask: true,
      requiresRealTaskOrReproduction: true,
      requiresMinimalReproduction: true,
      requiresIndependentVerdict: true,
      requiresSeparateHostAcceptancePerDriver: true,
    });
  });

  it('keeps cloud scheduling, generic planner, stealth/proxy and captcha bypass excluded', () => {
    const policy = loadRegistry().activationPolicy;
    expect(policy.cloudSchedulingAllowed).toBe(false);
    expect(policy.genericPlannerAllowed).toBe(false);
    expect(policy.stealthProxyPlatformAllowed).toBe(false);
    expect(policy.captchaBypassAllowed).toBe(false);
  });

  it('maps both deferred owner nodes and gives each item a trigger, gate and evidence', () => {
    const items = loadRegistry().items;
    expect(new Set(items.map((item) => item.ownerTask))).toEqual(
      new Set(['TF-0343', 'TF-0344']),
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) {
      expect(item.trigger.trim().length).toBeGreaterThan(0);
      expect(item.activationGate.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
    }
  });
});
