/**
 * conversation-resources.ts — turns what a message carries, beyond text and Tool
 * UI cards, into something the transcript can render.
 *
 * Every shape handled here has a producer or reader in `openclaw_runtime`:
 *
 *   - `{ type:'attachment', attachment:{ url, kind, label, mimeType, isVoiceNote } }`
 *     gateway/server-methods/chat-webchat-media.ts (audio) and the Control UI
 *     message normalizer (image / audio / video / document).
 *   - `{ type:'audio', source:{ type:'base64'|'url', media_type, data|url } }`
 *     Control UI `coerceAudioContentBlock`. History strips the base64 payload and
 *     leaves `source.omitted` (gateway/chat-display-projection.ts).
 *   - `{ type:'image', omitted:true, bytes }` the same projection, for flat `data`.
 *   - `{ type:'input_image', image_url }` chat-webchat-media.ts.
 *   - tool `details.attachments` / `details.media` / `details.audioPath`
 *     agents/tools/{music,video}-generate-tool.ts and tts-tool.ts.
 *
 * `{ type:'video' }` has no producer yet and is read through the same path as
 * audio purely as a compatibility layer.
 *
 * Audio, video and documents stay on `AttachedFileMeta` so `ChatMessage` keeps one
 * validation and folding input. `ConversationResource` only covers what that
 * carrier cannot express.
 */
import { evaluateExternalNavigationUrl } from '@shared/security/url-policy';
import { extnameOf, getMimeTypeForExt } from '@/lib/generated-files';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat/types';

export type ResourceLocation =
  | { kind: 'data'; url: string }
  | { kind: 'gateway'; url: string }
  | { kind: 'remote'; url: string }
  | { kind: 'path'; path: string };

export type ConversationImageResource = {
  kind: 'image';
  key: string;
  name?: string;
  mimeType?: string;
  /** Absent when history removed the bytes; `omitted` is then set. */
  url?: string;
  omitted?: boolean;
  bytes?: number;
};

export type ConversationLinkResource = {
  kind: 'website-link';
  key: string;
  url: string;
  title?: string;
  description?: string;
};

export type ConversationUnknownResource = {
  kind: 'unknown';
  key: string;
  type: string;
  title?: string;
  description?: string;
  /** Redacted for display and copying. */
  displayUrl?: string;
  /** Allowed by the external navigation policy; never rendered. */
  openUrl?: string;
  path?: string;
};

export type ConversationResource =
  | ConversationImageResource
  | ConversationLinkResource
  | ConversationUnknownResource;

export type MediaKind = 'audio' | 'video';

const GATEWAY_MEDIA_PREFIX = '/api/chat/media/';
const MEDIA_EXTENSIONS = 'mp3|wav|ogg|oga|opus|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
const TAGGED_MEDIA_RE = new RegExp(
  `(?:^|[\\s(\\[{>])(?:MEDIA|media):((?:\\/|~\\/|[A-Za-z]:\\\\)[^\\n"'()\\[\\],<>\`]*?\\.(?:${MEDIA_EXTENSIONS}))(?=$|[\\s\\n"'()\\[\\],<>\`]|[，。；;,.!?])`,
  'gi',
);
const ATTACHED_MEDIA_RE = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
/**
 * Absolute media paths in tool output, from whatever tool ran: unix, `~/`, Windows
 * with either slash, and JSON-escaped Windows. The lookbehind rejects URLs. The
 * length bound matters: tool results can hold megabytes of base64, which contains
 * `/`, and an unbounded run from each one would go quadratic on history load.
 */
