const REQUIRED_PROFILES = ['dcs-coding', 'sekb-assisted', 'browser-supervised'];
const REQUIRED_DAY1_STEPS = [
  'dcs:ops:preflight:gates',
  'dcs:prod-p0',
  'lint:dcs',
  'test:dcs',
  'p0:accept',
  'dcs:corpus:validate',
  'build:vite',
  'build:runtime-after-fix',
  'electron-critical-final',
];

function isFilled(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return value != null;
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    !/^(?:-|—|none|null)$/iu.test(normalized) &&
    !/(?:\bTBD\b|FIXTURE|待填|待确认|占位)/iu.test(normalized)
  );
}

function hasList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isFilled);
}

export function hasSafeTf0009HardBounds(profiles) {
  const hardBounds = profiles?.hardBounds;
  return (
    hardBounds?.defaultsUnchanged === true &&
    hardBounds?.liveReady === false &&
    hardBounds?.productApproved === false &&
    hardBounds?.jointSystemGa === 'NO-GO' &&
    hardBounds?.sekbAutoWriteback === false &&
    hardBounds?.cutoverAllowed === false
  );
}

export function hasValidTf0009Day1Gates(day1Gates) {
  const steps = Array.isArray(day1Gates?.steps) ? day1Gates.steps : [];
  const passingSteps = new Set(
    steps
      .filter((step) => step?.ok === true && step?.exitCode === 0)
      .map((step) => step.name),
  );
  return (
    day1Gates?.schema === 'dcs-deep-test-day1-gates/v1' &&
    day1Gates?.authority === 'engineering-l0-l1-l2-only' &&
    typeof day1Gates?.sha === 'string' &&
    day1Gates.sha.length >= 7 &&
    ['pass', 'pass-after-repaired-cold-build-gap'].includes(day1Gates?.result) &&
    day1Gates?.defaultsUnchanged === true &&
    day1Gates?.liveReady === false &&
    day1Gates?.productApproved === false &&
    day1Gates?.defaultOn === false &&
    day1Gates?.c1?.reductionFactor === 4.5 &&
    day1Gates?.c1?.meetsGate === false &&
    day1Gates?.c1?.recommendation === 'keep-off' &&
    day1Gates?.tf0006 === 'blocked' &&
    REQUIRED_PROFILES.every((id) => day1Gates?.qualifyingRealRuns?.[id] === 0) &&
    REQUIRED_DAY1_STEPS.every((name) => passingSteps.has(name))
  );
}

export function evaluateTf0009L3Readiness({
  profiles,
  profilesMissing = false,
  runbookPresent,
  day1GatesPresent,
  day1Gates,
}) {
  const blockers = [];
  const block = (id, message, nextStep) => blockers.push({ id, message, nextStep });

  if (!runbookPresent) {
    block('runbook-missing', 'DCS ops canary runbook is missing', 'Restore docs/dev/dcs-ops-canary-runbook.md');
  }
  if (!day1GatesPresent) {
    block(
      'day1-gates-missing',
      'L0/L1/L2 gate record is missing',
      'Write artifacts/dcs-deep-test-week1/day1-gates.json before L3',
    );
  } else if (!hasValidTf0009Day1Gates(day1Gates)) {
    block(
      'day1-gates-invalid',
      'L0/L1/L2 gate record is incomplete or violates frozen boundaries',
      'Regenerate day1-gates.json from the required commands and final combined Electron matrix',
    );
  }
  if (profilesMissing || !profiles) {
    block(
      'profiles-missing',
      'Three-profile canary governance is missing',
      'Fill artifacts/dcs-deep-test-week1/profiles.json with named roles and bounded scopes',
    );
    return { ready: false, blockers };
  }

  if (!hasSafeTf0009HardBounds(profiles)) {
    block(
      'hard-bounds-incomplete',
      'Canary hard bounds are incomplete or unsafe',
      'Restore all false product locks and explicit SEKB/cutover prohibitions',
    );
  }

  for (const role of ['owner', 'operator', 'safety']) {
    if (!isFilled(profiles.roles?.[role])) {
      block(
        `role-${role}-missing`,
        `Named ${role} is missing`,
        'Name the accountable human roles before L3',
      );
    }
  }

  const profileById = new Map((profiles.profiles ?? []).map((profile) => [profile.id, profile]));
  for (const id of REQUIRED_PROFILES) {
    const profile = profileById.get(id);
    if (!profile) {
      block(`profile-${id}-missing`, `Required profile ${id} is missing`, 'Complete the three-profile table');
      continue;
    }
    const required = {
      owner: profile.owner ?? profiles.roles?.owner,
      cohort: profile.cohort ?? profile.cohortSize,
      budget: profile.budget ?? profile.budgetTasks ?? profile.tokenBudget,
      privacy: profile.privacy,
      kill: profile.kill,
      rollback: profile.rollback,
    };
    for (const [field, value] of Object.entries(required)) {
      if (!isFilled(value)) {
        block(
          `profile-${id}-${field}-missing`,
          `Profile ${id} has no concrete ${field}`,
          `Fill ${id}.${field} without TBD or fixture placeholders`,
        );
      }
    }
    if (!hasList(profile.metrics)) {
      block(`profile-${id}-metrics-missing`, `Profile ${id} has no metrics`, `Fill ${id}.metrics`);
    }
    if (!hasList(profile.stopConditions)) {
      block(
        `profile-${id}-stop-conditions-missing`,
        `Profile ${id} has no stop conditions`,
        `Fill ${id}.stopConditions`,
      );
    }
  }

  return { ready: blockers.length === 0, blockers };
}
