#!/usr/bin/env node

import { isMainEntrypoint } from './lib/entrypoint.mjs';

// Deterministic cross-registry check for the semantic authority rulings of
// docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md (TF-0631), as
// contracted by harness/specs/tasks/architecture-skeleton-authority-validator.md
// (TF-0632). The six registries are executed, not regex-parsed; both built-in
// registry validators are run and passed through; every ruling is read from
// the adjudication registry and nothing passes silently.

const DIAGNOSTIC_FAMILY = 'semantic-authority';
const RULES = Object.freeze([
  'registry-self-validation',
  'identity-key',
  'concept-alias',
  'owner-namespace',
  'flag-binding',
  'default-activation',
  'default-retirement',
  'default-matrix-row',
  'default-flag-risk',
  'authority-boundary',
  'gap-registration',
  'exemption-reason-missing',
  'exemption-stale',
  'exemption-unknown-rule',
  'exemption-unknown-target',
  'adjudication-missing',
  'registry-load-failed',
]);
const RULE_SET = new Set(RULES);

const REGISTRY_PATHS = Object.freeze({
  authority: 'shared/component-authority-manifest.ts',
  disposition: 'shared/dcs/component-disposition-catalog.ts',
  claims: 'shared/capability-claims.ts',
  reliability: 'shared/reliability-boundaries.ts',
  sensitive: 'shared/sensitive-content-boundary.ts',
  semantics: 'shared/product-semantics.ts',
  flags: 'shared/dcs/prod-flags-catalog.ts',
});
// Inputs of the disposition catalog's own validator, same sources as
// tests/unit/component-disposition-catalog.test.ts, plus the two documents the
// authority manifest links to.
const INPUT_PATHS = Object.freeze({
  runtimeLeaves: 'openclaw_runtime/src/config/runtime-feature-leaves.ts',
  settingsRoutes: 'src/pages/Settings/route-config.ts',
  settingsPanelsDir: 'src/components/settings',
  app: 'src/App.tsx',
  nodeIds: 'tests/fixtures/component-graduation/task-forest-node-ids.json',
  defaultMatrix: 'docs/dev/default-config-matrix.md',
  productSurfaces: 'docs/clawx-product-semantics.md',
});
const DISPOSITION_VALIDATION_NOW = '2026-10-21T00:00:00.000Z';
const ADJUDICATION_PATH = 'scripts/check-semantic-authority-adjudication.json';
const ADJUDICATION_SCHEMA = 'SemanticAuthorityAdjudication/v1';
const REPORT_SCHEMA = 'SemanticAuthorityReport/v1';
const RECONCILIATION_DOC = 'docs/dev/architecture-skeleton/AUTHORITY-RECONCILIATION.md';

// The manifest's defaultMode mixes activation, visibility and lifecycle in one
// enum; only these values are on the activation axis and comparable with a
// disposition currentMode (R-D1). targetDefaultMode === defaultMode and
// manifest `internal` vs disposition `internal` are deliberately not compared
// (X-03, X-02).
const MANIFEST_ACTIVATION_MODES = new Set(['baseline', 'opt-in', 'shadow', 'disabled']);
const DISPOSITION_ACTIVATION_MODES = new Set(['baseline', 'opt-in', 'shadow']);
const FLAG_RISK_TO_ACTIVATION = Object.freeze({ 'baseline-on': 'baseline', 'opt-in': 'opt-in', 'shadow-only': 'shadow' });
const AUTHORITY_CLASS_BOUNDARIES = new Set(['task-ledger-authority']);
const TF_NODE_ID = /^TF-\d{4}$/;
const CLAIM_ID = /^capability-(\d{2})$/;

const GAP_CLASSES = Object.freeze({
  'component-owner-unresolvable': 'disposition',
  'concept-without-component': 'concept',
  'data-type-without-owner': 'data-type',
  'subsystem-without-anchor': 'subsystem',
  'surface-without-anchor': 'surface',
});
const ADJUDICATION_SECTIONS = Object.freeze({
  exemptions: 'structural',
  adjudicatedConflicts: 'registered-pending-fix',
  gaps: 'registered',
  conceptAliases: null,
  authorityBindings: null,
});
const TARGET_KINDS = new Set(['component', 'disposition', 'flag', 'concept', 'data-type', 'subsystem', 'surface', 'doc-row', 'relation']);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toPosix(path) {
  return path.replaceAll('\\', '/');
}

function lineOf(text, needle) {
  if (typeof text !== 'string' || !needle) return null;
  const index = text.indexOf(needle);
  return index === -1 ? null : text.slice(0, index).split('\n').length;
}

function relationKey(relation) {
  return `${relation.from}--${relation.kind}--${relation.to}`;
}

function parseDefaultMatrixRows(text) {
  const rows = new Map();
  if (typeof text !== 'string') return rows;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\|\s*\*\*(.+?)\*\*\s*\|[^|]*\|\s*\*\*(.+?)\*\*/.exec(line);
    if (match) rows.set(match[1].trim(), match[2].trim());
  }
  return rows;
}