const OUTPUT_MEDIA_PATH_RE = new RegExp(
  `(?<![\\w./:\\\\-])((?:[A-Za-z]:[\\\\/]|~[\\\\/]|/)[^\\s"'\`()\\[\\]{},<>|*?=:;]{0,1024}\\.(?:${MEDIA_EXTENSIONS}))(?![\\w-])`,
  'gi',
);
/** Workspace-relative artifacts a reply names. Binary outputs only: `README.md` is prose, not a resource. */
const RELATIVE_ARTIFACT_RE = new RegExp(
  `(?<![\\w./:\\\\~-])((?:\\.\\/)?[\\w.-]+(?:[\\\\/][\\w.-]+)*\\.(?:${MEDIA_EXTENSIONS}|png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?))(?![\\w/\\\\-])`,
  'gi',
);
const FENCED_CODE_RE = /```[\s\S]*?```/g;
/** Linear check that spares payloads with no media extension from the path regex. */
const MEDIA_EXTENSION_RE = new RegExp(`\\.(?:${MEDIA_EXTENSIONS})(?![\\w-])`, 'i');
/** File times can be coarser than message times; allow for that, not for older files. */
const PRODUCED_THIS_TURN_TOLERANCE_MS = 2_000;
const MAX_SCANNED_STRINGS = 200;
/** Anything longer is a payload, not tool output or prose that names a path. */
const MAX_SCANNED_STRING_CHARS = 256 * 1024;

/** Blocks that are process or text, never a resource of their own. */
const NON_RESOURCE_BLOCK_RE = /^(?:text|input_text|output_text|refusal)$|tool|function|thinking|reasoning|citation|compaction|signature/i;
const SENSITIVE_QUERY_KEY_RE = /token|key|secret|sig|password|passwd|pwd|auth|credential|session|code|access/i;

const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 280;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function firstText(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) return value;
  }
  return undefined;
}

export function classifyResourceUrl(raw: unknown): ResourceLocation | null {
  const value = asText(raw);
  if (!value) return null;
  if (/^data:/i.test(value)) return { kind: 'data', url: value };
  if (value.startsWith(GATEWAY_MEDIA_PREFIX)) return { kind: 'gateway', url: value };
  if (/^https?:\/\//i.test(value)) return { kind: 'remote', url: value };
  if (/^file:\/\//i.test(value)) {
    try {
      const pathname = decodeURIComponent(new URL(value).pathname);
      const path = /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
      return path ? { kind: 'path', path } : null;
    } catch {
      return null;
    }
  }
  // Protocol-relative and UNC forms are never local files we may read.
  if (/^(?:\/\/|\\\\)/.test(value)) return null;
  if (/^(?:\/|~[\\/]|[A-Za-z]:[\\/])/.test(value)) return { kind: 'path', path: value };
  return null;
}

function basename(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0] ?? value;
  return withoutQuery.split(/[\\/]/).pop() ?? '';
}

function nameFromLocation(location: ResourceLocation | null): string | undefined {
  if (!location) return undefined;
  if (location.kind === 'path') return basename(location.path) || undefined;
  if (location.kind === 'remote' || location.kind === 'gateway') return basename(location.url) || undefined;
  return undefined;
}

export function mimeFromPathName(name: string): string | undefined {
  const mime = getMimeTypeForExt(extnameOf(name));
  return mime === 'application/octet-stream' ? undefined : mime;
}

function mimeFromLocation(location: ResourceLocation | null): string | undefined {
  if (!location) return undefined;
  if (location.kind === 'data') return /^data:([^;,]+)/i.exec(location.url)?.[1]?.toLowerCase();
  return mimeFromPathName(location.kind === 'path' ? location.path : basename(location.url));
}

/** A MIME type for Main's image thumbnailer, which refuses anything not `image/*`. */
export function imageMimeFromLocation(location: ResourceLocation): string {
  const mime = mimeFromLocation(location);
  return mime?.startsWith('image/') ? mime : 'image/png';
}

export function mediaKindOf(file: Pick<AttachedFileMeta, 'mimeType'>): MediaKind | null {
  const mime = file.mimeType.toLowerCase();
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function normalizePathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(slashed) ? slashed.toLowerCase() : slashed;
}

