import { i as OpenClawConfig } from "../../types.openclaw-BJQ1igi6.js";
import { U as ChannelLegacyStateMigrationPlan } from "../../types.core-tdI0RI3L.js";
//#region extensions/telegram/src/state-migrations.d.ts
declare function detectTelegramLegacyStateMigrations(params: {
  cfg: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  stateDir?: string;
}): Promise<ChannelLegacyStateMigrationPlan[]>;
//#endregion
export { detectTelegramLegacyStateMigrations };