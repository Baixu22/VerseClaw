import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { benefitDigest } from './rsi-benefit-eval.mjs';
import { FILE_WRITE_TOOL_COST_POLICY } from './rsi-coding-protocol.mjs';
import ts from 'typescript';
import { referenceShape } from './rsi-semantic-corpus-import.mjs';
import { materializeNativeChecker, NATIVE_CHECKER_VERSION, verifyNativeCheckerEvidence } from './rsi-native-checker.mjs';
import { ISOLATED_PYTHON_VERSION, validateIsolatedPython, verifyIsolatedPythonEvidence } from './rsi-isolated-python.mjs';

export const SEMANTIC_CASES_PATH = 'harness/specs/fixtures/rsi-live-experience/semantic-independent-cases.v1.json';
export const SEMANTIC_OBSERVED_POPULATION_PATH = 'harness/specs/fixtures/rsi-live-experience/semantic-population-20261116/independent-cases.v2.json.gz';
const Z95 = 1.959964, Z80 = 0.841621, MINIMUM_EFFECT = 0.05;
const contractKey = item => benefitDigest({
  prompt: item.prompt.replaceAll(item.name, '<entry>').replace(/\s+/gu, ' ').trim().toLowerCase(),
  declaration: item.declaration.replaceAll(item.name, '<entry>').replace(/\s+/gu, ' ').trim(),
});
const stdioContractKey = item => benefitDigest({
  prompt: item.prompt.replace(/\s+/gu, ' ').trim().toLowerCase(), language: item.runtime,
});
const itemContractKey = item => item.runtime ? stdioContractKey(item) : contractKey(item);
const canonicalSourceIdentity = value => {
  const identity = String(value).trim();
  const contest = /^(?:cf-)?(\d+)-([A-Za-z]\d*)$/iu.exec(identity)
    ?? /^codeforces:(\d+):([A-Za-z]\d*)$/iu.exec(identity);
  if (contest) return ['codeforces:' + contest[1] + ':' + contest[2].toUpperCase()];
  try {
    const url = new URL(identity);
    if (!['http:', 'https:'].includes(url.protocol)) return [identity];
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    const path = url.pathname.replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
    if (host === 'codeforces.com') {
      const problemset = /^\/problemset\/problem\/(\d+)\/([A-Za-z]\d*)$/iu.exec(path);
      const contestPath = /^\/contest\/(\d+)\/problem\/([A-Za-z]\d*)$/iu.exec(path);
      if (problemset || contestPath) {
        const [, number, index] = problemset ?? contestPath;
        return [identity, 'codeforces:' + number + ':' + index.toUpperCase()];
      }
      const gym = /^\/gym\/(\d+)\/problem\/([A-Za-z]\d*)$/iu.exec(path);
      if (gym) return [identity, 'codeforces:gym:' + gym[1] + ':' + gym[2].toUpperCase()];
    }
    url.hash = ''; url.hostname = host; url.pathname = path;
    return [identity, 'url:' + url.href];
  } catch { return [identity]; }
};
const caseSourceIdentities = item => {
  const provenance = item.provenance ?? {}, review = provenance.familyReview ?? {};
  const identities = [provenance.sourceId, ...(provenance.sourceIdentities ?? []), ...(review.sourceIdentities ?? []), ...(review.sourceIds ?? [])]
    .filter(value => typeof value === 'string' && value.trim());
  for (const upstream of [...(provenance.upstreamIds ?? []), provenance.selectedUpstreamId].filter(Boolean)) {
    identities.push(String(upstream));
  }
  return [...new Set(identities.flatMap(canonicalSourceIdentity))];
};

/** The discordance is a prospective assumption, never estimated from final outcomes. */
export function semanticPowerPlan(discordance = 1) {
  assert(Number.isFinite(discordance) && discordance >= MINIMUM_EFFECT && discordance <= 1, 'semantic-power-discordance');
  const variance = discordance - MINIMUM_EFFECT ** 2;
  return { method: 'normal-approximation paired pass^3; prospective planning only', inferenceUnit: 'independent-contract-group',
    confidenceLevel: 0.95, targetPower: 0.8, minimumDetectableEffect: MINIMUM_EFFECT,
    discordanceAssumption: discordance, varianceAssumption: variance,
    requiredIndependentCases: Math.ceil((Z95 + Z80) ** 2 * variance / MINIMUM_EFFECT ** 2),
    repeatsPerArm: 3, observedPower: null };
}

