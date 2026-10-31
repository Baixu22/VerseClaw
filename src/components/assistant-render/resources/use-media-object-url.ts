/**
 * Loads a local or Gateway media file into a Blob URL for a native player.
 *
 * Bytes only cross through `readBinaryFile`, which runs Main's read sandbox.
 * Gateway URLs are resolved by Main (`media.thumbnails`) to the file their record
 * points at, then read through the same path. The renderer never fetches a
 * Gateway URL and never uses `file://`.
 */
import { useCallback, useEffect, useState } from 'react';
import { readBinaryFile, statFile } from '@/lib/file-preview-client';
import { hostApi } from '@/lib/host-api';

/** Mirrors the main-process binary cap (`FILE_PREVIEW_MAX_BINARY_BYTES`). */
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
/** Above this a card asks before pulling the file into renderer memory. */
export const MEDIA_AUTOLOAD_MAX_BYTES = 16 * 1024 * 1024;

export type MediaLoadState =
  | { status: 'loading' }
  | { status: 'awaitingLoad'; size: number }
  | { status: 'ready'; url: string }
  | { status: 'tooLarge'; size?: number }
  | { status: 'notFound' }
  | { status: 'outsideSandbox' }
  | { status: 'failed' };

export type MediaSourceInput = {
  filePath?: string;
  gatewayUrl?: string;
  mimeType: string;
  /** Skip the size gate; the user asked for this file explicitly. */
  autoLoad?: boolean;
};

export type MediaObjectUrl = {
  state: MediaLoadState;
  size?: number;
  /** The file actually read; for Gateway media this comes from Main. */
  resolvedPath?: string;
  load: () => void;
  retry: () => void;
};

type StoredResult = {
  sourceKey: string;
  state: MediaLoadState;
  size?: number;
  resolvedPath?: string;
};

function stateForError(error: unknown, size?: number): MediaLoadState {
  if (error === 'notFound') return { status: 'notFound' };
  if (error === 'tooLarge') return { status: 'tooLarge', size };
  if (error === 'outsideSandbox') return { status: 'outsideSandbox' };
  return { status: 'failed' };
}

export function useMediaObjectUrl({ filePath, gatewayUrl, mimeType, autoLoad = false }: MediaSourceInput): MediaObjectUrl {
  const [loadRequested, setLoadRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<StoredResult | null>(null);
  const shouldRead = autoLoad || loadRequested;
  const sourceKey = [filePath ?? '', gatewayUrl ?? '', mimeType, shouldRead, attempt].join('\u0000');

  useEffect(() => {
    if (!filePath && !gatewayUrl) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    const publish = (state: MediaLoadState, size?: number, resolvedPath?: string) => {
      if (!cancelled) setStored({ sourceKey, state, size, resolvedPath });
    };

    void (async () => {
      let path = filePath;
      if (!path && gatewayUrl) {
        const thumbnails = await hostApi.media.thumbnails({ paths: [{ gatewayUrl, mimeType }] });
        path = thumbnails[gatewayUrl]?.resolvedPath;
      }
      if (cancelled) return;
      if (!path) {
        publish({ status: 'notFound' });
        return;
      }

      const stat = await statFile(path);
      if (cancelled) return;
      if (!stat.ok || stat.isFile === false) {
        publish(stateForError(stat.ok ? 'notFound' : stat.error), undefined, path);
        return;
      }
      const size = stat.size ?? 0;
      if (size > MEDIA_MAX_BYTES) {
        publish({ status: 'tooLarge', size }, size, path);
        return;
      }
      if (size > MEDIA_AUTOLOAD_MAX_BYTES && !shouldRead) {
        publish({ status: 'awaitingLoad', size }, size, path);
        return;
      }

      const result = await readBinaryFile(path, { maxBytes: MEDIA_MAX_BYTES });
      if (cancelled) return;
      if (!result.ok || !result.data) {
        publish(stateForError(result.error, result.size ?? size), result.size ?? size, path);
        return;
      }
      const bytes = new Uint8Array(result.data.byteLength);
      bytes.set(result.data);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      publish({ status: 'ready', url: objectUrl }, result.size ?? size, path);
    })().catch(() => publish({ status: 'failed' }));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attempt, filePath, gatewayUrl, mimeType, shouldRead, sourceKey]);

  const load = useCallback(() => setLoadRequested(true), []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current = stored?.sourceKey === sourceKey ? stored : null;

  return {
    state: current?.state ?? { status: 'loading' },
    size: current?.size,
    resolvedPath: current?.resolvedPath ?? filePath,
    load,
    retry,
  };
}
