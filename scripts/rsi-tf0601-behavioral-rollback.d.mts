export const RECEIPT_SCHEMA: string;
export const RECEIPT_ACTOR: string;
export const RECEIPT_VERIFIER: string;
export function observeRollbackDrill(): { phases: { baselineOff: boolean; candidateOn: boolean; rollbackOff: boolean }; observations: { enabledHook: { subscribed: boolean; afterUninstall: number }; disabledHook: { subscribed: boolean; afterUninstall: number } } };
export function buildBehavioralRollbackReceipt(options?: { candidateDigest: string; baselineDigest: string; actor?: string; adjudicatorActor?: string; out?: string }): any;
export function validateBehavioralRollbackReceipt(receipt: any): { valid: boolean; errors: string[] };
export function validateReceiptFile(path: string): { valid: boolean; errors: string[] };
