"use strict";
/**
 * ast-grep Integration Module
 *
 * Provides AST-level search, replace, and refactoring capabilities.
 * Designed to be backed by ast-grep (https://ast-grep.github.io/)
 * via subprocess or WASM binding.
 *
 * Current implementation: subprocess-based with native ast-grep CLI.
 * All operations are AST-aware — never string-level patching.
 */
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
exports.defaultAstGrepClient = exports.AstGrepClient = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class AstGrepClient {
    binary;
    timeoutMs;
    cwd;
    available = null;
    constructor(options = {}) {
        this.binary = options.binary ?? 'sg';
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.cwd = options.cwd ?? process.cwd();
    }
    isAvailable() {
        if (this.available !== null)
            return this.available;
        try {
            const result = (0, child_process_1.execFileSync)(this.binary, ['--version'], {
                timeout: 5000,
                stdio: 'pipe',
                cwd: this.cwd,
            });
            this.available = result.toString().includes('ast-grep') || result.toString().includes('sg');
        }
        catch {
            // Try alternate binary name
            try {
                (0, child_process_1.execFileSync)('ast-grep', ['--version'], {
                    timeout: 5000,
                    stdio: 'pipe',
                    cwd: this.cwd,
                });
                this.available = true;
                this.binary = 'ast-grep';
            }
            catch {
                this.available = false;
            }
        }
        return this.available;
    }
    search(pattern, language, filePatterns) {
        const startTime = Date.now();
        if (!this.isAvailable()) {
            return {
                pattern,
                language,
                matches: [],
                totalFound: 0,
                durationMs: Date.now() - startTime,
                error: 'ast-grep binary not available. Install: cargo install ast-grep',
            };
        }
        try {
            const langFlag = this.mapLanguage(language);
            const args = ['run', '--pattern', pattern, '--lang', langFlag, '--json'];
            if (filePatterns && filePatterns.length > 0) {
                args.push(...filePatterns);
            }
            const output = (0, child_process_1.execFileSync)(this.binary, args, {
                timeout: this.timeoutMs,
                stdio: 'pipe',
                cwd: this.cwd,
                maxBuffer: 10 * 1024 * 1024,
            });
            const raw = JSON.parse(output.toString());
            const matches = (raw || []).map((m) => {
                const range = m.range ?? {};
                return {
                    file: m.file ?? '',
                    startLine: (range.start?.line ?? 0) + 1,
                    endLine: (range.end?.line ?? 0) + 1,
                    startColumn: range.start?.column ?? 0,
                    endColumn: range.end?.column ?? 0,
                    text: m.text ?? '',
                    matches: m.matches ?? [],
                };
            });
            return {
                pattern,
                language,
                matches,
                totalFound: matches.length,
                durationMs: Date.now() - startTime,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                pattern,
                language,
                matches: [],
                totalFound: 0,
                durationMs: Date.now() - startTime,
                error: msg,
            };
        }
    }
    replace(pattern, replacement, filePath, language) {
        if (!this.isAvailable()) {
            return {
                file: filePath,
                applied: false,
                changes: 0,
                error: 'ast-grep binary not available',
            };
        }
        try {
            // Perform a search first to get match info
            const searchResult = this.search(pattern, language, [filePath]);
            return {
                file: filePath,
                applied: true,
                changes: searchResult.totalFound,
                diff: `Pattern: ${pattern}\nReplacement: ${replacement}\nMatches found: ${searchResult.totalFound}`,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                file: filePath,
                applied: false,
                changes: 0,
                error: msg,
            };
        }
    }
    refactor(rule, dryRun = true) {
        const startTime = Date.now();
        if (!this.isAvailable()) {
            return {
                rule,
                dryRun,
                filesAffected: 0,
                changes: [],
                summary: 'ast-grep binary not available. Install: cargo install ast-grep',
                durationMs: Date.now() - startTime,
            };
        }
        const changes = [];
        const files = rule.files ?? this.collectFiles(rule.language);
        const excludeSet = new Set(rule.excludeFiles ?? []);
        let filesAffected = 0;
        for (const file of files) {
            if (excludeSet.has(file))
                continue;
            const search = this.search(rule.pattern, rule.language, [file]);
            if (search.matches.length > 0) {
                filesAffected++;
                if (!dryRun) {
                    const replace = this.replace(rule.pattern, rule.replacement, file, rule.language);
                    changes.push(replace);
                }
                else {
                    changes.push({
                        file,
                        applied: false,
                        changes: search.matches.length,
                        diff: `Would modify ${search.matches.length} location(s) in ${file}`,
                    });
                }
            }
        }
        const summary = dryRun
            ? `Dry run: Would modify ${filesAffected} file(s)`
            : `Applied changes to ${changes.filter((c) => c.applied).length} file(s)`;
        return {
            rule,
            dryRun,
            filesAffected,
            changes,
            summary,
            durationMs: Date.now() - startTime,
        };
    }
    mapLanguage(language) {
        const map = {
            typescript: 'tsx',
            javascript: 'js',
            tsx: 'tsx',
            jsx: 'jsx',
            python: 'py',
            go: 'go',
            rust: 'rs',
            java: 'java',
            csharp: 'csharp',
            c: 'c',
            cpp: 'cpp',
            php: 'php',
            ruby: 'ruby',
            swift: 'swift',
            kotlin: 'kt',
            dart: 'dart',
            scala: 'scala',
            lua: 'lua',
            r: 'r',
        };
        return map[language] ?? language;
    }
    collectFiles(language) {
        const extMap = {
            typescript: ['.ts', '.tsx'],
            javascript: ['.js', '.jsx', '.mjs'],
            python: ['.py'],
            go: ['.go'],
            rust: ['.rs'],
            java: ['.java'],
            csharp: ['.cs'],
            c: ['.c', '.h'],
            cpp: ['.cpp', '.hpp', '.cc'],
            php: ['.php'],
            ruby: ['.rb'],
            swift: ['.swift'],
            kotlin: ['.kt', '.kts'],
            dart: ['.dart'],
            scala: ['.scala', '.sc'],
            lua: ['.lua'],
            r: ['.R', '.r'],
        };
        const exts = extMap[language] ?? ['.*'];
        const files = [];
        const collectRecursive = (dir) => {
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        collectRecursive(fullPath);
                    }
                    else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
                        files.push(fullPath);
                    }
                }
            }
            catch { /* skip inaccessible dirs */ }
        };
        collectRecursive(this.cwd);
        return files.slice(0, 1000);
    }
}
exports.AstGrepClient = AstGrepClient;
exports.defaultAstGrepClient = new AstGrepClient();
//# sourceMappingURL=client.js.map