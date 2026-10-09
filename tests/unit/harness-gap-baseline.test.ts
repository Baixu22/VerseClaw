// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { validateBaseline, verifyReferences } from '../../scripts/check-harness-gap-baseline.mjs';
import { codingObservability } from '../../openclaw_runtime/src/context-engine/coding-observability';
import { wrapToolWithDestructiveTier } from '../../openclaw_runtime/src/agents/write-destructive-tier';

const inventory = JSON.parse(readFileSync(new URL('../../docs/dev/harness-gap-closure/source-inventory.json', import.meta.url), 'utf8'));

describe('B00 baseline structure, not current runtime acceptance', () => {
  it('keeps 30 source slots, 29 packets and six separate original pilot contracts', () => {
    expect(validateBaseline(inventory)).toMatchObject({ ok: true, level: 'structure', counts: { slots: 30, packets: 29 } });
  });

  const mutations: [string, (data: typeof inventory) => void, string][] = [
    ['malformed packet', (d) => { d.packets[0] = null; }, 'invalid inventory shape'],
    ['malformed slot', (d) => { d.slots[0] = null; }, 'invalid inventory shape'],
    ['missing slot', (d) => d.slots.pop(), 'exactly HG01-HG30'],
    ['duplicate slot', (d) => { d.slots[0].id = 'HG02'; }, 'exactly HG01-HG30'],
    ['unknown owner', (d) => { d.slots[0].owner = 'Z99'; }, 'unknown owner'],
    ['wrong existing owner', (d) => { d.slots[0].owner = 'O01'; }, 'slot owner mismatch'],
    ['invented missing text', (d) => { d.slots.find((s: { id: string }) => s.id === 'HG22').originalText = 'invented'; }, 'missing source invented'],
    ['constraint as bug', (d) => { d.slots.find((s: { id: string }) => s.id === 'HG26').assessment = 'partial'; }, 'HG26 is a constraint'],
    ['missing packet', (d) => d.packets.pop(), '29 unique packet'],
    ['duplicate packet', (d) => { d.packets[0].code = d.packets[1].code; }, '29 unique packet'],
    ['duplicate task identity', (d) => { d.packets[0].taskId = d.packets[1].taskId; }, 'unique task ownership'],
    ['directory-wide scope', (d) => { d.packets[0].candidateFiles[0].path = 'electron/services/**'; }, 'exact candidate files'],
    ['path traversal', (d) => { d.packets[0].candidateFiles[0].path = '../outside.ts'; }, 'exact candidate files'],
    ['missing entry', (d) => { d.packets[0].entryRefs = []; }, 'explicit entry'],
    ['invalid spec', (d) => { d.packets[0].spec.path = 'harness/specs/tasks/'; }, 'invalid task spec'],
    ['missing test target', (d) => { d.packets[0].testTargets = []; }, 'test targets'],
    ['missing non-goals', (d) => { d.packets[0].nonGoals = []; }, 'non-goals'],
    ['unknown reference', (d) => { d.slots[0].sourceRefs = ['not-present']; }, 'missing slot source'],
    ['unfrozen product lock', (d) => { d.productLocks.values.default_on = true; }, 'product locks'],
    ['fixture as default', (d) => { d.experimentParameters.scope = 'production'; }, 'experiment/default separation'],
    ['human attribution', (d) => { d.driven_by = 'real-human'; }, 'agent attribution'],
    ['reused pilot pass', (d) => { d.packets.find((p: { pilotContract?: unknown }) => p.pilotContract).pilotContract.acceptanceReused = true; }, 'pilot acceptance cannot be reused'],
    ['reused old report', (d) => { d.historicalEvidence[0].reusableForCurrentAcceptance = true; }, 'historical evidence'],
    ['missing candidate', (d) => { d.sourceBaseline.commit = null; }, 'source candidate identity'],
  ];
  it.each(mutations)('rejects %s', (_name, mutate, expected) => {
    const changed = structuredClone(inventory);
    mutate(changed);
    const result = validateBaseline(changed);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain(expected);
  });

  it('fails closed for malformed input', () => {
    for (const value of [null, [], {}, { slots: [] }]) expect(validateBaseline(value).ok).toBe(false);
  });
});

describe('current-source verifier uses immutable tiny fixtures', () => {
  const text = 'fixture\nexport function owned() {}\n';
  const refs = { fixture: { path: 'fixture.ts', line: 2, anchor: 'export function owned() {}',
    sha256: createHash('sha256').update(text).digest('hex') } };
  it('accepts the exact source and CRLF-equivalent text', () => {
    expect(verifyReferences(refs, () => text)).toEqual([]);
    expect(verifyReferences(refs, () => text.replace(/\n/g, '\r\n'))).toEqual([]);
  });
  it('rejects changed source bytes and a wrong symbol anchor', () => {
    expect(verifyReferences(refs, () => text.replace('owned', 'other')).join('\n')).toContain('source digest drift');
    expect(verifyReferences(refs, () => text.replace('owned', 'other')).join('\n')).toContain('source anchor drift');
  });
  it('rejects missing input and succeeds after the source is restored', () => {
    expect(verifyReferences(refs, () => { throw new Error('missing'); }).join('\n')).toContain('source missing');
    expect(verifyReferences(refs, () => text)).toEqual([]);
  });
  it('does not read an unsafe path', () => {
    let reads = 0;
    const bad = { fixture: { ...refs.fixture, path: '../fixture.ts' } };
    expect(verifyReferences(bad, () => { reads++; return text; }).join('\n')).toContain('unsafe source path');
    expect(reads).toBe(0);
  });
});

