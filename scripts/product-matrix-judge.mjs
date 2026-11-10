import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RUBRIC_SYSTEM_PROMPT, VERDICTS } from './lib/agent-first-graders.mjs';
import { repositoryIdentity, sha256, sha256File } from './lib/agent-engineering-acceptance.mjs';
import { matrixOutputDirectory } from './product-acceptance-matrix.mjs';
import { readSpaceBunnyResource, redactSpaceBunny } from '../tests/e2e/fixtures/space-bunny-responses.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUBRIC = 'harness/specs/fixtures/product-acceptance-matrix/judge-rubric.json';

export function parseJudgeResponse(response) {
  const unavailable = { verdict: 'unknown', valid: false, reason: 'A complete structured judge response is required' };
  if (response?.status !== 'completed' || typeof response.id !== 'string' || !response.id.trim()
    || typeof response.model !== 'string' || !response.model.trim() || response.error || response.incomplete_details || !Array.isArray(response.output)) return unavailable;
  const text = response.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n').trim();
  try {
    const value = JSON.parse(text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
    if (!VERDICTS.includes(value?.verdict) || typeof value.reason !== 'string' || !value.reason.trim()
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['reason', 'verdict'])) return unavailable;
    return { verdict: value.verdict, valid: true, reason: value.reason };
  } catch { return unavailable; }
}

export function gradeJudgeVotes(receipts, expectedModel = 'space-bunny') {
  const votes = receipts.map(receipt => parseJudgeResponse(receipt.response));
  const valid = receipts.length === 3 && receipts.every(receipt => receipt.httpStatus === 200 && !receipt.error)
    && votes.every(vote => vote.valid) && new Set(receipts.map(receipt => receipt.response.id)).size === 3
    && receipts.every(receipt => receipt.response.model === expectedModel);
  const counts = Object.fromEntries(VERDICTS.map(verdict => [verdict, votes.filter(vote => vote.verdict === verdict).length]));
  return { valid, verdict: !valid ? 'unknown' : counts.fail >= 2 ? 'fail' : counts.pass >= 2 ? 'pass' : 'unknown', votes, counts };
}