/** Identity for "the same media": what would be read, not how it was named. */
export function mediaResourceKey(file: AttachedFileMeta): string | null {
  if (file.filePath) return `path:${normalizePathKey(file.filePath)}`;
  if (file.gatewayUrl) return `gateway:${file.gatewayUrl}`;
  if (file.remoteUrl) return `remote:${file.remoteUrl}`;
  if (file.preview?.startsWith('data:')) return `data:${file.preview.length}:${file.preview.slice(-64)}`;
  return null;
}

function mediaFileFromLocation(
  location: ResourceLocation | null,
  meta: {
    name?: string;
    mimeType: string;
    fileSize?: number;
    isVoiceNote?: boolean;
    source: NonNullable<AttachedFileMeta['source']>;
    producedAfter?: number;
  },
): AttachedFileMeta {
  return {
    fileName: meta.name || nameFromLocation(location) || (mediaKindOf(meta) ?? 'file'),
    mimeType: meta.mimeType,
    fileSize: meta.fileSize ?? 0,
    preview: location?.kind === 'data' ? location.url : null,
    source: meta.source,
    ...(location?.kind === 'path' ? { filePath: location.path } : {}),
    ...(location?.kind === 'gateway' ? { gatewayUrl: location.url } : {}),
    ...(location?.kind === 'remote' ? { remoteUrl: location.url } : {}),
    ...(meta.isVoiceNote ? { isVoiceNote: true } : {}),
    ...(meta.producedAfter != null ? { producedAfter: meta.producedAfter } : {}),
    // Nothing to read: the history projection dropped the bytes, or the location
    // cannot be resolved. The card reports that instead of disappearing.
    ...(location ? {} : { previewStatus: 'unavailable' as const }),
  };
}

function blockMediaLocation(block: Record<string, unknown>, mimeType: string): ResourceLocation | null {
  const source = isRecord(block.source) ? block.source : null;
  if (source) {
    const data = asText(source.data);
    if (source.type === 'base64' && data) {
      return { kind: 'data', url: data.startsWith('data:') ? data : `data:${mimeType};base64,${data}` };
    }
    const fromSource = classifyResourceUrl(source.url);
    if (fromSource) return fromSource;
  }
  for (const key of ['url', 'openUrl', 'audio_url', 'path', 'filePath', 'file_path']) {
    const location = classifyResourceUrl(block[key]);
    if (location) return location;
  }
  const flatData = asText(block.data);
  if (flatData) {
    return { kind: 'data', url: flatData.startsWith('data:') ? flatData : `data:${mimeType};base64,${flatData}` };
  }
  return null;
}

function blockBytes(block: Record<string, unknown>): number | undefined {
  const source = isRecord(block.source) ? block.source : null;
  const value = source?.bytes ?? block.bytes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Redact what a URL must not show: embedded credentials are removed and the
 * values of sensitive-looking query parameters are masked. Non-http(s) schemes
 * yield nothing to display, and only policy-approved URLs are offered for opening.
 */
export function sanitizeResourceUrl(raw: string): { displayUrl?: string; openUrl?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {};
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
  const policy = evaluateExternalNavigationUrl(raw);
  parsed.username = '';
  parsed.password = '';
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_QUERY_KEY_RE.test(key)) parsed.searchParams.set(key, '***');
  }
  return {
    displayUrl: parsed.toString(),
    ...(policy.ok ? { openUrl: policy.href } : {}),
  };
}

const reportedUnknownTypes = new Set<string>();

function reportUnknownResource(type: string, fields: string[]): void {
  if (reportedUnknownTypes.has(type)) return;
  reportedUnknownTypes.add(type);
  // Type and field names only: the payload may carry URLs or credentials.
  console.warn('[conversation-resources] unrecognized resource', { type, fields });
}

