/**
 * find_symbol API
 *
 * Locates a symbol and returns its location, references, callers, callees, and importance.
 */
import { FindSymbolInput, FindSymbolOutput } from '../types';
import { QueryBuilder } from '../db/queries';
import { SymbolScorer } from '../scoring/symbol-scorer';
import { GraphTraverser } from '../graph';
export declare function findSymbol(queries: QueryBuilder, traverser: GraphTraverser, symbolScorer: SymbolScorer, input: FindSymbolInput): FindSymbolOutput | null;
//# sourceMappingURL=find-symbol.d.ts.map