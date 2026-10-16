import { describe, expect, it } from 'vitest';
import ipaddr from 'ipaddr.js';
import {
  isBlockedSpecialUseIpv4Address,
  isCloudMetadataIpAddress,
  isLoopbackIpAddress,
  isPrivateOrLoopbackIpAddress,
  normalizeIpAddress,
  parseCanonicalIpAddress,
  redactSensitiveUrl,
  stripUrlUserInfo,
} from '../src/security/net-policy/index';

describe('net-policy SSRF / redaction helpers', () => {
  it('blocks loopback, private, and cloud metadata addresses', () => {
    expect(isLoopbackIpAddress('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpAddress('10.0.0.5')).toBe(true);
    expect(isPrivateOrLoopbackIpAddress('192.168.1.1')).toBe(true);
    expect(isCloudMetadataIpAddress('100.100.100.200')).toBe(true);
    expect(isCloudMetadataIpAddress('fd00:ec2::254')).toBe(true);
  });

  it('parses and normalizes canonical IPs', () => {
    expect(normalizeIpAddress('127.0.0.1')).toBe('127.0.0.1');
    expect(parseCanonicalIpAddress('::1')).toBeDefined();
    expect(parseCanonicalIpAddress('not-an-ip')).toBeUndefined();
  });

  it('flags blocked special-use IPv4', () => {
    const parse = (raw: string) => ipaddr.IPv4.parse(raw);
    expect(isBlockedSpecialUseIpv4Address(parse('0.0.0.0'))).toBe(true);
    expect(isBlockedSpecialUseIpv4Address(parse('255.255.255.255'))).toBe(true);
    expect(isBlockedSpecialUseIpv4Address(parse('224.0.0.1'))).toBe(true);
    expect(isBlockedSpecialUseIpv4Address(parse('8.8.8.8'))).toBe(false);
  });

  it('strips URL userinfo and redacts secrets', () => {
    expect(stripUrlUserInfo('https://user:pass@example.com/a')).toBe('https://example.com/a');
    const redacted = redactSensitiveUrl('https://example.com/?token=abc123&q=1');
    expect(redacted).not.toContain('abc123');
    expect(redacted).toContain('q=1');
  });
});
