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
export const GUIDED_TOOL_COST_POLICY = Object.freeze({ schemaVersion: 'RsiCodingToolCostPolicy/v1',
  collectorVersion: 'RsiCodingCollector/v5', policy: 'absolute-per-slot-budget',
  maxToolCallsPerSlot: 12, maxProviderCallsPerSlot: 4 });
// v5 keeps the v4 budgets and permissions. It changes what the subject is told and when a slot ends.
export const GUIDED_CODING_TOOLS = Object.freeze([
  { ...CODING_TOOLS[0], description: 'Read only workspace.readable paths. workspace.supplied and workspace.declarations are already in the request; workspace.absent lists missing baseline files. Read workspace.onDemand when more context is needed.' },
  { ...CODING_TOOLS[1], description: 'Apply a validated batch to workspace.writable paths. A null oldText writes a complete file; otherwise replace one exact occurrence. A rejected batch changes nothing. An applied batch returns publicCheck for the whole workspace.' },
  { ...CODING_TOOLS[2], description: 'Repeat the public check that apply_edits already returns: syntax, public exported names and task document fields. Hidden tests are not run.' },
]);
export const GUIDED_TOOL_CODING_COLLECTOR = Object.freeze({ ...TOOL_CODING_COLLECTOR,
  version: 'RsiCodingCollector/v5', tools: GUIDED_CODING_TOOLS,
  workspaceManifest: 'RsiCodingWorkspaceManifest/v1', maxManifestChars: 12000,
  toolFeedback: 'structured-errors-and-remaining-budget', editPublicCheck: 'after-each-applied-batch',
  terminalToolRound: 'execute-then-grade-when-public-check-passes', toolCostPolicy: 'absolute-per-slot-budget',
  costPolicy: GUIDED_TOOL_COST_POLICY,
});
export const GUIDED_TOOL_CODING_INSTRUCTIONS = 'Implement the supplied task in the isolated workspace using apply_edits. workspace.readable is the complete read allowlist: supplied source is in baseFiles, public declarations are in publicContract.declarations, absent files are missing from the task baseline, and onDemand lists omitted historical context. Start from the supplied content; read onDemand paths only when needed, or reread an edited file to resolve an exact-match error. A rejected path does not reveal whether it exists. Write only workspace.writable paths. apply_edits takes {"edits":[{"path":"src/example.mjs","oldText":null,"newText":"complete content"}]}; null oldText writes a complete file, a string replaces exactly one occurrence, and all edits validate before any write. Batch related edits. Every applied batch returns publicCheck for current syntax, exported names and document fields; repair its errors using the supplied public contract. Tool results include the remaining call budget. When publicCheck.ok is true, return only {"finish":true}. The fourth and last permitted model response may contain tool calls: they execute within the same tool budget and the executor submits the resulting workspace only if its public check passes. No fifth request is made. Hidden behavioral tests run independently after submission. Preserve tests, evaluator, dependencies and permissions; do not read hidden tests or perform network or process effects in the implementation.';
export const TERMINAL_TOOL_COST_POLICY = Object.freeze({ ...GUIDED_TOOL_COST_POLICY,
  schemaVersion: 'RsiCodingToolCostPolicy/v2', collectorVersion: 'RsiCodingCollector/v6' });
export const PUBLIC_ERROR_CONVENTION = 'Unless a contract explicitly defines a denial return value, reject means throw an Error; do not silently skip invalid or conflicting input.';
export const TERMINAL_CODING_COLLECTOR = Object.freeze({ ...GUIDED_TOOL_CODING_COLLECTOR,
  version: 'RsiCodingCollector/v6', publicInputProtocol: 'RsiCodingTaskInputs/v2',
  responseFormat: 'tool-or-message-terminal', terminalMessage: 'nonempty-completed-with-verified-edits',
  costPolicy: TERMINAL_TOOL_COST_POLICY });
export const TERMINAL_CODING_INSTRUCTIONS = GUIDED_TOOL_CODING_INSTRUCTIONS.replace(
  'When publicCheck.ok is true, return only {"finish":true}.',
  'After making the required edits and passing publicCheck, submit {"finish":true} or a brief nonempty completion message. The executor grades the actual files independently; a completion statement is never a passing grade.');
export const FILE_WRITE_TOOL_COST_POLICY = Object.freeze({ ...GUIDED_TOOL_COST_POLICY,
  schemaVersion: 'RsiCodingToolCostPolicy/v3', collectorVersion: 'RsiCodingCollector/v7' });
