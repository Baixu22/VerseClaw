import { describe, expect, it } from 'vitest';
import {
  APP_ERROR_CODES,
  AppError,
  mapBackendErrorCode,
  normalizeAppError,
} from '@/lib/error-model';

describe('error-model', () => {
  it('maps backend UNSUPPORTED to CHANNEL_UNAVAILABLE', () => {
    expect(mapBackendErrorCode('UNSUPPORTED')).toBe('CHANNEL_UNAVAILABLE');
  });

  it('maps the high-frequency provider codes the unified exit answers for', () => {
    expect(mapBackendErrorCode('INSUFFICIENT_BALANCE')).toBe('BILLING');
    expect(mapBackendErrorCode('INVALID_API_KEY')).toBe('AUTH_PERMANENT');
    expect(mapBackendErrorCode('OVERLOADED')).toBe('OVERLOADED');
    expect(mapBackendErrorCode('MODEL_NOT_FOUND')).toBe('MODEL_NOT_FOUND');
    expect(mapBackendErrorCode('SOMETHING_NEW')).toBe('UNKNOWN');
  });

  it('lists every class exactly once so copy/retry audits stay exhaustive', () => {
    expect(new Set(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
    expect(APP_ERROR_CODES).toContain('UNKNOWN');
    expect(APP_ERROR_CODES.length).toBeGreaterThanOrEqual(13);
  });

  it('normalizes auth errors into AUTH_INVALID', () => {
    const error = normalizeAppError(new Error('HTTP 401: Invalid Authentication'));
    expect(error.code).toBe('AUTH_INVALID');
  });

  it('normalizes ipc channel errors into CHANNEL_UNAVAILABLE', () => {
    const error = normalizeAppError(new Error('Invalid IPC channel: unsupported:channel'));
    expect(error.code).toBe('CHANNEL_UNAVAILABLE');
  });

  it('preserves AppError and merges details', () => {
    const base = new AppError('TIMEOUT', 'request timeout', undefined, { a: 1 });
    const normalized = normalizeAppError(base, { b: 2 });
    expect(normalized.code).toBe('TIMEOUT');
    expect(normalized.details).toEqual({ a: 1, b: 2 });
  });

  it('reads structured signals off the error and its nested response envelope', () => {
    expect(normalizeAppError(Object.assign(new Error('boom'), { statusCode: 503 })).code).toBe('OVERLOADED');
    expect(normalizeAppError(Object.assign(new Error('boom'), { response: { status: 429 } })).code).toBe('RATE_LIMIT');
    expect(normalizeAppError(Object.assign(new Error('boom'), { code: 'MODEL_NOT_FOUND' })).code).toBe('MODEL_NOT_FOUND');
    expect(normalizeAppError(Object.assign(new Error('boom'), { code: 'invalid_api_key' })).code).toBe('AUTH_PERMANENT');
    expect(normalizeAppError(Object.assign(new Error('boom'), { error: { type: 'insufficient_quota' } })).code).toBe('BILLING');
  });

  it('lets structured signals override a contradicting human-readable message', () => {
    // Message says timeout, structure says rate limited.
    expect(normalizeAppError(Object.assign(new Error('Request timed out'), { status: 429 })).code)
      .toBe('RATE_LIMIT');
    // Message reads like an auth failure, provider code says exhausted balance.
    expect(normalizeAppError(Object.assign(new Error('Authentication failed'), { code: 'insufficient_balance' })).code)
      .toBe('BILLING');
    // Caller-supplied structured details win over the message too.
    expect(normalizeAppError(new Error('Model not found'), { reason: 'insufficient_balance' }).code)
      .toBe('BILLING');
  });

  it('falls back to the untranslated technical message only when no signal identifies a class', () => {
    expect(normalizeAppError(new Error('ECONNREFUSED 127.0.0.1:443')).code).toBe('NETWORK');
    expect(normalizeAppError(new Error('the provider is overloaded right now')).code).toBe('OVERLOADED');
    expect(normalizeAppError(new Error('roles must alternate')).code).toBe('CONVERSATION_STATE');
    expect(normalizeAppError(new Error('no idea at all')).code).toBe('UNKNOWN');
  });

  it('does not build user copy: an unidentifiable plain object stays UNKNOWN with an empty message', () => {
    const normalized = normalizeAppError({ status: 'weird' });
    expect(normalized.code).toBe('UNKNOWN');
    expect(normalized.message).toBe('');
  });
});
