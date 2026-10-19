#!/usr/bin/env node
/**
 * Apply all ClawX NSIS template patches before makensis (package:win).
 */

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { fileURLToPath } from 'node:url';
import { patchNsisExtractTemplate } from './patch-nsis-extract.mjs';
import { patchNsisInstallSectionTemplate } from './patch-nsis-install-section.mjs';
import { patchNsisUninstallTemplate } from './patch-nsis-uninstall.mjs';

const extractOk = patchNsisExtractTemplate();
const installSectionOk = patchNsisInstallSectionTemplate();
const uninstallOk = patchNsisUninstallTemplate();

if (isMainEntrypoint(import.meta.url)) {
  process.exit(extractOk && installSectionOk && uninstallOk ? 0 : 1);
}