/**
 * Keep only the descriptive fields of an unrecognized payload. `requireIdentity`
 * is for content blocks, where a block with nothing to show is provider plumbing
 * rather than a resource; an explicit Tool UI fence is always meant for the user.
 */
export function toUnknownResource(
  payload: unknown,
  options: { key: string; fallbackType?: string; requireIdentity?: boolean },
): ConversationUnknownResource | null {
  if (!isRecord(payload)) return null;
  const preview = isRecord(payload.preview) ? payload.preview : {};
  const title = firstText(payload, ['title', 'name', 'label', 'fileName', 'filename', 'alt'])
    ?? firstText(preview, ['title', 'name', 'label']);
  const description = firstText(payload, ['description', 'summary', 'caption'])
    ?? firstText(preview, ['description', 'summary']);
  const rawLocation = firstText(payload, ['url', 'href', 'link', 'uri', 'openUrl', 'path', 'filePath', 'file_path'])
    ?? firstText(preview, ['url', 'href']);
  const location = classifyResourceUrl(rawLocation);
  if (options.requireIdentity && !title && !description && !location) return null;

  const rawType = firstText(payload, ['type', 'kind', 'component']) ?? options.fallbackType ?? 'unknown';
  const type = rawType.replace(/[^\w.:/-]/g, '').slice(0, 48) || 'unknown';
  reportUnknownResource(type, Object.keys(payload));
  return {
    kind: 'unknown',
    key: options.key,
    type,
    title: truncate(title, MAX_TITLE_CHARS),
    description: truncate(description, MAX_DESCRIPTION_CHARS),
    ...(location?.kind === 'remote' ? sanitizeResourceUrl(location.url) : {}),
    ...(location?.kind === 'path' ? { path: location.path } : {}),
  };
}

export type ContentBlockResources = {
  attachments: AttachedFileMeta[];
  resources: ConversationResource[];
};

/**
 * Project the content blocks no other extractor owns. `extractImages` keeps
 * resolvable images, so images are only taken here when they need the resolver
 * (Gateway, local, remote) or have lost their bytes.
 */
