import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readLinkPreview } from '../../electron/services/link-preview';

const { fetchPublic, pinHostname, destroy, decodeImage, resizeImage } = vi.hoisted(() => ({
  fetchPublic: vi.fn(),
  pinHostname: vi.fn(),
  destroy: vi.fn(),
  decodeImage: vi.fn(),
  resizeImage: vi.fn(),
}));

vi.mock('../../openclaw_runtime/src/infra/net/ssrf', () => ({ resolvePinnedHostname: pinHostname }));
vi.mock('undici', () => ({ fetch: fetchPublic, Agent: class { destroy = destroy; } }));
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: decodeImage } }));

function response(body: string, type: string) {
  return new Response(body, { headers: { 'content-type': type } });
}

beforeEach(() => {
  vi.clearAllMocks();
  pinHostname.mockResolvedValue({ lookup: vi.fn() });
  decodeImage.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 640, height: 320 }), resize: resizeImage });
  resizeImage.mockReturnValue({ toDataURL: () => 'data:image/png;base64,AAAA' });
});

describe('link metadata in Main', () => {
  it('keeps disallowed destinations and credential-like query values out of the preview request', async () => {
    for (const url of ['https://localhost/preview', 'file:///notes.txt', 'https://example.org/?access_token=fixture', 'https://example.org:8443/']) {
      expect(await readLinkPreview({ url })).toBeNull();
    }
    expect(fetchPublic).not.toHaveBeenCalled();
  });

  it('reads a favicon from the origin and shares the result across page paths', async () => {
    fetchPublic.mockResolvedValueOnce(response('raster', 'image/png'));
    const [first, second] = await Promise.all([
      readLinkPreview({ url: 'https://icons.example.org/topic?ref=fixture#one', mode: 'favicon' }),
      readLinkPreview({ url: 'https://icons.example.org/another-page', mode: 'favicon' }),
    ]);
    expect(first).toEqual({ favicon: 'data:image/png;base64,AAAA' });
    expect(second).toEqual(first);
    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(fetchPublic.mock.calls[0][0].href).toBe('https://icons.example.org/favicon.ico');
    expect(fetchPublic.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(pinHostname).toHaveBeenCalledWith('icons.example.org');
    expect(resizeImage).toHaveBeenCalledWith({ width: 32 });
  });

  it('uses a declared raster icon if the standard path is unavailable', async () => {
    fetchPublic.mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(response('<head><link rel="icon" href="/brand/logo.png"><meta property="og:image" content="/cover.png"></head>', 'text/html'))
      .mockResolvedValueOnce(response('raster', 'image/png'));
    expect(await readLinkPreview({ url: 'https://brand.example.org/private-path', mode: 'favicon' }))
      .toEqual({ favicon: 'data:image/png;base64,AAAA' });
    expect(fetchPublic.mock.calls.map(([url]) => url.href)).toEqual([
      'https://brand.example.org/favicon.ico', 'https://brand.example.org/', 'https://brand.example.org/brand/logo.png',
    ]);
  });

  it('uses the final page URL for a relative cover and preserves metadata when the image is unavailable', async () => {
    const page = response('<head><title>Default</title><meta property="og:title" content="Design &amp; layout"><meta name="description" content="A plain summary"><meta property="og:image" content="../cover.png"></head>', 'text/html; charset=utf-8');
    fetchPublic.mockResolvedValueOnce(Response.redirect('https://www.example.org/updated/guide')).mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('unavailable'));
    expect(await readLinkPreview({ url: 'https://example.org/preview-document' })).toEqual({
      title: 'Design & layout', description: 'A plain summary', thumbnail: undefined,
    });
    expect(fetchPublic.mock.calls[2][0].href).toBe('https://www.example.org/cover.png');
    expect(destroy).toHaveBeenCalledTimes(3);
  });

  it('validates redirect destinations before any subsequent read', async () => {
    fetchPublic.mockResolvedValueOnce(Response.redirect('https://localhost/preview'));
    expect(await readLinkPreview({ url: 'https://example.org/refused-redirect' })).toBeNull();
    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
