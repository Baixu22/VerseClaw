// Frozen RC-01 receipt-owner decision approved on 2026-08-02. Generation and
// validation share the contract; baseline evidence cannot override it.
export const RECEIPT_OWNER = {
  selectedOwner: 'OpenClaw shared state SQLite / runtime_receipts via ReceiptStore',
  logicalOwner: 'narrow ReceiptStore interface',
  physicalOwner: 'existing openclaw-state SQLite',
  tableName: 'runtime_receipts',
};

export const RECEIPT_HARD_CONSTRAINTS = [
  '1. receipt stores only digest, refs, call index, version, and policy digest; never raw prompt, tool output, credentials, cookies, or environment values',
  '2. append-only; same idempotency_key with identical content is idempotent success, different content must conflict-fail',
  '3. no max(sequence)+1; use explicit attempt/model-call/wire-attempt identity',
  '4. no silent pruning; deletion requires an explicit lifecycle policy',
  '5. shadow write failure must not change send behavior but must fail RC-02 acceptance',
  '6. receipt explains and correlates facts only; it never authorizes replay; domain journals remain the effect/idempotency truth source',
  '7. npm fallback continues to report degraded and does not count toward complete receipt coverage',
];
