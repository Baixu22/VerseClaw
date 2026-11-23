// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRetrievalArtifactManifest, sealRetrievalArtifactManifest, verifyRetrievalArtifactManifest, planRetrievalUpgrade } from '../../scripts/lib/project-rag-package.mjs';

const roots: string[] = [];
const options = { candidate: 'a'.repeat(40), platform: process.platform, arch: process.arch };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rag-package-')); roots.push(root);
  mkdirSync(join(root, 'dist/plugin-sdk'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'agent-package-fixture', version: '1.0.0' }));
  for (const file of ['entry.js', 'plugin-sdk/knowledge-retrieval.js', 'plugin-sdk/memory-host-core.js'])
    writeFileSync(join(root, 'dist', file), 'export const fixture = true;\n');
  const code = 'export const agentFixture = true;\n';
  writeFileSync(join(root, 'dist/project-rag-policy-verifier.mjs'), code);
  writeFileSync(join(root, 'dist/project-rag-policy-verifier.json'), JSON.stringify({ schema: 'ProjectRagPolicyVerifier/v1',
    candidate: options.candidate, cleanSource: true, sha256: createHash('sha256').update(code).digest('hex') }));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Project RAG delivered artifacts and upgrade preservation', () => {
  it('reads back every delivered hash and rejects altered or half-installed files', () => {
    const root = fixture(), manifest = sealRetrievalArtifactManifest(root, options);
    expect(verifyRetrievalArtifactManifest(root).manifestDigest).toBe(manifest.manifestDigest);
    writeFileSync(join(root, 'dist/entry.js'), 'changed');
    expect(() => verifyRetrievalArtifactManifest(root)).toThrow('artifact mismatch');
    rmSync(join(root, 'dist/plugin-sdk/knowledge-retrieval.js'));
    expect(() => createRetrievalArtifactManifest(root, options)).toThrow();
  });

  it('rejects the wrong target and changed manifest identity', () => {
    const root = fixture(); sealRetrievalArtifactManifest(root, options);
    expect(() => verifyRetrievalArtifactManifest(root, { target: 'wrong-target' })).toThrow('target mismatch');
    const path = join(root, 'retrieval-artifact-manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')); manifest.candidate = 'b'.repeat(40);
    writeFileSync(path, JSON.stringify(manifest));
    expect(() => verifyRetrievalArtifactManifest(root)).toThrow('integrity mismatch');
  });

  it('rejects a verifier built from a different or dirty source candidate', () => {
    const root = fixture(), file = join(root, 'dist/project-rag-policy-verifier.json');
    const original = JSON.parse(readFileSync(file, 'utf8'));
    for (const changed of [{ ...original, candidate: 'b'.repeat(40) }, { ...original, cleanSource: false }]) {
      writeFileSync(file, JSON.stringify(changed));
      expect(() => sealRetrievalArtifactManifest(root, options)).toThrow('clean package candidate');
    }
  });

  it('keeps owner data intact while rejecting low space and unreadable rollback schemas', () => {
    const root = fixture(), previous = sealRetrievalArtifactManifest(root, options);
    const next = { ...previous, candidate: 'b'.repeat(40) };
    expect(planRetrievalUpgrade(previous, next, { databaseUserVersion: 1, freeBytes: 10 ** 9 })).toMatchObject({
      status: 'ready', dataCopied: false, dataDeleted: false, installed: false,
      canonicalDataAction: 'preserve-owner-databases',
    });
    expect(planRetrievalUpgrade(previous, next, { databaseUserVersion: 1, freeBytes: 0 }).status).toBe('rejected');
    expect(planRetrievalUpgrade(previous, { ...next, stateSchema: { ...next.stateSchema, writes: 2 } },
      { databaseUserVersion: 1, freeBytes: 10 ** 9 }).reasons).toContain('rollback-cannot-read-new-writes');
    expect(planRetrievalUpgrade(previous, next, { databaseUserVersion: 2, freeBytes: 10 ** 9 }).status).toBe('rejected');
  });
});
