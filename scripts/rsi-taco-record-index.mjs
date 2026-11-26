import { createHash } from 'node:crypto';
import { canonicalizeTacoRow, referenceShape, tacoSourceIdentity } from './lib/rsi-semantic-corpus-import.mjs';
import { benefitDigest } from './lib/rsi-benefit-eval.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const decimal = /(?:^|\s)[+-]?(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+)(?:[eE][+-]?\d+)?(?=\s|$)/u;
const identityOnly = process.argv.includes('--identity-only');

function indexRow(line) {
  const { row, revision, shard, rowIndex, serializedIoSha256 } = JSON.parse(line);
  const meta = { upstreamId: `taco:${shard}#${rowIndex}`, shard, rowIndex, source: row.source ?? null,
    sourceIdentity: null, eligible: false, referenceShape: null, referenceSha256: null };
  try {
    Object.assign(meta, tacoSourceIdentity(row, { revision, shard, rowIndex }));
    if (identityOnly) {
      process.stdout.write(JSON.stringify(meta) + '\n');
      return;
    }
    const solutions = typeof row.solutions === 'string' ? JSON.parse(row.solutions) : row.solutions;
    const reference = Array.isArray(solutions) ? solutions.find(value => typeof value === 'string' && value.trim()) : null;
    if (reference && reference.length <= 2_000_000) {
      meta.referenceSha256 = sha(reference);
      meta.referenceShape = referenceShape({ language: 'python', source: reference });
    }
    const io = typeof row.input_output === 'string' ? JSON.parse(row.input_output) : row.input_output;
    const kind = io.fn_name ? 'function' : [...io.inputs, ...io.outputs].some(Array.isArray) ? 'lines' : 'strings';
    meta.kind = kind;
    meta.serializedIoSha256 = typeof row.input_output === 'string' ? sha(row.input_output) : serializedIoSha256 ?? null;
    if (!/^[0-9a-f]{64}$/u.test(meta.serializedIoSha256 ?? '')) throw Error('unsupported-io-binding');
    if (Array.isArray(io.inputs) && Array.isArray(io.outputs) && io.inputs.length > 0 &&
      io.inputs.length === io.outputs.length && io.inputs.length < 5) {
      meta.vectors = io.inputs.length;
      throw Error('under-five-distinct-official-inputs');
    }
    const canonical = canonicalizeTacoRow(io.fn_name ? row : { ...row, input_output: io }, { revision, shard, rowIndex,
      functionAdapter: 'json-stdio', stdioAdapter: kind === 'lines' ? 'newline-lines' : 'strings' });
    const distinctInputs = new Set(canonical.tests.map(test => test.input)).size;
    Object.assign(meta, { kind, vectors: canonical.tests.length, distinctInputs,
      sourceIdentityEvidence: canonical.sourceIdentityEvidence });
    if (canonical.prompt.trim().length < 40 || canonical.prompt.length > 200_000 || canonical.tests.length > 10_000)
      throw Error('public-contract-size');
    if (distinctInputs < 5) throw Error('under-five-distinct-official-inputs');
    const outputs = new Map();
    for (const test of canonical.tests) {
      if (outputs.has(test.input) && outputs.get(test.input) !== test.output) throw Error('conflicting-output');
      outputs.set(test.input, test.output);
      if (test.comparison !== 'json' && decimal.test(test.output)) throw Error('numeric-checker-not-bound');
    }
    if (!meta.referenceSha256) throw Error('unsupported-reference-size');
    meta.vectorsSha256 = benefitDigest(canonical.tests);
    meta.eligible = true;
  } catch (error) {
    meta.rejection = error.message.startsWith('semantic-') ||
      /^(?:under-five|conflicting|public-contract|unsupported|invalid-source|numeric-checker)/u.test(error.message)
      ? error.message : 'malformed-source-record';
  }
  process.stdout.write(JSON.stringify(meta) + '\n');
}

// NDJSON uses LF boundaries; Unicode line separators inside strings are data.
process.stdin.setEncoding('utf8');
let parts = [];
for await (const chunk of process.stdin) {
  let start = 0, boundary;
  while ((boundary = chunk.indexOf('\n', start)) !== -1) {
    parts.push(chunk.slice(start, boundary));
    const line = parts.join('');
    parts = [];
    indexRow(line);
    start = boundary + 1;
  }
  if (start < chunk.length) parts.push(chunk.slice(start));
}
if (parts.length) indexRow(parts.join(''));
