/**
 * 默认导航必须接 URL 守卫：拒危险 scheme / cloud metadata；本地 fixture 可用 file/data。
 */
import { describe, expect, it } from 'vitest';
import {
  assertAgentBrowserNavigateUrl,
  assertAllowedExternalNavigationUrl,
} from '../src/security/url-policy.ts';

describe('default navigate URL guard', () => {
  it('allows http/https', () => {
    expect(assertAgentBrowserNavigateUrl('https://example.com/a')).toContain('example.com');
    expect(assertAgentBrowserNavigateUrl('http://example.com/')).toContain('example.com');
  });

  it('rejects dangerous schemes for navigation', () => {
    expect(() => assertAgentBrowserNavigateUrl('javascript:alert(1)')).toThrow();
    expect(() => assertAgentBrowserNavigateUrl('vbscript:x')).toThrow();
    expect(() => assertAllowedExternalNavigationUrl('file:///etc/passwd')).toThrow();
  });

  it('allows local file/data documents for fixtures by default', () => {
    expect(assertAgentBrowserNavigateUrl('data:text/html,hi')).toContain('data:');
    expect(assertAgentBrowserNavigateUrl('file:///tmp/fixture.html')).toContain('file:');
  });

  it('strict mode rejects local documents', () => {
    expect(() =>
      assertAgentBrowserNavigateUrl('data:text/html,hi', { allowLocalDocuments: false }),
    ).toThrow();
  });

  it('blocks cloud metadata IP hosts', () => {
    expect(() => assertAgentBrowserNavigateUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      /metadata/iu,
    );
    expect(() => assertAgentBrowserNavigateUrl('http://100.100.100.200/')).toThrow();
  });

  it('blocks every literal shape of the metadata endpoints, not just the dotted quad', () => {
    // The plain IPv4 form is normalised by WHATWG URL, but an IPv4-mapped IPv6 literal keeps its
    // bracket form (`[::ffff:a9fe:a9fe]`), and a NAT64 (rfc6052) embedding keeps its own shape -
    // string equality on the three well-known addresses let those reach the same endpoint.
    for (const url of [
      'http://2852039166/',                     // decimal IPv4
      'http://0xA9FEA9FE/',                     // hex IPv4
      'http://[::ffff:169.254.169.254]/',       // IPv4-mapped IPv6, dotted tail
      'http://[::ffff:a9fe:a9fe]/',             // IPv4-mapped IPv6, hex tail
      'http://[fd00:ec2::254]/',                // EC2 IPv6 metadata
      'http://[::ffff:100.100.100.200]/',       // Alibaba metadata, mapped
      'http://[64:ff9b::100.100.100.200]/',     // NAT64 (rfc6052) embedding
    ]) {
      expect(() => assertAgentBrowserNavigateUrl(url), url).toThrow(/metadata/iu);
    }
    // Loopback and private literals stay navigable so local fixtures keep working.
    for (const url of ['http://127.0.0.1:8123/', 'http://10.0.0.5/', 'http://192.168.1.9/']) {
      expect(assertAgentBrowserNavigateUrl(url), url).toContain(url.slice(0, url.indexOf('/', 8)));
    }
  });

  it('does not treat hostname strings as blocked IPs', () => {
    expect(assertAgentBrowserNavigateUrl('https://example.com/')).toContain('example.com');
  });
});
