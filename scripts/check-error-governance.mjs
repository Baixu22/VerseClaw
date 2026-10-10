#!/usr/bin/env node
/**
 * Error governance boundary check (GitHub issue #115).
 *
 *   node scripts/check-error-governance.mjs
 *   node scripts/check-error-governance.mjs --json
 *   node scripts/check-error-governance.mjs --surface tests/unit/fixtures/error-governance/surface-auto-approval.json
 *   node scripts/check-error-governance.mjs --record tests/unit/fixtures/error-governance/record-human-prerequisite.md
 *
 * `--surface` deep-merges a JSON override onto the declared block (plain objects
 * merge, arrays and scalars replace, `null` removes the key), which is how the
 * deliberately broken fixtures mutate exactly one governance axis.
 *
 * The rule `harness/specs/rules/error-governance-boundary.md` is prose, and
 * prose is not a gate. This script is the executable half: it reconciles the
 * machine-readable surface block carried by that rule with the real repository
 * facts, so every hard claim in the rule has a check that can actually fail.
 *
 * Reconciled facts (all read from this tree, never duplicated by hand):
 *
 *   - the treated-as-authoritative envelope symbol and its owner files,
 *   - the real `HostErrorCode` union produced by Main (`electron/main/ipc/host-contract.ts`),
 *   - the real closed renderer class set and classifier (`src/lib/error-model.ts`),
 *   - the real waiting/approval unions (`shared/host-api/contract.ts`),
 *   - the scenario wiring (`harness/specs/scenarios/gateway-backend-communication.md`).
 *
 * It also fails closed on a missing/unparsable surface block, on an
 * unresolvable referenced path, and on any human-prerequisite wording.
 *
 * `driven_by: agent` — every input is a file in this repository. The check needs
 * no human verdict, no human data and no human UI step.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The renderer error model is imported rather than re-declared so the check can
// never agree with a copy of the taxonomy that has drifted from the real one.
// Node loads the TypeScript module directly (type stripping). Because the
// repository package.json does not declare `"type": "module"`, Node prints a
// one-line MODULE_TYPELESS_PACKAGE_JSON performance warning on stderr; that is
// expected here, and package.json is intentionally out of this change's scope.
import { APP_ERROR_CODES, mapBackendErrorCode } from '../src/lib/error-model.ts';
import { parseFrontmatter } from '../harness/src/specs.mjs';
import { findMissingReferences } from './validate-policy-docs.mjs';

export const SCHEMA = 'clawx.error-governance.v1';

/** Info string of the fenced block that carries the machine-readable surface. */
export const SURFACE_INFO_STRING = 'json error-governance-surface';

/** The single reused envelope. A second envelope name is a governance failure. */
export const REUSED_ENVELOPE = 'HostResponse';

/** The only error taxonomies an error surface may render. */
export const REUSED_ERROR_TYPES = ['AppError', 'HostErrorCode'];

export const GOVERNANCE_RULE_ID = 'error-governance-boundary';

export const GOVERNANCE_PATHS = {
  rule: 'harness/specs/rules/error-governance-boundary.md',
  record: 'docs/dev/error-governance-decision-record.md',
  scenario: 'harness/specs/scenarios/gateway-backend-communication.md',
  hostContract: 'electron/main/ipc/host-contract.ts',
  hostApiTypes: 'shared/host-api/types.ts',
  hostApiContract: 'shared/host-api/contract.ts',
  hostInvoke: 'electron/main/ipc/host-invoke.ts',
  hostApiClient: 'src/lib/host-api-client.ts',
  errorModel: 'src/lib/error-model.ts',
};

/**
 * Where each reused symbol must really be declared. A surface block may only
 * name symbols that exist in these owners; anything else is a parallel
 * taxonomy, not a surface.
 */
export const REUSED_SYMBOL_OWNERS = {
  HostResponse: ['shared/host-api/types.ts', 'electron/main/ipc/host-contract.ts'],
  AppError: ['src/lib/error-model.ts'],
  HostErrorCode: ['electron/main/ipc/host-contract.ts'],
};

/** The layer-scoped closed code set each error type is allowed to surface. */
export const ERROR_TYPE_CODE_SETS = {
  AppError: 'renderer',
  HostErrorCode: 'main',
};

/**
 * Declared gaps are claims about the current tree, so each one needs a probe
 * that reads the tree. A declared gap whose defect has been fixed is stale and
 * fails the check, exactly like an undeclared defect.
 */
export const GAP_PROBES = {
  'duplicate-host-response-copies': {
    evidence: 'shared/host-api/types.ts',
    isOpen(root) {
      return declaresSymbol(readTextIfFile(root, 'shared/host-api/types.ts') ?? '', 'HostResponse')
        && declaresSymbol(readTextIfFile(root, 'electron/main/ipc/host-contract.ts') ?? '', 'HostResponse');
    },
  },
  'duplicate-app-error-code-unions': {
    evidence: 'electron/main/ipc/request-helpers.ts',
    isOpen(root) {
      return declaresSymbol(readTextIfFile(root, 'src/lib/error-model.ts') ?? '', 'AppErrorCode')
        && declaresSymbol(readTextIfFile(root, 'electron/main/ipc/request-helpers.ts') ?? '', 'AppErrorCode');
    },
  },
};

