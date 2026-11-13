// driven_by: agent; actor: codex-g7-inline-spill-tf0749-01a1d34c; realHumanEvidence: false
type Input = Record<string, unknown>;
type RecallArgs = { archive_uri: string; checksum: string; offset: number; max_chars: number };
const validPair = (args: Input) => typeof args.archive_uri === 'string' && args.archive_uri.startsWith('context-archive://') &&
  typeof args.checksum === 'string' && /^sha256:[a-f0-9]{64}$/.test(args.checksum);
const parse = (text: unknown): Input | null => { try { return JSON.parse(String(text)); } catch { return null; } };

/** Navigation uses only metadata already present in this exact visible request. */
export function buildVisibleRecallNavigation(input: readonly Input[]) {
  const calls = input.flatMap((item, index) => item.type === 'function_call' && item.name === 'context_archive_recall'
    ? [{ item, index, args: parse(item.arguments) }] : []);
  const first = calls.find(call => call.args && validPair(call.args));
  const text = String(input[0]?.content ?? '');
  const uri = text.match(/context-archive:\/\/[^\s"<>;,]+/)?.[0];
  const checksum = text.match(/sha256:[a-f0-9]{64}/)?.[0];
  const pair = first ? { uri: String(first.args!.archive_uri), checksum: String(first.args!.checksum) }
    : uri && checksum ? { uri, checksum } : null;
  const same = calls.filter(call => call.args?.archive_uri === pair?.uri && call.args?.checksum === pair?.checksum);
  const last = same.at(-1);
  let offset = 0;
  let offsetSourceIndex: number | null = null;
  if (last) {
    const args = last.args!;
    const outputIndex = input.findIndex(item => item.type === 'function_call_output' && item.call_id === last.item.call_id);
    const output = outputIndex < 0 ? null : parse(input[outputIndex]!.output);
    if (output?.ok === true && typeof output.content === 'string' && Number.isSafeInteger(output.offset) && Number(output.offset) >= 0) {
      offset = Number(output.offset) + output.content.length;
      offsetSourceIndex = outputIndex;
    } else if (Number.isSafeInteger(args.offset) && Number(args.offset) >= 0 && Number.isSafeInteger(args.max_chars) && Number(args.max_chars) > 0) {
      offset = Number(args.offset) + Number(args.max_chars);
      offsetSourceIndex = last.index;
    }
  }
  const recommendedArguments: RecallArgs | null = pair && calls.length < 3
    ? { archive_uri: pair.uri, checksum: pair.checksum, offset, max_chars: 5500 } : null;
  const navigation = { source: first ? 'visible-call-metadata' : pair ? 'visible-context' : 'no-visible-reference',
    targetSourceIndex: first?.index ?? (pair ? 0 : null), offsetSourceIndex, recallsUsed: calls.length, recommendedArguments };
  const instruction = 'The requested exact value is the value of private_evidence in visible recall content. If that field is visible, reply only {"value":"the exact field value"} immediately. Do not read more pages after finding it. '
    + (recommendedArguments ? 'If it is absent, the next sequential page of the original exec archive is given below. Use the same original URI/checksum; later health-check and recall-projection archives are unrelated. Decide whether to recall using these visible navigation arguments: '
      + JSON.stringify(recommendedArguments) : 'No further recall is available from visible navigation; reply only {"value":null} when the exact field is absent.')
    + ' Recalls already requested: ' + calls.length + '/3. Call once per response.';
  return { input: [...input, { role: 'user', content: instruction }], navigation };
}

export function navigatedDeterministicTurn(input: readonly Input[]) {
  for (const item of input.filter(item => item.type === 'function_call_output')) {
    const output = parse(item.output);
    const value = output?.ok === true && typeof output.content === 'string' ? output.content.match(/private_evidence=([^\r\n]+)\r?\n/)?.[1] : null;
    if (value) return { text: JSON.stringify({ value }), toolCalls: [] };
  }
  const args = buildVisibleRecallNavigation(input).navigation.recommendedArguments;
  return args ? { text: '', toolCalls: [{ callId: 'det-visible-' + input.length, name: 'context_archive_recall', arguments: args }] }
    : { text: '{"value":null}', toolCalls: [] };
}
