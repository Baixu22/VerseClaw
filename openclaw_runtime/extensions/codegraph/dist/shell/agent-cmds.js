"use strict";
/**
 * AgentGraph Shell Commands
 *
 * JSON-output CLI commands for AI agent consumption.
 * All output is valid JSON. No plain text output.
 * Integrates with the existing codegraph CLI (commander).
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
exports.registerAgentCommands = registerAgentCommands;
const index_1 = require("../index");
const find_symbol_1 = require("../agent-api/find-symbol");
const find_business_flow_1 = require("../agent-api/find-business-flow");
const impact_analysis_1 = require("../agent-api/impact-analysis");
const minimal_context_1 = require("../agent-api/minimal-context");
const entrypoint_detector_1 = require("../analysis/entrypoint-detector");
const impact_analyzer_1 = require("../analysis/impact-analyzer");
const symbol_scorer_1 = require("../scoring/symbol-scorer");
const module_scorer_1 = require("../scoring/module-scorer");
const context_compressor_1 = require("../compression/context-compressor");
const flow_detector_1 = require("../semantic/flow-detector");
const tagger_1 = require("../semantic/tagger");
const git_analyzer_1 = require("../evolution/git-analyzer");
const path = __importStar(require("path"));
function jsonOutput(data, durationMs) {
    const result = {
        success: true,
        data,
        durationMs,
    };
    console.log(JSON.stringify(result, null, 2));
}
function jsonError(error, code, durationMs) {
    const result = {
        success: false,
        error,
        errorCode: code,
        durationMs,
    };
    console.log(JSON.stringify(result, null, 2));
}
function registerAgentCommands(program) {
    // agent-find-symbol <name>
    program
        .command('agent-find-symbol <name>')
        .description('Find a symbol and return its location, references, callers, callees, and importance (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('--max-callers <n>', 'Max callers to return', '20')
        .option('--max-callees <n>', 'Max callees to return', '20')
        .action(async (name, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const queries = cg['queries'];
            const traverser = cg['traverser'];
            const scorer = new symbol_scorer_1.SymbolScorer(queries);
            const result = (0, find_symbol_1.findSymbol)(queries, traverser, scorer, {
                symbol: name,
                maxCallers: parseInt(options.maxCallers, 10),
                maxCallees: parseInt(options.maxCallees, 10),
            });
            cg.close();
            if (result) {
                jsonOutput(result, Date.now() - startTime);
            }
            else {
                jsonError(`Symbol not found: ${name}`, 'SYMBOL_NOT_FOUND', Date.now() - startTime);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-find-flow <flow>
    program
        .command('agent-find-flow <flow>')
        .description('Find a business flow by name and return its entry point, services, repositories, and validators (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('--max-steps <n>', 'Max steps per flow', '20')
        .action(async (flow, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const queries = cg['queries'];
            const epDetector = new entrypoint_detector_1.EntryPointDetector(queries);
            const flowDetector = new flow_detector_1.FlowDetector(queries, epDetector);
            const result = (0, find_business_flow_1.findBusinessFlow)(queries, epDetector, flowDetector, {
                flow,
                maxSteps: parseInt(options.maxSteps, 10),
            });
            cg.close();
            jsonOutput(result, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-callers <symbol>
    program
        .command('agent-callers <symbol>')
        .description('Find all callers of a symbol (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('-d, --depth <n>', 'Max traversal depth', '2')
        .option('-l, --limit <n>', 'Max results', '50')
        .action(async (symbol, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const traverser = cg['traverser'];
            const depth = parseInt(options.depth, 10);
            const searchResults = cg.searchNodes(symbol, { limit: 3 });
            if (searchResults.length === 0) {
                cg.close();
                jsonError(`Symbol not found: ${symbol}`, 'SYMBOL_NOT_FOUND', Date.now() - startTime);
                return;
            }
            const target = searchResults[0].node;
            const callers = traverser.getCallers(target.id, depth);
            const result = callers.map((c) => ({
                symbol: c.node.qualifiedName,
                name: c.node.name,
                file: c.node.filePath,
                line: c.node.startLine,
                kind: c.node.kind,
                edgeKind: c.edge.kind,
            }));
            cg.close();
            jsonOutput({ symbol: target.qualifiedName, callers: result }, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-callees <symbol>
    program
        .command('agent-callees <symbol>')
        .description('Find all callees of a symbol (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('-d, --depth <n>', 'Max traversal depth', '2')
        .option('-l, --limit <n>', 'Max results', '50')
        .action(async (symbol, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const traverser = cg['traverser'];
            const depth = parseInt(options.depth, 10);
            const searchResults = cg.searchNodes(symbol, { limit: 3 });
            if (searchResults.length === 0) {
                cg.close();
                jsonError(`Symbol not found: ${symbol}`, 'SYMBOL_NOT_FOUND', Date.now() - startTime);
                return;
            }
            const target = searchResults[0].node;
            const callees = traverser.getCallees(target.id, depth);
            const result = callees.map((c) => ({
                symbol: c.node.qualifiedName,
                name: c.node.name,
                file: c.node.filePath,
                line: c.node.startLine,
                kind: c.node.kind,
                edgeKind: c.edge.kind,
            }));
            cg.close();
            jsonOutput({ symbol: target.qualifiedName, callees: result }, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-impact <symbol>
    program
        .command('agent-impact <symbol>')
        .description('Analyze the blast radius of changing a symbol (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('-d, --depth <n>', 'Analysis depth', '3')
        .action(async (symbol, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const queries = cg['queries'];
            const impactAnalyzer = new impact_analyzer_1.ImpactAnalyzer(queries);
            const result = (0, impact_analysis_1.analyzeImpact)(impactAnalyzer, {
                symbol,
                depth: parseInt(options.depth, 10),
            });
            cg.close();
            if (result) {
                jsonOutput(result, Date.now() - startTime);
            }
            else {
                jsonError(`Symbol not found: ${symbol}`, 'SYMBOL_NOT_FOUND', Date.now() - startTime);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-context <task>
    program
        .command('agent-context <task>')
        .description('Get minimal context for a task — returns only the files and symbols needed (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('--max-tokens <n>', 'Maximum estimated tokens', '5000')
        .action(async (task, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const queries = cg['queries'];
            const scorer = new symbol_scorer_1.SymbolScorer(queries);
            const moduleScorer = new module_scorer_1.ModuleScorer(queries, scorer);
            const epDetector = new entrypoint_detector_1.EntryPointDetector(queries);
            const tagger = new tagger_1.SemanticTagger(queries);
            const compressor = new context_compressor_1.ContextCompressor(queries, scorer, moduleScorer, epDetector, tagger);
            const result = (0, minimal_context_1.getMinimalContext)(compressor, {
                task,
                maxTokens: parseInt(options.maxTokens, 10),
            });
            cg.close();
            jsonOutput(result, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-summary <module>
    program
        .command('agent-summary <module>')
        .description('Get a compressed summary of a module (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .action(async (moduleName, options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const queries = cg['queries'];
            const scorer = new symbol_scorer_1.SymbolScorer(queries);
            const moduleScorer = new module_scorer_1.ModuleScorer(queries, scorer);
            const epDetector = new entrypoint_detector_1.EntryPointDetector(queries);
            const tagger = new tagger_1.SemanticTagger(queries);
            const compressor = new context_compressor_1.ContextCompressor(queries, scorer, moduleScorer, epDetector, tagger);
            // Find the module file
            const allFiles = cg.getFiles();
            const matchingFile = allFiles.find((f) => path.basename(f.path).toLowerCase().includes(moduleName.toLowerCase()));
            if (!matchingFile) {
                cg.close();
                jsonError(`Module not found: ${moduleName}`, 'MODULE_NOT_FOUND', Date.now() - startTime);
                return;
            }
            const summary = compressor.generateModuleSummary(matchingFile.path);
            cg.close();
            if (summary) {
                jsonOutput(summary, Date.now() - startTime);
            }
            else {
                jsonError(`Could not generate summary for: ${moduleName}`, 'SUMMARY_FAILED', Date.now() - startTime);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-entrypoints
    program
        .command('agent-entrypoints')
        .description('List all detected entry points in the project (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('--type <type>', 'Filter by entry point type (http_api|cli|scheduled_task|message_queue|websocket|rpc|event_handler)')
        .action(async (options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const queries = cg['queries'];
            const epDetector = new entrypoint_detector_1.EntryPointDetector(queries);
            let result;
            if (options.type) {
                result = epDetector.getEntryPointsByType(options.type);
            }
            else {
                result = epDetector.detectAll();
            }
            cg.close();
            jsonOutput(result, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-refactor <rule>
    program
        .command('agent-refactor <rule>')
        .description('Search for AST patterns and analyze/apply refactoring safely (Phase 4: ast-grep integration)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('-r, --replace <replacement>', 'Replacement pattern (omit for search/dry-run only)')
        .option('-l, --lang <language>', 'Language filter (auto-detect if omitted)')
        .option('--apply', 'Actually apply the refactoring (default: dry-run only)')
        .option('--file <pattern>', 'File path pattern to limit scope')
        .action(async (rule, options) => {
        const startTime = Date.now();
        try {
            const { AstGrepClient } = require('../ast-grep');
            const astGrep = new AstGrepClient({ cwd: options.path });
            if (!astGrep.isAvailable()) {
                jsonOutput({
                    available: false,
                    message: 'ast-grep (sg) binary not found. Install with: cargo install ast-grep',
                    installGuide: 'Visit https://ast-grep.github.io/ for installation instructions.',
                }, Date.now() - startTime);
                return;
            }
            // If no replacement, do a search
            if (!options.replace) {
                const lang = options.lang ?? 'typescript';
                const searchResult = astGrep.search(rule, lang, options.file ? [options.file] : undefined);
                jsonOutput({
                    type: 'search',
                    pattern: rule,
                    matches: searchResult.matches.slice(0, 100),
                    totalFound: searchResult.totalFound,
                    hint: 'Add --replace "<replacement>" to apply refactoring. Add --apply to commit changes.',
                }, Date.now() - startTime);
                return;
            }
            // With replacement: do refactoring
            const language = options.lang ?? 'typescript';
            const refactorResult = astGrep.refactor({
                id: `refactor_${Date.now()}`,
                pattern: rule,
                replacement: options.replace,
                language: language,
                files: options.file ? [options.file] : undefined,
            }, !options.apply);
            jsonOutput({
                type: options.apply ? 'applied' : 'dry-run',
                pattern: rule,
                replacement: options.replace,
                summary: refactorResult.summary,
                filesAffected: refactorResult.filesAffected,
                changes: refactorResult.changes.slice(0, 100),
                warning: options.apply ? 'Changes applied. Verify with git diff.' : 'Dry run only. Add --apply to commit changes.',
            }, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-git-stats
    program
        .command('agent-git-stats')
        .description('Analyze git history for file modification frequency, hotspots, and co-change patterns (JSON output)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .option('-f, --file <path>', 'Focus on a specific file')
        .option('-n, --max-commits <n>', 'Max commits to analyze', '500')
        .option('--since-days <n>', 'Only analyze commits from last N days')
        .action(async (options) => {
        const startTime = Date.now();
        try {
            const analyzer = new git_analyzer_1.GitHistoryAnalyzer(options.path);
            if (!analyzer.isGitRepo()) {
                jsonError('Not a git repository', 'NOT_GIT_REPO', Date.now() - startTime);
                return;
            }
            const histOptions = {
                maxCommits: parseInt(options.maxCommits, 10),
                sinceDays: options.sinceDays ? parseInt(options.sinceDays, 10) : undefined,
            };
            if (options.file) {
                const stats = analyzer.getFileStats([options.file]);
                const coChanged = analyzer.getCoChangedFiles(options.file, 30);
                const freq = analyzer.getModificationFrequency(options.file);
                jsonOutput({
                    file: options.file,
                    stats: stats.get(options.file) ?? null,
                    modificationFrequency: freq,
                    coChangedFiles: coChanged,
                }, Date.now() - startTime);
            }
            else {
                const repoStats = analyzer.getRepoStats(histOptions);
                jsonOutput(repoStats, Date.now() - startTime);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
    // agent-freshness — check data staleness
    program
        .command('agent-freshness')
        .description('Check how fresh the AgentGraph analysis data is (scores, summaries, entry points)')
        .option('-p, --path <path>', 'Project root path', process.cwd())
        .action(async (options) => {
        const startTime = Date.now();
        try {
            const cg = await index_1.CodeGraph.open(options.path);
            const freshness = cg.getFreshnessState();
            const isFresh = cg.isAnalysisFresh();
            cg.close();
            jsonOutput({
                fresh: isFresh,
                recommendation: isFresh
                    ? 'Data is fresh. Agent can trust scores/summaries without re-verifying files.'
                    : 'Data may be stale. Consider running codegraph index or waiting for auto-sync.',
                stats: freshness,
                envControl: 'Set CODEGRAPH_AUTO_ANALYZE=0 to disable auto-analysis. Set CODEGRAPH_AUTO_ANALYZE=1 to enable.',
            }, Date.now() - startTime);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonError(msg, 'AGENT_ERROR', Date.now() - startTime);
        }
    });
}
//# sourceMappingURL=agent-cmds.js.map