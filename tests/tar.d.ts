/**
 * Minimal structural types for the `tar` package.
 *
 * `tar` ships no bundled types and the repository has no `@types/tar`
 * dependency, so only the surface actually used by backup create/restore is
 * declared here. This keeps both paths type-safe without adding a dependency.
 *
 * Installed tar is v7, whose listing API is Promise-based: `t()` resolves after
 * every header has been delivered through `onentry`.
 */
declare module 'tar' {
  import type { EventEmitter } from 'node:events';
  import type { Readable, Writable } from 'node:stream';

  export interface ReadEntry extends EventEmitter {
    path: string;
    type: 'File' | 'Directory' | 'Link' | 'SymbolicLink' | 'Other' | null;
    size?: number;
    resume(): void;
  }

  export interface WriteEntry {
    path: string;
    type?: string;
    size?: number;
    mode?: number;
    mtime?: Date;
    linkpath?: string;
  }

  export interface CreateOptions {
    gzip?: boolean;
    cwd?: string;
    portable?: boolean;
    preservePaths?: boolean;
    prefix?: string;
    filter?(entryPath: string, entry?: WriteEntry): boolean;
    onWriteEntry?(entry: WriteEntry): void;
  }

  /** Create a readable archive stream. */
  export function c(
    options?: CreateOptions,
    files?: readonly string[],
    cb?: (err?: Error) => void,
  ): Readable;

  export interface ListOptions {
    file?: string;
    cwd?: string;
    preservePaths?: boolean;
    strict?: boolean;
    onentry?(entry: ReadEntry): void;
    onwarn?(code: string, message: string, data?: unknown): void;
  }

  /**
   * Read archive headers. In tar v7 this returns a Promise that resolves after
   * every header has been delivered through `onentry`.
   */
  export function t(options: ListOptions): Promise<void>;

  export interface ExtractOptions {
    file?: string;
    cwd?: string;
    preservePaths?: boolean;
    strip?: number;
    filter?(entryPath: string, entry?: WriteEntry): boolean;
    onwarn?(code: string, message: string, data?: unknown): void;
  }

  /** Extract an archive into `cwd`. */
  export function extract(options: ExtractOptions): Promise<void>;

  const tar: {
    c: typeof c;
    t: typeof t;
    extract: typeof extract;
    default: typeof import('tar');
  };
  export default tar;
}