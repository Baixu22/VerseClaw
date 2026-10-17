import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('a detached spawn failure returns E_OPEN with the OS error and exits normally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-spawn-error-'));
  try {
    const source = `
      import { createPlaywrightHostApi } from './src/engine/playwright-host-api.ts';
      import { AgentBrowserFacade } from './src/engine/facade.ts';
      import { setWorkspaceRoot } from './src/host/workspace-paths.ts';
      setWorkspaceRoot(${JSON.stringify(root)});
      const api = await createPlaywrightHostApi({ persistent: true, executablePath: ${JSON.stringify(join(root, 'missing-browser.exe'))} });
      console.log(JSON.stringify(await new AgentBrowserFacade({ api }).open()));
      // Model a long-lived MCP/worker event loop so the asynchronous spawn error is delivered.
      await new Promise((resolve) => setImmediate(resolve));
    `;
    const result = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], {
      cwd: process.cwd(), windowsHide: true, timeout: 10_000,
    }).then((output) => ({ code: 0, ...output }), (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
    expect(result.code, result.stderr).toBe(0);
    const opened = JSON.parse(result.stdout.trim());
    expect(opened.ok).toBe(false);
    expect(opened.error.code).toBe('E_OPEN');
    expect(opened.error.message).toContain('ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
