import { Language } from './types';
/** Filename of the project-scoped config, resolved relative to the project root. */
export declare const PROJECT_CONFIG_FILENAME = "codegraph.json";
export interface ProjectConfig {
    /** Map of custom file extension (`.foo`) to a supported language id. */
    extensions?: Record<string, string>;
}
/**
 * Load the validated extension overrides for a project, mtime-cached.
 *
 * Returns a map of `.ext` → supported language id. The result merges on top of
 * the built-in extension map at the point of use (see `detectLanguage` /
 * `isSourceFile`), with these user mappings taking precedence. Returns an empty
 * map when there is no `codegraph.json` (the zero-config default).
 */
export declare function loadExtensionOverrides(rootDir: string): Record<string, Language>;
/** Test/maintenance hook: forget cached config (e.g. after rewriting it in a test). */
export declare function clearProjectConfigCache(): void;
//# sourceMappingURL=project-config.d.ts.map