describe('approval-rate measurement boundary counterexamples', () => {
  afterEach(() => codingObservability.reset());
  it('zero decisions and zero measured prompts share rate=0, so sample metadata is required', () => {
    codingObservability.reset();
    expect(codingObservability.rates().approvalPromptRate).toBe(0);
    expect(codingObservability.snapshot().approvalPrompts + codingObservability.snapshot().approvalSkips).toBe(0);
    codingObservability.recordApprovalSkip();
    expect(codingObservability.rates().approvalPromptRate).toBe(0);
    expect(codingObservability.snapshot().approvalSkips).toBe(1);
  });
  it('the real tier wrapper counts a classification even without an approval UI', async () => {
    codingObservability.reset();
    let effects = 0;
    const tool = { name: 'write', label: 'fixture', description: 'synthetic tool effect',
      parameters: { type: 'object', properties: {} } as never,
      execute: async () => { effects++; return { content: [{ type: 'text' as const, text: 'fixture' }], details: {} }; } };
    const wrapped = wrapToolWithDestructiveTier(tool, { journalEnabled: false });
    await wrapped.execute('fixture-call', { path: 'fixture.txt', content: 'fixture' });
    expect(effects).toBe(1);
    expect(codingObservability.snapshot().approvalPrompts).toBe(1);
    expect(codingObservability.rates().approvalPromptRate).toBe(1);
  });
});

// This reader is synthetic, so future runtime edits do not silently mutate an old baseline.
describe('full verifier source/spec checks', () => {
  function fixture() {
    const data = structuredClone(inventory);
    const files = new Map<string, string>();
    for (const [id, ref] of Object.entries(data.references) as [string, { path: string; line: number; anchor: string; sha256: string }][]) {
      const text = id === 'plan'
        ? ['fixture', ...data.slots.map((s: { id: string; owner: string }) => `| ${s.id} | topic | ${s.owner} | source |`),
          `| E | packets | ${data.packets.map((p: { code: string }) => p.code).join('、')} | purpose |`].join('\n')
        : 'fixture';
      Object.assign(ref, { path: 'fixtures/' + id.replaceAll(':', '-') + '.md', line: 1, anchor: 'fixture',
        sha256: createHash('sha256').update(text).digest('hex') });
      files.set(ref.path, text);
    }
    for (const packet of data.packets) {
      for (const spec of [...packet.reuseSpecs, ...(packet.spec.state === 'existing' ? [packet.spec.path] : [])])
        files.set(spec, '---\nid: fixture\n---');
      for (const file of packet.candidateFiles.filter((f: { state: string }) => f.state === 'existing')) files.set(file.path, 'fixture');
      for (const test of packet.testTargets.filter((t: { state: string }) => t.state === 'existing')) files.set(test.target, 'fixture');
    }
    for (const packet of data.packets.filter((p: { pilotContract?: unknown }) => p.pilotContract))
      files.set(packet.spec.path, '---\nid: ' + packet.code + '\n' + ['acceptance', 'requiredTests', 'requiredProfiles'].map(key => key + ':\n' + packet.pilotContract[key].map((value: string) => '  - ' + value).join('\n')).join('\n') + '\n---');
    const read = (path: string) => { if (!files.has(path)) throw new Error('missing: ' + path); return files.get(path)!; };
    return { data, files, read };
  }
  it('accepts the complete reader-backed contract', () => {
    const { data, read } = fixture();
    expect(validateBaseline(data, read).errors).toEqual([]);
    expect(validateBaseline(data, read)).toMatchObject({ ok: true, level: 'current-sources' });
  });
  it('rejects a nonexistent existing spec, then accepts its restoration', () => {
    const { data, files, read } = fixture();
    const path = data.packets[0].reuseSpecs[0];
    const text = files.get(path)!; files.delete(path);
    expect(validateBaseline(data, read).errors.join('\n')).toContain('source/spec read failed');
    files.set(path, text); expect(validateBaseline(data, read).ok).toBe(true);
  });
  it('rejects an existing spec without an id', () => {
    const { data, files, read } = fixture();
    files.set(data.packets[0].reuseSpecs[0], '---\ntitle: no id\n---');
    expect(validateBaseline(data, read).errors.join('\n')).toContain('invalid existing spec');
  });
  it('rejects changed pilot thresholds rather than trusting copied declarations', () => {
    const { data, read } = fixture();
    data.packets.find((p: { pilotContract?: unknown }) => p.pilotContract).pilotContract.acceptance.push('weakened threshold');
    expect(validateBaseline(data, read).errors.join('\n')).toContain('original pilot gate changed');
  });
  it('rejects a missing existing candidate file', () => {
    const { data, files, read } = fixture();
    files.delete(data.packets[0].candidateFiles.find((f: { state: string }) => f.state === 'existing').path);
    expect(validateBaseline(data, read).errors.join('\n')).toContain('source/spec read failed');
  });
});
