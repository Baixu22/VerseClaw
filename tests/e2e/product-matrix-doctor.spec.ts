import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { createHash } from 'node:crypto';
import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

type DoctorScenario = 'positive' | 'negative';

type DoctorObservation = {
  status: 'Healthy' | 'Issues Found';
  exitCode: number | null;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function openDoctorPanel(page: Page): Promise<Locator> {
  const settingsUrl = new URL(page.url());
  settingsUrl.hash = '/settings/developer';
  await page.goto(settingsUrl.toString());

  const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
  await expect(devModeSwitch).toBeVisible();
  if ((await devModeSwitch.getAttribute('data-state')) !== 'checked') {
    await devModeSwitch.click();
    await expect(devModeSwitch).toHaveAttribute('data-state', 'checked');
  }
  await expect(page.getByTestId('settings-developer-section')).toBeVisible();

  const doctorPanel = page
    .getByText('OpenClaw Doctor', { exact: true })
    .locator('xpath=../../..');
  await expect(doctorPanel).toBeVisible();
  return doctorPanel;
}

async function observeDoctorResult(
  doctorPanel: Locator,
  expectedStatus: DoctorObservation['status'],
): Promise<DoctorObservation> {
  await expect(doctorPanel.getByText(expectedStatus, { exact: true })).toBeVisible({
    timeout: 65_000,
  });
  await expect(doctorPanel.getByRole('button', { name: 'Run Doctor', exact: true })).toBeEnabled();

  const text = await doctorPanel.innerText();
  const command = /^Command:\s*(.+)$/mu.exec(text)?.[1]?.trim();
  const cwd = /^Working dir:\s*(.+)$/mu.exec(text)?.[1]?.trim();
  const exitCodeText = /^Exit code:\s*(.+)$/mu.exec(text)?.[1]?.trim();
  const stdout = await doctorPanel
    .getByText('Stdout', { exact: true })
    .locator('xpath=following-sibling::pre[1]')
    .innerText();
  const stderr = await doctorPanel
    .getByText('Stderr', { exact: true })
    .locator('xpath=following-sibling::pre[1]')
    .innerText();

  if (!command || !cwd || !exitCodeText) {
    throw new Error(`Doctor panel did not expose command, working dir, and exit code:\n${text}`);
  }

  return {
    status: expectedStatus,
    command,
    cwd,
    exitCode: exitCodeText === 'null' ? null : Number(exitCodeText),
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function recordEvidence(
  testInfo: TestInfo,
  scenario: DoctorScenario,
  details: {
    profileDir: string;
    configDir: string;
    configPath: string;
    configBeforeDoctor: string;
    configAfterDoctor: string;
    observation: DoctorObservation;
    cleanup: {
      appClosed: boolean;
      profileRemoved: boolean;
      configRemoved: boolean;
    };
  },
): Promise<void> {
  const evidencePath = testInfo.outputPath(`doctor-${scenario}.json`);
  await writeFile(evidencePath, `${JSON.stringify({
    schemaVersion: 'ProductMatrixDoctorE2E/v1',
    driven_by: 'agent',
    actor: 'codex/product-matrix-doctor-e2e',
    scenario,
    source: 'Settings > Developer > Run Doctor',
    command: details.observation.command,
    exitCode: details.observation.exitCode,
    result: details.observation,
    profile: {
      profileDir: details.profileDir,
      configDir: details.configDir,
      configPath: details.configPath,
    },
    config: {
      beforeSha256: createHash('sha256').update(details.configBeforeDoctor).digest('hex'),
      afterSha256: createHash('sha256').update(details.configAfterDoctor).digest('hex'),
    },
    cleanup: details.cleanup,
  }, null, 2)}\n`, 'utf8');
  await testInfo.attach(`doctor-${scenario}`, {
    path: evidencePath,
    contentType: 'application/json',
  });
}

async function closeAndRemoveOwnedState(
  app: ElectronApplication,
  profileDir: string,
  configDir: string,
  ownedRoot: string,
): Promise<{ appClosed: boolean; profileRemoved: boolean; configRemoved: boolean }> {
  await closeElectronApp(app);
  expect(relative(resolve(ownedRoot), resolve(profileDir))).toBe('electron-profile');
  expect(relative(resolve(ownedRoot), resolve(configDir))).toBe('openclaw-config');
  await rm(profileDir, { recursive: true, force: true });
  await rm(configDir, { recursive: true, force: true });
  return {
    appClosed: true,
    profileRemoved: !(await pathExists(profileDir)),
    configRemoved: !(await pathExists(configDir)),
  };
}

async function launchIsolatedDoctorApp({
  launchElectronApp,
  userDataDir,
}: {
  launchElectronApp: (options?: {
    skipSetup?: boolean;
    profileDir?: string;
    env?: Record<string, string>;
  }) => Promise<ElectronApplication>;
  userDataDir: string;
}): Promise<{
  app: ElectronApplication;
  page: Page;
  profileDir: string;
  configDir: string;
  configPath: string;
}> {
  const profileDir = join(userDataDir, 'electron-profile');
  const configDir = join(userDataDir, 'openclaw-config');
  const configPath = join(configDir, 'openclaw.json');
  await mkdir(profileDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(join(profileDir, 'settings.json'), JSON.stringify({
    language: 'en',
    theme: 'light',
    gatewayAutoStart: false,
  }, null, 2));
  await writeFile(configPath, '{}\n', 'utf8');

  const app = await launchElectronApp({
    skipSetup: true,
    profileDir,
    env: {
      OPENCLAW_CONFIG_DIR: configDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_HOME: configDir,
      VERSE_CLAW_OPENCLAW_RUNTIME: 'source',
    },
  });
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible();
  return { app, page, profileDir, configDir, configPath };
}

async function retainFailure(testInfo: TestInfo, scenario: DoctorScenario, page: Page, error: unknown) {
  const screenshot = await page.screenshot({ path: testInfo.outputPath(`doctor-${scenario}-failure.png`), timeout: 5_000 })
    .then(() => 'captured').catch(() => 'unavailable');
  await writeFile(testInfo.outputPath(`doctor-${scenario}-failure.json`), JSON.stringify({
    driven_by: 'agent', actor: 'codex/product-matrix-doctor-e2e', scenario, status: 'failed', error: String(error),
    screenshot,
    visibleResult: await page.locator('body').innerText({ timeout: 5_000 }).catch(() => 'unavailable'),
  }, null, 2) + '\n');
}

test.describe('TF-0582 Settings Doctor real CLI', () => {
  test('diagnoses a valid isolated profile through the real openclaw doctor CLI', async ({
    launchElectronApp,
    userDataDir,
  }, testInfo) => {
    test.setTimeout(120_000);
    const isolated = await launchIsolatedDoctorApp({ launchElectronApp, userDataDir });
    let cleanup = { appClosed: false, profileRemoved: false, configRemoved: false };

    try {
      const doctorPanel = await openDoctorPanel(isolated.page);
      const configBeforeDoctor = await readFile(isolated.configPath, 'utf8');
      await doctorPanel.getByRole('button', { name: 'Run Doctor', exact: true }).click();
      const observation = await observeDoctorResult(doctorPanel, 'Healthy');

      expect(observation.command).toBe('openclaw doctor');
      expect(observation.exitCode).toBe(0);
      expect(observation.cwd).toBe(resolve('openclaw_runtime'));
      expect(observation.stdout).toContain('No provider auth migrations detected.');
      expect(observation.stderr).toBe('(empty)');
      const configAfterDoctor = await readFile(isolated.configPath, 'utf8');
      expect(configAfterDoctor).toBe(configBeforeDoctor);
      await doctorPanel.screenshot({ path: testInfo.outputPath('doctor-positive.png') });

      cleanup = await closeAndRemoveOwnedState(
        isolated.app,
        isolated.profileDir,
        isolated.configDir,
        userDataDir,
      );
      expect(cleanup).toEqual({
        appClosed: true,
        profileRemoved: true,
        configRemoved: true,
      });

      await recordEvidence(testInfo, 'positive', {
        profileDir: isolated.profileDir,
        configDir: isolated.configDir,
        configPath: isolated.configPath,
        configBeforeDoctor,
        configAfterDoctor,
        observation,
        cleanup,
      });
    } catch (error) {
      await retainFailure(testInfo, 'positive', isolated.page, error);
      throw error;
    } finally {
      if (!cleanup.appClosed) {
        await closeAndRemoveOwnedState(isolated.app, isolated.profileDir, isolated.configDir, userDataDir);
      }
    }
  });

  test('reports a reproducible CLI failure for corrupted isolated config', async ({
    launchElectronApp,
    userDataDir,
  }, testInfo) => {
    test.setTimeout(120_000);
    const isolated = await launchIsolatedDoctorApp({ launchElectronApp, userDataDir });
    let cleanup = { appClosed: false, profileRemoved: false, configRemoved: false };

    try {
      const doctorPanel = await openDoctorPanel(isolated.page);
      await writeFile(isolated.configPath, '{\n  "gateway": {\n', 'utf8');
      const corruptConfig = await readFile(isolated.configPath, 'utf8');

      await doctorPanel.getByRole('button', { name: 'Run Doctor', exact: true }).click();
      const observation = await observeDoctorResult(doctorPanel, 'Issues Found');

      expect(observation.command).toBe('openclaw doctor');
      expect(observation.exitCode).toBe(1);
      expect(observation.cwd).toBe(resolve('openclaw_runtime'));
      expect(observation.stderr).not.toBe('(empty)');

      const configAfterDoctor = await readFile(isolated.configPath, 'utf8');
      expect(configAfterDoctor).toBe(corruptConfig);
      await doctorPanel.screenshot({ path: testInfo.outputPath('doctor-negative.png') });

      cleanup = await closeAndRemoveOwnedState(
        isolated.app,
        isolated.profileDir,
        isolated.configDir,
        userDataDir,
      );
      expect(cleanup).toEqual({
        appClosed: true,
        profileRemoved: true,
        configRemoved: true,
      });

      await recordEvidence(testInfo, 'negative', {
        profileDir: isolated.profileDir,
        configDir: isolated.configDir,
        configPath: isolated.configPath,
        configBeforeDoctor: corruptConfig,
        configAfterDoctor,
        observation,
        cleanup,
      });
    } catch (error) {
      await retainFailure(testInfo, 'negative', isolated.page, error);
      throw error;
    } finally {
      if (!cleanup.appClosed) {
        await closeAndRemoveOwnedState(isolated.app, isolated.profileDir, isolated.configDir, userDataDir);
      }
    }
  });
});



