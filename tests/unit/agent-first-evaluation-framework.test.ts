import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkAgentFirstFrameworkContract } from '../../scripts/agent-first-framework-check.mjs';
import {
  FRAMEWORK_NEGATIVE_CONTROLS,
  FRAMEWORK_PATHS,
  REQUIRED_FRAMEWORK_GUIDE_PHRASES,
  SUBJECT_ADAPTER_METHODS,
  SUBJECT_IDENTITY_FIELDS,
  countFramework,
  loadFrameworkFiles,
  runFrameworkNegativeControls,
  validateFrameworkContract,
  validateFrameworkRegistry,
} from '../../scripts/lib/agent-first-evaluation-framework.mjs';

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, 'harness/specs/fixtures/agent-first-framework/validation-report.json');

type Entry = Record<string, unknown>;
type Registry = {
  schemaVersion: string;
  registeredSubjects: Entry[];
  registeredSuites: Entry[];
  registeredGraders: Entry[];
  registeredProfiles: Entry[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('agent-first evaluation framework core', () => {
  it('registers a complete subject/suite/grader/profile set with no violation', () => {
    const files = loadFrameworkFiles(ROOT);
    const { violations, counts } = validateFrameworkContract(files);

    expect(violations).toEqual([]);
    expect(counts).toEqual({ subjects: 1, suites: 1, graders: 3, profiles: 1 });
  });

  it('admits a new evaluation surface as registry entries only, without a core edit', () => {
    const files = loadFrameworkFiles(ROOT);
    const registry = structuredClone(files.registry) as Registry;

    registry.registeredSubjects.push({
      id: 'runtime-memory-module',
      version: '1.0.0',
      kind: 'runtime-module',
      title: 'Runtime memory module',
      methods: [...SUBJECT_ADAPTER_METHODS],
      identityFields: [...SUBJECT_IDENTITY_FIELDS],
      observesFinalStateFrom: 'product',
      authoredBy: 'framework',
    });
    registry.registeredSuites.push({
      ...structuredClone(registry.registeredSuites[0]),
      id: 'memory-core',
      title: 'Memory suite',
      subjectKinds: ['runtime-module'],
    });
    registry.registeredGraders.push({
      ...structuredClone(registry.registeredGraders[0]),
      id: 'deterministic-memory-state',
    });
    registry.registeredProfiles.push({
      ...structuredClone(registry.registeredProfiles[0]),
      id: 'memory-profile',
      subjectId: 'runtime-memory-module',
      suiteId: 'memory-core',
      graderIds: ['deterministic-memory-state'],
      status: 'not-run',
    });

    const { violations, counts } = validateFrameworkRegistry(registry);

    expect(violations).toEqual([]);
    expect(counts).toEqual({ subjects: 2, suites: 2, graders: 4, profiles: 2 });
  });

  it('fails closed on every declared negative control', () => {
    const files = loadFrameworkFiles(ROOT);
    const controls = runFrameworkNegativeControls(files);

    expect(controls.length).toBeGreaterThanOrEqual(12);
    for (const control of controls) {
      expect(control.rejected, `${control.id} must be rejected with ${control.expectedCode}`).toBe(true);
      expect(control.observedCodes).toContain(control.expectedCode);
    }

    const byId = new Map(controls.map((control) => [control.id, control]));
    expect(byId.get('subject-method-missing')?.expectedCode).toBe('subject.method-missing');
    expect(byId.get('subject-self-observation')?.expectedCode).toBe('subject.self-observation');
    expect(byId.get('suite-held-out-writable')?.expectedCode).toBe('suite.held-out-writable');
    expect(byId.get('grader-rubric-unsafe')?.expectedCode).toBe('grader.rubric-unsafe');
    expect(byId.get('profile-no-deterministic-grader')?.expectedCode).toBe('profile.no-deterministic-grader');
    expect(byId.get('profile-pass-without-run')?.expectedCode).toBe('profile.pass-without-run');
    expect(FRAMEWORK_NEGATIVE_CONTROLS.length).toBe(controls.length);
  });

  it('keeps the tracked validation report in lockstep with a fresh read', () => {
    const tracked = readJson<{ checkedAt: string; actor: string }>(REPORT_PATH);
    const fresh = checkAgentFirstFrameworkContract(ROOT, tracked.actor, tracked.checkedAt);

    expect(fresh.ok).toBe(true);
    expect(fresh.report).toEqual(tracked);
  });

  it('keeps the framework paths and the guide contract in one place', () => {
    expect(FRAMEWORK_PATHS.registry).toBe('harness/specs/fixtures/agent-first-framework/registry.json');
    expect(FRAMEWORK_PATHS.guide).toBe('harness/specs/guides/agent-first-acceptance.md');

    const guide = readFileSync(join(ROOT, FRAMEWORK_PATHS.guide), 'utf8');
    for (const phrase of REQUIRED_FRAMEWORK_GUIDE_PHRASES) {
      expect(guide).toContain(phrase);
    }
  });

  it('reports not-run, never pass, for a profile that has not been run', () => {
    const files = loadFrameworkFiles(ROOT);
    const registry = files.registry as Registry;

    expect(registry.registeredProfiles[0].status).toBe('not-run');
    expect(countFramework(registry)).toEqual({ subjects: 1, suites: 1, graders: 3, profiles: 1 });
  });
});
