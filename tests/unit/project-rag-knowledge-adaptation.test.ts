// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureKnowledgeAdaptation, freezeKnowledgeQuestions } from '../../scripts/knowledge-rag-adaptation';
import { jsonBytes, sha256 } from '../../scripts/lib/project-rag-corpus.mjs';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
const roots: string[] = [];
afterEach(async () => { vi.resetAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'rag-adaptation-')); roots.push(root);
  const vault = join(root, 'vault'), output = join(root, 'capture'), configFile = join(root, 'config.json');
  await mkdir(join(vault, 'concepts'), { recursive: true });
  for (const [index, body] of ['# Budget\n\nBudget is 100 USD.\n', '# Backup\n\n备份保存 30 天。\n', '# Install\n\nUse pnpm init.\n'].entries()) {
    await writeFile(join(vault, 'concepts', `${index}.md`), `---\ntitle: Source ${index}\nrevision: 1\nstatus: active\ntrust: confirmed\n---\n${body}`);
  }
  await writeFile(configFile, jsonBytes({ plugins: { entries: { 'memory-wiki': { enabled, config: { vault: { path: vault } } } } } }));
  const options = { configFile, output, workspaceDir: root, origin: 'agent-built-adaptation' as const, actor: 'agent-unit-author' };
  return { root, vault, output, configFile, options };
}
async function reviewed() {
  const f = await fixture(), snapshot = await captureKnowledgeAdaptation(f.options);
  const families = snapshot.sources.map((source, i) => ({ id: `family-${i}`, sourceIds: [source.id] }));
  const splits = ['calibration', 'validation', 'held-out'] as const;
  const questions = snapshot.sources.map((source, i) => ({ id: `q-${i}`, question: `What does source ${i} require?`,
    locale: 'en', intent: 'fact', split: splits[i], familyId: families[i].id, sourceIds: [source.id], answerability: 'answerable' as const,
    support: [{ sourceId: source.id, startByte: source.snapshot.source.locator!.startByte,
      endByteExclusive: source.snapshot.source.locator!.endByteExclusive, quote: source.snapshot.content }] }));
  const input = { actor: 'agent-unit-author', driven_by: 'agent' as const, snapshotDigest: snapshot.snapshotDigest, families, questions,
    review: { actor: 'agent-unit-independent-review-fixture', driven_by: 'agent' as const, snapshotDigest: snapshot.snapshotDigest,
      datasetDigest: sha256(jsonBytes({ families, questions })), acceptedQuestionIds: questions.map(q => q.id) } };
  const rebind = () => { input.review.datasetDigest = sha256(jsonBytes({ families: input.families, questions: input.questions })); };
  return { ...f, snapshot, input, rebind };
}