function parseProductSurfaceRows(text) {
  const rows = new Map();
  if (typeof text !== 'string') return rows;
  const start = text.indexOf('FP-P1-08-COMPONENT-STATUS-START');
  const end = text.indexOf('FP-P1-08-COMPONENT-STATUS-END');
  const block = start === -1 ? text : text.slice(start, end === -1 ? undefined : end);
  for (const line of block.split(/\r?\n/)) {
    const match = /^\|\s*([^|`]+?)\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) rows.set(match[1].trim(), match[2].trim());
  }
  return rows;
}

function resolveDefaultMatrixRow(rows, anchor) {
  for (const [label, value] of rows) {
    if (label.replace(/\s+/g, '-') === anchor) return { label, value };
  }
  return null;
}

// R-D3: a bold product default of true means baseline, retired means retired,
// false/off means neither baseline nor retired; other vocabulary (auto, …) has
// no enum counterpart and is listed, not judged (X-05).
function expectedModesForMatrixValue(value) {
  if (value === 'true') return { kind: 'exact', modes: new Set(['baseline']) };
  if (value === 'retired') return { kind: 'exact', modes: new Set(['retired']) };
  if (value === 'false' || value === 'off') return { kind: 'exclude', modes: new Set(['baseline', 'retired']) };
  return null;
}

function isComparableActivationPair(defaultMode, currentMode) {
  return MANIFEST_ACTIVATION_MODES.has(defaultMode) && DISPOSITION_ACTIVATION_MODES.has(currentMode);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluateSemanticAuthority(registries, adjudication, options = {}) {
  const sourceTexts = options.sourceTexts ?? {};
  const adjudicationPath = options.adjudicationPath ?? ADJUDICATION_PATH;
  const diagnostics = [];
  const push = (rule, target, file, message, line = null) => {
    diagnostics.push({ rule, target, file: file === ADJUDICATION_PATH ? adjudicationPath : file, line, message });
  };
  const locate = (table, needle) => ({ file: REGISTRY_PATHS[table], line: lineOf(sourceTexts[table], needle) });
  const pushAt = (rule, target, location, message) => push(rule, target, location.file, message, location.line);
  const report = {
    counts: {},
    rulesEvaluated: [...RULES],
    adjudicated: [],
    notComparable: [],
    matrixUnmapped: [],
    gaps: {},
    exemptions: { structural: 0, registeredPendingFix: 0, gaps: 0, conceptAliases: 0, authorityBindings: 0, invalid: 0 },
  };
  const finish = () => ({
    diagnostics,
    issues: diagnostics.map((diagnostic) => `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ''}: [${DIAGNOSTIC_FAMILY}/${diagnostic.rule}] ${diagnostic.message}`),
    report,
  });

  if (!adjudication || typeof adjudication !== 'object') {
    push('adjudication-missing', adjudicationPath, ADJUDICATION_PATH, `adjudication registry ${adjudicationPath} is missing or unparsable; nothing can be exempted, aliased or registered as a gap without it`);
    return finish();
  }
  if (adjudication.schema !== ADJUDICATION_SCHEMA) {
    push('adjudication-missing', ADJUDICATION_PATH, ADJUDICATION_PATH, `adjudication registry declares schema ${JSON.stringify(adjudication.schema)}, expected ${ADJUDICATION_SCHEMA}`);
    return finish();
  }

  const components = registries.authority.components;
  const manifest = registries.authority.manifest;
  const dispositions = registries.dispositions;
  const flags = registries.flags;
  const componentById = new Map(components.map((component) => [component.id, component]));
  const componentIds = new Set(componentById.keys());
  const flagById = new Map(flags.map((flag) => [flag.id, flag]));
  const dispositionById = new Map(dispositions.map((entry) => [entry.id, entry]));
  const conceptIds = new Set(registries.concepts.map((concept) => concept.id));
  const subsystems = new Set(registries.reliability.map((boundary) => boundary.subsystem));
  const surfaces = new Set(registries.sensitive.map((boundary) => boundary.surface));
  const relationByKey = new Map(registries.relations.map((relation) => [relationKey(relation), relation]));
  const dataTypes = new Set(components.flatMap((component) => [...(component.ownedDataTypes ?? []), ...(component.allowedWrites ?? []), ...(component.allowedReads ?? [])]));
  const defaultMatrixRows = registries.docs?.defaultMatrixRows ?? new Map();
  const productSurfaceRows = registries.docs?.productSurfaceRows ?? new Map();
  const docRowLabels = new Set([...Object.keys(manifest.defaultMatrixLinks ?? {}), ...Object.keys(manifest.productSurfaceLinks ?? {})]);
  report.counts = {
    components: components.length,
    authorities: manifest.authorities.length,
    dispositions: dispositions.length,
    claims: registries.claims.length,
    reliability: registries.reliability.length,
    sensitive: registries.sensitive.length,
    concepts: registries.concepts.length,
    relations: registries.relations.length,
    flags: flags.length,
  };

  // registry-self-validation: both matrices' own validators, passed through
  // verbatim (unknown_coverage, duplicate_authority, … are theirs, not ours).
  const manifestValidation = registries.authority.validation;
  if (!manifestValidation || typeof manifestValidation.ok !== 'boolean') {
    push('registry-self-validation', 'authority', REGISTRY_PATHS.authority, 'validateComponentAuthorityManifest() produced no result');
  } else {
    for (const issue of manifestValidation.issues ?? []) {
      pushAt('registry-self-validation', issue.path ?? issue.code, locate('authority', issue.path ? `'${issue.path}'` : null), `${issue.code}: ${issue.message}`);
    }
  }
  const dispositionValidation = registries.dispositionValidation;
  if (!dispositionValidation || typeof dispositionValidation.ok !== 'boolean') {
    push('registry-self-validation', 'disposition', REGISTRY_PATHS.disposition, 'validateComponentDispositionManifest() produced no result; its coverage inputs could not be assembled');
  } else {
    for (const issue of dispositionValidation.issues ?? []) {
      pushAt('registry-self-validation', issue.path ?? issue.code, locate('disposition', issue.path ? `'${issue.path}'` : null), `${issue.code}: ${issue.message}`);
    }
  }

  // Adjudication registry entries: validated before use; invalid entries are
  // reported and never applied.
  const targetExists = (kind, target) => {
    switch (kind) {
      case 'component': return componentIds.has(target);
      case 'disposition': return dispositionById.has(target);
      case 'flag': return flagById.has(target);
      case 'concept': return conceptIds.has(target);
      case 'data-type': return dataTypes.has(target);
      case 'subsystem': return subsystems.has(target);
      case 'surface': return surfaces.has(target);
      case 'doc-row': return docRowLabels.has(target);
      case 'relation': return relationByKey.has(target);
      default: return false;
    }
  };
  const entries = { exemptions: [], adjudicatedConflicts: [], gaps: [], conceptAliases: [], authorityBindings: [] };
  const seenEntryKeys = new Set();
  for (const [section, expectedDisposition] of Object.entries(ADJUDICATION_SECTIONS)) {
    const list = adjudication[section];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      push('exemption-unknown-rule', section, ADJUDICATION_PATH, `section '${section}' must be an array`);
      continue;
    }
    for (const entry of list) {
      const id = hasText(entry?.id) ? entry.id : `${section}[?]`;
      let valid = true;
      const fail = (rule, message) => {
        push(rule, id, ADJUDICATION_PATH, message);
        valid = false;
      };
      if (!RULE_SET.has(entry?.rule) || ['adjudication-missing', 'registry-load-failed', 'exemption-reason-missing', 'exemption-stale', 'exemption-unknown-rule', 'exemption-unknown-target'].includes(entry?.rule)) {
        fail('exemption-unknown-rule', `${section} entry '${id}' names rule ${JSON.stringify(entry?.rule)}, which is not an adjudicable rule of this checker`);
      }
      for (const field of ['reason', 'reviewCondition', 'source', 'basis']) {
        if (!hasText(entry?.[field])) fail('exemption-reason-missing', `${section} entry '${id}' has no ${field}; an entry without reason, review condition, source and basis is itself a failure`);
      }
      if (hasText(entry?.source) && !entry.source.startsWith(`${RECONCILIATION_DOC}#`)) {
        fail('exemption-reason-missing', `${section} entry '${id}' source must point into ${RECONCILIATION_DOC}#<section> (got ${JSON.stringify(entry.source)})`);
      }
      if (hasText(entry?.basis) && entry.basis !== 'explicit-adjudication') {
        fail('exemption-reason-missing', `${section} entry '${id}' basis must be 'explicit-adjudication' (got ${JSON.stringify(entry.basis)})`);
      }
      if (expectedDisposition && entry?.disposition !== expectedDisposition) {
        fail('exemption-unknown-rule', `${section} entry '${id}' must declare disposition '${expectedDisposition}' (got ${JSON.stringify(entry?.disposition)})`);
      }
      if (section === 'conceptAliases') {
        if (!conceptIds.has(entry?.conceptId)) fail('exemption-unknown-target', `alias '${id}' names concept ${JSON.stringify(entry?.conceptId)}, which does not exist in ${REGISTRY_PATHS.semantics}`);
        if (!componentIds.has(entry?.componentId)) fail('exemption-unknown-target', `alias '${id}' names component ${JSON.stringify(entry?.componentId)}, which does not exist in ${REGISTRY_PATHS.authority}`);
      } else if (section === 'authorityBindings') {
        if (!relationByKey.has(entry?.relation)) fail('exemption-unknown-target', `binding '${id}' names relation ${JSON.stringify(entry?.relation)}, which does not exist in ${REGISTRY_PATHS.semantics}`);
        if (!componentIds.has(entry?.componentId)) fail('exemption-unknown-target', `binding '${id}' names component ${JSON.stringify(entry?.componentId)}, which does not exist in ${REGISTRY_PATHS.authority}`);
        if (!hasText(entry?.expectedBoundary)) fail('exemption-unknown-target', `binding '${id}' declares no expectedBoundary`);
      } else {
        const kind = section === 'gaps' ? GAP_CLASSES[entry?.class] : entry?.targetKind;
        if (section === 'gaps' && !kind) fail('exemption-unknown-rule', `gap entry '${id}' names class ${JSON.stringify(entry?.class)}, which is not a gap class of this checker`);
        if (!TARGET_KINDS.has(kind)) {
          if (section !== 'gaps') fail('exemption-unknown-target', `${section} entry '${id}' has no valid targetKind (got ${JSON.stringify(entry?.targetKind)})`);
        } else if (!targetExists(kind, entry?.target)) {
          fail('exemption-unknown-target', `${section} entry '${id}' names ${kind} ${JSON.stringify(entry?.target)}, which does not exist in the registries`);
        }
      }
      const key = `${section}::${id}::${entry?.rule}::${entry?.target ?? entry?.conceptId ?? entry?.relation}`;
      if (seenEntryKeys.has(key)) fail('exemption-unknown-target', `${section} entry '${id}' is declared more than once for the same rule and target`);
      seenEntryKeys.add(key);
      if (valid) entries[section].push({ ...entry, id });
      else report.exemptions.invalid += 1;
    }
  }
  report.exemptions.structural = entries.exemptions.length;
  report.exemptions.registeredPendingFix = entries.adjudicatedConflicts.length;
  report.exemptions.gaps = entries.gaps.length;
  report.exemptions.conceptAliases = entries.conceptAliases.length;
  report.exemptions.authorityBindings = entries.authorityBindings.length;
  const countById = (list) => Object.fromEntries([...list.reduce((acc, entry) => acc.set(entry.id.split('/')[0], (acc.get(entry.id.split('/')[0]) ?? 0) + 1), new Map())].sort());
  report.exemptionsApplied = countById(entries.exemptions);
  report.adjudicatedConflicts = { rulings: Object.keys(countById(entries.adjudicatedConflicts)).length, entries: entries.adjudicatedConflicts.length, byRuling: countById(entries.adjudicatedConflicts) };
  report.gapsRegistered = { total: entries.gaps.length, byRuling: countById(entries.gaps) };
  report.conceptAliases = entries.conceptAliases.map((entry) => `${entry.conceptId} -> ${entry.componentId}`);
  report.authorityBindings = entries.authorityBindings.map((entry) => entry.relation);

  // concept-alias (I-4): concept → component only by exact id or registered alias.
  const aliases = new Map();
  for (const alias of entries.conceptAliases) {
    if (aliases.has(alias.conceptId)) {
      push('concept-alias', alias.id, ADJUDICATION_PATH, `concept '${alias.conceptId}' is aliased more than once`);
      continue;
    }
    if (componentIds.has(alias.conceptId)) {
      push('concept-alias', alias.id, ADJUDICATION_PATH, `concept '${alias.conceptId}' already matches a component id exactly; alias '${alias.id}' is redundant`);
      continue;
    }
    aliases.set(alias.conceptId, alias.componentId);
  }
  const conceptComponent = (conceptId) => componentById.get(componentIds.has(conceptId) ? conceptId : aliases.get(conceptId));

  // identity-key (I-1/I-2): the component id is the identity; dispositions join
  // only through coverage.authorityComponentIds, never through id suffix or owner.
  const linkedEntries = new Map(components.map((component) => [component.id, []]));
  for (const entry of dispositions) {
    for (const componentId of entry.coverage?.authorityComponentIds ?? []) {
      linkedEntries.get(componentId)?.push(entry);
    }
  }
  const linkedEntry = new Map();
  const identityBroken = new Set();
  for (const component of components) {
    const linked = linkedEntries.get(component.id);
    const location = locate('authority', `id: '${component.id}'`);
    if (linked.length !== 1) {
      identityBroken.add(component.id);
      pushAt('identity-key', component.id, location, `component '${component.id}' must be covered by exactly one disposition entry via coverage.authorityComponentIds (found ${linked.length}${linked.length ? `: ${linked.map((entry) => entry.id).join(', ')}` : ''})`);
      continue;
    }
    if (!linked[0].id.startsWith('component.')) {
      identityBroken.add(component.id);
      pushAt('identity-key', component.id, location, `component '${component.id}' is covered by '${linked[0].id}', which is not a component.* disposition entry`);
      continue;
    }
    linkedEntry.set(component.id, linked[0]);
  }
  const claimIds = new Set();
  for (const claim of registries.claims) {
    const location = locate('claims', `id: '${claim.id}'`);
    const match = CLAIM_ID.exec(claim.id ?? '');
    if (!match) pushAt('identity-key', String(claim.id), location, `capability claim id ${JSON.stringify(claim.id)} does not match capability-NN`);
    else if (Number(match[1]) !== claim.reportItem) pushAt('identity-key', claim.id, location, `capability claim '${claim.id}' declares reportItem ${claim.reportItem}`);
    if (claimIds.has(claim.id)) pushAt('identity-key', claim.id, location, `capability claim '${claim.id}' is declared more than once`);
    claimIds.add(claim.id);
  }
  if (subsystems.size !== registries.reliability.length) push('identity-key', 'reliability', REGISTRY_PATHS.reliability, 'reliability subsystems are not unique');
  if (surfaces.size !== registries.sensitive.length) push('identity-key', 'sensitive', REGISTRY_PATHS.sensitive, 'sensitive surfaces are not unique');
  if (conceptIds.size !== registries.concepts.length) push('identity-key', 'concepts', REGISTRY_PATHS.semantics, 'product concept ids are not unique');
  if (relationByKey.size !== registries.relations.length) push('identity-key', 'relations', REGISTRY_PATHS.semantics, 'product relations are not unique by from--kind--to');
  for (const relation of registries.relations) {
    for (const endpoint of [relation.from, relation.to]) {
      if (!conceptIds.has(endpoint)) {
        pushAt('identity-key', relationKey(relation), locate('semantics', `from: '${relation.from}', kind: '${relation.kind}', to: '${relation.to}'`), `product relation ${relationKey(relation)} references unknown concept '${endpoint}'`);
      }
    }
  }

  // owner-namespace (R-O / C-01): owner is declared by the authority manifest.
  // The disposition `owner` is bookkeeping: it must be the covered component or
  // a TF node equal to the entry's own implementation/retirement node; it is
  // never compared as an authorization declaration.
  for (const entry of dispositions) {
    const location = locate('disposition', `id: '${entry.id}'`);
    const covered = entry.coverage?.authorityComponentIds ?? [];
    if (TF_NODE_ID.test(entry.owner)) {
      const accountable = entry.implementationNodeId ?? entry.retirementNodeId;
      if (entry.owner !== accountable) {
        pushAt('owner-namespace', entry.id, location, `disposition '${entry.id}' names accountable node ${entry.owner} but its implementation/retirement node is ${accountable}`);
      }
      continue;
    }
    if (!componentIds.has(entry.owner)) {
      pushAt('owner-namespace', entry.id, location, `disposition '${entry.id}' owner ${JSON.stringify(entry.owner)} is neither a covered authority component nor a TF node id`);
      continue;
    }
    if (covered.length > 0 && !covered.includes(entry.owner)) {
      pushAt('owner-namespace', entry.id, location, `disposition '${entry.id}' names owner '${entry.owner}' but covers authority component(s) ${covered.join(', ')}; owner is declared by ${REGISTRY_PATHS.authority}, not by this field`);
    }
  }

  // flag-binding (R-F / I-3): three-way flag join and per-flag owner agreement;
  // components bound to several flags are compared at flag granularity (X-01).
  const manifestFlagOwner = new Map();
  for (const component of components) {
    for (const flagId of component.catalogFlagIds ?? []) manifestFlagOwner.set(flagId, component.id);
  }
  const dispositionFlagEntries = new Map();
  for (const entry of dispositions) {
    for (const flagId of entry.coverage?.dcsFlagIds ?? []) {
      if (!dispositionFlagEntries.has(flagId)) dispositionFlagEntries.set(flagId, []);
      dispositionFlagEntries.get(flagId).push(entry);
    }
  }
  const flagGranularity = [];
  for (const flag of flags) {
    const location = locate('flags', `id: '${flag.id}'`);
    const manifestComponentId = manifestFlagOwner.get(flag.id);
    const bound = dispositionFlagEntries.get(flag.id) ?? [];
    if (!manifestComponentId) pushAt('flag-binding', flag.id, location, `DCS flag '${flag.id}' is bound to no component via catalogFlagIds`);
    if (bound.length !== 1) pushAt('flag-binding', flag.id, location, `DCS flag '${flag.id}' must be bound to exactly one disposition entry via coverage.dcsFlagIds (found ${bound.length})`);
    if (!manifestComponentId || bound.length !== 1) continue;
    const entry = bound[0];
    const entryLocation = locate('disposition', `id: '${entry.id}'`);
    const covered = entry.coverage?.authorityComponentIds ?? [];
    const agrees = entry.owner === manifestComponentId || covered.includes(manifestComponentId) || TF_NODE_ID.test(entry.owner);
    if (!agrees) {
      pushAt('flag-binding', flag.id, entryLocation, `DCS flag '${flag.id}' is bound to component '${manifestComponentId}' in ${REGISTRY_PATHS.authority} but disposition '${entry.id}' names owner '${entry.owner}'`);
    }
    if (covered.includes(manifestComponentId)) continue;
    flagGranularity.push(flag.id);
    const expected = FLAG_RISK_TO_ACTIVATION[flag.risk];
    if (expected && DISPOSITION_ACTIVATION_MODES.has(entry.currentMode) && entry.currentMode !== expected) {
      pushAt('flag-binding', flag.id, entryLocation, `DCS flag '${flag.id}' has risk '${flag.risk}' (activation ${expected}) but feature-level disposition '${entry.id}' has currentMode '${entry.currentMode}'`);
    }
  }
  for (const [flagId, bound] of dispositionFlagEntries) {
    if (!flagById.has(flagId)) {
      for (const entry of bound) pushAt('flag-binding', flagId, locate('disposition', `id: '${entry.id}'`), `disposition '${entry.id}' covers DCS flag '${flagId}', which does not exist in ${REGISTRY_PATHS.flags}`);
    }
  }

  // default-activation / default-retirement / default-matrix-row /
  // default-flag-risk (R-D1…R-D4): axis by axis.
  const observedByComponent = new Map();
  for (const component of components) {
    const entry = linkedEntry.get(component.id);
    const location = locate('authority', `id: '${component.id}'`);
    const observed = { defaultMode: component.defaultMode };
    observedByComponent.set(component.id, observed);
    if (!entry) continue;
    Object.assign(observed, { dispositionId: entry.id, disposition: entry.disposition, currentMode: entry.currentMode, targetDefaultMode: entry.targetDefaultMode });
    if (isComparableActivationPair(component.defaultMode, entry.currentMode)) {
      if (component.defaultMode !== entry.currentMode) {
        pushAt('default-activation', component.id, location, `component '${component.id}' has defaultMode '${component.defaultMode}' but disposition '${entry.id}' has currentMode '${entry.currentMode}'`);
      }
    } else if (component.defaultMode !== 'retired' && entry.disposition !== 'retired' && entry.currentMode !== 'retired') {
      report.notComparable.push(component.id);
    }
    if ((component.defaultMode === 'retired') !== (entry.disposition === 'retired')) {
      pushAt('default-retirement', component.id, location, `component '${component.id}' has defaultMode '${component.defaultMode}' while disposition '${entry.id}' has disposition '${entry.disposition}'`);
    }
    const matrixAnchor = /^docs\/dev\/default-config-matrix\.md#(.+)$/.exec(component.runtimeAvailabilitySource ?? '');
    if (matrixAnchor) {
      const row = resolveDefaultMatrixRow(defaultMatrixRows, matrixAnchor[1]);
      if (!row) {
        pushAt('default-matrix-row', component.id, location, `component '${component.id}' sources its availability from ${INPUT_PATHS.defaultMatrix}#${matrixAnchor[1]}, which has no bold-labelled row`);
      } else {
        Object.assign(observed, { matrixRow: row.label, matrixValue: row.value });
        const expected = expectedModesForMatrixValue(row.value);
        if (expected && (expected.kind === 'exact' ? !expected.modes.has(component.defaultMode) : expected.modes.has(component.defaultMode))) {
          pushAt('default-matrix-row', component.id, location, `component '${component.id}' has defaultMode '${component.defaultMode}' but ${INPUT_PATHS.defaultMatrix} row '${row.label}' declares product default '${row.value}'`);
        }
      }
    }
    const flagSource = /^DCS_PROD_FLAGS:(.+)$/.exec(component.runtimeAvailabilitySource ?? '');
    if (flagSource) {
      const flag = flagById.get(flagSource[1]);
      if (!flag) {
        pushAt('default-flag-risk', component.id, location, `component '${component.id}' sources its availability from DCS flag '${flagSource[1]}', which does not exist in ${REGISTRY_PATHS.flags}`);
      } else {
        Object.assign(observed, { sourceFlag: flag.id, flagRisk: flag.risk });
        const expected = FLAG_RISK_TO_ACTIVATION[flag.risk];
        if (expected && MANIFEST_ACTIVATION_MODES.has(component.defaultMode) && component.defaultMode !== expected) {
          pushAt('default-flag-risk', component.id, location, `component '${component.id}' has defaultMode '${component.defaultMode}' but its source flag '${flag.id}' has risk '${flag.risk}' (activation ${expected})`);
        }
      }
    }
  }
  for (const [label, componentIdsForLabel] of Object.entries(manifest.defaultMatrixLinks ?? {})) {
    const value = defaultMatrixRows.get(label);
    if (value !== undefined && !expectedModesForMatrixValue(value)) {
      report.matrixUnmapped.push({ document: INPUT_PATHS.defaultMatrix, label, value, components: [...componentIdsForLabel] });
    }
  }
  for (const [label, componentIdsForLabel] of Object.entries(manifest.productSurfaceLinks ?? {})) {
    const value = productSurfaceRows.get(label);
    if (value !== undefined && !['baseline', 'opt-in', 'shadow', 'read-only', 'internal', 'retired', 'disabled', 'default', 'advanced'].includes(value)) {
      report.matrixUnmapped.push({ document: INPUT_PATHS.productSurfaces, label, value, components: [...componentIdsForLabel] });
    }
  }

  // authority-boundary (R-A): one owner per data type beyond the key-level
  // uniqueness the manifest validator already enforces; registered relation
  // bindings must still hold; no second authority-class claim on one target.
  const ownersByDataType = new Map();
  for (const assignment of manifest.authorities) {
    if (!ownersByDataType.has(assignment.dataType)) ownersByDataType.set(assignment.dataType, new Set());
    ownersByDataType.get(assignment.dataType).add(assignment.authorityComponentId);
  }
  for (const [dataType, owners] of ownersByDataType) {
    if (owners.size > 1) push('authority-boundary', dataType, REGISTRY_PATHS.authority, `data type '${dataType}' has ${owners.size} authority owners: ${[...owners].join(', ')}`);
  }
  const declaredOwners = new Map();
  for (const component of components) {
    for (const dataType of component.ownedDataTypes ?? []) {
      if (!declaredOwners.has(dataType)) declaredOwners.set(dataType, []);
      declaredOwners.get(dataType).push(component.id);
    }
  }
  for (const [dataType, owners] of declaredOwners) {
    if (owners.length > 1) push('authority-boundary', dataType, REGISTRY_PATHS.authority, `data type '${dataType}' is listed in ownedDataTypes of ${owners.length} components: ${owners.join(', ')}`);
  }
  if (components.filter((component) => component.authorizationRole === 'owner').length !== 1) {
    push('authority-boundary', 'authorizationRole', REGISTRY_PATHS.authority, 'exactly one component must carry authorizationRole owner');
  }
  for (const binding of entries.authorityBindings) {
    const relation = relationByKey.get(binding.relation);
    const location = locate('semantics', `from: '${relation.from}', kind: '${relation.kind}', to: '${relation.to}'`);
    if (relation.authorityBoundary !== binding.expectedBoundary) {
      pushAt('authority-boundary', binding.relation, location, `product relation ${binding.relation} declares authorityBoundary '${relation.authorityBoundary}' but binding ${binding.id} requires '${binding.expectedBoundary}'`);
    }
    if (Array.isArray(binding.forbiddenBoundaries) && binding.forbiddenBoundaries.includes(relation.authorityBoundary)) {
      pushAt('authority-boundary', binding.relation, location, `product relation ${binding.relation} declares forbidden authorityBoundary '${relation.authorityBoundary}' (binding ${binding.id})`);
    }
    const component = componentById.get(binding.componentId);
    for (const [field, required] of Object.entries(binding.requires ?? {})) {
      const actual = component?.[field];
      if (!Array.isArray(actual) || !Array.isArray(required)) {
        push('authority-boundary', binding.relation, REGISTRY_PATHS.authority, `binding ${binding.id} requires ${binding.componentId}.${field}, which is not a list on the component or the binding`);
        continue;
      }
      const missing = required.filter((value) => !actual.includes(value));
      if (missing.length > 0) {
        pushAt('authority-boundary', binding.relation, locate('authority', `id: '${binding.componentId}'`), `component '${binding.componentId}' no longer satisfies binding ${binding.id}: ${field} lacks ${missing.join(', ')}`);
      }
    }
  }
  const authorityClaims = new Map();
  for (const relation of registries.relations) {
    if (!AUTHORITY_CLASS_BOUNDARIES.has(relation.authorityBoundary)) continue;
    if (!authorityClaims.has(relation.to)) authorityClaims.set(relation.to, []);
    authorityClaims.get(relation.to).push(relation);
  }
  for (const [target, claims] of authorityClaims) {
    if (claims.length < 2) continue;
    for (const relation of claims) {
      pushAt('authority-boundary', relationKey(relation), locate('semantics', `from: '${relation.from}', kind: '${relation.kind}', to: '${relation.to}'`), `product concept '${target}' is claimed with an authority-class boundary by ${claims.length} relations (${claims.map((claim) => claim.from).join(', ')}); '${relation.from}' cannot be a second authority`);
    }
  }

  // gap-registration (R-G): gaps are computed, then reconciled against the
  // registered gap list in both directions; nothing is guessed.
  const computedGaps = new Map(Object.keys(GAP_CLASSES).map((gapClass) => [gapClass, new Set()]));
  for (const entry of dispositions) {
    if ((entry.coverage?.authorityComponentIds ?? []).length > 0) continue;
    const viaFlag = (entry.coverage?.dcsFlagIds ?? []).some((flagId) => manifestFlagOwner.has(flagId));
    if (viaFlag || componentIds.has(entry.owner)) continue;
    computedGaps.get('component-owner-unresolvable').add(entry.id);
  }
  for (const concept of registries.concepts) {
    if (!conceptComponent(concept.id)) computedGaps.get('concept-without-component').add(concept.id);
  }
  const ownedOrWritten = new Set(components.flatMap((component) => [...(component.ownedDataTypes ?? []), ...(component.allowedWrites ?? [])]));
  for (const dataType of new Set(components.flatMap((component) => component.allowedReads ?? []))) {
    if (!ownedOrWritten.has(dataType)) computedGaps.get('data-type-without-owner').add(dataType);
  }
  const anchorPaths = new Set(components.flatMap((component) => (component.sourceAnchors ?? []).map((anchor) => anchor.path)));
  for (const boundary of registries.reliability) {
    if (!(boundary.evidenceRefs ?? []).some((ref) => anchorPaths.has(ref))) computedGaps.get('subsystem-without-anchor').add(boundary.subsystem);
  }
  for (const boundary of registries.sensitive) {
    if (!(boundary.evidenceRefs ?? []).some((ref) => anchorPaths.has(ref))) computedGaps.get('surface-without-anchor').add(boundary.surface);
  }
  const registeredGaps = new Map(Object.keys(GAP_CLASSES).map((gapClass) => [gapClass, new Map()]));
  for (const gap of entries.gaps) registeredGaps.get(gap.class).set(gap.target, gap.id);
  for (const gapClass of Object.keys(GAP_CLASSES)) {
    const computed = computedGaps.get(gapClass);
    const registered = registeredGaps.get(gapClass);
    report.gaps[gapClass] = { observed: [...computed].sort(), registered: [...registered.keys()].sort() };
    for (const target of computed) {
      if (!registered.has(target)) push('gap-registration', `${gapClass}:${target}`, ADJUDICATION_PATH, `gap-unregistered: ${gapClass} '${target}' is observed in the registries but not registered as a gap`);
    }
    for (const [target, gapId] of registered) {
      if (!computed.has(target)) push('gap-registration', `${gapClass}:${target}`, ADJUDICATION_PATH, `gap-stale: ${gapId} registers ${gapClass} '${target}' but the gap is no longer observed; remove or re-adjudicate it`);
    }
  }

  // exemption-stale: every recorded value on an adjudication entry must still
  // equal the current registry value, so a corrected registry invalidates the
  // entry instead of being silently covered by it. A component whose identity
  // link already failed identity-key is not re-reported here.
  const staleEntries = new Set();
  const observe = (entry) => {
    switch (entry.targetKind) {
      case 'component': return observedByComponent.get(entry.target) ?? {};
      case 'flag': {
        const bound = dispositionFlagEntries.get(entry.target) ?? [];
        return { manifestComponentId: manifestFlagOwner.get(entry.target), dispositionEntryId: bound.length === 1 ? bound[0].id : null, risk: flagById.get(entry.target)?.risk };
      }
      case 'disposition': {
        const disposition = dispositionById.get(entry.target);
        return disposition ? { owner: disposition.owner, disposition: disposition.disposition, currentMode: disposition.currentMode } : {};
      }
      case 'doc-row': return {
        defaultMatrixValue: defaultMatrixRows.get(entry.target),
        productSurfaceValue: productSurfaceRows.get(entry.target),
      };
      default: return {};
    }
  };
  for (const entry of [...entries.exemptions, ...entries.adjudicatedConflicts]) {
    if (entry.targetKind === 'component' && identityBroken.has(entry.target)) continue;
    if (!entry.observed || typeof entry.observed !== 'object') {
      staleEntries.add(entry);
      push('exemption-stale', entry.id, ADJUDICATION_PATH, `${entry.id} (${entry.rule}, ${entry.target}) records no observed values, so staleness cannot be checked`);
      continue;
    }
    const current = observe(entry);
    for (const [field, recorded] of Object.entries(entry.observed)) {
      if (!deepEqual(recorded, current[field])) {
        staleEntries.add(entry);
        push('exemption-stale', entry.id, ADJUDICATION_PATH, `${entry.id} (${entry.rule}, ${entry.target}) recorded ${field}=${JSON.stringify(recorded)} but the registries now say ${JSON.stringify(current[field])}; remove or re-adjudicate the entry`);
      }
    }
  }

  // Adjudicated conflicts (registered-pending-fix) suppress exactly the
  // diagnostic they name; a stale entry suppresses nothing, and an entry whose
  // diagnostic does not fire is stale.
  const suppression = new Map();
  for (const entry of entries.adjudicatedConflicts) {
    if (!staleEntries.has(entry)) suppression.set(`${entry.rule}::${entry.target}`, entry);
  }
  const fired = new Set();
  const remaining = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.rule}::${diagnostic.target}`;
    if (suppression.has(key)) {
      fired.add(key);
      report.adjudicated.push({ id: suppression.get(key).id, rule: diagnostic.rule, target: diagnostic.target, file: diagnostic.file, line: diagnostic.line, message: diagnostic.message });
      continue;
    }
    remaining.push(diagnostic);
  }
  diagnostics.length = 0;
  diagnostics.push(...remaining);
  for (const [key, entry] of suppression) {
    if (fired.has(key) || staleEntries.has(entry) || identityBroken.has(entry.target)) continue;
    const [rule, target] = key.split('::');
    push('exemption-stale', entry.id, ADJUDICATION_PATH, `${entry.id} registers a pending-fix conflict for ${rule} on '${target}' but no such diagnostic fires; remove or re-adjudicate the entry`);
  }
  report.flagGranularity = flagGranularity.sort();
  return finish();
}

function formatSummary(report) {
  const counts = report.counts;
  const gapsObserved = Object.values(report.gaps).reduce((sum, gap) => sum + gap.observed.length, 0);
  const gapsRegistered = Object.values(report.gaps).reduce((sum, gap) => sum + gap.registered.length, 0);
  return `summary components=${counts.components} authorities=${counts.authorities} dispositions=${counts.dispositions} claims=${counts.claims} reliability=${counts.reliability} sensitive=${counts.sensitive} concepts=${counts.concepts} relations=${counts.relations} flags=${counts.flags} | rules=${report.rulesEvaluated.length} diagnostics=${report.diagnostics?.length ?? 0} adjudicated=${report.adjudicated.length} structural=${report.exemptions.structural} gaps=${gapsObserved}/${gapsRegistered} aliases=${report.exemptions.conceptAliases} bindings=${report.exemptions.authorityBindings} not-comparable=${report.notComparable.length} matrix-unmapped=${report.matrixUnmapped.length}`;
}

export {
  ADJUDICATION_PATH,
  ADJUDICATION_SCHEMA,
  DIAGNOSTIC_FAMILY,
  DISPOSITION_VALIDATION_NOW,
  GAP_CLASSES,
  INPUT_PATHS,
  REGISTRY_PATHS,
  REPORT_SCHEMA,
  RULES,
  assembleRegistries,
  buildDispositionValidationInputs,
  evaluateSemanticAuthority,
  expectedModesForMatrixValue,
  formatSummary,
  isComparableActivationPair,
  loadRegistries,
  parseDefaultMatrixRows,
  parseProductSurfaceRows,
  relationKey,
  resolveDefaultMatrixRow,
};

class RegistryLoadError extends Error {}

function buildDispositionValidationInputs({ authorityComponentIds, dcsFlagIds, runtimeLeafPaths, settingsSectionIds, settingsPanelIds, routePaths, knownNodeIds }) {
  return {
    authorityComponentIds,
    dcsFlagIds,
    runtimeLeafPaths,
    settingsSectionIds,
    settingsPanelIds,
    routePaths,
    knownNodeIds: new Set(knownNodeIds),
    now: DISPOSITION_VALIDATION_NOW,
  };
}

// Executes the registries through scripts/lib/ts-import-hooks.mjs. `rewrites`
// maps repository-relative posix paths to replacement text (negative fixtures);
// the same text is served to `import()` and to every direct read, so a mutated
// registry and its line numbers agree.
async function loadRegistries({ root, rewrites = {} }) {
  const [{ register }, { readFile, readdir }, { pathToFileURL }, { resolve }] = await Promise.all([
    import('node:module'),
    import('node:fs/promises'),
    import('node:url'),
    import('node:path'),
  ]);
  const hrefOf = (relativePath) => pathToFileURL(resolve(root, relativePath)).href;
  const rewritesByHref = Object.fromEntries(Object.entries(rewrites).map(([relativePath, text]) => [hrefOf(relativePath), text]));
  register('./lib/ts-import-hooks.mjs', import.meta.url, { data: { rewrites: rewritesByHref } });

  const readText = async (relativePath) => (
    relativePath in rewrites ? rewrites[relativePath] : readFile(resolve(root, relativePath), 'utf8')
  );
  const importModule = async (relativePath) => {
    try {
      return await import(hrefOf(relativePath));
    } catch (error) {
      throw new RegistryLoadError(`${relativePath} could not be executed: ${error?.message ?? error}`);
    }
  };
  const modules = {};
  const sourceTexts = {};
  for (const [table, relativePath] of Object.entries(REGISTRY_PATHS)) {
    sourceTexts[table] = await readText(relativePath);
    modules[table] = await importModule(relativePath);
  }
  const runtimeLeaves = await importModule(INPUT_PATHS.runtimeLeaves);
  const settingsRoutes = await importModule(INPUT_PATHS.settingsRoutes);
  let settingsPanelIds;
  let appSource;
  let nodeIds;
  let defaultMatrixText;
  let productSurfaceText;
  try {
    settingsPanelIds = (await readdir(resolve(root, INPUT_PATHS.settingsPanelsDir))).filter((name) => name.endsWith('.tsx')).map((name) => name.slice(0, -4));
    appSource = await readText(INPUT_PATHS.app);
    nodeIds = JSON.parse(await readText(INPUT_PATHS.nodeIds)).ids;
    defaultMatrixText = await readText(INPUT_PATHS.defaultMatrix);
    productSurfaceText = await readText(INPUT_PATHS.productSurfaces);
  } catch (error) {
    throw new RegistryLoadError(`validator inputs could not be read: ${error?.message ?? error}`);
  }
  if (!Array.isArray(nodeIds)) throw new RegistryLoadError(`${INPUT_PATHS.nodeIds} has no ids array`);

  const registries = assembleRegistries({ ...modules, runtimeLeaves, settingsRoutes }, { settingsPanelIds, appSource, nodeIds, defaultMatrixText, productSurfaceText });
  return { registries, sourceTexts };
}

// Builds the evaluator input from the executed registry modules and the raw
// validator inputs; shared by the CLI loader and the vitest spec so both run
// the disposition catalog's own validator with identical inputs.
function assembleRegistries(modules, { settingsPanelIds, appSource, nodeIds, defaultMatrixText, productSurfaceText }) {
  const { authority, disposition, runtimeLeaves, settingsRoutes } = modules;
  const inputs = buildDispositionValidationInputs({
    authorityComponentIds: authority.COMPONENT_AUTHORITY_MANIFEST.components.map((component) => component.id),
    dcsFlagIds: modules.flags.DCS_PROD_FLAGS.map((flag) => flag.id),
    runtimeLeafPaths: runtimeLeaves.listLeafPaths(runtimeLeaves.RUNTIME_FEATURE_EXHAUSTIVE),
    settingsSectionIds: ['overview', ...Object.keys(settingsRoutes.SETTINGS_SECTION_SEGMENTS)],
    settingsPanelIds,
    routePaths: [...new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]))],
    knownNodeIds: nodeIds,
  });
  return {
    authority: {
      manifest: authority.COMPONENT_AUTHORITY_MANIFEST,
      components: authority.AUTHORITY_COMPONENTS,
      validation: authority.validateComponentAuthorityManifest(),
    },
    dispositions: disposition.COMPONENT_DISPOSITION_ENTRIES,
    dispositionValidation: disposition.validateComponentDispositionManifest(disposition.COMPONENT_DISPOSITION_MANIFEST, inputs),
    claims: modules.claims.CAPABILITY_CLAIM_MATRIX,
    reliability: modules.reliability.RELIABILITY_BOUNDARIES,
    sensitive: modules.sensitive.SENSITIVE_CONTENT_BOUNDARY_MATRIX,
    concepts: modules.semantics.PRODUCT_SEMANTIC_CONCEPTS,
    relations: modules.semantics.PRODUCT_SEMANTIC_RELATIONS,
    flags: modules.flags.DCS_PROD_FLAGS,
    docs: {
      defaultMatrixRows: parseDefaultMatrixRows(defaultMatrixText),
      productSurfaceRows: parseProductSurfaceRows(productSurfaceText),
    },
  };
}

// Files a negative fixture may mutate: everything this gate reads. A mutation
// elsewhere would never be applied, so it is a fixture error rather than a pass.
function readableProjectFiles(adjudicationPath) {
  return new Set([
    ...Object.values(REGISTRY_PATHS),
    INPUT_PATHS.runtimeLeaves,
    INPUT_PATHS.settingsRoutes,
    INPUT_PATHS.app,
    INPUT_PATHS.nodeIds,
    INPUT_PATHS.defaultMatrix,
    INPUT_PATHS.productSurfaces,
    adjudicationPath,
  ]);
}

function parseArgs(argv) {
  const options = { fixtures: [], report: null, actor: null, adjudication: ADJUDICATION_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--fixture' || flag === '--report' || flag === '--actor' || flag === '--adjudication') {
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (flag === '--fixture') options.fixtures.push(value);
      else options[flag.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return options;
}

async function describeCandidate(root) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const git = async (args) => (await run('git', args, { cwd: root, encoding: 'utf8' })).stdout.trim();
  try {
    const status = await git(['status', '--porcelain']);
    return {
      commit: await git(['rev-parse', 'HEAD']),
      tree: await git(['rev-parse', 'HEAD^{tree}']),
      dirty: status.length > 0,
      changedPaths: status ? status.split(/\r?\n/).map((line) => line.slice(3)).sort() : [],
    };
  } catch (error) {
    return { commit: null, tree: null, dirty: null, changedPaths: [], error: error?.message ?? String(error) };
  }
}

async function writeReport(path, report) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname, resolve } = await import('node:path');
  const target = resolve(process.cwd(), path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const [{ realpathSync }, { resolve }] = await Promise.all([import('node:fs'), import('node:path')]);
  const { loadRegistryFixtures, RegistryFixtureError } = await import('./lib/registry-fixture.mjs');
  const startedAt = new Date().toISOString();
  const command = ['node', ...process.argv.slice(1).map((segment) => toPosix(segment))];
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Semantic authority fixture error: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const baseReport = (exitCode, extra = {}) => ({
    schema: REPORT_SCHEMA,
    generatedAt: startedAt,
    actor: options.actor ?? process.env.SEMANTIC_AUTHORITY_ACTOR ?? 'agent',
    drivenBy: 'agent',
    command,
    exitCode,
    ...extra,
  });
  const emitReport = async (report) => {
    if (options.report) await writeReport(options.report, report);
  };
  if (!process.features.typescript) {
    const message = `Node ${process.version} cannot strip TypeScript types (process.features.typescript is ${JSON.stringify(process.features.typescript)}); Node >= 23.6 is required to execute the registries`;
    console.error(`Semantic authority load error: ${message}`);
    await emitReport(baseReport(2, { loadError: message, rulesEvaluated: [...RULES], diagnostics: [{ rule: 'registry-load-failed', target: 'node', file: 'scripts/check-semantic-authority.mjs', line: null, message }] }));
    process.exitCode = 2;
    return;
  }

  const root = realpathSync(process.cwd());
  const readable = readableProjectFiles(options.adjudication);
  let fixtures;
  try {
    fixtures = await loadRegistryFixtures(options.fixtures, { root });
    const outside = Object.keys(fixtures.files).filter((file) => !readable.has(file));
    if (outside.length > 0) {
      throw new RegistryFixtureError(`fixture mutation never applied (file is not read by this gate): ${outside.join(', ')}`);
    }
  } catch (error) {
    console.error(`Semantic authority fixture error: ${error.message}`);
    await emitReport(baseReport(2, { fixtureError: error.message }));
    process.exitCode = 2;
    return;
  }
  const rewrites = Object.fromEntries(Object.entries(fixtures.files).map(([file, absolutePath]) => [file, fixtures.texts[absolutePath]]));
  const fixtureIds = fixtures.fixtures.map((fixture) => fixture.id);
  const candidate = await describeCandidate(root);

  let loaded;
  try {
    loaded = await loadRegistries({ root, rewrites });
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`Semantic authority load error: ${message}`);
    await emitReport(baseReport(2, { candidate, fixtures: fixtureIds, loadError: message, rulesEvaluated: [...RULES], diagnostics: [{ rule: 'registry-load-failed', target: 'registries', file: REGISTRY_PATHS.authority, line: null, message }] }));
    process.exitCode = 2;
    return;
  }

  let adjudication = null;
  let adjudicationError = null;
  try {
    const text = options.adjudication in rewrites
      ? rewrites[options.adjudication]
      : await (await import('node:fs/promises')).readFile(resolve(root, options.adjudication), 'utf8');
    adjudication = JSON.parse(text);
  } catch (error) {
    adjudicationError = error?.message ?? String(error);
  }

  if (fixtureIds.length > 0) console.error(`Semantic authority fixtures applied: ${fixtureIds.join(', ')}`);
  const result = evaluateSemanticAuthority(loaded.registries, adjudication, { sourceTexts: loaded.sourceTexts, adjudicationPath: options.adjudication });
  if (adjudicationError && result.diagnostics.some((diagnostic) => diagnostic.rule === 'adjudication-missing')) {
    result.diagnostics[0].message += ` (${adjudicationError})`;
    result.issues[0] += ` (${adjudicationError})`;
  }
  const exitCode = result.issues.length > 0 ? 1 : 0;
  await emitReport(baseReport(exitCode, {
    candidate,
    fixtures: fixtureIds,
    adjudication: options.adjudication,
    ...result.report,
    diagnostics: result.diagnostics,
  }));
  if (exitCode !== 0) {
    console.error('Semantic authority check failed:');
    for (const issue of result.issues) console.error(`- ${issue}`);
    process.exitCode = exitCode;
    return;
  }
  console.log('Semantic authority check passed.');
  console.log(formatSummary({ ...result.report, diagnostics: result.diagnostics }));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