export function gradeReviewSample(sample, receipts, expectedModel = 'space-bunny') {
  const grade = gradeJudgeVotes(receipts, expectedModel);
  const evidenceAvailable = Boolean(sample?.facts && typeof sample.facts === 'object' && Object.keys(sample.facts).length
    && typeof sample.explanation === 'string' && sample.explanation.trim());
  return { ...grade, modelVerdict: grade.verdict, evidenceAvailable, valid: grade.valid && evidenceAvailable,
    verdict: evidenceAvailable ? grade.verdict : 'unknown',
    ...(!evidenceAvailable ? { reason: 'Facts and explanation are required for a qualitative verdict' } : {}) };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { calibrate: { type: 'boolean' }, review: { type: 'string' }, output: { type: 'string' } } });
  if ([values.calibrate, values.review].filter(Boolean).length !== 1 || !values.output) throw new Error('Use --calibrate or --review <samples.json>, plus --output <fresh-directory>');
  const rubric = JSON.parse(readFileSync(resolve(ROOT, RUBRIC), 'utf8'));
  if (rubric.promptSha256 !== sha256(RUBRIC_SYSTEM_PROMPT) || rubric.calibrationSourceSha256 !== sha256File(resolve(ROOT, rubric.calibrationSource))
    || rubric.votes !== 3 || rubric.model !== 'space-bunny') throw new Error('Frozen rubric or calibration samples changed');
  const calibration = JSON.parse(readFileSync(resolve(ROOT, rubric.calibrationSource), 'utf8')).rubric;
  const review = values.review ? JSON.parse(readFileSync(resolve(values.review), 'utf8')) : [];
  if (!Array.isArray(review) || review.some(sample => typeof sample?.id !== 'string' || !sample.id.trim())
    || new Set(review.map(sample => sample.id)).size !== review.length || (values.review && !review.length)) throw new Error('Review input must contain unique named samples with facts and explanation');
  const candidate = repositoryIdentity(ROOT);
  if (!candidate.clean) throw new Error('Judge execution requires a clean committed candidate');
  const resource = readSpaceBunnyResource();
  const output = matrixOutputDirectory(values.output);
  if (existsSync(output)) throw new Error('Judge output directory must be new');
  mkdirSync(output, { recursive: true });
  const save = (name, value) => writeFileSync(resolve(output, name), redactSpaceBunny(JSON.stringify(value, null, 2)) + '\n');
  save('rubric.json', rubric);
  save('samples.json', { calibration, review });
  const rows = [];
  for (const [kind, samples] of [['calibration', calibration], ['review', review]]) {
    if (kind === 'review' && rows.some(row => !row.matched)) break;
    for (const sample of samples) {
      const receipts = [];
      for (let vote = 0; vote < rubric.votes; vote++) {
        const request = { model: resource.model, stream: false, temperature: rubric.temperature, max_output_tokens: rubric.maxOutputTokens,
          instructions: RUBRIC_SYSTEM_PROMPT, input: [{ role: 'user', content: redactSpaceBunny(JSON.stringify({ facts: sample.facts ?? null, explanation: sample.explanation ?? null })) }] };
        const receipt = { driven_by: 'agent', actor: 'product-matrix-judge', vote, startedAt: new Date().toISOString(), request,
          requestSha256: sha256(JSON.stringify(request)), httpStatus: null, response: null, responseText: null, error: null };
        try {
          const result = await fetch(resource.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${resource.apiKey}` },
            body: JSON.stringify(request), signal: AbortSignal.timeout(60_000) });
          receipt.httpStatus = result.status;
          const raw = redactSpaceBunny(await result.text());
          receipt.responseText = raw;
          receipt.rawResponseSha256 = sha256(raw);
          receipt.response = JSON.parse(raw);
        } catch (error) { receipt.error = redactSpaceBunny(String(error)); }
        receipt.finishedAt = new Date().toISOString();
        receipt.responseSha256 = sha256(JSON.stringify(receipt.response));
        receipts.push(receipt);
        save(`sample-${rows.length + 1}.json`, { kind, id: sample.id, receipts });
      }
      const grade = kind === 'review' ? gradeReviewSample(sample, receipts, rubric.model) : gradeJudgeVotes(receipts, rubric.model);
      rows.push({ kind, id: sample.id, ...(kind === 'calibration' ? { expected: sample.expected, matched: grade.valid && grade.verdict === sample.expected } : {}),
        ...grade, ...(kind === 'review' ? { verification: grade.verdict === 'unknown' ? 'unverified' : grade.verdict } : {}), receipts: `sample-${rows.length + 1}.json` });
      console.log(JSON.stringify({ kind, id: sample.id, verdict: grade.verdict, valid: grade.valid }));
      if (!grade.valid) break;
    }
  }
  const after = repositoryIdentity(ROOT);
  const unchanged = candidate.commit === after.commit && candidate.tree === after.tree && after.clean;
  const calibrated = unchanged && rows.filter(row => row.kind === 'calibration').length === calibration.length
    && rows.filter(row => row.kind === 'calibration').every(row => row.matched);
  const passed = calibrated && rows.filter(row => row.kind === 'review').length === review.length
    && rows.filter(row => row.kind === 'review').every(row => row.valid && row.verdict === 'pass');
  const files = ['rubric.json', 'samples.json', ...rows.map(row => row.receipts)];
  const report = { schema: 'ProductMatrixJudgeRun/v1', driven_by: 'agent', actor: 'product-matrix-judge', candidate, candidateAfter: after,
    dimension: rubric.dimension, nodeAcceptance: 'incomplete', calibrated, qualitativePassed: passed, rows,
    artifacts: files.map(path => ({ path, sha256: sha256File(resolve(output, path)) })) };
  save('report.json', report);
  return passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(redactSpaceBunny(error.message)); process.exitCode = 1; });
}
