import {
  decideSensitiveCapture,
  type SensitiveCaptureChannel,
  type SensitiveCaptureDecision,
} from '../security/sensitive-capture-policy.ts';
import { getSensitiveCapturePolicy } from './sensitive-capture-policy-loader.ts';

export async function assertSensitiveCaptureAllowed(
  channel: SensitiveCaptureChannel,
  grantId?: string | null,
): Promise<SensitiveCaptureDecision> {
  const policy = await getSensitiveCapturePolicy();
  const decision = decideSensitiveCapture({ policy, channel, grantId });
  if (!decision.allowed) {
    const error = new Error(decision.reason);
    (error as Error & { code?: string }).code = decision.code;
    throw error;
  }
  return decision;
}
