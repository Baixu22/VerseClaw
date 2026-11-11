import { resultFixtureTools } from './mcp-result-tools.ts';
import { createToolsMcpServer, connectToolsMcpServerToStdio } from '../../openclaw_runtime/src/mcp/tools-stdio-server.ts';
import { setRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/runtime-snapshot.ts';
import { appendFileSync } from 'node:fs';
import { initializeGlobalHookRunner } from '../../openclaw_runtime/src/plugins/hook-runner-global.ts';

setRuntimeConfigSnapshot({ plugins: { enabled: false } });
initializeGlobalHookRunner({ hooks: [], plugins: [{ id: 'fidelity-hook', status: 'loaded' }], typedHooks: [{
  pluginId: 'fidelity-hook', hookName: 'before_tool_call', source: 'fixture',
  handler: async (event: { params: Record<string, unknown> }) => event.params.kind === 'approval'
    ? { requireApproval: { pluginId: 'fidelity-hook', title: 'Fixture permission', description: 'Fixture permission required' } }
    : undefined,
}] });
const server = createToolsMcpServer({ name: 'result-fidelity-fixture', tools: resultFixtureTools([], (event) => {
  if (process.env.MCP_RESULT_EVENTS_PATH) appendFileSync(process.env.MCP_RESULT_EVENTS_PATH, `${event}\n`);
}) as never });
await connectToolsMcpServerToStdio(server);
