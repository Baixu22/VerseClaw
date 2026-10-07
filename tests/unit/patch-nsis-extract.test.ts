// @vitest-environment node
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let patchNsisExtractTemplate: (targetPath?: string) => boolean;
let restoreExtractAppPackageTemplate: (content: string) => string;
let patchNsisUninstallTemplate: (targetPath?: string) => boolean;

beforeAll(async () => {
  const extractModulePath = pathToFileURL(resolve('scripts/patch-nsis-extract.mjs')).href;
  const uninstallModulePath = pathToFileURL(resolve('scripts/patch-nsis-uninstall.mjs')).href;
  const extractModule = await import(/* @vite-ignore */ extractModulePath) as typeof import('../../scripts/patch-nsis-extract.mjs');
  const uninstallModule = await import(/* @vite-ignore */ uninstallModulePath) as typeof import('../../scripts/patch-nsis-uninstall.mjs');
  patchNsisExtractTemplate = extractModule.patchNsisExtractTemplate;
  restoreExtractAppPackageTemplate = extractModule.restoreExtractAppPackageTemplate;
  patchNsisUninstallTemplate = uninstallModule.patchNsisUninstallTemplate;
});

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

const SAMPLE_EXTRACT_MACRO = `!macro extractUsing7za FILE
  Push $OUTDIR
  CopyFiles /SILENT "$PLUGINSDIR\\\\7z-out\\\\*" $OUTDIR
!macroend`;

const SAMPLE_FILE = `!macro ia32_app_files
  File /oname=$PLUGINSDIR\\\\app-32.7z "\\\${APP_32}"
!macroend

${SAMPLE_EXTRACT_MACRO}

!macro decompress
  !ifdef ZIP_COMPRESSION
    Quit
  !else
    !insertmacro extractUsing7za "$PLUGINSDIR\\\\app-$packageArch.7z"
  !endif
!macroend
`;

const SAMPLE_UNINSTALL_FUNCTION = readFileSync(
  join(FIXTURES, 'installUtil-unpatched.snippet.nsh'),
  'utf8',
);

describe('patch-nsis-extract', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('replaces CopyFiles-based extractUsing7za with direct 7z extraction', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(target, SAMPLE_FILE, 'utf8');

    expect(patchNsisExtractTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('Verse Claw-patched-v2');
    expect(result).not.toContain('CopyFiles /SILENT');
    expect(result).not.toContain('$(appCannotBeClosed)');
    expect(result).toContain('$(decompressionFailed)');
    expect(result).toContain('Quit');
    expect(result).toContain('SetErrorLevel 2');
    expect(result).toContain('Restoring previous Verse Claw installation after failed update');
    expect(result).not.toContain('continuing overwrite install anyway');
    expect(patchNsisExtractTemplate(target)).toBe(true);
  });

  it('upgrades stale Verse Claw extract patches that used to continue after extract failure', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(
      target,
      SAMPLE_FILE.replace(
        SAMPLE_EXTRACT_MACRO,
        `!macro extractUsing7za FILE
  ; Verse Claw-patched: extract directly to $INSTDIR.
  ClearErrors
  Nsis7z::Extract "\${FILE}"
  DetailPrint "Extract reported file locks; continuing overwrite install anyway..."
!macroend`,
      ),
      'utf8',
    );

    expect(patchNsisExtractTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('Verse Claw-patched-v2');
    expect(result).toContain('Failed to extract Verse Claw files after multiple attempts.');
    expect(result).toContain('$(decompressionFailed)');
    expect(result).toContain('Quit');
    expect(result).toContain('SetErrorLevel 2');
    expect(result).toContain('Restoring previous Verse Claw installation after failed update');
    expect(result).not.toContain('continuing overwrite install anyway');
  });

  it('restores and re-patches a corrupted template', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(
      target,
      `${SAMPLE_FILE}\nMessageBox MB_RETRYCANCEL "$(appCannotBeClosed)"\n!macro extractUsing7za FILE\n  broken\n!macroend\n`,
      'utf8',
    );

    const restored = restoreExtractAppPackageTemplate(readFileSync(target, 'utf8'));
    expect(restored).not.toContain('broken');
    expect(restored).not.toContain('$(appCannotBeClosed)');

    writeFileSync(target, restored, 'utf8');
    expect(patchNsisExtractTemplate(target)).toBe(true);
    expect(readFileSync(target, 'utf8').match(/!macro extractUsing7za FILE/g)).toHaveLength(1);
  });

  it('repairs a cached patch with a rollback variable not declared by the installer', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'extractAppPackage.nsh');
    writeFileSync(target, SAMPLE_FILE);
    expect(patchNsisExtractTemplate(target)).toBe(true);
    writeFileSync(target, readFileSync(target, 'utf8').replaceAll('$verseClawRollbackDir', '$verse-clawRollbackDir'));
    expect(patchNsisExtractTemplate(target)).toBe(true);
    const result = readFileSync(target, 'utf8');
    expect(readFileSync(resolve('scripts/installer.nsh'), 'utf8')).toContain('Var /GLOBAL verseClawRollbackDir');
    expect(result).toContain('Rename "$verseClawRollbackDir" "$INSTDIR"');
    expect(result).not.toContain('$verse-clawRollbackDir');
  });
});

describe('patch-nsis-uninstall', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('skips the legacy uninstaller retry loop on upgrades', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-patch-nsis-'));
    const target = join(tempDir, 'installUtil.nsh');
    writeFileSync(target, `before\n${SAMPLE_UNINSTALL_FUNCTION}\nafter`, 'utf8');

    expect(patchNsisUninstallTemplate(target)).toBe(true);

    const result = readFileSync(target, 'utf8');
    expect(result).toContain('Skipping legacy uninstaller');
    expect(result).not.toContain('MessageBox MB_RETRYCANCEL');
    expect(patchNsisUninstallTemplate(target)).toBe(true);
  });
});
