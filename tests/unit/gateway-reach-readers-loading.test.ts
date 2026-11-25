// @vitest-environment node
import { expect, it, vi } from 'vitest';
const hydration = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../openclaw_runtime/extensions/reach-readers/src/core/config.js', async original => ({
  ...await original<typeof import('../../openclaw_runtime/extensions/reach-readers/src/core/config')>(),
  hydrateReachConfig: hydration,
}));
import { ALL_TOOLS, reachReadersPlugin } from '../../openclaw_runtime/extensions/reach-readers/src/index';
import { createCollectingApi } from '../../openclaw_runtime/extensions/reach-readers/src/common/plugin-entry';

it('registers reader tools without materializing the runtime and initializes it on first execution', async () => {
  const { api, tools } = createCollectingApi();
  const runtime = api.runtime;
  const readRuntime = vi.fn(() => runtime);
  Object.defineProperty(api, 'runtime', { get: readRuntime });
  const result = { content: [{ type: 'text' as const, text: 'read' }], details: {} };
  const execute = vi.spyOn(ALL_TOOLS[0], 'execute').mockResolvedValue(result);
  try {
    reachReadersPlugin.register(api);
    expect(tools).toHaveLength(ALL_TOOLS.length);
    expect(readRuntime).not.toHaveBeenCalled();
    expect(hydration).not.toHaveBeenCalled();
    await expect(tools[0].execute('call-1', {})).resolves.toEqual(result);
    await expect(tools[0].execute('call-2', {})).resolves.toEqual(result);
    expect(readRuntime).toHaveBeenCalledTimes(2);
    expect(hydration).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    execute.mockRestore();
  }
});
