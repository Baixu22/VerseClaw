"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECT_CONFIG_FILENAME = void 0;
exports.loadExtensionOverrides = loadExtensionOverrides;
exports.clearProjectConfigCache = clearProjectConfigCache;
/**
 * Project-scoped configuration: a committed `codegraph.json` at the project
 * root that a team shares through version control.
 *
 * Today it carries one thing — `extensions`, an opt-in map from a custom file
 * extension to one of CodeGraph's supported languages. The built-in
 * extension → language table (`EXTENSION_MAP` in `extraction/grammars.ts`) is
 * otherwise hardcoded, so a codebase that uses a non-standard extension for a
 * supported language (e.g. `.dota_lua` for Lua) sees those files silently
 * skipped. This lets the project map them once, in a version-controlled file:
 *
 *   {
 *     "extensions": {
 *       ".dota_lua": "lua",
 *       ".tpl": "php"
 *     }
 *   }
 *
 * User mappings merge on TOP of the built-ins and win on conflict, so a project
 * can also re-point a built-in extension (e.g. force `.h` → `cpp`). Absent or
 * malformed config is the zero-config default — no overrides, no error. Invalid
 * individual entries are warned-and-skipped (never fatal): an unparseable
 * project file must not break indexing.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const grammars_1 = require("./extraction/grammars");
const errors_1 = require("./errors");
/** Filename of the project-scoped config, resolved relative to the project root. */
exports.PROJECT_CONFIG_FILENAME = 'codegraph.json';
/**
 * Cache keyed by project root. The loader is called once per indexing/scan/sync
 * operation (and per watch event), so the mtime guard keeps repeat calls to one
 * `stat` while a single `codegraph.json` is in force. Keying by root keeps two
 * projects in the same process (the daemon / multi-project MCP server) isolated.
 */
const overridesCache = new Map();
const cacheMeta = new Map();
/** Shared frozen empty map so the no-config path allocates nothing. */
const EMPTY = Object.freeze({});
/**
 * Normalize a user-provided extension key to the `.ext` lowercase form used by
 * the built-in map. Returns null for keys that can never match a real file
 * extension (so the caller warns and skips):
 *   - empty / just "."
 *   - multi-part (".d.ts") — language detection keys off the FINAL extension
 *     only (`lastIndexOf('.')`), so a multi-dot key would never be consulted.
 *   - anything containing a path separator.
 */
function normalizeExtKey(raw) {
    if (typeof raw !== 'string')
        return null;
    let ext = raw.trim().toLowerCase();
    if (!ext)
        return null;
    if (!ext.startsWith('.'))
        ext = '.' + ext;
    const body = ext.slice(1);
    if (!body)
        return null;
    if (body.includes('.') || body.includes('/') || body.includes('\\'))
        return null;
    return ext;
}
/**
 * Parse and validate the `extensions` map out of a `codegraph.json` file.
 * Every failure mode degrades to "no overrides from this entry" — a bad file or
 * a typo'd language never throws.
 */
function parseExtensionOverrides(file) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf-8');
    }
    catch {
        return EMPTY;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        (0, errors_1.logWarn)(`Ignoring ${exports.PROJECT_CONFIG_FILENAME}: not valid JSON`, {
            file,
            error: err instanceof Error ? err.message : String(err),
        });
        return EMPTY;
    }
    if (!parsed || typeof parsed !== 'object')
        return EMPTY;
    const exts = parsed.extensions;
    if (!exts || typeof exts !== 'object' || Array.isArray(exts))
        return EMPTY;
    const out = {};
    for (const [rawKey, rawVal] of Object.entries(exts)) {
        const key = normalizeExtKey(rawKey);
        if (!key) {
            (0, errors_1.logWarn)(`Ignoring extension mapping in ${exports.PROJECT_CONFIG_FILENAME}: "${rawKey}" is not a valid file extension`, { file });
            continue;
        }
        if (typeof rawVal !== 'string' || !(0, grammars_1.isLanguageSupported)(rawVal)) {
            (0, errors_1.logWarn)(`Ignoring extension "${rawKey}" in ${exports.PROJECT_CONFIG_FILENAME}: "${String(rawVal)}" is not a supported language`, { file });
            continue;
        }
        out[key] = rawVal;
    }
    return Object.keys(out).length > 0 ? out : EMPTY;
}
/**
 * Load the validated extension overrides for a project, mtime-cached.
 *
 * Returns a map of `.ext` → supported language id. The result merges on top of
 * the built-in extension map at the point of use (see `detectLanguage` /
 * `isSourceFile`), with these user mappings taking precedence. Returns an empty
 * map when there is no `codegraph.json` (the zero-config default).
 */
function loadExtensionOverrides(rootDir) {
    const file = path.join(rootDir, exports.PROJECT_CONFIG_FILENAME);
    let mtimeMs;
    try {
        mtimeMs = fs.statSync(file).mtimeMs;
    }
    catch {
        // No config file — drop any stale cache entry and return the default.
        cacheMeta.delete(rootDir);
        overridesCache.delete(rootDir);
        return EMPTY;
    }
    const meta = cacheMeta.get(rootDir);
    if (meta && meta.mtimeMs === mtimeMs)
        return meta.overrides;
    const overrides = parseExtensionOverrides(file);
    cacheMeta.set(rootDir, { mtimeMs, overrides });
    overridesCache.set(rootDir, overrides);
    return overrides;
}
/** Test/maintenance hook: forget cached config (e.g. after rewriting it in a test). */
function clearProjectConfigCache() {
    cacheMeta.clear();
    overridesCache.clear();
}
//# sourceMappingURL=project-config.js.map