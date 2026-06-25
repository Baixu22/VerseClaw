/**
 * get_minimal_context API
 *
 * Core API: given a task description, returns the minimal set of files
 * and symbols the agent needs to understand to complete the task.
 * Target: Token consumption reduced by 80%+ vs reading all files.
 */
import { GetMinimalContextInput, GetMinimalContextOutput } from '../types';
import { ContextCompressor } from '../compression/context-compressor';
export declare function getMinimalContext(compressor: ContextCompressor, input: GetMinimalContextInput): GetMinimalContextOutput;
//# sourceMappingURL=minimal-context.d.ts.map