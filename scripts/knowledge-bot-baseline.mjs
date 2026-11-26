import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = 'tests/fixtures/knowledge-bot-baseline';
const probe = 'tests/unit/knowledge-bot-baseline.test.tsx';
const inputs = [`${fixtures}/corpus.json`, `${fixtures}/oracle.json`, `${fixtures}/README.md`, `${fixtures}/gateway.ts`, probe, 'scripts/knowledge-bot-baseline.mjs'];
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 128 * 1024 * 1024, windowsHide: true });
const sources = ['src', 'electron', 'shared', 'openclaw_runtime/src', 'openclaw_runtime/extensions/memory-wiki', 'vitest.config.ts', 'pnpm-lock.yaml', 'package.json'];

function productIdentity() {
  const extra = git('ls-files', '--others', '--exclude-standard', '-z', '--', ...sources).toString().split('\0').filter(Boolean).sort();
  return { commit: git('rev-parse', 'HEAD').toString().trim(), tree: git('rev-parse', 'HEAD^{tree}').toString().trim(),
    dirty: git('status', '--porcelain=v1', '--untracked-files=all').length > 0,
    workingDiff: digest(git('diff', '--binary', '--no-ext-diff', 'HEAD', '--', ...sources)),
    untracked: Object.fromEntries(extra.map(file => [file, digest(readFileSync(join(root, file)))])) };
}

function citationOK(citation, answer, corpus) {
  const pin = citation.sourceRef, loc = pin?.locator;
  const page = corpus.sources.find(row => row.id === pin?.subjectId);
  const chunk = answer.sources.find(row => row.citation?.refId === citation.sourceId)?.citation;
  const broad = chunk?.sourceRef?.locator;
  if (!page || !loc || !broad || !citation.quote || pin.revision !== page.rev ||
      ![loc.startByte, loc.endByteExclusive, broad.startByte, broad.endByteExclusive].every(Number.isSafeInteger) ||
      loc.startByte < 0 || loc.endByteExclusive <= loc.startByte || broad.startByte < 0 ||
      chunk.sourceRef.subjectId !== page.id || chunk.revision !== page.rev || loc.coordinateSpace !== 'raw-source-utf8-v1' ||
      pin.authorityId !== chunk.sourceRef.authorityId || pin.namespaceId !== chunk.sourceRef.namespaceId ||
      loc.startByte < broad.startByte || loc.endByteExclusive > broad.endByteExclusive) return false;
  const raw = Buffer.from([page.body, ...Array.from({ length: page.trailingLines ?? 0 }, (_, i) => 'Background note ' + i), ...(page.tail ? [page.tail] : [])].join('\n'));
  if (broad.endByteExclusive > raw.length) return false;
  const quote = raw.subarray(loc.startByte, loc.endByteExclusive), part = raw.subarray(broad.startByte, broad.endByteExclusive);
  return quote.equals(Buffer.from(citation.quote)) && digest(raw) === citation.sourceDigest && pin.sourceDigest === citation.sourceDigest &&
    digest(quote) === citation.quoteDigest && digest(part) === citation.chunkDigest && chunk.contentDigest === citation.chunkDigest;
}

function gradeCase(record, expected, corpus) {
  const answer = record.answer;
  if (record.hostError && !answer?.success) {
    return { caseId: record.caseId, hostError: record.hostError, passed: false, steps: record.actions.length,
      cells: expected.fields.map(([name, want]) => ({ name, expected: want, returned: [], covered: false, correct: false })),
      claims: 0, resolved: 0, draftCount: record.drafts.length, reviewCount: record.reviews.length };
  }
  assert.ok(answer?.success, 'Missing Host outcome: ' + record.caseId);
  const claims = (answer.claims ?? []).filter(claim => claim.kind === 'source');
  const rendered = record.display ?? '';
  const actual = claims.map(claim => {
    const field = claim.text.match(/^([^：:]+)[：:]\s*(.+)$/u);
    const resolves = claim.citations.length > 0 && claim.citations.every(c => citationOK(c, answer, corpus));
    return { name: field?.[1].trim(), value: field?.[2].trim(), origins: claim.citations.map(c => c.sourceRef?.subjectId), resolves, shown: rendered.includes(claim.text) };
  });
  const cells = expected.fields.map(([name, want]) => {
    const matches = actual.filter(f => f.name === name && f.shown);
    const origins = expected.fieldOrigins?.[name] ?? expected.allowed;
    const distinct = [...new Set(matches.map(row => row.value))];
    return { name, expected: want, returned: distinct, covered: matches.length > 0,
      correct: distinct.length === 1 && distinct[0] === want && matches.every(f => f.origins.length && f.origins.every(id => origins.includes(id))) };
  });
  const sourceIds = [...new Set([...answer.sources.map(src => src.lookup), ...record.modelInputs.flatMap(input => input.sources)])];
  const scopeOK = sourceIds.every(id => expected.allowed.includes(id));
  const missing = answer.model?.status === 'completed' && answer.unknowns.length > 0 && actual.length === 0;
  const stateOK = expected.state === 'conflict' ? Boolean(answer.conflictSet?.length) && actual.length === 0 :
    expected.state === 'revoked' ? Boolean(answer.rejections?.some(r => /revok|withdraw/i.test(r.reason))) && actual.length === 0 && !JSON.stringify(answer).includes(expected.forbidden) :
    expected.state === 'partial' ? missing && answer.sources.some(src => src.readRange?.truncated) :
    expected.state === 'missing' ? missing && answer.sources.length > 0 && answer.sources.every(src => !src.readRange?.truncated) : true;
  const targetOK = !expected.reviewTarget || record.drafts.some(draft => draft.metadata?.target === expected.reviewTarget ||
    draft.metadata?.targetPageId === expected.reviewTarget);
  const effectsOK = record.drafts.length === (expected.drafts ?? 0) && record.reviews.length === (expected.reviews ?? 0) &&
    record.reviews.every(id => record.drafts.some(draft => draft.id === id)) && !record.methods.some(method => method === 'wiki.apply') && targetOK;
  const unresolved = actual.filter(c => !c.resolves || !c.shown).length;
  return { caseId: record.caseId, scopeOK, sourceIds, stateOK, effectsOK, targetOK, cells, claims: actual.length, resolved: actual.length - unresolved,
    draftCount: record.drafts.length, reviewCount: record.reviews.length, steps: record.actions.length,
    passed: scopeOK && stateOK && effectsOK && !unresolved && cells.every(cell => cell.correct) };
}

