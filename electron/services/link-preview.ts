import { load } from 'cheerio/slim';
import { nativeImage } from 'electron';
import { Agent, fetch as fetchWithDispatcher, type Response } from 'undici';
import type { LinkPreviewResult } from '@shared/host-api/contract';
import { linkPreviewRequestUrl } from '@shared/security/link-preview';
import { resolvePinnedHostname } from '../../openclaw_runtime/src/infra/net/ssrf';
import { isRecord } from './payload-utils';

const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_ACTIVE_REQUESTS = 4;
const MAX_ACTIVE_ICONS = 8;
const MAX_HTML_BYTES = 192 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_ICON_BYTES = 64 * 1024;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ICON_TYPES = new Set([...RASTER_TYPES, 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico', 'application/octet-stream']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const cache = new Map<string, { preview: LinkPreviewResult; expiresAt: number }>();
const pendingPreviews = new Map<string, Promise<LinkPreviewResult>>();
const pendingIcons = new Map<string, Promise<LinkPreviewResult>>();

function cleanText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return;
  return value.replace(/\s+/g, ' ').replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '').trim().slice(0, limit) || undefined;
}

async function readBytes(response: Response, limit: number, allowPrefix: boolean): Promise<Buffer | null> {
  if (!response.body) return null;
  if (!allowPrefix && Number(response.headers.get('content-length')) > limit) return null;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      const capacity = limit - size;
      if (value.length > capacity) {
        if (!allowPrefix) return null;
        parts.push(value.subarray(0, capacity));
        return Buffer.concat(parts, limit);
      }
      parts.push(value);
      size += value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readPublicResource(
  url: URL,
  signal: AbortSignal,
  accept: string,
  types: ReadonlySet<string>,
  limit: number,
  allowPrefix = false,
) {
  let current = url;
  for (let hop = 0; hop <= 2; hop++) {
    signal.throwIfAborted();
    const pinned = await resolvePinnedHostname(current.hostname);
    signal.throwIfAborted();
    const dispatcher = new Agent({ connect: { lookup: pinned.lookup }, allowH2: false });
    let response: Response | undefined;
    try {
      response = await fetchWithDispatcher(current, {
        dispatcher,
        signal,
        redirect: 'manual',
        headers: { accept, 'user-agent': 'Verse-Claw-Link-Preview' },
      });
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        const next = location && linkPreviewRequestUrl(new URL(location, current).href);
        if (!next || (current.protocol === 'https:' && next.protocol !== 'https:')) return null;
        current = next;
        continue;
      }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      if (!response.ok || !types.has(contentType)) return null;
      const bytes = await readBytes(response, limit, allowPrefix);
      return bytes ? { bytes, finalUrl: current.href } : null;
    } finally {
      void response?.body?.cancel().catch(() => {});
      await dispatcher.destroy();
    }
  }
  return null;
}

async function readPreviewImage(rawUrl: unknown, base: string, signal: AbortSignal, favicon = false) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return;
  try {
    const url = linkPreviewRequestUrl(new URL(rawUrl, base).href);
    if (!url) return;
    const types = favicon ? ICON_TYPES : RASTER_TYPES;
    const image = await readPublicResource(url, signal, [...types].join(','), types, favicon ? MAX_ICON_BYTES : MAX_IMAGE_BYTES);
    if (!image) return;
    if (favicon && image.bytes.length >= 22 && image.bytes.readUInt32LE(0) === 0x00010000) {
      const entries = image.bytes.readUInt16LE(4);
      if (entries > 0 && 6 + entries * 16 <= image.bytes.length) {
        return 'data:image/x-icon;base64,' + image.bytes.toString('base64');
      }
    }
    const decoded = nativeImage.createFromBuffer(image.bytes);
    if (decoded.isEmpty()) return;
    const { width, height } = decoded.getSize();
    if (width * height > 16_000_000) return;
    const maxDimension = favicon ? 32 : 384;
    const scaled = Math.max(width, height) > maxDimension
      ? decoded.resize(width >= height ? { width: maxDimension } : { height: maxDimension })
      : decoded;
    return scaled.toDataURL();
  } catch {
    return;
  }
}

async function readWebsiteHead(url: URL, signal: AbortSignal, limit = MAX_HTML_BYTES) {
  const result = await readPublicResource(
    url, signal, 'text/html,application/xhtml+xml', HTML_TYPES, limit, true,
  );
  if (!result) return null;
  const html = result.bytes.toString('utf8');
  const headEnd = html.search(/<\/head\s*>/i);
  return { $: load(headEnd === -1 ? html : html.slice(0, headEnd + 7)), finalUrl: result.finalUrl };
}

async function readWebsiteIcon(origin: URL, signal: AbortSignal): Promise<LinkPreviewResult> {
  const standardIcon = new URL('/favicon.ico', origin).href;
  const direct = await readPreviewImage(standardIcon, origin.href, signal, true);
  if (direct) return { favicon: direct };
  const head = await readWebsiteHead(origin, signal, 32 * 1024);
  if (!head) return null;
  const declared = head.$('link[rel~="icon"]:not([type="image/svg+xml"]), link[rel~="apple-touch-icon"]').first().attr('href');
  if (!declared || new URL(declared, head.finalUrl).href === standardIcon) return null;
  const favicon = await readPreviewImage(declared, head.finalUrl, signal, true);
  return favicon ? { favicon } : null;
}

async function readWebsite(url: URL, signal: AbortSignal): Promise<LinkPreviewResult> {
  const head = await readWebsiteHead(url, signal);
  if (!head) return null;
  const { $, finalUrl } = head;
  const meta = (key: string) => $('meta[property="' + key + '"], meta[name="' + key + '"]').first().attr('content');
  const title = cleanText(meta('og:title') || meta('twitter:title') || $('title').first().text(), 160);
  const description = cleanText(meta('og:description') || meta('description') || meta('twitter:description'), 320);
  const thumbnail = await readPreviewImage(
    meta('og:image:secure_url') || meta('og:image') || meta('twitter:image'),
    finalUrl, signal,
  );
  return title || description || thumbnail ? { title, description, thumbnail } : null;
}

export async function readLinkPreview(payload: unknown): Promise<LinkPreviewResult> {
  if (!isRecord(payload)) return null;
  const url = linkPreviewRequestUrl(payload.url);
  if (!url) return null;
  const favicon = payload.mode === 'favicon';
  const key = favicon ? 'favicon:' + url.origin : url.href;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.preview;
  cache.delete(key);
  const pending = favicon ? pendingIcons : pendingPreviews;
  const active = pending.get(key);
  if (active) return active;
  if (pending.size >= (favicon ? MAX_ACTIVE_ICONS : MAX_ACTIVE_REQUESTS)) return null;

  const signal = AbortSignal.timeout(favicon ? 3500 : 6000);
  const request = (favicon ? readWebsiteIcon(new URL(url.origin), signal) : readWebsite(url, signal))
    .catch(() => null)
    .then(preview => {
      if (preview || favicon) {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { preview, expiresAt: Date.now() + (preview ? CACHE_TTL_MS : 60_000) });
      }
      return preview;
    })
    .finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}