export function projectContentBlockResources(
  message: RawMessage,
  options: { isUser: boolean },
): ContentBlockResources {
  const attachments: AttachedFileMeta[] = [];
  const resources: ConversationResource[] = [];
  const content = message.content;
  if (!Array.isArray(content)) return { attachments, resources };

  content.forEach((raw: unknown, index) => {
    if (!isRecord(raw)) return;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const key = `block-${index}`;

    if (type === 'attachment') {
      const attachment = isRecord(raw.attachment) ? raw.attachment : null;
      if (!attachment) return;
      const kind = attachment.kind;
      const location = classifyResourceUrl(attachment.url);
      const name = asText(attachment.label);
      const declaredMime = asText(attachment.mimeType);
      if (kind === 'image') {
        resources.push({ kind: 'image', key, name, mimeType: declaredMime, url: asText(attachment.url) });
        return;
      }
      if (kind === 'audio' || kind === 'video') {
        attachments.push(mediaFileFromLocation(location, {
          name,
          mimeType: declaredMime ?? mimeFromLocation(location) ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4'),
          isVoiceNote: attachment.isVoiceNote === true,
          source: 'gateway-media',
        }));
        return;
      }
      if (kind === 'document' && location?.kind === 'path') {
        attachments.push(mediaFileFromLocation(location, {
          name,
          mimeType: declaredMime ?? mimeFromLocation(location) ?? 'application/octet-stream',
          source: 'gateway-media',
        }));
        return;
      }
      if (kind === 'document' && location?.kind === 'remote') {
        resources.push({ kind: 'website-link', key, url: location.url, title: name });
        return;
      }
      const unknown = toUnknownResource(attachment, { key, fallbackType: 'attachment' });
      if (unknown) resources.push(unknown);
      return;
    }

    if (type === 'audio' || type === 'input_audio' || type === 'video') {
      const fallbackMime = type === 'video' ? 'video/mp4' : 'audio/mpeg';
      const source = isRecord(raw.source) ? raw.source : {};
      const declared = asText(source.media_type) ?? asText(raw.mimeType);
      const location = blockMediaLocation(raw, declared ?? fallbackMime);
      attachments.push(mediaFileFromLocation(location, {
        name: firstText(raw, ['label', 'alt', 'title', 'fileName', 'filename']),
        mimeType: declared ?? mimeFromLocation(location) ?? fallbackMime,
        fileSize: blockBytes(raw),
        isVoiceNote: raw.isVoiceNote === true,
        source: 'gateway-media',
      }));
      return;
    }

    if (type === 'image') {
      const name = asText(raw.alt);
      const mimeType = asText(raw.mimeType);
      if (raw.omitted === true) {
        resources.push({ kind: 'image', key, name, mimeType, omitted: true, bytes: blockBytes(raw) });
        return;
      }
      const source = isRecord(raw.source) ? raw.source : null;
      if (source) {
        if (source.omitted === true) {
          resources.push({ kind: 'image', key, name, mimeType, omitted: true, bytes: blockBytes(raw) });
          return;
        }
        const url = asText(source.url);
        if (url && !isInlineImageUrl(url)) {
          resources.push({ kind: 'image', key, name, mimeType: asText(source.media_type) ?? mimeType, url });
        }
        return;
      }
      if (asText(raw.data)) return;
      const url = asText(raw.url);
      if (url) resources.push({ kind: 'image', key, name, mimeType, url });
      return;
    }

    if (type === 'input_image' || type === 'image_url') {
      const imageUrl = raw.image_url;
      const url = asText(imageUrl) ?? (isRecord(imageUrl) ? asText(imageUrl.url) : undefined);
      if (url && !isInlineImageUrl(url)) resources.push({ kind: 'image', key, url });
      return;
    }

    // Only the assistant's own output can be an unknown resource. User content
    // is either text or one of the upload shapes above.
    if (options.isUser || !type || NON_RESOURCE_BLOCK_RE.test(type)) return;
    const unknown = toUnknownResource(raw, { key, requireIdentity: true });
    if (unknown) resources.push(unknown);
  });

  return { attachments, resources };
}

/** A `src` the renderer may use as-is. Anything else needs Main or an explicit action. */
export function isInlineImageUrl(url: string): boolean {
  return /^(?:data:image\/|blob:)/i.test(url.trim());
}

/** Media that makes a message user-facing even with no visible text. */
export function isUserFacingMediaBlock(block: unknown): boolean {
  if (!isRecord(block)) return false;
  const type = block.type;
  if (type === 'attachment' || type === 'audio' || type === 'video' || type === 'input_image' || type === 'image_url') {
    return true;
  }
  return type === 'image' && Boolean(block.url || block.source || block.data || block.omitted);
}

export function messageHasUserFacingMedia(message: { content?: unknown }): boolean {
  return Array.isArray(message.content) && message.content.some(isUserFacingMediaBlock);
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

function collectStrings(value: unknown, into: string[], depth = 0): void {
  if (into.length >= MAX_SCANNED_STRINGS || depth > 5) return;
  if (typeof value === 'string') {
    if (value.length <= MAX_SCANNED_STRING_CHARS) into.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, into, depth + 1));
  } else if (isRecord(value)) {
    Object.values(value).forEach((entry) => collectStrings(entry, into, depth + 1));
  }
}

/**
 * Audio and video from a tool result. The artifact may come from any tool the turn
 * ran, including an external system the agent is driving, not only the runtime's
 * own generators.
 *
 *   - Declared media (`details.attachments`, `details.media`, `MEDIA:`) is `tool-media`
 *     and shown regardless, with an error state if the file is gone.
 *   - A path merely found in the output is `tool-result` and carries `producedAfter`,
 *     so `ChatMessage` can keep what this turn wrote and drop what `ls *.mp3` listed.
 */
