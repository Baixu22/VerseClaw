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

export const STRUCTURED_CODING_COLLECTOR = Object.freeze({ ...CODING_COLLECTOR,
  version: 'RsiCodingCollector/v2', responseFormat: 'strict-json-schema',
  incompleteOutcome: 'known-output-limit-is-failure',
  infrastructurePolicy: 'retain-slot-and-continue', unknownUsagePolicy: 'reserve-request-upper-bound',
  loopbackTransport: 'direct-node-http', schemaEnforcement: 'local-strict-validation',
});

export const PUBLIC_CODING_COLLECTOR = Object.freeze({ ...STRUCTURED_CODING_COLLECTOR,
  version: 'RsiCodingCollector/v3', publicInputProtocol: 'RsiCodingTaskInputs/v1',
});

export const CODING_TOOLS = Object.freeze([
  { type: 'function', name: 'read_file', description: 'Read a bounded range of an allowed task source or public declaration.',
    strict: true, parameters: { type: 'object', additionalProperties: false, required: ['path', 'startLine', 'maxLines'],
      properties: { path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 200 } } } },
  { type: 'function', name: 'apply_edits', description: 'Apply a validated batch. A null oldText writes a complete file; otherwise replace one exact occurrence.',
    strict: true, parameters: { type: 'object', additionalProperties: false, required: ['edits'],
      properties: { edits: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false,
        required: ['path', 'oldText', 'newText'], properties: { path: { type: 'string' },
          oldText: { type: ['string', 'null'] }, newText: { type: 'string' } } } } } } },
  { type: 'function', name: 'check_public_contract', description: 'Check edited-source syntax, public exported names and task document fields without running hidden tests.',
    strict: true, parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] } },
]);
export const TOOL_CODING_COLLECTOR = Object.freeze({ ...PUBLIC_CODING_COLLECTOR,
  version: 'RsiCodingCollector/v4', maxProviderCalls: 4, maxToolCalls: 12,
  maxToolOutputChars: 12000, maxEditBytes: 256000, maxEditFiles: 32, slotTimeoutMs: 900000,
  tools: CODING_TOOLS, responseSchema: { type: 'object', additionalProperties: false,
    required: ['finish'], properties: { finish: { type: 'boolean', const: true } } },
});
export const TOOL_CODING_INSTRUCTIONS = 'Implement the supplied task in the isolated workspace. Use read_file, apply_edits and check_public_contract within the frozen budgets. apply_edits can change several files in one call. Use only declared source paths and targetScope; preserve tests, evaluator, dependencies and permissions. After public checks, return only {"finish":true}. Do not repeat source files in the final response. Hidden tests run independently after completion; do not read tests at runtime or perform network or process effects in the implementation.';
export function parseCodingFinish(text) {
  const result = JSON.parse(text);
  assert(result && typeof result === 'object' && !Array.isArray(result), 'finish-object-required');
  assert.deepEqual(Object.keys(result), ['finish'], 'finish-schema');
  assert.equal(result.finish, true, 'finish-acknowledgement-required');
  return true;
}
export function reserveProviderTokens(plan, attempts) {
  return attempts.reduce((sum, attempt) => {
    const usage = attempt.parsedResponse?.usage;
    if (usage) return sum + usage.totalTokens;
    assert.equal(plan.collector.unknownUsagePolicy, 'reserve-request-upper-bound', 'unknown-usage-halts-campaign');
    return sum + Buffer.byteLength(JSON.stringify(attempt.request)) + plan.provider.maxOutputTokens;
  }, 0);
}

export function codingCollectorConfig(version = CODING_COLLECTOR.version) {
  if (version === CODING_COLLECTOR.version) return CODING_COLLECTOR;
  if (version === PUBLIC_CODING_COLLECTOR.version) return PUBLIC_CODING_COLLECTOR;
  if (version === TOOL_CODING_COLLECTOR.version) return TOOL_CODING_COLLECTOR;
  assert.equal(version, STRUCTURED_CODING_COLLECTOR.version, 'unknown-coding-collector-version');
  return STRUCTURED_CODING_COLLECTOR;
}

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
