"use strict";
/**
 * Context Compression Engine
 *
 * Generates compressed module summaries designed for LLM consumption.
 * Rule-based compression (no LLM call needed):
 * - Extract top-importance symbols per module
 * - Generate structural summaries
 * - Template: "[ModuleName]负责[动词短语]，包含{N}个核心服务..."
 *
 * Target: >95% compression rate (signatures only vs full bodies)
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
exports.ContextCompressor = void 0;
const path = __importStar(require("path"));
const DEFAULT_TOKENS_PER_CHAR = 0.25;
class ContextCompressor {
    queries;
    symbolScorer;
    moduleScorer;
    entryPointDetector;
    tagger;
    options;
    constructor(queries, symbolScorer, moduleScorer, entryPointDetector, tagger) {
        this.queries = queries;
        this.symbolScorer = symbolScorer;
        this.moduleScorer = moduleScorer;
        this.entryPointDetector = entryPointDetector;
        this.tagger = tagger;
        this.options = {
            maxSignaturesPerModule: 10,
            maxDependenciesPerModule: 15,
            signatureMaxLength: 200,
            targetCompressionRatio: 0.95,
        };
    }
    generateModuleSummary(modulePath) {
        const nodes = this.queries.getNodesByFile(modulePath);
        if (nodes.length === 0)
            return null;
        const moduleName = this.extractModuleName(modulePath);
        // Get top symbols by importance
        const allScores = this.symbolScorer.computeImportanceForIDs(nodes.map((n) => n.id));
        const sortedScores = Array.from(allScores.values())
            .sort((a, b) => b.importance - a.importance);
        const coreServices = [];
        const coreTypes = [];
        for (const score of sortedScores.slice(0, this.options.maxSignaturesPerModule)) {
            const node = this.queries.getNodeById(score.symbolId);
            if (!node)
                continue;
            if (this.isServiceKind(node.kind)) {
                coreServices.push(node.name);
            }
            else if (this.isTypeKind(node.kind)) {
                coreTypes.push(node.name);
            }
        }
        // Entry points in this module
        const allEntryPoints = this.entryPointDetector.detectAll().entryPoints;
        const moduleEntryPoints = allEntryPoints
            .filter((ep) => ep.filePath === modulePath)
            .map((ep) => ep.controller);
        // Dependencies
        const deps = this.queries.getDependencyFilePaths(modulePath);
        const dependents = this.queries.getDependentFilePaths(modulePath);
        // Business tags
        const tags = this.tagger.tagModule(modulePath).tags;
        // Generate summary text
        const summary = this.generateSummaryText(moduleName, coreServices, coreTypes, tags, nodes.length);
        const purpose = this.generatePurposeText(tags, coreServices, moduleEntryPoints);
        // Compression ratio estimate
        const estimatedFullSize = nodes.reduce((sum, n) => sum + (n.endLine - n.startLine) * 80, 0);
        const estimatedSummarySize = summary.length + coreServices.join(', ').length + coreTypes.join(', ').length;
        const compressionRatio = estimatedFullSize > 0
            ? Math.round((1 - estimatedSummarySize / estimatedFullSize) * 100) / 100
            : 1;
        return {
            moduleId: modulePath,
            moduleName,
            summary,
            purpose,
            entryPoints: moduleEntryPoints.slice(0, 10),
            coreServices: coreServices.slice(0, this.options.maxSignaturesPerModule),
            coreTypes: coreTypes.slice(0, this.options.maxSignaturesPerModule),
            dependencies: deps.map((d) => this.extractModuleName(d)).slice(0, this.options.maxDependenciesPerModule),
            dependents: dependents.map((d) => this.extractModuleName(d)).slice(0, this.options.maxDependenciesPerModule),
            businessTags: tags,
            compressionRatio,
            symbolCount: nodes.length,
            fileCount: 1,
            computedAt: Date.now(),
        };
    }
    generateAllSummaries(onProgress) {
        const allFiles = this.queries.getAllFiles();
        const results = new Map();
        let processed = 0;
        for (const file of allFiles) {
            const summary = this.generateModuleSummary(file.path);
            if (summary) {
                results.set(file.path, summary);
            }
            processed++;
            onProgress?.(processed, allFiles.length);
        }
        return results;
    }
    getMinimalContext(input, _onProgress) {
        const maxTokens = input.maxTokens ?? 5000;
        // Phase 1: Find semantically relevant modules
        const searchTerms = this.extractSearchTerms(input.task);
        const relevantModules = this.findRelevantModules(searchTerms);
        // Phase 2: Generate summaries for relevant modules
        const summaries = [];
        for (const modulePath of relevantModules.slice(0, 30)) {
            const summary = this.generateModuleSummary(modulePath);
            if (summary) {
                summaries.push(summary);
            }
        }
        // Phase 3: Select required symbols within token budget
        const requiredSymbols = this.selectSymbolsWithinBudget(summaries, maxTokens);
        // Phase 4: Collect entry points
        const entryPoints = this.entryPointDetector.detectAll().entryPoints
            .filter((ep) => relevantModules.includes(ep.filePath))
            .slice(0, 20);
        // Phase 5: Detect relevant business flows
        const relevantFlows = [];
        const taggedModules = this.tagger.tagAll();
        for (const [modulePath, assignment] of taggedModules) {
            if (relevantModules.includes(modulePath)) {
                relevantFlows.push(...assignment.tags);
            }
        }
        // Phase 6: Generate overall summary
        const summary = this.generateTaskSummary(input.task, summaries, entryPoints, requiredSymbols.length);
        // Estimate tokens
        const estimatedTokens = this.estimateTokens(requiredSymbols, entryPoints, summary);
        // Compression ratio
        const totalFiles = this.queries.getAllFiles().length;
        const compressionRatio = totalFiles > 0
            ? Math.round((1 - relevantModules.length / totalFiles) * 100) / 100
            : 1;
        return {
            task: input.task,
            summary,
            requiredFiles: relevantModules.slice(0, 50),
            requiredSymbols: requiredSymbols.slice(0, 100),
            entryPoints,
            relevantFlows: [...new Set(relevantFlows)].slice(0, 30),
            estimatedTokens,
            tokenBudget: maxTokens,
            compressionRatio,
        };
    }
    extractModuleName(modulePath) {
        const basename = path.basename(modulePath, path.extname(modulePath));
        const dirname = path.basename(path.dirname(modulePath));
        if (basename === 'index' || basename === 'main' || basename === '__init__') {
            return dirname || basename;
        }
        return basename;
    }
    extractSearchTerms(task) {
        const terms = [];
        const words = task.split(/[\s,，。；;：:！!？?]+/);
        const stopWords = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
            'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
            'should', 'may', 'might', 'shall', 'i', 'you', 'he', 'she', 'it',
            'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
            'its', 'our', 'their', 'this', 'that', 'these', 'those', '修改', '逻辑',
            '实现', '功能', '添加', '删除', '重构', '优化', '修复', '调整',
        ]);
        for (const word of words) {
            const trimmed = word.trim().toLowerCase();
            if (trimmed.length >= 2 && !stopWords.has(trimmed)) {
                terms.push(trimmed);
            }
        }
        return terms;
    }
    findRelevantModules(searchTerms) {
        if (searchTerms.length === 0) {
            // Return top modules by importance
            const topModules = this.moduleScorer.getTopModules(20);
            return topModules.map((m) => m.modulePath);
        }
        const moduleScores = new Map();
        const allFiles = this.queries.getAllFiles();
        for (const file of allFiles) {
            const key = file.path.toLowerCase();
            let score = 0;
            for (const term of searchTerms) {
                if (key.includes(term)) {
                    score += 3;
                }
                // Also search within module symbols
                const nodes = this.queries.getNodesByFile(file.path);
                for (const node of nodes) {
                    if (node.name.toLowerCase().includes(term)) {
                        score += 2;
                    }
                    if (node.qualifiedName.toLowerCase().includes(term)) {
                        score += 1;
                    }
                }
            }
            if (score > 0) {
                moduleScores.set(file.path, score);
            }
        }
        return Array.from(moduleScores.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([p]) => p);
    }
    selectSymbolsWithinBudget(summaries, maxTokens) {
        const symbols = [];
        for (const summary of summaries) {
            // Get the actual nodes
            const nodes = this.queries.getNodesByFile(summary.moduleId);
            const allScores = this.symbolScorer.computeImportanceForIDs(nodes.filter((n) => this.isScorableKind(n.kind)).map((n) => n.id));
            const sorted = Array.from(allScores.values())
                .sort((a, b) => b.importance - a.importance);
            for (const score of sorted) {
                const node = this.queries.getNodeById(score.symbolId);
                if (!node)
                    continue;
                // Estimate token cost for this symbol
                const estimatedToks = this.getSymbolTokenEstimate(node);
                const currentToks = this.estimateTokens(symbols, [], '');
                if (currentToks + estimatedToks > maxTokens * 0.8)
                    break;
                symbols.push({
                    name: node.name,
                    qualifiedName: node.qualifiedName,
                    file: node.filePath,
                    startLine: node.startLine,
                    endLine: node.endLine,
                    importance: score.importance,
                    role: this.determineRole(node),
                    signature: node.signature,
                });
            }
        }
        return symbols;
    }
    generateSummaryText(moduleName, coreServices, coreTypes, tags, symbolCount) {
        const tagDesc = tags.length > 0 ? `[${tags.join(', ')}]` : '';
        const serviceDesc = coreServices.length > 0
            ? `核心服务: ${coreServices.join(', ')}。`
            : '';
        const typeDesc = coreTypes.length > 0
            ? `核心类型: ${coreTypes.join(', ')}。`
            : '';
        return `${moduleName}${tagDesc}: 包含${symbolCount}个符号。${serviceDesc}${typeDesc}`.trim();
    }
    generatePurposeText(tags, coreServices, entryPoints) {
        const parts = [];
        if (tags.length > 0)
            parts.push(`负责${tags.join('、')}相关功能`);
        if (coreServices.length > 0)
            parts.push(`提供${coreServices.slice(0, 5).join('、')}`);
        if (entryPoints.length > 0)
            parts.push(`入口: ${entryPoints.slice(0, 3).join('、')}`);
        return parts.join('。') || '通用代码模块';
    }
    generateTaskSummary(task, summaries, entryPoints, symbolCount) {
        const moduleNames = summaries.slice(0, 10).map((s) => s.moduleName);
        const epNames = entryPoints.slice(0, 10).map((ep) => ep.controller);
        return [
            `任务: ${task}`,
            `相关模块: ${moduleNames.join(', ') || '无'}`,
            `入口点: ${epNames.join(', ') || '无'}`,
            `需要了解约 ${symbolCount} 个关键符号`,
            `涉及 ${summaries.length} 个相关文件`,
        ].join('\n');
    }
    isServiceKind(kind) {
        return ['function', 'method', 'class', 'struct'].includes(kind);
    }
    isTypeKind(kind) {
        return ['interface', 'trait', 'protocol', 'type_alias', 'enum'].includes(kind);
    }
    isScorableKind(kind) {
        return ['function', 'method', 'class', 'struct', 'interface', 'trait', 'protocol', 'enum', 'variable', 'constant'].includes(kind);
    }
    determineRole(node) {
        const name = node.name.toLowerCase();
        const nameUpper = node.name;
        if (this.isControllerLike(node))
            return 'controller';
        if (name.includes('service') || nameUpper.endsWith('Service'))
            return 'service';
        if (name.includes('repository') || nameUpper.endsWith('Repository') || nameUpper.endsWith('Repo'))
            return 'repository';
        if (name.includes('validator') || nameUpper.endsWith('Validator'))
            return 'validator';
        if (name.includes('handler') || nameUpper.endsWith('Handler'))
            return 'handler';
        if (name.includes('middleware') || nameUpper.endsWith('Middleware'))
            return 'middleware';
        if (name.includes('model') || nameUpper.endsWith('Model'))
            return 'model';
        if (name.includes('util') || name.includes('helper') || nameUpper.endsWith('Utils'))
            return 'utility';
        if (name.includes('config') || nameUpper.endsWith('Config'))
            return 'config';
        if (node.kind === 'interface' || node.kind === 'trait' || node.kind === 'protocol')
            return 'interface';
        if (node.kind === 'enum')
            return 'enum';
        if (node.kind === 'class')
            return 'class';
        if (node.kind === 'function' || node.kind === 'method')
            return 'function';
        return 'symbol';
    }
    isControllerLike(node) {
        const name = node.name.toLowerCase();
        return (name.includes('controller') ||
            name.includes('handler') ||
            (node.decorators?.some((d) => /Controller|Router|RequestMapping|Get|Post|Put|Delete|Patch/i.test(d)) ?? false));
    }
    getSymbolTokenEstimate(node) {
        const sigLength = (node.signature?.length ?? 0);
        const nameLength = node.name.length;
        return Math.max(10, Math.ceil((sigLength + nameLength + 50) * DEFAULT_TOKENS_PER_CHAR));
    }
    estimateTokens(symbols, entryPoints, summary) {
        let chars = summary.length;
        for (const sym of symbols) {
            chars += sym.name.length + (sym.signature?.length ?? 0) + 30;
        }
        for (const ep of entryPoints) {
            chars += ep.controller.length + ep.entrypoint.length + 30;
        }
        return Math.ceil(chars * DEFAULT_TOKENS_PER_CHAR);
    }
}
exports.ContextCompressor = ContextCompressor;
//# sourceMappingURL=context-compressor.js.map