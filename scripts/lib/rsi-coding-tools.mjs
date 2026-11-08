import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { parseFrontmatter } from '../../harness/src/specs.mjs';
import { assertPublicInputPath } from './rsi-task-inputs.mjs';
import { parseCodingEdits, TOOL_CODING_COLLECTOR } from './rsi-coding-protocol.mjs';

const hash = value => value === null ? null : createHash('sha256').update(value).digest('hex');
export function createCodingToolState(root, task, workspace = null) {
  return { root, task, workspace, edits: new Map(), cache: new Map() };
}
function allowedPath(state, path, write = false) {
  assertPublicInputPath(path);
  if (write) parseCodingEdits(JSON.stringify({ edits: [{ path, content: '' }] }), state.task);
  else assert([...state.task.targetScope, ...state.task.publicInput.baseFiles.map(file => file.path),
    ...state.task.publicInput.publicContract.declarations.map(file => file.path),
    ...state.task.publicInput.omittedContext.map(file => file.path)].includes(path), 'source-not-readable');
  return path;
}
function baseText(state, path) {
  if (state.cache.has(path)) return state.cache.get(path);
  const visible = state.task.publicInput.baseFiles.find(file => file.path === path);
  let content = visible ? visible.content : null;
  if (!visible) {
    const source = state.task.publicInputSources.find(source => source.path === path
      && source.revision === state.task.source.base && !source.projection);
    if (source && source.sourceSha256 !== null) {
      content = execFileSync('git', ['show', source.revision + ':' + path], {
        cwd: state.root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
      assert.equal(hash(content), source.sourceSha256, 'read-source-drift');
    }
  }
  state.cache.set(path, content);
  return content;
}
function currentText(state, path) {
  return state.edits.has(path) ? state.edits.get(path) : baseText(state, path);
}
function publicValueNames(content, path, implementation) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const names = [];
  for (const node of source.statements) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
    if (implementation && modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) names.push(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
    }
  }
  return { names, source };
}
function checkPublic(state) {
  const errors = [];
  for (const path of state.task.targetScope) {
    const content = currentText(state, path);
    if (content === null) { errors.push({ path, code: 'target-file-missing' }); continue; }
    if (/\.[cm]?[jt]sx?$/u.test(path)) {
      const parsed = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
      for (const diagnostic of parsed.parseDiagnostics) errors.push({ path, code: 'syntax',
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '), offset: diagnostic.start ?? null });
    } else if (path.startsWith('harness/specs/tasks/') && path.endsWith('.md')) {
      try {
        const metadata = parseFrontmatter(content).data;
        for (const field of state.task.publicInput.publicContract.document.taskSpecFields) {
          if (metadata[field] === undefined) errors.push({ path, code: 'task-field-missing', field });
        }
        if (!state.task.publicInput.publicContract.document.lifecycleStates.includes(metadata.lifecycleStatus)) {
          errors.push({ path, code: 'task-lifecycle-invalid' });
        }
      } catch { errors.push({ path, code: 'task-frontmatter-invalid' }); }
    }
  }
  for (const declaration of state.task.publicInput.publicContract.declarations) {
    const path = declaration.path.endsWith('.d.mts') ? declaration.path.replace(/\.d\.mts$/u, '.mjs') : declaration.path;
    const content = currentText(state, path);
    if (content === null) continue;
    const required = publicValueNames(declaration.content, declaration.path, false).names;
    const present = publicValueNames(content, path, true).names;
    for (const name of required) if (!present.includes(name)) errors.push({ path, code: 'public-export-missing', name });
  }
  const shown = errors.slice(0, 60);
  while (JSON.stringify({ ok: !errors.length, errorCount: errors.length, errors: shown,
    errorsTruncated: shown.length !== errors.length }).length > TOOL_CODING_COLLECTOR.maxToolOutputChars) shown.pop();
  return { ok: !errors.length, errorCount: errors.length, errors: shown, errorsTruncated: shown.length !== errors.length };
}
function readSource(state, args) {
  assert.deepEqual(Object.keys(args).sort(), ['maxLines', 'path', 'startLine'], 'read-file-arguments');
  const path = allowedPath(state, args.path);
  assert(Number.isSafeInteger(args.startLine) && args.startLine >= 1
    && Number.isSafeInteger(args.maxLines) && args.maxLines >= 1 && args.maxLines <= 200, 'read-file-range');
  let content = currentText(state, path), kind = 'source';
  if (content === null) {
    const declaration = state.task.publicInput.publicContract.declarations.find(file => file.path === path);
    if (declaration) { content = declaration.content; kind = 'public-contract'; }
  }
  if (content === null) return { ok: true, path, kind: 'missing', content: null };
  const lines = content.split(/\r?\n/u), start = args.startLine - 1;
  let selected = lines.slice(start, start + args.maxLines);
  const result = () => ({ ok: true, path, kind, startLine: args.startLine, totalLines: lines.length,
    text: selected.join('\n'), nextLine: start + selected.length < lines.length ? start + selected.length + 1 : null,
    sourceSha256: hash(content) });
  while (selected.length && JSON.stringify(result()).length > TOOL_CODING_COLLECTOR.maxToolOutputChars) selected.pop();
  assert(selected.length || start >= lines.length, 'source-line-over-budget');
  return result();
}
function applyBatch(state, args) {
  assert.deepEqual(Object.keys(args), ['edits'], 'edit-batch-arguments');
  assert(Array.isArray(args.edits) && args.edits.length > 0 && args.edits.length <= 32, 'edit-batch-size');
  const next = new Map(state.edits), touched = new Map();
  for (const edit of args.edits) {
    assert.deepEqual(Object.keys(edit).sort(), ['newText', 'oldText', 'path'], 'edit-arguments');
    const path = allowedPath(state, edit.path, true);
    assert(edit.oldText === null || typeof edit.oldText === 'string' && edit.oldText.length > 0, 'edit-old-text');
    assert(typeof edit.newText === 'string', 'edit-new-text');
    const original = currentText(state, path), current = next.has(path) ? next.get(path) : baseText(state, path);
    let content = edit.newText;
    if (edit.oldText !== null) {
      assert(typeof current === 'string' && current.split(edit.oldText).length === 2, 'edit-match-not-unique');
      content = current.replace(edit.oldText, () => edit.newText);
    }
    if (!touched.has(path)) touched.set(path, original);
    next.set(path, content);
  }
  for (const [path, content] of next) if (content === baseText(state, path)) next.delete(path);
  assert(next.size <= TOOL_CODING_COLLECTOR.maxEditFiles, 'edited-file-budget');
  assert([...next.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0)
    <= TOOL_CODING_COLLECTOR.maxEditBytes, 'edited-byte-budget');
  const effects = [...touched].map(([path, before]) => {
    const after = next.has(path) ? next.get(path) : baseText(state, path);
    return { path, beforeSha256: hash(before), afterSha256: hash(after), bytes: after === null ? 0 : Buffer.byteLength(after) };
  });
  state.edits = next;
  return { ok: true, effects };
}
export function evaluateCodingTool(state, call) {
  const before = new Map(state.edits);
  try {
    const args = JSON.parse(call.arguments);
    assert(args && typeof args === 'object' && !Array.isArray(args), 'tool-argument-object');
    let output;
    if (call.name === 'read_file') output = readSource(state, args);
    else if (call.name === 'apply_edits') output = applyBatch(state, args);
    else if (call.name === 'check_public_contract') {
      assert.deepEqual(Object.keys(args), [], 'public-check-arguments');
      output = checkPublic(state);
    } else throw new Error('unknown-coding-tool');
    assert(JSON.stringify(output).length <= TOOL_CODING_COLLECTOR.maxToolOutputChars, 'tool-output-budget');
    return output;
  } catch (error) {
    state.edits = before;
    return { ok: false, error: error.message };
  }
}
function workspaceFile(state, path) {
  const root = resolve(state.workspace), target = resolve(root, path), rel = relative(root, target);
  assert(rel && !rel.startsWith('..') && !rel.includes(':') && target.startsWith(root + sep), 'workspace-path-escape');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try { assert(!lstatSync(current).isSymbolicLink(), 'workspace-symlink'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
export function executeCodingTool(state, call) {
  const before = new Map(state.edits);
  const output = evaluateCodingTool(state, call);
  if (!output.ok || !output.effects) return { output, infrastructure: false };
  const completed = [];
  try {
    for (const effect of output.effects) {
      const target = workspaceFile(state, effect.path);
      const actual = existsSync(target) ? readFileSync(target, 'utf8') : null;
      assert.equal(hash(actual), effect.beforeSha256, 'workspace-file-drift');
    }
    for (const effect of output.effects) {
      const target = workspaceFile(state, effect.path);
      const content = state.edits.has(effect.path) ? state.edits.get(effect.path) : baseText(state, effect.path);
      mkdirSync(dirname(target), { recursive: true });
      const temporary = target + '.rsi-' + randomUUID() + '.tmp';
      try { writeFileSync(temporary, content, { flag: 'wx' }); renameSync(temporary, target); }
      finally { if (existsSync(temporary)) unlinkSync(temporary); }
      assert.equal(hash(readFileSync(target, 'utf8')), effect.afterSha256, 'workspace-write-drift');
      completed.push(effect);
    }
    return { output, infrastructure: false };
  } catch (error) {
    const intended = state.edits;
    state.edits = before;
    for (const effect of completed) state.edits.set(effect.path, intended.get(effect.path) ?? baseText(state, effect.path));
    return { output: { ok: false, error: 'tool-infrastructure', reason: error.message, effects: completed }, infrastructure: true };
  }
}
export function codingToolEdits(state) {
  return [...state.edits].sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => ({ path, content }));
}
export function hasPassingPublicCheck(events) {
  let passed = false;
  for (const event of events) {
    const output = JSON.parse(event.output);
    if (event.name === 'apply_edits' && output.ok) passed = false;
    if (event.name === 'check_public_contract') passed = output.ok === true;
  }
  return passed;
}
export function verifyCodingToolJournal(root, task, events, edits, interrupted = false) {
  const state = createCodingToolState(root, task);
  for (const [index, event] of events.entries()) {
    const before = new Map(state.edits);
    const expected = evaluateCodingTool(state, event);
    const actual = JSON.parse(event.output);
    if (interrupted && index === events.length - 1 && actual.error === 'tool-infrastructure') {
      assert(Array.isArray(actual.effects) && (expected.effects ?? []).length >= actual.effects.length,
        'invalid-partial-tool-effects');
      assert.deepEqual(actual.effects, (expected.effects ?? []).slice(0, actual.effects.length), 'partial-tool-effect-drift');
      const intended = state.edits;
      state.edits = before;
      for (const effect of actual.effects) {
        const content = intended.has(effect.path) ? intended.get(effect.path) : baseText(state, effect.path);
        if (content === baseText(state, effect.path)) state.edits.delete(effect.path);
        else state.edits.set(effect.path, content);
      }
    } else assert.deepEqual(actual, expected, 'tool-output-or-effect-drift');
  }
  assert.deepEqual(edits, codingToolEdits(state), 'tool-final-edit-drift');
  return true;
}
