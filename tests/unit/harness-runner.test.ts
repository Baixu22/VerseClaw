import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runStep } from '../../harness/src/runner.mjs';

describe('harness runner', () => {
  it('runs profile commands from the repository root', async () => {
    const root = process.cwd();
    process.chdir(join(root, 'harness'));

    try {
      const result = await runStep({
        profile: 'test',
        name: 'assert repository cwd',
        command: 'node',
        args: [
          join(root, 'tests', 'fixtures', 'harness-runner', 'assert-cwd.mjs'),
          root,
        ],
      });

      expect(result.exitCode).toBe(0);
      expect(result.status).toBe('pass');
    } finally {
      process.chdir(root);
    }
  });
});