/** Freeze identities and commitments; no private payload is returned to generation. */
export function buildSemanticStudyDesign(pack, priorPacks, trainingCaseIds = []) {
  assert(pack.schemaVersion === 'RsiIndependentCodingCases/v2' && pack.datasetVersion === 'RsiSemanticIndependentCases/v1'
    && pack.driven_by === 'agent' && pack.realHumanEvidence === false, 'semantic-independent-population-required');
  assert(Array.isArray(pack.cases) && pack.cases.length > 0 && Array.isArray(priorPacks), 'semantic-population-empty');
  const prior = priorPacks.flatMap(value => value.cases), excluded = new Set([...prior.map(item => item.id), ...trainingCaseIds]);
  const priorContracts = new Set(prior.map(contractKey)), ids = new Set(), contracts = new Set(), groups = new Map();
  const cases = pack.cases.map(item => {
    assert(!excluded.has(item.id) && !ids.has(item.id), 'semantic-reused-or-duplicate-case'); ids.add(item.id);
    const fingerprint = contractKey(item);
    assert(!priorContracts.has(fingerprint) && !contracts.has(fingerprint), 'semantic-reused-or-renamed-contract'); contracts.add(fingerprint);
    assert(['validation', 'heldOut'].includes(item.split) && typeof item.independenceGroup === 'string'
      && item.independenceGroup.trim(), 'semantic-independent-group-required');
    assert(!groups.has(item.independenceGroup) || groups.get(item.independenceGroup) === item.split, 'semantic-family-split-leak');
    groups.set(item.independenceGroup, item.split);
    assert(item.reference && Array.isArray(item.vectors) && item.vectors.length >= 5, 'semantic-oracle-required');
    return { caseId: item.id, split: item.split, independenceGroup: item.independenceGroup, contractDigest: fingerprint,
      privateOracleDigest: benefitDigest(item.vectors), referenceDigest: benefitDigest(item.reference),
      safetyRequired: item.safetyRequired === true, anchor: item.anchor ?? null };
  });
  const splits = Object.fromEntries(['validation', 'heldOut'].map(split => [split, cases.filter(item => item.split === split)]));
  const independentCases = Object.fromEntries(Object.entries(splits).map(([split, rows]) => [split, new Set(rows.map(item => item.independenceGroup)).size]));
  const power = semanticPowerPlan(), gaps = ['headroom: separately authorized pilot has not been measured'];
  for (const [split, rows] of Object.entries(splits)) {
    if (independentCases[split] < power.requiredIndependentCases) gaps.push(`${split}: ${independentCases[split]}/${power.requiredIndependentCases} independent cases available`);
    if (rows.length !== independentCases[split]) gaps.push(`${split}: related variants require cluster aggregation before measurement`);
    if (rows.filter(item => item.safetyRequired).length < 3 || !rows.some(item => item.anchor === 'positive') || !rows.some(item => item.anchor === 'negative')) gaps.push(`${split}: safety/anchor coverage missing`);
  }
  return { schemaVersion: 'RsiSemanticStudyDesign/v1', driven_by: 'agent', actor: pack.actor, realHumanEvidence: false,
    populationDigest: benefitDigest(pack), priorPopulationDigests: priorPacks.map(benefitDigest), trainingCaseIds: [...trainingCaseIds],
    splits, independentCases, frozenFor: 'offline-and-generation-only-pilot', measuredCandidates: 0, observedTrials: 0,
    protocol: 'RsiCodingCollector/v7', arms: ['sekb-off', 'sekb-confirmed'], repeatsPerArm: 3,
    primaryMetric: 'pass^3', confidenceInterval: 'paired 95% interval over complete independent cases',
    thresholds: { minimumCompleteCaseFloor: 20, minimumAbsoluteImprovement: MINIMUM_EFFECT, intervalLowerBoundExclusive: 0,
      maximumRelativeTokenIncrease: 0.1, requireEveryPlannedCaseComplete: true, requireKnownUsage: true,
      requireNoSafetyOrAnchorViolation: true, requireOffOnOffRollback: true, requireProductAcceptance: true },
    cost: { toolBudget: structuredClone(FILE_WRITE_TOOL_COST_POLICY),
      toolComparison: 'absolute calls per scheduled slot in both arms; zero baseline is valid',
      reporting: ['all-attempt tokens', 'tokens per complete case', 'tokens per successful case or null when zero successes',
        'provider calls', 'tool calls per slot', 'generation tokens separately and amortized', 'actual currency usage or unknown'],
      unknownUsage: 'retain reservation separately; do not treat it as actual usage or pass the cost gate' },
    power, sensitivity: [0.05, 0.1, 0.2, 1].map(semanticPowerPlan),
    headroom: { status: 'not-measured', maximumBaselinePass3ForPilot: 0.8,
      action: 'Use a separately authorized pilot; exclude its entire families from the future validation and final population. Freeze new identities and power before generating a measured candidate.' },
    measurementReady: gaps.length === 0, gaps, experienceBenefit: false, promotionReady: false, status: 'NO_GO' };
}

export function assertSemanticMeasurementReady(design, inputs) {
  // v1 commits an offline prototype. Editing its result flags cannot authorize measurement.
  assert(['RsiSemanticStudyDesign/v2', 'RsiSemanticStudyDesign/v3'].includes(design.schemaVersion) && inputs,
    'semantic-independent-powered-population-not-ready: ' + design.schemaVersion + ' requires a new measured protocol and independent population');
  assert.deepEqual(design, buildSemanticMeasurementDesign(inputs.pack, inputs.priorPacks, inputs.headroom,
    inputs.trainingCaseIds, inputs.observedPacks ?? []), 'semantic-measurement-design-drift');
  assert(design.measurementReady && design.gaps.length === 0, 'semantic-independent-powered-population-not-ready');
  return true;
}

export const SEMANTIC_MEASURED_THRESHOLDS = Object.freeze({ minimumCompleteCaseFloor: 20, minimumAbsoluteImprovement: 0.05,
  intervalLowerBoundExclusive: 0, maximumRelativeTokenIncrease: 0.1, requireEveryPlannedCaseComplete: true,
  requireKnownUsage: true, requireNoSafetyOrAnchorViolation: true, requireOffOnOffRollback: true, requireProductAcceptance: true });

