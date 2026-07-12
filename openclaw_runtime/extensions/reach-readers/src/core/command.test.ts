import { describe, expect, it } from 'vitest';
import { runReachCommand } from './command.js';

describe('Reach command boundary', () => {
  it('passes argv without shell interpretation and captures UTF-8 output', async () => {
    const marker = 'value;echo injected';
    const result = await runReachCommand(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', marker],
      { timeoutMs: 5_000 },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(marker);
  });

  it('honors an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runReachCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 1000)'], {
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    expect(result.termination).toBe('signal');
  });
});
