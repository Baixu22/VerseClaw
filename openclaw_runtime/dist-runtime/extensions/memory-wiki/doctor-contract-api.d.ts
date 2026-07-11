import { t as PluginDoctorStateMigration } from "../../runtime-doctor-C3To4pk_.js";
import { n as normalizeCompatibilityConfig, t as legacyConfigRules } from "../../config-compat-CerfsENr.js";

//#region extensions/memory-wiki/doctor-contract-api.d.ts
declare const stateMigrations: PluginDoctorStateMigration[];
//#endregion
export { legacyConfigRules, normalizeCompatibilityConfig, stateMigrations };