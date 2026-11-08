import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, resolve, win32 } from 'node:path';
import ts from 'typescript';
import { resolveHistoricalTask } from './rsi-live-grader.mjs';

export const TASK_INPUT_BINDINGS = 'harness/specs/fixtures/rsi-task-inputs/public-bindings.v1.json';
export const PUBLIC_INPUT_PROTOCOL = 'RsiCodingTaskInputs/v1';
export const PUBLIC_BEHAVIOR_SOURCE = 'harness/specs/fixtures/rsi-model-diagnostic/g03/request.json';
const CORPUS = 'harness/specs/fixtures/rsi-evidence-loop/tf0604/task-corpus.v1.json';
const HISTORICAL = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
const CODING_BINDINGS = 'harness/specs/fixtures/rsi-coding-cohort/task-bindings.v1.json';
const blobs = new Map(), declarations = new Map(), bindingCache = new Map(), revisions = new Set();
const digest = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));

function inputPath(value) {
  assert(typeof value === 'string' && value && !posix.isAbsolute(value) && !win32.isAbsolute(value)
    && !/[\\:\x00-\x1f]/u.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..'),
  'invalid-public-input-path');
  assert(!/(?:^|\/)(?:tests?|fixtures|node_modules|\.git)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|acceptance|SHA256SUMS|(?:^|\/)\.env(?:\.|$)/iu.test(value),
  'private-public-input-path');
  assert(!/(?:^|\/)(?:artifacts|reports|evidence|handoffs|archives|runs)(?:\/|$)/iu.test(value),
    'private-public-input-path');
  assert(/^(?:src|shared|electron|scripts|harness|openclaw_runtime|packages|docs)\//u.test(value),
    'non-source-public-input-path');
  return value;
}
function allowedPath(value) {
  try { return inputPath(value); } catch { return null; }
}
export function assertPublicInputPath(value) { return inputPath(value); }
function blob(root, revision, path) {
  inputPath(path);
  assert(/^[a-f0-9]{40}$/u.test(revision), 'historical-input-revision-required');
  const revisionKey = root + ':' + revision;
  if (!revisions.has(revisionKey)) {
    execFileSync('git', ['cat-file', '-e', revision + '^{commit}'], {
      cwd: root, windowsHide: true, stdio: 'ignore',
    });
    revisions.add(revisionKey);
  }
  const key = root + ':' + revision + ':' + path;
  if (!blobs.has(key)) {
    try {
      blobs.set(key, execFileSync('git', ['show', revision + ':' + path], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024,
      }).toString('utf8'));
    } catch (error) {
      if (error.status === 128) blobs.set(key, null);
      else throw error;
    }
  }
  return blobs.get(key);
}
function imports(source, path) {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return parsed.statements.flatMap(node =>
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier) ? [node.moduleSpecifier.text] : []);
}
function importedPath(root, revision, importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const stem = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (!allowedPath(stem)) return null;
  const paths = /\.[cm]?[jt]sx?$/u.test(stem)
    ? [stem.replace(/\.js$/u, '.ts'), stem]
    : [stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.mjs'];
  return paths.find(path => blob(root, revision, path) !== null) ?? null;
}
export function assertDeclarationOnly(content) {
  assert(typeof content === 'string' && content.trim(), 'public-declaration-required');
  const source = ts.createSourceFile('public.d.mts', content, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, 'invalid-public-declaration');
  const inspect = node => {
    assert(!(ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)) || !node.body, 'public-declaration-has-implementation');
    assert(!(ts.isVariableDeclaration(node) || ts.isParameter(node)
      || ts.isPropertyDeclaration(node)) || !node.initializer, 'public-declaration-has-initializer');
    assert(!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)
      && !ts.isCallExpression(node) && !ts.isNewExpression(node)
      && !ts.isExpressionStatement(node) && !ts.isIfStatement(node)
      && !ts.isReturnStatement(node), 'executable-public-declaration');
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        assert(!/(?:^|\/)(?:tests?|fixtures|node_modules|\.git)(?:\/|$)|\.(?:test|spec)\./iu.test(specifier.text),
          'private-public-declaration-import');
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return true;
}
export function publicDeclarations(source, path) {
  const key = path + ':' + digest(source);
  if (declarations.has(key)) return declarations.get(key);
  let content = source;
  if (!/\.d\.[cm]?ts$/u.test(path)) {
    const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
      declaration: true, emitDeclarationOnly: true, removeComments: true, noResolve: true,
      noEmitOnError: false, skipLibCheck: true, types: [] };
    const result = ts.transpileDeclaration(source, { fileName: path, compilerOptions: options, reportDiagnostics: true });
    content = result.outputText;
    if (result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
      const name = resolve(path);
      const host = ts.createCompilerHost(options);
      const original = host.getSourceFile;
      const sameFile = file => resolve(file).toLowerCase() === name.toLowerCase();
      const originalExists = host.fileExists, originalRead = host.readFile;
      host.fileExists = file => sameFile(file) || originalExists(file);
      host.readFile = file => sameFile(file) ? source : originalRead(file);
      host.getSourceFile = (file, language, onError, create) => sameFile(file)
        ? ts.createSourceFile(name, source, language, true) : original(file, language, onError, create);
      const outputs = [];
      const program = ts.createProgram([name], options, host);
      const emission = program.emit(undefined, (file, value) => { if (/\.d\.[cm]?ts$/u.test(file)) outputs.push(value); });
      assert(!emission.emitSkipped && outputs.length === 1, 'public-declaration-emission-failed:' + path);
      content = outputs[0];
    }
  }
  const parsed = ts.createSourceFile('public.d.mts', content, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const normalized = ts.transform(parsed, [context => {
    const visit = node => {
      if (ts.isVariableDeclaration(node) && node.initializer
        && node.parent?.parent?.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)
        && (ts.isStringLiteral(node.initializer) || ts.isNumericLiteral(node.initializer))) {
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken,
          ts.factory.createLiteralTypeNode(node.initializer), undefined);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  content = printer.printFile(normalized.transformed[0]);
  normalized.dispose();
  try { assertDeclarationOnly(content); }
  catch (error) { throw new Error(path + ': ' + error.message); }
  assert(parsed.statements.some(n => ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)
    || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isVariableStatement(n)
    || ts.isExportDeclaration(n) && n.moduleSpecifier), 'empty-public-api');
  declarations.set(key, content);
  return content;
}
function targetPaths(task) {
  return task.input.targetScope.filter(path => allowedPath(path));
}
function sourceLocators(root, task, targets) {
  const paths = new Set(targets), origins = [];
  for (const path of [...new Set([...targets, ...task.input.contextRefs])]) {
    if (!allowedPath(path)) continue;
    const source = blob(root, task.ref, path);
    if (source === null) continue;
    origins.push({ path, revision: task.ref, sourceSha256: digest(source), projection: 'imports-and-path-locators-only' });
    if (/\.[cm]?[jt]sx?$/u.test(path)) {
      for (const specifier of imports(source, path)) {
        const dependency = importedPath(root, task.ref, path, specifier);
        if (dependency) paths.add(dependency);
      }
    } else if (path.endsWith('.md')) {
      for (const match of source.matchAll(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|md|json)/gu)) {
        if (allowedPath(match[0])) paths.add(match[0]);
      }
    }
  }
  for (const path of targets.filter(path => /\.[cm]?[jt]sx?$/u.test(path) && !/\.d\.[cm]?ts$/u.test(path))) {
    const stem = posix.basename(path).replace(/\.[cm]?[jt]sx?$/u, '');
    let result;
    try {
      result = execFileSync('git', ['grep', '-Il', '-F', stem, task.base, '--', '*.ts', '*.tsx', '*.mts', '*.mjs'], {
        cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) { if (error.status === 1) continue; throw error; }
    for (const line of result.trim().split('\n')) {
      const caller = line.slice(task.base.length + 1);
      if (!allowedPath(caller) || targets.includes(caller)) continue;
      const source = blob(root, task.base, caller);
      if (source && imports(source, caller).some(specifier => {
        const name = posix.normalize(posix.join(posix.dirname(caller), specifier)).replace(/\.[cm]?[jt]sx?$/u, '');
        return name === path.replace(/\.[cm]?[jt]sx?$/u, '');
      })) paths.add(caller);
    }
  }
  return { paths: [...paths], origins };
}
function identity(task, targets) {
  return { id: task.id, base: task.base, reference: task.ref,
    sourceRecord: task.referenceSolution.sourceRecord, sourceRecordSha256: task.referenceSolution.sourceRecordSha256,
    targetScope: targets, oracleDigest: task.oracleDigest };
}
function publishedBehavior(root, taskId) {
  if (taskId !== 'tf-0291-g03') return null;
  const revision = '5ad905b44c2822caf6037df9278a8a260a27d3f9';
  const source = readFileSync(resolve(root, PUBLIC_BEHAVIOR_SOURCE));
  const reference = execFileSync('git', ['show', revision + ':' + PUBLIC_BEHAVIOR_SOURCE], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.equal(digest(source), digest(reference), 'published-interface-source-drift');
  const marker = '\nPublic interface contract for the hidden tests:\n';
  const input = JSON.parse(source.toString('utf8')).input;
  const parts = input.split(marker);
  assert.equal(parts.length, 2, 'published-interface-contract-marker');
  const content = parts[1].split('\nReturn only JSON.')[0].trim();
  assert(content.startsWith('- Export traceToEvalSample') && content.length < 5000,
    'published-interface-contract-shape');
  return { content, source: { path: PUBLIC_BEHAVIOR_SOURCE, revision,
    sourceSha256: digest(source), projection: 'published-interface-text-only' } };
}
export function buildTaskInputBindings(root) {
  root = resolve(root);
  const corpus = read(resolve(root, CORPUS));
  const historical = read(resolve(root, HISTORICAL));
  const fingerprint = [CORPUS, HISTORICAL, CODING_BINDINGS, PUBLIC_BEHAVIOR_SOURCE,
    ...historical.tasks.map(t => t.referenceSolution.sourceRecord)]
    .map(path => digest(readFileSync(resolve(root, path)))).join(':');
  const key = root + ':' + fingerprint;
  if (bindingCache.has(key)) return structuredClone(bindingCache.get(key));
  const tasks = corpus.cases.map(item => {
    const task = resolveHistoricalTask(root, item.id, { codingCohort: true });
    const targets = targetPaths(task), publicSources = [];
    const code = targets.filter(path => /\.[cm]?[jt]sx?$/u.test(path));
    for (const path of code) {
      const declarationPath = path.endsWith('.mjs') && blob(root, task.ref, path.replace(/\.mjs$/u, '.d.mts')) !== null
        ? path.replace(/\.mjs$/u, '.d.mts') : path;
      if (publicSources.some(source => source.path === declarationPath)) continue;
      const source = blob(root, task.ref, declarationPath);
      assert(source !== null, 'public-interface-source-missing:' + declarationPath);
      if (path.endsWith('.mjs') && declarationPath === path) continue;
      const content = publicDeclarations(source, declarationPath);
      publicSources.push({ path: declarationPath, revision: task.ref, sourceSha256: digest(source),
        declaration: content, declarationSha256: digest(content) });
    }
    const kind = code.length ? 'module-implementation' : 'specification-verification';
    assert(kind !== 'module-implementation' || publicSources.length > 0, 'missing-public-api:' + task.id);
    const located = sourceLocators(root, task, targets);
    const removed = new Set(task.baselineSetup?.removePaths.map(path => path.path) ?? []);
    const baseSources = located.paths.map(path => {
      const content = removed.has(path) ? null : blob(root, task.base, path);
      return { path, revision: task.base, sourceSha256: content === null ? null : digest(content),
        missing: content === null, required: targets.includes(path), reconstructed: removed.has(path) };
    });
    return { identity: identity(task, targets), kind, publicSources, baseSources, locatorSources: located.origins,
      behaviorContract: publishedBehavior(root, task.id),
      documentContract: { format: 'repository-markdown-or-module-contract',
        taskSpecFields: ['id', 'title', 'intent', 'requiredTests', 'requiredRules', 'lifecycleStatus'],
        lifecycleStates: ['active', 'completed', 'archived'], sourceOfTruth: 'historical-base-and-declared-task-criteria' } };
  });
  assert.equal(tasks.length, 24, 'public-task-corpus-size');
  const result = { schemaVersion: 'RsiCodingTaskInputBindings/v1', protocol: PUBLIC_INPUT_PROTOCOL,
    compilerVersion: ts.version, driven_by: 'agent', actor: 'codex/rsi-public-task-inputs', tasks };
  bindingCache.set(key, result);
  return structuredClone(result);
}
export function verifyTaskInputBindings(root, bindings) {
  assert.equal(bindings?.schemaVersion, 'RsiCodingTaskInputBindings/v1', 'public-input-schema');
  assert.equal(bindings.compilerVersion, ts.version, 'public-input-compiler-drift');
  for (const task of bindings.tasks ?? []) {
    for (const source of [...task.publicSources, ...task.baseSources, ...task.locatorSources]) inputPath(source.path);
    for (const source of task.publicSources) assertDeclarationOnly(source.declaration);
  }
  assert.deepEqual(bindings, buildTaskInputBindings(root), 'public-task-input-bindings-drift');
  return true;
}
export function buildPublicTaskInputs(root, taskId, options = {}) {
  const bindings = read(resolve(root, TASK_INPUT_BINDINGS));
  verifyTaskInputBindings(root, bindings);
  const binding = bindings.tasks.find(task => task.identity.id === taskId);
  assert(binding, 'public-task-input-missing');
  const task = resolveHistoricalTask(root, taskId, { codingCohort: true });
  assert.deepEqual(binding.identity, identity(task, targetPaths(task)), 'public-task-identity-drift');
  const maxChars = options.maxContextChars ?? 100000, maxFiles = options.maxContextFiles ?? 24;
  assert(Number.isSafeInteger(maxChars) && maxChars > 0 && Number.isSafeInteger(maxFiles) && maxFiles > 0, 'invalid-public-input-budget');
  const input = { prompt: task.input.prompt, acceptanceCriteria: task.input.acceptanceCriteria,
    targetScope: binding.identity.targetScope, ...(options.responseSchema ? { responseSchema: options.responseSchema } : {}),
    taskKind: binding.kind, publicContract: { protocol: PUBLIC_INPUT_PROTOCOL,
      declarations: binding.publicSources.map(source => ({ path: source.path, content: source.declaration })),
      ...(binding.behaviorContract ? { behavior: binding.behaviorContract.content } : {}),
      document: binding.documentContract }, baseFiles: [], omittedContext: [] };
  const length = () => JSON.stringify(input, null, 2).length;
  assert(length() < maxChars, 'required-public-input-over-budget');
  const sources = [...binding.publicSources, ...binding.locatorSources];
  if (binding.behaviorContract) sources.push(binding.behaviorContract.source);
  for (const source of binding.baseSources) {
    const content = source.missing ? null : blob(root, source.revision, source.path);
    assert.equal(content === null ? null : digest(content), source.sourceSha256, 'base-public-input-drift');
    const entry = { path: source.path, content, ...(source.missing ? { missing: true, reconstructed: source.reconstructed } : {}) };
    const fitsCount = input.baseFiles.length < maxFiles;
    input.baseFiles.push(entry);
    const fitsChars = length() + binding.baseSources.length * 160 < maxChars;
    if (!fitsCount || !fitsChars) {
      input.baseFiles.pop();
      assert(!source.required, 'required-base-input-over-budget:' + source.path);
      input.omittedContext.push({ path: source.path, reason: !fitsCount ? 'file-budget' : 'character-budget' });
    }
    sources.push(source);
  }
  assert(length() <= maxChars, 'public-input-over-budget');
  return { input, inputDigest: digest(JSON.stringify(input)), sources, omitted: input.omittedContext };
}
