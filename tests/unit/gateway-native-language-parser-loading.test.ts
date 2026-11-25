// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { expect, it } from 'vitest';

it('keeps actual native grammars unloaded for metadata and fallback and detects an eager import', async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'g3-native-parser-load-'));
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unexpected native fixture root');
  const runtime = path.resolve('openclaw_runtime');
  const directory = 'src/context-engine/producers/analyzers';
  const sourceFiles = [
    'registry.ts', 'typescript-analyzer.ts', 'fallback-analyzer.ts', 'tree-sitter-base.ts',
    'python-treesitter-analyzer.ts', 'go-treesitter-analyzer.ts',
    'rust-treesitter-analyzer.ts', 'java-treesitter-analyzer.ts',
  ].map(file => directory + '/' + file).concat('src/context-engine/producers/hash.ts');
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    for (const file of sourceFiles) {
      const target = path.join(root, file.replace(/\.ts$/, '.js'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const sourcePath = path.join(runtime, file);
      const source = fs.readFileSync(sourcePath, 'utf8');
      const transformed = await transformWithEsbuild(source, sourcePath, { target: 'node22', format: 'esm' });
      fs.writeFileSync(target, transformed.code);
    }
    const entry = path.join(root, directory, 'registry.js');
    const bootstrap = path.join(root, 'bootstrap.mjs');
    fs.writeFileSync(bootstrap, `
      import assert from 'node:assert/strict';
      import { createHash } from 'node:crypto';
      import { createRequire, registerHooks } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const nativeRequire = createRequire(${JSON.stringify(pathToFileURL(path.join(runtime, 'package.json')).href)});
      const names = ['tree-sitter', 'tree-sitter-python', 'tree-sitter-go', 'tree-sitter-rust', 'tree-sitter-java'];
      const aliases = Object.fromEntries([...names, 'typescript'].map(name => [name, nativeRequire.resolve(name)]));
      const hook = registerHooks({ resolve(specifier, context, next) {
        return aliases[specifier] ? { shortCircuit: true, url: pathToFileURL(aliases[specifier]).href } : next(specifier, context);
      } });
      const loaded = () => names.filter(name => !!nativeRequire.cache[aliases[name]]).sort();
      const provenance = { driven_by: 'agent', actor: 'gateway-native-language-parser-test', realHumanEvidence: false };
      const registry = await import(${JSON.stringify(pathToFileURL(entry).href)});
      registry.listAnalyzers();
      registry.analyzerFor('java');
      console.log(JSON.stringify({ phase: 'metadata', loaded: loaded(), ...provenance }));
      assert.deepEqual(loaded(), [], 'Native dependencies loaded during metadata');
      const fallback = 'fallback text';
      const file = { projectId: 'fixture', path: 'notes.txt', absolutePath: '/fixtures/notes.txt', language: 'unknown',
        sizeBytes: Buffer.byteLength(fallback), contentHash: createHash('sha256').update(fallback).digest('hex'), modifiedAtMs: 0 };
      registry.analyzeFileWithRegistry({ repoRoot: '/fixtures', file, content: fallback });
      assert.deepEqual(loaded(), [], 'Native dependencies loaded during fallback');
      const content = 'def hello(name):\\n    return name.strip()\\n';
      const input = { repoRoot: '/fixtures', file: { ...file, path: 'sample.py', absolutePath: '/fixtures/sample.py', language: 'python',
        sizeBytes: Buffer.byteLength(content), contentHash: createHash('sha256').update(content).digest('hex') }, content };
      const analysis = registry.analyzeFileWithRegistry(input);
      assert(analysis.symbols.some(symbol => symbol.name === 'hello'));
      assert.deepEqual(loaded(), ['tree-sitter', 'tree-sitter-python']);
      assert.deepEqual(registry.analyzeFileWithRegistry(input), analysis);
      assert.deepEqual(loaded(), ['tree-sitter', 'tree-sitter-python']);
      console.log(JSON.stringify({ phase: 'parsed', loaded: loaded(), node: process.version, symbols: analysis.symbols.map(symbol => symbol.name), ...provenance }));
      hook.deregister();
    `);
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC'].includes(key.toUpperCase())));
    const run = () => spawnSync(process.execPath, [bootstrap], {
      cwd: root, windowsHide: true, timeout: 15_000, encoding: 'utf8',
      env: { ...inherited, TEMP: tmpdir(), TMP: tmpdir(), NODE_DISABLE_COMPILE_CACHE: '1' },
    });
    const healthy = run();
    expect(healthy.error).toBeUndefined();
    expect(healthy.status, healthy.stderr).toBe(0);
    const records = healthy.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    expect(records[0].loaded).toEqual([]);
    expect(records[1].loaded).toEqual(['tree-sitter', 'tree-sitter-python']);
    const basePath = path.join(runtime, directory, 'tree-sitter-base.ts');
    const baseFile = path.join(root, directory, 'tree-sitter-base.js');
    const original = fs.readFileSync(baseFile, 'utf8');
    const source = fs.readFileSync(basePath, 'utf8');
    const eagerSource = source.replace('import type Parser from "tree-sitter";', 'import Parser from "tree-sitter";');
    expect(eagerSource).not.toBe(source);
    fs.writeFileSync(baseFile, (await transformWithEsbuild(eagerSource, basePath, { target: 'node22', format: 'esm' })).code);
    const eager = run();
    expect(eager.error).toBeUndefined();
    expect(eager.status).toBe(1);
    expect(eager.stderr).toContain('Native dependencies loaded during metadata');
    expect(JSON.parse(eager.stdout.trim()).loaded).toEqual(['tree-sitter']);
    fs.writeFileSync(baseFile, original);
    if (process.env.CLAWX_TEST_EVIDENCE_DIR) {
      const evidence = path.join(process.env.CLAWX_TEST_EVIDENCE_DIR, path.basename(root));
      fs.cpSync(root, evidence, { recursive: true, force: false, errorOnExist: true });
      fs.writeFileSync(path.join(evidence, 'readback.json'), JSON.stringify({
        schema: 'NativeGrammarLoadingProof/v1', records, eager: { status: eager.status, stdout: eager.stdout, stderr: eager.stderr },
        driven_by: 'agent', actor: 'gateway-native-language-parser-test', realHumanEvidence: false,
      }, null, 2), { flag: 'wx' });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
