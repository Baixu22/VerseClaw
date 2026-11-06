import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostInvokeResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

async function hostInvoke<T>(
  page: Awaited<ReturnType<typeof getStableWindow>>,
  module: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await page.evaluate(async (request) => {
    const bridge = (window as unknown as {
      verseClaw?: {
        hostInvoke: <R>(input: Record<string, unknown>) => Promise<HostInvokeResponse<R>>;
      };
    }).verseClaw?.hostInvoke;
    if (!bridge) throw new Error('hostInvoke bridge unavailable');
    const response = await bridge<T>({
      id: crypto.randomUUID(),
      module: request.module,
      action: request.action,
      ...(request.payload ? { payload: request.payload } : {}),
    });
    if (!response.ok) throw new Error(response.error?.message || 'hostInvoke failed');
    return response.data as T;
  }, { module, action, payload });
}

test('Skill enablement writes the runtime config and local discovery reads it', async ({
  homeDir,
  userDataDir,
  launchElectronApp,
}) => {
  const skillDir = join(userDataDir, 'verse-claw-skills', 'runtime-config-probe');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: runtime-config-probe\ndescription: Runtime config probe\n---\n',
    'utf8',
  );

  let app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

    await hostInvoke(page, 'skills', 'updateConfig', {
      skillKey: 'runtime-config-probe',
      enabled: false,
    });

    const configPath = join(homeDir, '.openclaw', 'openclaw.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      skills?: {
        entries?: Record<string, { enabled?: boolean }>;
        load?: { extraDirs?: string[] };
      };
    };
    expect(config.skills?.entries?.['runtime-config-probe']?.enabled).toBe(false);
    expect(config.skills?.load?.extraDirs).toContain(join(userDataDir, 'verse-claw-skills'));

    const local = await hostInvoke<{ success: boolean; skills: Array<{ id: string; enabled: boolean }> }>(
      page,
      'skills',
      'local',
    );
    expect(local.success).toBe(true);
    expect(local.skills).toContainEqual(expect.objectContaining({
      id: 'runtime-config-probe',
      enabled: false,
    }));

    await hostInvoke(page, 'skills', 'updateConfig', {
      skillKey: 'runtime-config-probe',
      enabled: true,
    });
    const enabledConfig = JSON.parse(await readFile(configPath, 'utf8')) as {
      skills?: { entries?: Record<string, { enabled?: boolean }> };
    };
    expect(enabledConfig.skills?.entries?.['runtime-config-probe']?.enabled).toBe(true);

    await closeElectronApp(app);
    app = await launchElectronApp({ skipSetup: true });
    const restartedPage = await getStableWindow(app);
    const persisted = await hostInvoke<{ enabled?: boolean }>(restartedPage, 'skills', 'getConfig', {
      skillKey: 'runtime-config-probe',
    });
    expect(persisted.enabled).toBe(true);
    const saved = await hostInvoke<{ success: boolean }>(restartedPage, 'skills', 'updateConfigs', {
      updates: [{ skillKey: 'runtime-config-probe', enabled: false }],
    });
    expect(saved.success).toBe(true);
    const disabledAfterRestart = JSON.parse(await readFile(configPath, 'utf8')) as {
      skills: { entries: Record<string, { enabled?: boolean }> };
    };
    expect(disabledAfterRestart.skills.entries['runtime-config-probe'].enabled).toBe(false);
  } finally {
    await closeElectronApp(app);
  }
});
