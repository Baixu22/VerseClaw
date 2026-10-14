import { describe, expect, it } from 'vitest';
import { SandboxDenialError } from '@shared/sandbox/errors';
import { mapBackendErrorCode, normalizeAppError } from '@/lib/error-model';

describe('SandboxDenialError', () => {
  it('carries mechanism, path, operation, and provider context', () => {
    const error = new SandboxDenialError({
      mechanism: 'seatbelt',
      operation: 'write',
      path: '/workspace/.git/config',
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    });

    expect(error).toMatchObject({ code: 'SANDBOX_DENIED', mechanism: 'seatbelt', operation: 'write' });
    expect(error.toDetails()).toEqual({
      code: 'SANDBOX_DENIED',
      category: 'sandbox-denial',
      mechanism: 'seatbelt',
      operation: 'write',
      path: '/workspace/.git/config',
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    });
  });

  it('classifies through the existing AppError taxonomy instead of creating a parallel envelope', () => {
    const error = new SandboxDenialError({ mechanism: 'landlock', operation: 'read' });
    expect(mapBackendErrorCode(error.code)).toBe('PERMISSION');
    expect(normalizeAppError(error).code).toBe('PERMISSION');
  });
});
