import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { verifyRetrievalArtifactManifest } from '../../scripts/lib/project-rag-package.mjs';

test('Project RAG delivered runtime preserves offline restart and owner state', async ({ launchElectronApp, userDataDir }, testInfo) => {
  test.setTimeout(480000);
  const executable = process.env.CLAWX_RAG_PACKAGED_EXECUTABLE;
  const runtime = process.env.CLAWX_RAG_PACKAGED_RUNTIME;
  if (!executable || !runtime) throw new Error('RAG18 requires the actual packaged executable and delivered runtime paths');
  const manifest = verifyRetrievalArtifactManifest(resolve(runtime), { target: `${process.platform}-${process.arch}` });
  const receipt = { schema: 'ProjectRagPackagedSmoke/v1', actor: 'codex/project-rag-packaged', driven_by: 'agent',
    candidate: manifest.candidate, target: manifest.target, manifestDigest: manifest.manifestDigest,
    status: 'running', starts: [] as Array<{ packaged: boolean; ownerStatePreserved: boolean }> };
  const marker = join(userDataDir, 'rag18-owner-preservation.txt');
  await writeFile(marker, 'agent-created-preservation-sentinel\n');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const app = await launchElectronApp({ packaged: true, executablePath: executable, skipSetup: true,
        env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source', HTTP_PROXY: 'http://127.0.0.1:9',
          HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'localhost,127.0.0.1,::1' } });
      try {
        const packaged = await app.evaluate(({ app }) => app.isPackaged);
        expect(packaged).toBe(true);
        const page = await getStableWindow(app);
        await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
        await page.evaluate(() => { window.location.hash = '#/settings/models'; });
        await expect(page.getByTestId('knowledge-operations-settings')).toBeVisible();
        expect(await readFile(marker, 'utf8')).toBe('agent-created-preservation-sentinel\n');
        receipt.starts.push({ packaged, ownerStatePreserved: true });
      } finally { await closeElectronApp(app); }
    }
    receipt.status = 'passed';
  } finally {
    await writeFile(testInfo.outputPath('rag18-packaged-smoke.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
});
