import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeCorpusFile, spanText } from './project-rag-corpus.mjs';

const identity = source => JSON.stringify([source.domain, source.authorityId, source.namespaceId,
  source.subjectId, source.revision, source.sourceDigest, source.policyEpoch]);
const gain = grade => 2 ** grade - 1;
const dcg = grades => grades.slice(0, 5).reduce((sum, grade, index) => sum + gain(grade) / Math.log2(index + 2), 0);

/** Grade owner/version/raw-span relevance, keeping first occurrence per gold span. */
export function gradeRagQuery(bundle, queryId, observation) {
  const gold = bundle.gold.find(row => row.queryId === queryId);
  assert(gold && observation && Array.isArray(observation.results) && observation.results.length <= 120, 'Invalid frozen query observation');
  const seen = new Set(), recalled = new Set(), grades = [];
  let pinErrors = 0;
  for (const [rank, hit] of observation.results.entries()) {
    const source = hit?.sourceRef;
    let grade = 0;
    if (!source || !source.locator || !Number.isSafeInteger(source.locator.startByte)
      || !Number.isSafeInteger(source.locator.endByteExclusive) || source.locator.startByte < 0
      || source.locator.coordinateSpace !== 'raw-source-utf8-v1'
      || source.locator.endByteExclusive <= source.locator.startByte) {
      pinErrors += 1; grades.push(0); continue;
    }
    const known = bundle.corpus.sources.find(known => identity(known.ref) === identity(source));
    if (!known) {
      pinErrors += 1; grades.push(0); continue;
    }
    try { spanText(readFileSync(safeCorpusFile(bundle.root, known.path)), source.locator); }
    catch { pinErrors += 1; grades.push(0); continue; }
    for (const [index, fact] of gold.facts.entries()) {
      if (identity(source) !== identity(fact.sourceRef)) continue;
      const required = fact.support ?? fact.sourceRef.locator;
      const overlap = Math.max(0, Math.min(source.locator.endByteExclusive, required.endByteExclusive)
        - Math.max(source.locator.startByte, required.startByte));
      if (!overlap) continue;
      if (rank < 20) recalled.add(index);
      const key = `${identity(source)}:${required.startByte}:${required.endByteExclusive}`;
      if (seen.has(key)) continue;
      seen.add(key);
      grade = Math.max(grade, overlap >= required.endByteExclusive - required.startByte ? 3
        : overlap / (required.endByteExclusive - required.startByte) >= 0.8 ? 2 : 1);
    }
    grades.push(grade);
  }
  const ideal = dcg(gold.facts.map(() => 3));
  assert(Number.isSafeInteger(observation.safetyViolations) && observation.safetyViolations >= 0, 'Actual safety count is required');
  return { queryId, ndcg5: ideal ? dcg(grades) / ideal : 0,
    recallAt20: gold.facts.length ? recalled.size / gold.facts.length : 0,
    exactRefPrecision: pinErrors === 0 && observation.ownerPinsVerified === true ? 1 : 0,
    safetyViolations: observation.safetyViolations + pinErrors, gradingMode: 'frozen-owner-version-raw-span' };
}
