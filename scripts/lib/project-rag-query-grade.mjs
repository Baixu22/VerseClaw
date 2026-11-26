import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeCorpusFile, sha256, spanText } from './project-rag-corpus.mjs';

export const RAG_QUERY_EVALUATOR_VERSION = 'owner-support-coverage/v3';

const identity = source => JSON.stringify([source.domain, source.authorityId, source.namespaceId,
  source.subjectId, source.revision, source.sourceDigest, source.policyEpoch]);
const gain = grade => 2 ** grade - 1;
const dcg = grades => grades.slice(0, 5).reduce((sum, grade, index) => sum + gain(grade) / Math.log2(index + 2), 0);

function mergeRanges(ranges, next) {
  const merged = [];
  for (const range of [...ranges, next].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

// Match each gold fact to at most one of the five ranked hits, and each hit to
// at most one fact. A later improvement can replace partial evidence without
// counting duplicate facts twice. Five ranks require only 32 assignment states.
function rankedGain(facts) {
  let scores = new Map([[0, 0]]);
  for (const fact of facts) {
    const next = new Map(scores);
    for (const [mask, score] of scores) {
      for (const [rank, grade] of fact.rankGrades.entries()) {
        const bit = 1 << rank;
        if (!grade || (mask & bit)) continue;
        const value = score + gain(grade) / Math.log2(rank + 2);
        next.set(mask | bit, Math.max(next.get(mask | bit) ?? 0, value));
      }
    }
    scores = next;
  }
  return Math.max(...scores.values());
}

/** Grade complete support coverage separately from overlap, using pinned bytes. */
export function gradeRagQuery(bundle, queryId, observation) {
  const gold = bundle.gold.find(row => row.queryId === queryId);
  assert(gold && observation && Array.isArray(observation.results) && observation.results.length <= 120, 'Invalid frozen query observation');
  const factKeys = new Set();
  const facts = gold.facts.map(fact => {
    const required = fact.support ?? fact.sourceRef.locator;
    assert(required && Number.isSafeInteger(required.startByte) && Number.isSafeInteger(required.endByteExclusive)
      && required.startByte >= 0 && required.endByteExclusive > required.startByte, 'Invalid gold support range');
    const pin = identity(fact.sourceRef), key = JSON.stringify([pin, required.startByte, required.endByteExclusive]);
    assert(!factKeys.has(key), 'Duplicate gold support range'); factKeys.add(key);
    return { pin, start: required.startByte, end: required.endByteExclusive, ranges: [], bytes: 0, rankGrades: Array(5).fill(0) };
  });
  const rawSources = new Map();
  const seenHits = new Set();
  let pinErrors = 0;
  for (const [rank, hit] of observation.results.entries()) {
    const source = hit?.sourceRef;
    if (!source || !source.locator || !Number.isSafeInteger(source.locator.startByte)
      || !Number.isSafeInteger(source.locator.endByteExclusive) || source.locator.startByte < 0
      || source.locator.coordinateSpace !== 'raw-source-utf8-v1'
      || source.locator.endByteExclusive <= source.locator.startByte) {
      pinErrors += 1; continue;
    }
    const known = bundle.corpus.sources.find(known => identity(known.ref) === identity(source));
    if (!known) {
      pinErrors += 1; continue;
    }
    try {
      if (!rawSources.has(known.path)) rawSources.set(known.path, readFileSync(safeCorpusFile(bundle.root, known.path)));
      const raw = rawSources.get(known.path);
      assert.equal(sha256(raw), source.sourceDigest, 'Owner source bytes changed');
      spanText(raw, source.locator);
    } catch { pinErrors += 1; continue; }
    if (rank >= 20) continue;
    const hitKey = JSON.stringify([identity(source), source.locator.startByte, source.locator.endByteExclusive]);
    if (seenHits.has(hitKey)) continue;
    seenHits.add(hitKey);
    for (const fact of facts) {
      if (identity(source) !== fact.pin) continue;
      const start = Math.max(source.locator.startByte, fact.start);
      const end = Math.min(source.locator.endByteExclusive, fact.end);
      if (end <= start) continue;
      fact.ranges = mergeRanges(fact.ranges, [start, end]);
      const bytes = fact.ranges.reduce((sum, range) => sum + range[1] - range[0], 0);
      if (rank < 5) {
        // Ranking grades this hit alone; union coverage is a separate recall
        // metric and cannot lend another hit's bytes to this rank.
        const fraction = (end - start) / (fact.end - fact.start);
        fact.rankGrades[rank] = fraction === 1 ? 3 : fraction >= 0.8 ? 2 : 1;
      }
      fact.bytes = bytes;
    }
  }
  const ideal = dcg(facts.map(() => 3));
  assert(Number.isSafeInteger(observation.safetyViolations) && observation.safetyViolations >= 0, 'Actual safety count is required');
  return { queryId, evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, ndcg5: ideal ? rankedGain(facts) / ideal : 0,
    recallAt20: facts.length ? facts.filter(fact => fact.bytes === fact.end - fact.start).length / facts.length : 0,
    overlapRecallAt20: facts.length ? facts.filter(fact => fact.bytes > 0).length / facts.length : 0,
    supportCoverageAt20: facts.length ? facts.reduce((sum, fact) => sum + fact.bytes / (fact.end - fact.start), 0) / facts.length : 0,
    exactRefPrecision: pinErrors === 0 && observation.ownerPinsVerified === true ? 1 : 0,
    safetyViolations: observation.safetyViolations + pinErrors, gradingMode: RAG_QUERY_EVALUATOR_VERSION };
}
