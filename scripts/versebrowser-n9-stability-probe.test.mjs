import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runProbe } from './versebrowser-n9-stability-probe.mjs';

test('a probe never sweeps another run from its shared temp root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'verse-probe-cleanup-'));
  try {
    const exe = join(root, 'build', 'Verse Claw.exe');
    for (const file of [exe, join(root, 'build/resources/app.asar'), join(root, 'build/resources/main-runtime.asar')]) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, 'synthetic identity fixture; never launched');
    }
    const tempRoot = join(root, 'temp');
    await mkdir(join(tempRoot, 'n9-other-run'), { recursive: true });
    const sentinel = join(tempRoot, 'n9-other-run/keep.txt');
    await writeFile(sentinel, 'another run owns this');
    // No Electron launch: exercise the real directory allocation/cleanup only.
    const report = await runProbe({ exe, tempRoot, coldStarts: 0, loops: 0, interrupts: 0 });
    assert.equal(report.status, 'pass');
    assert.equal(await readFile(sentinel, 'utf8'), 'another run owns this');
    assert.deepEqual(await readdir(tempRoot), ['n9-other-run']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
