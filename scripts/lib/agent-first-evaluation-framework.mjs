// Agent-first evaluation framework core validator (TF-0620).
//
// TF-0589 sealed *what acceptance means* for one candidate. This module freezes
// the layer above it: registered subject adapters, suites and graders, the
// composition (profile) contract, and the insertion rule that a new evaluation
// surface is a registry entry plus a calibration fixture rather than a core edit.
//
// It fails closed. validateFrameworkContract() returns every violation it finds
// instead of throwing on the first one, and an unregistered subject, suite or
// grader never falls back to an implicit default.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AGENT_FIRST_FRAMEWORK_SCHEMA = 'AgentFirstEvaluationFramework/v1';
export const AGENT_FIRST_FRAMEWORK_VALIDATION_SCHEMA = 'AgentFirstEvaluationFrameworkValidation/v1';
export const AGENT_FIRST_TASK_SCHEMA = 'AgentFirstTask/v1';

export const FRAMEWORK_PATHS = Object.freeze({
  guide: 'harness/specs/guides/agent-first-acceptance.md',
  registry: 'harness/specs/fixtures/agent-first-framework/registry.json',
});

/** The five calls a subject adapter must expose before it can be evaluated. */
export const SUBJECT_ADAPTER_METHODS = Object.freeze([
  'identity', 'setup', 'invoke', 'observe', 'teardown',
]);

/** identity() must be able to name all of these, or a run cannot be bound. */
export const SUBJECT_IDENTITY_FIELDS = Object.freeze([
  'commit', 'tree', 'buildHash', 'runtimeVersion', 'modelId', 'providerId', 'adapterId',
]);

export const GRADER_KINDS = Object.freeze(['deterministic', 'heuristic', 'rubric']);

export const SUBJECT_KINDS = Object.freeze([
  'product', 'runtime-module', 'skill', 'prompt-candidate', 'harness-candidate',
]);

export const PROFILE_STATUSES = Object.freeze([
  'not-run', 'partial', 'pass', 'fail', 'invalid', 'accepted-shortfall',
]);

export const MINIMUM_SUITE_K = 3;
export const MINIMUM_SUITE_CASES = 20;