function grade(dir) {
  const manifest = read(join(dir, 'manifest.json')), terminal = read(join(dir, 'terminal.json'));
  assert.equal(terminal.status, 'captured');
  assert.equal(terminal.runId, manifest.runId);
  assert.equal(terminal.manifestDigest, digest(readFileSync(join(dir, 'manifest.json'))));
  assert.deepEqual(Object.keys(manifest.inputs).sort(), [...inputs].sort(), 'incomplete frozen input set');
  for (const [file, hash] of Object.entries(manifest.inputs)) assert.equal(digest(readFileSync(join(dir, 'frozen', basename(file)))), hash, file);
  assert.equal(digest(readFileSync(fileURLToPath(import.meta.url))), manifest.inputs['scripts/knowledge-bot-baseline.mjs'], 'grader revision');
  const corpus = read(join(dir, 'frozen/corpus.json')), oracle = read(join(dir, 'frozen/oracle.json'));
  const ids = corpus.cases.map(task => task.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.keys(oracle.cases).sort());
  assert.deepEqual([...ids].sort(), Object.keys(terminal.records).sort());
  const cases = ids.map(id => {
    const file = join(dir, 'raw', id + '.json'); assert.equal(digest(readFileSync(file)), terminal.records[id], id);
    const record = read(file); assert.equal(record.caseId, id);
    return gradeCase(record, oracle.cases[id], corpus);
  });
  const ratio = (n, d) => ({ numerator: n, denominator: d, fraction: d ? n / d : null });
  const fields = cases.flatMap(c => c.cells), covered = fields.filter(f => f.covered).length;
  return { runId: manifest.runId, candidate: manifest.product, scope: 'production renderer/jsdom and Host, fixture Gateway/model/DCS', cases,
    metrics: { fieldAccuracy: ratio(fields.filter(f => f.correct).length, covered), fieldCoverage: ratio(covered, fields.length),
      claimTraceability: ratio(cases.reduce((sum,c) => sum+c.resolved,0), cases.reduce((sum,c) => sum+c.claims,0)),
      taskCompletion: ratio(cases.filter(c => c.passed).length,cases.length), externalProviderCalls: 0, productionCost: null } };
}

function collect(dir) {
  if (process.platform === 'win32' && !/^d:/i.test(dir)) throw Error('Use a new output directory on D:');
  mkdirSync(dir);
  const frozen = join(dir,'frozen');mkdirSync(frozen);
  const inputHashes = {};
  for (const name of inputs) { const file=join(root,name);copyFileSync(file,join(frozen,basename(name)));inputHashes[name]=digest(readFileSync(file)); }
  const manifest = { schema: 1, runId: randomUUID(), actor: 'codex-knowledge-bot-baseline', driven_by: 'agent', at: new Date().toISOString(),
    workspace: root, node: process.version, product: productIdentity(), inputs: inputHashes };
  save(join(dir,'manifest.json'),manifest);
  const log=openSync(join(dir,'vitest.log'),'wx');
  let child;
  try { child=spawnSync(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run',probe,'--maxWorkers=1','--no-file-parallelism'],{
    cwd:root,env:{...process.env,CLAWX_KB_BASELINE_RAW:join(dir,'raw')},stdio:['ignore',log,log],windowsHide:true }); }
  finally {closeSync(log);}
  const records = {};
  for (const task of read(join(frozen,'corpus.json')).cases) {
    const file = join(dir,'raw',task.id+'.json'); if (existsSync(file)) records[task.id]=digest(readFileSync(file));
  }
  const stable = JSON.stringify(productIdentity()) === JSON.stringify(manifest.product) && inputs.every(f=>digest(readFileSync(join(root,f)))===inputHashes[f]);
  const status=child.status===0 && !child.error && stable ? 'captured' : 'capture-failed';
  save(join(dir,'terminal.json'),{status,runId:manifest.runId,records,sourceStable:stable,exitCode:child.status,
    manifestDigest:digest(readFileSync(join(dir,'manifest.json'))),error:child.error?.message,signal:child.signal});
  if(status!=='captured')throw Error('Capture failed. See '+join(dir,'vitest.log'));
  const report=grade(dir);save(join(dir,'report.json'),report);console.log(JSON.stringify(report.metrics));
}
const args=process.argv.slice(2);
if(args.length===2 && args[0]==='--grade') console.log(JSON.stringify(grade(resolve(args[1])),null,2));
else if(args.length===1) collect(resolve(args[0]));
else throw Error('Expected a new run directory, or --grade <existing run directory>');
