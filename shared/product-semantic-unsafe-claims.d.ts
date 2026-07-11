export type ProductSemanticUnsafeClaim = {
    id: 'chat-editable-dag' | 'chat-auto-task-loop' | 'team-orchestrate-complete-quality' | 'routing-memo-default-learning' | 'plan-mode-strict-no-diff';
    unsafe: string;
    safe: string;
    patterns: readonly RegExp[];
};
export declare const PRODUCT_SEMANTIC_UNSAFE_CLAIMS: readonly [{
    readonly id: 'chat-editable-dag';
    readonly unsafe: 'Chat plan exposes an editable DAG.';
    readonly safe: 'Chat Plan is a bounded projection with lightweight edits; it must not be described as DAG editing.';
    readonly patterns: readonly [RegExp, RegExp];
}, {
    readonly id: 'chat-auto-task-loop';
    readonly unsafe: 'Ordinary Chat automatically starts or enters Task Loop.';
    readonly safe: 'Ordinary Chat may suggest a Task Loop upgrade; the user must confirm it.';
    readonly patterns: readonly [RegExp, RegExp];
}, {
    readonly id: 'team-orchestrate-complete-quality';
    readonly unsafe: 'Ordinary team_orchestrate returns complete quality scoring.';
    readonly safe: 'Ordinary team_orchestrate uses explicit null/shadow/active quality state; Task Loop owns repair semantics.';
    readonly patterns: readonly [RegExp, RegExp];
}, {
    readonly id: 'routing-memo-default-learning';
    readonly unsafe: 'Routing Memo learns role quality by default.';
    readonly safe: 'Routing Memo remains shadow until scorecard-backed active state is available.';
    readonly patterns: readonly [RegExp, RegExp];
}, {
    readonly id: 'plan-mode-strict-no-diff';
    readonly unsafe: 'Plan mode provides strict no-diff execution for every write.';
    readonly safe: 'Plan mode is a permission gate for user file writes; system metadata writes are explicit exceptions.';
    readonly patterns: readonly [RegExp, RegExp];
}];