/** Conservative family key: renamed locals and changed literal parameters do not create new algorithms. */
export function semanticImplementationShape(source) {
  assert(typeof source === 'string' && source.trim(), 'semantic-reference-required');
  const file = ts.createSourceFile('reference.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), names = new Map(), tokens = [];
  assert(file.parseDiagnostics.length === 0, 'semantic-reference-syntax');
  const globals = new Set(['Math', 'Number', 'String', 'Array', 'Object', 'JSON', 'Date', 'Map', 'Set', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Infinity', 'NaN', 'undefined']);
  const literals = new Set([ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail]);
  function visit(node) {
    if (ts.isIdentifier(node)) {
      const member = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (member || globals.has(node.text)) tokens.push(node.text);
      else { if (!names.has(node.text)) names.set(node.text, names.size); tokens.push('name:' + names.get(node.text)); }
    } else if (literals.has(node.kind)) tokens.push('literal:' + node.kind);
    else { tokens.push(node.kind); node.getChildren(file).forEach(visit); }
  }
  visit(file);
  return benefitDigest(tokens);
}

function reviewedPopulationCases(pack, priorPacks, exclusions, trainingCaseIds, observedPacks) {
  assert(pack.schemaVersion === 'RsiIndependentCodingCases/v2' && pack.datasetVersion === 'RsiSemanticIndependentCases/v2'
    && pack.driven_by === 'agent' && pack.realHumanEvidence === false, 'semantic-measured-population-version');
  assert(['prospective-measurement', 'scripted-control'].includes(pack.usage), 'semantic-population-usage');
  assert(Array.isArray(pack.cases) && pack.cases.length > 0 && Array.isArray(priorPacks), 'semantic-population-empty');
  assert(Array.isArray(observedPacks), 'semantic-observed-populations-required');
  const allPriorPacks = [...priorPacks, ...observedPacks], prior = allPriorPacks.flatMap(value => value.cases);
  const forbiddenIds = new Set([...prior.map(row => row.id), ...trainingCaseIds, ...exclusions.cases.map(row => row.caseId)]);
  const forbiddenFamilies = new Set([...prior.map(row => row.familyId).filter(Boolean),
    ...exclusions.priorFamilies, ...exclusions.cases.map(row => row.familyId)]);
  const forbiddenContracts = new Set(prior.map(observedPacks.length ? itemContractKey : contractKey));
  const shapeOf = row => row.runtime ? row.provenance?.implementationShape : semanticImplementationShape(row.reference);
  const forbiddenShapes = new Set(prior.filter(row => row.reference).map(shapeOf).filter(Boolean));
  const tracksObservedSource = observedPacks.length > 0;
  const forbiddenSources = new Set(tracksObservedSource ? prior.flatMap(caseSourceIdentities) : []);
  const ids = new Set(), contracts = new Set(), familySplits = new Map(), referenceBodies = new Set(), shapes = new Set(),
    sourceIds = new Set(), observedSources = new Set(), gaps = [];
  const cases = pack.cases.map(item => {
    assert(typeof item.familyId === 'string' && item.familyId.trim() && item.independenceGroup === item.familyId,
      'semantic-reviewed-independent-family-required');
    assert(!ids.has(item.id), 'semantic-duplicate-case'); ids.add(item.id);
    assert(['validation', 'heldOut'].includes(item.split), 'semantic-measurement-split');
    assert(!familySplits.has(item.familyId) || familySplits.get(item.familyId) === item.split, 'semantic-family-split-leak');
    familySplits.set(item.familyId, item.split);
    assert(item.provenance?.sourceId && item.provenance.familyReview && typeof item.reference === 'string'
      && Array.isArray(item.vectors) && item.vectors.length >= 5, 'semantic-source-oracle-and-family-review-required');
    const contract = itemContractKey(item), body = benefitDigest(item.reference.replaceAll(item.name, '<entry>').replace(/\s+/gu, ' ').trim());
    const implementationShape = shapeOf(item);
    if (item.runtime) assert.equal(implementationShape, referenceShape({ language: item.runtime === 'python3' ? 'python' : 'cpp', source: item.reference }, item.provenance.appsFunctionName), 'semantic-stdio-reference-shape');
    const review = item.provenance.familyReview;
    assert(review.schemaVersion === 'RsiSemanticFamilyReview/v1' && review.driven_by === 'agent'
      && typeof review.actor === 'string' && review.actor.trim() && typeof review.basis === 'string' && review.basis.trim(),
    'semantic-family-review-required');
    assert.equal(review.sourceId, item.provenance.sourceId, 'semantic-family-review-source');
    assert.equal(review.familyId, item.familyId, 'semantic-family-review-identity');
    assert.equal(review.contractDigest, contract, 'semantic-family-review-contract');
    assert.equal(review.referenceDigest, benefitDigest(item.reference), 'semantic-family-review-reference');
    assert.equal(review.privateOracleDigest, benefitDigest(item.vectors), 'semantic-family-review-oracle');
    assert(!contracts.has(contract) && !referenceBodies.has(body), 'semantic-renamed-or-duplicate-case');
    contracts.add(contract); referenceBodies.add(body);
    const identities = tracksObservedSource ? caseSourceIdentities(item) : [item.provenance.sourceId];
    const observedSourceOverlap = tracksObservedSource && identities.some(identity => forbiddenSources.has(identity));
    if (observedSourceOverlap) gaps.push('previously observed upstream source identity: ' + item.id);
    if (shapes.has(implementationShape) || (tracksObservedSource
      ? identities.some(identity => observedSources.has(identity)) : sourceIds.has(item.provenance.sourceId)))
      gaps.push('related implementation or repeated upstream source: ' + item.id);
    shapes.add(implementationShape); sourceIds.add(item.provenance.sourceId); identities.forEach(identity => observedSources.add(identity));
    const overlap = forbiddenIds.has(item.id) || forbiddenContracts.has(contract) || forbiddenFamilies.has(item.familyId)
      || forbiddenShapes.has(implementationShape) || observedSourceOverlap;
    if (overlap) gaps.push('excluded historical/training/pilot case or family: ' + item.id);
    if (pack.usage === 'prospective-measurement' && item.runtime === 'cpp'
      && (!['clang-libc++', 'gcc-libstdc++'].includes(item.cppToolchain) || typeof item.compilerVersion !== 'string' || !item.compilerVersion.trim()))
      gaps.push('C++ execution profile is not frozen: ' + item.id);
    return { caseId: item.id, split: item.split, familyId: item.familyId, contractDigest: contract,
      privateOracleDigest: benefitDigest(item.vectors), referenceDigest: benefitDigest(item.reference),
      ...(item.nativeChecker ? { nativeCheckerDigest: benefitDigest(materializeNativeChecker(item, () => {})) } : {}),
      ...(item.privatePython ? { privatePythonDigest: benefitDigest(validateIsolatedPython(item.privatePython, item.reference)) } : {}),
      implementationShape, sourceId: item.provenance.sourceId,
      ...(tracksObservedSource ? { sourceIdentities: identities } : {}), provenanceDigest: benefitDigest(item.provenance),
      safetyRequired: item.safetyRequired === true, anchor: item.anchor ?? null };
  });
  return { cases, gaps, tracksObservedSource, allPriorPacks };
}

const nativeMembership = pack => pack.cases.map(({ split: _split, ...item }) => ({
  caseId: item.id, familyId: item.familyId, caseDigest: benefitDigest(item),
})).sort((a, b) => a.caseId.localeCompare(b.caseId, 'en'));

/** Recompute admission from source cases and independently replayed pilot evidence. */
export function buildSemanticMeasurementDesign(pack, priorPacks, headroom, trainingCaseIds = SEMANTIC_TRAINING_CASE_IDS, observedPacks = []) {
  assert(['RsiVerifiedHeadroom/v1', 'RsiVerifiedHeadroom/v2'].includes(headroom.schemaVersion)
    && headroom.qualified === true && headroom.providerCallsDuringReplay === 0, 'semantic-verified-headroom-required');
  const { cases, gaps, tracksObservedSource, allPriorPacks } = reviewedPopulationCases(pack, priorPacks,
    headroom.exclusions, trainingCaseIds, observedPacks);
  if (pack.executionKind === 'stdio-program' && pack.usage === 'prospective-measurement'
    && headroom.schemaVersion !== 'RsiVerifiedHeadroom/v2') gaps.push('native target population headroom has not been measured');
  if (headroom.schemaVersion === 'RsiVerifiedHeadroom/v2') {
    assert(pack.executionKind === 'stdio-program', 'semantic-native-headroom-population-kind');
    const target = new Map(headroom.target.cases.map(row => [row.caseId, row]));
    for (const row of nativeMembership(pack)) assert.deepEqual(row, target.get(row.caseId), 'semantic-headroom-target-case-drift:' + row.caseId);
    const reserved = new Set(headroom.exclusions.cases.map(row => row.familyId)), present = new Set(cases.map(row => row.caseId));
    if (headroom.target.cases.some(row => !reserved.has(row.familyId) && !present.has(row.caseId)))
      gaps.push('native target population remainder is incomplete');
    assert(headroom.measurement, 'semantic-native-measurement-reservation-required');
    const assignments = new Map(headroom.measurement.assignments.map(row => [row.caseId, row.split]));
    for (const item of pack.cases) if (!reserved.has(item.familyId))
      assert.equal(item.split, assignments.get(item.id), 'semantic-native-frozen-split-drift:' + item.id);
    gaps.push(...headroom.measurement.gaps);
  }
  const splits = Object.fromEntries(['validation', 'heldOut'].map(split => [split, cases.filter(row => row.split === split)]));
  const independentCases = Object.fromEntries(Object.entries(splits).map(([split, rows]) => [split,
    Math.min(new Set(rows.map(row => row.familyId)).size, new Set(rows.map(row => row.implementationShape)).size,
      tracksObservedSource ? new Set(rows.flatMap(row => row.sourceIdentities)).size : new Set(rows.map(row => row.sourceId)).size)]));
  const power = semanticPowerPlan();
  for (const [split, rows] of Object.entries(splits)) {
    if (independentCases[split] < power.requiredIndependentCases) gaps.push(`${split}: ${independentCases[split]}/${power.requiredIndependentCases} independent cases`);
    if (rows.length !== independentCases[split]) gaps.push(`${split}: related variants cannot be counted as independent cases`);
    if (rows.filter(row => row.safetyRequired).length < 3 || !rows.some(row => row.anchor === 'positive') || !rows.some(row => row.anchor === 'negative')) gaps.push(`${split}: safety/anchor coverage missing`);
  }
  if (pack.usage === 'scripted-control') gaps.push('scripted-control population cannot authorize model requests or benefit claims');
  return { schemaVersion: tracksObservedSource ? 'RsiSemanticStudyDesign/v3' : 'RsiSemanticStudyDesign/v2',
    driven_by: 'agent', actor: pack.actor, realHumanEvidence: false,
    ...(pack.executionKind ? { executionKind: pack.executionKind } : {}),
    populationDigest: benefitDigest(pack), priorPopulationDigests: allPriorPacks.map(benefitDigest), trainingCaseIds: [...trainingCaseIds],
    headroom, splits, independentCases, collectorVersion: 'RsiCodingCollector/v7', generatorVersion: 'RsiExperienceGenerator/v5',
    arms: ['sekb-off', 'sekb-confirmed'], repeatsPerArm: 3, primaryMetric: 'case-level pass^3',
    confidenceInterval: 'paired 95% interval over complete independent cases', thresholds: SEMANTIC_MEASURED_THRESHOLDS,
    power, toolCostPolicy: FILE_WRITE_TOOL_COST_POLICY, usage: pack.usage, gaps, measurementReady: gaps.length === 0,
    frozenBeforeCandidate: true, experienceBenefit: false, promotionReady: false, status: 'NO_GO' };
}

/** Freeze a language/toolchain-stratified pilot before observing any target outcome. */
export function buildNativeHeadroomDesign(pack, priorPacks, observedPacks, trainingCaseIds = SEMANTIC_TRAINING_CASE_IDS) {
  assert(pack.executionKind === 'stdio-program' && pack.usage === 'prospective-measurement', 'semantic-native-headroom-pack');
  assert(observedPacks.length > 0, 'semantic-native-headroom-observed-population-required');
  assert(observedPacks.every(history => Array.isArray(history.cases) && history.cases.length > 0),
    'semantic-native-headroom-nonempty-observed-population-required');
  const reviewed = reviewedPopulationCases(pack, priorPacks, { cases: [], priorFamilies: [] }, trainingCaseIds, observedPacks);
  assert.equal(reviewed.gaps.length, 0, 'semantic-native-headroom-ineligible-pool:' + reviewed.gaps.join('; '));
  assert(new Set(reviewed.cases.map(row => row.familyId)).size === pack.cases.length && pack.cases.length >= 12,
    'semantic-native-headroom-independent-families');
  const seed = 'rsi-native-headroom-v1', strata = new Map();
  for (const item of pack.cases) {
    const key = JSON.stringify([item.runtime, item.cppToolchain ?? null, item.compilerVersion ?? null,
      item.privatePython?.pythonVersion ?? null]);
    strata.set(key, [...(strata.get(key) ?? []), item]);
  }
  assert(strata.size <= 12, 'semantic-native-headroom-too-many-execution-strata');
  const groups = [...strata].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, items]) => ({ key, items,
    count: 1, ideal: items.length * 12 / pack.cases.length }));
  for (let remaining = 12 - groups.length; remaining > 0; remaining--) {
    const next = groups.filter(group => group.count < group.items.length)
      .sort((a, b) => (b.ideal - b.count) - (a.ideal - a.count) || a.key.localeCompare(b.key, 'en'))[0];
    assert(next, 'semantic-native-headroom-sample-capacity'); next.count++;
  }
  const rank = item => benefitDigest([seed, item.familyId, item.id]);
  const selectedIds = new Set(groups.flatMap(group => [...group.items]
    .sort((a, b) => rank(a).localeCompare(rank(b), 'en') || a.id.localeCompare(b.id, 'en')).slice(0, group.count).map(item => item.id)));
  const selected = reviewed.cases.filter(row => selectedIds.has(row.caseId)).sort((a, b) => a.caseId.localeCompare(b.caseId, 'en'));
  return { schemaVersion: 'RsiSemanticHeadroomDesign/v2', driven_by: 'agent', actor: 'codex/rsi-native-headroom', realHumanEvidence: false,
    prototypeDigest: benefitDigest(pack), priorPopulationDigests: reviewed.allPriorPacks.map(benefitDigest), trainingCaseIds: [...trainingCaseIds],
    target: { populationDigest: benefitDigest(pack), executionKind: 'stdio-program', cases: nativeMembership(pack) },
    measurement: reserveNativeMeasurementCases(reviewed.cases, selected.map(row => row.familyId)),
    sampling: { seed, method: 'Proportional execution strata, at least one family per stratum; fixed SHA256 rank within each stratum.',
      strata: groups.map(group => ({ key: group.key, families: group.items.length, selected: group.count })), selected },
    excludedFromFutureMeasurement: { cases: selected, priorFamilies: [], rule: 'Exclude every selected family before validation/final assignment.' },
    primaryMetric: 'case-level baseline pass^3', repeatsPerCase: 3, collectorVersion: 'RsiCodingCollector/v7', arms: ['sekb-off'],
    acceptance: { requireEveryPlannedCaseComplete: true, requireEverySlotIndependentlyGraded: true, requireKnownUsage: true,
      maximumBaselinePass3: 0.8, inferenceScope: 'sampled target population only' }, futurePower: semanticPowerPlan(),
    authorizationRequest: { approved: false, ...SEMANTIC_HEADROOM_ENVELOPE },
    measurementReady: false, experienceBenefit: false, promotionReady: false, status: 'NO_GO' };
}

