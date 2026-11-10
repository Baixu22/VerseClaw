// @vitest-environment node
import { mkdtempSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bindRagExperiment, evaluateRagTaskPromotion, gradeRagTaskArtifact, jsonBytes, loadFrozenRagCorpus,
  materializeRagTask, sha256, spanText, type FrozenRagBundle } from '../../scripts/lib/project-rag-corpus.mjs';
import { createMemoryWikiReadContext, getMemoryWikiPage, memoryWikiNamespaceId, readMemoryWikiOwnerSnapshot, resolveMemoryWikiConfig } from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { toWikiPageSummary } from '../../openclaw_runtime/extensions/memory-wiki/src/markdown';

const versionRoot = resolve('harness/specs/fixtures/project-rag/v4');
const release = JSON.parse(readFileSync('harness/specs/fixtures/project-rag/release-v4.json', 'utf8'));
const bundle = () => loadFrozenRagCorpus(versionRoot, release.freezeDigest);
const temporaries: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'project-rag-corpus-')); temporaries.push(root); return root; };
afterEach(() => { for (const root of temporaries.splice(0)) rmSync(root, { recursive: true, force: true }); });
const namespace = (vault: string) => memoryWikiNamespaceId(resolveMemoryWikiConfig({ vault: { path: vault } }));
const unseal = (b: FrozenRagBundle) => ({ heldOutRelease: { corpusDigest: b.freezeDigest,
  cleanCandidate: '1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0', calibrationFrozen: true, calibrationReceiptDigest: sha256('agent-scripted-test-calibration-control') } });

function outputFor(b: FrozenRagBundle, taskId: string, binding: Record<string, any>) {
  const task = b.tasks.find(t => t.id === taskId)!, facts = b.taskGold.find(t => t.taskId === taskId)!.facts;
  return { schema: 'ProjectRagTaskOutput/v1', taskId: binding.participantTaskId, kind: task.kind, values: Object.fromEntries(facts.map(f => [f.field, f.value])),
    untouched: binding.untouched, citations: facts.map(f => { const s = binding.sources.find((s: any) => s.id === f.sourceId); return { field: f.field, sourceId: s.participantId, quote: f.quote,
      sourceRef: { ...s.ref, locator: f.sourceRef.locator } }; }), unknowns: [], analysis: b.taskGold.find(t => t.taskId === taskId)!.analysis };
}

function semanticMutation(file: string, mutate: (value: any) => void) {
  const copied = join(temp(), 'v1'); cpSync(versionRoot, copied, { recursive: true });
  const name = join(copied, file), value = JSON.parse(readFileSync(name, 'utf8')); mutate(value); writeFileSync(name, jsonBytes(value));
  const freeze = JSON.parse(readFileSync(join(copied, 'freeze.json'), 'utf8'));
  const row = freeze.files.find((f: { path: string }) => f.path === file), bytes = readFileSync(name); row.digest = sha256(bytes); row.bytes = bytes.length;
  const manifest = jsonBytes(freeze); writeFileSync(join(copied, 'freeze.json'), manifest);
  return () => loadFrozenRagCorpus(copied, sha256(manifest));
}

