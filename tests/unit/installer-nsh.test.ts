import { readFileSync } from 'node:fs';

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const installerNsh = readFileSync(join(process.cwd(), 'scripts/installer.nsh'), 'utf8');

describe('installer.nsh running-app guard', () => {
  it('fails closed when Verse Claw.exe remains alive during overwrite install', () => {
    const guardStart = installerNsh.indexOf('Do not continue while the old UI process is still alive');
    const guardEnd = installerNsh.indexOf('!ifndef BUILD_UNINSTALLER', guardStart);
    const guard = installerNsh.slice(guardStart, guardEnd);

    expect(guardStart).toBeGreaterThan(-1);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(guard).toContain(String.raw`File "/oname=$PLUGINSDIR\check-app-running.ps1" "${'${PROJECT_DIR}'}\scripts\check-app-running.ps1"`);
    expect(guard).toMatch(/nsExec::ExecToStack \/TIMEOUT=30000 [^\r\n]*-File "\$PLUGINSDIR\\check-app-running\.ps1" -Executable "\$\{APP_EXECUTABLE_FILENAME\}"/);
    expect(guard).toMatch(/Pop \$R0\s+Pop \$R1/);
    expect(guard).toMatch(/\$\{if\} \$R0 != 0\s+\$\{orIf\} \$R1 != "absent"/);
    expect(guard).toContain('taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"');
    expect(guard).toContain('wmic process where "name=\'${APP_EXECUTABLE_FILENAME}\'" call terminate');
    expect(guard).toContain('SetErrorLevel 2');
    expect(guard).toContain('Quit');
    expect(guard).toContain('Verse Claw is still running and cannot be replaced safely');
    expect(guard).not.toContain('${nsProcess::FindProcess}');
  });
});
