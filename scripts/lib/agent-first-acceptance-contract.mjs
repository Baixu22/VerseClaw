// Agent-first acceptance contract validator.
//
// TF-0589 froze the agent-first acceptance guide, its source manifest and its
// 14-gate traceability matrix as checkable artefacts. This module is the single
// static validator for that contract: it reads the files from disk, and returns
// every violation it finds instead of throwing on the first one.
//
// It fails closed on purpose. The four failure classes the contract must reject
// are missing requirements, invalid dimensions, unknown verdict states and a
// blocking gate without a negative control; each of them produces a violation
// code here, and `tests/unit/agent-first-acceptance.test.ts` feeds a mutated copy
// of the real fixture through this module to prove the rejection actually fires
// rather than merely being documented.
//
// The validator never treats a command's stdout as evidence: every input is a
// file body read from disk, and `scripts/agent-first-acceptance-check.mjs` only
// reports what these readers produced.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AGENT_FIRST_ACCEPTANCE_SCHEMA = 'AgentFirstAcceptanceMatrix/v1';
export const AGENT_FIRST_ACCEPTANCE_RESEARCH_SCHEMA = 'AgentFirstAcceptanceResearch/v1';
export const AGENT_FIRST_ACCEPTANCE_VALIDATION_SCHEMA = 'AgentFirstAcceptanceValidation/v1';

export const CONTRACT_PATHS = Object.freeze({
  guide: 'harness/specs/guides/agent-first-acceptance.md',
  matrix: 'harness/specs/fixtures/agent-first-acceptance/matrix.json',
  sources: 'harness/specs/fixtures/agent-first-acceptance/sources.json',
  closeout: 'harness/specs/tasks/product-acceptance-closeout.md',
});

/** The ten fields every gate must carry before it can be executed or judged. */
export const REQUIRED_GATE_FIELDS = Object.freeze([
  'id',
  'phase',
  'name',
  'input',
  'command',
  'oracle',
  'negative',
  'evidence',
  'actor',
  'automated',
]);

/** A gate without an input, command, oracle, negative control or evidence is a
 * requirement with nothing behind it, so the matrix is checked against this
 * frozen id list rather than against whatever the file happens to contain. */
export const REQUIRED_GATE_IDS = Object.freeze([
  'A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2', 'F1', 'F2', 'G1',
]);

export const REQUIRED_DIMENSIONS = Object.freeze([
  'source',
  'engineering',
  'runtime',
  'effect',
  'distribution',
  'operational',
  'agentQuality',
  'releaseApproval',
]);

export const REQUIRED_VERDICT_STATES = Object.freeze([
  'pass',
  'partial',
  'not-run',
  'accepted-shortfall',
  'fail',
  'invalid',
]);

export const REQUIRED_EVIDENCE_PACK = Object.freeze([
  'manifest.json',
  'aggregate.json',
  'review.json',
  'SHA256SUMS',
  'credential-scan.json',
]);

export const REQUIRED_TASK_FOREST_NODES = Object.freeze({
  root: 'TF-0588',
  contract: 'TF-0589',
  tasks: 'TF-0590',
  ui: 'TF-0591',
  stats: 'TF-0592',
  review: 'TF-0593',
  ops: 'TF-0594',
  adjudicate: 'TF-0595',
  integrate: 'TF-0596',
});

/** Publication is a publisher decision, so no product state may be pre-approved
 * by the acceptance contract itself. */
export const REQUIRED_LOCKED_BOUNDARIES = Object.freeze({
  humanAcceptanceRequired: false,
  humanEvidenceClaimed: false,
  drivenBy: 'agent',
  releaseApproved: false,
  liveReady: false,
  productApproved: false,
  defaultOn: false,
});

export const REQUIRED_SOURCE_FAMILIES = Object.freeze([
  'software-engineering-acceptance',
  'engineering-acceptance',
  'agent-era-acceptance',
]);

export const MINIMUM_SOURCE_COUNT = 19;
export const MINIMUM_AGENT_ERA_SOURCE_COUNT = 6;
export const MINIMUM_FINDING_COUNT = 10;