describe('Project RAG frozen evaluation corpus', () => {
  it('preserves the rejected v1 and v2 bytes under their original external freeze pins', () => {
    for (const [version, digest] of [
      ['v1', 'sha256:6671bd542d6a8ae0c86930c5f20f9850c88275284fcd4d3976275aed1c34b598'],
      ['v2', 'sha256:b42997a474c857096945f4a3cbd55c4a44c860e4e2ab71d30ce4af7dbf60583d'],
      ['v3', 'sha256:63cc3f14b2977d0ba3bd4a988b11661c62fc50f3a1e7bf61ac1acf9090eb0470'],
    ]) expect(loadFrozenRagCorpus(resolve('harness/specs/fixtures/project-rag', version), digest).plan.slots).toHaveLength(540);
  });

  it('reads 240 multilingual queries, 30 independent source families and 540 untouched trial slots', () => {
    const b = bundle();
    expect(b.queries).toHaveLength(240); expect(b.tasks).toHaveLength(60); expect(b.negatives).toHaveLength(64);
    expect(b.plan.slots).toHaveLength(540);
    expect([...new Set(b.queries.map(q => q.intent))]).toHaveLength(6);
    expect(b.plan.slots.every(s => s.status === 'not-run')).toBe(true);
  });

  it('reopens every gold span through the actual Wiki owner and the exact same raw bytes', async () => {
    const b = bundle();
    for (const source of b.corpus.sources) {
      const raw = readFileSync(join(b.root, source.path), 'utf8');
      const config = resolveMemoryWikiConfig({ vault: { path: resolve(b.root, 'owner/vault') } });
      const context = createMemoryWikiReadContext({ config, identity: { workspaceId: b.corpus.owner.workspaceId } });
      const page = toWikiPageSummary({ raw, absolutePath: join(b.root, source.path), relativePath: source.ref.subjectId })!;
      for (const gold of [...b.gold.flatMap(q => q.facts), ...b.taskGold.flatMap(t => t.facts)].filter(f => f.sourceId === source.id)) {
        const result = readMemoryWikiOwnerSnapshot({ page: { ...page, raw }, config, context, pin: gold.sourceRef });
        expect(result.status).toBe('admitted');
        if (result.status !== 'admitted') throw new Error(result.reason);
        expect(result.snapshot.content).toBe(gold.quote);
        expect(result.snapshot.source).toEqual(gold.sourceRef);
      }
    }
  });

  it('refuses changed bytes and a changed freeze manifest without the external release pin', () => {
    const copied = join(temp(), 'v1'); cpSync(versionRoot, copied, { recursive: true });
    writeFileSync(join(copied, 'queries.json'), '[]');
    expect(() => loadFrozenRagCorpus(copied, release.freezeDigest)).toThrow(/frozen input changed/);
    writeFileSync(join(copied, 'freeze.json'), '{}');
    expect(() => loadFrozenRagCorpus(copied, release.freezeDigest)).toThrow(/freeze manifest changed/);
  });

  it.each([
    ['queries.json', (rows: any[]) => { rows[0].split = 'held-out'; }],
    ['queries.json', (rows: any[]) => { rows[0].locale = 'ru'; }],
    ['trial-plan.json', (plan: any) => { plan.slots.pop(); }],
    ['trial-plan.json', (plan: any) => { plan.slots[0].envelopeDigest = sha256('larger-budget'); }],
    ['baseline.json', (base: any) => { base.page.semanticEnabled = false; }],
    ['oracle/query-gold.json', (gold: any[]) => { gold[0].facts[0].sourceRef.revision = 'wrong'; }],
  ] as const)('rejects independently rehashed semantic drift in %s', (file, mutate) => {
    expect(semanticMutation(file, mutate)).toThrow();
  });

  it('exports an anonymous selected request and same-split sources, keeping gold and held-out sealed', () => {
    const b = bundle(), root = temp(), task = b.tasks.find(t => t.split === 'calibration')!;
    const pack = materializeRagTask(b, task.id, join(root, 'participant'), join(root, 'oracle'), namespace);
    expect(pack.receipt.oracleExposed).toBe(false);
    const names: string[] = [];
    const walk = (dir: string) => { for (const row of readdirSync(dir, { withFileTypes: true })) { const full = join(dir, row.name); if (row.isDirectory()) walk(full); else names.push(relative(pack.workspace, full)); } };
    walk(pack.workspace);
    expect(names.some(n => /gold|oracle|freeze|trial-plan|promotion-policy|authoring/i.test(n))).toBe(false);
    const request = JSON.parse(readFileSync(join(pack.workspace, 'request.json'), 'utf8'));
    expect(request.input.values).toEqual(task.input.values);
    for (const key of ['familyId', 'split', 'queryId', 'cohort', 'authorship', 'corpusDigest']) expect(request).not.toHaveProperty(key);
    expect(request.id).not.toBe(task.id);
    if (request.scenario?.proposals) expect(request.scenario.proposals.every((p: Record<string, unknown>) => Object.keys(p).sort().join(',') === 'action,id')).toBe(true);
    for (const source of pack.receipt.sources) {
      expect(source.participantId).toMatch(/^source-[a-f0-9]{24}$/);
      expect(source.ref.subjectId).toBe(`concepts/${source.participantId}.md`);
      expect(JSON.stringify(request.sourceReferences)).not.toContain(source.id);
    }
    const held = b.tasks.find(t => t.split === 'held-out')!;
    expect(() => materializeRagTask(b, held.id, join(root, 'held'), join(root, 'private-held'), namespace)).toThrow(/held-out is sealed/);
  });

  it('accepts a valid shorter supporting citation and rejects wrong byte, owner and duplicate-field citations', () => {
    const b = bundle(), task = b.tasks.find(t => t.profile === 'research' && t.familyId === 'source-set-limit')!, root = temp();
    const pack = materializeRagTask(b, task.id, join(root, 'participant'), join(root, 'private'), namespace);
    const output = outputFor(b, task.id, pack.receipt), fact = b.taskGold.find(t => t.taskId === task.id)!.facts.find(f => f.field === 'defaultLimit')!;
    const citation = output.citations.find(c => c.field === fact.field)!, source = pack.receipt.sources.find((s: any) => s.id === fact.sourceId);
    const raw = readFileSync(join(pack.workspace, source.path)), support = fact.support!;
    citation.sourceRef.locator = { coordinateSpace: 'raw-source-utf8-v1', ...support,
      startLine: 1 + raw.subarray(0, support.startByte).filter(b => b === 10).length,
      endLine: 1 + raw.subarray(0, support.endByteExclusive - 1).filter(b => b === 10).length };
    citation.quote = spanText(raw, citation.sourceRef.locator);
    expect(citation.quote.length).toBeLessThan(fact.quote.length);
    mkdirSync(join(pack.workspace, 'reports'));
    const grade = () => { writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes(output)); return gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath); };
    expect(grade().passed).toBe(true);
    citation.quote += 'invented'; expect(grade()).toMatchObject({ query_result_match: true, passed: false });
    citation.quote = spanText(raw, citation.sourceRef.locator); citation.sourceRef.revision = '999'; expect(grade().passed).toBe(false);
    citation.sourceRef.revision = source.ref.revision;
    output.citations[1].field = citation.field; expect(grade().passed).toBe(false);
  });

  it('requires the incident cause, verification and cross-source decision beyond correct field values', () => {
    const b = bundle(), root = temp();
    for (const profile of ['quality', 'research']) {
      const task = b.tasks.find(t => t.profile === profile)!;
      const pack = materializeRagTask(b, task.id, join(root, profile), join(root, 'private'), namespace, unseal(b));
      const output = outputFor(b, task.id, pack.receipt);
      mkdirSync(join(pack.workspace, 'reports'));
      writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes({ ...output, analysis: undefined }));
      expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ query_result_match: true, passed: false });
      output.analysis = { ...output.analysis, evidenceGaps: [] };
      writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes(output));
      expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath).passed).toBe(false);
    }
  });

  it('omits evaluator family routing from every materialized research objective and nested request field', () => {
    const b = bundle(), root = temp();
    for (const task of b.tasks.filter(t => t.profile === 'research')) {
      const pack = materializeRagTask(b, task.id, join(root, task.id), join(root, 'private'), namespace, unseal(b));
      const request = JSON.parse(readFileSync(join(pack.workspace, 'request.json'), 'utf8'));
      expect(request.scenario.objective).toBe('Compare the proposed integration actions with all admitted source contracts and the stated resource constraints.');
      expect(JSON.stringify(request)).not.toContain(task.familyId);
      expect(JSON.stringify(request)).not.toContain(task.id);
      expect(request.scenario.proposals.every((p: Record<string, unknown>) => Object.keys(p).sort().join(',') === 'action,id')).toBe(true);
    }
  });

  it('captures invalid JSON bytes and a missing delivery as ordinary agent failures', () => {
    const b = bundle(), task = b.tasks.find(t => t.profile === 'quality')!, root = temp();
    const pack = materializeRagTask(b, task.id, join(root, 'participant'), join(root, 'private'), namespace);
    expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ passed: false, artifactDigest: null });
    mkdirSync(join(pack.workspace, 'reports'));
    for (const content of ['invalid JSON', 'null', '[]']) {
      writeFileSync(join(pack.workspace, pack.receipt.outputPath), content);
      expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ passed: false, artifactDigest: sha256(content) });
    }
  });

  it('distinguishes a correct answer from an incomplete task and rejects modified owner bytes', () => {
    const b = bundle(), task = b.tasks.find(t => t.kind !== 'code-repair' && t.split === 'calibration')!, root = temp();
    const pack = materializeRagTask(b, task.id, join(root, 'participant'), join(root, 'oracle'), namespace);
    const output = outputFor(b, task.id, pack.receipt); mkdirSync(resolve(pack.workspace, pack.receipt.outputPath, '..'), { recursive: true });
    writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes({ ...output, citations: [] }));
    expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ query_result_match: true, passed: false });
    writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes(output));
    expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ passed: true });
    writeFileSync(join(pack.workspace, pack.receipt.sources[0].path), 'revoked data');
    expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ query_result_match: true, passed: false });
  });

  it('calibrates all 60 file-delivery oracles with correct and wrong typed outputs', () => {
    const b = bundle(), root = temp();
    for (const task of b.tasks) {
      const pack = materializeRagTask(b, task.id, join(root, task.id), join(root, 'private'), namespace, unseal(b));
      const output = outputFor(b, task.id, pack.receipt);
      if (task.kind === 'code-repair') {
        const reference = b.taskGold.find(t => t.taskId === task.id)!.code!.referenceSource;
        writeFileSync(join(pack.workspace, task.outputPath), reference);
        writeFileSync(join(pack.workspace, task.proofPath!), jsonBytes(output));
        expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ behavior_match: true, passed: true });
        writeFileSync(join(pack.workspace, task.outputPath), readFileSync(join(b.root, task.code!.programPath)));
        expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ behavior_match: false, passed: false });
        continue;
      }
      mkdirSync(resolve(pack.workspace, pack.receipt.outputPath, '..'), { recursive: true });
      writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes(output));
      expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath).passed).toBe(true);
      output.values[task.requiredFields[0]] = { invalid: 'known-wrong-control' };
      writeFileSync(join(pack.workspace, pack.receipt.outputPath), jsonBytes(output));
      expect(gradeRagTaskArtifact(b, task.id, pack.workspace, pack.receiptPath)).toMatchObject({ query_result_match: false, passed: false });
    }
  });

  it.each(['acl', 'scope', 'revoked', 'expired', 'sensitive', 'revision', 'digest', 'namespace', 'policy', 'cancelled', 'range'])('retains a real owner rejection for the frozen %s negative class', kind => {
    const b = bundle(), source = b.corpus.sources[0]; let raw = readFileSync(join(b.root, source.path), 'utf8');
    const config = resolveMemoryWikiConfig({ vault: { path: resolve(b.root, 'owner/vault') } });
    const context = createMemoryWikiReadContext({ config, identity: { workspaceId: b.corpus.owner.workspaceId } });
    let pin = structuredClone(source.ref); const controller = new AbortController();
    if (kind === 'acl') raw = raw.replace('read: [operator]', 'read: [another-principal]');
    if (kind === 'scope') raw = raw.replace('workspaceId: rag-corpus-workspace', 'workspaceId: forbidden');
    if (kind === 'revoked') raw = raw.replace('status: active', 'status: revoked');
    if (kind === 'expired') raw = raw.replace('policy: source-coupled', 'policy: source-coupled\n  expiresAt: "2000-01-01T00:00:00Z"');
    if (kind === 'sensitive') raw = raw.replace('trust: confirmed', 'trust: confirmed\nprivacyTier: secret');
    if (kind === 'revision') pin.revision = '999'; if (kind === 'digest') pin.sourceDigest = sha256('wrong');
    if (kind === 'namespace') pin.namespaceId = 'wrong'; if (kind === 'policy') pin.policyEpoch = sha256('wrong-policy');
    if (kind === 'cancelled') controller.abort();
    if (kind === 'range') pin = { ...pin, locator: { coordinateSpace: 'raw-source-utf8-v1', startByte: 0, endByteExclusive: 1, startLine: 1, endLine: 1 } };
    const page = toWikiPageSummary({ raw, absolutePath: join(b.root, source.path), relativePath: source.ref.subjectId })!;
    const result = readMemoryWikiOwnerSnapshot({ page: { ...page, raw }, config, context, pin, signal: controller.signal });
    expect(result.status).toBe('denied');
    if (result.status === 'denied') expect(result.reason).toBe(b.negatives.find(n => n.kind === kind)!.expected);
  });

  it('keeps file deletion a missing-owner result after actual disk materialization', async () => {
    const b = bundle(), task = b.tasks[0], root = temp();
    const pack = materializeRagTask(b, task.id, join(root, 'participant'), join(root, 'oracle'), namespace);
    const source = pack.receipt.sources[0], file = join(pack.workspace, source.path);
    rmSync(file);
    const result = await getMemoryWikiPage({ config: resolveMemoryWikiConfig({ vault: { path: join(pack.workspace, 'knowledge') } }),
      lookup: source.ref.subjectId, sourceRef: source.ref, readIdentity: { workspaceId: b.corpus.owner.workspaceId } });
    expect(result).toMatchObject({ status: 'denied', reason: 'not_found' });
  });

  it('rejects UTF-8 offsets inside a multibyte code point', () => {
    expect(() => spanText(Buffer.from('中文😀'), { coordinateSpace: 'raw-source-utf8-v1', startByte: 1, endByteExclusive: 4, startLine: 1, endLine: 1 })).toThrow();
  });

  it('freezes provider, owner safety and exactly the same three-arm envelopes', () => {
    const b = bundle(), provider = { instanceId: 'agent-fixture', modelRevision: 'fixture-v1', usageParserRevision: 'usage-v1', rateSheetRevision: 'rates-v1',
      capabilityReceiptDigest: sha256('scripted-capability-control'), endpointOrigin: 'http://127.0.0.1:12345' };
    const ownerSafetyDigest = sha256('fixture-shared-safe-owner'), envelopes = Object.fromEntries(['local', 'quality', 'research'].map(p => [p, sha256(jsonBytes(b.policy.profiles[p].taskEnvelope))]));
    const generationSettings = { temperature: 0.2, maxOutputTokens: 4096, seedPolicy: 'per-repeat' };
    const input = { corpusDigest: b.freezeDigest, cleanCandidate: '1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0', ownerSafetyDigest, provider, generationSettings,
      arms: ['off', 'page', 'full'].map(arm => ({ arm, providerDigest: sha256(jsonBytes(provider)), ownerSafetyDigest,
        generationSettingsDigest: sha256(jsonBytes(generationSettings)), envelopes, semanticEnabled: true, backgroundRetrieval: false })) };
    expect(bindRagExperiment(b, input).binding).toMatchObject({ executedSlots: 0, status: 'frozen-metadata' });
    const weakened = structuredClone(input); weakened.arms[1].semanticEnabled = false;
    expect(() => bindRagExperiment(b, weakened)).toThrow(/baseline weakened/);
    const drift = structuredClone(input); drift.arms[2].envelopes.local = sha256('increased-budget');
    expect(() => bindRagExperiment(b, drift)).toThrow(/budget drift/);
    const modelDrift = structuredClone(input); modelDrift.arms[2].generationSettingsDigest = sha256('changed-temperature');
    expect(() => bindRagExperiment(b, modelDrift)).toThrow(/generation differs/);
    const secret = { ...input, provider: { ...provider, apiKey: 'never-export-this' } };
    expect(() => bindRagExperiment(b, secret)).toThrow(/credentials/);
  });

  it('does not promote a frozen plan or missing measurement as executed benefit', () => {
    expect(evaluateRagTaskPromotion(bundle(), [])).toMatchObject({ status: 'insufficient-evidence', expectedRuns: 540, runCount: 0 });
  });

  it('keeps measured agent failures paired and requires pinned safety, attempt and budget receipts', () => {
    const b = bundle(), root = temp();
    const provider = { instanceId: 'scripted-test-control', modelRevision: 'fixture-v1', usageParserRevision: 'usage-v1', rateSheetRevision: 'rates-v1',
      capabilityReceiptDigest: sha256('scripted-capability-control'), endpointOrigin: 'http://127.0.0.1:12345' };
    const ownerSafetyDigest = sha256('fixture-shared-safe-owner'), envelopes = Object.fromEntries(['local', 'quality', 'research'].map(p => [p, sha256(jsonBytes(b.policy.profiles[p].taskEnvelope))]));
    const generationSettings = { temperature: 0.2, maxOutputTokens: 4096, seedPolicy: 'per-repeat' };
    const experiment = bindRagExperiment(b, { corpusDigest: b.freezeDigest, cleanCandidate: '1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0', ownerSafetyDigest, provider, generationSettings,
      frozenAt: '2026-11-10T00:00:00.000Z', arms: ['off', 'page', 'full'].map(arm => ({ arm, providerDigest: sha256(jsonBytes(provider)), ownerSafetyDigest,
        generationSettingsDigest: sha256(jsonBytes(generationSettings)), envelopes, semanticEnabled: true, backgroundRetrieval: false })) });
    writeFileSync(join(root, 'experiment.json'), jsonBytes(experiment));
    const safety = { schema: 'ProjectRagSafetyReceipt/v1', actor: 'agent-scripted-test-control', driven_by: 'agent', corpusDigest: b.freezeDigest, experimentBindingDigest: experiment.digest,
      results: b.negatives.flatMap(n => ['off', 'page', 'full'].map(arm => ({ caseId: n.id, arm, actual: n.expected,
        observationDigest: sha256(`scripted-control:${n.id}/${arm}`), metrics: Object.fromEntries(Object.keys(b.policy.safety).map(key => [key, 0])) }))) };
    const safetyBytes = jsonBytes(safety); writeFileSync(join(root, 'safety.json'), safetyBytes);
    mkdirSync(join(root, 'attempts'));
    const attemptDigests: Record<string, string> = {};
    const runs = b.plan.slots.map(slot => {
      const cohort = b.tasks.filter(t => t.profile === slot.profile), taskIndex = cohort.findIndex(t => t.id === slot.taskId);
      const passed = taskIndex < (slot.arm === 'full' ? 16 : 2), artifactDigest = passed ? sha256(`fixture-output:${slot.taskId}`) : null;
      const grade = { schema: 'ProjectRagTaskGrade/v1', actor: 'agent-scripted-independent-test-control', driven_by: 'agent', taskId: slot.taskId, corpusDigest: b.freezeDigest,
        passed, artifactDigest, issues: passed ? [] : [{ kind: 'artifact', reason: 'scripted missing-output failure control' }] };
      const run = { slotId: slot.id, corpusDigest: b.freezeDigest, experimentBindingDigest: experiment.digest, outcome: passed ? 'pass' : 'fail',
        failureClass: passed ? null : 'agent', grade, costs: { embedding: 0, rerank: 0, planning: 0, generation: 0.01, tools: 0 },
        usageUnknown: false, unknownReserveUsd: 0, actualBudget: { totalTokens: 500, modelCalls: 1, elapsedMs: 300 } };
      const receipt = { schema: 'ProjectRagAttemptReceipt/v1', actor: 'agent-scripted-test-control', driven_by: 'agent', ...run,
        gradeDigest: sha256(jsonBytes(grade)), capture: { rawDigest: artifactDigest ?? sha256(''), status: passed ? 'delivered' : 'missing' },
        startedAt: '2026-11-10T00:00:01.000Z', completedAt: '2026-11-10T00:00:02.000Z' };
      const bytes = jsonBytes(receipt); attemptDigests[slot.id] = sha256(bytes);
      writeFileSync(join(root, 'attempts', `${sha256(slot.id).slice(7)}.json`), bytes);
      return run;
    });
    const evidence = { directory: root, experimentDigest: experiment.digest, safetyDigest: sha256(safetyBytes), attemptDigests };
    expect(evaluateRagTaskPromotion(b, runs)).toMatchObject({ status: 'insufficient-evidence' });
    const complete = evaluateRagTaskPromotion(b, runs, evidence);
    expect(complete.status).toBe('promote');
    expect(complete.verdicts.every((v: any) => v.effect.pairCount === 20 && v.effect.droppedPairCount === 0)).toBe(true);
    const missing = { ...evidence, attemptDigests: {} };
    expect(evaluateRagTaskPromotion(b, runs, missing).status).toBe('insufficient-evidence');
    const drift = structuredClone(runs); drift[0].actualBudget.totalTokens++;
    expect(evaluateRagTaskPromotion(b, drift, evidence).status).toBe('insufficient-evidence');
    const partial = structuredClone(safety); partial.results.pop();
    const partialBytes = jsonBytes(partial); writeFileSync(join(root, 'safety.json'), partialBytes);
    expect(evaluateRagTaskPromotion(b, runs, { ...evidence, safetyDigest: sha256(partialBytes) }).status).toBe('insufficient-evidence');
    safety.results[0].actual = 'unsafe-result';
    const unsafeBytes = jsonBytes(safety); writeFileSync(join(root, 'safety.json'), unsafeBytes);
    expect(evaluateRagTaskPromotion(b, runs, { ...evidence, safetyDigest: sha256(unsafeBytes) }).verdicts.every((v: any) => v.promotion.status === 'eliminate')).toBe(true);
  });
});