/** Reserve both measured splits before pilot outcomes, preserving reviewed safety/anchor labels. */
export function reserveNativeMeasurementCases(cases, pilotFamilies) {
  assert(cases.length === new Set(cases.map(row => row.caseId)).size
    && cases.length === new Set(cases.map(row => row.familyId)).size, 'semantic-native-reservation-distinct-families');
  const reserved = new Set(pilotFamilies);
  assert(reserved.size === 12 && pilotFamilies.length === 12
    && [...reserved].every(family => cases.some(row => row.familyId === family)), 'semantic-native-reservation-pilot-families');
  const seed = 'rsi-native-measurement-split-v1', requiredPerSplit = semanticPowerPlan().requiredIndependentCases;
  const rank = row => benefitDigest([seed, row.familyId, row.caseId]);
  const remaining = cases.filter(row => !reserved.has(row.familyId))
    .map(row => ({ ...row, rank: rank(row) })).sort((a, b) => a.rank.localeCompare(b.rank, 'en'));
  const splits = { validation: [], heldOut: [] }, used = new Set();
  const take = (row, split) => { splits[split].push(row); used.add(row.caseId); };
  for (const anchor of ['positive', 'negative']) {
    const anchors = remaining.filter(row => row.anchor === anchor);
    for (const [index, split] of ['validation', 'heldOut'].entries()) if (anchors[index]) take(anchors[index], split);
  }
  for (const split of ['validation', 'heldOut']) {
    let safety = splits[split].filter(row => row.safetyRequired).length;
    for (const row of remaining) if (safety < 3 && row.safetyRequired && !used.has(row.caseId)) { take(row, split); safety++; }
  }
  for (const row of remaining) if (!used.has(row.caseId))
    take(row, splits.validation.length <= splits.heldOut.length ? 'validation' : 'heldOut');
  const gaps = [];
  for (const [split, rows] of Object.entries(splits)) {
    if (rows.length < requiredPerSplit) gaps.push(`${split}: ${rows.length}/${requiredPerSplit} reserved independent families`);
    if (rows.filter(row => row.safetyRequired).length < 3 || !rows.some(row => row.anchor === 'positive')
      || !rows.some(row => row.anchor === 'negative')) gaps.push(`${split}: reserved safety/anchor coverage missing`);
  }
  return { schemaVersion: 'RsiNativeMeasurementReservation/v1', seed, requiredPerSplit,
    minimumTargetFamilies: requiredPerSplit * 2 + 12, reservedPilotFamilies: [...reserved].sort(),
    assignments: Object.entries(splits).flatMap(([split, rows]) => rows.map(row => ({ caseId: row.caseId, familyId: row.familyId, split })))
      .sort((a, b) => a.caseId.localeCompare(b.caseId, 'en')),
    gaps, ready: gaps.length === 0 };
}