/** Prose anchors the decision record and the rule must keep. */
export const RECORD_ANCHORS = [
  'HostResponse',
  'AppError',
  'shared/host-api/types.ts',
  'electron/main/ipc/host-contract.ts',
  'src/lib/error-model.ts',
  'driven_by: agent',
];

export const RECORD_STATE_LABELS = ['existing', 'gap', 'proposal'];

/**
 * The record must keep the semantics issue #115 flagged as unresolved apart:
 * the two identifiers, the stable per-layer code sets, and the five retry-ish
 * situations. Matching is case-insensitive.
 */
export const RECORD_DISAMBIGUATION_ANCHORS = [
  'requestId',
  'HostErrorCode',
  'APP_ERROR_CODES',
  'recoverability',
  'replay',
  'cooldown',
  'FailoverError',
  'independent consumer',
  'deprecation',
];

/** Prose anchors that are only expressible as a pattern. */
export const RECORD_REGEX_ANCHORS = [
  { id: 'no-third-envelope', pattern: /no third envelope|must not create a (?:third|second) envelope/i },
  { id: 'provider-request-id', pattern: /provider[- ](?:side[- ])?request ?id/i },
];

export const RULE_EXECUTABLE_ANCHORS = [
  'node scripts/check-error-governance.mjs',
  'tests/unit/error-governance-boundary.test.ts',
  'harness/specs/scenarios/gateway-backend-communication.md',
];

/**
 * Human-prerequisite wording. Line level: a match is only a finding when the
 * same line carries no negation, so a rule may *forbid* human prerequisites.
 */
export const HUMAN_PREREQUISITE_PATTERNS = [
  { id: 'real-human', pattern: /\breal[- ]human\b/i },
  { id: 'human-verdict', pattern: /\bhuman verdict\b/i },
  { id: 'human-gated-step', pattern: /\b(?:requires?|needs?|awaits?|awaiting|waits?|waiting)\s+(?:for\s+)?(?:a\s+|the\s+)?human\b/i },
  { id: 'human-actor', pattern: /\bhuman (?:operator|reviewer|approver|tester|step|input|data|decision|approval|verdict|sign-?off)\b/i },
  { id: 'zh-human-prerequisite', pattern: /真人|人工(?:审批|确认|判定|操作|验收)/ },
  { id: 'manual-person-approval', pattern: /\bmanual(?:ly)? (?:approved|reviewed|verified|confirmed) by (?:a )?(?:person|human|user)\b/i },
];

export const HUMAN_PREREQUISITE_NEGATIONS = [
  /\bno\b/i,
  /\bnot\b/i,
  /\bnever\b/i,
  /\bwithout\b/i,
  /\bcannot\b/i,
  /\bforbid/i,
  /\bprohibit/i,
  /\bremove[sd]?\b/i,
  /不得/,
  /无需/,
  /禁止/,
  /不要求/,
];

/**
 * Decision returned for anything the declared waiting taxonomy does not
 * recognize. Fail closed: hold the request, never auto-approve, never execute.
 */