/** Wording the guide must keep so the boundary it draws cannot quietly erode. */
export const REQUIRED_GUIDE_PHRASES = Object.freeze([
  'software-testing practice',
  'agent evaluation',
  'final state',
  'deterministic',
  'transcript',
  'infrastructure',
  'confidence interval',
  'human verdict',
  'human-provided data',
]);

export const REQUIRED_GUIDE_STATEMENTS = Object.freeze([
  'No node may use a human verdict or human-provided data as an open condition.',
  'real-human acceptance',
]);

const MINIMUM_DIMENSION_CLAIM_LENGTH = 10;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

function sameList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

/**
 * Validate one parsed agent-first acceptance contract.
 *
 * Returns `{ violations, counts }`. A violation is `{ code, path, message }`;
 * the validator never throws for contract content, so a caller can report every
 * defect in one run.
 */
export function validateAgentFirstAcceptanceContract(input = {}) {
  const { matrix, sources, guide = '', closeout = '' } = input;
  const violations = [];
  const add = (code, path, message) => violations.push({ code, path, message });

  // ---- matrix -------------------------------------------------------------
  if (!isPlainObject(matrix)) {
    add('matrix.missing', 'matrix', 'matrix fixture could not be parsed as an object');
  } else {
    if (matrix.schemaVersion !== AGENT_FIRST_ACCEPTANCE_SCHEMA) {
      add('matrix.schema-version', 'matrix.schemaVersion', `must be ${AGENT_FIRST_ACCEPTANCE_SCHEMA}`);
    }
    if (!['ready', 'in_progress', 'done'].includes(matrix.status)) {
      add('matrix.status', 'matrix.status', 'must be ready, in_progress or done');
    }
    if (!sameList(matrix.requiredGateFields, REQUIRED_GATE_FIELDS)) {
      add('matrix.required-gate-fields', 'matrix.requiredGateFields', 'must equal the ten frozen gate fields');
    }

    const gates = Array.isArray(matrix.gates) ? matrix.gates : null;
    if (!gates) {
      add('requirement.gate-missing', 'matrix.gates', 'matrix declares no gate list');
    } else {
      const seen = new Set();
      for (const gate of gates) {
        const id = isPlainObject(gate) ? String(gate.id ?? '<unnamed>') : '<unnamed>';
        if (isPlainObject(gate) && seen.has(id)) {
          add('gate.duplicate-id', `matrix.gates[${id}]`, `gate id ${id} is declared more than once`);
        }
        seen.add(id);
        if (!isPlainObject(gate)) {
          add('gate.malformed', 'matrix.gates', 'every gate must be an object');
          continue;
        }
        for (const field of REQUIRED_GATE_FIELDS) {
          if (typeof gate[field] === 'boolean') continue;
          if (!nonEmpty(gate[field])) {
            add('gate.missing-field', `matrix.gates[${id}].${field}`, `gate ${id} is missing ${field}`);
          }
        }
        if (typeof gate.automated !== 'boolean') {
          add('gate.automated-not-boolean', `matrix.gates[${id}].automated`, `gate ${id} automated must be boolean`);
        }
        if (!Array.isArray(gate.negative) || gate.negative.length === 0) {
          add('gate.negative-empty', `matrix.gates[${id}].negative`, `gate ${id} has no negative control`);
        }
        if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
          add('gate.evidence-empty', `matrix.gates[${id}].evidence`, `gate ${id} declares no evidence artifact`);
        }
        if (!nonEmpty(gate.oracle)) {
          add('gate.oracle-missing', `matrix.gates[${id}].oracle`, `gate ${id} declares no oracle`);
        }
      }
      for (const required of REQUIRED_GATE_IDS) {
        if (!seen.has(required)) {
          add('requirement.gate-missing', 'matrix.gates', `required gate ${required} is absent`);
        }
      }
      for (const extra of seen) {
        if (!REQUIRED_GATE_IDS.includes(extra)) {
          add('gate.unknown-id', 'matrix.gates', `gate ${extra} is not part of the frozen gate set`);
        }
      }

      // Publication stays outside the automated gate set.
      const publisher = gates.find((gate) => isPlainObject(gate) && gate.id === 'G1');
      if (publisher) {
        if (publisher.automated !== false || publisher.actor !== 'publisher') {
          add('gate.publisher-boundary', 'matrix.gates[G1]', 'G1 must be a non-automated publisher decision');
        }
      }
    }

    const dimensions = Array.isArray(matrix.dimensions) ? matrix.dimensions : null;
    if (!dimensions) {
      add('requirement.dimension-missing', 'matrix.dimensions', 'matrix declares no dimension list');
    } else {
      if (!sameList(dimensions.map((dimension) => dimension?.id), REQUIRED_DIMENSIONS)) {
        add('dimension.invalid-set', 'matrix.dimensions', 'dimensions must equal the eight frozen dimension ids in order');
      }
      if (new Set(dimensions.map((dimension) => dimension?.id)).size !== dimensions.length) {
        add('dimension.duplicate-id', 'matrix.dimensions', 'dimension ids must be unique');
      }
      for (const dimension of dimensions) {
        const id = dimension?.id ?? '<unnamed>';
        if (!isPlainObject(dimension)) {
          add('dimension.malformed', 'matrix.dimensions', 'every dimension must be an object');
          continue;
        }
        if (String(dimension.claim ?? '').trim().length <= MINIMUM_DIMENSION_CLAIM_LENGTH) {
          add('dimension.claim-thin', `matrix.dimensions[${id}].claim`, `dimension ${id} needs a substantive claim`);
        }
        if (dimension.blocking !== true) {
          add('dimension.not-blocking', `matrix.dimensions[${id}].blocking`, `dimension ${id} must block acceptance`);
        }
      }
    }
    for (const required of REQUIRED_DIMENSIONS) {
      if (!Array.isArray(matrix.requiredDimensions) || !matrix.requiredDimensions.includes(required)) {
        add('requirement.dimension-missing', 'matrix.requiredDimensions', `dimension ${required} is not required`);
      }
    }

    if (!sameList(matrix.verdictStates, REQUIRED_VERDICT_STATES)) {
      add('verdict.unknown-state', 'matrix.verdictStates', 'verdict states must equal the six frozen states in order');
    }
    if (!sameList(matrix.requiredVerdictStates, REQUIRED_VERDICT_STATES)) {
      add('requirement.verdict-missing', 'matrix.requiredVerdictStates', 'required verdict states drifted from the frozen set');
    }
    for (const state of Array.isArray(matrix.verdictStates) ? matrix.verdictStates : []) {
      if (!REQUIRED_VERDICT_STATES.includes(state)) {
        add('verdict.unknown-state', 'matrix.verdictStates', `verdict state ${String(state)} is not one of the frozen states`);
      }
    }

    if (!REQUIRED_EVIDENCE_PACK.every((entry) => Array.isArray(matrix.evidencePack) && matrix.evidencePack.includes(entry))) {
      add('matrix.evidence-pack', 'matrix.evidencePack', 'evidence pack must carry the five sealed artefacts');
    }
    if (JSON.stringify(matrix.lockedBoundaries) !== JSON.stringify(REQUIRED_LOCKED_BOUNDARIES)) {
      add('matrix.locked-boundaries', 'matrix.lockedBoundaries', 'locked boundaries must match the frozen product state');
    }
    if (JSON.stringify(matrix.taskForestNodes) !== JSON.stringify(REQUIRED_TASK_FOREST_NODES)) {
      add('matrix.task-forest-nodes', 'matrix.taskForestNodes', 'matrix must bind the frozen Task Forest node ids');
    }

    const evidence = matrix.currentContractEvidence;
    if (!isPlainObject(evidence)) {
      add('evidence.missing', 'matrix.currentContractEvidence', 'the contract must carry its own evidence record');
    } else {
      if (evidence.driven_by !== 'agent') {
        add('evidence.driven-by', 'matrix.currentContractEvidence.driven_by', 'automation must be labelled driven_by: agent');
      }
      if (!nonEmpty(evidence.actor)) {
        add('evidence.actor', 'matrix.currentContractEvidence.actor', 'evidence must name the acting agent');
      }
      if (!REQUIRED_VERDICT_STATES.includes(evidence.verdict)) {
        add('verdict.unknown-state', 'matrix.currentContractEvidence.verdict', 'evidence verdict must be a frozen verdict state');
      }
      if (!nonEmpty(evidence.limitations)) {
        add('evidence.limitations', 'matrix.currentContractEvidence.limitations', 'evidence must state its limitations');
      }
      if (typeof evidence.scope !== 'string' || !evidence.scope.includes('contract')) {
        add('evidence.scope', 'matrix.currentContractEvidence.scope', 'evidence scope must name the contract');
      }
    }

    // A finding with no statement or implication is a requirement with nothing
    // traceable behind it, so it may not stand in for an acceptance requirement.
    if (isPlainObject(sources)) {
      const findings = Array.isArray(sources.findings) ? sources.findings : [];
      if (new Set(findings.map((finding) => finding?.id)).size !== findings.length) {
        add('sources.finding-duplicate-id', 'sources.findings', 'finding ids must be unique');
      }
      for (const finding of findings) {
        const id = isPlainObject(finding) ? String(finding.id ?? '<unnamed>') : '<unnamed>';
        if (!isPlainObject(finding) || !nonEmpty(finding.id) || !nonEmpty(finding.finding) || !nonEmpty(finding.implication)) {
          add('sources.finding-malformed', `sources.findings[${id}]`, `finding ${id} must carry an id, a finding and an implication`);
        }
      }
    }
  }

  // ---- sources ------------------------------------------------------------
  if (!isPlainObject(sources)) {
    add('sources.missing', 'sources', 'source manifest could not be parsed as an object');
  } else {
    if (sources.schemaVersion !== AGENT_FIRST_ACCEPTANCE_RESEARCH_SCHEMA) {
      add('sources.schema-version', 'sources.schemaVersion', `must be ${AGENT_FIRST_ACCEPTANCE_RESEARCH_SCHEMA}`);
    }
    if (sources.driven_by !== 'agent') {
      add('sources.driven-by', 'sources.driven_by', 'research output must be labelled driven_by: agent');
    }
    if (!nonEmpty(sources.actor)) {
      add('sources.actor', 'sources.actor', 'research output must name the acting agent');
    }

    const list = Array.isArray(sources.sources) ? sources.sources : [];
    if (list.length < MINIMUM_SOURCE_COUNT) {
      add('sources.too-few', 'sources.sources', `at least ${MINIMUM_SOURCE_COUNT} sources are required`);
    }
    if (new Set(list.map((source) => source?.id)).size !== list.length) {
      add('sources.duplicate-id', 'sources.sources', 'source ids must be unique');
    }
    if (new Set(list.map((source) => source?.url)).size !== list.length) {
      add('sources.duplicate-url', 'sources.sources', 'source urls must be unique');
    }
    for (const source of list) {
      const id = source?.id ?? '<unnamed>';
      if (typeof source?.url !== 'string' || !source.url.startsWith('https://')) {
        add('sources.insecure-url', `sources.sources[${id}].url`, 'every source needs an https url');
      }
      if (!nonEmpty(source?.title) || !nonEmpty(source?.facts)) {
        add('sources.thin-entry', `sources.sources[${id}]`, 'every source needs a title and at least one fact');
      }
    }
    const families = new Set(list.map((source) => source?.family));
    for (const family of REQUIRED_SOURCE_FAMILIES) {
      if (!families.has(family)) {
        add('sources.family-missing', 'sources.sources', `research track ${family} has no source`);
      }
    }
    for (const family of families) {
      if (!REQUIRED_SOURCE_FAMILIES.includes(family)) {
        add('sources.family-unknown', 'sources.sources', `source family ${String(family)} is not a declared research track`);
      }
    }
    if (list.filter((source) => source?.family === 'agent-era-acceptance').length < MINIMUM_AGENT_ERA_SOURCE_COUNT) {
      add('sources.family-thin', 'sources.sources', `agent-era acceptance needs at least ${MINIMUM_AGENT_ERA_SOURCE_COUNT} sources`);
    }
    if (!Array.isArray(sources.providerRequests)
      || sources.providerRequests.length === 0
      || !sources.providerRequests.every((request) => request?.status === 'success')) {
      add('sources.provider-request-failed', 'sources.providerRequests', 'every recorded research request must have succeeded');
    }
    if (!Array.isArray(sources.findings) || sources.findings.length < MINIMUM_FINDING_COUNT) {
      add('sources.findings-thin', 'sources.findings', `at least ${MINIMUM_FINDING_COUNT} findings are required`);
    }
    if (JSON.stringify(sources.taskForestNodes) !== JSON.stringify(REQUIRED_TASK_FOREST_NODES)) {
      add('sources.task-forest-nodes', 'sources.taskForestNodes', 'source manifest must bind the frozen Task Forest node ids');
    }
  }

  // ---- guide and closeout --------------------------------------------------
  const guideText = String(guide).toLowerCase();
  if (!/^---\r?\nid: agent-first-acceptance\r?\n/.test(String(guide))) {
    add('guide.frontmatter', CONTRACT_PATHS.guide, 'guide must open with its id frontmatter');
  }
  for (const phrase of REQUIRED_GUIDE_PHRASES) {
    if (!guideText.includes(phrase.toLowerCase())) {
      add('guide.required-phrase', CONTRACT_PATHS.guide, `guide must keep the phrase "${phrase}"`);
    }
  }
  for (const statement of REQUIRED_GUIDE_STATEMENTS) {
    if (!String(guide).includes(statement)) {
      add('guide.required-statement', CONTRACT_PATHS.guide, `guide must keep the statement "${statement}"`);
    }
  }
  for (const reference of [CONTRACT_PATHS.guide, 'harness/specs/fixtures/agent-first-acceptance/**']) {
    if (!String(closeout).includes(reference)) {
      add('closeout.reference', CONTRACT_PATHS.closeout, `closeout spec must reference ${reference}`);
    }
  }

  return { violations, counts: countContract(matrix, sources) };
}

