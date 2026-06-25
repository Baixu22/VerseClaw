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
import { ModuleSummary, GetMinimalContextInput, GetMinimalContextOutput } from '../types';
import { QueryBuilder } from '../db/queries';
import { SymbolScorer } from '../scoring/symbol-scorer';
import { ModuleScorer } from '../scoring/module-scorer';
import { EntryPointDetector } from '../analysis/entrypoint-detector';
import { SemanticTagger } from '../semantic/tagger';
export interface CompressionOptions {
    maxSignaturesPerModule?: number;
    maxDependenciesPerModule?: number;
    signatureMaxLength?: number;
    targetCompressionRatio?: number;
}
export declare class ContextCompressor {
    private queries;
    private symbolScorer;
    private moduleScorer;
    private entryPointDetector;
    private tagger;
    private options;
    constructor(queries: QueryBuilder, symbolScorer: SymbolScorer, moduleScorer: ModuleScorer, entryPointDetector: EntryPointDetector, tagger: SemanticTagger);
    generateModuleSummary(modulePath: string): ModuleSummary | null;
    generateAllSummaries(onProgress?: (current: number, total: number) => void): Map<string, ModuleSummary>;
    getMinimalContext(input: GetMinimalContextInput, _onProgress?: (current: number, total: number) => void): GetMinimalContextOutput;
    private extractModuleName;
    private extractSearchTerms;
    private findRelevantModules;
    private selectSymbolsWithinBudget;
    private generateSummaryText;
    private generatePurposeText;
    private generateTaskSummary;
    private isServiceKind;
    private isTypeKind;
    private isScorableKind;
    private determineRole;
    private isControllerLike;
    private getSymbolTokenEstimate;
    private estimateTokens;
}
//# sourceMappingURL=context-compressor.d.ts.map