import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';

export const CODING_COLLECTOR = Object.freeze({ version: 'RsiCodingCollector/v1',
  reasoningEffort: 'low', maxOutputTokens: 16000, timeoutMs: 240000,
  oracleTimeoutMs: 300000, maxProviderAttempts: 1, maxContextChars: 100000,
  supportPackage: { name: 'markdown-it', version: '14.2.0' },
  responseSchema: { type: 'object', additionalProperties: false, required: ['edits'], properties: {
    edits: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false,
      required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } } },
}});

export const CODING_INSTRUCTIONS = 'Return only strict JSON matching the supplied responseSchema: {"edits":[{"path":"repository/relative/path","content":"complete UTF-8 file content"}]}. No tools, markdown fences or commentary. Edit only targetScope. Preserve tests, graders, permissions and dependency configuration. Base files marked missing must be implemented from the supplied behavior contract and existing callers. Do not read tests at runtime or perform network or process effects in the implementation.';

export function parseCodingEdits(text, task) {
  const answer = JSON.parse(text);
  assert(answer && typeof answer === 'object' && !Array.isArray(answer), 'edits-object-required');
  assert.deepEqual(Object.keys(answer), ['edits'], 'edits-schema');
  assert(Array.isArray(answer.edits) && answer.edits.length <= 32, 'edits-array');
  const seen = new Set();
  for (const edit of answer.edits) {
    assert(edit && typeof edit === 'object', 'edit-object');
    assert.deepEqual(Object.keys(edit).sort(), ['content', 'path'], 'edit-schema');
    const p = edit.path;
    assert(typeof p === 'string' && p.length > 0 && !posix.isAbsolute(p) && !win32.isAbsolute(p)
      && !/[\\:\x00-\x1f]/u.test(p) && p.split('/').every(part => part && part !== '.' && part !== '..'
        && !['.git', 'node_modules'].includes(part.toLowerCase())), 'unsafe-edit-path');
    const lower = p.toLowerCase();
    const oraclePaths = task.oracle.testPaths.map(p => p.toLowerCase());
    assert(!oraclePaths.includes(lower), 'edit-targets-hidden-oracle');
    assert(task.targetScope.some(scope => p === scope || scope.endsWith('/') && p.startsWith(scope)), 'edit-outside-task-scope');
    assert(!seen.has(lower), 'duplicate-edit-path'); seen.add(lower);
    assert(typeof edit.content === 'string', 'edit-content-required');
  }
  return answer.edits;
}
