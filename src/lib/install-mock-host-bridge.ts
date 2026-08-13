/**
 * Side-effect module that installs the browser mock host bridge.
 *
 * This exists purely for import ordering. ESM hoists every `import` above the
 * module body, so calling `installMockHostBridge()` from a statement in
 * `main.tsx` runs it AFTER the transitive imports of `./i18n` and
 * `RendererRoot` have already executed their module-level side effects — some
 * of which touch the host bridge and fail. Importing this module first makes
 * the install part of the import graph, so it lands before them.
 */
import { installMockHostBridge, isMockModeEnabled, seedMockPersistedSettings } from './mock-host-bridge';

if (isMockModeEnabled()) {
  seedMockPersistedSettings();
  installMockHostBridge();
}