export const REQUIRED_FRAMEWORK_GUIDE_PHRASES = Object.freeze([
  '## 16. Framework layer',
  'subject adapter',
  'unregistered',
  'Closed loop',
  'regression graduation',
]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function push(violations, code, path, message) {
  violations.push({ code, path, message });
}

export function countFramework(registry) {
  return {
    subjects: list(registry?.registeredSubjects).length,
    suites: list(registry?.registeredSuites).length,
    graders: list(registry?.registeredGraders).length,
    profiles: list(registry?.registeredProfiles).length,
  };
}

/**
 * @param {unknown} registry
 * @returns {{violations: Array<{code: string, path: string, message: string}>, counts: {subjects: number, suites: number, graders: number, profiles: number}}}
 */
export function validateFrameworkRegistry(registry) {
  const violations = [];
  if (!isPlainObject(registry)) {
    push(violations, 'registry.invalid', 'registry', 'registry must be an object');
    return { violations, counts: countFramework({}) };
  }
  if (registry.schemaVersion !== AGENT_FIRST_FRAMEWORK_SCHEMA) {
    push(violations, 'registry.schema', 'schemaVersion', `schemaVersion must be ${AGENT_FIRST_FRAMEWORK_SCHEMA}`);
  }

  const subjects = list(registry.registeredSubjects);
  const suites = list(registry.registeredSuites);
  const graders = list(registry.registeredGraders);
  const profiles = list(registry.registeredProfiles);

  for (const [group, items] of [['subject', subjects], ['suite', suites], ['grader', graders], ['profile', profiles]]) {
    if (items.length === 0) {
      push(violations, 'registry.group-empty', `registered${group}s`, `at least one ${group} must be registered`);
    }
  }

  // Ids are unique across the whole registry, not only inside one group: a
  // profile, suite, grader and subject may not collide.
  const seenIds = new Map();
  for (const [group, items] of [['subject', subjects], ['suite', suites], ['grader', graders], ['profile', profiles]]) {
    for (const item of items) {
      const id = item?.id;
      const path = `${group}s.${nonEmpty(id) ? id : '<missing>'}`;
      if (!nonEmpty(id)) {
        push(violations, 'registry.entry-id-missing', path, `${group} entry needs a non-empty id`);
        continue;
      }
      if (seenIds.has(id)) push(violations, 'registry.duplicate-id', path, `id ${id} is already registered as a ${seenIds.get(id)}`);
      else seenIds.set(id, group);
      if (!nonEmpty(item?.version)) push(violations, 'registry.entry-version-missing', path, `${group} ${id} needs a version`);
    }
  }

  const subjectById = new Map(subjects.filter((entry) => nonEmpty(entry?.id)).map((entry) => [entry.id, entry]));
  const suiteById = new Map(suites.filter((entry) => nonEmpty(entry?.id)).map((entry) => [entry.id, entry]));
  const graderById = new Map(graders.filter((entry) => nonEmpty(entry?.id)).map((entry) => [entry.id, entry]));
  const registeredSubjectIds = new Set(subjectById.keys());

  for (const subject of subjects) {
    const id = nonEmpty(subject?.id) ? subject.id : '<missing>';
    const path = `subjects.${id}`;
    if (!SUBJECT_KINDS.includes(subject?.kind)) {
      push(violations, 'subject.invalid-kind', path, `unknown subject kind ${String(subject?.kind)}`);
    }
    const methods = list(subject?.methods);
    for (const method of SUBJECT_ADAPTER_METHODS) {
      if (!methods.includes(method)) push(violations, 'subject.method-missing', path, `subject adapter must expose ${method}()`);
    }
    const identityFields = list(subject?.identityFields);
    for (const field of SUBJECT_IDENTITY_FIELDS) {
      if (!identityFields.includes(field)) push(violations, 'subject.identity-empty', path, `identity() must expose ${field}`);
    }
    if (subject?.observesFinalStateFrom !== 'product') {
      push(violations, 'subject.self-observation', path, 'observe() must read the final state from the product, never from the subject output');
    }
  }

  for (const suite of suites) {
    const id = nonEmpty(suite?.id) ? suite.id : '<missing>';
    const path = `suites.${id}`;
    const split = suite?.split;
    if (!isPlainObject(split) || !Number.isInteger(split.public) || !Number.isInteger(split.heldOut) || split.heldOut <= 0) {
      push(violations, 'suite.split-missing', path, 'suite must declare a public/held-out split with heldOut > 0');
    } else if (split.heldOutWritableByCandidate === true) {
      push(violations, 'suite.held-out-writable', path, 'the held-out split must never be writable by the candidate');
    }
    if (!Number.isInteger(suite?.k) || suite.k < MINIMUM_SUITE_K) {
      push(violations, 'suite.floor-too-low', path, `k must be an integer >= ${MINIMUM_SUITE_K}`);
    }
    if (!Number.isInteger(suite?.minCases) || suite.minCases < MINIMUM_SUITE_CASES) {
      push(violations, 'suite.floor-too-low', path, `minCases must be an integer >= ${MINIMUM_SUITE_CASES}`);
    }
    if (suite?.taskSchemaVersion !== AGENT_FIRST_TASK_SCHEMA) {
      push(violations, 'suite.task-schema', path, `taskSchemaVersion must be ${AGENT_FIRST_TASK_SCHEMA}`);
    }
    if (!nonEmpty(suite?.provenance)) {
      push(violations, 'suite.provenance-missing', path, 'suite must declare provenance');
    }
    const subjectKinds = list(suite?.subjectKinds);
    if (subjectKinds.length === 0) {
      push(violations, 'suite.unknown-subject-kind', path, 'suite must declare at least one accepted subject kind');
    }
    for (const kind of subjectKinds) {
      if (!SUBJECT_KINDS.includes(kind)) push(violations, 'suite.unknown-subject-kind', path, `unknown subject kind ${kind}`);
    }
    if (nonEmpty(suite?.authoredBy) && registeredSubjectIds.has(suite.authoredBy)) {
      push(violations, 'suite.subject-authored', path, 'a suite may not be authored by a registered subject');
    }
    if (!isPlainObject(suite?.budgets)) push(violations, 'suite.budget-missing', path, 'suite must declare a budget envelope');
    if (!isPlainObject(suite?.timeouts)) push(violations, 'suite.timeout-missing', path, 'suite must declare timeouts');
  }

  for (const grader of graders) {
    const id = nonEmpty(grader?.id) ? grader.id : '<missing>';
    const path = `graders.${id}`;
    if (!GRADER_KINDS.includes(grader?.kind)) {
      push(violations, 'grader.invalid-kind', path, `unknown grader kind ${String(grader?.kind)}`);
    }
    if (!Number.isFinite(grader?.precedence)) {
      push(violations, 'grader.precedence-missing', path, 'grader needs a numeric precedence');
    }
    if (nonEmpty(grader?.authoredBy) && registeredSubjectIds.has(grader.authoredBy)) {
      push(violations, 'grader.subject-authored', path, 'a grader may not be authored by a registered subject');
    }
    const calibration = grader?.calibration;
    if (!isPlainObject(calibration) || !nonEmpty(calibration.knownGood) || !nonEmpty(calibration.knownBad)) {
      push(violations, 'grader.calibration-missing', path, 'grader must carry known-good and known-bad calibration fixtures');
    }
    if (grader?.kind === 'rubric' && !nonEmpty(grader?.promptDigest)) {
      push(violations, 'grader.rubric-unsafe', path, 'a rubric grader must freeze a prompt digest');
    }
  }

  for (const profile of profiles) {
    const id = nonEmpty(profile?.id) ? profile.id : '<missing>';
    const path = `profiles.${id}`;
    const subject = subjectById.get(profile?.subjectId);
    if (!subject) push(violations, 'profile.unknown-subject', path, `subjectId ${String(profile?.subjectId)} is not registered`);
    const suite = suiteById.get(profile?.suiteId);
    if (!suite) push(violations, 'profile.unknown-suite', path, `suiteId ${String(profile?.suiteId)} is not registered`);
    const graderIds = list(profile?.graderIds);
    const resolvedGraders = [];
    for (const graderId of graderIds) {
      const grader = graderById.get(graderId);
      if (!grader) push(violations, 'profile.unknown-grader', path, `graderId ${graderId} is not registered`);
      else resolvedGraders.push(grader);
    }
    if (new Set(graderIds).size !== graderIds.length) {
      push(violations, 'profile.duplicate-grader', path, 'a profile may list each grader at most once');
    }
    if (suite?.requiresDeterministicGrader === true && !resolvedGraders.some((grader) => grader.kind === 'deterministic')) {
      push(violations, 'profile.no-deterministic-grader', path, 'suite requires a deterministic grader but the profile registers none');
    }
    if (subject && suite) {
      const subjectKinds = list(suite.subjectKinds);
      if (subjectKinds.length > 0 && !subjectKinds.includes(subject.kind)) {
        push(violations, 'profile.subject-kind-mismatch', path, `subject kind ${subject.kind} is not accepted by suite ${suite.id}`);
      }
    }
    if (!PROFILE_STATUSES.includes(profile?.status)) {
      push(violations, 'profile.invalid-status', path, `unknown profile status ${String(profile?.status)}`);
    }
    if (profile?.status === 'pass' && !nonEmpty(profile?.runId)) {
      push(violations, 'profile.pass-without-run', path, 'a profile may only report pass once a bound run exists');
    }
    if (!isPlainObject(profile?.resourceEnvelope)) push(violations, 'profile.envelope-missing', path, 'profile must declare a resource envelope');
    if (!isPlainObject(profile?.runner)) push(violations, 'profile.runner-missing', path, 'profile must declare a runner config');
  }

  return { violations, counts: countFramework(registry) };
}

/**
 * @param {{registry?: unknown, guide?: string}} input
 */
export function validateFrameworkContract(input = {}) {
  const violations = [];
  const registryResult = validateFrameworkRegistry(input.registry);
  for (const violation of registryResult.violations) {
    violations.push({ ...violation, path: `registry.${violation.path}` });
  }
  const guide = String(input.guide ?? '');
  for (const phrase of REQUIRED_FRAMEWORK_GUIDE_PHRASES) {
    if (!guide.includes(phrase)) {
      push(violations, 'guide.required-phrase', 'guide', `guide must state "${phrase}"`);
    }
  }
  return { violations, counts: registryResult.counts };
}

export function loadFrameworkFiles(root = process.cwd()) {
  return {
    guide: readFileSync(join(root, FRAMEWORK_PATHS.guide), 'utf8'),
    registry: JSON.parse(readFileSync(join(root, FRAMEWORK_PATHS.registry), 'utf8')),
  };
}

/**
 * Every control below mutates a copy of the real fixture and must be rejected by
 * validateFrameworkContract. The id names the failure class, not the fixture.
 */
export const FRAMEWORK_NEGATIVE_CONTROLS = Object.freeze([
  {
    id: 'subject-method-missing',
    requirement: 'a subject adapter that does not expose observe() cannot be evaluated',
    expectedCode: 'subject.method-missing',
    mutate: (draft) => {
      const subject = draft.registry.registeredSubjects[0];
      subject.methods = subject.methods.filter((method) => method !== 'observe');
    },
  },
  {
    id: 'subject-self-observation',
    requirement: 'a subject that reads its final state from its own output is invalid',
    expectedCode: 'subject.self-observation',
    mutate: (draft) => { draft.registry.registeredSubjects[0].observesFinalStateFrom = 'subject-output'; },
  },
  {
    id: 'subject-identity-incomplete',
    requirement: 'a subject that cannot name its commit/tree/build identity is invalid',
    expectedCode: 'subject.identity-empty',
    mutate: (draft) => {
      const subject = draft.registry.registeredSubjects[0];
      subject.identityFields = subject.identityFields.filter((field) => field !== 'buildHash');
    },
  },
  {
    id: 'suite-held-out-missing',
    requirement: 'a suite without a held-out split cannot be accepted',
    expectedCode: 'suite.split-missing',
    mutate: (draft) => { delete draft.registry.registeredSuites[0].split; },
  },
  {
    id: 'suite-held-out-writable',
    requirement: 'a held-out split writable by the candidate cannot be accepted',
    expectedCode: 'suite.held-out-writable',
    mutate: (draft) => { draft.registry.registeredSuites[0].split.heldOutWritableByCandidate = true; },
  },
  {
    id: 'suite-subject-authored',
    requirement: 'a suite authored by the subject under test cannot be accepted',
    expectedCode: 'suite.subject-authored',
    mutate: (draft) => { draft.registry.registeredSuites[0].authoredBy = draft.registry.registeredSubjects[0].id; },
  },
  {
    id: 'grader-subject-authored',
    requirement: 'a grader authored by the subject under test cannot be accepted',
    expectedCode: 'grader.subject-authored',
    mutate: (draft) => { draft.registry.registeredGraders[0].authoredBy = draft.registry.registeredSubjects[0].id; },
  },
  {
    id: 'grader-rubric-unsafe',
    requirement: 'a rubric grader without a frozen prompt digest cannot be accepted',
    expectedCode: 'grader.rubric-unsafe',
    mutate: (draft) => { delete draft.registry.registeredGraders[1].promptDigest; },
  },
  {
    id: 'grader-duplicate-id',
    requirement: 'a duplicated registry id cannot be accepted',
    expectedCode: 'registry.duplicate-id',
    mutate: (draft) => { draft.registry.registeredGraders[1].id = draft.registry.registeredGraders[0].id; },
  },
  {
    id: 'profile-unknown-suite',
    requirement: 'a profile referencing an unregistered suite cannot be accepted',
    expectedCode: 'profile.unknown-suite',
    mutate: (draft) => { draft.registry.registeredProfiles[0].suiteId = 'not-registered'; },
  },
  {
    id: 'profile-no-deterministic-grader',
    requirement: 'a profile that omits the deterministic grader where the suite requires one cannot be accepted',
    expectedCode: 'profile.no-deterministic-grader',
    mutate: (draft) => { draft.registry.registeredProfiles[0].graderIds = ['rubric-clarity']; },
  },
  {
    id: 'profile-pass-without-run',
    requirement: 'a profile cannot report pass without a bound run',
    expectedCode: 'profile.pass-without-run',
    mutate: (draft) => { draft.registry.registeredProfiles[0].status = 'pass'; },
  },
  {
    id: 'guide-framework-section-removed',
    requirement: 'removing the framework contract section fails closed',
    expectedCode: 'guide.required-phrase',
    mutate: (draft) => { draft.guide = draft.guide.replace('## 16. Framework layer', '## 16. Removed'); },
  },
]);

export function runFrameworkNegativeControls(files) {
  const results = [];
  for (const control of FRAMEWORK_NEGATIVE_CONTROLS) {
    const draft = structuredClone(files);
    try {
      control.mutate(draft);
    } catch (error) {
      results.push({
        id: control.id,
        requirement: control.requirement,
        expectedCode: control.expectedCode,
        rejected: false,
        observedCodes: [`mutate-threw: ${error?.message ?? String(error)}`],
      });
      continue;
    }
    const { violations } = validateFrameworkContract(draft);
    const observedCodes = [...new Set(violations.map((violation) => violation.code))];
    results.push({
      id: control.id,
      requirement: control.requirement,
      expectedCode: control.expectedCode,
      rejected: observedCodes.includes(control.expectedCode),
      observedCodes,
    });
  }
  return results;
}