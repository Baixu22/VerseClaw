export type ProductSemanticUnsafeClaim = {
  id:
    | 'chat-editable-dag'
    | 'chat-auto-task-loop'
    | 'team-orchestrate-complete-quality'
    | 'routing-memo-default-learning'
    | 'plan-mode-strict-no-diff';
  unsafe: string;
  safe: string;
  patterns: readonly RegExp[];
};

export const PRODUCT_SEMANTIC_UNSAFE_CLAIMS = [
  {
    id: 'chat-editable-dag',
    unsafe: 'Chat plan exposes an editable DAG.',
    safe: 'Chat Plan is a bounded projection with lightweight edits; it must not be described as DAG editing.',
    patterns: [
      /\bchat\b.{0,60}\beditable\b.{0,30}\bdag\b/i,
      /\bchat plan\b.{0,60}\b(edit|drag|dependency)\b.{0,30}\bdag\b/i,
    ],
  },
  {
    id: 'chat-auto-task-loop',
    unsafe: 'Ordinary Chat automatically starts or enters Task Loop.',
    safe: 'Ordinary Chat may suggest a Task Loop upgrade; the user must confirm it.',
    patterns: [
      /\bordinary chat\b.{0,60}\b(auto|automatic|automatically)\b.{0,40}\btask loop\b/i,
      /\bchat\b.{0,40}\b(auto|automatic|automatically)\b.{0,40}\btask loop\b/i,
    ],
  },
  {
    id: 'team-orchestrate-complete-quality',
    unsafe: 'Ordinary team_orchestrate returns complete quality scoring.',
    safe: 'Ordinary team_orchestrate uses explicit null/shadow/active quality state; Task Loop owns repair semantics.',
    patterns: [
      /\bordinary\s+team_orchestrate\b.{0,80}\bcomplete quality scoring\b/i,
      /\bteam_orchestrate\b.{0,80}\b(full|complete)\b.{0,30}\bquality (score|scoring|scorecard)\b/i,
    ],
  },
  {
    id: 'routing-memo-default-learning',
    unsafe: 'Routing Memo learns role quality by default.',
    safe: 'Routing Memo remains shadow until scorecard-backed active state is available.',
    patterns: [
      /\brouting memo\b.{0,60}\b(learns|learning)\b.{0,30}\bby default\b/i,
      /\brouting memo\b.{0,40}\bdefault\b.{0,40}\b(active|learning)\b/i,
    ],
  },
  {
    id: 'plan-mode-strict-no-diff',
    unsafe: 'Plan mode provides strict no-diff execution for every write.',
    safe: 'Plan mode is a permission gate for user file writes; system metadata writes are explicit exceptions.',
    patterns: [
      /\bplan mode\b.{0,60}\bstrict no-diff\b/i,
      /\bplan mode\b.{0,80}\bno-diff\b.{0,30}\bevery write\b/i,
    ],
  },
] as const satisfies readonly ProductSemanticUnsafeClaim[];
