/**
 * Semantic Tagger
 *
 * Auto-assigns business tags to modules based on:
 * - File/module naming conventions
 * - Import patterns (framework libraries)
 * - Decorator/annotation analysis
 * - Route prefix patterns
 */
import { SemanticTagAssignment } from '../types';
import { QueryBuilder } from '../db/queries';
declare const TAG_VOCABULARY: readonly ["auth", "payment", "user", "notification", "storage", "cache", "search", "email", "sms", "queue", "logging", "monitoring", "config", "database", "api", "webhook", "scheduler", "export", "import", "transform", "validation", "routing", "middleware", "security", "frontend", "backend", "testing", "cli", "sdk", "integration"];
export type SemanticTag = (typeof TAG_VOCABULARY)[number];
export declare class SemanticTagger {
    private queries;
    private rules;
    constructor(queries: QueryBuilder);
    tagAll(): Map<string, SemanticTagAssignment>;
    tagModule(modulePath: string): SemanticTagAssignment;
    findByTag(tag: string): SemanticTagAssignment[];
    findAllTags(): Map<string, string[]>;
    private getModuleImports;
    private buildRules;
}
export {};
//# sourceMappingURL=tagger.d.ts.map