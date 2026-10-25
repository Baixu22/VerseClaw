// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_DISPOSITION_ENTRIES,
  COMPONENT_DISPOSITION_MANIFEST,
} from '../../shared/dcs/component-disposition-catalog';
import {
  MODEL_CAPABILITY_ACTION_AUTHORIZATION_STATES,
  MODEL_CAPABILITY_PROFILE_SCHEMA,
  MODEL_CAPABILITY_PROMPT_MAX_CHARS,
  MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES,
  MODEL_CAPABILITY_USER_DISPLAY_NAMES,
  buildModelCapabilityProfile,
  canonicalModelCapabilityJson,
  computeModelCapabilityStaticDigest,
  createModelCapabilityStaticManifest,
  validateModelCapabilityProfile,
  validateModelCapabilityStaticManifest,
  type BuildModelCapabilityProfileInput,
  type ModelCapabilityEffectiveFactInput,
  type ModelCapabilityProfile,
} from '../../shared/model-capability-profile';

const root = process.cwd();
const fixturePath = 'tests/unit/fixtures/model-capability-profile/state-cases.json';
const fixture = JSON.parse(fs.readFileSync(path.join(root, fixturePath), 'utf8')) as {
  schemaVersion: string;
  scope: { workspaceId: string; roleId: string | null; sessionKey: string };
  runtimeGeneration: string;
  observedAt: string;
  baseFact: Omit<ModelCapabilityEffectiveFactInput, 'capabilityId'>;
  cases: Array<{
    id: string;
    capabilityId: string;
    expectedStaticDisposition: string;
    expectedAxis: 'runtimeAvailability' | 'actionAuthorization';
    expectedValue: string;
    override: Record<string, unknown>;
  }>;
  digestNormalization: {
    equivalentObservedAt: string;
    equivalentScope: { workspaceId: string; roleId: string | null; sessionKey: string };
    equivalentFactOrder: 'reverse';
    equivalentActionOrder: 'reverse';
    equivalentRejectedFields: string[];
    changedRuntimeReason: string;
    changedDriverState: string;
  };
};

const staticManifest = createModelCapabilityStaticManifest();
const staticById = new Map(staticManifest.entries.map((entry) => [entry.capabilityId, entry]));

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) return structuredClone(override ?? base) as T;
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const output = structuredClone(base) as Record<string, unknown>;
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
      output[key] = key in output ? deepMerge(output[key], value) : structuredClone(value);
    }
    return output as T;
  }
  return structuredClone(override ?? base) as T;
}

function factForCase(testCase: (typeof fixture.cases)[number]): ModelCapabilityEffectiveFactInput {
  const staticEntry = staticById.get(testCase.capabilityId);
  if (!staticEntry) throw new Error(`Unknown fixture capability: ${testCase.capabilityId}`);
  const fact = deepMerge(
    { ...structuredClone(fixture.baseFact), capabilityId: testCase.capabilityId },
    testCase.override,
  ) as ModelCapabilityEffectiveFactInput;
  fact.tool.identity = structuredClone(staticEntry.toolIdentity);
  fact.tool.callableName = staticEntry.userEntry;
  return fact;
}

function profileInput(overrides: Partial<BuildModelCapabilityProfileInput> = {}): BuildModelCapabilityProfileInput {
  return {
    generatedAt: '2026-10-21T14:00:01.000Z',
    scope: structuredClone(fixture.scope),
    runtimeGeneration: fixture.runtimeGeneration,
    observedAt: fixture.observedAt,
    facts: fixture.cases.map(factForCase),
    ...overrides,
  };
}

function build(overrides: Partial<BuildModelCapabilityProfileInput> = {}): ModelCapabilityProfile {
  return buildModelCapabilityProfile(profileInput(overrides));
}

function entry(profile: ModelCapabilityProfile, capabilityId: string) {
  const result = profile.entries.find((candidate) => candidate.capabilityId === capabilityId);
  if (!result) throw new Error(`Missing profile entry: ${capabilityId}`);
  return result;
}