export function nativeMeasurementPack(pack, design) {
  assert.equal(design.target.populationDigest, benefitDigest(pack), 'semantic-native-measurement-target-drift');
  assert.deepEqual(design.measurement, reserveNativeMeasurementCases(pack.cases.map(item => ({ caseId: item.id,
    familyId: item.familyId, safetyRequired: item.safetyRequired === true, anchor: item.anchor ?? null })),
  design.excludedFromFutureMeasurement.cases.map(row => row.familyId)), 'semantic-native-measurement-reservation-drift');
  assert(design.measurement?.ready && design.measurement.gaps.length === 0, 'semantic-native-measurement-reservation-not-ready');
  const byId = new Map(pack.cases.map(item => [item.id, item]));
  const cases = design.measurement.assignments.map(row => {
    const item = byId.get(row.caseId);
    assert(item && item.familyId === row.familyId, 'semantic-native-measurement-assignment');
    return { ...item, split: row.split };
  });
  assert(cases.length === pack.cases.length - 12, 'semantic-native-measurement-remainder');
  return { ...pack, cases };
}

export function nativeHeadroomPack(pack, design) {
  assert.equal(design.target.populationDigest, benefitDigest(pack), 'semantic-native-headroom-target-drift');
  const byId = new Map(pack.cases.map(item => [item.id, item]));
  const cases = design.sampling.selected.map(row => byId.get(row.caseId));
  assert(cases.length === 12 && cases.every(Boolean), 'semantic-native-headroom-sample-drift');
  return { ...pack, cases };
}

/** Reuse the reserved prototype only for an explicitly unmeasured wiring control. */
export function semanticControlPopulation(pack, headroom) {
  const families = new Map(headroom.exclusions.cases.map(row => [row.caseId, row.familyId]));
  const groups = new Map();
  for (const item of pack.cases) {
    const family = families.get(item.id) ?? item.independenceGroup;
    groups.set(family, [...(groups.get(family) ?? []), item]);
  }
  const metrics = rows => [rows.length, rows.filter(row => row.safetyRequired).length,
    rows.filter(row => row.anchor === 'positive').length, rows.filter(row => row.anchor === 'negative').length];
  const total = metrics(pack.cases), half = total[0] / 2, subsets = new Map([['0,0,0,0', []]]);
  for (const [family, rows] of groups) for (const [state, selected] of [...subsets]) {
    const weight = metrics(rows), next = state.split(',').map((value, index) => Number(value) + weight[index]);
    if (next[0] <= half && next[1] <= total[1] - 3 && next[2] <= total[2] - 1 && next[3] <= total[3] - 1
      && !subsets.has(next.join(','))) subsets.set(next.join(','), [...selected, family]);
  }
  const selected = [...subsets].find(([state]) => { const [size, safety, positive, negative] = state.split(',').map(Number);
    return size === half && safety >= 3 && positive >= 1 && negative >= 1; });
  assert(selected, 'semantic-control-balanced-family-safety-anchors');
  const validation = new Set(selected[1]);
  return { ...pack, datasetVersion: 'RsiSemanticIndependentCases/v2', usage: 'scripted-control',
    actor: 'codex/rsi-semantic-measurement-control', realHumanEvidence: false,
    cases: pack.cases.map(item => {
      const familyId = families.get(item.id) ?? item.independenceGroup, sourceId = 'retained-prototype/' + item.id;
      return { ...item, split: validation.has(familyId) ? 'validation' : 'heldOut', familyId, independenceGroup: familyId, provenance: { sourceId, familyReview: {
        schemaVersion: 'RsiSemanticFamilyReview/v1', driven_by: 'agent', actor: 'codex/rsi-semantic-measurement-control',
        basis: 'Reserved prototype family; wiring control only, excluded from live measurement.', sourceId, familyId,
        contractDigest: contractKey(item), referenceDigest: benefitDigest(item.reference), privateOracleDigest: benefitDigest(item.vectors) } } };
    }) };
}

export const SEMANTIC_HEADROOM_ENVELOPE = Object.freeze({ maxProviderCalls: 145, maxTotalTokens: 2000000,
  currency: 'CNY', maxCost: 0, route: 'existing-free-quota', newPurchaseAllowed: false });