describe('knowledge adaptation owner snapshot and question freeze', () => {
  it('captures original owner bytes and structure without initializing the source vault', async () => {
    const f = await fixture(), result = await captureKnowledgeAdaptation(f.options);
    expect(result).toMatchObject({ status: 'complete', discovered: 3, admitted: 3, origin: 'agent-built-adaptation' });
    expect(result.sources.some(source => source.languageSignals.includes('han'))).toBe(true);
    expect(result.sources.every(source => source.structure.headings === 1)).toBe(true);
    for (const source of result.sources) {
      expect(sha256(await readFile(join(f.output, source.path)))).toBe(source.snapshot.source.sourceDigest);
    }
    expect(existsSync(join(f.vault, '.openclaw-wiki'))).toBe(false);
  });
  it('reports an unavailable owner and does not manufacture a vault', async () => {
    const f = await fixture(false); await rm(f.vault, { recursive: true });
    expect(await captureKnowledgeAdaptation(f.options)).toMatchObject({ status: 'unavailable', admitted: 0, issues: ['wiki-owner-not-enabled'] });
    expect(existsSync(f.vault)).toBe(false);
  });
  it('excludes revoked contents and keeps a rejection receipt', async () => {
    const f = await fixture(), path = join(f.vault, 'concepts/0.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace('status: active', 'status: revoked'));
    const result = await captureKnowledgeAdaptation(f.options);
    expect(result.admitted).toBe(2); expect(result.rejected).toHaveLength(1); expect(result.rejected[0].reason).toBe('revoked');
    expect(JSON.stringify(result)).not.toContain('Budget is 100');
  });
  it.each([
    ['stale', 'status: stale', 'stale'],
    ['expired', 'status: active\nretention:\n  policy: ephemeral\n  expiresAt: "2000-01-01T00:00:00Z"', 'expired'],
    ['other principal', 'status: active\nacl:\n  read: [other-principal]', 'acl_denied'],
    ['other workspace', 'status: active\nscope:\n  workspaceId: another-workspace', 'scope_mismatch'],
  ])('rejects %s source content through the actual owner policy', async (_name, policy, reason) => {
    const f = await fixture(), file = join(f.vault, 'concepts/0.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: active', policy));
    const result = await captureKnowledgeAdaptation(f.options);
    expect(result.admitted).toBe(2); expect(result.rejected[0].reason).toBe(reason);
    expect(JSON.stringify(result)).not.toContain('Budget is 100');
  });
  it('marks bounded or invalid-source captures partial and prevents their release', async () => {
    const f = await fixture();
    const result = await captureKnowledgeAdaptation({ ...f.options, maxSources: 1 });
    expect(result).toMatchObject({ status: 'partial', admitted: 1, discovered: 3 });
    await expect(freezeKnowledgeQuestions(f.output, {} as never)).rejects.toThrow('complete nonempty');
  });
  it('removes evidence changed after its initial owner read', async () => {
    const f = await fixture(), file = join(f.vault, 'concepts/0.md');
    const originalRead = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).readFile;
    let reads = 0;
    vi.mocked(fs.readFile).mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      const value = await originalRead(...args);
      if (String(args[0]) === file && ++reads === 2) await writeFile(file, 'source changed during capture');
      return value;
    }) as typeof fs.readFile);
    const result = await captureKnowledgeAdaptation(f.options);
    expect(result).toMatchObject({ status: 'partial', admitted: 2 });
    expect(result.issues).toContain('owner-source-changed');
    expect(JSON.stringify(result)).not.toContain('Budget is 100');
  });
  it('keeps outputs outside the vault and never overwrites a capture', async () => {
    const f = await fixture();
    await expect(captureKnowledgeAdaptation({ ...f.options, output: join(f.vault, 'export') })).rejects.toThrow('separate');
    await captureKnowledgeAdaptation(f.options);
    await expect(captureKnowledgeAdaptation(f.options)).rejects.toThrow();
  });
  it('rejects output inside a vault reached through a directory alias', async () => {
    const f = await fixture(), alias = join(f.root, 'vault-alias');
    await symlink(f.vault, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const config = JSON.parse(await readFile(f.configFile, 'utf8'));
    config.plugins.entries['memory-wiki'].config.vault.path = alias;
    await writeFile(f.configFile, jsonBytes(config));
    await expect(captureKnowledgeAdaptation({ ...f.options, output: join(f.vault, 'export') })).rejects.toThrow('canonical source vault');
    expect(existsSync(join(f.vault, 'export'))).toBe(false);
  });
  it('freezes exact supports while excluding oracle answers from public questions', async () => {
    const f = await reviewed(), result = await freezeKnowledgeQuestions(f.output, f.input);
    expect(result.gold).toHaveLength(3); expect(result.queries).toHaveLength(3);
    expect(result.visibility).toBe('evaluator-only');
    expect(result.queries.every(q => !('support' in q) && !('answerability' in q))).toBe(true);
    expect(result.origin).toBe('agent-built-adaptation');
  });
  it('rejects wrong quotes, changed archives and changes after the independent review', async () => {
    const f = await reviewed(); f.input.questions[0].support[0].quote = 'invented';
    await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('review binding');
    f.rebind(); await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('exact owner');
    await writeFile(join(f.output, f.snapshot.sources[0].path), 'changed');
    await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('source changed');
  });
  it('rejects a source family split across calibration and held-out', async () => {
    const f = await reviewed();
    f.input.questions[2].familyId = f.input.questions[0].familyId;
    f.input.questions[2].sourceIds = f.input.questions[0].sourceIds;
    f.rebind(); await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('crosses evaluation splits');
  });
  it('requires a distinct reviewer and complete question coverage', async () => {
    const f = await reviewed(); f.input.review.actor = f.input.actor;
    await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('review binding');
    f.input.review.actor = ' ' + f.input.actor + ' ';
    await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('review binding');
    f.input.review.actor = 'agent-unit-independent-review-fixture'; f.input.review.acceptedQuestionIds.pop();
    await expect(freezeKnowledgeQuestions(f.output, f.input)).rejects.toThrow('each question exactly once');
  });
});
