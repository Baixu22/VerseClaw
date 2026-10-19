/**
 * Patch electron-builder's NSIS extractUsing7za macro to extract directly into
 * $INSTDIR instead of temp + CopyFiles.
 *
 * #1026 enlarged the packaged openclaw runtime; CopyFiles over thousands of
 * files makes assisted installers look frozen (~50%) and often fails with the
 * "app cannot be closed" retry dialog when AV or file locks are involved.
 *
 * Must run before makensis (package:win), not only in afterPack.
 */

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSIS_TEMPLATE_DIR, NSIS_SEVENZIP_EXE } from './nsis-template-dir.mjs';

export const EXTRACT_APP_PACKAGE_NSH = join(
  NSIS_TEMPLATE_DIR,
  'include',
  'extractAppPackage.nsh',
);

const PATCH_MARKER = 'Verse Claw-patched-v2: extract directly to $INSTDIR and fail closed';
const LEGACY_PATCH_MARKER = 'Verse Claw-patched: extract directly to $INSTDIR';
const LEGACY_CONTINUE_ON_EXTRACT_FAILURE = 'continuing overwrite install anyway';
const FATAL_EXTRACT_FAILURE_DETAIL = 'Failed to extract Verse Claw files after multiple attempts.';
const ROLLBACK_EXTRACT_FAILURE_DETAIL = 'Restoring previous Verse Claw installation after failed update';

const PATCHED_EXTRACT_MACRO = [
  '!macro extractUsing7za FILE',
  `  ; ${PATCH_MARKER}.`,
  '  InitPluginsDir',
  `  File "/oname=$PLUGINSDIR\\verse-claw-7za.exe" "${NSIS_SEVENZIP_EXE.replaceAll('$', '$$')}"`,
  '  StrCpy $R9 0',
  '  verse-claw_extract_attempt:',
  '    IntOp $R9 $R9 + 1',
  '    DetailPrint "Extracting Verse Claw application files (attempt $R9, please wait)..."',
  '    SetOutPath $INSTDIR',
  '    ClearErrors',
  // The shipped Nsis7z::Extract discards its result and sets no error flag.
  // Reuse the packager's 7za executable so corrupt/partial extraction is observable.
  '    nsExec::ExecToStack /TIMEOUT=600000 \'"$PLUGINSDIR\\verse-claw-7za.exe" x -y -bd -bb0 -bso0 "-o$INSTDIR" "${FILE}"\'',
  '    Pop $R0',
  '    Pop $R1',
  '    StrCmp $R0 "0" verse-claw_extract_done',
  '    ${if} $R9 < 5',
  '      DetailPrint "Releasing file locks before retry..."',
  '      nsExec::ExecToStack /TIMEOUT=30000 \'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"\'',
  '      Pop $0',
  '      Pop $1',
  '      nsExec::ExecToStack /TIMEOUT=30000 \'taskkill /F /IM openclaw-gateway.exe\'',
  '      Pop $0',
  '      Pop $1',
  '      Sleep 3000',
  '      Goto verse-claw_extract_attempt',
  '    ${endIf}',
  '    DetailPrint "Failed to extract Verse Claw files after multiple attempts."',
  '    ${if} $verseClawRollbackDir != ""',
  '      IfFileExists "$verseClawRollbackDir\\*.*" 0 verse-claw_extract_show_error',
  '      DetailPrint "Restoring previous Verse Claw installation after failed update..."',
  '      SetOutPath $TEMP',
  '      RMDir /r "$INSTDIR"',
  '      Rename "$verseClawRollbackDir" "$INSTDIR"',
  '    ${endIf}',
  '  verse-claw_extract_show_error:',
  '    MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)" /SD IDOK',
  '    SetErrorLevel 2',
  '    Quit',
  '  verse-claw_extract_done:',
  '!macroend',
].join('\n');

const DECOMPRESS_MACRO = [
  '!macro decompress',
  '  !ifdef ZIP_COMPRESSION',
  '    nsisunz::Unzip "$PLUGINSDIR\\app-$packageArch.zip" "$INSTDIR"',
  '    Pop $R0',
  '    StrCmp $R0 "success" +3',
  '      MessageBox MB_OK|MB_ICONEXCLAMATION "$(decompressionFailed)$\\n$R0"',
  '      Quit',
  '  !else',
  '    !insertmacro extractUsing7za "$PLUGINSDIR\\app-$packageArch.7z"',
  '  !endif',
  '!macroend',
  '',
].join('\n');