export const SEMANTIC_TRAINING_CASE_IDS = Object.freeze(['guided-train-utf8', 'guided-validation-atomic']);
const HEADROOM_SEED = 'rsi-headroom-20261113-v1';
// Related algorithms share a family even when their public entry points differ.
const familyAliases = Object.fromEntries(Object.entries({
  'utf8-codec': ['guided-train-utf8', 'semantic-decodepercentsegment'],
  'transactional-batch': ['guided-validation-atomic', 'experience-reconcilepatch', 'experience-reducecounteroperations',
    'semantic-distributedebit', 'semantic-applyinventorysale'],
  'interval-allocation': ['guided-train-ranges', 'experience-partitionrange', 'semantic-canreservecapacity',
    'semantic-assignmeetingrooms', 'semantic-intersectavailability'],
  'text-splicing': ['guided-train-replacement', 'semantic-applytextsplices'],
  'tiered-charge': ['semantic-priceprogressiveunits', 'semantic-calculateovertimepay'],
  'ip-address-codec': ['semantic-parseipv4cidr', 'semantic-expandipv6groups'],
  'vote-resolution': ['semantic-decideweightedquorum', 'semantic-instantrunoffwinner', 'semantic-resolveballotthresholds'],
  'checksum': ['semantic-validateluhndigits', 'semantic-checksumadler32'],
  'calendar-date': ['semantic-isoweekdate', 'semantic-parserfcdate'],
  'ranking-selection': ['experience-selectretention', 'semantic-stablelargestscores', 'semantic-selectauctionwinner', 'semantic-resolvetournamentseeds'],
  'rule-selection': ['experience-grantdecision', 'experience-matchacceptlanguage', 'semantic-selectfeaturerule'],
  'account-ledger': ['semantic-netaccounttransfers', 'semantic-auditdoubleentry'],
  'arithmetic-expression': ['semantic-tokenizearithmetic', 'semantic-evaluatepostfixintegers'],
}).flatMap(([family, ids]) => ids.map(id => [id, family])));
const familyOf = item => familyAliases[item.id] ?? item.independenceGroup ?? item.id;

/** The whole prototype is reserved for pilot use, including unsampled families. */
export function buildSemanticHeadroomDesign(pack, priorPacks, trainingCaseIds = SEMANTIC_TRAINING_CASE_IDS) {
  const prototype = buildSemanticStudyDesign(pack, priorPacks, trainingCaseIds);
  const priorFamilies = new Set([...priorPacks.flatMap(value => value.cases), ...trainingCaseIds.map(id => ({ id }))].map(familyOf));
  const population = Object.values(prototype.splits).flat().map(row => ({ ...row, familyId: familyOf({ id: row.caseId, independenceGroup: row.independenceGroup }) }));
  const rank = row => benefitDigest({ seed: HEADROOM_SEED, caseId: row.caseId });
  const eligible = population.filter(row => !priorFamilies.has(row.familyId)).sort((a, b) => rank(a).localeCompare(rank(b)));
  const selected = [], seen = new Set();
  for (const row of eligible) if (!seen.has(row.familyId)) { seen.add(row.familyId); selected.push(row); }
  assert(selected.length >= 12, 'semantic-headroom-independent-family-floor');
  return { schemaVersion: 'RsiSemanticHeadroomDesign/v1', driven_by: 'agent', actor: 'codex/rsi-semantic-headroom', realHumanEvidence: false,
    prototypeDigest: benefitDigest(pack), priorPopulationDigests: priorPacks.map(benefitDigest), trainingCaseIds: [...trainingCaseIds],
    sampling: { seed: HEADROOM_SEED, method: 'ascending sha256(seed,caseId); first case per eligible family; first 12 families', selected: selected.slice(0, 12) },
    excludedFromFutureMeasurement: { cases: population, priorFamilies: [...priorFamilies].sort(),
      rule: 'Exclude every prototype family, every observed prior family and every training family, including unsampled variants.' },
    primaryMetric: 'case-level pass^3', repeatsPerCase: 3, collectorVersion: 'RsiCodingCollector/v7', arms: ['sekb-off'],
    acceptance: { requireEveryPlannedCaseComplete: true, requireEverySlotIndependentlyGraded: true, requireKnownUsage: true,
      maximumBaselinePass3: prototype.headroom.maximumBaselinePass3ForPilot, inferenceScope: 'sampled pilot population only' },
    futurePower: semanticPowerPlan(), authorizationRequest: { approved: false, ...SEMANTIC_HEADROOM_ENVELOPE },
    measurementReady: false, experienceBenefit: false, promotionReady: false, status: 'NO_GO' };
}

export function semanticHeadroomPack(pack, design) {
  assert.equal(design.prototypeDigest, benefitDigest(pack), 'semantic-headroom-prototype-drift');
  const byId = new Map(pack.cases.map(item => [item.id, item]));
  const cases = design.sampling.selected.map(row => byId.get(row.caseId));
  assert(cases.length === 12 && cases.every(Boolean) && new Set(cases.map(item => familyOf(item))).size === 12,
    'semantic-headroom-case-family-drift');
  return { ...pack, datasetVersion: 'RsiSemanticHeadroomCases/v1',
    purpose: 'Frozen baseline-only headroom pilot. All prototype families are excluded from subsequent measurement.', cases };
}

export function summarizeSemanticHeadroom(plan, observations, accounting, ended) {
  assert.deepEqual(observations.map(row => row.slot), plan.slots, 'semantic-headroom-observation-coverage');
  const complete = Boolean(ended && ended.stopReason === null && observations.every(row => ['pass', 'fail'].includes(row.outcome)));
  const allGraded = observations.every(row => row.receipt?.grader != null);
  const knownUsage = observations.every(row => row.receipt?.providerAttempts.length > 0
    && row.receipt.providerAttempts.every(attempt => attempt.parsedResponse?.usage != null))
    && (plan.evidenceKind !== 'live-provider' || accounting !== null && accounting.unknownUsageRequests.length === 0);
  const cases = plan.headroom.sampling.selected.map(selected => {
    const rows = observations.filter(row => row.slot.caseId === selected.caseId);
    assert(rows.length === 3 && new Set(rows.map(row => row.slot.repeat)).size === 3, 'semantic-headroom-case-repeats');
    return { caseId: selected.caseId, familyId: selected.familyId, outcomes: rows.map(row => row.outcome),
      pass3: rows.every(row => row.outcome === 'pass') };
  });
  const baselinePass3 = complete ? cases.filter(row => row.pass3).length / cases.length : null;
  const gaps = [];
  if (plan.evidenceKind !== 'live-provider') gaps.push('scripted-control: model headroom is not measured');
  if (!complete) gaps.push('incomplete pilot: every scheduled case and repeat is required');
  if (!allGraded) gaps.push('ungraded slot: execution/format failures do not establish semantic difficulty');
  if (!knownUsage) gaps.push('unknown or missing provider usage');
  if (plan.evidenceKind === 'live-provider' && baselinePass3 !== null && baselinePass3 > plan.headroom.acceptance.maximumBaselinePass3) gaps.push('insufficient pilot headroom');
  const providerCalls = observations.reduce((sum, row) => sum + (row.receipt?.execution.providerCalls ?? 0), 0);
  const tokens = observations.flatMap(row => row.receipt?.providerAttempts ?? []).map(attempt => attempt.parsedResponse?.usage?.totalTokens ?? null);
  return { complete, allGraded, knownUsage, cases, baselinePass3, qualified: gaps.length === 0, gaps,
    headroomStatus: plan.evidenceKind !== 'live-provider' ? 'not-measured' : gaps.length === 0 ? 'qualified-pilot' : complete ? 'not-qualified' : 'not-measured',
    tokenMeasurementBasis: plan.evidenceKind === 'live-provider' ? 'provider-reported' : 'scripted-proxy',
    knownTaskTokens: tokens.reduce((sum, value) => sum + (value ?? 0), 0),
    observedTaskTokens: observations.every(row => row.receipt) && tokens.every(value => value !== null) ? tokens.reduce((sum, value) => sum + value, 0) : null,
    providerCalls, inferenceScope: 'sampled pilot population only', measurementReady: false, experienceBenefit: false, promotionReady: false };
}