/** Structural counts derived from the parsed contract, never from a command. */
export function countContract(matrix, sources) {
  return {
    gates: Array.isArray(matrix?.gates) ? matrix.gates.length : 0,
    dimensions: Array.isArray(matrix?.dimensions) ? matrix.dimensions.length : 0,
    verdictStates: Array.isArray(matrix?.verdictStates) ? matrix.verdictStates.length : 0,
    sources: Array.isArray(sources?.sources) ? sources.sources.length : 0,
    findings: Array.isArray(sources?.findings) ? sources.findings.length : 0,
  };
}

/** Read the four contract files from a checkout root. */
export function loadAgentFirstAcceptanceContractFiles(root = process.cwd()) {
  const read = (relative) => readFileSync(join(root, relative), 'utf8');
  const guideText = read(CONTRACT_PATHS.guide);
  const matrixText = read(CONTRACT_PATHS.matrix);
  const sourcesText = read(CONTRACT_PATHS.sources);
  const closeout = read(CONTRACT_PATHS.closeout);
  return {
    matrix: JSON.parse(matrixText),
    sources: JSON.parse(sourcesText),
    guide: guideText,
    closeout,
  };
}

/**
 * The negative controls the contract must reject.
 *
 * Each control mutates a copy of the real fixture through `mutate` and names the
 * violation code that mutation has to produce. A control that does not produce
 * its code is a defective validator, not a defective fixture, so the caller
 * treats a missing code exactly like a contract violation.
 */