const EXTRACT_MACRO_PATTERN = /!macro extractUsing7za FILE[\s\S]*?!macroend/;

function countExtractMacros(content) {
  return (content.match(/!macro extractUsing7za FILE/g) || []).length;
}

function isTemplateHealthy(content) {
  return content.includes(PATCH_MARKER)
    && countExtractMacros(content) === 1
    && content.includes(FATAL_EXTRACT_FAILURE_DETAIL)
    && content.includes(ROLLBACK_EXTRACT_FAILURE_DETAIL)
    && content.includes('Rename "$verseClawRollbackDir" "$INSTDIR"')
    && content.includes('IfFileExists "$verseClawRollbackDir\\*.*"')
    && content.includes('"$PLUGINSDIR\\verse-claw-7za.exe" x -y')
    && content.includes('StrCmp $R0 "0" verse-claw_extract_done')
    && !content.includes('$verse-clawRollbackDir')
    && !/nsExec::ExecToStack (?!\/TIMEOUT=)/.test(content)
    && content.includes('$(decompressionFailed)')
    && content.includes('SetErrorLevel 2')
    && content.includes('Quit')
    && !content.includes('$(appCannotBeClosed)')
    && !content.includes(LEGACY_CONTINUE_ON_EXTRACT_FAILURE);
}

function hasStaleExtractPatch(content) {
  return content.includes(PATCH_MARKER)
    || content.includes(LEGACY_PATCH_MARKER)
    || content.includes(LEGACY_CONTINUE_ON_EXTRACT_FAILURE)
    || content.includes('$(appCannotBeClosed)');
}

/**
 * @param {string} content
 * @returns {string}
 */
export function restoreExtractAppPackageTemplate(content) {
  const extractIdx = content.indexOf('!macro extractUsing7za FILE');
  const decompressIdx = content.indexOf('!macro decompress');
  const cutIdx = Math.min(
    extractIdx === -1 ? Number.POSITIVE_INFINITY : extractIdx,
    decompressIdx === -1 ? Number.POSITIVE_INFINITY : decompressIdx,
  );
  if (!Number.isFinite(cutIdx)) {
    return content;
  }
  return `${content.slice(0, cutIdx)}${PATCHED_EXTRACT_MACRO}\n\n${DECOMPRESS_MACRO}`;
}

/**
 * @param {string} [targetPath]
 * @returns {boolean} true when template is patched (or already patched)
 */
export function patchNsisExtractTemplate(targetPath = EXTRACT_APP_PACKAGE_NSH) {
  if (!existsSync(targetPath)) {
    console.warn('[patch-nsis-extract] extractAppPackage.nsh not found, skipping.');
    return false;
  }

  let original = readFileSync(targetPath, 'utf8');

  if (isTemplateHealthy(original)) {
    return true;
  }

  if (countExtractMacros(original) !== 1) {
    console.warn('[patch-nsis-extract] Corrupted template detected; restoring tail section.');
    original = restoreExtractAppPackageTemplate(original);
    writeFileSync(targetPath, original, 'utf8');
    if (isTemplateHealthy(original)) {
      console.log('[patch-nsis-extract] Restored extractAppPackage.nsh (overwrite upgrade extract).');
      return true;
    }
  }

  if (hasStaleExtractPatch(original)) {
    console.warn('[patch-nsis-extract] Stale Verse Claw extract patch detected; replacing with fail-closed patch.');
  } else if (!original.includes('CopyFiles')) {
    console.warn('[patch-nsis-extract] CopyFiles not found — NSIS template may have changed.');
    return false;
  }

  const patched = original.replace(
    EXTRACT_MACRO_PATTERN,
    () => PATCHED_EXTRACT_MACRO,
  );

  if (patched === original) {
    console.warn('[patch-nsis-extract] extractUsing7za macro regex did not match.');
    return false;
  }

  writeFileSync(targetPath, patched, 'utf8');
  console.log('[patch-nsis-extract] Patched extractAppPackage.nsh (direct 7za extraction with exit-code checks).');
  return true;
}

if (isMainEntrypoint(import.meta.url)) {
  const ok = patchNsisExtractTemplate();
  process.exit(ok ? 0 : 1);
}