export const WAITING_DECISION_FALLBACK = Object.freeze({
  recognized: false,
  decision: 'hold',
  autoApprove: false,
  executedAction: null,
  effectsAllowed: false,
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function readTextIfFile(root, target) {
  const absolute = isAbsolute(target) ? target : join(root, target);
  try {
    if (!statSync(absolute).isFile()) return null;
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Deep-merge a surface override onto the declared block. Plain objects merge,
 * arrays and scalars replace, and a `null` value removes the key. Used by the
 * `--surface` fixtures and by unit tests to mutate exactly one governance axis
 * at a time.
 */
export function mergeSurface(base, override) {
  if (!isPlainObject(override)) return override;
  const merged = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? mergeSurface(merged[key], value)
      : value;
  }
  return merged;
}

/** Extract the machine-readable surface block; `null` when it is absent. */
export function extractSurfaceBlock(ruleText) {
  const pattern = new RegExp('```' + SURFACE_INFO_STRING + '\\s*\\n([\\s\\S]*?)\\n```');
  const match = pattern.exec(String(ruleText ?? ''));
  if (!match) return null;
  return JSON.parse(match[1]);
}

/** The real Main-process host error codes. */
export function parseHostErrorCodes(hostContractText) {
  const match = /export type HostErrorCode\s*=\s*([^;]+);/.exec(String(hostContractText ?? ''));
  if (!match) return [];
  return [...match[1].matchAll(/'([A-Za-z_]+)'/g)].map((entry) => entry[1]);
}

/** The real waiting/approval unions carried by the host-api contract. */
export function parseWaitingTypes(contractText) {
  const text = String(contractText ?? '');
  const statusMatch = /export type AgentBrowserTaskStatus\s*=\s*([\s\S]*?);/.exec(text);
  const approvalMatch = /export type AgentBrowserTaskApproval\s*=\s*\{[\s\S]*?status:\s*([^;]+);/.exec(text);
  return {
    waitingStatus: statusMatch ? [...statusMatch[1].matchAll(/'([a-z][a-z-]*)'/g)].map((entry) => entry[1]) : [],
    approvalType: approvalMatch ? [...approvalMatch[1].matchAll(/'([a-z][a-z-]*)'/g)].map((entry) => entry[1]) : [],
  };
}

/** True when `symbol` is really declared in `text`. */
export function declaresSymbol(text, symbol) {
  return new RegExp(`export (?:type|class|const|interface) ${symbol}\\b`).test(String(text ?? ''));
}

/**
 * Resolve the automated decision for a waiting/approval descriptor.
 *
 * The two unions are looked up in the declared taxonomy. Anything not declared
 * — an unknown approval type, an unknown waiting status, a non-string, a missing
 * field, or a prototype key — is held: no auto-approval, no executed action.
 */
export function resolveWaitingDecision(descriptor = {}, waitingTypes = {}) {
  const approvalTable = isPlainObject(waitingTypes?.approvalType) ? waitingTypes.approvalType : {};
  const statusTable = isPlainObject(waitingTypes?.waitingStatus) ? waitingTypes.waitingStatus : {};
  const approvalType = descriptor?.approvalType;
  const waitingStatus = descriptor?.waitingStatus;

  if (typeof approvalType !== 'string' || !hasOwn(approvalTable, approvalType)) {
    return { ...WAITING_DECISION_FALLBACK, reason: 'unrecognized-approval-type', approvalType: approvalType ?? null };
  }
  if (typeof waitingStatus !== 'string' || !hasOwn(statusTable, waitingStatus)) {
    return { ...WAITING_DECISION_FALLBACK, reason: 'unrecognized-waiting-status', waitingStatus: waitingStatus ?? null };
  }

  const approval = isPlainObject(approvalTable[approvalType]) ? approvalTable[approvalType] : {};
  const status = isPlainObject(statusTable[waitingStatus]) ? statusTable[waitingStatus] : {};
  const executesOnce = approval.decision === 'execute-once';
  const executedAction = executesOnce ? approval.executedAction ?? null : null;
  const effectsAllowed = executesOnce
    && status.waiting !== true
    && status.effectsAllowed === true
    && executedAction !== null;

  return {
    recognized: true,
    approvalType,
    waitingStatus,
    decision: approval.decision ?? 'hold',
    autoApprove: approval.autoApprove === true,
    executedAction,
    effectsAllowed,
  };
}

/** Line-level human-prerequisite scan with negation awareness. */
export function findHumanPrerequisites(text) {
  const found = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { id, pattern } of HUMAN_PREREQUISITE_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (HUMAN_PREREQUISITE_NEGATIONS.some((negation) => negation.test(line))) continue;
      found.push({
        code: 'error-governance.human-prerequisite',
        id,
        line: index + 1,
        text: match[0],
        message: `line ${index + 1} makes a human prerequisite a requirement ("${match[0]}", ${id}); automation must not gate on a human`,
      });
    }
  }
  return found;
}

/**
 * Finding object. `extra` must never carry a `code` key: the finding `code` is
 * the stable governance code that tests and fixtures assert on, so host error
 * codes travel as `hostErrorCode`.
 */
function checkEntry(code, message, extra = {}) {
  return { code, message, ...extra };
}

function pushCheck(checks, findings, id, description, entries) {
  for (const entry of entries) findings.push({ check: id, ...entry });
  checks.push({
    id,
    description,
    status: entries.length === 0 ? 'pass' : 'fail',
    findings: entries.map((entry) => entry.message),
  });
}

/**
 * Build the fail-closed error governance report.
 *
 * @param {{
 *   root?: string,
 *   rulePath?: string,
 *   recordPath?: string,
 *   scenarioPath?: string,
 *   hostContractPath?: string,
 *   hostApiTypesPath?: string,
 *   errorModelPath?: string,
 *   surface?: object,
 * }} options
 */
export function validateErrorGovernance(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const paths = {
    rule: options.rulePath ?? GOVERNANCE_PATHS.rule,
    record: options.recordPath ?? GOVERNANCE_PATHS.record,
    scenario: options.scenarioPath ?? GOVERNANCE_PATHS.scenario,
    hostContract: options.hostContractPath ?? GOVERNANCE_PATHS.hostContract,
    hostApiTypes: options.hostApiTypesPath ?? GOVERNANCE_PATHS.hostApiTypes,
    hostApiContract: options.hostApiContractPath ?? GOVERNANCE_PATHS.hostApiContract,
    errorModel: options.errorModelPath ?? GOVERNANCE_PATHS.errorModel,
  };

  const checks = [];
  const findings = [];
  const inputs = {};
  const contents = {};
  for (const [key, target] of Object.entries(paths)) {
    const text = readTextIfFile(root, target);
    if (text === null) {
      inputs[key] = { path: target, present: false };
      continue;
    }
    contents[key] = text;
    inputs[key] = { path: target, present: true, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) };
  }

  // --- Surface block: fail closed when the rule cannot be read ---------------
  let surface = null;
  let declaredGapIds = [];
  if (contents.rule === undefined) {
    pushCheck(checks, findings, 'governance-inputs-present', 'Rule, decision record and source inputs are readable', [
      checkEntry('error-governance.governance-input-missing', `${paths.rule} is missing; an unchecked rule is not a satisfied rule`),
    ]);
  } else {
    try {
      const declared = extractSurfaceBlock(contents.rule);
      if (declared === null) {
        pushCheck(checks, findings, 'surface-block-present', 'The rule carries a machine-readable error surface block', [
          checkEntry('error-governance.surface-block-missing', `${paths.rule} does not carry a \`${SURFACE_INFO_STRING}\` block`),
        ]);
      } else {
        surface = options.surface === undefined ? declared : mergeSurface(declared, options.surface);
        pushCheck(checks, findings, 'surface-block-present', 'The rule carries a machine-readable error surface block', []);
      }
    } catch (error) {
      pushCheck(checks, findings, 'surface-block-present', 'The rule carries a machine-readable error surface block', [
        checkEntry('error-governance.surface-block-unparsable', `${paths.rule}: surface block is not valid JSON (${error.message})`),
      ]);
    }
  }

  if (contents.record === undefined) {
    pushCheck(checks, findings, 'decision-record-present', 'The decision record exists', [
      checkEntry('error-governance.missing-anchor', `${paths.record} is missing`),
    ]);
  }

  const hostCodes = parseHostErrorCodes(contents.hostContract ?? '');
  const realWaiting = parseWaitingTypes(contents.hostApiContract ?? '');

  if (surface) {
    // --- Envelope / error type reuse: no third envelope, no second taxonomy --
    const envelopeEntries = [];
    const envelope = isPlainObject(surface.envelope) ? surface.envelope : {};
    const envelopeSymbol = envelope.symbol;
    if (envelopeSymbol !== REUSED_ENVELOPE) {
      envelopeEntries.push(checkEntry(
        'error-governance.parallel-envelope',
        `declared envelope "${String(envelopeSymbol)}" is not the reused ${REUSED_ENVELOPE}; a third envelope must not be created`,
      ));
    }
    const allowedErrorTypes = Array.isArray(surface.allowedErrorTypes) ? surface.allowedErrorTypes : [];
    if (allowedErrorTypes.length !== REUSED_ERROR_TYPES.length
      || !REUSED_ERROR_TYPES.every((entry) => allowedErrorTypes.includes(entry))) {
      envelopeEntries.push(checkEntry(
        'error-governance.parallel-error-type',
        `allowedErrorTypes ${JSON.stringify(allowedErrorTypes)} must be exactly ${JSON.stringify(REUSED_ERROR_TYPES)}`,
      ));
    }
    for (const symbol of [envelopeSymbol, ...allowedErrorTypes].filter((entry) => typeof entry === 'string')) {
      const owners = REUSED_SYMBOL_OWNERS[symbol];
      if (!owners) {
        envelopeEntries.push(checkEntry(
          'error-governance.parallel-error-type',
          `symbol "${symbol}" is not a reused repository error type`,
        ));
        continue;
      }
      for (const owner of owners) {
        const ownerText = readTextIfFile(root, owner);
        const code = owner.endsWith('host-contract.ts') ? 'error-governance.parallel-envelope' : 'error-governance.parallel-error-type';
        if (ownerText === null) {
          envelopeEntries.push(checkEntry(code, `declared owner ${owner} of "${symbol}" does not exist`));
        } else if (!declaresSymbol(ownerText, symbol)) {
          envelopeEntries.push(checkEntry(code, `${owner} does not declare "${symbol}"`));
        }
      }
    }
    pushCheck(
      checks,
      findings,
      'error-envelope-reused',
      'One reused envelope and the existing error taxonomies',
      envelopeEntries,
    );

    // --- Host error code mapping completeness -------------------------------
    const mappingEntries = [];
    const mappings = Array.isArray(surface.hostErrorCodeMappings) ? surface.hostErrorCodeMappings : [];
    const declaredCodes = mappings.map((entry) => entry?.code);
    if (hostCodes.length === 0) {
      mappingEntries.push(checkEntry(
        'error-governance.missing-error-mapping',
        `${paths.hostContract}: no HostErrorCode union could be parsed; the mapping table cannot be verified`,
      ));
    }
    for (const code of hostCodes) {
      if (!declaredCodes.includes(code)) {
        mappingEntries.push(checkEntry(
          'error-governance.missing-error-mapping',
          `Main-process error code ${code} has no declared renderer mapping`,
          { hostErrorCode: code },
        ));
      }
    }
    for (const code of declaredCodes) {
      if (!hostCodes.includes(code)) {
        mappingEntries.push(checkEntry(
          'error-governance.missing-error-mapping',
          `declared mapping ${String(code)} is not a real HostErrorCode`,
          { hostErrorCode: code },
        ));
      }
    }
    for (const code of new Set(declaredCodes.filter((entry) => declaredCodes.indexOf(entry) !== declaredCodes.lastIndexOf(entry)))) {
      mappingEntries.push(checkEntry(
        'error-governance.missing-error-mapping',
        `Main-process error code ${String(code)} is mapped more than once`,
        { code },
      ));
    }
    pushCheck(
      checks,
      findings,
      'host-error-code-mapping-complete',
      'Every real Main-process error code is mapped exactly once',
      mappingEntries,
    );

    // --- Mapping agrees with the real classifier, gaps stay declared --------
    const driftEntries = [];
    const declaredUnknownMappings = Array.isArray(surface.declaredUnknownMappings) ? surface.declaredUnknownMappings : [];
    const gapCodes = declaredUnknownMappings.map((entry) => entry?.code);
    for (const mapping of mappings) {
      const code = mapping?.code;
      const rendererClass = mapping?.rendererClass;
      if (typeof rendererClass !== 'string' || !APP_ERROR_CODES.includes(rendererClass)) {
        driftEntries.push(checkEntry(
          'error-governance.out-of-range-error-surface',
          `mapping ${String(code)} renders "${String(rendererClass)}", which is outside the closed class set in ${paths.errorModel}`,
          { hostErrorCode: code },
        ));
        continue;
      }
      const realClass = mapBackendErrorCode(typeof code === 'string' ? code : undefined);
      if (realClass === 'UNKNOWN') {
        if (rendererClass !== 'UNKNOWN' || !gapCodes.includes(code)) {
          driftEntries.push(checkEntry(
            'error-governance.undeclared-unknown-mapping',
            `mapping ${String(code)} has no dedicated renderer class; it must be declared as UNKNOWN and listed in declaredUnknownMappings`,
            { hostErrorCode: code },
          ));
        }
        continue;
      }
      if (rendererClass !== realClass) {
        driftEntries.push(checkEntry(
          'error-governance.error-mapping-drift',
          `mapping ${String(code)} declares "${rendererClass}" but ${paths.errorModel} classifies it as "${realClass}"`,
          { hostErrorCode: code },
        ));
      }
    }
    for (const gap of declaredUnknownMappings) {
      if (!declaredCodes.includes(gap?.code)) {
        driftEntries.push(checkEntry(
          'error-governance.undeclared-unknown-mapping',
          `declaredUnknownMappings entry ${String(gap?.code)} has no mapping row`,
          { hostErrorCode: gap?.code },
        ));
      }
    }
    pushCheck(
      checks,
      findings,
      'error-mapping-matches-classifier',
      'Declared mappings match the real classifier and declare their gaps',
      driftEntries,
    );

    // --- Declared gaps must match the tree in both directions --------------
    const gapEntries = [];
    const declaredGaps = Array.isArray(surface.declaredGaps) ? surface.declaredGaps : [];
    declaredGapIds = declaredGaps.map((entry) => entry?.id).filter((entry) => typeof entry === 'string');
    for (const [id, probe] of Object.entries(GAP_PROBES)) {
      const declared = declaredGaps.find((entry) => entry?.probe === id);
      const open = probe.isOpen(root);
      if (open && !declared) {
        gapEntries.push(checkEntry(
          'error-governance.undeclared-gap',
          `gap probe "${id}" is still open in ${probe.evidence} but is not declared as a gap`,
          { gap: id },
        ));
      }
      if (!open && declared) {
        gapEntries.push(checkEntry(
          'error-governance.stale-declared-gap',
          `gap "${declared.id}" is declared but no longer reproduces in ${probe.evidence}`,
          { gap: id },
        ));
      }
    }
    for (const gap of declaredGaps) {
      if (typeof gap?.id !== 'string' || !gap.id.trim()) {
        gapEntries.push(checkEntry('error-governance.unverifiable-declared-gap', 'a declared gap has no id'));
        continue;
      }
      if (!hasOwn(GAP_PROBES, gap.probe ?? '')) {
        gapEntries.push(checkEntry(
          'error-governance.unverifiable-declared-gap',
          `declared gap "${gap.id}" has no executable probe; an unverifiable claim is a promise, not a decision`,
          { gap: gap.id },
        ));
      }
      if (typeof gap.evidence !== 'string' || readTextIfFile(root, gap.evidence) === null) {
        gapEntries.push(checkEntry(
          'error-governance.missing-gap-evidence',
          `declared gap "${gap.id}" names evidence "${String(gap.evidence)}", which does not exist`,
          { gap: gap.id },
        ));
      }
    }
    pushCheck(
      checks,
      findings,
      'declared-gaps-match-tree',
      'Every declared gap is still reproducible and carries existing evidence',
      gapEntries,
    );

    // --- Correlation id: generated in the renderer, echoed by Main ----------
    const correlationEntries = [];
    const clientText = readTextIfFile(root, GOVERNANCE_PATHS.hostApiClient) ?? '';
    const invokeText = readTextIfFile(root, GOVERNANCE_PATHS.hostInvoke) ?? '';
    if (!/createRequestId\s*\(/.test(clientText)) {
      correlationEntries.push(checkEntry(
        'error-governance.correlation-id-missing',
        `${paths.hostApiClient} no longer generates a per-request correlation id`,
      ));
    }
    if (!/\bid:\s*request\.id\b/.test(invokeText)) {
      correlationEntries.push(checkEntry(
        'error-governance.correlation-id-missing',
        `${GOVERNANCE_PATHS.hostInvoke} no longer echoes the request correlation id`,
      ));
    }
    pushCheck(
      checks,
      findings,
      'request-id-attribution',
      'The local correlation id is still generated in the renderer and echoed by Main',
      correlationEntries,
    );

    const surfaceEntries = [];
    const surfaces = Array.isArray(surface.errorSurfaces) ? surface.errorSurfaces : [];
    const seenSurfaceIds = new Set();
    if (surfaces.length === 0) {
      surfaceEntries.push(checkEntry(
        'error-governance.missing-error-surface-owner',
        'no error surface is declared; the closed error surface cannot be verified',
      ));
    }
    for (const entry of surfaces) {
      const id = entry?.id;
      if (typeof id !== 'string' || !id.trim()) {
        surfaceEntries.push(checkEntry('error-governance.missing-error-surface-owner', 'an error surface has no id'));
        continue;
      }
      if (seenSurfaceIds.has(id)) {
        surfaceEntries.push(checkEntry('error-governance.missing-error-surface-owner', `error surface id "${id}" is declared twice`));
      }
      seenSurfaceIds.add(id);
      if (entry.envelope !== envelopeSymbol) {
        surfaceEntries.push(checkEntry(
          'error-governance.parallel-envelope',
          `error surface "${id}" declares envelope "${String(entry.envelope)}" instead of "${String(envelopeSymbol)}"`,
        ));
      }
      const symbol = entry.errorTypeSymbol;
      const layer = ERROR_TYPE_CODE_SETS[symbol];
      if (!layer || !REUSED_ERROR_TYPES.includes(symbol)) {
        surfaceEntries.push(checkEntry(
          'error-governance.parallel-error-type',
          `error surface "${id}" declares error type "${String(symbol)}", which is not one of ${JSON.stringify(REUSED_ERROR_TYPES)}`,
        ));
        continue;
      }
      const ownerText = typeof entry.owner === 'string' ? readTextIfFile(root, entry.owner) : null;
      if (ownerText === null) {
        surfaceEntries.push(checkEntry(
          'error-governance.missing-error-surface-owner',
          `error surface "${id}" names owner "${String(entry.owner)}", which does not exist`,
        ));
      }
      const closedSet = layer === 'renderer' ? [...APP_ERROR_CODES] : hostCodes;
      for (const code of Array.isArray(entry.codes) ? entry.codes : []) {
        if (!closedSet.includes(code)) {
          surfaceEntries.push(checkEntry(
            'error-governance.out-of-range-error-surface',
            `error surface "${id}" renders "${String(code)}", which is outside the ${layer} closed set`,
          ));
        }
      }
    }
    pushCheck(
      checks,
      findings,
      'error-surfaces-in-range',
      'Every declared error surface stays inside a closed, real code set',
      surfaceEntries,
    );

    // --- Waiting / approval taxonomy: coverage and no auto-approval --------
    const waitingTypes = isPlainObject(surface.waitingTypes) ? surface.waitingTypes : {};
    const coverageEntries = [];
    for (const [union, expected] of [['approvalType', realWaiting.approvalType], ['waitingStatus', realWaiting.waitingStatus]]) {
      const declaredTable = isPlainObject(waitingTypes[union]) ? waitingTypes[union] : {};
      const declaredKeys = Object.keys(declaredTable);
      if (expected.length === 0) {
        coverageEntries.push(checkEntry(
          'error-governance.missing-waiting-type',
          `no real ${union} union could be parsed from ${paths.hostApiContract}; the taxonomy cannot be verified`,
        ));
        continue;
      }
      for (const member of expected) {
        if (!declaredKeys.includes(member)) {
          coverageEntries.push(checkEntry(
            'error-governance.missing-waiting-type',
            `${union} "${member}" exists in ${paths.hostApiContract} but has no declared decision; an undeclared waiting type must never be auto-approved`,
            { union, member },
          ));
        }
      }
      for (const member of declaredKeys) {
        if (!expected.includes(member)) {
          coverageEntries.push(checkEntry(
            'error-governance.unknown-waiting-type',
            `${union} "${member}" is declared but does not exist in ${paths.hostApiContract}`,
            { union, member },
          ));
        }
      }
    }
    pushCheck(
      checks,
      findings,
      'waiting-type-coverage',
      'The declared waiting/approval taxonomy covers the real unions',
      coverageEntries,
    );

    const decisionEntries = [];
    for (const [union, table] of [['approvalType', waitingTypes.approvalType], ['waitingStatus', waitingTypes.waitingStatus]]) {
      if (!isPlainObject(table)) continue;
      for (const [member, entry] of Object.entries(table)) {
        if (!isPlainObject(entry)) {
          decisionEntries.push(checkEntry(
            'error-governance.auto-approval-declared',
            `${union} "${member}" has no decision object`,
          ));
          continue;
        }
        if (union === 'approvalType') {
          if (entry.autoApprove === true) {
            decisionEntries.push(checkEntry(
              'error-governance.auto-approval-declared',
              `approvalType "${member}" declares autoApprove: true; automation must never auto-approve a waiting request`,
              { union, member },
            ));
          }
          const action = entry.executedAction ?? null;
          if (action !== null && entry.decision !== 'execute-once') {
            decisionEntries.push(checkEntry(
              'error-governance.executed-action-without-decision',
              `approvalType "${member}" declares executedAction "${String(action)}" without decision "execute-once"`,
              { union, member },
            ));
          }
        }
        if (union === 'waitingStatus' && entry.waiting === true && entry.effectsAllowed === true) {
          decisionEntries.push(checkEntry(
            'error-governance.effects-during-wait',
            `waitingStatus "${member}" is a waiting state that still allows effects`,
            { union, member },
          ));
        }
      }
    }
    pushCheck(
      checks,
      findings,
      'no-auto-approval',
      'No waiting/approval type may be auto-approved or execute during a wait',
      decisionEntries,
    );
  }

  // --- Prose hygiene: no human prerequisite, no missing claim --------------
  const proseTargets = [
    ['rule', paths.rule, contents.rule],
    ['record', paths.record, contents.record],
    ['scenario', paths.scenario, contents.scenario],
  ].filter(([, , text]) => typeof text === 'string');

  const humanEntries = [];
  for (const [key, target, text] of proseTargets) {
    for (const found of findHumanPrerequisites(text)) {
      humanEntries.push(checkEntry(found.code, `${target}:${found.line} ${found.message}`, { path: target }));
    }
  }
  pushCheck(
    checks,
    findings,
    'no-human-prerequisite',
    'No governance artifact gates on a human verdict, human data or a human step',
    humanEntries,
  );

  const labelEntries = [];
  for (const [key, target, text] of proseTargets) {
    if (!/driven_by:\s*agent/.test(text)) {
      labelEntries.push(checkEntry(
        'error-governance.missing-agent-driven-label',
        `${target}: missing "driven_by: agent"; automated evidence must never be labelled as real-human`,
        { path: target },
      ));
    }
  }
  pushCheck(
    checks,
    findings,
    'agent-driven-labelling',
    'Every governance artifact is labelled agent-driven',
    labelEntries,
  );

  const recordEntries = [];
  if (typeof contents.record === 'string') {
    for (const anchor of [...RECORD_ANCHORS, ...declaredGapIds]) {
      if (!contents.record.includes(anchor)) {
        recordEntries.push(checkEntry(
          'error-governance.missing-anchor',
          `${paths.record}: missing required anchor "${anchor}"`,
        ));
      }
    }
    for (const anchor of RECORD_REGEX_ANCHORS) {
      if (!anchor.pattern.test(contents.record)) {
        recordEntries.push(checkEntry(
          'error-governance.missing-anchor',
          `${paths.record}: missing required statement "${anchor.id}"`,
        ));
      }
    }
    for (const label of RECORD_STATE_LABELS) {
      if (!contents.record.toLowerCase().includes(label)) {
        recordEntries.push(checkEntry(
          'error-governance.missing-anchor',
          `${paths.record}: missing decision state label "${label}"`,
        ));
      }
    }
  }
  pushCheck(
    checks,
    findings,
    'decision-record-anchors',
    'The decision record states the reuse, the states and the absence of a third envelope',
    recordEntries,
  );

  const disambiguationEntries = [];
  if (typeof contents.record === 'string') {
    const normalized = contents.record.toLowerCase();
    for (const anchor of RECORD_DISAMBIGUATION_ANCHORS) {
      if (!normalized.includes(anchor.toLowerCase())) {
        disambiguationEntries.push(checkEntry(
          'error-governance.missing-anchor',
          `${paths.record}: does not separate the semantics of "${anchor}"; the record must not collapse these cases`,
        ));
      }
    }
  }
  pushCheck(
    checks,
    findings,
    'record-disambiguation-anchors',
    'The record keeps the flagged semantics apart instead of merging them',
    disambiguationEntries,
  );

  const executableEntries = [];
  if (typeof contents.rule === 'string') {
    for (const anchor of RULE_EXECUTABLE_ANCHORS) {
      if (!contents.rule.includes(anchor)) {
        executableEntries.push(checkEntry(
          'error-governance.missing-executable-check',
          `${paths.rule}: hard claim does not name its executable check (missing "${anchor}")`,
        ));
      }
    }
  }
  pushCheck(
    checks,
    findings,
    'rule-names-executable-checks',
    'Every hard claim in the rule names a real executable check',
    executableEntries,
  );

  const referenceEntries = [];
  for (const [key, target, text] of proseTargets) {
    for (const reference of findMissingReferences(text, { root, docPath: target })) {
      referenceEntries.push(checkEntry(
        'error-governance.missing-reference',
        `${target}: referenced path does not exist: ${reference}`,
        { path: target },
      ));
    }
  }
  pushCheck(
    checks,
    findings,
    'governance-references-resolve',
    'Every repository path named by the governance artifacts exists',
    referenceEntries,
  );

  const wiringEntries = [];
  if (typeof contents.scenario === 'string') {
    let scenarioData = null;
    try {
      scenarioData = parseFrontmatter(contents.scenario).data;
    } catch (error) {
      wiringEntries.push(checkEntry(
        'error-governance.scenario-rule-not-wired',
        `${paths.scenario}: frontmatter is unreadable (${error.message})`,
      ));
    }
    if (scenarioData) {
      const requiredRules = Array.isArray(scenarioData.requiredRules) ? scenarioData.requiredRules : [];
      if (!requiredRules.includes(GOVERNANCE_RULE_ID)) {
        wiringEntries.push(checkEntry(
          'error-governance.scenario-rule-not-wired',
          `${paths.scenario}: requiredRules must include "${GOVERNANCE_RULE_ID}"`,
        ));
      }
    }
  }
  if (typeof contents.rule === 'string') {
    try {
      const ruleData = parseFrontmatter(contents.rule).data;
      const appliesTo = Array.isArray(ruleData.appliesTo) ? ruleData.appliesTo : [];
      if (!appliesTo.includes('gateway-backend-communication')) {
        wiringEntries.push(checkEntry(
          'error-governance.scenario-rule-not-wired',
          `${paths.rule}: appliesTo must include "gateway-backend-communication"`,
        ));
      }
      if (ruleData.id !== GOVERNANCE_RULE_ID) {
        wiringEntries.push(checkEntry(
          'error-governance.scenario-rule-not-wired',
          `${paths.rule}: frontmatter id must be "${GOVERNANCE_RULE_ID}"`,
        ));
      }
    } catch (error) {
      wiringEntries.push(checkEntry(
        'error-governance.scenario-rule-not-wired',
        `${paths.rule}: frontmatter is unreadable (${error.message})`,
      ));
    }
  }
  pushCheck(
    checks,
    findings,
    'scenario-wiring',
    'The rule is wired into the gateway-backend-communication scenario',
    wiringEntries,
  );

  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    drivenBy: 'agent',
    root,
    inputs,
    checks,
    findings,
    result: checks.every((entry) => entry.status === 'pass') ? 'pass' : 'fail',
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' || arg === '--rule' || arg === '--record' || arg === '--out' || arg === '--surface') {
      args[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? resolve(args.root) : process.cwd();
  const options = { root, rulePath: args.rule, recordPath: args.record };
  if (args.surface) {
    const surfaceText = readTextIfFile(root, args.surface);
    if (surfaceText === null) {
      console.error(`[error-governance] FAIL: --surface ${args.surface} does not exist`);
      process.exitCode = 1;
      return;
    }
    try {
      options.surface = JSON.parse(surfaceText);
    } catch (error) {
      console.error(`[error-governance] FAIL: --surface ${args.surface} is not valid JSON (${error.message})`);
      process.exitCode = 1;
      return;
    }
  }

  const report = validateErrorGovernance(options);

  if (args.out) {
    const outPath = resolve(root, args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  const failed = report.checks.filter((entry) => entry.status === 'fail');
  if (args._.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    for (const entry of report.checks) {
      console.log(`[error-governance] ${entry.status.toUpperCase()} ${entry.id}`);
      for (const finding of entry.findings) console.log(`  - ${finding}`);
    }
    if (args.out) console.log(`[error-governance] report: ${resolve(root, args.out)}`);
  }

  if (failed.length > 0) {
    console.error(`[error-governance] FAIL: ${failed.length} check(s) failed, ${report.findings.length} finding(s)`);
    process.exitCode = 1;
    return;
  }
  if (!args.quiet) console.log(`[error-governance] PASS: ${report.checks.length} checks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