describe('ModelCapabilityProfile/v1', () => {
  it('builds a deterministic schema with one static disposition record for every user-visible capability', () => {
    const profile = build();
    expect(profile.schemaVersion).toBe(MODEL_CAPABILITY_PROFILE_SCHEMA);
    expect(profile.staticManifest.entries).toHaveLength(COMPONENT_DISPOSITION_ENTRIES.length);
    expect(profile.entries).toHaveLength(COMPONENT_DISPOSITION_ENTRIES.length);
    expect(profile.staticManifest.entries).toHaveLength(COMPONENT_DISPOSITION_MANIFEST.entries.length);

    const visibleEntries = profile.entries.filter((candidate) => candidate.static.visibility === 'user');
    const expectedVisibleIds = COMPONENT_DISPOSITION_ENTRIES.filter((candidate) => candidate.visibility === 'user').map((candidate) => candidate.id).sort();
    expect(visibleEntries.map((candidate) => candidate.capabilityId).sort()).toEqual(expectedVisibleIds);
    expect(new Set(visibleEntries.map((candidate) => candidate.capabilityId)).size).toBe(visibleEntries.length);
    expect(visibleEntries).toHaveLength(expectedVisibleIds.length);
    expect(visibleEntries.map((candidate) => candidate.capabilityId)).not.toContain(
      'component.v3-capability-catalog',
    );
    expect(new Set(profile.entries.map((candidate) => candidate.capabilityId)).size).toBe(profile.entries.length);

    const result = validateModelCapabilityProfile(profile);
    expect(result.issues, JSON.stringify(result.issues)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.userVisibleCapabilityCount).toBe(expectedVisibleIds.length);
  });

  it('keeps static disposition, runtime availability, action authorization, memory and knowledge as separate axes', () => {
    const profile = build();
    for (const candidate of profile.entries) {
      expect(candidate.static.disposition).toBeTruthy();
      expect(MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES).toContain(candidate.runtimeAvailability.state);
      for (const action of candidate.actionAuthorization) {
        expect(MODEL_CAPABILITY_ACTION_AUTHORIZATION_STATES).toContain(action.authorization);
      }
      expect(candidate.memory).toHaveProperty('read');
      expect(candidate.memory).toHaveProperty('write');
      expect(candidate.memory).toHaveProperty('candidate');
      expect(candidate.knowledge).toHaveProperty('appliedState');
      expect(candidate.knowledge).toHaveProperty('version');
    }
    expect(MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES).not.toContain('internal');
    expect(MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES).not.toContain('retired');
    expect(MODEL_CAPABILITY_RUNTIME_AVAILABILITY_STATES).not.toContain('requires-approval');
  });

  it('covers enabled/disabled/partial/degraded/quarantined/requires-approval/internal/retired with disk fixtures', () => {
    const profile = build();
    expect(fixture.cases.map((testCase) => testCase.id)).toEqual([
      'enabled', 'disabled', 'partial', 'degraded', 'quarantined', 'requires-approval', 'internal', 'retired',
    ]);
    for (const testCase of fixture.cases) {
      const candidate = entry(profile, testCase.capabilityId);
      expect(candidate.static.disposition, testCase.id).toBe(testCase.expectedStaticDisposition);
      if (testCase.expectedAxis === 'runtimeAvailability') {
        expect(candidate.runtimeAvailability.state, testCase.id).toBe(testCase.expectedValue);
      } else {
        expect(candidate.actionAuthorization.map((action) => action.authorization), testCase.id).toContain(testCase.expectedValue);
        expect(candidate.runtimeAvailability.state, testCase.id).not.toBe(testCase.expectedValue);
      }
    }
    expect(entry(profile, 'component.dcs-context-authority').static.disposition).toBe('internal');
    expect(entry(profile, 'surface.dreams').static.disposition).toBe('retired');
  });
  it('keeps the static digest stable across effective facts and changes it only with static configuration', () => {
    const baseline = build();
    const later = build({
      generatedAt: '2026-10-21T15:00:00.000Z',
      observedAt: '2026-10-21T15:00:00.000Z',
      runtimeGeneration: 'gen-tf0492-fixture-2',
      facts: profileInput().facts.slice().reverse(),
    });
    expect(later.staticDigest).toBe(baseline.staticDigest);

    const changedStaticManifest = structuredClone(staticManifest);
    const target = changedStaticManifest.entries.find((candidate) => candidate.capabilityId === 'component.working-memory-context');
    if (!target) throw new Error('missing static digest mutation target');
    target.owner = 'changed-static-owner';
    expect(computeModelCapabilityStaticDigest(changedStaticManifest)).not.toBe(baseline.staticDigest);
    expect(changedStaticManifest.entries.some((candidate) => candidate.capabilityId === 'component.working-memory-context')).toBe(true);
  });

  it('normalizes effective digest inputs and ignores observation/generation timestamps', () => {
    const baselineInput = profileInput();
    const firstFact = structuredClone(baselineInput.facts[0]);
    firstFact.actionAuthorization = [
      {
        actionId: 'write',
        authorization: 'allowed',
        grant: { grantId: 'grant-write', state: 'active', expiresAt: '2026-10-22T14:00:00.000Z' },
      },
      {
        actionId: 'execute',
        authorization: 'allowed',
        grant: { grantId: 'grant-execute', state: 'active', expiresAt: '2026-10-22T14:00:00.000Z' },
      },
    ];
    firstFact.ack.rejectedFields = ['zeta', 'alpha'];
    const baseline = build({
      facts: [firstFact, ...baselineInput.facts.slice(1)],
      runtimeGeneration: ' gen-tf0492-fixture-1 ',
      scope: fixture.scope,
    });

    const equivalentFacts = [firstFact, ...baselineInput.facts.slice(1)]
      .slice()
      .reverse()
      .map((fact) => {
        const copy = structuredClone(fact);
        copy.actionAuthorization = copy.actionAuthorization.slice().reverse();
        copy.ack.rejectedFields = copy.ack.rejectedFields.slice().reverse();
        copy.driver.id = ` ${copy.driver.id} `;
        copy.runtimeAvailability.source = ` ${copy.runtimeAvailability.source} `;
        if (copy.runtimeAvailability.reason) copy.runtimeAvailability.reason = ` ${copy.runtimeAvailability.reason} `;
        return copy;
      });
    const equivalent = build({
      facts: equivalentFacts,
      generatedAt: '2026-10-21T16:00:00.000Z',
      observedAt: fixture.digestNormalization.equivalentObservedAt,
      runtimeGeneration: 'gen-tf0492-fixture-1',
      scope: fixture.digestNormalization.equivalentScope,
    });
    expect(equivalent.effectiveDigest).toBe(baseline.effectiveDigest);
    expect(equivalent.staticDigest).toBe(baseline.staticDigest);

    const changedFacts = structuredClone(equivalentFacts);
    changedFacts[0].runtimeAvailability.reason = fixture.digestNormalization.changedRuntimeReason;
    const changed = build({ facts: changedFacts });
    expect(changed.effectiveDigest).not.toBe(baseline.effectiveDigest);
    expect(changed.staticDigest).toBe(baseline.staticDigest);

    expect(canonicalModelCapabilityJson({ z: 1, a: { y: 2, x: 3 } })).toBe(canonicalModelCapabilityJson({ a: { x: 3, y: 2 }, z: 1 }));
  });

  it('bounds prompt addition to a reserved system-prompt budget without using working-context characters', () => {
    const profile = build();
    const prompt = profile.promptAddition;
    expect(prompt.budget.maxChars).toBe(MODEL_CAPABILITY_PROMPT_MAX_CHARS);
    expect(prompt.text.length).toBe(prompt.budget.usedChars);
    expect(prompt.text.length).toBeLessThanOrEqual(prompt.budget.maxChars);
    expect(prompt.budget.remainingChars).toBe(prompt.budget.maxChars - prompt.text.length);
    expect(prompt.budget.chargedTo).toBe('reserved-system-prompt');
    expect(prompt.budget.workContextCharsUsed).toBe(0);
    expect(prompt.text).toContain('Default runtime availability:');
    expect(prompt.text).toContain('Advanced runtime availability:');
    expect(prompt.text).toContain('requires-approval');
    expect(prompt.text).toContain('quarantined');
    expect(prompt.text).toContain('memory-read:allowed');
    expect(prompt.text).toContain('memory-write:denied');
    expect(prompt.text).toContain('memory-candidates:available');
    expect(prompt.text).toContain('knowledge:applied');
        // TF-0504: the internal execution/evidence substrate must not be self-described
    // as a user-visible capability either.
    expect(prompt.text).not.toMatch(/\b(?:DCS|VToken|C6|RC-03|V3|VerseShell|Observability recorder|event[- ]log)\b/u);
    for (const candidate of profile.entries.filter((record) => record.static.disposition === 'internal' || record.static.disposition === 'retired')) {
      expect(prompt.text).not.toContain(candidate.static.displayName);
    }

    const truncated = build({ promptMaxChars: 400 });
    expect(truncated.promptAddition.text.length).toBeLessThanOrEqual(400);
    expect(truncated.promptAddition.budget.workContextCharsUsed).toBe(0);
    expect(truncated.promptAddition.omittedCapabilityIds.length).toBeGreaterThan(0);
    expect(truncated.diagnostics.some((diagnostic) => diagnostic.code === 'prompt-capability-omitted')).toBe(true);
  });

  it('binds a supplied capability catalog identity into the effective digest', () => {
    const identity = {
      schemaVersion: 'CapabilityCatalogSnapshot/v1',
      digest: `sha256:${'a'.repeat(64)}`,
    };
    const bound = build({ catalogIdentity: identity });
    expect(bound.catalogIdentity).toEqual(identity);
    expect(build().effectiveDigest).not.toBe(bound.effectiveDigest);
    expect(profileInput({ catalogIdentity: identity })).toMatchObject({ catalogIdentity: identity });

    const tampered = structuredClone(bound) as ModelCapabilityProfile;
    tampered.catalogIdentity = { ...identity, digest: `sha256:${'b'.repeat(64)}` };
    const result = validateModelCapabilityProfile(tampered);
    expect(result.ok).toBe(false);
    expect(result.issues.map((entryIssue) => entryIssue.code)).toContain('effective_digest_mismatch');
  });

  it('rejects invalid effective state inputs with explicit negative issue codes', () => {
    const base = profileInput();
    const duplicate = { ...base, facts: [base.facts[0], base.facts[0]] };
    expect(() => buildModelCapabilityProfile(duplicate)).toThrow(/duplicate_effective_capability/u);

    const unknown = {
      ...base,
      facts: [{ ...base.facts[0], capabilityId: 'component.not-registered' }],
    };
    expect(() => buildModelCapabilityProfile(unknown)).toThrow(/unknown_effective_capability/u);

    const conflated = structuredClone(base);
    (conflated.facts[0].runtimeAvailability as { state: string }).state = 'internal';
    expect(() => buildModelCapabilityProfile(conflated)).toThrow(/static_runtime_axis_conflation/u);

    const approvalConflation = structuredClone(base);
    const permissionFact = approvalConflation.facts.find((candidate) => candidate.capabilityId === 'component.permission-approval-authority');
    if (!permissionFact) throw new Error('missing permission fixture');
    permissionFact.actionAuthorization[0].grant = {
      grantId: 'grant-active-but-requires-approval',
      state: 'active',
      expiresAt: '2026-10-22T14:00:00.000Z',
    };
    expect(() => buildModelCapabilityProfile(approvalConflation)).toThrow(/approval_axis_conflation/u);

    const knowledgeVersion = structuredClone(base);
    const knowledgeFact = knowledgeVersion.facts.find((candidate) => candidate.capabilityId === 'component.knowledge-retrieval-source');
    if (!knowledgeFact) throw new Error('missing knowledge fixture');
    knowledgeFact.knowledge = { appliedState: 'applied', version: null, digest: null };
    expect(() => buildModelCapabilityProfile(knowledgeVersion)).toThrow(/applied_knowledge_version_missing/u);

    const quarantine = structuredClone(base);
    const codingFact = quarantine.facts.find((candidate) => candidate.capabilityId === 'component.coding-execution-backend');
    if (!codingFact) throw new Error('missing coding fixture');
    codingFact.quarantine = { state: 'clear', reason: null, since: null };
    expect(() => buildModelCapabilityProfile(quarantine)).toThrow(/quarantine_state_missing/u);

    expect(() => build({ promptMaxChars: 399 })).toThrow(/build_prompt_budget_invalid/u);
  });

  it('rejects duplicate static records and internal names in user-facing capabilities', () => {
    const duplicateEntries = [...COMPONENT_DISPOSITION_ENTRIES, COMPONENT_DISPOSITION_ENTRIES[0]];
    const duplicateManifest = createModelCapabilityStaticManifest(duplicateEntries);
    const duplicateIssues = validateModelCapabilityStaticManifest(duplicateManifest, COMPONENT_DISPOSITION_ENTRIES);
    expect(duplicateIssues.map((entryIssue) => entryIssue.code)).toContain('duplicate_static_capability');

    const mutatedManifest = structuredClone(staticManifest);
    const userEntry = mutatedManifest.entries.find((candidate) => candidate.visibility === 'user');
    if (!userEntry) throw new Error('missing user static entry');
    userEntry.displayName = 'DCS capability';
    expect(validateModelCapabilityStaticManifest(mutatedManifest).map((entryIssue) => entryIssue.code)).toContain('internal_name_in_user_capability');

    for (const candidate of COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.visibility === 'user')) {
      expect(MODEL_CAPABILITY_USER_DISPLAY_NAMES[candidate.id], candidate.id).toBeTruthy();
    }
  });

  it('rejects axis conflation and digest tampering in an already-generated profile', () => {
    const profile = structuredClone(build()) as ModelCapabilityProfile;
    const target = profile.entries.find((candidate) => candidate.static.visibility === 'user');
    if (!target) throw new Error('missing profile mutation target');
    (target.runtimeAvailability as { state: string }).state = 'internal';
    profile.staticDigest = `sha256:${'0'.repeat(64)}`;
    const result = validateModelCapabilityProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.map((entryIssue) => entryIssue.code)).toEqual(expect.arrayContaining([
      'profile_axis_conflation',
      'static_digest_mismatch',
      'effective_digest_mismatch',
    ]));
  });
});
