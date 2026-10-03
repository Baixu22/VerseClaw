import { mkdtemp, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateRc10ChannelProbe, evaluateRc10H01, sealRc10Evidence, summarizeRc10Receipts, verifyRc10Evidence } from '../../scripts/lib/rc10-evidence.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const row = (kind: string, overrides: Record<string, unknown> = {}) => ({
  receipt_id: `rcpt_${kind}`, kind, version: '1', runtime_mode: 'source', run_id: 'run-1',
  correlation_digest: 'a'.repeat(64), selected_json: '[{"ref":"selected"}]', omitted_json: '[{"ref":"omitted"}]', ...overrides,
});
const h01 = () => ({
  candidate: { dirty: false }, runId: 'run-1', finished: true,
  before: { tests: { exitCode: 1 }, files: { 'calc.test.js': { sha256: 'test-digest' } } },
  after: { tests: { exitCode: 0 }, files: { 'calc.test.js': { sha256: 'test-digest' } } },
  receipts: summarizeRc10Receipts([row('context'), row('wire')], 'run-1'),
});

describe('RC-10 evidence gates', () => {
  it('verifies the operator flat seal without inventing a credential scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rc10-operator-seal-')); roots.push(root);
    const text = '{"event":"end"}\n';
    await writeFile(join(root, 'events.jsonl'), text);
    await writeFile(join(root, 'hashes.json'), JSON.stringify({
      'events.jsonl': createHash('sha256').update(text).digest('hex'),
    }));
    expect(await verifyRc10Evidence(root)).toMatchObject({ ok: true, format: 'operator-flat', credentialScan: 'not-recorded' });
    await appendFile(join(root, 'events.jsonl'), 'tampered');
    expect((await verifyRc10Evidence(root)).errors).toContain('digest-mismatch:events.jsonl');
  });
  it('counts only current-run source v1 receipts and unique correlation pairs', () => {
    const result = summarizeRc10Receipts([
      row('context'), row('wire'), row('wire', { receipt_id: 'rcpt_retry' }),
      row('shadow_context', { version: '0' }), row('shadow_wire', { version: '0' }),
      row('context', { run_id: 'other-run' }), row('wire', { runtime_mode: 'npm' }),
    ], 'run-1');
    expect(result.context).toHaveLength(1);
    expect(result.wire).toHaveLength(2);
    expect(result.pairs).toBe(1);
    expect(summarizeRc10Receipts([row('context')], null).context).toEqual([]);
  });

  it('requires the H-01 task, unchanged tests, current-run receipts and explained lineage', () => {
    expect(evaluateRc10H01(h01())).toEqual({ result: 'pass', errors: [] });
    const noReceipts = h01();
    noReceipts.receipts = summarizeRc10Receipts([], 'run-1');
    expect(evaluateRc10H01(noReceipts).result).toBe('fail');
    const noLineage = h01();
    noLineage.receipts.context[0].omitted = null;
    expect(evaluateRc10H01(noLineage).errors).toContain('context-lineage-incomplete');
    const changedTests = h01();
    changedTests.after.files['calc.test.js'].sha256 = 'modified';
    expect(evaluateRc10H01(changedTests).errors).toContain('workload-test-modified-or-missing');
  });

  it('rejects unrelated runs, shadow receipts, and orphan wire receipts', () => {
    for (const mutation of [{ run_id: 'other' }, { kind: 'shadow_context', version: '0' }, { runtime_mode: 'npm' }, { receipt_id: '' }]) {
      const value = h01();
      Object.assign(value.receipts.context[0], mutation);
      expect(evaluateRc10H01(value).errors).toContain('missing-or-invalid-current-run-v1-receipts');
    }
    const value = h01();
    value.receipts.wire.push({ ...value.receipts.wire[0], correlation_digest: 'b'.repeat(64) });
    expect(evaluateRc10H01(value).errors).toContain('unpaired-context-wire-receipts');
  });

  it('accepts SQL NULL empty lineage without accepting malformed JSON', () => {
    const value = h01();
    const empty = row('context', { receipt_id: 'rcpt_empty', correlation_digest: 'b'.repeat(64), selected_json: null, omitted_json: null });
    value.receipts = summarizeRc10Receipts([row('context'), row('wire'), empty,
      row('wire', { receipt_id: 'rcpt_empty_wire', correlation_digest: 'b'.repeat(64) })], 'run-1');
    expect(evaluateRc10H01(value)).toEqual({ result: 'pass', errors: [] });
    expect(value.receipts.context[1]).toMatchObject({ selected: [], omitted: [] });
    value.receipts = summarizeRc10Receipts([row('context', { selected_json: null, omitted_json: null }), row('wire')], 'run-1');
    expect(evaluateRc10H01(value)).toEqual({ result: 'pass', errors: [] });
    for (const invalid of ['null', '{}', 'not-json', undefined]) {
      value.receipts = summarizeRc10Receipts([row('context', { selected_json: invalid }), row('wire')], 'run-1');
      expect(evaluateRc10H01(value).errors).toContain('context-lineage-incomplete');
    }
  });

  it('does not treat structural credential validation as an online channel', () => {
    const probe = {
      channelType: 'qqbot', validation: { valid: true, warnings: ['No online validation available'] },
      accounts: { success: true, channels: [{ channelType: 'qqbot', accounts: [{ configured: true, connected: false, running: false }] }] },
      targets: { success: true, targets: [] as { value: string }[] },
    };
    expect(evaluateRc10ChannelProbe(probe)).toMatchObject({ result: 'blocked', errors: ['channel-not-connected', 'delivery-target-unavailable'], provesDelivery: false });
    Object.assign(probe.accounts.channels[0].accounts[0], { connected: true, running: true });
    probe.targets.targets.push({ value: 'fixture-target' });
    expect(evaluateRc10ChannelProbe(probe)).toEqual({ result: 'pass', errors: [], provesDelivery: false });
    expect(evaluateRc10ChannelProbe({ channelType: 'qqbot', validation: { valid: true } }).result).toBe('blocked');
  });

  it('seals the final event and detects any later append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rc10-evidence-')); roots.push(root);
    await writeFile(join(root, 'events.jsonl'), '{"event":"evidence.written"}\n');
    const seal = await sealRc10Evidence(root, ['fixture-secret']);
    expect(seal.credentialScanHits).toEqual([]);
    expect(await verifyRc10Evidence(root)).toMatchObject({ ok: true, checkedFiles: 1 });
    await expect(sealRc10Evidence(root, ['fixture-secret'])).rejects.toThrow();
    await appendFile(join(root, 'events.jsonl'), '{"event":"late-write"}\n');
    expect((await verifyRc10Evidence(root)).errors).toContain('digest-mismatch:events.jsonl');
  });

  it('reports credential leakage without publishing secret values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rc10-evidence-')); roots.push(root);
    await writeFile(join(root, 'app.log'), 'fixture-provider-secret');
    const seal = await sealRc10Evidence(root, ['fixture-provider-secret']);
    expect(seal.credentialScanHits).toEqual(['app.log']);
    expect(JSON.stringify(seal)).not.toContain('fixture-provider-secret');
    expect((await verifyRc10Evidence(root)).errors).toContain('credential-scan-not-clean');
  });

  it('rejects missing files, extra files, and unsafe manifest paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rc10-evidence-')); roots.push(root);
    await writeFile(join(root, 'events.jsonl'), '{}');
    await sealRc10Evidence(root, ['fixture-secret']);
    await rm(join(root, 'events.jsonl'));
    await writeFile(join(root, 'unsealed.json'), '{}');
    const manifest = JSON.parse(await readFile(join(root, 'hashes.json'), 'utf8'));
    manifest.files['../outside'] = { bytes: 0, sha256: 'a'.repeat(64) };
    await writeFile(join(root, 'hashes.json'), JSON.stringify(manifest));
    expect((await verifyRc10Evidence(root)).errors).toEqual(expect.arrayContaining([
      'missing-file:events.jsonl', 'unsealed-file:unsealed.json', 'unsafe-manifest-path',
    ]));
  });
});