/** Match every reported case to the frozen oracle, including expected missing-module baselines. */
export function verifySemanticOracleReport(registry, pack, phase, execution, report) {
  assert(['baseline', 'reference'].includes(phase) && execution.error === null && execution.signal === null,
    'semantic-oracle-process-error');
  assert.equal(execution.exitCode, phase === 'reference' ? 0 : 1, 'semantic-oracle-process');
  const pathKey = path => resolve(path).replaceAll('\\', '/');
  const rows = new Map(report.testResults.map(row => [pathKey(row.name), row]));
  assert(rows.size === registry.tasks.length && report.testResults.length === registry.tasks.length,
    'semantic-oracle-case-coverage');
  const cases = registry.tasks.map((task, index) => {
    const testPaths = task.oracle.testPaths.filter(path => path.endsWith('.test.mjs'));
    assert.equal(testPaths.length, 1, 'semantic-oracle-test-path');
    const row = rows.get(pathKey(resolve(execution.cwd, testPaths[0])));
    assert(row, 'semantic-oracle-case-identity');
    const assertions = row.assertionResults, missing = task.publicInput.baseFiles[0].missing === true;
    if (phase === 'baseline' && missing) {
      assert(row.status === 'failed' && assertions.length === 0
        && row.message.startsWith(`Cannot find module '../../${task.targetScope[0]}' imported from `),
      'semantic-unexpected-baseline-import-error');
    } else {
      assert.deepEqual(assertions.map(value => value.fullName).sort(),
        pack.cases[index].vectors.map((_, number) => 'contract-' + number).sort(), 'semantic-oracle-assertion-coverage');
      assert(assertions.every(value => ['passed', 'failed'].includes(value.status)), 'semantic-oracle-skipped');
      if (phase === 'reference') assert(row.status === 'passed' && assertions.every(value => value.status === 'passed'),
        'semantic-reference-failure');
      else assert(row.status === 'failed' && assertions.some(value => value.status === 'failed')
        && assertions.filter(value => value.status === 'failed').every(value => value.failureMessages.length > 0
          && value.failureMessages.every(message => message.startsWith('Error: unimplemented\n'))),
      'semantic-unexpected-baseline-failure');
    }
    return { caseId: task.id, outcome: phase === 'reference' ? 'pass' : missing ? 'expected-missing-module' : 'expected-unimplemented',
      passedAssertions: assertions.filter(value => value.status === 'passed').length,
      failedAssertions: assertions.filter(value => value.status === 'failed').length };
  });
  const passed = cases.reduce((sum, row) => sum + row.passedAssertions, 0), failed = cases.reduce((sum, row) => sum + row.failedAssertions, 0);
  assert.equal(report.numPassedTests, passed, 'semantic-oracle-count-drift');
  assert.equal(report.numFailedTests, failed, 'semantic-oracle-count-drift');
  assert.equal(report.numTotalTests, passed + failed, 'semantic-oracle-count-drift');
  assert(report.numPendingTests === 0 && (report.numTodoTests ?? 0) === 0, 'semantic-oracle-skipped');
  assert.equal(report.success, phase === 'reference', 'semantic-oracle-success-drift');
  return { cases, passedAssertions: passed, failedAssertions: failed };
}

