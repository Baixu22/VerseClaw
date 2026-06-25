/**
 * Module Importance Scorer
 *
 * Aggregates symbol-level importance scores into module (file/directory) level.
 * Helps agents prioritize which files to read first.
 */
import { ModuleImportance, SymbolImportance } from '../types';
import { QueryBuilder } from '../db/queries';
import { SymbolScorer } from './symbol-scorer';
export declare class ModuleScorer {
    private queries;
    private symbolScorer;
    constructor(queries: QueryBuilder, symbolScorer: SymbolScorer);
    computeModuleImportance(modulePath: string, symbolScores?: Map<string, SymbolImportance>): ModuleImportance;
    computeAllModules(onProgress?: (current: number, total: number) => void): Map<string, ModuleImportance>;
    getTopModules(topN: number, onProgress?: (current: number, total: number) => void): ModuleImportance[];
    getModulesByImportance(threshold: number, onProgress?: (current: number, total: number) => void): ModuleImportance[];
    private getModuleSymbols;
    private isScorableKind;
    private isModuleEntryPoint;
}
//# sourceMappingURL=module-scorer.d.ts.map