export const FILE_WRITE_CODING_COLLECTOR = Object.freeze({ ...TERMINAL_CODING_COLLECTOR,
  version: 'RsiCodingCollector/v7', costPolicy: FILE_WRITE_TOOL_COST_POLICY,
  tools: Object.freeze([GUIDED_CODING_TOOLS[0],
    { type: 'function', name: 'rsi_write_files', strict: true,
      description: 'Create or replace complete files. Each item must include its own explicit path and complete content. Validate the entire batch before writing; return file effects and the current public check.',
      parameters: { type: 'object', additionalProperties: false, required: ['files'], properties: {
        files: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false,
          required: ['path', 'content'], properties: { path: { type: 'string', minLength: 1 }, content: { type: 'string' } } } } } } },
    { ...GUIDED_CODING_TOOLS[2], description: 'Repeat the public syntax, export and document check already returned by rsi_write_files. Hidden tests are not run.' }]),
});
export const FILE_WRITE_CODING_INSTRUCTIONS = TERMINAL_CODING_INSTRUCTIONS
  .replaceAll('apply_edits', 'rsi_write_files')
  .replace('rsi_write_files takes {"edits":[{"path":"src/example.mjs","oldText":null,"newText":"complete content"}]}; null oldText writes a complete file, a string replaces exactly one occurrence, and all edits validate before any write.',
    'rsi_write_files takes exactly {"files":[{"path":"src/example.mjs","content":"complete content"}]}. Every file item includes its own path and the complete replacement content. Use the same shape for missing and existing files. All files validate before any write; duplicate paths are rejected.')
  .replace('or reread an edited file to resolve an exact-match error', 'or reread an edited file before replacing its complete content');
export const isFileWriteCodingCollector = collector => collector?.version === FILE_WRITE_CODING_COLLECTOR.version;
export const isTerminalCodingCollector = collector => [TERMINAL_CODING_COLLECTOR.version, FILE_WRITE_CODING_COLLECTOR.version].includes(collector?.version);
export const isToolCodingCollector = collector => [TOOL_CODING_COLLECTOR.version, GUIDED_TOOL_CODING_COLLECTOR.version].includes(collector?.version) || isTerminalCodingCollector(collector);
export const isGuidedCodingCollector = collector => collector?.version === GUIDED_TOOL_CODING_COLLECTOR.version || isTerminalCodingCollector(collector);
export function codingWorkspaceManifest(task, collector = GUIDED_TOOL_CODING_COLLECTOR) {
  const input = task.publicInput, base = input.baseFiles;
  const declarations = input.publicContract.declarations.map(file => file.path);
  const readable = [...new Set([...task.targetScope, ...base.map(file => file.path), ...declarations,
    ...input.omittedContext.map(file => file.path)])];
  const manifest = { protocol: collector.workspaceManifest, readable, writable: [...task.targetScope],
    supplied: base.filter(file => file.content !== null).map(file => file.path),
    absent: base.filter(file => file.content === null).map(file => file.path),
    declarations, onDemand: input.omittedContext.map(file => file.path),
    budgets: { providerCalls: collector.maxProviderCalls, toolCalls: collector.maxToolCalls,
      toolOutputChars: collector.maxToolOutputChars, editFiles: collector.maxEditFiles, editBytes: collector.maxEditBytes } };
  const described = new Set([...manifest.supplied, ...manifest.absent]);
  assert(manifest.writable.every(path => described.has(path)), 'workspace-manifest-target-undescribed');
  assert(JSON.stringify({ workspace: manifest }, null, 2).length <= collector.maxManifestChars, 'workspace-manifest-over-budget');
  return manifest;
}
export function codingToolBudget(collector, providerCalls, executedToolCalls, providerLimit = collector.maxProviderCalls) {
  assert(Number.isSafeInteger(providerLimit) && providerLimit >= providerCalls && providerLimit <= collector.maxProviderCalls,
    'invalid-provider-feedback-budget');
  const providerCallsRemaining = providerLimit - providerCalls;
  return { providerCallsRemaining, toolCallsRemaining: collector.maxToolCalls - executedToolCalls,
    ...(providerCallsRemaining === 1 ? { note: 'One model request remains. Batch the necessary edits; its tools still execute within the tool budget.' } : {}) };
}
export function parseCodingFinish(text) {
  const result = JSON.parse(text);
  assert(result && typeof result === 'object' && !Array.isArray(result), 'finish-object-required');
  assert.deepEqual(Object.keys(result), ['finish'], 'finish-schema');
  assert.equal(result.finish, true, 'finish-acknowledgement-required');
  return true;
}
export function codingTerminalReason(collector, text) {
  try { parseCodingFinish(text); return 'model-finish'; }
  catch (error) {
    if (isTerminalCodingCollector(collector) && typeof text === 'string' && text.trim()) return 'model-message';
    throw error;
  }
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
  if (version === GUIDED_TOOL_CODING_COLLECTOR.version) return GUIDED_TOOL_CODING_COLLECTOR;
  if (version === TERMINAL_CODING_COLLECTOR.version) return TERMINAL_CODING_COLLECTOR;
  if (version === FILE_WRITE_CODING_COLLECTOR.version) return FILE_WRITE_CODING_COLLECTOR;
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