export function verifyStdioOracleReport(registry, pack, phase, execution, report, { allowReferenceFailure = false } = {}) {
  assert(registry.tasks.length === 1 && pack.cases.length === 1 && registry.tasks[0].id === pack.cases[0].id
    && registry.tasks[0].publicInput.taskKind === 'stdio-program', 'semantic-stdio-oracle-contract');
  if (pack.cases[0].nativeChecker || pack.cases[0].privatePython) return verifyPrivateStdioOracleReport(
    registry, pack, phase, execution, report, allowReferenceFailure);
  assert(execution.error === null && execution.signal === null, 'semantic-stdio-process-error');
  const rejected = phase === 'reference' && allowReferenceFailure && report.passed === false;
  assert.equal(execution.exitCode, phase === 'reference' && !rejected ? 0 : 1, 'semantic-stdio-process');
  assert.equal(report.schemaVersion, 'RsiStdioOracleReport/v1', 'semantic-stdio-report-version');
  assert.equal(report.caseId, registry.tasks[0].id, 'semantic-stdio-case-identity');
  assert.equal(report.runtime, pack.cases[0].runtime, 'semantic-stdio-runtime');
  assert(report.compileError === null || (rejected && typeof report.compileError === 'string' && report.compileError.trim()),
    'semantic-stdio-reference-compilation');
  assert.equal(report.results.length, report.compileError === null ? pack.cases[0].vectors.length : 0, 'semantic-stdio-oracle-coverage');
  if (phase === 'reference') assert.equal(report.exitCodePolicy, 'normalized-output-match; process exit code is retained', 'semantic-stdio-exit-code-policy:' + report.caseId);
  if (phase === 'reference' && report.runtime === 'cpp') assert(['Ubuntu-22.04/WSL2-native-clang-libc++-C++17', 'Ubuntu-22.04/WSL2-native-gcc-libstdc++-C++17'].includes(report.executionEnvironment), 'semantic-stdio-execution-environment');
  if (phase === 'reference' && report.runtime === 'cpp') assert([report.executionEnvironment === 'Ubuntu-22.04/WSL2-native-clang-libc++-C++17'
    ? 'Clang/libc++ preserves reference semantics' : 'global visit name requires GNU libstdc++ to avoid std::visit collision',
  'frozen task profile'].includes(report.compilerSelection), 'semantic-stdio-compiler-selection');
  if (phase === 'reference' && report.runtime === 'cpp') assert.equal(report.sourceCompatibility, 'Linux compile copy: scanf %I64d -> %lld for glibc; frozen source unchanged', 'semantic-stdio-source-compatibility');
  const item = pack.cases[0];
  if (item.vectors.some(test => test.comparison === 'json'))
    assert.equal(report.outputComparison, 'per-vector-json-structural-or-text-normalization', 'semantic-stdio-comparison-policy');
  if (phase === 'reference' && item.cppToolchain) {
    assert.equal(report.executionEnvironment, item.cppToolchain === 'clang-libc++'
      ? 'Ubuntu-22.04/WSL2-native-clang-libc++-C++17' : 'Ubuntu-22.04/WSL2-native-gcc-libstdc++-C++17', 'semantic-stdio-frozen-toolchain');
    assert.equal(report.compiler, item.compilerVersion, 'semantic-stdio-frozen-compiler-version');
  }
  assert.equal(report.sourceMissing === true, phase === 'baseline', 'semantic-stdio-baseline-source');
  assert.deepEqual(report.counts, { total: item.vectors.length, passed: report.results.filter(row => row.passed).length,
    failed: report.results.filter(row => !row.passed).length, timedOut: report.results.filter(row => row.timedOut).length }, 'semantic-stdio-count-drift');
  report.results.forEach((row, index) => {
    assert.equal(row.index, index, 'semantic-stdio-test-order');
    assert.equal(row.testId, pack.cases[0].vectors[index].testId ?? null, 'semantic-stdio-test-identity');
    assert.equal(row.comparison ?? null, pack.cases[0].vectors[index].comparison ?? null, 'semantic-stdio-test-comparison');
    assert(typeof row.passed === 'boolean' && typeof row.timedOut === 'boolean', 'semantic-stdio-result-shape');
    if (!rejected) {
      assert.equal(row.passed, phase === 'reference', phase === 'reference' ? 'semantic-reference-failure' : 'semantic-unexpected-baseline-pass');
      assert.equal(row.timedOut, false, 'semantic-stdio-timeout');
    }
    if (phase === 'baseline') assert.equal(row.exitCode, null, 'semantic-stdio-baseline');
    else assert(typeof row.exitCode === 'number' || (rejected && row.error !== null && row.exitCode === null), 'semantic-stdio-exit-code');
    if (rejected) assert(row.error === null || typeof row.error === 'string', 'semantic-stdio-process-result');
    else assert.equal(row.error, report.sourceMissing ? 'source-missing' : null, 'semantic-stdio-process-result');
    if (phase === 'reference') assert(/^[a-f0-9]{64}$/u.test(row.stdoutDigest) && /^[a-f0-9]{64}$/u.test(row.stderrDigest), 'semantic-stdio-output-digests');
  });
  assert.equal(report.passed, phase === 'reference' && report.compileError === null
    && report.results.length === item.vectors.length && report.results.every(row => row.passed), 'semantic-stdio-outcome');
  return { cases: [{ caseId: report.caseId, outcome: rejected ? 'rejected-reference' : phase === 'reference' ? 'pass' : 'expected-unimplemented' }],
    passedAssertions: report.counts.passed, failedAssertions: report.counts.failed };
}

function verifyPrivateStdioOracleReport(registry, pack, phase, execution, report, allowReferenceFailure) {
  const item = pack.cases[0], python = Boolean(item.privatePython);
  const checker = python ? validateIsolatedPython(item.privatePython, item.reference) : materializeNativeChecker(item, () => {});
  const prefix = python ? 'semantic-isolated-python' : 'semantic-native-checker';
  assert.equal(report.schemaVersion, python ? 'RsiStdioOracleReport/v3' : 'RsiStdioOracleReport/v2', prefix + '-report-version');
  assert.equal(report.caseId, item.id, prefix + '-case');
  assert.equal(report.runtime, item.runtime, prefix + '-runtime');
  assert.equal(report.outputComparison, python ? ISOLATED_PYTHON_VERSION : NATIVE_CHECKER_VERSION, prefix + '-comparison');
  assert.equal(report[python ? 'privatePythonDigest' : 'nativeCheckerDigest'], benefitDigest(checker), prefix + '-digest');
  assert.equal(execution.error, null, prefix + '-process-error');
  assert.equal(execution.signal, null, prefix + '-process-signal');
  assert.notEqual(report.failureClass, 'infrastructure', prefix + '-infrastructure');
  const rejected = phase === 'reference' && allowReferenceFailure && report.passed === false;
  assert.equal(execution.exitCode, phase === 'reference' && !rejected ? 0 : 1, prefix + '-process-exit');
  assert.equal(report.sourceMissing === true, phase === 'baseline', prefix + '-baseline');
  assert.equal(report.results.length, report.compileError === null ? item.vectors.length : 0, prefix + '-coverage');
  assert.deepEqual(report.counts, { total: item.vectors.length, passed: report.results.filter(row => row.passed).length,
    failed: report.results.filter(row => !row.passed).length, timedOut: report.results.filter(row => row.timedOut).length },
  prefix + '-counts');
  if (phase === 'reference' || python && phase !== 'baseline') {
    assert.equal(report.workerReportVersion, python ? 'RsiIsolatedPythonWorker/v1' : 'RsiNativeCheckerWorker/v2', prefix + '-worker-version');
    assert.equal(report[python ? 'pythonVersion' : 'compiler'], checker[python ? 'pythonVersion' : 'compilerVersion'], prefix + '-compiler');
    assert.equal(report.exitCodePolicy, python ? 'completed-program-exit-zero-and-frozen-text-normalization'
      : 'completed-program-and-official-checker-exit-zero', prefix + '-exit-policy');
    assert(typeof execution.cwd === 'string', prefix + '-evidence-workspace');
    if (python) verifyIsolatedPythonEvidence(report, item, execution.cwd);
    else {
      assert.equal(report.executionEnvironment, 'Ubuntu-22.04/WSL2-isolated-native-checker-C++17', prefix + '-isolation');
      assert.equal(report.normalization, 'none; native checker owns output semantics', prefix + '-normalization');
      verifyNativeCheckerEvidence(report, { ...item, nativeChecker: checker }, execution.cwd);
    }
  }
  for (const [index, row] of report.results.entries()) {
    assert.equal(row.index, index, prefix + '-test-order');
    assert.equal(row.testId, item.vectors[index].testId ?? null, prefix + '-test-id');
    if (!rejected) assert.equal(row.passed, phase === 'reference', prefix + '-reference-outcome');
    if (phase === 'baseline') assert.equal(row.error, 'source-missing', prefix + '-baseline-error');
  }
  assert.equal(report.passed, phase === 'reference' && report.compileError === null
    && report.results.length === item.vectors.length && report.results.every(row => row.passed), prefix + '-outcome');
  return { cases: [{ caseId: item.id, outcome: rejected ? 'rejected-reference' : phase === 'reference' ? 'pass' : 'expected-unimplemented' }],
    passedAssertions: report.counts.passed, failedAssertions: report.counts.failed };
}
