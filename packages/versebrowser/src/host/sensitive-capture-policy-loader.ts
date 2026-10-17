/**
 * Sensitive capture policy loader hook.
 *
 * Original: electron/utils/store.ts `getSensitiveCapturePolicy` supplied the
 * host electron-store value. Standalone default is DEFAULT_SENSITIVE_CAPTURE_POLICY
 * so unit tests and CLI hosts can run without ClawX storage.
 */
import {
  DEFAULT_SENSITIVE_CAPTURE_POLICY,
  type SensitiveCapturePolicy,
} from '../security/sensitive-capture-policy.ts';

export type SensitiveCapturePolicyLoader = () =>
  | Promise<SensitiveCapturePolicy>
  | SensitiveCapturePolicy;

let loader: SensitiveCapturePolicyLoader = () => DEFAULT_SENSITIVE_CAPTURE_POLICY;

export function setSensitiveCapturePolicyLoader(next: SensitiveCapturePolicyLoader | null): void {
  loader = next ?? (() => DEFAULT_SENSITIVE_CAPTURE_POLICY);
}

export async function getSensitiveCapturePolicy(): Promise<SensitiveCapturePolicy> {
  return loader();
}