export function extractToolResultMedia(input: {
  content?: unknown;
  details?: unknown;
  producedAfter?: number;
}): AttachedFileMeta[] {
  const files: AttachedFileMeta[] = [];
  const seen = new Set<string>();
  const push = (file: AttachedFileMeta) => {
    if (!mediaKindOf(file)) return;
    const key = mediaResourceKey(file);
    if (!key || seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  const details = isRecord(input.details) ? input.details : {};
  const media = isRecord(details.media) ? details.media : {};
  const isVoiceNote = media.audioAsVoice === true;

  const generated = [
    ...(Array.isArray(details.attachments) ? details.attachments : []),
    ...(Array.isArray(media.attachments) ? media.attachments : []),
  ];
  for (const entry of generated) {
    if (!isRecord(entry)) continue;
    const location = classifyResourceUrl(entry.path ?? entry.filePath ?? entry.url ?? entry.mediaUrl);
    if (!location) continue;
    const declaredType = entry.type === 'audio' || entry.type === 'video' ? entry.type : null;
    const mimeType = asText(entry.mimeType)
      ?? mimeFromLocation(location)
      ?? (declaredType === 'audio' ? 'audio/mpeg' : declaredType === 'video' ? 'video/mp4' : '');
    if (!mimeType) continue;
    push(mediaFileFromLocation(location, {
      name: asText(entry.name),
      mimeType,
      isVoiceNote,
      source: 'tool-media',
    }));
  }

  const declaredUrls = [
    ...(Array.isArray(media.mediaUrls) ? media.mediaUrls : []),
    media.mediaUrl,
    details.audioPath,
  ];
  for (const raw of declaredUrls) {
    const location = classifyResourceUrl(raw);
    const mimeType = mimeFromLocation(location);
    if (!location || !mimeType) continue;
    push(mediaFileFromLocation(location, { mimeType, isVoiceNote, source: 'tool-media' }));
  }

  const text = textOfContent(input.content);
  if (text) {
    for (const match of text.matchAll(TAGGED_MEDIA_RE)) {
      const location = classifyResourceUrl(match[1]);
      const mimeType = mimeFromLocation(location);
      if (location && mimeType) push(mediaFileFromLocation(location, { mimeType, source: 'tool-media' }));
    }
    for (const match of text.matchAll(ATTACHED_MEDIA_RE)) {
      const location = classifyResourceUrl(match[1]);
      if (location && match[2]) push(mediaFileFromLocation(location, { mimeType: match[2], source: 'tool-media' }));
    }
  }

  const outputStrings: string[] = [];
  collectStrings(input.content, outputStrings);
  collectStrings(input.details, outputStrings);
  for (const value of outputStrings) {
    if (!MEDIA_EXTENSION_RE.test(value)) continue;
    for (const match of value.matchAll(OUTPUT_MEDIA_PATH_RE)) {
      // JSON output escapes Windows separators.
      const location = classifyResourceUrl((match[1] ?? '').replace(/\\\\/g, '\\'));
      const mimeType = mimeFromLocation(location);
      if (!location || !mimeType) continue;
      push(mediaFileFromLocation(location, {
        mimeType,
        source: 'tool-result',
        producedAfter: input.producedAfter,
      }));
    }
  }

  return files;
}

/** True when a `tool-result` file was written during the turn that found it. */
export function isProducedThisTurn(file: Pick<AttachedFileMeta, 'producedAfter'>, mtime: number | undefined): boolean {
  if (file.producedAfter == null || mtime == null) return true;
  return mtime >= file.producedAfter - PRODUCED_THIS_TURN_TOLERANCE_MS;
}

/**
 * Binary artifacts a reply names by workspace-relative path, such as `out/speech.wav`.
 * These become `message-ref` candidates: `ChatMessage` joins them to the workspace
 * root and only shows the ones that exist, so prose costs nothing. Fenced code is
 * skipped because a command line names its inputs too.
 */
export function extractRelativeArtifactPaths(text: string): AttachedFileMeta[] {
  if (!text || text.length > MAX_SCANNED_STRING_CHARS) return [];
  const seen = new Set<string>();
  const files: AttachedFileMeta[] = [];
  for (const match of text.replace(FENCED_CODE_RE, ' ').matchAll(RELATIVE_ARTIFACT_RE)) {
    const relative = (match[1] ?? '').replace(/^\.\//, '');
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    const fileName = basename(relative);
    files.push({
      fileName,
      mimeType: mimeFromPathName(fileName) ?? 'application/octet-stream',
      fileSize: 0,
      preview: null,
      filePath: relative,
      source: 'message-ref',
    });
  }
  return files;
}

/** Join workspace-relative candidates to the root; without a root they cannot be checked. */
export function resolveWorkspaceRelativeFiles(
  files: AttachedFileMeta[],
  workspaceRoot: string | null | undefined,
): AttachedFileMeta[] {
  const root = workspaceRoot?.replace(/[\\/]+$/, '');
  const separator = root?.includes('\\') ? '\\' : '/';
  const seen = new Set<string>();
  const resolved: AttachedFileMeta[] = [];
  for (const file of files) {
    let next = file;
    const isRelative = file.filePath != null
      && !classifyResourceUrl(file.filePath)
      && !/^(?:\/\/|\\\\)/.test(file.filePath);
    if (isRelative && file.filePath) {
      if (!root) continue;
      next = { ...file, filePath: `${root}${separator}${file.filePath.replace(/[\\/]/g, separator)}` };
    }
    const key = next.filePath ? normalizePathKey(next.filePath) : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    resolved.push(next);
  }
  return resolved;
}

function isTurnBoundary(message: RawMessage): boolean {
  if (message.role !== 'user') return false;
  if (!Array.isArray(message.content)) return true;
  const blocks = message.content as Array<{ type?: string }>;
  return blocks.length === 0 || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
}

function toolCallArguments(message: RawMessage): unknown[] {
  const args: unknown[] = [];
  if (Array.isArray(message.content)) {
    for (const block of message.content as unknown[]) {
      if (isRecord(block) && (block.type === 'tool_use' || block.type === 'toolCall')) {
        args.push(block.input ?? block.arguments);
      }
    }
  }
  const record = message as unknown as Record<string, unknown>;
  const toolCalls = record.tool_calls ?? record.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      if (!isRecord(call)) continue;
      const fn = isRecord(call.function) ? call.function : call;
      args.push(fn.arguments ?? fn.input);
    }
  }
  return args;
}

/**
 * Give each turn's tool media to that turn's last visible assistant message: the
 * reply the user reads. Attaching to the next message instead would split one file
 * across a multi-step run, and lose it when a run ends on a tool result or on a
 * `NO_REPLY` turn that history then drops.
 *
 * Tool arguments count too: an output path may appear only in a command line, and
 * the freshness check keeps the inputs of that same command out.
 */
export function attachToolMediaToTurns(
  messages: RawMessage[],
  willBeDropped: (message: RawMessage) => boolean,
): RawMessage[] {
  const additions = new Map<number, AttachedFileMeta[]>();
  let turnMedia = new Map<string, AttachedFileMeta>();
  let turnOwner = -1;
  let turnStartMs: number | undefined;

  const collect = (files: AttachedFileMeta[]) => {
    for (const file of files) {
      const key = mediaResourceKey(file);
      if (!key) continue;
      // Declared beats merely found: it keeps a card even if the file later goes missing.
      if (!turnMedia.has(key) || file.source === 'tool-media') turnMedia.set(key, file);
    }
  };
  const closeTurn = () => {
    if (turnOwner >= 0 && turnMedia.size > 0) additions.set(turnOwner, Array.from(turnMedia.values()));
    turnMedia = new Map();
    turnOwner = -1;
  };

  messages.forEach((message, index) => {
    const role = String(message.role ?? '').toLowerCase();
    if (isTurnBoundary(message) && !willBeDropped(message)) {
      closeTurn();
      if (typeof message.timestamp === 'number') {
        turnStartMs = message.timestamp < 1e12 ? message.timestamp * 1000 : message.timestamp;
      }
    } else if (role === 'toolresult' || role === 'tool_result') {
      collect(extractToolResultMedia({ content: message.content, details: message.details, producedAfter: turnStartMs }));
    } else if (role === 'assistant') {
      for (const args of toolCallArguments(message)) {
        collect(extractToolResultMedia({ details: args, producedAfter: turnStartMs }));
      }
      if (!willBeDropped(message)) turnOwner = index;
    }
  });
  closeTurn();

  if (additions.size === 0) return messages;
  return messages.map((message, index) => {
    const files = additions.get(index);
    if (!files) return message;
    const existing = new Set((message._attachedFiles ?? []).map(mediaResourceKey));
    const added = files.filter((file) => !existing.has(mediaResourceKey(file)));
    return added.length > 0
      ? { ...message, _attachedFiles: [...(message._attachedFiles ?? []), ...added] }
      : message;
  });
}

function blockMediaKeys(message: RawMessage): string[] {
  return projectContentBlockResources(message, { isUser: message.role === 'user' }).attachments
    .map(mediaResourceKey)
    .filter((key): key is string => key != null);
}

function attachedMediaKeys(message: RawMessage): string[] {
  return (message._attachedFiles ?? [])
    .filter((file) => mediaKindOf(file))
    .map(mediaResourceKey)
    .filter((key): key is string => key != null);
}

/**
 * One visible owner per media resource in a turn. The same file commonly reaches
 * several messages at once: a tool result pends onto the next assistant message,
 * the final reply repeats it as `MEDIA:`, and the Gateway appends a bubble. The
 * user's upload owns its file; otherwise a Gateway content block does; otherwise
 * the latest message, which is the reply the user reads.
 */
export function dedupeConversationMedia(messages: RawMessage[]): RawMessage[] {
  const drop = new Map<number, Set<string>>();
  const dropFrom = (index: number, key: string) => {
    const keys = drop.get(index) ?? new Set<string>();
    keys.add(key);
    drop.set(index, keys);
  };

  let turnStart = 0;
  const flushTurn = (turnEnd: number) => {
    const userKeys = new Set<string>();
    const blockKeys = new Set<string>();
    for (let index = turnStart; index < turnEnd; index += 1) {
      const message = messages[index]!;
      if (message.role === 'user') attachedMediaKeys(message).forEach((key) => userKeys.add(key));
      blockMediaKeys(message).forEach((key) => blockKeys.add(key));
    }
    const owned = new Set<string>();
    for (let index = turnEnd - 1; index >= turnStart; index -= 1) {
      const message = messages[index]!;
      if (message.role !== 'assistant') continue;
      for (const key of attachedMediaKeys(message)) {
        if (userKeys.has(key) || blockKeys.has(key) || owned.has(key)) dropFrom(index, key);
        owned.add(key);
      }
    }
  };

  messages.forEach((message, index) => {
    if (isTurnBoundary(message) && index > turnStart) {
      flushTurn(index);
      turnStart = index;
    }
  });
  flushTurn(messages.length);

  if (drop.size === 0) return messages;
  return messages.map((message, index) => {
    const keys = drop.get(index);
    if (!keys) return message;
    return {
      ...message,
      _attachedFiles: (message._attachedFiles ?? []).filter((file) => {
        const key = mediaKindOf(file) ? mediaResourceKey(file) : null;
        return !key || !keys.has(key);
      }),
    };
  });
}
