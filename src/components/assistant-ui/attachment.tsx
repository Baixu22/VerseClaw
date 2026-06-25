/**
 * Attachment primitives — local components that follow assistant-ui's
 * AttachmentPrimitive composition pattern (Root / Name / Remove / Thumb)
 * but accept props directly instead of reading from the assistant-ui
 * runtime/store. This keeps the compositional API consistent with
 * assistant-ui while integrating cleanly with the project's custom
 * FileAttachment / AttachedFileMeta data model and IPC staging flow.
 *
 * @see https://assistant-ui.com/docs/primitives/attachment
 */

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { forwardRef } from 'react';
import {
  File,
  FileArchive,
  FileText,
  Film,
  FolderOpen,
  Music,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const DIRECTORY_MIME_TYPE = 'application/x-directory';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === DIRECTORY_MIME_TYPE) return <FolderOpen className={className} />;
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

// ── AttachmentPrimitive.Root ──────────────────────────────────

type AttachmentRootProps = ComponentPropsWithoutRef<'div'> & {
  children?: ReactNode;
};

/**
 * Root container for an attachment. Mirrors AttachmentPrimitive.Root — a
 * plain div wrapper that groups Name / Remove / Thumb children.
 */
export const AttachmentRoot = forwardRef<HTMLDivElement, AttachmentRootProps>(
  function AttachmentRoot({ className, children, ...rest }, ref) {
    return (
      <div ref={ref} className={cn('relative group', className)} {...rest}>
        {children}
      </div>
    );
  },
);

// ── AttachmentPrimitive.Name ──────────────────────────────────

type AttachmentNameProps = {
  name: string;
  sublabel?: string;
  className?: string;
};

/**
 * Displays the attachment file name. Mirrors AttachmentPrimitive.Name but
 * accepts the name as a prop instead of reading from the store.
 */
export function AttachmentName({ name, sublabel, className }: AttachmentNameProps) {
  return (
    <div className={cn('min-w-0 overflow-hidden', className)}>
      <p className="truncate text-xs font-medium text-foreground">{name}</p>
      {sublabel ? <p className="truncate text-2xs text-muted-foreground">{sublabel}</p> : null}
    </div>
  );
}

// ── AttachmentPrimitive.Remove ─────────────────────────────────

type AttachmentRemoveProps = ComponentPropsWithoutRef<'button'> & {
  onRemove: () => void;
};

/**
 * Remove button for an attachment. Mirrors AttachmentPrimitive.Remove but
 * calls the provided onRemove callback instead of the store's remove action.
 */
export const AttachmentRemove = forwardRef<HTMLButtonElement, AttachmentRemoveProps>(
  function AttachmentRemove({ onRemove, className, onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity',
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(e);
          onRemove();
        }}
        {...rest}
      >
        <X className="h-3 w-3" />
      </button>
    );
  },
);

// ── AttachmentPrimitive.unstable_Thumb ────────────────────────

type AttachmentThumbProps = ComponentPropsWithoutRef<'div'> & {
  src?: string | null;
  alt?: string;
  fallback?: ReactNode;
};

/**
 * Thumbnail for an attachment. Mirrors AttachmentPrimitive.unstable_Thumb.
 * If src is provided, renders an <img>; otherwise renders the fallback
 * (typically a FileIcon).
 */
export const AttachmentThumb = forwardRef<HTMLDivElement, AttachmentThumbProps>(
  function AttachmentThumb({ src, alt, fallback, className, ...rest }, ref) {
    return (
      <div ref={ref} className={cn('overflow-hidden', className)} {...rest}>
        {src ? (
          <img src={src} alt={alt ?? ''} className="h-full w-full object-cover" />
        ) : (
          fallback ?? null
        )}
      </div>
    );
  },
);
