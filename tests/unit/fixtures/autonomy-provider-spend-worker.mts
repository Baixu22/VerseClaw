import { reserveProviderSpend } from '../../../openclaw_runtime/src/agents/provider-spend-budget.js';
import { normalizeRunScope } from '../../../shared/types/identity-scope.js';
const input = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8')) as { id: string };
process.stdout.write(JSON.stringify({ ready: true, pid: process.pid }) + '\n');
process.stdin.once('data', () => {
  try {
    const scope = normalizeRunScope({ runId: input.id, scope: { workspaceId: 'project', sessionKey: input.id } }).scope;
    if (!scope.sessionKey) throw new Error('Fixture session missing');
    const reservation = reserveProviderSpend({ callId: input.id, runId: input.id, provider: 'fixture', model: 'fixture', requestDigest: input.id,
      scope: { ...scope, sessionKey: scope.sessionKey, sessionGeneration: 'g' },
      reservedTokens: 60, reservedCostUsd: 0.006, config: { host: { maxTokens: 100 } } });
    process.stdout.write(JSON.stringify({ admitted: true, reservation }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ admitted: false, error: String(error) }) + '\n'); }
  process.exit(0);
});
process.stdin.resume();