export const NEGATIVE_CONTROLS = Object.freeze([
  {
    id: 'gate-missing-negative',
    requirement: 'a blocking gate without a negative control fails closed',
    expectedCode: 'gate.negative-empty',
    mutate: (draft) => { delete draft.matrix.gates.find((gate) => gate.id === 'B1').negative; },
  },
  {
    id: 'gate-missing-oracle',
    requirement: 'a gate without an oracle fails closed',
    expectedCode: 'gate.oracle-missing',
    mutate: (draft) => { delete draft.matrix.gates.find((gate) => gate.id === 'C1').oracle; },
  },
  {
    id: 'gate-missing-field',
    requirement: 'a gate missing a required field fails closed',
    expectedCode: 'gate.missing-field',
    mutate: (draft) => { delete draft.matrix.gates.find((gate) => gate.id === 'A1').input; },
  },
  {
    id: 'gate-duplicate-id',
    requirement: 'a duplicated gate id fails closed',
    expectedCode: 'gate.duplicate-id',
    mutate: (draft) => { draft.matrix.gates.push({ ...draft.matrix.gates[0] }); },
  },
  {
    id: 'publisher-gate-automated',
    requirement: 'publication cannot be absorbed into the automated gate set',
    expectedCode: 'gate.publisher-boundary',
    mutate: (draft) => { draft.matrix.gates.find((gate) => gate.id === 'G1').automated = true; },
  },
  {
    id: 'requirement-gate-dropped',
    requirement: 'a dropped requirement fails closed',
    expectedCode: 'requirement.gate-missing',
    mutate: (draft) => { draft.matrix.gates = draft.matrix.gates.filter((gate) => gate.id !== 'B3'); },
  },
  {
    id: 'requirement-finding-malformed',
    requirement: 'a research finding with no implication fails closed',
    expectedCode: 'sources.finding-malformed',
    mutate: (draft) => { delete draft.sources.findings[0].implication; },
  },
  {
    id: 'dimension-unknown',
    requirement: 'an invented dimension fails closed',
    expectedCode: 'dimension.invalid-set',
    mutate: (draft) => { draft.matrix.dimensions.find((dimension) => dimension.id === 'runtime').id = 'runtime-maybe'; },
  },
  {
    id: 'dimension-not-blocking',
    requirement: 'a dimension made non-blocking fails closed',
    expectedCode: 'dimension.not-blocking',
    mutate: (draft) => { draft.matrix.dimensions.find((dimension) => dimension.id === 'effect').blocking = false; },
  },
  {
    id: 'verdict-unknown-state',
    requirement: 'an unknown verdict state fails closed',
    expectedCode: 'verdict.unknown-state',
    mutate: (draft) => { draft.matrix.verdictStates.push('probably-fine'); },
  },
  {
    id: 'locked-boundary-opened',
    requirement: 'a contract that pre-approves release or human evidence fails closed',
    expectedCode: 'matrix.locked-boundaries',
    mutate: (draft) => { draft.matrix.lockedBoundaries.humanEvidenceClaimed = true; },
  },
  {
    id: 'source-count-thin',
    requirement: 'a five-case source set is not acceptance-grade evidence',
    expectedCode: 'sources.too-few',
    mutate: (draft) => { draft.sources.sources = draft.sources.sources.slice(0, 5); },
  },
  {
    id: 'provider-request-failed',
    requirement: 'a failed research request fails closed',
    expectedCode: 'sources.provider-request-failed',
    mutate: (draft) => { draft.sources.providerRequests[0].status = 'error'; },
  },
  {
    id: 'guide-human-gate-removed',
    requirement: 'removing the no-first-line-human prohibition fails closed',
    expectedCode: 'guide.required-statement',
    mutate: (draft) => {
      draft.guide = draft.guide.replace('No node may use a human verdict or human-provided data as an open condition.', '');
    },
  },
  {
    id: 'evidence-unlabelled',
    requirement: 'evidence that is not labelled agent-driven fails closed',
    expectedCode: 'evidence.driven-by',
    mutate: (draft) => { draft.matrix.currentContractEvidence.driven_by = 'human'; },
  },
]);

function cloneContract(files) {
  return {
    matrix: structuredClone(files.matrix),
    sources: structuredClone(files.sources),
    guide: files.guide,
    closeout: files.closeout,
  };
}

/**
 * Run every negative control against the real fixture and report, per control,
 * whether the mutation was actually rejected with its expected code.
 */
export function runAgentFirstAcceptanceNegativeControls(files) {
  return NEGATIVE_CONTROLS.map((control) => {
    const draft = cloneContract(files);
    control.mutate(draft);
    const codes = [...new Set(validateAgentFirstAcceptanceContract(draft).violations.map((violation) => violation.code))];
    return {
      id: control.id,
      requirement: control.requirement,
      expectedCode: control.expectedCode,
      rejected: codes.includes(control.expectedCode),
      observedCodes: codes.sort(),
    };
  });
}
