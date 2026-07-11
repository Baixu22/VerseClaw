/// <reference types="node" />
import { t as RequestInit$4 } from "../../index-CBBnpdoi.js";
import { Blob as Blob$1, File as File$1 } from "node:buffer";
import { URL as URL$1, URLSearchParams as URLSearchParams$1 } from "node:url";
import { Duplex, Readable, Writable } from "node:stream";
import { IpcNetConnectOpts, Socket, TcpNetConnectOpts } from "node:net";
import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ConnectionOptions, TLSSocket } from "node:tls";
import * as stream from "stream";
import { Readable as Readable$1 } from "stream";
import { EventEmitter as EventEmitter$1 } from "events";
import * as querystring from "querystring";
import { Agent, RequestOptions as RequestOptions$1 } from "http";
import { ReadableStream as ReadableStream$1 } from "stream/web";

//#region node_modules/.pnpm/formdata-polyfill@4.0.10/node_modules/formdata-polyfill/esm.min.d.ts
declare const FormData$3: {
  new (): FormData$3;
  prototype: FormData$3;
};
//#endregion
//#region node_modules/.pnpm/fetch-blob@3.2.0/node_modules/fetch-blob/index.d.ts
/** @type {typeof globalThis.Blob} */
declare const Blob$2: typeof globalThis.Blob;
//#endregion
//#region node_modules/.pnpm/node-fetch@3.3.2/node_modules/node-fetch/@types/index.d.ts
type AbortSignal$2 = {
  readonly aborted: boolean;
  addEventListener: (type: 'abort', listener: (this: AbortSignal$2) => void) => void;
  removeEventListener: (type: 'abort', listener: (this: AbortSignal$2) => void) => void;
};
type HeadersInit$5 = Headers$3 | Record<string, string> | Iterable<readonly [string, string]> | Iterable<Iterable<string>>;
/**
 * This Fetch API interface allows you to perform various actions on HTTP request and response headers.
 * These actions include retrieving, setting, adding to, and removing.
 * A Headers object has an associated header list, which is initially empty and consists of zero or more name and value pairs.
 * You can add to this using methods like append() (see Examples.)
 * In all methods of this interface, header names are matched by case-insensitive byte sequence.
 * */
declare class Headers$3 {
  constructor(init?: HeadersInit$5);
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(callbackfn: (value: string, key: string, parent: Headers$3) => void, thisArg?: any): void;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  /**
   * Returns an iterator allowing to go through all key/value pairs contained in this object.
   */
  entries(): IterableIterator<[string, string]>;
  /**
   * Returns an iterator allowing to go through all keys of the key/value pairs contained in this object.
   */
  keys(): IterableIterator<string>;
  /**
   * Returns an iterator allowing to go through all values of the key/value pairs contained in this object.
   */
  values(): IterableIterator<string>;
  /** Node-fetch extension */
  raw(): Record<string, string[]>;
}
interface RequestInit$3 {
  /**
   * A BodyInit object or null to set request's body.
   */
  body?: BodyInit$2 | null;
  /**
   * A Headers object, an object literal, or an array of two-item arrays to set request's headers.
   */
  headers?: HeadersInit$5;
  /**
   * A string to set request's method.
   */
  method?: string;
  /**
   * A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect.
   */
  redirect?: RequestRedirect$2;
  /**
   * An AbortSignal to set request's signal.
   */
  signal?: AbortSignal$2 | null;
  /**
   * A string whose value is a same-origin URL, "about:client", or the empty string, to set request’s referrer.
   */
  referrer?: string;
  /**
   * A referrer policy to set request’s referrerPolicy.
   */
  referrerPolicy?: ReferrerPolicy$2; // Node-fetch extensions to the whatwg/fetch spec
  agent?: RequestOptions$1['agent'] | ((parsedUrl: URL) => RequestOptions$1['agent']);
  compress?: boolean;
  counter?: number;
  follow?: number;
  hostname?: string;
  port?: number;
  protocol?: string;
  size?: number;
  highWaterMark?: number;
  insecureHTTPParser?: boolean;
}
type BodyInit$2 = Blob$2 | Buffer | URLSearchParams | FormData$3 | NodeJS.ReadableStream | string;
type RequestRedirect$2 = 'error' | 'follow' | 'manual';
type ReferrerPolicy$2 = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'same-origin' | 'origin' | 'strict-origin' | 'origin-when-cross-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/utility.d.ts
type AutocompletePrimitiveBaseType$1<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : never;
type Autocomplete$1<T> = T | (AutocompletePrimitiveBaseType$1<T> & Record<never, never>);
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/header.d.ts
/**
 * The header type declaration of `undici`.
 */
type IncomingHttpHeaders$1 = Record<string, string | string[] | undefined>;
/**
 * The header type declaration of `undici` for outgoing requests.
 */
type OutgoingHttpHeaders = Record<string, number | string | string[] | undefined>;
type HeaderNames$1 = Autocomplete$1<'Accept' | 'Accept-CH' | 'Accept-Charset' | 'Accept-Encoding' | 'Accept-Language' | 'Accept-Patch' | 'Accept-Post' | 'Accept-Ranges' | 'Access-Control-Allow-Credentials' | 'Access-Control-Allow-Headers' | 'Access-Control-Allow-Methods' | 'Access-Control-Allow-Origin' | 'Access-Control-Expose-Headers' | 'Access-Control-Max-Age' | 'Access-Control-Request-Headers' | 'Access-Control-Request-Method' | 'Age' | 'Allow' | 'Alt-Svc' | 'Alt-Used' | 'Authorization' | 'Cache-Control' | 'Clear-Site-Data' | 'Connection' | 'Content-Disposition' | 'Content-Encoding' | 'Content-Language' | 'Content-Length' | 'Content-Location' | 'Content-Range' | 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' | 'Content-Type' | 'Cookie' | 'Cross-Origin-Embedder-Policy' | 'Cross-Origin-Opener-Policy' | 'Cross-Origin-Resource-Policy' | 'Date' | 'Device-Memory' | 'ETag' | 'Expect' | 'Expect-CT' | 'Expires' | 'Forwarded' | 'From' | 'Host' | 'If-Match' | 'If-Modified-Since' | 'If-None-Match' | 'If-Range' | 'If-Unmodified-Since' | 'Keep-Alive' | 'Last-Modified' | 'Link' | 'Location' | 'Max-Forwards' | 'Origin' | 'Permissions-Policy' | 'Priority' | 'Proxy-Authenticate' | 'Proxy-Authorization' | 'Range' | 'Referer' | 'Referrer-Policy' | 'Retry-After' | 'Sec-Fetch-Dest' | 'Sec-Fetch-Mode' | 'Sec-Fetch-Site' | 'Sec-Fetch-User' | 'Sec-Purpose' | 'Sec-WebSocket-Accept' | 'Server' | 'Server-Timing' | 'Service-Worker-Navigation-Preload' | 'Set-Cookie' | 'SourceMap' | 'Strict-Transport-Security' | 'TE' | 'Timing-Allow-Origin' | 'Trailer' | 'Transfer-Encoding' | 'Upgrade' | 'Upgrade-Insecure-Requests' | 'User-Agent' | 'Vary' | 'Via' | 'WWW-Authenticate' | 'X-Content-Type-Options' | 'X-Frame-Options'>;
type IANARegisteredMimeType$1 = Autocomplete$1<'audio/aac' | 'video/x-msvideo' | 'image/avif' | 'video/av1' | 'application/octet-stream' | 'image/bmp' | 'text/css' | 'text/csv' | 'application/vnd.ms-fontobject' | 'application/epub+zip' | 'image/gif' | 'application/gzip' | 'text/html' | 'image/x-icon' | 'text/calendar' | 'image/jpeg' | 'text/javascript' | 'application/json' | 'application/ld+json' | 'audio/x-midi' | 'audio/mpeg' | 'video/mp4' | 'video/mpeg' | 'audio/ogg' | 'video/ogg' | 'application/ogg' | 'audio/opus' | 'font/otf' | 'application/pdf' | 'image/png' | 'application/rtf' | 'image/svg+xml' | 'image/tiff' | 'video/mp2t' | 'font/ttf' | 'text/plain' | 'application/wasm' | 'video/webm' | 'audio/webm' | 'image/webp' | 'font/woff' | 'font/woff2' | 'application/xhtml+xml' | 'application/xml' | 'application/zip' | 'video/3gpp' | 'video/3gpp2' | 'model/gltf+json' | 'model/gltf-binary'>;
type KnownHeaderValues$1 = {
  'content-type': IANARegisteredMimeType$1;
};
type HeaderRecord$1 = { [K in HeaderNames$1 | Lowercase<HeaderNames$1>]?: Lowercase<K> extends keyof KnownHeaderValues$1 ? KnownHeaderValues$1[Lowercase<K>] : string };
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/readable.d.ts
declare class BodyReadable$1 extends Readable {
  constructor(opts: {
    resume: (this: Readable, size: number) => void | null;
    abort: () => void | null;
    contentType?: string;
    contentLength?: number;
    highWaterMark?: number;
  });
  /** Consumes and returns the body as a string
   *  https://fetch.spec.whatwg.org/#dom-body-text
   */
  text(): Promise<string>;
  /** Consumes and returns the body as a JavaScript Object
   *  https://fetch.spec.whatwg.org/#dom-body-json
   */
  json(): Promise<unknown>;
  /** Consumes and returns the body as a Blob
   *  https://fetch.spec.whatwg.org/#dom-body-blob
   */
  blob(): Promise<Blob$1>;
  /** Consumes and returns the body as an Uint8Array
   *  https://fetch.spec.whatwg.org/#dom-body-bytes
   */
  bytes(): Promise<Uint8Array>;
  /** Consumes and returns the body as an ArrayBuffer
   *  https://fetch.spec.whatwg.org/#dom-body-arraybuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Not implemented
   *
   *  https://fetch.spec.whatwg.org/#dom-body-formdata
   */
  formData(): Promise<never>;
  /** Returns true if the body is not null and the body has been consumed
   *
   *  Otherwise, returns false
   *
   * https://fetch.spec.whatwg.org/#dom-body-bodyused
   */
  readonly bodyUsed: boolean;
  /**
   * If body is null, it should return null as the body
   *
   *  If body is not null, should return the body as a ReadableStream
   *
   *  https://fetch.spec.whatwg.org/#dom-body-body
   */
  readonly body: never | undefined;
  /** Dumps the response body by reading `limit` number of bytes.
   * @param opts.limit Number of bytes to read (optional) - Default: 131072
   * @param opts.signal AbortSignal to cancel the operation (optional)
   */
  dump(opts?: {
    limit: number;
    signal?: AbortSignal;
  }): Promise<void>;
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/fetch.d.ts
type BodyInit$1 = ArrayBuffer | AsyncIterable<Uint8Array> | Blob$1 | FormData$2 | Iterable<Uint8Array> | NodeJS.ArrayBufferView | URLSearchParams$1 | null | string;
interface SpecIterator$1<T, TReturn = any, TNext = undefined> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
}
interface SpecIteratorObject<T, TReturn = undefined, TNext = unknown> extends SpecIterator$1<T, TReturn, TNext> {
  [Symbol.iterator](): SpecIteratorObject<T, TReturn, TNext>;
  map<U>(callbackfn: (value: T, index: number) => U): SpecIteratorObject<U>;
  filter<S extends T>(predicate: (value: T, index: number) => value is S): SpecIteratorObject<S>;
  filter(predicate: (value: T, index: number) => unknown): SpecIteratorObject<T>;
  take(limit: number): SpecIteratorObject<T>;
  drop(count: number): SpecIteratorObject<T>;
  flatMap<U>(callbackfn: (value: T, index: number) => Iterator<U> | Iterable<U>): SpecIteratorObject<U>;
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T): T;
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number) => T, initialValue: T): T;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U): U;
  toArray(): T[];
  forEach(callbackfn: (value: T, index: number) => void): void;
  some(predicate: (value: T, index: number) => unknown): boolean;
  every(predicate: (value: T, index: number) => unknown): boolean;
  find<S extends T>(predicate: (value: T, index: number) => value is S): S | undefined;
  find(predicate: (value: T, index: number) => unknown): T | undefined;
  readonly [Symbol.toStringTag]: string;
}
interface SpecIterableIterator$1<T> extends SpecIteratorObject<T> {
  [Symbol.iterator](): SpecIterableIterator$1<T>;
}
interface SpecIterable$1<T> {
  [Symbol.iterator](): SpecIterableIterator$1<T>;
}
type HeadersInit$4 = [string, string][] | HeaderRecord$1 | Headers$2;
declare class Headers$2 implements SpecIterable$1<[string, string]> {
  constructor(init?: HeadersInit$4);
  readonly append: (name: string, value: string) => void;
  readonly delete: (name: string) => void;
  readonly get: (name: string) => string | null;
  readonly has: (name: string) => boolean;
  readonly set: (name: string, value: string) => void;
  readonly getSetCookie: () => string[];
  readonly forEach: (callbackfn: (value: string, key: string, iterable: Headers$2) => void, thisArg?: unknown) => void;
  readonly keys: () => SpecIterableIterator$1<string>;
  readonly values: () => SpecIterableIterator$1<string>;
  readonly entries: () => SpecIterableIterator$1<[string, string]>;
  readonly [Symbol.iterator]: () => SpecIterableIterator$1<[string, string]>;
}
type RequestCache$1 = 'default' | 'force-cache' | 'no-cache' | 'no-store' | 'only-if-cached' | 'reload';
type RequestCredentials$1 = 'omit' | 'include' | 'same-origin';
interface RequestInit$2 {
  body?: BodyInit$1 | null;
  cache?: RequestCache$1;
  credentials?: RequestCredentials$1;
  dispatcher?: Dispatcher$1;
  duplex?: RequestDuplex$1;
  headers?: HeadersInit$4;
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: RequestMode$1;
  redirect?: RequestRedirect$1;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy$1;
  signal?: AbortSignal | null;
  window?: null;
}
type ReferrerPolicy$1 = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';
type RequestMode$1 = 'cors' | 'navigate' | 'no-cors' | 'same-origin';
type RequestRedirect$1 = 'error' | 'follow' | 'manual';
type RequestDuplex$1 = 'half';
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/formdata.d.ts
/**
 * A `string` or `File` that represents a single value from a set of `FormData` key-value pairs.
 */
declare type FormDataEntryValue$1 = string | File$1;
/**
 * Provides a way to easily construct a set of key/value pairs representing form fields and their values, which can then be easily sent using fetch().
 */
declare class FormData$2 {
  /**
   * Appends a new value onto an existing key inside a FormData object,
   * or adds the key if it does not already exist.
   *
   * The difference between `set()` and `append()` is that if the specified key already exists, `set()` will overwrite all existing values with the new one, whereas `append()` will append the new value onto the end of the existing set of values.
   *
   * @param name The name of the field whose data is contained in `value`.
   * @param value The field's value. This can be [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
    or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File). If none of these are specified the value is converted to a string.
   * @param fileName The filename reported to the server, when a Blob or File is passed as the second parameter. The default filename for Blob objects is "blob". The default filename for File objects is the file's filename.
   */
  append(name: string, value: unknown, fileName?: string): void;
  /**
   * Set a new value for an existing key inside FormData,
   * or add the new field if it does not already exist.
   *
   * @param name The name of the field whose data is contained in `value`.
   * @param value The field's value. This can be [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
    or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File). If none of these are specified the value is converted to a string.
   * @param fileName The filename reported to the server, when a Blob or File is passed as the second parameter. The default filename for Blob objects is "blob". The default filename for File objects is the file's filename.
   *
   */
  set(name: string, value: unknown, fileName?: string): void;
  /**
   * Returns the first value associated with a given key from within a `FormData` object.
   * If you expect multiple values and want all of them, use the `getAll()` method instead.
   *
   * @param {string} name A name of the value you want to retrieve.
   *
   * @returns A `FormDataEntryValue` containing the value. If the key doesn't exist, the method returns null.
   */
  get(name: string): FormDataEntryValue$1 | null;
  /**
   * Returns all the values associated with a given key from within a `FormData` object.
   *
   * @param {string} name A name of the value you want to retrieve.
   *
   * @returns An array of `FormDataEntryValue` whose key matches the value passed in the `name` parameter. If the key doesn't exist, the method returns an empty list.
   */
  getAll(name: string): FormDataEntryValue$1[];
  /**
   * Returns a boolean stating whether a `FormData` object contains a certain key.
   *
   * @param name A string representing the name of the key you want to test for.
   *
   * @return A boolean value.
   */
  has(name: string): boolean;
  /**
   * Deletes a key and its value(s) from a `FormData` object.
   *
   * @param name The name of the key you want to delete.
   */
  delete(name: string): void;
  /**
   * Executes given callback function for each field of the FormData instance
   */
  forEach: (callbackfn: (value: FormDataEntryValue$1, key: string, iterable: FormData$2) => void, thisArg?: unknown) => void;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through all keys contained in this `FormData` object.
   * Each key is a `string`.
   */
  keys: () => SpecIterableIterator$1<string>;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through all values contained in this object `FormData` object.
   * Each value is a [`FormDataValue`](https://developer.mozilla.org/en-US/docs/Web/API/FormDataEntryValue).
   */
  values: () => SpecIterableIterator$1<FormDataEntryValue$1>;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through the `FormData` key/value pairs.
   * The key of each pair is a string; the value is a [`FormDataValue`](https://developer.mozilla.org/en-US/docs/Web/API/FormDataEntryValue).
   */
  entries: () => SpecIterableIterator$1<[string, FormDataEntryValue$1]>;
  /**
   * An alias for FormData#entries()
   */
  [Symbol.iterator]: () => SpecIterableIterator$1<[string, FormDataEntryValue$1]>;
  readonly [Symbol.toStringTag]: string;
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/connector.d.ts
declare function buildConnector$1(options?: buildConnector$1.BuildOptions): buildConnector$1.connector;
declare namespace buildConnector$1 {
  export type BuildOptions = (ConnectionOptions | TcpNetConnectOpts | IpcNetConnectOpts) & {
    allowH2?: boolean;
    maxCachedSessions?: number | null;
    socketPath?: string | null;
    timeout?: number | null;
    port?: number;
    keepAlive?: boolean | null;
    keepAliveInitialDelay?: number | null;
    typeOfService?: number | null;
  };
  export interface Options {
    hostname: string;
    host?: string;
    protocol: string;
    port: string;
    servername?: string;
    localAddress?: string | null;
    socketPath?: string | null;
    httpSocket?: Socket;
  }
  export type Callback = (...args: CallbackArgs) => void;
  type CallbackArgs = [null, Socket | TLSSocket] | [Error, null];
  export interface connector {
    (options: buildConnector$1.Options, callback: buildConnector$1.Callback): void;
  }
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/client-stats.d.ts
declare class ClientStats$1 {
  constructor(pool: Client$2);
  /** If socket has open connection. */
  connected: boolean;
  /** Number of open socket connections in this client that do not have an active request. */
  pending: number;
  /** Number of currently active requests of this client. */
  running: number;
  /** Number of active, pending, or queued requests of this client. */
  size: number;
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/client.d.ts
type ClientConnectOptions$1<TOpaque = null> = Omit<Dispatcher$1.ConnectOptions<TOpaque>, 'origin'>;
/**
 * A basic HTTP/1.1 client, mapped on top a single TCP/TLS connection. Pipelining is disabled by default.
 */
declare class Client$2 extends Dispatcher$1 {
  constructor(url: string | URL$1, options?: Client$2.Options);
  /** Property to get and set the pipelining factor. */
  pipelining: number;
  /** `true` after `client.close()` has been called. */
  closed: boolean;
  /** `true` after `client.destroyed()` has been called or `client.close()` has been called and the client shutdown has completed. */
  destroyed: boolean;
  /** Aggregate stats for a Client. */
  readonly stats: ClientStats$1; // Override dispatcher APIs.
  override connect<TOpaque = null>(options: ClientConnectOptions$1<TOpaque>): Promise<Dispatcher$1.ConnectData<TOpaque>>;
  override connect<TOpaque = null>(options: ClientConnectOptions$1<TOpaque>, callback: (err: Error | null, data: Dispatcher$1.ConnectData<TOpaque>) => void): void;
}
declare namespace Client$2 {
  export interface Options {
    /** The maximum length of request headers in bytes. Default: Node.js' `--max-http-header-size` or `16384` (16KiB). */
    maxHeaderSize?: number;
    /** The amount of time, in milliseconds, the parser will wait to receive the complete HTTP headers (Node 14 and above only). Default: `300e3` milliseconds (300s). */
    headersTimeout?: number;
    /** @deprecated unsupported socketTimeout, use headersTimeout & bodyTimeout instead */
    socketTimeout?: never;
    /** @deprecated unsupported requestTimeout, use headersTimeout & bodyTimeout instead */
    requestTimeout?: never;
    /** The timeout for establishing a socket connection, in milliseconds. Use `0` to disable it entirely. Default: `10e3` milliseconds (10s). */
    connectTimeout?: number;
    /** The timeout after which a request will time out, in milliseconds. Monitors time between receiving body data. Use `0` to disable it entirely. Default: `300e3` milliseconds (300s). */
    bodyTimeout?: number;
    /** @deprecated unsupported idleTimeout, use keepAliveTimeout instead */
    idleTimeout?: never;
    /** @deprecated unsupported keepAlive, use pipelining=0 instead */
    keepAlive?: never;
    /** the timeout, in milliseconds, after which a socket without active requests will time out. Monitors time between activity on a connected socket. This value may be overridden by *keep-alive* hints from the server. Default: `4e3` milliseconds (4s). */
    keepAliveTimeout?: number;
    /** @deprecated unsupported maxKeepAliveTimeout, use keepAliveMaxTimeout instead */
    maxKeepAliveTimeout?: never;
    /** the maximum allowed `idleTimeout`, in milliseconds, when overridden by *keep-alive* hints from the server. Default: `600e3` milliseconds (10min). */
    keepAliveMaxTimeout?: number;
    /** A number of milliseconds subtracted from server *keep-alive* hints when overriding `idleTimeout` to account for timing inaccuracies caused by e.g. transport latency. Default: `1e3` milliseconds (1s). */
    keepAliveTimeoutThreshold?: number;
    /** An IPC endpoint, either a Unix domain socket or Windows named pipe. Default: `null`. */
    socketPath?: string;
    /** The amount of concurrent requests to be sent over the single TCP/TLS connection according to [RFC7230](https://tools.ietf.org/html/rfc7230#section-6.3.2). Default: `1`. */
    pipelining?: number;
    /** @deprecated use the connect option instead */
    tls?: never;
    /** If `true`, an error is thrown when the request content-length header doesn't match the length of the request body. Default: `true`. */
    strictContentLength?: boolean;
    /** Maximum number of TLS cached sessions used by the built-in connector. Use `0` to disable TLS session caching. Default: `100`. */
    maxCachedSessions?: number;
    /** Connector options passed to `buildConnector`, or a custom connector function. Default: `null`. */
    connect?: Partial<buildConnector$1.BuildOptions> | buildConnector$1.connector;
    /** The maximum number of requests to send over a single connection before it is reset. Use `0` to disable this limit. Default: `null`. */
    maxRequestsPerClient?: number;
    /** Local IP address the socket should connect from. */
    localAddress?: string;
    /** Max response body size in bytes, -1 is disabled */
    maxResponseSize?: number;
    /** WebSocket-specific options */
    webSocket?: Client$2.WebSocketOptions;
    /** Enables a family autodetection algorithm that loosely implements section 5 of RFC 8305. */
    autoSelectFamily?: boolean;
    /** The amount of time in milliseconds to wait for a connection attempt to finish before trying the next address when using the `autoSelectFamily` option. */
    autoSelectFamilyAttemptTimeout?: number;
    /**
     * @description Enables support for H2 if the server has assigned bigger priority to it through ALPN negotiation.
     * @default true
     */
    allowH2?: boolean;
    /**
     * @description Dictates the maximum number of concurrent streams for a single H2 session. It can be overridden by a SETTINGS remote frame.
     * @default 100
     */
    maxConcurrentStreams?: number;
    /**
     * @description Sets the HTTP/2 stream-level flow-control window size (SETTINGS_INITIAL_WINDOW_SIZE).
     * @default 262144
     */
    initialWindowSize?: number;
    /**
     * @description Sets the HTTP/2 connection-level flow-control window size (ClientHttp2Session.setLocalWindowSize).
     * @default 524288
     */
    connectionWindowSize?: number;
    /**
     * @description Time interval between PING frames dispatch
     * @default 60000
     */
    pingInterval?: number;
  }
  export interface SocketInfo {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    remoteFamily?: string;
    timeout?: number;
    bytesWritten?: number;
    bytesRead?: number;
  }
  export interface WebSocketOptions {
    /**
     * Maximum allowed payload size in bytes for WebSocket messages.
     * Applied to uncompressed messages, compressed frame payloads, and decompressed (permessage-deflate) messages.
     * Set to 0 to disable the limit.
     * @default 134217728 (128 MB)
     */
    maxPayloadSize?: number;
  }
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/errors.d.ts
declare namespace Errors$2 {
  export class UndiciError extends Error {
    name: string;
    code: string;
  }
  /** Connect timeout error. */
  export class ConnectTimeoutError extends UndiciError {
    name: 'ConnectTimeoutError';
    code: 'UND_ERR_CONNECT_TIMEOUT';
  }
  /** A header exceeds the `headersTimeout` option. */
  export class HeadersTimeoutError extends UndiciError {
    name: 'HeadersTimeoutError';
    code: 'UND_ERR_HEADERS_TIMEOUT';
  }
  /** Headers overflow error. */
  export class HeadersOverflowError extends UndiciError {
    name: 'HeadersOverflowError';
    code: 'UND_ERR_HEADERS_OVERFLOW';
  }
  /** A body exceeds the `bodyTimeout` option. */
  export class BodyTimeoutError extends UndiciError {
    name: 'BodyTimeoutError';
    code: 'UND_ERR_BODY_TIMEOUT';
  }
  export class ResponseError extends UndiciError {
    constructor(message: string, code: number, options: {
      headers?: IncomingHttpHeaders$1 | string[] | null;
      body?: null | Record<string, any> | string;
    });
    name: 'ResponseError';
    code: 'UND_ERR_RESPONSE';
    statusCode: number;
    body: null | Record<string, any> | string;
    headers: IncomingHttpHeaders$1 | string[] | null;
  }
  /** Passed an invalid argument. */
  export class InvalidArgumentError extends UndiciError {
    name: 'InvalidArgumentError';
    code: 'UND_ERR_INVALID_ARG';
  }
  /** Returned an invalid value. */
  export class InvalidReturnValueError extends UndiciError {
    name: 'InvalidReturnValueError';
    code: 'UND_ERR_INVALID_RETURN_VALUE';
  }
  /** The request has been aborted by the user. */
  export class RequestAbortedError extends UndiciError {
    name: 'AbortError';
    code: 'UND_ERR_ABORTED';
  }
  /** Expected error with reason. */
  export class InformationalError extends UndiciError {
    name: 'InformationalError';
    code: 'UND_ERR_INFO';
  }
  /** Request body length does not match content-length header. */
  export class RequestContentLengthMismatchError extends UndiciError {
    name: 'RequestContentLengthMismatchError';
    code: 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH';
  }
  /** Response body length does not match content-length header. */
  export class ResponseContentLengthMismatchError extends UndiciError {
    name: 'ResponseContentLengthMismatchError';
    code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH';
  }
  /** Trying to use a destroyed client. */
  export class ClientDestroyedError extends UndiciError {
    name: 'ClientDestroyedError';
    code: 'UND_ERR_DESTROYED';
  }
  /** Trying to use a closed client. */
  export class ClientClosedError extends UndiciError {
    name: 'ClientClosedError';
    code: 'UND_ERR_CLOSED';
  }
  /** There is an error with the socket. */
  export class SocketError extends UndiciError {
    name: 'SocketError';
    code: 'UND_ERR_SOCKET';
    socket: Client$2.SocketInfo | null;
  }
  /** Encountered unsupported functionality. */
  export class NotSupportedError extends UndiciError {
    name: 'NotSupportedError';
    code: 'UND_ERR_NOT_SUPPORTED';
  }
  /** No upstream has been added to the BalancedPool. */
  export class BalancedPoolMissingUpstreamError extends UndiciError {
    name: 'MissingUpstreamError';
    code: 'UND_ERR_BPL_MISSING_UPSTREAM';
  }
  export class HTTPParserError extends UndiciError {
    name: 'HTTPParserError';
    code: string;
  }
  /** The response exceed the length allowed. */
  export class ResponseExceededMaxSizeError extends UndiciError {
    name: 'ResponseExceededMaxSizeError';
    code: 'UND_ERR_RES_EXCEEDED_MAX_SIZE';
  }
  export class RequestRetryError extends UndiciError {
    constructor(message: string, statusCode: number, headers?: IncomingHttpHeaders$1 | string[] | null, body?: null | Record<string, any> | string);
    name: 'RequestRetryError';
    code: 'UND_ERR_REQ_RETRY';
    statusCode: number;
    data: {
      count: number;
    };
    headers: Record<string, string | string[]>;
  }
  export class SecureProxyConnectionError extends UndiciError {
    constructor(cause?: Error, message?: string, options?: Record<any, any>);
    name: 'SecureProxyConnectionError';
    code: 'UND_ERR_PRX_TLS';
  }
  export class MaxOriginsReachedError extends UndiciError {
    name: 'MaxOriginsReachedError';
    code: 'UND_ERR_MAX_ORIGINS_REACHED';
  }
  /** SOCKS5 proxy related error. */
  export class Socks5ProxyError extends UndiciError {
    constructor(message?: string, code?: string);
    name: 'Socks5ProxyError';
    code: string;
  }
  /** WebSocket decompressed message exceeded maximum size. */
  export class MessageSizeExceededError extends UndiciError {
    name: 'MessageSizeExceededError';
    code: 'UND_ERR_WS_MESSAGE_SIZE_EXCEEDED';
  }
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/dispatcher.d.ts
type UndiciHeaders$1 = OutgoingHttpHeaders | string[] | Iterable<[string, string | string[] | undefined]> | null;
/** Dispatcher is the core API used to dispatch requests. */
declare class Dispatcher$1 extends EventEmitter {
  /** Dispatches a request. This API is expected to evolve through semver-major versions and is less stable than the preceding higher level APIs. It is primarily intended for library developers who implement higher level APIs on top of this. */
  dispatch(options: Dispatcher$1.DispatchOptions, handler: Dispatcher$1.DispatchHandler): boolean;
  /** Starts two-way communications with the requested resource. */
  connect<TOpaque = null>(options: Dispatcher$1.ConnectOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher$1.ConnectData<TOpaque>) => void): void;
  connect<TOpaque = null>(options: Dispatcher$1.ConnectOptions<TOpaque>): Promise<Dispatcher$1.ConnectData<TOpaque>>;
  /** Compose a chain of dispatchers */
  compose(dispatchers: Dispatcher$1.DispatcherComposeInterceptor[]): Dispatcher$1.ComposedDispatcher;
  compose(...dispatchers: Dispatcher$1.DispatcherComposeInterceptor[]): Dispatcher$1.ComposedDispatcher;
  /** Performs an HTTP request. */
  request<TOpaque = null>(options: Dispatcher$1.RequestOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher$1.ResponseData<TOpaque>) => void): void;
  request<TOpaque = null>(options: Dispatcher$1.RequestOptions<TOpaque>): Promise<Dispatcher$1.ResponseData<TOpaque>>;
  /** For easy use with `stream.pipeline`. */
  pipeline<TOpaque = null>(options: Dispatcher$1.PipelineOptions<TOpaque>, handler: Dispatcher$1.PipelineHandler<TOpaque>): Duplex;
  /** A faster version of `Dispatcher.request`. */
  stream<TOpaque = null>(options: Dispatcher$1.RequestOptions<TOpaque>, factory: Dispatcher$1.StreamFactory<TOpaque>, callback: (err: Error | null, data: Dispatcher$1.StreamData<TOpaque>) => void): void;
  stream<TOpaque = null>(options: Dispatcher$1.RequestOptions<TOpaque>, factory: Dispatcher$1.StreamFactory<TOpaque>): Promise<Dispatcher$1.StreamData<TOpaque>>;
  /** Upgrade to a different protocol. */
  upgrade(options: Dispatcher$1.UpgradeOptions, callback: (err: Error | null, data: Dispatcher$1.UpgradeData) => void): void;
  upgrade(options: Dispatcher$1.UpgradeOptions): Promise<Dispatcher$1.UpgradeData>;
  /** Closes the client and gracefully waits for enqueued requests to complete before invoking the callback (or returning a promise if no callback is provided). */
  close(callback: () => void): void;
  close(): Promise<void>;
  /** Destroy the client abruptly with the given err. All the pending and running requests will be asynchronously aborted and error. Waits until socket is closed before invoking the callback (or returning a promise if no callback is provided). Since this operation is asynchronously dispatched there might still be some progress on dispatched requests. */
  destroy(err: Error | null, callback: () => void): void;
  destroy(callback: () => void): void;
  destroy(err: Error | null): Promise<void>;
  destroy(): Promise<void>;
  on(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  on(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  on(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  on(eventName: 'drain', callback: (origin: URL$1) => void): this;
  once(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  once(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  once(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  once(eventName: 'drain', callback: (origin: URL$1) => void): this;
  off(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  off(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  off(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  off(eventName: 'drain', callback: (origin: URL$1) => void): this;
  addListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  addListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  addListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  addListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  removeListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  removeListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  removeListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  removeListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  prependListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  prependListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  prependListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependOnceListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher$1[]) => void): this;
  prependOnceListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  prependOnceListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void): this;
  prependOnceListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  listeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher$1[]) => void)[];
  listeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void)[];
  listeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void)[];
  listeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  rawListeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher$1[]) => void)[];
  rawListeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void)[];
  rawListeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError) => void)[];
  rawListeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  emit(eventName: 'connect', origin: URL$1, targets: readonly Dispatcher$1[]): boolean;
  emit(eventName: 'disconnect', origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError): boolean;
  emit(eventName: 'connectionError', origin: URL$1, targets: readonly Dispatcher$1[], error: Errors$2.UndiciError): boolean;
  emit(eventName: 'drain', origin: URL$1): boolean;
}
declare namespace Dispatcher$1 {
  export interface ComposedDispatcher extends Dispatcher$1 {}
  export type Dispatch = Dispatcher$1['dispatch'];
  export type DispatcherComposeInterceptor = (dispatch: Dispatch) => Dispatch;
  export interface DispatchOptions {
    origin?: string | URL$1;
    path: string;
    method: HttpMethod;
    /** Default: `null` */
    body?: string | Buffer | Uint8Array | Readable | null | FormData$2;
    /** Default: `null` */
    headers?: UndiciHeaders$1;
    /** Query string params to be embedded in the request URL. Default: `null` */
    query?: Record<string, any>;
    /** Whether the requests can be safely retried or not. If `false` the request won't be sent until all preceding requests in the pipeline have completed. Default: `true` if `method` is `HEAD` or `GET`. */
    idempotent?: boolean;
    /** Whether the response is expected to take a long time and would end up blocking the pipeline. When this is set to `true` further pipelining will be avoided on the same connection until headers have been received. Defaults to `method !== 'HEAD'`. */
    blocking?: boolean;
    /** The IP Type of Service (ToS) value for the request socket. Must be an integer between 0 and 255. Default: `0` */
    typeOfService?: number | null;
    /** Upgrade the request. Should be used to specify the kind of upgrade i.e. `'Websocket'`. Default: `method === 'CONNECT' || null`. */
    upgrade?: boolean | string | null;
    /** The amount of time, in milliseconds, the parser will wait to receive the complete HTTP headers. Defaults to 300 seconds. */
    headersTimeout?: number | null;
    /** The timeout after which a request will time out, in milliseconds. Monitors time between receiving body data. Use 0 to disable it entirely. Defaults to 300 seconds. */
    bodyTimeout?: number | null;
    /** Whether the request should stablish a keep-alive or not. Default `false` */
    reset?: boolean;
    /** For H2, it appends the expect: 100-continue header, and halts the request body until a 100-continue is received from the remote server */
    expectContinue?: boolean;
  }
  export interface ConnectOptions<TOpaque = null> {
    origin: string | URL$1;
    path: string;
    /** Default: `null` */
    headers?: UndiciHeaders$1;
    /** Default: `null` */
    signal?: AbortSignal | EventEmitter | null;
    /** This argument parameter is passed through to `ConnectData` */
    opaque?: TOpaque;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
  }
  export interface RequestOptions<TOpaque = null> extends DispatchOptions {
    /** Default: `null` */
    opaque?: TOpaque;
    /** Default: `null` */
    signal?: AbortSignal | EventEmitter | null;
    /** Default: `null` */
    onInfo?: (info: {
      statusCode: number;
      headers: Record<string, string | string[]>;
    }) => void;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
    /** Default: `64 KiB` */
    highWaterMark?: number;
  }
  export interface PipelineOptions<TOpaque = null> extends RequestOptions<TOpaque> {
    /** `true` if the `handler` will return an object stream. Default: `false` */
    objectMode?: boolean;
  }
  export interface UpgradeOptions {
    path: string;
    /** Default: `'GET'` */
    method?: string;
    /** Default: `null` */
    headers?: UndiciHeaders$1;
    /** A string of comma separated protocols, in descending preference order. Default: `'Websocket'` */
    protocol?: string;
    /** Default: `null` */
    signal?: AbortSignal | EventEmitter | null;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
  }
  export interface ConnectData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders$1;
    socket: Duplex;
    opaque: TOpaque;
  }
  export interface ResponseData<TOpaque = null> {
    statusCode: number;
    statusText: string;
    headers: IncomingHttpHeaders$1;
    body: BodyReadable$1 & BodyMixin;
    trailers: Record<string, string>;
    opaque: TOpaque;
    context: object;
  }
  export interface PipelineHandlerData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders$1;
    opaque: TOpaque;
    body: BodyReadable$1;
    context: object;
  }
  export interface StreamData<TOpaque = null> {
    opaque: TOpaque;
    trailers: Record<string, string>;
  }
  export interface UpgradeData<TOpaque = null> {
    headers: IncomingHttpHeaders$1;
    socket: Duplex;
    opaque: TOpaque;
  }
  export interface StreamFactoryData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders$1;
    opaque: TOpaque;
    context: object;
  }
  export type StreamFactory<TOpaque = null> = (data: StreamFactoryData<TOpaque>) => Writable;
  export interface DispatchController {
    get aborted(): boolean;
    get paused(): boolean;
    get reason(): Error | null;
    rawHeaders?: Buffer[] | string[] | IncomingHttpHeaders$1 | null;
    rawTrailers?: Buffer[] | string[] | IncomingHttpHeaders$1 | null;
    abort(reason: Error): void;
    pause(): void;
    resume(): void;
  }
  export interface DispatchHandler {
    onRequestStart?(controller: DispatchController, context: any): void;
    onRequestUpgrade?(controller: DispatchController, statusCode: number, headers: IncomingHttpHeaders$1, socket: Duplex): void;
    onResponseStart?(controller: DispatchController, statusCode: number, headers: IncomingHttpHeaders$1, statusMessage?: string): void;
    onResponseData?(controller: DispatchController, chunk: Buffer): void;
    onResponseEnd?(controller: DispatchController, trailers: IncomingHttpHeaders$1): void;
    onResponseError?(controller: DispatchController, error: Error): void;
    /** Invoked when response is received, before headers have been read. **/
    onResponseStarted?(): void;
    /** Invoked when a body chunk is sent to the server. May be invoked multiple times for chunked requests */
    onBodySent?(chunk: Buffer): void;
    /** Invoked after the request body is fully sent. */
    onRequestSent?(): void;
  }
  export type PipelineHandler<TOpaque = null> = (data: PipelineHandlerData<TOpaque>) => Readable;
  export type HttpMethod = Autocomplete$1<'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'>;
  /**
   * @link https://fetch.spec.whatwg.org/#body-mixin
   */
  interface BodyMixin {
    readonly body?: never;
    readonly bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob$1>;
    bytes(): Promise<Uint8Array>;
    formData(): Promise<never>;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }
  export interface DispatchInterceptor {
    (dispatch: Dispatch): Dispatch;
  }
}
//#endregion
//#region node_modules/.pnpm/undici@8.3.0/node_modules/undici/types/mock-interceptor.d.ts
/** The scope associated with a mock dispatch. */
declare class MockScope$1<TData extends object = object> {
  constructor(mockDispatch: MockInterceptor$1.MockDispatch<TData>);
  /** Delay a reply by a set amount of time in ms. */
  delay(waitInMs: number): MockScope$1<TData>;
  /** Persist the defined mock data for the associated reply. It will return the defined mock data indefinitely. */
  persist(): MockScope$1<TData>;
  /** Define a reply for a set amount of matching requests. */
  times(repeatTimes: number): MockScope$1<TData>;
}
/** The interceptor for a Mock. */
declare class MockInterceptor$1 {
  constructor(options: MockInterceptor$1.Options, mockDispatches: MockInterceptor$1.MockDispatch[]);
  /** Mock an undici request with the defined reply. */
  reply<TData extends object = object>(replyOptionsCallback: MockInterceptor$1.MockReplyOptionsCallback<TData>): MockScope$1<TData>;
  reply<TData extends object = object>(statusCode: number, data?: TData | Buffer | string | MockInterceptor$1.MockResponseDataHandler<TData>, responseOptions?: MockInterceptor$1.MockResponseOptions): MockScope$1<TData>;
  /** Mock an undici request by throwing the defined reply error. */
  replyWithError<TError extends Error = Error>(error: TError): MockScope$1;
  /** Set default reply headers on the interceptor for subsequent mocked replies. */
  defaultReplyHeaders(headers: IncomingHttpHeaders$1): MockInterceptor$1;
  /** Set default reply trailers on the interceptor for subsequent mocked replies. */
  defaultReplyTrailers(trailers: Record<string, string>): MockInterceptor$1;
  /** Set automatically calculated content-length header on subsequent mocked replies. */
  replyContentLength(): MockInterceptor$1;
}
declare namespace MockInterceptor$1 {
  /** MockInterceptor options. */
  export interface Options {
    /** Path to intercept on. */
    path: string | RegExp | ((path: string) => boolean);
    /** Method to intercept on. Defaults to GET. */
    method?: string | RegExp | ((method: string) => boolean);
    /** Body to intercept on. */
    body?: string | RegExp | ((body: string) => boolean);
    /** Headers to intercept on. */
    headers?: Record<string, string | RegExp | ((body: string) => boolean)> | ((headers: Record<string, string>) => boolean);
    /** Query params to intercept on */
    query?: Record<string, any>;
  }
  export interface MockDispatch<TData extends object = object, TError extends Error = Error> extends Options {
    times: number | null;
    persist: boolean;
    consumed: boolean;
    data: MockDispatchData<TData, TError>;
  }
  export interface MockDispatchData<TData extends object = object, TError extends Error = Error> extends MockResponseOptions {
    error: TError | null;
    statusCode?: number;
    data?: TData | string;
  }
  export interface MockResponseOptions {
    headers?: IncomingHttpHeaders$1;
    trailers?: Record<string, string>;
  }
  export interface MockResponseCallbackOptions {
    path: string;
    method: string;
    headers?: Headers$2 | Record<string, string>;
    origin?: string;
    body?: BodyInit$1 | Dispatcher$1.DispatchOptions['body'] | null;
  }
  export type MockResponseDataHandler<TData extends object = object> = (opts: MockResponseCallbackOptions) => TData | Buffer | string;
  export type MockReplyOptionsCallback<TData extends object = object> = (opts: MockResponseCallbackOptions) => {
    statusCode: number;
    data?: TData | Buffer | string;
    responseOptions?: MockResponseOptions;
  };
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/utility.d.ts
type AutocompletePrimitiveBaseType<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : never;
type Autocomplete<T> = T | (AutocompletePrimitiveBaseType<T> & Record<never, never>);
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/header.d.ts
/**
 * The header type declaration of `undici`.
 */
type IncomingHttpHeaders = Record<string, string | string[] | undefined>;
type HeaderNames = Autocomplete<'Accept' | 'Accept-CH' | 'Accept-Charset' | 'Accept-Encoding' | 'Accept-Language' | 'Accept-Patch' | 'Accept-Post' | 'Accept-Ranges' | 'Access-Control-Allow-Credentials' | 'Access-Control-Allow-Headers' | 'Access-Control-Allow-Methods' | 'Access-Control-Allow-Origin' | 'Access-Control-Expose-Headers' | 'Access-Control-Max-Age' | 'Access-Control-Request-Headers' | 'Access-Control-Request-Method' | 'Age' | 'Allow' | 'Alt-Svc' | 'Alt-Used' | 'Authorization' | 'Cache-Control' | 'Clear-Site-Data' | 'Connection' | 'Content-Disposition' | 'Content-Encoding' | 'Content-Language' | 'Content-Length' | 'Content-Location' | 'Content-Range' | 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' | 'Content-Type' | 'Cookie' | 'Cross-Origin-Embedder-Policy' | 'Cross-Origin-Opener-Policy' | 'Cross-Origin-Resource-Policy' | 'Date' | 'Device-Memory' | 'ETag' | 'Expect' | 'Expect-CT' | 'Expires' | 'Forwarded' | 'From' | 'Host' | 'If-Match' | 'If-Modified-Since' | 'If-None-Match' | 'If-Range' | 'If-Unmodified-Since' | 'Keep-Alive' | 'Last-Modified' | 'Link' | 'Location' | 'Max-Forwards' | 'Origin' | 'Permissions-Policy' | 'Priority' | 'Proxy-Authenticate' | 'Proxy-Authorization' | 'Range' | 'Referer' | 'Referrer-Policy' | 'Retry-After' | 'Sec-Fetch-Dest' | 'Sec-Fetch-Mode' | 'Sec-Fetch-Site' | 'Sec-Fetch-User' | 'Sec-Purpose' | 'Sec-WebSocket-Accept' | 'Server' | 'Server-Timing' | 'Service-Worker-Navigation-Preload' | 'Set-Cookie' | 'SourceMap' | 'Strict-Transport-Security' | 'TE' | 'Timing-Allow-Origin' | 'Trailer' | 'Transfer-Encoding' | 'Upgrade' | 'Upgrade-Insecure-Requests' | 'User-Agent' | 'Vary' | 'Via' | 'WWW-Authenticate' | 'X-Content-Type-Options' | 'X-Frame-Options'>;
type IANARegisteredMimeType = Autocomplete<'audio/aac' | 'video/x-msvideo' | 'image/avif' | 'video/av1' | 'application/octet-stream' | 'image/bmp' | 'text/css' | 'text/csv' | 'application/vnd.ms-fontobject' | 'application/epub+zip' | 'image/gif' | 'application/gzip' | 'text/html' | 'image/x-icon' | 'text/calendar' | 'image/jpeg' | 'text/javascript' | 'application/json' | 'application/ld+json' | 'audio/x-midi' | 'audio/mpeg' | 'video/mp4' | 'video/mpeg' | 'audio/ogg' | 'video/ogg' | 'application/ogg' | 'audio/opus' | 'font/otf' | 'application/pdf' | 'image/png' | 'application/rtf' | 'image/svg+xml' | 'image/tiff' | 'video/mp2t' | 'font/ttf' | 'text/plain' | 'application/wasm' | 'video/webm' | 'audio/webm' | 'image/webp' | 'font/woff' | 'font/woff2' | 'application/xhtml+xml' | 'application/xml' | 'application/zip' | 'video/3gpp' | 'video/3gpp2' | 'model/gltf+json' | 'model/gltf-binary'>;
type KnownHeaderValues = {
  'content-type': IANARegisteredMimeType;
};
type HeaderRecord = { [K in HeaderNames | Lowercase<HeaderNames>]?: Lowercase<K> extends keyof KnownHeaderValues ? KnownHeaderValues[Lowercase<K>] : string };
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/readable.d.ts
declare class BodyReadable extends Readable {
  constructor(opts: {
    resume: (this: Readable, size: number) => void | null;
    abort: () => void | null;
    contentType?: string;
    contentLength?: number;
    highWaterMark?: number;
  });
  /** Consumes and returns the body as a string
   *  https://fetch.spec.whatwg.org/#dom-body-text
   */
  text(): Promise<string>;
  /** Consumes and returns the body as a JavaScript Object
   *  https://fetch.spec.whatwg.org/#dom-body-json
   */
  json(): Promise<unknown>;
  /** Consumes and returns the body as a Blob
   *  https://fetch.spec.whatwg.org/#dom-body-blob
   */
  blob(): Promise<Blob$1>;
  /** Consumes and returns the body as an Uint8Array
   *  https://fetch.spec.whatwg.org/#dom-body-bytes
   */
  bytes(): Promise<Uint8Array>;
  /** Consumes and returns the body as an ArrayBuffer
   *  https://fetch.spec.whatwg.org/#dom-body-arraybuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Not implemented
   *
   *  https://fetch.spec.whatwg.org/#dom-body-formdata
   */
  formData(): Promise<never>;
  /** Returns true if the body is not null and the body has been consumed
   *
   *  Otherwise, returns false
   *
   * https://fetch.spec.whatwg.org/#dom-body-bodyused
   */
  readonly bodyUsed: boolean;
  /**
   * If body is null, it should return null as the body
   *
   *  If body is not null, should return the body as a ReadableStream
   *
   *  https://fetch.spec.whatwg.org/#dom-body-body
   */
  readonly body: never | undefined;
  /** Dumps the response body by reading `limit` number of bytes.
   * @param opts.limit Number of bytes to read (optional) - Default: 131072
   * @param opts.signal AbortSignal to cancel the operation (optional)
   */
  dump(opts?: {
    limit: number;
    signal?: AbortSignal;
  }): Promise<void>;
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/fetch.d.ts
type BodyInit = ArrayBuffer | AsyncIterable<Uint8Array> | Blob$1 | FormData$1 | Iterable<Uint8Array> | NodeJS.ArrayBufferView | URLSearchParams$1 | null | string;
interface SpecIterator<T, TReturn = any, TNext = undefined> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
}
interface SpecIterableIterator<T> extends SpecIterator<T> {
  [Symbol.iterator](): SpecIterableIterator<T>;
}
interface SpecIterable<T> {
  [Symbol.iterator](): SpecIterator<T>;
}
type HeadersInit$3 = [string, string][] | HeaderRecord | Headers$1;
declare class Headers$1 implements SpecIterable<[string, string]> {
  constructor(init?: HeadersInit$3);
  readonly append: (name: string, value: string) => void;
  readonly delete: (name: string) => void;
  readonly get: (name: string) => string | null;
  readonly has: (name: string) => boolean;
  readonly set: (name: string, value: string) => void;
  readonly getSetCookie: () => string[];
  readonly forEach: (callbackfn: (value: string, key: string, iterable: Headers$1) => void, thisArg?: unknown) => void;
  readonly keys: () => SpecIterableIterator<string>;
  readonly values: () => SpecIterableIterator<string>;
  readonly entries: () => SpecIterableIterator<[string, string]>;
  readonly [Symbol.iterator]: () => SpecIterableIterator<[string, string]>;
}
type RequestCache = 'default' | 'force-cache' | 'no-cache' | 'no-store' | 'only-if-cached' | 'reload';
type RequestCredentials = 'omit' | 'include' | 'same-origin';
interface RequestInit$1 {
  body?: BodyInit | null;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  dispatcher?: Dispatcher;
  duplex?: RequestDuplex;
  headers?: HeadersInit$3;
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  signal?: AbortSignal | null;
  window?: null;
}
type ReferrerPolicy = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url';
type RequestMode = 'cors' | 'navigate' | 'no-cors' | 'same-origin';
type RequestRedirect = 'error' | 'follow' | 'manual';
type RequestDuplex = 'half';
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/formdata.d.ts
/**
 * A `string` or `File` that represents a single value from a set of `FormData` key-value pairs.
 */
declare type FormDataEntryValue = string | File$1;
/**
 * Provides a way to easily construct a set of key/value pairs representing form fields and their values, which can then be easily sent using fetch().
 */
declare class FormData$1 {
  /**
   * Appends a new value onto an existing key inside a FormData object,
   * or adds the key if it does not already exist.
   *
   * The difference between `set()` and `append()` is that if the specified key already exists, `set()` will overwrite all existing values with the new one, whereas `append()` will append the new value onto the end of the existing set of values.
   *
   * @param name The name of the field whose data is contained in `value`.
   * @param value The field's value. This can be [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
    or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File). If none of these are specified the value is converted to a string.
   * @param fileName The filename reported to the server, when a Blob or File is passed as the second parameter. The default filename for Blob objects is "blob". The default filename for File objects is the file's filename.
   */
  append(name: string, value: unknown, fileName?: string): void;
  /**
   * Set a new value for an existing key inside FormData,
   * or add the new field if it does not already exist.
   *
   * @param name The name of the field whose data is contained in `value`.
   * @param value The field's value. This can be [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
    or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File). If none of these are specified the value is converted to a string.
   * @param fileName The filename reported to the server, when a Blob or File is passed as the second parameter. The default filename for Blob objects is "blob". The default filename for File objects is the file's filename.
   *
   */
  set(name: string, value: unknown, fileName?: string): void;
  /**
   * Returns the first value associated with a given key from within a `FormData` object.
   * If you expect multiple values and want all of them, use the `getAll()` method instead.
   *
   * @param {string} name A name of the value you want to retrieve.
   *
   * @returns A `FormDataEntryValue` containing the value. If the key doesn't exist, the method returns null.
   */
  get(name: string): FormDataEntryValue | null;
  /**
   * Returns all the values associated with a given key from within a `FormData` object.
   *
   * @param {string} name A name of the value you want to retrieve.
   *
   * @returns An array of `FormDataEntryValue` whose key matches the value passed in the `name` parameter. If the key doesn't exist, the method returns an empty list.
   */
  getAll(name: string): FormDataEntryValue[];
  /**
   * Returns a boolean stating whether a `FormData` object contains a certain key.
   *
   * @param name A string representing the name of the key you want to test for.
   *
   * @return A boolean value.
   */
  has(name: string): boolean;
  /**
   * Deletes a key and its value(s) from a `FormData` object.
   *
   * @param name The name of the key you want to delete.
   */
  delete(name: string): void;
  /**
   * Executes given callback function for each field of the FormData instance
   */
  forEach: (callbackfn: (value: FormDataEntryValue, key: string, iterable: FormData$1) => void, thisArg?: unknown) => void;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through all keys contained in this `FormData` object.
   * Each key is a `string`.
   */
  keys: () => SpecIterableIterator<string>;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through all values contained in this object `FormData` object.
   * Each value is a [`FormDataValue`](https://developer.mozilla.org/en-US/docs/Web/API/FormDataEntryValue).
   */
  values: () => SpecIterableIterator<FormDataEntryValue>;
  /**
   * Returns an [`iterator`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols) allowing to go through the `FormData` key/value pairs.
   * The key of each pair is a string; the value is a [`FormDataValue`](https://developer.mozilla.org/en-US/docs/Web/API/FormDataEntryValue).
   */
  entries: () => SpecIterableIterator<[string, FormDataEntryValue]>;
  /**
   * An alias for FormData#entries()
   */
  [Symbol.iterator]: () => SpecIterableIterator<[string, FormDataEntryValue]>;
  readonly [Symbol.toStringTag]: string;
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/connector.d.ts
declare function buildConnector(options?: buildConnector.BuildOptions): buildConnector.connector;
declare namespace buildConnector {
  export type BuildOptions = (ConnectionOptions | TcpNetConnectOpts | IpcNetConnectOpts) & {
    allowH2?: boolean;
    maxCachedSessions?: number | null;
    socketPath?: string | null;
    timeout?: number | null;
    port?: number;
    keepAlive?: boolean | null;
    keepAliveInitialDelay?: number | null;
    typeOfService?: number | null;
  };
  export interface Options {
    hostname: string;
    host?: string;
    protocol: string;
    port: string;
    servername?: string;
    localAddress?: string | null;
    socketPath?: string | null;
    httpSocket?: Socket;
  }
  export type Callback = (...args: CallbackArgs) => void;
  type CallbackArgs = [null, Socket | TLSSocket] | [Error, null];
  export interface connector {
    (options: buildConnector.Options, callback: buildConnector.Callback): void;
  }
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/client-stats.d.ts
declare class ClientStats {
  constructor(pool: Client$1);
  /** If socket has open connection. */
  connected: boolean;
  /** Number of open socket connections in this client that do not have an active request. */
  pending: number;
  /** Number of currently active requests of this client. */
  running: number;
  /** Number of active, pending, or queued requests of this client. */
  size: number;
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/client.d.ts
type ClientConnectOptions = Omit<Dispatcher.ConnectOptions, 'origin'>;
/**
 * A basic HTTP/1.1 client, mapped on top a single TCP/TLS connection. Pipelining is disabled by default.
 */
declare class Client$1 extends Dispatcher {
  constructor(url: string | URL$1, options?: Client$1.Options);
  /** Property to get and set the pipelining factor. */
  pipelining: number;
  /** `true` after `client.close()` has been called. */
  closed: boolean;
  /** `true` after `client.destroyed()` has been called or `client.close()` has been called and the client shutdown has completed. */
  destroyed: boolean;
  /** Aggregate stats for a Client. */
  readonly stats: ClientStats; // Override dispatcher APIs.
  override connect(options: ClientConnectOptions): Promise<Dispatcher.ConnectData>;
  override connect(options: ClientConnectOptions, callback: (err: Error | null, data: Dispatcher.ConnectData) => void): void;
}
declare namespace Client$1 {
  export interface OptionsInterceptors {
    Client: readonly Dispatcher.DispatchInterceptor[];
  }
  export interface Options {
    /** TODO */
    interceptors?: OptionsInterceptors;
    /** The maximum length of request headers in bytes. Default: Node.js' `--max-http-header-size` or `16384` (16KiB). */
    maxHeaderSize?: number;
    /** The amount of time, in milliseconds, the parser will wait to receive the complete HTTP headers (Node 14 and above only). Default: `300e3` milliseconds (300s). */
    headersTimeout?: number;
    /** @deprecated unsupported socketTimeout, use headersTimeout & bodyTimeout instead */
    socketTimeout?: never;
    /** @deprecated unsupported requestTimeout, use headersTimeout & bodyTimeout instead */
    requestTimeout?: never;
    /** TODO */
    connectTimeout?: number;
    /** The timeout after which a request will time out, in milliseconds. Monitors time between receiving body data. Use `0` to disable it entirely. Default: `300e3` milliseconds (300s). */
    bodyTimeout?: number;
    /** @deprecated unsupported idleTimeout, use keepAliveTimeout instead */
    idleTimeout?: never;
    /** @deprecated unsupported keepAlive, use pipelining=0 instead */
    keepAlive?: never;
    /** the timeout, in milliseconds, after which a socket without active requests will time out. Monitors time between activity on a connected socket. This value may be overridden by *keep-alive* hints from the server. Default: `4e3` milliseconds (4s). */
    keepAliveTimeout?: number;
    /** @deprecated unsupported maxKeepAliveTimeout, use keepAliveMaxTimeout instead */
    maxKeepAliveTimeout?: never;
    /** the maximum allowed `idleTimeout`, in milliseconds, when overridden by *keep-alive* hints from the server. Default: `600e3` milliseconds (10min). */
    keepAliveMaxTimeout?: number;
    /** A number of milliseconds subtracted from server *keep-alive* hints when overriding `idleTimeout` to account for timing inaccuracies caused by e.g. transport latency. Default: `1e3` milliseconds (1s). */
    keepAliveTimeoutThreshold?: number;
    /** TODO */
    socketPath?: string;
    /** The amount of concurrent requests to be sent over the single TCP/TLS connection according to [RFC7230](https://tools.ietf.org/html/rfc7230#section-6.3.2). Default: `1`. */
    pipelining?: number;
    /** @deprecated use the connect option instead */
    tls?: never;
    /** If `true`, an error is thrown when the request content-length header doesn't match the length of the request body. Default: `true`. */
    strictContentLength?: boolean;
    /** TODO */
    maxCachedSessions?: number;
    /** TODO */
    connect?: Partial<buildConnector.BuildOptions> | buildConnector.connector;
    /** TODO */
    maxRequestsPerClient?: number;
    /** TODO */
    localAddress?: string;
    /** Max response body size in bytes, -1 is disabled */
    maxResponseSize?: number;
    /** Enables a family autodetection algorithm that loosely implements section 5 of RFC 8305. */
    autoSelectFamily?: boolean;
    /** The amount of time in milliseconds to wait for a connection attempt to finish before trying the next address when using the `autoSelectFamily` option. */
    autoSelectFamilyAttemptTimeout?: number;
    /**
     * @description Enables support for H2 if the server has assigned bigger priority to it through ALPN negotiation.
     * @default false
     */
    allowH2?: boolean;
    /**
     * @description Dictates the maximum number of concurrent streams for a single H2 session. It can be overridden by a SETTINGS remote frame.
     * @default 100
     */
    maxConcurrentStreams?: number;
    /**
     * @description Sets the HTTP/2 stream-level flow-control window size (SETTINGS_INITIAL_WINDOW_SIZE).
     * @default 262144
     */
    initialWindowSize?: number;
    /**
     * @description Sets the HTTP/2 connection-level flow-control window size (ClientHttp2Session.setLocalWindowSize).
     * @default 524288
     */
    connectionWindowSize?: number;
    /**
     * @description Time interval between PING frames dispatch
     * @default 60000
     */
    pingInterval?: number;
  }
  export interface SocketInfo {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    remoteFamily?: string;
    timeout?: number;
    bytesWritten?: number;
    bytesRead?: number;
  }
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/errors.d.ts
declare namespace Errors$1 {
  export class UndiciError extends Error {
    name: string;
    code: string;
  }
  /** Connect timeout error. */
  export class ConnectTimeoutError extends UndiciError {
    name: 'ConnectTimeoutError';
    code: 'UND_ERR_CONNECT_TIMEOUT';
  }
  /** A header exceeds the `headersTimeout` option. */
  export class HeadersTimeoutError extends UndiciError {
    name: 'HeadersTimeoutError';
    code: 'UND_ERR_HEADERS_TIMEOUT';
  }
  /** Headers overflow error. */
  export class HeadersOverflowError extends UndiciError {
    name: 'HeadersOverflowError';
    code: 'UND_ERR_HEADERS_OVERFLOW';
  }
  /** A body exceeds the `bodyTimeout` option. */
  export class BodyTimeoutError extends UndiciError {
    name: 'BodyTimeoutError';
    code: 'UND_ERR_BODY_TIMEOUT';
  }
  export class ResponseError extends UndiciError {
    constructor(message: string, code: number, options: {
      headers?: IncomingHttpHeaders | string[] | null;
      body?: null | Record<string, any> | string;
    });
    name: 'ResponseError';
    code: 'UND_ERR_RESPONSE';
    statusCode: number;
    body: null | Record<string, any> | string;
    headers: IncomingHttpHeaders | string[] | null;
  }
  /** Passed an invalid argument. */
  export class InvalidArgumentError extends UndiciError {
    name: 'InvalidArgumentError';
    code: 'UND_ERR_INVALID_ARG';
  }
  /** Returned an invalid value. */
  export class InvalidReturnValueError extends UndiciError {
    name: 'InvalidReturnValueError';
    code: 'UND_ERR_INVALID_RETURN_VALUE';
  }
  /** The request has been aborted by the user. */
  export class RequestAbortedError extends UndiciError {
    name: 'AbortError';
    code: 'UND_ERR_ABORTED';
  }
  /** Expected error with reason. */
  export class InformationalError extends UndiciError {
    name: 'InformationalError';
    code: 'UND_ERR_INFO';
  }
  /** Request body length does not match content-length header. */
  export class RequestContentLengthMismatchError extends UndiciError {
    name: 'RequestContentLengthMismatchError';
    code: 'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH';
  }
  /** Response body length does not match content-length header. */
  export class ResponseContentLengthMismatchError extends UndiciError {
    name: 'ResponseContentLengthMismatchError';
    code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH';
  }
  /** Trying to use a destroyed client. */
  export class ClientDestroyedError extends UndiciError {
    name: 'ClientDestroyedError';
    code: 'UND_ERR_DESTROYED';
  }
  /** Trying to use a closed client. */
  export class ClientClosedError extends UndiciError {
    name: 'ClientClosedError';
    code: 'UND_ERR_CLOSED';
  }
  /** There is an error with the socket. */
  export class SocketError extends UndiciError {
    name: 'SocketError';
    code: 'UND_ERR_SOCKET';
    socket: Client$1.SocketInfo | null;
  }
  /** Encountered unsupported functionality. */
  export class NotSupportedError extends UndiciError {
    name: 'NotSupportedError';
    code: 'UND_ERR_NOT_SUPPORTED';
  }
  /** No upstream has been added to the BalancedPool. */
  export class BalancedPoolMissingUpstreamError extends UndiciError {
    name: 'MissingUpstreamError';
    code: 'UND_ERR_BPL_MISSING_UPSTREAM';
  }
  export class HTTPParserError extends UndiciError {
    name: 'HTTPParserError';
    code: string;
  }
  /** The response exceed the length allowed. */
  export class ResponseExceededMaxSizeError extends UndiciError {
    name: 'ResponseExceededMaxSizeError';
    code: 'UND_ERR_RES_EXCEEDED_MAX_SIZE';
  }
  export class RequestRetryError extends UndiciError {
    constructor(message: string, statusCode: number, headers?: IncomingHttpHeaders | string[] | null, body?: null | Record<string, any> | string);
    name: 'RequestRetryError';
    code: 'UND_ERR_REQ_RETRY';
    statusCode: number;
    data: {
      count: number;
    };
    headers: Record<string, string | string[]>;
  }
  export class SecureProxyConnectionError extends UndiciError {
    constructor(cause?: Error, message?: string, options?: Record<any, any>);
    name: 'SecureProxyConnectionError';
    code: 'UND_ERR_PRX_TLS';
  }
  export class MaxOriginsReachedError extends UndiciError {
    name: 'MaxOriginsReachedError';
    code: 'UND_ERR_MAX_ORIGINS_REACHED';
  }
  /** SOCKS5 proxy related error. */
  export class Socks5ProxyError extends UndiciError {
    constructor(message?: string, code?: string);
    name: 'Socks5ProxyError';
    code: string;
  }
  /** WebSocket decompressed message exceeded maximum size. */
  export class MessageSizeExceededError extends UndiciError {
    name: 'MessageSizeExceededError';
    code: 'UND_ERR_WS_MESSAGE_SIZE_EXCEEDED';
  }
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/dispatcher.d.ts
type AbortSignal$1 = unknown;
type UndiciHeaders = Record<string, string | string[]> | IncomingHttpHeaders | string[] | Iterable<[string, string | string[] | undefined]> | null;
/** Dispatcher is the core API used to dispatch requests. */
declare class Dispatcher extends EventEmitter {
  /** Dispatches a request. This API is expected to evolve through semver-major versions and is less stable than the preceding higher level APIs. It is primarily intended for library developers who implement higher level APIs on top of this. */
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean;
  /** Starts two-way communications with the requested resource. */
  connect<TOpaque = null>(options: Dispatcher.ConnectOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher.ConnectData<TOpaque>) => void): void;
  connect<TOpaque = null>(options: Dispatcher.ConnectOptions<TOpaque>): Promise<Dispatcher.ConnectData<TOpaque>>;
  /** Compose a chain of dispatchers */
  compose(dispatchers: Dispatcher.DispatcherComposeInterceptor[]): Dispatcher.ComposedDispatcher;
  compose(...dispatchers: Dispatcher.DispatcherComposeInterceptor[]): Dispatcher.ComposedDispatcher;
  /** Performs an HTTP request. */
  request<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher.ResponseData<TOpaque>) => void): void;
  request<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>): Promise<Dispatcher.ResponseData<TOpaque>>;
  /** For easy use with `stream.pipeline`. */
  pipeline<TOpaque = null>(options: Dispatcher.PipelineOptions<TOpaque>, handler: Dispatcher.PipelineHandler<TOpaque>): Duplex;
  /** A faster version of `Dispatcher.request`. */
  stream<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>, factory: Dispatcher.StreamFactory<TOpaque>, callback: (err: Error | null, data: Dispatcher.StreamData<TOpaque>) => void): void;
  stream<TOpaque = null>(options: Dispatcher.RequestOptions<TOpaque>, factory: Dispatcher.StreamFactory<TOpaque>): Promise<Dispatcher.StreamData<TOpaque>>;
  /** Upgrade to a different protocol. */
  upgrade(options: Dispatcher.UpgradeOptions, callback: (err: Error | null, data: Dispatcher.UpgradeData) => void): void;
  upgrade(options: Dispatcher.UpgradeOptions): Promise<Dispatcher.UpgradeData>;
  /** Closes the client and gracefully waits for enqueued requests to complete before invoking the callback (or returning a promise if no callback is provided). */
  close(callback: () => void): void;
  close(): Promise<void>;
  /** Destroy the client abruptly with the given err. All the pending and running requests will be asynchronously aborted and error. Waits until socket is closed before invoking the callback (or returning a promise if no callback is provided). Since this operation is asynchronously dispatched there might still be some progress on dispatched requests. */
  destroy(err: Error | null, callback: () => void): void;
  destroy(callback: () => void): void;
  destroy(err: Error | null): Promise<void>;
  destroy(): Promise<void>;
  on(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  on(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  on(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  on(eventName: 'drain', callback: (origin: URL$1) => void): this;
  once(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  once(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  once(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  once(eventName: 'drain', callback: (origin: URL$1) => void): this;
  off(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  off(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  off(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  off(eventName: 'drain', callback: (origin: URL$1) => void): this;
  addListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  addListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  addListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  addListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  removeListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  removeListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  removeListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  removeListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  prependListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  prependListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  prependListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependOnceListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  prependOnceListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  prependOnceListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void): this;
  prependOnceListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  listeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher[]) => void)[];
  listeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void)[];
  listeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void)[];
  listeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  rawListeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher[]) => void)[];
  rawListeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void)[];
  rawListeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError) => void)[];
  rawListeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  emit(eventName: 'connect', origin: URL$1, targets: readonly Dispatcher[]): boolean;
  emit(eventName: 'disconnect', origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError): boolean;
  emit(eventName: 'connectionError', origin: URL$1, targets: readonly Dispatcher[], error: Errors$1.UndiciError): boolean;
  emit(eventName: 'drain', origin: URL$1): boolean;
}
declare namespace Dispatcher {
  export interface ComposedDispatcher extends Dispatcher {}
  export type Dispatch = Dispatcher['dispatch'];
  export type DispatcherComposeInterceptor = (dispatch: Dispatch) => Dispatch;
  export interface DispatchOptions {
    origin?: string | URL$1;
    path: string;
    method: HttpMethod;
    /** Default: `null` */
    body?: string | Buffer | Uint8Array | Readable | null | FormData$1;
    /** Default: `null` */
    headers?: UndiciHeaders;
    /** Query string params to be embedded in the request URL. Default: `null` */
    query?: Record<string, any>;
    /** Whether the requests can be safely retried or not. If `false` the request won't be sent until all preceding requests in the pipeline have completed. Default: `true` if `method` is `HEAD` or `GET`. */
    idempotent?: boolean;
    /** Whether the response is expected to take a long time and would end up blocking the pipeline. When this is set to `true` further pipelining will be avoided on the same connection until headers have been received. Defaults to `method !== 'HEAD'`. */
    blocking?: boolean;
    /** The IP Type of Service (ToS) value for the request socket. Must be an integer between 0 and 255. Default: `0` */
    typeOfService?: number | null;
    /** Upgrade the request. Should be used to specify the kind of upgrade i.e. `'Websocket'`. Default: `method === 'CONNECT' || null`. */
    upgrade?: boolean | string | null;
    /** The amount of time, in milliseconds, the parser will wait to receive the complete HTTP headers. Defaults to 300 seconds. */
    headersTimeout?: number | null;
    /** The timeout after which a request will time out, in milliseconds. Monitors time between receiving body data. Use 0 to disable it entirely. Defaults to 300 seconds. */
    bodyTimeout?: number | null;
    /** Whether the request should stablish a keep-alive or not. Default `false` */
    reset?: boolean;
    /** Whether Undici should throw an error upon receiving a 4xx or 5xx response from the server. Defaults to false */
    throwOnError?: boolean;
    /** For H2, it appends the expect: 100-continue header, and halts the request body until a 100-continue is received from the remote server */
    expectContinue?: boolean;
  }
  export interface ConnectOptions<TOpaque = null> {
    origin: string | URL$1;
    path: string;
    /** Default: `null` */
    headers?: UndiciHeaders;
    /** Default: `null` */
    signal?: AbortSignal$1 | EventEmitter | null;
    /** This argument parameter is passed through to `ConnectData` */
    opaque?: TOpaque;
    /** Default: false */
    redirectionLimitReached?: boolean;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
  }
  export interface RequestOptions<TOpaque = null> extends DispatchOptions {
    /** Default: `null` */
    opaque?: TOpaque;
    /** Default: `null` */
    signal?: AbortSignal$1 | EventEmitter | null;
    /** Default: false */
    redirectionLimitReached?: boolean;
    /** Default: `null` */
    onInfo?: (info: {
      statusCode: number;
      headers: Record<string, string | string[]>;
    }) => void;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
    /** Default: `64 KiB` */
    highWaterMark?: number;
  }
  export interface PipelineOptions<TOpaque = null> extends RequestOptions<TOpaque> {
    /** `true` if the `handler` will return an object stream. Default: `false` */
    objectMode?: boolean;
  }
  export interface UpgradeOptions {
    path: string;
    /** Default: `'GET'` */
    method?: string;
    /** Default: `null` */
    headers?: UndiciHeaders;
    /** A string of comma separated protocols, in descending preference order. Default: `'Websocket'` */
    protocol?: string;
    /** Default: `null` */
    signal?: AbortSignal$1 | EventEmitter | null;
    /** Default: false */
    redirectionLimitReached?: boolean;
    /** Default: `null` */
    responseHeaders?: 'raw' | null;
  }
  export interface ConnectData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    socket: Duplex;
    opaque: TOpaque;
  }
  export interface ResponseData<TOpaque = null> {
    statusCode: number;
    statusText: string;
    headers: IncomingHttpHeaders;
    body: BodyReadable & BodyMixin;
    trailers: Record<string, string>;
    opaque: TOpaque;
    context: object;
  }
  export interface PipelineHandlerData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    opaque: TOpaque;
    body: BodyReadable;
    context: object;
  }
  export interface StreamData<TOpaque = null> {
    opaque: TOpaque;
    trailers: Record<string, string>;
  }
  export interface UpgradeData<TOpaque = null> {
    headers: IncomingHttpHeaders;
    socket: Duplex;
    opaque: TOpaque;
  }
  export interface StreamFactoryData<TOpaque = null> {
    statusCode: number;
    headers: IncomingHttpHeaders;
    opaque: TOpaque;
    context: object;
  }
  export type StreamFactory<TOpaque = null> = (data: StreamFactoryData<TOpaque>) => Writable;
  export interface DispatchController {
    get aborted(): boolean;
    get paused(): boolean;
    get reason(): Error | null;
    abort(reason: Error): void;
    pause(): void;
    resume(): void;
  }
  export interface DispatchHandler {
    onRequestStart?(controller: DispatchController, context: any): void;
    onRequestUpgrade?(controller: DispatchController, statusCode: number, headers: IncomingHttpHeaders, socket: Duplex): void;
    onResponseStart?(controller: DispatchController, statusCode: number, headers: IncomingHttpHeaders, statusMessage?: string): void;
    onResponseData?(controller: DispatchController, chunk: Buffer): void;
    onResponseEnd?(controller: DispatchController, trailers: IncomingHttpHeaders): void;
    onResponseError?(controller: DispatchController, error: Error): void;
    /** Invoked before request is dispatched on socket. May be invoked multiple times when a request is retried when the request at the head of the pipeline fails. */
    /** @deprecated */
    onConnect?(abort: (err?: Error) => void): void;
    /** Invoked when an error has occurred. */
    /** @deprecated */
    onError?(err: Error): void;
    /** Invoked when request is upgraded either due to a `Upgrade` header or `CONNECT` method. */
    /** @deprecated */
    onUpgrade?(statusCode: number, headers: Buffer[] | string[] | null, socket: Duplex): void;
    /** Invoked when response is received, before headers have been read. **/
    /** @deprecated */
    onResponseStarted?(): void;
    /** Invoked when statusCode and headers have been received. May be invoked multiple times due to 1xx informational headers. */
    /** @deprecated */
    onHeaders?(statusCode: number, headers: Buffer[], resume: () => void, statusText: string): boolean;
    /** Invoked when response payload data is received. */
    /** @deprecated */
    onData?(chunk: Buffer): boolean;
    /** Invoked when response payload and trailers have been received and the request has completed. */
    /** @deprecated */
    onComplete?(trailers: string[] | null): void;
    /** Invoked when a body chunk is sent to the server. May be invoked multiple times for chunked requests */
    /** @deprecated */
    onBodySent?(chunkSize: number, totalBytesSent: number): void;
  }
  export type PipelineHandler<TOpaque = null> = (data: PipelineHandlerData<TOpaque>) => Readable;
  export type HttpMethod = Autocomplete<'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'>;
  /**
   * @link https://fetch.spec.whatwg.org/#body-mixin
   */
  interface BodyMixin {
    readonly body?: never;
    readonly bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    blob(): Promise<Blob$1>;
    bytes(): Promise<Uint8Array>;
    formData(): Promise<never>;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }
  export interface DispatchInterceptor {
    (dispatch: Dispatch): Dispatch;
  }
}
//#endregion
//#region node_modules/.pnpm/undici-types@7.24.6/node_modules/undici-types/mock-interceptor.d.ts
/** The scope associated with a mock dispatch. */
declare class MockScope<TData extends object = object> {
  constructor(mockDispatch: MockInterceptor.MockDispatch<TData>);
  /** Delay a reply by a set amount of time in ms. */
  delay(waitInMs: number): MockScope<TData>;
  /** Persist the defined mock data for the associated reply. It will return the defined mock data indefinitely. */
  persist(): MockScope<TData>;
  /** Define a reply for a set amount of matching requests. */
  times(repeatTimes: number): MockScope<TData>;
}
/** The interceptor for a Mock. */
declare class MockInterceptor {
  constructor(options: MockInterceptor.Options, mockDispatches: MockInterceptor.MockDispatch[]);
  /** Mock an undici request with the defined reply. */
  reply<TData extends object = object>(replyOptionsCallback: MockInterceptor.MockReplyOptionsCallback<TData>): MockScope<TData>;
  reply<TData extends object = object>(statusCode: number, data?: TData | Buffer | string | MockInterceptor.MockResponseDataHandler<TData>, responseOptions?: MockInterceptor.MockResponseOptions): MockScope<TData>;
  /** Mock an undici request by throwing the defined reply error. */
  replyWithError<TError extends Error = Error>(error: TError): MockScope;
  /** Set default reply headers on the interceptor for subsequent mocked replies. */
  defaultReplyHeaders(headers: IncomingHttpHeaders): MockInterceptor;
  /** Set default reply trailers on the interceptor for subsequent mocked replies. */
  defaultReplyTrailers(trailers: Record<string, string>): MockInterceptor;
  /** Set automatically calculated content-length header on subsequent mocked replies. */
  replyContentLength(): MockInterceptor;
}
declare namespace MockInterceptor {
  /** MockInterceptor options. */
  export interface Options {
    /** Path to intercept on. */
    path: string | RegExp | ((path: string) => boolean);
    /** Method to intercept on. Defaults to GET. */
    method?: string | RegExp | ((method: string) => boolean);
    /** Body to intercept on. */
    body?: string | RegExp | ((body: string) => boolean);
    /** Headers to intercept on. */
    headers?: Record<string, string | RegExp | ((body: string) => boolean)> | ((headers: Record<string, string>) => boolean);
    /** Query params to intercept on */
    query?: Record<string, any>;
  }
  export interface MockDispatch<TData extends object = object, TError extends Error = Error> extends Options {
    times: number | null;
    persist: boolean;
    consumed: boolean;
    data: MockDispatchData<TData, TError>;
  }
  export interface MockDispatchData<TData extends object = object, TError extends Error = Error> extends MockResponseOptions {
    error: TError | null;
    statusCode?: number;
    data?: TData | string;
  }
  export interface MockResponseOptions {
    headers?: IncomingHttpHeaders;
    trailers?: Record<string, string>;
  }
  export interface MockResponseCallbackOptions {
    path: string;
    method: string;
    headers?: Headers$1 | Record<string, string>;
    origin?: string;
    body?: BodyInit | Dispatcher.DispatchOptions['body'] | null;
  }
  export type MockResponseDataHandler<TData extends object = object> = (opts: MockResponseCallbackOptions) => TData | Buffer | string;
  export type MockReplyOptionsCallback<TData extends object = object> = (opts: MockResponseCallbackOptions) => {
    statusCode: number;
    data?: TData | Buffer | string;
    responseOptions?: MockResponseOptions;
  };
}
//#endregion
//#region node_modules/.pnpm/gaxios@7.1.4/node_modules/gaxios/build/esm/src/common.d.ts
/**
 * TypeScript does not have this type available globally - however `@types/node` includes `undici-types`, which has it:
 * - https://www.npmjs.com/package/@types/node/v/18.19.59?activeTab=dependencies
 *
 * Additionally, this is the TypeScript pattern for type sniffing and `import("undici-types")` is pretty common:
 * - https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/globals.d.ts
 */
type _BodyInit = typeof globalThis extends {
  BodyInit: infer T;
} ? T : BodyInit;
/**
 * An AIP-193 conforming error interface.
 *
 * @see {@link https://google.aip.dev/193#http11json-representation AIP-193}
 *
 * @param res the response object
 * @returns the extracted error information
 */
/**
 * Support `instanceof` operator for `GaxiosError`s in different versions of this library.
 *
 * @see {@link GaxiosError[Symbol.hasInstance]}
 */
declare const GAXIOS_ERROR_SYMBOL: unique symbol;
declare class GaxiosError<T = ReturnType<JSON['parse']>> extends Error {
  config: GaxiosOptionsPrepared;
  response?: GaxiosResponse<T> | undefined;
  /**
   * An error code.
   * Can be a system error code, DOMException error name, or any error's 'code' property where it is a `string`.
   *
   * It is only a `number` when the cause is sourced from an API-level error (AIP-193).
   *
   * @see {@link https://nodejs.org/api/errors.html#errorcode error.code}
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#error_names DOMException#error_names}
   * @see {@link https://google.aip.dev/193#http11json-representation AIP-193}
   *
   * @example
   * 'ECONNRESET'
   *
   * @example
   * 'TimeoutError'
   *
   * @example
   * 500
   */
  code?: string | number;
  /**
   * An HTTP Status code.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Response/status Response#status}
   *
   * @example
   * 500
   */
  status?: number;
  /**
   * @deprecated use {@link GaxiosError.cause} instead.
   *
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause Error#cause}
   *
   * @privateRemarks
   *
   * We will want to remove this property later as the modern `cause` property is better suited
   * for displaying and relaying nested errors. Keeping this here makes the resulting
   * error log larger than it needs to be.
   *
   */
  error?: Error | NodeJS.ErrnoException;
  /**
   * Support `instanceof` operator for `GaxiosError` across builds/duplicated files.
   *
   * @see {@link GAXIOS_ERROR_SYMBOL}
   * @see {@link GaxiosError[Symbol.hasInstance]}
   * @see {@link https://github.com/microsoft/TypeScript/issues/13965#issuecomment-278570200}
   * @see {@link https://stackoverflow.com/questions/46618852/require-and-instanceof}
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/@@hasInstance#reverting_to_default_instanceof_behavior}
   */
  [GAXIOS_ERROR_SYMBOL]: string;
  /**
   * Support `instanceof` operator for `GaxiosError` across builds/duplicated files.
   *
   * @see {@link GAXIOS_ERROR_SYMBOL}
   * @see {@link GaxiosError[GAXIOS_ERROR_SYMBOL]}
   */
  static [Symbol.hasInstance](instance: unknown): boolean;
  constructor(message: string, config: GaxiosOptionsPrepared, response?: GaxiosResponse<T> | undefined, cause?: unknown);
}
type GaxiosResponseData = ReturnType<JSON['parse']> | GaxiosOptionsPrepared['data'];
type GaxiosPromise<T = GaxiosResponseData> = Promise<GaxiosResponse<T>>;
interface GaxiosResponse<T = GaxiosResponseData> extends Response {
  config: GaxiosOptionsPrepared;
  data: T;
}
interface GaxiosMultipartOptions {
  headers: Headers;
  content: string | Readable$1;
}
/**
 * Request options that are used to form the request.
 */
interface GaxiosOptions extends RequestInit {
  /**
   * Optional method to override making the actual HTTP request. Useful
   * for writing tests.
   */
  adapter?: <T = GaxiosResponseData>(options: GaxiosOptionsPrepared, defaultAdapter: (options: GaxiosOptionsPrepared) => GaxiosPromise<T>) => GaxiosPromise<T>;
  url?: string | URL;
  baseURL?: string | URL;
  /**
   * The data to send in the {@link RequestInit.body} of the request. Objects will be
   * serialized as JSON, except for:
   * - `ArrayBuffer`
   * - `Blob`
   * - `Buffer` (Node.js)
   * - `DataView`
   * - `File`
   * - `FormData`
   * - `ReadableStream`
   * - `stream.Readable` (Node.js)
   * - strings
   * - `TypedArray` (e.g. `Uint8Array`, `BigInt64Array`)
   * - `URLSearchParams`
   * - all other objects where:
   *   - headers['Content-Type'] === 'application/x-www-form-urlencoded' (serialized as `URLSearchParams`)
   *
   * In all other cases, if you would like to prevent `application/json` as the
   * default `Content-Type` header you must provide a string or readable stream
   * rather than an object, e.g.:
   *
   * ```ts
   * {data: JSON.stringify({some: 'data'})}
   * {data: fs.readFile('./some-data.jpeg')}
   * ```
   */
  data?: _BodyInit | ArrayBuffer | Blob | Buffer | DataView | File | FormData | ReadableStream | Readable$1 | string | ArrayBufferView | URLSearchParams | {};
  /**
   * The maximum size of the http response `Content-Length` in bytes allowed.
   */
  maxContentLength?: number;
  /**
   * The maximum number of redirects to follow. Defaults to 20.
   *
   * @deprecated non-spec. Should use `20` if enabled per-spec: https://fetch.spec.whatwg.org/#http-redirect-fetch
   */
  maxRedirects?: number;
  /**
   * @deprecated non-spec. Should use `20` if enabled per-spec: https://fetch.spec.whatwg.org/#http-redirect-fetch
   */
  follow?: number;
  /**
   * A collection of parts to send as a `Content-Type: multipart/related` request.
   *
   * This is passed to {@link RequestInit.body}.
   */
  multipart?: GaxiosMultipartOptions[];
  params?: GaxiosResponseData;
  /**
   * @deprecated Use {@link URLSearchParams} instead and pass this directly to {@link GaxiosOptions.data `data`}.
   */
  paramsSerializer?: (params: {
    [index: string]: string | number;
  }) => string;
  /**
   * A timeout for the request, in milliseconds. No timeout by default.
   */
  timeout?: number;
  /**
   * @deprecated ignored
   */
  onUploadProgress?: (progressEvent: GaxiosResponseData) => void;
  /**
   * If the `fetchImplementation` is native `fetch`, the
   * stream is a `ReadableStream`, otherwise `readable.Stream`
   */
  responseType?: 'arraybuffer' | 'blob' | 'json' | 'text' | 'stream' | 'unknown';
  agent?: Agent | ((parsedUrl: URL) => Agent);
  validateStatus?: (status: number) => boolean;
  retryConfig?: RetryConfig;
  retry?: boolean;
  /**
   * @deprecated non-spec. https://github.com/node-fetch/node-fetch/issues/1438
   */
  size?: number;
  /**
   * Implementation of `fetch` to use when making the API call. Will use `fetch` by default.
   *
   * @example
   *
   * let customFetchCalled = false;
   * const myFetch = (...args: Parameters<typeof fetch>) => {
   *  customFetchCalled = true;
   *  return fetch(...args);
   * };
   *
   * {fetchImplementation: myFetch};
   */
  fetchImplementation?: typeof fetch;
  cert?: string;
  key?: string;
  /**
   * An optional proxy to use for requests.
   * Available via `process.env.HTTP_PROXY` and `process.env.HTTPS_PROXY` as well - with a preference for the this config option when multiple are available.
   * The {@link GaxiosOptions.agent `agent`} option overrides this.
   *
   * @see {@link GaxiosOptions.noProxy}
   * @see {@link GaxiosOptions.agent}
   */
  proxy?: string | URL;
  /**
   * A list for excluding traffic for proxies.
   * Available via `process.env.NO_PROXY` as well as a common-separated list of strings - merged with any local `noProxy` rules.
   *
   * - When provided a string, it is matched by
   *   - Wildcard `*.` and `.` matching are available. (e.g. `.example.com` or `*.example.com`)
   * - When provided a URL, it is matched by the `.origin` property.
   *   - For example, requesting `https://example.com` with the following `noProxy`s would result in a no proxy use:
   *     - new URL('https://example.com')
   *     - new URL('https://example.com:443')
   *   - The following would be used with a proxy:
   *     - new URL('http://example.com:80')
   *     - new URL('https://example.com:8443')
   * - When provided a regular expression it is used to match the stringified URL
   *
   * @see {@link GaxiosOptions.proxy}
   */
  noProxy?: (string | URL | RegExp)[];
  /**
   * An experimental error redactor.
   *
   * @remarks
   *
   * This does not replace the requirement for an active Data Loss Prevention (DLP) provider. For DLP suggestions, see:
   * - https://cloud.google.com/sensitive-data-protection/docs/redacting-sensitive-data#dlp_deidentify_replace_infotype-nodejs
   * - https://cloud.google.com/sensitive-data-protection/docs/infotypes-reference#credentials_and_secrets
   *
   * @experimental
   */
  errorRedactor?: typeof defaultErrorRedactor | false;
}
interface GaxiosOptionsPrepared extends GaxiosOptions {
  headers: Headers;
  url: URL;
}
/**
 * Gaxios retry configuration.
 */
interface RetryConfig {
  /**
   * The number of times to retry the request.  Defaults to 3.
   */
  retry?: number;
  /**
   * The number of retries already attempted.
   */
  currentRetryAttempt?: number;
  /**
   * The amount of time to initially delay the retry, in ms.  Defaults to 100ms.
   */
  retryDelay?: number;
  /**
   * The HTTP Methods that will be automatically retried.
   * Defaults to ['GET','PUT','HEAD','OPTIONS','DELETE']
   */
  httpMethodsToRetry?: string[];
  /**
   * The HTTP response status codes that will automatically be retried.
   * Defaults to: [[100, 199], [408, 408], [429, 429], [500, 599]]
   */
  statusCodesToRetry?: number[][];
  /**
   * Function to invoke when a retry attempt is made.
   */
  onRetryAttempt?: (err: GaxiosError) => Promise<void> | void;
  /**
   * Function to invoke which determines if you should retry
   */
  shouldRetry?: (err: GaxiosError) => Promise<boolean> | boolean;
  /**
   * When there is no response, the number of retries to attempt. Defaults to 2.
   */
  noResponseRetries?: number;
  /**
   * Function to invoke which returns a promise. After the promise resolves,
   * the retry will be triggered. If provided, this will be used in-place of
   * the `retryDelay`
   */
  retryBackoff?: (err: GaxiosError, defaultBackoffMs: number) => Promise<void>;
  /**
   * Time that the initial request was made. Users should not set this directly.
   */
  timeOfFirstRequest?: number;
  /**
   * The length of time to keep retrying in ms. The last sleep period will
   * be shortened as necessary, so that the last retry runs at deadline (and not
   * considerably beyond it).  The total time starting from when the initial
   * request is sent, after which an error will be returned, regardless of the
   * retrying attempts made meanwhile. Defaults to Number.MAX_SAFE_INTEGER indicating to effectively
   * ignore totalTimeout.
   */
  totalTimeout?: number;
  maxRetryDelay?: number;
  retryDelayMultiplier?: number;
}
/**
 * An experimental error redactor.
 *
 * @param config Config to potentially redact properties of
 * @param response Config to potentially redact properties of
 *
 * @experimental
 */
declare function defaultErrorRedactor<O extends GaxiosOptionsPrepared, R extends GaxiosResponse<GaxiosResponseData>>(data: {
  config?: O;
  response?: R;
}): {
  config?: O;
  response?: R;
};
//#endregion
//#region node_modules/.pnpm/gaxios@7.1.4/node_modules/gaxios/build/esm/src/interceptor.d.ts
/**
 * Interceptors that can be run for requests or responses. These interceptors run asynchronously.
 */
interface GaxiosInterceptor<T extends GaxiosOptionsPrepared | GaxiosResponse> {
  /**
   * Function to be run when applying an interceptor.
   *
   * @param {T} configOrResponse The current configuration or response.
   * @returns {Promise<T>} Promise that resolves to the modified set of options or response.
   */
  resolved?: (configOrResponse: T) => Promise<T>;
  /**
   * Function to be run if the previous call to resolved throws / rejects or the request results in an invalid status
   * as determined by the call to validateStatus.
   *
   * @param {GaxiosError} err The error thrown from the previously called resolved function.
   */
  rejected?: (err: GaxiosError) => void;
}
/**
 * Class to manage collections of GaxiosInterceptors for both requests and responses.
 */
declare class GaxiosInterceptorManager<T extends GaxiosOptionsPrepared | GaxiosResponse> extends Set<GaxiosInterceptor<T> | null> {}
//#endregion
//#region node_modules/.pnpm/gaxios@7.1.4/node_modules/gaxios/build/esm/src/gaxios.d.ts
/**
 * An interface for enforcing `fetch`-type compliance.
 *
 * @remarks
 *
 * This provides type guarantees during build-time, ensuring the `fetch` method is 1:1
 * compatible with the `fetch` API.
 */
interface FetchCompliance {
  fetch: typeof fetch;
}
declare class Gaxios implements FetchCompliance {
  #private;
  protected agentCache: Map<string | URL, Agent | ((parsedUrl: URL) => Agent)>;
  /**
   * Default HTTP options that will be used for every HTTP request.
   */
  defaults: GaxiosOptions;
  /**
   * Interceptors
   */
  interceptors: {
    request: GaxiosInterceptorManager<GaxiosOptionsPrepared>;
    response: GaxiosInterceptorManager<GaxiosResponse>;
  };
  /**
   * The Gaxios class is responsible for making HTTP requests.
   * @param defaults The default set of options to be used for this instance.
   */
  constructor(defaults?: GaxiosOptions);
  /**
   * A {@link fetch `fetch`} compliant API for {@link Gaxios}.
   *
   * @remarks
   *
   * This is useful as a drop-in replacement for `fetch` API usage.
   *
   * @example
   *
   * ```ts
   * const gaxios = new Gaxios();
   * const myFetch: typeof fetch = (...args) => gaxios.fetch(...args);
   * await myFetch('https://example.com');
   * ```
   *
   * @param args `fetch` API or `Gaxios#request` parameters
   * @returns the {@link Response} with Gaxios-added properties
   */
  fetch<T = unknown>(...args: Parameters<typeof fetch> | Parameters<Gaxios['request']>): GaxiosPromise<T>;
  /**
   * Perform an HTTP request with the given options.
   * @param opts Set of HTTP options that will be used for this HTTP request.
   */
  request<T = ReturnType<JSON['parse']>>(opts?: GaxiosOptions): GaxiosPromise<T>;
  private _defaultAdapter;
  /**
   * Internal, retryable version of the `request` method.
   * @param opts Set of HTTP options that will be used for this HTTP request.
   */
  protected _request<T = ReturnType<JSON['parse']>>(opts: GaxiosOptionsPrepared): GaxiosPromise<T>;
  private getResponseData;
  /**
   * By default, throw for any non-2xx status code
   * @param status status code from the HTTP response
   */
  private validateStatus;
  /**
   * Attempts to parse a response by looking at the Content-Type header.
   * @param {Response} response the HTTP response.
   * @returns a promise that resolves to the response data.
   */
  private getResponseDataFromContentType;
  /**
   * Creates an async generator that yields the pieces of a multipart/related request body.
   * This implementation follows the spec: https://www.ietf.org/rfc/rfc2387.txt. However, recursive
   * multipart/related requests are not currently supported.
   *
   * @param {GaxiosMultipartOptions[]} multipartOptions the pieces to turn into a multipart/related body.
   * @param {string} boundary the boundary string to be placed between each part.
   */
  private getMultipartRequest;
  /**
   * Merges headers.
   * If the base headers do not exist a new `Headers` object will be returned.
   *
   * @remarks
   *
   * Using this utility can be helpful when the headers are not known to exist:
   * - if they exist as `Headers`, that instance will be used
   *   - it improves performance and allows users to use their existing references to their `Headers`
   * - if they exist in another form (`HeadersInit`), they will be used to create a new `Headers` object
   * - if the base headers do not exist a new `Headers` object will be created
   *
   * @param base headers to append/overwrite to
   * @param append headers to append/overwrite with
   * @returns the base headers instance with merged `Headers`
   */
  static mergeHeaders(base?: HeadersInit$2, ...append: HeadersInit$2[]): Headers;
}
type HeadersInit$2 = ConstructorParameters<typeof Headers>[0];
declare namespace index_d_exports$2 {
  export { Gaxios, GaxiosError, GaxiosInterceptor, GaxiosInterceptorManager, GaxiosOptions, GaxiosOptionsPrepared, GaxiosPromise, GaxiosResponse, RetryConfig, instance$1 as instance, request };
}
/**
 * The default instance used when the `request` method is directly
 * invoked.
 */
declare const instance$1: Gaxios;
/**
 * Make an HTTP request using the given options.
 * @param opts Options for the request
 */
declare function request<T>(opts: GaxiosOptions): Promise<GaxiosResponse<T>>;
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/credentials.d.ts
interface Credentials {
  /**
   * This field is only present if the access_type parameter was set to offline in the authentication request. For details, see Refresh tokens.
   */
  refresh_token?: string | null;
  /**
   * The time in ms at which this token is thought to expire.
   */
  expiry_date?: number | null;
  /**
   * A token that can be sent to a Google API.
   */
  access_token?: string | null;
  /**
   * Identifies the type of token returned. At this time, this field always has the value Bearer.
   */
  token_type?: string | null;
  /**
   * A JWT that contains identity information about the user that is digitally signed by Google.
   */
  id_token?: string | null;
  /**
   * The scopes of access granted by the access_token expressed as a list of space-delimited, case-sensitive strings.
   */
  scope?: string;
}
interface CredentialRequest {
  /**
   * This field is only present if the access_type parameter was set to offline in the authentication request. For details, see Refresh tokens.
   */
  refresh_token?: string;
  /**
   * A token that can be sent to a Google API.
   */
  access_token?: string;
  /**
   * Identifies the type of token returned. At this time, this field always has the value Bearer.
   */
  token_type?: string;
  /**
   * The remaining lifetime of the access token in seconds.
   */
  expires_in?: number;
  /**
   * A JWT that contains identity information about the user that is digitally signed by Google.
   */
  id_token?: string;
  /**
   * The scopes of access granted by the access_token expressed as a list of space-delimited, case-sensitive strings.
   */
  scope?: string;
}
interface JWTInput {
  type?: string;
  client_email?: string;
  private_key?: string;
  private_key_id?: string;
  project_id?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  quota_project_id?: string;
  universe_domain?: string;
}
interface ImpersonatedJWTInput {
  type?: string;
  source_credentials?: JWTInput;
  service_account_impersonation_url?: string;
  delegates?: string[];
  scopes?: string[];
}
interface CredentialBody {
  client_email?: string;
  private_key?: string;
  universe_domain?: string;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/crypto/shared.d.ts
interface JwkCertificate {
  kty: string;
  alg: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}
//#endregion
//#region node_modules/.pnpm/google-logging-utils@1.1.3/node_modules/google-logging-utils/build/src/logging-utils.d.ts
/**
 * This module defines an ad-hoc debug logger for Google Cloud Platform
 * client libraries in Node. An ad-hoc debug logger is a tool which lets
 * users use an external, unified interface (in this case, environment
 * variables) to determine what logging they want to see at runtime. This
 * isn't necessarily fed into the console, but is meant to be under the
 * control of the user. The kind of logging that will be produced by this
 * is more like "call retry happened", not "events you'd want to record
 * in Cloud Logger".
 *
 * More for Googlers implementing libraries with it:
 * go/cloud-client-logging-design
 */
/**
 * Possible log levels. These are a subset of Cloud Observability levels.
 * https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
 */
declare enum LogSeverity {
  DEFAULT = "DEFAULT",
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR"
}
/**
 * A set of suggested log metadata fields.
 */
interface LogFields {
  /**
   * Log level - undefined/null === DEFAULT.
   */
  severity?: LogSeverity;
  /**
   * If this log is associated with an OpenTelemetry trace, you can put the
   * trace ID here to pass on that association.
   */
  telemetryTraceId?: string;
  /**
   * If this log is associated with an OpenTelemetry trace, you can put the
   * span ID here to pass on that association.
   */
  telemetrySpanId?: string;
  /**
   * This is a catch-all for any other items you might want to go into
   * structured logs. Library implementers, please see the spec docs above
   * for the items envisioned to go here.
   */
  other?: unknown;
}
/**
 * Adds typings for event sinks.
 */
declare interface AdhocDebugLogger {
  on(event: 'log', listener: (fields: LogFields, args: unknown[]) => void): this;
  on(event: string, listener: Function): this;
}
/**
 * Our logger instance. This actually contains the meat of dealing
 * with log lines, including EventEmitter. This contains the function
 * that will be passed back to users of the package.
 */
declare class AdhocDebugLogger extends EventEmitter$1 {
  namespace: string;
  upstream: AdhocDebugLogCallable;
  func: AdhocDebugLogFunction;
  /**
   * @param upstream The backend will pass a function that will be
   *   called whenever our logger function is invoked.
   */
  constructor(namespace: string, upstream: AdhocDebugLogCallable);
  invoke(fields: LogFields, ...args: unknown[]): void;
  invokeSeverity(severity: LogSeverity, ...args: unknown[]): void;
}
/**
 * When the user receives a log function (below), this will be the basic function
 * call interface for it.
 */
interface AdhocDebugLogCallable {
  (fields: LogFields, ...args: unknown[]): void;
}
/**
 * Adds typing info for the EventEmitter we're adding to the returned function.
 *
 * Note that this interface may change at any time, as we're reserving the
 * right to add new backends at the logger level.
 *
 * @private
 * @internal
 */
interface AdhocDebugLogFunction extends AdhocDebugLogCallable {
  instance: AdhocDebugLogger;
  on(event: 'log', listener: (fields: LogFields, args: unknown[]) => void): this;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  sublog(namespace: string): AdhocDebugLogFunction;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/util.d.ts
/**
 * A utility for converting snake_case to camelCase.
 *
 * For, for example `my_snake_string` becomes `mySnakeString`.
 */
type SnakeToCamel<S> = S extends `${infer FirstWord}_${infer Remainder}` ? `${FirstWord}${Capitalize<SnakeToCamel<Remainder>>}` : S;
/**
 * A utility for converting an type's keys from snake_case
 * to camelCase, if the keys are strings.
 *
 * For example:
 *
 * ```ts
 * {
 *   my_snake_string: boolean;
 *   myCamelString: string;
 *   my_snake_obj: {
 *     my_snake_obj_string: string;
 *   };
 * }
 * ```
 *
 * becomes:
 *
 * ```ts
 * {
 *   mySnakeString: boolean;
 *   myCamelString: string;
 *   mySnakeObj: {
 *     mySnakeObjString: string;
 *   }
 * }
 * ```
 *
 * @remarks
 *
 * The generated documentation for the camelCase'd properties won't be available
 * until {@link https://github.com/microsoft/TypeScript/issues/50715} has been
 * resolved.
 */
type SnakeToCamelObject<T> = { [K in keyof T as SnakeToCamel<K>]: T[K] extends {} ? SnakeToCamelObject<T[K]> : T[K] };
/**
 * A utility for adding camelCase versions of a type's snake_case keys, if the
 * keys are strings, preserving any existing keys.
 *
 * For example:
 *
 * ```ts
 * {
 *   my_snake_boolean: boolean;
 *   myCamelString: string;
 *   my_snake_obj: {
 *     my_snake_obj_string: string;
 *   };
 * }
 * ```
 *
 * becomes:
 *
 * ```ts
 * {
 *   my_snake_boolean: boolean;
 *   mySnakeBoolean: boolean;
 *   myCamelString: string;
 *   my_snake_obj: {
 *     my_snake_obj_string: string;
 *   };
 *   mySnakeObj: {
 *     mySnakeObjString: string;
 *   }
 * }
 * ```
 * @remarks
 *
 * The generated documentation for the camelCase'd properties won't be available
 * until {@link https://github.com/microsoft/TypeScript/issues/50715} has been
 * resolved.
 *
 * Tracking: {@link https://github.com/googleapis/google-auth-library-nodejs/issues/1686}
 */
type OriginalAndCamel<T> = { [K in keyof T as K | SnakeToCamel<K>]: T[K] extends {} ? OriginalAndCamel<T[K]> : T[K] };
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/authclient.d.ts
/**
 * An interface for enforcing `fetch`-type compliance.
 *
 * @remarks
 *
 * This provides type guarantees during build-time, ensuring the `fetch` method is 1:1
 * compatible with the `Gaxios#fetch` API.
 */
interface GaxiosFetchCompliance {
  fetch: typeof fetch | Gaxios['fetch'];
}
/**
 * Easy access to symbol-indexed strings on config objects.
 */
/**
 * Base auth configurations (e.g. from JWT or `.json` files) with conventional
 * camelCased options.
 *
 * @privateRemarks
 *
 * This interface is purposely not exported so that it can be removed once
 * {@link https://github.com/microsoft/TypeScript/issues/50715} has been
 * resolved. Then, we can use {@link OriginalAndCamel} to shrink this interface.
 *
 * Tracking: {@link https://github.com/googleapis/google-auth-library-nodejs/issues/1686}
 */
interface AuthJSONOptions {
  /**
   * The project ID corresponding to the current credentials if available.
   */
  project_id: string | null;
  /**
   * An alias for {@link AuthJSONOptions.project_id `project_id`}.
   */
  projectId: AuthJSONOptions['project_id'];
  /**
   * The quota project ID. The quota project can be used by client libraries for the billing purpose.
   * See {@link https://cloud.google.com/docs/quota Working with quotas}
   */
  quota_project_id: string;
  /**
   * An alias for {@link AuthJSONOptions.quota_project_id `quota_project_id`}.
   */
  quotaProjectId: AuthJSONOptions['quota_project_id'];
  /**
   * The default service domain for a given Cloud universe.
   *
   * @example
   * 'googleapis.com'
   */
  universe_domain: string;
  /**
   * An alias for {@link AuthJSONOptions.universe_domain `universe_domain`}.
   */
  universeDomain: AuthJSONOptions['universe_domain'];
}
/**
 * Base `AuthClient` configuration.
 *
 * The camelCased options are aliases of the snake_cased options, supporting both
 * JSON API and JS conventions.
 */
interface AuthClientOptions extends Partial<OriginalAndCamel<AuthJSONOptions>> {
  /**
   * An API key to use, optional.
   */
  apiKey?: string;
  credentials?: Credentials;
  /**
   * The {@link Gaxios `Gaxios`} instance used for making requests.
   *
   * @see {@link AuthClientOptions.useAuthRequestParameters}
   */
  transporter?: Gaxios;
  /**
   * Provides default options to the transporter, such as {@link GaxiosOptions.agent `agent`} or
   *  {@link GaxiosOptions.retryConfig `retryConfig`}.
   *
   * This option is ignored if {@link AuthClientOptions.transporter `gaxios`} has been provided
   */
  transporterOptions?: GaxiosOptions;
  /**
   * The expiration threshold in milliseconds before forcing token refresh of
   * unexpired tokens.
   */
  eagerRefreshThresholdMillis?: number;
  /**
   * Whether to attempt to refresh tokens on status 401/403 responses
   * even if an attempt is made to refresh the token preemptively based
   * on the expiry_date.
   */
  forceRefreshOnFailure?: boolean;
  /**
   * Enables/disables the adding of the AuthClient's default interceptor.
   *
   * @see {@link AuthClientOptions.transporter}
   *
   * @remarks
   *
   * Disabling is useful for debugging and experimentation.
   *
   * @default true
   */
  useAuthRequestParameters?: boolean;
}
/**
 * The default cloud universe
 *
 * @see {@link AuthJSONOptions.universe_domain}
 */
declare const DEFAULT_UNIVERSE = "googleapis.com";
/**
 * Defines the root interface for all clients that generate credentials
 * for calling Google APIs. All clients should implement this interface.
 */
interface CredentialsClient {
  projectId?: AuthClientOptions['projectId'];
  eagerRefreshThresholdMillis: NonNullable<AuthClientOptions['eagerRefreshThresholdMillis']>;
  forceRefreshOnFailure: NonNullable<AuthClientOptions['forceRefreshOnFailure']>;
  /**
   * @return A promise that resolves with the current GCP access token
   *   response. If the current credential is expired, a new one is retrieved.
   */
  getAccessToken(): Promise<GetAccessTokenResponse>;
  /**
   * The main authentication interface. It takes an optional url which when
   * present is the endpoint being accessed, and returns a Promise which
   * resolves with authorization header fields.
   *
   * The result has the form:
   * { authorization: 'Bearer <access_token_value>' }
   * @param url The URI being authorized.
   */
  getRequestHeaders(url?: string | URL): Promise<Headers>;
  /**
   * Provides an alternative Gaxios request implementation with auth credentials
   */
  request<T>(opts: GaxiosOptions): GaxiosPromise<T>;
  /**
   * Sets the auth credentials.
   */
  setCredentials(credentials: Credentials): void;
  /**
   * Subscribes a listener to the tokens event triggered when a token is
   * generated.
   *
   * @param event The tokens event to subscribe to.
   * @param listener The listener that triggers on event trigger.
   * @return The current client instance.
   */
  on(event: 'tokens', listener: (tokens: Credentials) => void): this;
}
declare interface AuthClient {
  on(event: 'tokens', listener: (tokens: Credentials) => void): this;
}
/**
 * The base of all Auth Clients.
 */
declare abstract class AuthClient extends EventEmitter$1 implements CredentialsClient, GaxiosFetchCompliance {
  apiKey?: string;
  projectId?: string | null;
  /**
   * The quota project ID. The quota project can be used by client libraries for the billing purpose.
   * See {@link https://cloud.google.com/docs/quota Working with quotas}
   */
  quotaProjectId?: string;
  /**
   * The {@link Gaxios `Gaxios`} instance used for making requests.
   */
  transporter: Gaxios;
  credentials: Credentials;
  eagerRefreshThresholdMillis: number;
  forceRefreshOnFailure: boolean;
  universeDomain: string;
  /**
   * Symbols that can be added to GaxiosOptions to specify the method name that is
   * making an RPC call, for logging purposes, as well as a string ID that can be
   * used to correlate calls and responses.
   */
  static readonly RequestMethodNameSymbol: unique symbol;
  static readonly RequestLogIdSymbol: unique symbol;
  constructor(opts?: AuthClientOptions);
  /**
   * A {@link fetch `fetch`} compliant API for {@link AuthClient}.
   *
   * @see {@link AuthClient.request} for the classic method.
   *
   * @remarks
   *
   * This is useful as a drop-in replacement for `fetch` API usage.
   *
   * @example
   *
   * ```ts
   * const authClient = new AuthClient();
   * const fetchWithAuthClient: typeof fetch = (...args) => authClient.fetch(...args);
   * await fetchWithAuthClient('https://example.com');
   * ```
   *
   * @param args `fetch` API or {@link Gaxios.fetch `Gaxios#fetch`} parameters
   * @returns the {@link GaxiosResponse} with Gaxios-added properties
   */
  fetch<T>(...args: Parameters<Gaxios['fetch']>): GaxiosPromise<T>;
  /**
   * The public request API in which credentials may be added to the request.
   *
   * @see {@link AuthClient.fetch} for the modern method.
   *
   * @param options options for `gaxios`
   */
  abstract request<T>(options: GaxiosOptions): GaxiosPromise<T>;
  /**
   * The main authentication interface. It takes an optional url which when
   * present is the endpoint being accessed, and returns a Promise which
   * resolves with authorization header fields.
   *
   * The result has the form:
   * ```ts
   * new Headers({'authorization': 'Bearer <access_token_value>'});
   * ```
   *
   * @param url The URI being authorized.
   */
  abstract getRequestHeaders(url?: string | URL): Promise<Headers>;
  /**
   * @return A promise that resolves with the current GCP access token
   *   response. If the current credential is expired, a new one is retrieved.
   */
  abstract getAccessToken(): Promise<{
    token?: string | null;
    res?: GaxiosResponse | null;
  }>;
  /**
   * Sets the auth credentials.
   */
  setCredentials(credentials: Credentials): void;
  /**
   * Append additional headers, e.g., x-goog-user-project, shared across the
   * classes inheriting AuthClient. This method should be used by any method
   * that overrides getRequestMetadataAsync(), which is a shared helper for
   * setting request information in both gRPC and HTTP API calls.
   *
   * @param headers object to append additional headers to.
   */
  protected addSharedMetadataHeaders(headers: Headers): Headers;
  /**
   * Adds the `x-goog-user-project` and `authorization` headers to the target Headers
   * object, if they exist on the source.
   *
   * @param target the headers to target
   * @param source the headers to source from
   * @returns the target headers
   */
  protected addUserProjectAndAuthHeaders<T extends Headers>(target: T, source: Headers): T;
  static log: AdhocDebugLogFunction;
  static readonly DEFAULT_REQUEST_INTERCEPTOR: Parameters<Gaxios['interceptors']['request']['add']>[0];
  static readonly DEFAULT_RESPONSE_INTERCEPTOR: Parameters<Gaxios['interceptors']['response']['add']>[0];
  /**
   * Sets the method name that is making a Gaxios request, so that logging may tag
   * log lines with the operation.
   * @param config A Gaxios request config
   * @param methodName The method name making the call
   */
  static setMethodName(config: GaxiosOptions, methodName: string): void;
  /**
   * Retry config for Auth-related requests.
   *
   * @remarks
   *
   * This is not a part of the default {@link AuthClient.transporter transporter/gaxios}
   * config as some downstream APIs would prefer if customers explicitly enable retries,
   * such as GCS.
   */
  protected static get RETRY_CONFIG(): GaxiosOptions;
}
type HeadersInit$1 = ConstructorParameters<typeof Headers>[0];
interface GetAccessTokenResponse {
  token?: string | null;
  res?: GaxiosResponse | null;
}
/**
 * @deprecated - use the Promise API instead
 */
interface BodyResponseCallback<T> {
  (err: Error | null, res?: GaxiosResponse<T> | null): void;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/loginticket.d.ts
declare class LoginTicket {
  private envelope?;
  private payload?;
  /**
   * Create a simple class to extract user ID from an ID Token
   *
   * @param {string} env Envelope of the jwt
   * @param {TokenPayload} pay Payload of the jwt
   * @constructor
   */
  constructor(env?: string, pay?: TokenPayload);
  getEnvelope(): string | undefined;
  getPayload(): TokenPayload | undefined;
  /**
   * Create a simple class to extract user ID from an ID Token
   *
   * @return The user ID
   */
  getUserId(): string | null;
  /**
   * Returns attributes from the login ticket.  This can contain
   * various information about the user session.
   *
   * @return The envelope and payload
   */
  getAttributes(): {
    envelope: string | undefined;
    payload: TokenPayload | undefined;
  };
}
interface TokenPayload {
  /**
   * The Issuer Identifier for the Issuer of the response. Always
   * https://accounts.google.com or accounts.google.com for Google ID tokens.
   */
  iss: string;
  /**
   * Access token hash. Provides validation that the access token is tied to the
   * identity token. If the ID token is issued with an access token in the
   * server flow, this is always included. This can be used as an alternate
   * mechanism to protect against cross-site request forgery attacks, but if you
   * follow Step 1 and Step 3 it is not necessary to verify the access token.
   */
  at_hash?: string;
  /**
   * True if the user's e-mail address has been verified; otherwise false.
   */
  email_verified?: boolean;
  /**
   * An identifier for the user, unique among all Google accounts and never
   * reused. A Google account can have multiple emails at different points in
   * time, but the sub value is never changed. Use sub within your application
   * as the unique-identifier key for the user.
   */
  sub: string;
  /**
   * The client_id of the authorized presenter. This claim is only needed when
   * the party requesting the ID token is not the same as the audience of the ID
   * token. This may be the case at Google for hybrid apps where a web
   * application and Android app have a different client_id but share the same
   * project.
   */
  azp?: string;
  /**
   * The user's email address. This may not be unique and is not suitable for
   * use as a primary key. Provided only if your scope included the string
   * "email".
   */
  email?: string;
  /**
   * The URL of the user's profile page. Might be provided when:
   * - The request scope included the string "profile"
   * - The ID token is returned from a token refresh
   * - When profile claims are present, you can use them to update your app's
   * user records. Note that this claim is never guaranteed to be present.
   */
  profile?: string;
  /**
   * The URL of the user's profile picture. Might be provided when:
   * - The request scope included the string "profile"
   * - The ID token is returned from a token refresh
   * - When picture claims are present, you can use them to update your app's
   * user records. Note that this claim is never guaranteed to be present.
   */
  picture?: string;
  /**
   * The user's full name, in a displayable form. Might be provided when:
   * - The request scope included the string "profile"
   * - The ID token is returned from a token refresh
   * - When name claims are present, you can use them to update your app's user
   * records. Note that this claim is never guaranteed to be present.
   */
  name?: string;
  /**
   * The user's given name, in a displayable form. Might be provided when:
   * - The request scope included the string "profile"
   * - The ID token is returned from a token refresh
   * - When name claims are present, you can use them to update your app's user
   * records. Note that this claim is never guaranteed to be present.
   */
  given_name?: string;
  /**
   * The user's family name, in a displayable form. Might be provided when:
   * - The request scope included the string "profile"
   * - The ID token is returned from a token refresh
   * - When name claims are present, you can use them to update your app's user
   * records. Note that this claim is never guaranteed to be present.
   */
  family_name?: string;
  /**
   * Identifies the audience that this ID token is intended for. It must be one
   * of the OAuth 2.0 client IDs of your application.
   */
  aud: string;
  /**
   * The time the ID token was issued, represented in Unix time (integer
   * seconds).
   */
  iat: number;
  /**
   * The time the ID token expires, represented in Unix time (integer seconds).
   */
  exp: number;
  /**
   * The value of the nonce supplied by your app in the authentication request.
   * You should enforce protection against replay attacks by ensuring it is
   * presented only once.
   */
  nonce?: string;
  /**
   * The hosted G Suite domain of the user. Provided only if the user belongs to
   * a hosted domain.
   */
  hd?: string;
  /**
   * The user's locale, represented by a BCP 47 language tag.
   * Might be provided when a name claim is present.
   */
  locale?: string;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/oauth2client.d.ts
/**
 * The results from the `generateCodeVerifierAsync` method.  To learn more,
 * See the sample:
 * https://github.com/googleapis/google-auth-library-nodejs/blob/main/samples/oauth2-codeVerifier.js
 */
interface CodeVerifierResults {
  /**
   * The code verifier that will be used when calling `getToken` to obtain a new
   * access token.
   */
  codeVerifier: string;
  /**
   * The code_challenge that should be sent with the `generateAuthUrl` call
   * to obtain a verifiable authentication url.
   */
  codeChallenge?: string;
}
interface Certificates {
  [index: string]: string | JwkCertificate;
}
interface PublicKeys {
  [index: string]: string;
}
declare enum CodeChallengeMethod {
  Plain = "plain",
  S256 = "S256"
}
declare enum CertificateFormat {
  PEM = "PEM",
  JWK = "JWK"
}
/**
 * The client authentication type. Supported values are basic, post, and none.
 * https://datatracker.ietf.org/doc/html/rfc7591#section-2
 */
declare enum ClientAuthentication$1 {
  ClientSecretPost = "ClientSecretPost",
  ClientSecretBasic = "ClientSecretBasic",
  None = "None"
}
interface GetTokenOptions$1 {
  code: string;
  codeVerifier?: string;
  /**
   * The client ID for your application. The value passed into the constructor
   * will be used if not provided. Must match any client_id option passed to
   * a corresponding call to generateAuthUrl.
   */
  client_id?: string;
  /**
   * Determines where the API server redirects the user after the user
   * completes the authorization flow. The value passed into the constructor
   * will be used if not provided. Must match any redirect_uri option passed to
   * a corresponding call to generateAuthUrl.
   */
  redirect_uri?: string;
}
interface TokenInfo {
  /**
   * The application that is the intended user of the access token.
   */
  aud: string;
  /**
   * This value lets you correlate profile information from multiple Google
   * APIs. It is only present in the response if you included the profile scope
   * in your request in step 1. The field value is an immutable identifier for
   * the logged-in user that can be used to create and manage user sessions in
   * your application. The identifier is the same regardless of which client ID
   * is used to retrieve it. This enables multiple applications in the same
   * organization to correlate profile information.
   */
  user_id?: string;
  /**
   * An array of scopes that the user granted access to.
   */
  scopes: string[];
  /**
   * The datetime when the token becomes invalid.
   */
  expiry_date: number;
  /**
   * An identifier for the user, unique among all Google accounts and never
   * reused. A Google account can have multiple emails at different points in
   * time, but the sub value is never changed. Use sub within your application
   * as the unique-identifier key for the user.
   */
  sub?: string;
  /**
   * The client_id of the authorized presenter. This claim is only needed when
   * the party requesting the ID token is not the same as the audience of the ID
   * token. This may be the case at Google for hybrid apps where a web
   * application and Android app have a different client_id but share the same
   * project.
   */
  azp?: string;
  /**
   * Indicates whether your application can refresh access tokens
   * when the user is not present at the browser. Valid parameter values are
   * 'online', which is the default value, and 'offline'. Set the value to
   * 'offline' if your application needs to refresh access tokens when the user
   * is not present at the browser. This value instructs the Google
   * authorization server to return a refresh token and an access token the
   * first time that your application exchanges an authorization code for
   * tokens.
   */
  access_type?: string;
  /**
   * The user's email address. This value may not be unique to this user and
   * is not suitable for use as a primary key. Provided only if your scope
   * included the email scope value.
   */
  email?: string;
  /**
   * True if the user's e-mail address has been verified; otherwise false.
   */
  email_verified?: boolean;
}
interface GenerateAuthUrlOpts {
  /**
   * Recommended. Indicates whether your application can refresh access tokens
   * when the user is not present at the browser. Valid parameter values are
   * 'online', which is the default value, and 'offline'. Set the value to
   * 'offline' if your application needs to refresh access tokens when the user
   * is not present at the browser. This value instructs the Google
   * authorization server to return a refresh token and an access token the
   * first time that your application exchanges an authorization code for
   * tokens.
   */
  access_type?: string;
  /**
   * The hd (hosted domain) parameter streamlines the login process for G Suite
   * hosted accounts. By including the domain of the G Suite user (for example,
   * mycollege.edu), you can indicate that the account selection UI should be
   * optimized for accounts at that domain. To optimize for G Suite accounts
   * generally instead of just one domain, use an asterisk: hd=*.
   * Don't rely on this UI optimization to control who can access your app,
   * as client-side requests can be modified. Be sure to validate that the
   * returned ID token has an hd claim value that matches what you expect
   * (e.g. mycolledge.edu). Unlike the request parameter, the ID token claim is
   * contained within a security token from Google, so the value can be trusted.
   */
  hd?: string;
  /**
   * The 'response_type' will always be set to 'CODE'.
   */
  response_type?: string;
  /**
   * The client ID for your application. The value passed into the constructor
   * will be used if not provided. You can find this value in the API Console.
   */
  client_id?: string;
  /**
   * Determines where the API server redirects the user after the user
   * completes the authorization flow. The value must exactly match one of the
   * 'redirect_uri' values listed for your project in the API Console. Note that
   * the http or https scheme, case, and trailing slash ('/') must all match.
   * The value passed into the constructor will be used if not provided.
   */
  redirect_uri?: string;
  /**
   * Required. A space-delimited list of scopes that identify the resources that
   * your application could access on the user's behalf. These values inform the
   * consent screen that Google displays to the user. Scopes enable your
   * application to only request access to the resources that it needs while
   * also enabling users to control the amount of access that they grant to your
   * application. Thus, there is an inverse relationship between the number of
   * scopes requested and the likelihood of obtaining user consent. The
   * OAuth 2.0 API Scopes document provides a full list of scopes that you might
   * use to access Google APIs. We recommend that your application request
   * access to authorization scopes in context whenever possible. By requesting
   * access to user data in context, via incremental authorization, you help
   * users to more easily understand why your application needs the access it is
   * requesting.
   */
  scope?: string[] | string;
  /**
   * Recommended. Specifies any string value that your application uses to
   * maintain state between your authorization request and the authorization
   * server's response. The server returns the exact value that you send as a
   * name=value pair in the hash (#) fragment of the 'redirect_uri' after the
   * user consents to or denies your application's access request. You can use
   * this parameter for several purposes, such as directing the user to the
   * correct resource in your application, sending nonces, and mitigating
   * cross-site request forgery. Since your redirect_uri can be guessed, using a
   * state value can increase your assurance that an incoming connection is the
   * result of an authentication request. If you generate a random string or
   * encode the hash of a cookie or another value that captures the client's
   * state, you can validate the response to additionally ensure that the
   * request and response originated in the same browser, providing protection
   * against attacks such as cross-site request forgery. See the OpenID Connect
   * documentation for an example of how to create and confirm a state token.
   */
  state?: string;
  /**
   * Optional. Enables applications to use incremental authorization to request
   * access to additional scopes in context. If you set this parameter's value
   * to true and the authorization request is granted, then the new access token
   * will also cover any scopes to which the user previously granted the
   * application access. See the incremental authorization section for examples.
   */
  include_granted_scopes?: boolean;
  /**
   * Optional. If your application knows which user is trying to authenticate,
   * it can use this parameter to provide a hint to the Google Authentication
   * Server. The server uses the hint to simplify the login flow either by
   * prefilling the email field in the sign-in form or by selecting the
   * appropriate multi-login session. Set the parameter value to an email
   * address or sub identifier, which is equivalent to the user's Google ID.
   */
  login_hint?: string;
  /**
   * Optional. A space-delimited, case-sensitive list of prompts to present the
   * user. If you don't specify this parameter, the user will be prompted only
   * the first time your app requests access.  Possible values are:
   *
   * 'none' - Donot display any authentication or consent screens. Must not be
   *        specified with other values.
   * 'consent' - 	Prompt the user for consent.
   * 'select_account' - Prompt the user to select an account.
   */
  prompt?: string;
  /**
   * Recommended. Specifies what method was used to encode a 'code_verifier'
   * that will be used during authorization code exchange. This parameter must
   * be used with the 'code_challenge' parameter. The value of the
   * 'code_challenge_method' defaults to "plain" if not present in the request
   * that includes a 'code_challenge'. The only supported values for this
   * parameter are "S256" or "plain".
   */
  code_challenge_method?: CodeChallengeMethod;
  /**
   * Recommended. Specifies an encoded 'code_verifier' that will be used as a
   * server-side challenge during authorization code exchange. This parameter
   * must be used with the 'code_challenge' parameter described above.
   */
  code_challenge?: string;
  /**
   * A way for developers and/or the auth team to provide a set of key value
   * pairs to be added as query parameters to the authorization url.
   */
  [key: string]: querystring.ParsedUrlQueryInput[keyof querystring.ParsedUrlQueryInput];
}
interface AccessTokenResponse {
  access_token: string;
  expiry_date: number;
}
interface GetRefreshHandlerCallback {
  (): Promise<AccessTokenResponse>;
}
interface GetTokenCallback$1 {
  (err: GaxiosError | null, token?: Credentials | null, res?: GaxiosResponse | null): void;
}
interface GetTokenResponse {
  tokens: Credentials;
  res: GaxiosResponse | null;
}
interface GetAccessTokenCallback {
  (err: GaxiosError | null, token?: string | null, res?: GaxiosResponse | null): void;
}
interface RefreshAccessTokenCallback {
  (err: GaxiosError | null, credentials?: Credentials | null, res?: GaxiosResponse | null): void;
}
interface RefreshAccessTokenResponse {
  credentials: Credentials;
  res: GaxiosResponse | null;
}
interface RequestMetadataResponse {
  headers: Headers;
  res?: GaxiosResponse<void> | null;
}
interface GetFederatedSignonCertsCallback {
  (err: GaxiosError | null, certs?: Certificates, response?: GaxiosResponse<void> | null): void;
}
interface FederatedSignonCertsResponse {
  certs: Certificates;
  format: CertificateFormat;
  res?: GaxiosResponse<void> | null;
}
interface GetIapPublicKeysCallback {
  (err: GaxiosError | null, pubkeys?: PublicKeys, response?: GaxiosResponse<void> | null): void;
}
interface IapPublicKeysResponse {
  pubkeys: PublicKeys;
  res?: GaxiosResponse<void> | null;
}
interface RevokeCredentialsResult {
  success: boolean;
}
interface VerifyIdTokenOptions {
  idToken: string;
  audience?: string | string[];
  maxExpiry?: number;
}
interface OAuth2ClientEndpoints {
  /**
   * The endpoint for viewing access token information
   *
   * @example
   * 'https://oauth2.googleapis.com/tokeninfo'
   */
  tokenInfoUrl: string | URL;
  /**
   * The base URL for auth endpoints.
   *
   * @example
   * 'https://accounts.google.com/o/oauth2/v2/auth'
   */
  oauth2AuthBaseUrl: string | URL;
  /**
   * The base endpoint for token retrieval
   * .
   * @example
   * 'https://oauth2.googleapis.com/token'
   */
  oauth2TokenUrl: string | URL;
  /**
   * The base endpoint to revoke tokens.
   *
   * @example
   * 'https://oauth2.googleapis.com/revoke'
   */
  oauth2RevokeUrl: string | URL;
  /**
   * Sign on certificates in PEM format.
   *
   * @example
   * 'https://www.googleapis.com/oauth2/v1/certs'
   */
  oauth2FederatedSignonPemCertsUrl: string | URL;
  /**
   * Sign on certificates in JWK format.
   *
   * @example
   * 'https://www.googleapis.com/oauth2/v3/certs'
   */
  oauth2FederatedSignonJwkCertsUrl: string | URL;
  /**
   * IAP Public Key URL.
   * This URL contains a JSON dictionary that maps the `kid` claims to the public key values.
   *
   * @example
   * 'https://www.gstatic.com/iap/verify/public_key'
   */
  oauth2IapPublicKeyUrl: string | URL;
}
/**
 * A convenient interface for those looking to pass the OAuth2 Client config via a parsed
 * JSON file.
 */
interface OAuth2JSONOptions {
  /**
   * The authentication client ID.
   *
   * @alias {@link OAuth2ClientOptions.clientId}
   */
  client_id?: string;
  /**
   * The authentication client secret.
   *
   * @alias {@link OAuth2ClientOptions.clientSecret}
   */
  client_secret?: string;
  /**
   * The URIs to redirect to after completing the auth request.
   *
   * @alias {@link OAuth2ClientOptions.redirectUri}
   */
  redirect_uris?: string[];
}
interface OAuth2ClientOptions extends AuthClientOptions, OAuth2JSONOptions {
  /**
   * The authentication client ID.
   *
   * @alias {@link OAuth2JSONOptions.client_id}
   */
  clientId?: string;
  /**
   * The authentication client secret.
   *
   * @alias {@link OAuth2JSONOptions.client_secret}
   */
  clientSecret?: string;
  /**
   * The URI to redirect to after completing the auth request.
   *
   * @alias {@link OAuth2JSONOptions.redirect_uris}
   */
  redirectUri?: string;
  /**
   * Customizable endpoints.
   */
  endpoints?: Partial<OAuth2ClientEndpoints>;
  /**
   * The allowed OAuth2 token issuers.
   */
  issuers?: string[];
  /**
   * The client authentication type. Supported values are basic, post, and none.
   * Defaults to post if not provided.
   * https://datatracker.ietf.org/doc/html/rfc7591#section-2
   */
  clientAuthentication?: ClientAuthentication$1;
}
type RefreshOptions = Pick<AuthClientOptions, 'eagerRefreshThresholdMillis' | 'forceRefreshOnFailure'>;
declare class OAuth2Client extends AuthClient {
  private redirectUri?;
  private certificateCache;
  private certificateExpiry;
  private certificateCacheFormat;
  protected refreshTokenPromises: Map<string, Promise<GetTokenResponse>>;
  readonly endpoints: Readonly<OAuth2ClientEndpoints>;
  readonly issuers: string[];
  readonly clientAuthentication: ClientAuthentication$1;
  _clientId?: string;
  _clientSecret?: string;
  refreshHandler?: GetRefreshHandlerCallback;
  /**
   * An OAuth2 Client for Google APIs.
   *
   * @param options The OAuth2 Client Options. Passing an `clientId` directly is **@DEPRECATED**.
   * @param clientSecret **@DEPRECATED**. Provide a {@link OAuth2ClientOptions `OAuth2ClientOptions`} object in the first parameter instead.
   * @param redirectUri **@DEPRECATED**. Provide a {@link OAuth2ClientOptions `OAuth2ClientOptions`} object in the first parameter instead.
   */
  constructor(options?: OAuth2ClientOptions | OAuth2ClientOptions['clientId'],
  /**
   * @deprecated - provide a {@link OAuth2ClientOptions `OAuth2ClientOptions`} object in the first parameter instead
   */

  clientSecret?: OAuth2ClientOptions['clientSecret'],
  /**
   * @deprecated - provide a {@link OAuth2ClientOptions `OAuth2ClientOptions`} object in the first parameter instead
   */

  redirectUri?: OAuth2ClientOptions['redirectUri']);
  /**
   * @deprecated use instance's {@link OAuth2Client.endpoints}
   */
  protected static readonly GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";
  /**
   * Clock skew - five minutes in seconds
   */
  private static readonly CLOCK_SKEW_SECS_;
  /**
   * The default max Token Lifetime is one day in seconds
   */
  private static readonly DEFAULT_MAX_TOKEN_LIFETIME_SECS_;
  /**
   * Generates URL for consent page landing.
   * @param opts Options.
   * @return URL to consent page.
   */
  generateAuthUrl(opts?: GenerateAuthUrlOpts): string;
  generateCodeVerifier(): void;
  /**
   * Convenience method to automatically generate a code_verifier, and its
   * resulting SHA256. If used, this must be paired with a S256
   * code_challenge_method.
   *
   * For a full example see:
   * https://github.com/googleapis/google-auth-library-nodejs/blob/main/samples/oauth2-codeVerifier.js
   */
  generateCodeVerifierAsync(): Promise<CodeVerifierResults>;
  /**
   * Gets the access token for the given code.
   * @param code The authorization code.
   * @param callback Optional callback fn.
   */
  getToken(code: string): Promise<GetTokenResponse>;
  getToken(options: GetTokenOptions$1): Promise<GetTokenResponse>;
  getToken(code: string, callback: GetTokenCallback$1): void;
  getToken(options: GetTokenOptions$1, callback: GetTokenCallback$1): void;
  private getTokenAsync;
  /**
   * Refreshes the access token.
   * @param refresh_token Existing refresh token.
   * @private
   */
  protected refreshToken(refreshToken?: string | null): Promise<GetTokenResponse>;
  protected refreshTokenNoCache(refreshToken?: string | null): Promise<GetTokenResponse>;
  /**
   * Retrieves the access token using refresh token
   *
   * @param callback callback
   */
  refreshAccessToken(): Promise<RefreshAccessTokenResponse>;
  refreshAccessToken(callback: RefreshAccessTokenCallback): void;
  private refreshAccessTokenAsync;
  /**
   * Get a non-expired access token, after refreshing if necessary
   *
   * @param callback Callback to call with the access token
   */
  getAccessToken(): Promise<GetAccessTokenResponse>;
  getAccessToken(callback: GetAccessTokenCallback): void;
  private getAccessTokenAsync;
  /**
   * The main authentication interface.  It takes an optional url which when
   * present is the endpoint being accessed, and returns a Promise which
   * resolves with authorization header fields.
   *
   * In OAuth2Client, the result has the form:
   * { authorization: 'Bearer <access_token_value>' }
   */
  getRequestHeaders(url?: string | URL): Promise<Headers>;
  protected getRequestMetadataAsync(url?: string | URL | null): Promise<RequestMetadataResponse>;
  /**
   * Generates an URL to revoke the given token.
   * @param token The existing token to be revoked.
   *
   * @deprecated use instance method {@link OAuth2Client.getRevokeTokenURL}
   */
  static getRevokeTokenUrl(token: string): string;
  /**
   * Generates a URL to revoke the given token.
   *
   * @param token The existing token to be revoked.
   */
  getRevokeTokenURL(token: string): URL;
  /**
   * Revokes the access given to token.
   * @param token The existing token to be revoked.
   * @param callback Optional callback fn.
   */
  revokeToken(token: string): GaxiosPromise<RevokeCredentialsResult>;
  revokeToken(token: string, callback: BodyResponseCallback<RevokeCredentialsResult>): void;
  /**
   * Revokes access token and clears the credentials object
   * @param callback callback
   */
  revokeCredentials(): GaxiosPromise<RevokeCredentialsResult>;
  revokeCredentials(callback: BodyResponseCallback<RevokeCredentialsResult>): void;
  private revokeCredentialsAsync;
  /**
   * Provides a request implementation with OAuth 2.0 flow. If credentials have
   * a refresh_token, in cases of HTTP 401 and 403 responses, it automatically
   * asks for a new access token and replays the unsuccessful request.
   * @param opts Request options.
   * @param callback callback.
   * @return Request object
   */
  request<T>(opts: GaxiosOptions): GaxiosPromise<T>;
  request<T>(opts: GaxiosOptions, callback: BodyResponseCallback<T>): void;
  protected requestAsync<T>(opts: GaxiosOptions, reAuthRetried?: boolean): Promise<GaxiosResponse<T>>;
  /**
   * Verify id token is token by checking the certs and audience
   * @param options that contains all options.
   * @param callback Callback supplying GoogleLogin if successful
   */
  verifyIdToken(options: VerifyIdTokenOptions): Promise<LoginTicket>;
  verifyIdToken(options: VerifyIdTokenOptions, callback: (err: Error | null, login?: LoginTicket) => void): void;
  private verifyIdTokenAsync;
  /**
   * Obtains information about the provisioned access token.  Especially useful
   * if you want to check the scopes that were provisioned to a given token.
   *
   * @param accessToken Required.  The Access Token for which you want to get
   * user info.
   */
  getTokenInfo(accessToken: string): Promise<TokenInfo>;
  /**
   * Gets federated sign-on certificates to use for verifying identity tokens.
   * Returns certs as array structure, where keys are key ids, and values
   * are certificates in either PEM or JWK format.
   * @param callback Callback supplying the certificates
   */
  getFederatedSignonCerts(): Promise<FederatedSignonCertsResponse>;
  getFederatedSignonCerts(callback: GetFederatedSignonCertsCallback): void;
  getFederatedSignonCertsAsync(): Promise<FederatedSignonCertsResponse>;
  /**
   * Gets federated sign-on certificates to use for verifying identity tokens.
   * Returns certs as array structure, where keys are key ids, and values
   * are certificates in either PEM or JWK format.
   * @param callback Callback supplying the certificates
   */
  getIapPublicKeys(): Promise<IapPublicKeysResponse>;
  getIapPublicKeys(callback: GetIapPublicKeysCallback): void;
  getIapPublicKeysAsync(): Promise<IapPublicKeysResponse>;
  verifySignedJwtWithCerts(): void;
  /**
   * Verify the id token is signed with the correct certificate
   * and is from the correct audience.
   * @param jwt The jwt to verify (The ID Token in this case).
   * @param certs The array of certs to test the jwt against.
   * @param requiredAudience The audience to test the jwt against.
   * @param issuers The allowed issuers of the jwt (Optional).
   * @param maxExpiry The max expiry the certificate can be (Optional).
   * @return Returns a promise resolving to LoginTicket on verification.
   */
  verifySignedJwtWithCertsAsync(jwt: string, certs: Certificates | PublicKeys, requiredAudience?: string | string[], issuers?: string[], maxExpiry?: number): Promise<LoginTicket>;
  /**
   * Returns a promise that resolves with AccessTokenResponse type if
   * refreshHandler is defined.
   * If not, nothing is returned.
   */
  private processAndValidateRefreshHandler;
  /**
   * Returns true if a token is expired or will expire within
   * eagerRefreshThresholdMillismilliseconds.
   * If there is no expiry time, assumes the token is not expired or expiring.
   */
  protected isTokenExpiring(): boolean;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/idtokenclient.d.ts
interface IdTokenOptions extends OAuth2ClientOptions {
  /**
   * The client to make the request to fetch an ID token.
   */
  idTokenProvider: IdTokenProvider;
  /**
   * The audience to use when requesting an ID token.
   */
  targetAudience: string;
}
interface IdTokenProvider {
  fetchIdToken: (targetAudience: string) => Promise<string>;
}
declare class IdTokenClient extends OAuth2Client {
  targetAudience: string;
  idTokenProvider: IdTokenProvider;
  /**
   * Google ID Token client
   *
   * Retrieve ID token from the metadata server.
   * See: https://cloud.google.com/docs/authentication/get-id-token#metadata-server
   */
  constructor(options: IdTokenOptions);
  protected getRequestMetadataAsync(): Promise<RequestMetadataResponse>;
  private getIdTokenExpiryDate;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/envDetect.d.ts
declare enum GCPEnv {
  APP_ENGINE = "APP_ENGINE",
  KUBERNETES_ENGINE = "KUBERNETES_ENGINE",
  CLOUD_FUNCTIONS = "CLOUD_FUNCTIONS",
  COMPUTE_ENGINE = "COMPUTE_ENGINE",
  CLOUD_RUN = "CLOUD_RUN",
  CLOUD_RUN_JOBS = "CLOUD_RUN_JOBS",
  NONE = "NONE"
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/gtoken/tokenOptions.d.ts
interface Transporter {
  request<T>(opts: GaxiosOptions): GaxiosPromise<T>;
}
interface TokenOptions {
  /**
   * Path to a .json, .pem, or .p12 key file.
   */
  keyFile?: string;
  /**
   * The raw private key value.
   */
  key?: string;
  /**
   * The service account email address.
   */
  email?: string;
  /**
   * The issuer claim for the JWT.
   */
  iss?: string;
  /**
   * The subject claim for the JWT. This is used for impersonation.
   */
  sub?: string;
  /**
   * The space-delimited list of scopes for the requested token.
   */
  scope?: string | string[];
  /**
   * Additional claims to include in the JWT payload.
   */
  additionalClaims?: {
    [key: string]: any;
  };
  /**
   * Eagerly refresh unexpired tokens when they are within this many
   * milliseconds from expiring.
   * Defaults to 0.
   */
  eagerRefreshThresholdMillis?: number;
  transporter?: Transporter;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/gtoken/getToken.d.ts
/**
 * Interface for the data returned from the token endpoint.
 */
interface TokenData {
  /** An optional refresh token. */
  refresh_token?: string;
  /** The duration of the token in seconds. */
  expires_in?: number;
  /** The access token. */
  access_token?: string;
  /** The type of token, e.g., "Bearer". */
  token_type?: string;
  /** An optional ID token. */
  id_token?: string;
}
/**
 * Fetches an access token.
 * @param tokenOptions The options for the token.
 * @returns A promise that resolves with the token data.
 */
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/gtoken/googleToken.d.ts
/**
 * Options for fetching an access token.
 */
interface GetTokenOptions {
  /**
   * If true, a new token will be fetched, ignoring any cached token.
   */
  forceRefresh?: boolean;
}
/**
 * Callback type for the `getToken` method.
 */
type GetTokenCallback = (err: Error | null, token?: TokenData) => void;
/**
 * The GoogleToken class is used to manage authentication with Google's OAuth 2.0 authorization server.
 * It handles fetching, caching, and refreshing of access tokens.
 */
declare class GoogleToken {
  /** The configuration options for this token instance. */
  private tokenOptions;
  /** The handler for token fetching and caching logic. */
  private tokenHandler;
  /**
   * Create a GoogleToken.
   *
   * @param options  Configuration object.
   */
  constructor(options?: TokenOptions);
  get expiresAt(): number | undefined;
  /**
   * The most recent access token obtained by this client.
   */
  get accessToken(): string | undefined;
  /**
   * The most recent ID token obtained by this client.
   */
  get idToken(): string | undefined;
  /**
   * The token type of the most recent access token.
   */
  get tokenType(): string | undefined;
  /**
   * The refresh token for the current credentials.
   */
  get refreshToken(): string | undefined;
  /**
   * A boolean indicating if the current token has expired.
   */
  hasExpired(): boolean;
  /**
   * A boolean indicating if the current token is expiring soon,
   * based on the `eagerRefreshThresholdMillis` option.
   */
  isTokenExpiring(): boolean;
  /**
   * Fetches a new access token and returns it.
   * @param opts Options for fetching the token.
   */
  getToken(opts?: GetTokenOptions): Promise<TokenData>;
  getToken(callback: GetTokenCallback, opts?: GetTokenOptions): void;
  /**
   * Revokes the current access token and resets the token handler.
   */
  revokeToken(): Promise<void>;
  revokeToken(callback: (err?: Error) => void): void;
  /**
   * Returns the configuration options for this token instance.
   */
  get googleTokenOptions(): TokenOptions;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/jwtclient.d.ts
interface JWTOptions extends OAuth2ClientOptions {
  /**
   * The service account email address.
   */
  email?: string;
  /**
   * The path to private key file. Not necessary if {@link JWTOptions.key} has been provided.
   */
  keyFile?: string;
  /**
   * The value of key. Not necessary if {@link JWTOptions.keyFile} has been provided.
   */
  key?: string;
  /**
   * The list of requested scopes or a single scope.
   */
  keyId?: string;
  /**
   * The impersonated account's email address.
   */
  scopes?: string | string[];
  /**
   * The ID of the key.
   */
  subject?: string;
  /**
   * Additional claims, such as target audience.
   *
   * @example
   * ```
   * {target_audience: 'targetAudience'}
   * ```
   */
  additionalClaims?: {};
}
declare class JWT extends OAuth2Client implements IdTokenProvider {
  email?: string;
  keyFile?: string;
  key?: string;
  keyId?: string;
  defaultScopes?: string | string[];
  scopes?: string | string[];
  scope?: string;
  subject?: string;
  gtoken?: GoogleToken;
  additionalClaims?: {};
  useJWTAccessWithScope?: boolean;
  defaultServicePath?: string;
  private access?;
  /**
   * JWT service account credentials.
   *
   * Retrieve access token using gtoken.
   *
   * @param options the
   */
  constructor(options?: JWTOptions);
  /**
   * Creates a copy of the credential with the specified scopes.
   * @param scopes List of requested scopes or a single scope.
   * @return The cloned instance.
   */
  createScoped(scopes?: string | string[]): JWT;
  /**
   * Obtains the metadata to be sent with the request.
   *
   * @param url the URI being authorized.
   */
  protected getRequestMetadataAsync(url?: string | null): Promise<RequestMetadataResponse>;
  /**
   * Fetches an ID token.
   * @param targetAudience the audience for the fetched ID token.
   */
  fetchIdToken(targetAudience: string): Promise<string>;
  /**
   * Determine if there are currently scopes available.
   */
  private hasUserScopes;
  /**
   * Are there any default or user scopes defined.
   */
  private hasAnyScopes;
  /**
   * Get the initial access token using gToken.
   * @param callback Optional callback.
   * @returns Promise that resolves with credentials
   */
  authorize(): Promise<Credentials>;
  authorize(callback: (err: Error | null, result?: Credentials) => void): void;
  private authorizeAsync;
  /**
   * Refreshes the access token.
   * @param refreshToken ignored
   * @private
   */
  protected refreshTokenNoCache(): Promise<GetTokenResponse>;
  /**
   * Create a gToken if it doesn't already exist.
   */
  private createGToken;
  /**
   * Create a JWT credentials instance using the given input options.
   * @param json The input object.
   *
   * @remarks
   *
   * **Important**: If you accept a credential configuration (credential JSON/File/Stream) from an external source for authentication to Google Cloud, you must validate it before providing it to any Google API or library. Providing an unvalidated credential configuration to Google APIs can compromise the security of your systems and data. For more information, refer to {@link https://cloud.google.com/docs/authentication/external/externally-sourced-credentials Validate credential configurations from external sources}.
   */
  fromJSON(json: JWTInput): void;
  /**
   * Create a JWT credentials instance using the given input stream.
   * @param inputStream The input stream.
   * @param callback Optional callback.
   *
   * @remarks
   *
   * **Important**: If you accept a credential configuration (credential JSON/File/Stream) from an external source for authentication to Google Cloud, you must validate it before providing it to any Google API or library. Providing an unvalidated credential configuration to Google APIs can compromise the security of your systems and data. For more information, refer to {@link https://cloud.google.com/docs/authentication/external/externally-sourced-credentials Validate credential configurations from external sources}.
   */
  fromStream(inputStream: stream.Readable): Promise<void>;
  fromStream(inputStream: stream.Readable, callback: (err?: Error | null) => void): void;
  private fromStreamAsync;
  /**
   * Creates a JWT credentials instance using an API Key for authentication.
   * @param apiKey The API Key in string form.
   */
  fromAPIKey(apiKey: string): void;
  /**
   * Using the key or keyFile on the JWT client, obtain an object that contains
   * the key and the client email.
   */
  getCredentials(): Promise<CredentialBody>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/refreshclient.d.ts
interface UserRefreshClientOptions extends OAuth2ClientOptions {
  /**
   * The authentication client ID.
   */
  clientId?: string;
  /**
   * The authentication client secret.
   */
  clientSecret?: string;
  /**
   * The authentication refresh token.
   */
  refreshToken?: string;
}
declare class UserRefreshClient extends OAuth2Client {
  _refreshToken?: string | null;
  /**
   * The User Refresh Token client.
   *
   * @param optionsOrClientId The User Refresh Token client options. Passing an `clientId` directly is **@DEPRECATED**.
   * @param clientSecret **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
   * @param refreshToken **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
   * @param eagerRefreshThresholdMillis **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
   * @param forceRefreshOnFailure **@DEPRECATED**. Provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead.
   */
  constructor(optionsOrClientId?: string | UserRefreshClientOptions,
  /**
   * @deprecated - provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead
   */

  clientSecret?: UserRefreshClientOptions['clientSecret'],
  /**
   * @deprecated - provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead
   */

  refreshToken?: UserRefreshClientOptions['refreshToken'],
  /**
   * @deprecated - provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead
   */

  eagerRefreshThresholdMillis?: UserRefreshClientOptions['eagerRefreshThresholdMillis'],
  /**
   * @deprecated - provide a {@link UserRefreshClientOptions `UserRefreshClientOptions`} object in the first parameter instead
   */

  forceRefreshOnFailure?: UserRefreshClientOptions['forceRefreshOnFailure']);
  /**
   * Refreshes the access token.
   * @param refreshToken An ignored refreshToken..
   * @param callback Optional callback.
   */
  protected refreshTokenNoCache(): Promise<GetTokenResponse>;
  fetchIdToken(targetAudience: string): Promise<string>;
  /**
   * Create a UserRefreshClient credentials instance using the given input
   * options.
   * @param json The input object.
   */
  fromJSON(json: JWTInput): void;
  /**
   * Create a UserRefreshClient credentials instance using the given input
   * stream.
   * @param inputStream The input stream.
   * @param callback Optional callback.
   */
  fromStream(inputStream: stream.Readable): Promise<void>;
  fromStream(inputStream: stream.Readable, callback: (err?: Error) => void): void;
  private fromStreamAsync;
  /**
   * Create a UserRefreshClient credentials instance using the given input
   * options.
   * @param json The input object.
   */
  static fromJSON(json: JWTInput): UserRefreshClient;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/impersonated.d.ts
interface ImpersonatedOptions extends OAuth2ClientOptions {
  /**
   * Client used to perform exchange for impersonated client.
   */
  sourceClient?: AuthClient;
  /**
   * The service account to impersonate.
   */
  targetPrincipal?: string;
  /**
   * Scopes to request during the authorization grant.
   */
  targetScopes?: string[];
  /**
   * The chained list of delegates required to grant the final access_token.
   */
  delegates?: string[];
  /**
   * Number of seconds the delegated credential should be valid.
   */
  lifetime?: number | 3600;
  /**
   * API endpoint to fetch token from.
   */
  endpoint?: string;
}
interface FetchIdTokenOptions {
  /**
   * Include the service account email in the token.
   * If set to `true`, the token will contain `email` and `email_verified` claims.
   */
  includeEmail: boolean;
}
declare class Impersonated extends OAuth2Client implements IdTokenProvider {
  private sourceClient;
  private targetPrincipal;
  private targetScopes;
  private delegates;
  private lifetime;
  private endpoint;
  /**
   * Impersonated service account credentials.
   *
   * Create a new access token by impersonating another service account.
   *
   * Impersonated Credentials allowing credentials issued to a user or
   * service account to impersonate another. The source project using
   * Impersonated Credentials must enable the "IAMCredentials" API.
   * Also, the target service account must grant the orginating principal
   * the "Service Account Token Creator" IAM role.
   *
   * **IMPORTANT**: This method does not validate the credential configuration.
   * A security risk occurs when a credential configuration configured with
   * malicious URLs is used. When the credential configuration is accepted from
   * an untrusted source, you should validate it before using it with this
   * method. For more details, see
   * https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   *
   * @param {object} options - The configuration object.
   * @param {object} [options.sourceClient] the source credential used as to
   * acquire the impersonated credentials.
   * @param {string} [options.targetPrincipal] the service account to
   * impersonate.
   * @param {string[]} [options.delegates] the chained list of delegates
   * required to grant the final access_token. If set, the sequence of
   * identities must have "Service Account Token Creator" capability granted to
   * the preceding identity. For example, if set to [serviceAccountB,
   * serviceAccountC], the sourceCredential must have the Token Creator role on
   * serviceAccountB. serviceAccountB must have the Token Creator on
   * serviceAccountC. Finally, C must have Token Creator on target_principal.
   * If left unset, sourceCredential must have that role on targetPrincipal.
   * @param {string[]} [options.targetScopes] scopes to request during the
   * authorization grant.
   * @param {number} [options.lifetime] number of seconds the delegated
   * credential should be valid for up to 3600 seconds by default, or 43,200
   * seconds by extending the token's lifetime, see:
   * https://cloud.google.com/iam/docs/creating-short-lived-service-account-credentials#sa-credentials-oauth
   * @param {string} [options.endpoint] api endpoint override.
   */
  constructor(options?: ImpersonatedOptions);
  /**
   * Signs some bytes.
   *
   * {@link https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signBlob Reference Documentation}
   * @param blobToSign String to sign.
   *
   * @returns A {@link SignBlobResponse} denoting the keyID and signedBlob in base64 string
   */
  sign(blobToSign: string): Promise<SignBlobResponse>;
  /** The service account email to be impersonated. */
  getTargetPrincipal(): string;
  /**
   * Refreshes the access token.
   */
  protected refreshToken(): Promise<GetTokenResponse>;
  /**
   * Generates an OpenID Connect ID token for a service account.
   *
   * {@link https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken Reference Documentation}
   *
   * @param targetAudience the audience for the fetched ID token.
   * @param options the for the request
   * @return an OpenID Connect ID token
   */
  fetchIdToken(targetAudience: string, options?: FetchIdTokenOptions): Promise<string>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/oauth2common.d.ts
/**
 * OAuth client authentication types.
 * https://tools.ietf.org/html/rfc6749#section-2.3
 */
type ConfidentialClientType = 'basic' | 'request-body';
/**
 * Defines the client authentication credentials for basic and request-body
 * credentials.
 * https://tools.ietf.org/html/rfc6749#section-2.3.1
 */
interface ClientAuthentication {
  confidentialClientType: ConfidentialClientType;
  clientId: string;
  clientSecret?: string;
}
interface OAuthClientAuthHandlerOptions {
  /**
   * Defines the client authentication credentials for basic and request-body
   * credentials.
   */
  clientAuthentication?: ClientAuthentication;
  /**
   * An optional transporter to use.
   */
  transporter?: Gaxios;
}
/**
 * Abstract class for handling client authentication in OAuth-based
 * operations.
 * When request-body client authentication is used, only application/json and
 * application/x-www-form-urlencoded content types for HTTP methods that support
 * request bodies are supported.
 */
declare abstract class OAuthClientAuthHandler {
  #private;
  protected transporter: Gaxios;
  /**
   * Instantiates an OAuth client authentication handler.
   * @param options The OAuth Client Auth Handler instance options. Passing an `ClientAuthentication` directly is **@DEPRECATED**.
   */
  constructor(options?: ClientAuthentication | OAuthClientAuthHandlerOptions);
  /**
   * Applies client authentication on the OAuth request's headers or POST
   * body but does not process the request.
   * @param opts The GaxiosOptions whose headers or data are to be modified
   *   depending on the client authentication mechanism to be used.
   * @param bearerToken The optional bearer token to use for authentication.
   *   When this is used, no client authentication credentials are needed.
   */
  protected applyClientAuthenticationOptions(opts: GaxiosOptions, bearerToken?: string): void;
  /**
   * Applies client authentication on the request's header if either
   * basic authentication or bearer token authentication is selected.
   *
   * @param opts The GaxiosOptions whose headers or data are to be modified
   *   depending on the client authentication mechanism to be used.
   * @param bearerToken The optional bearer token to use for authentication.
   *   When this is used, no client authentication credentials are needed.
   */
  private injectAuthenticatedHeaders;
  /**
   * Applies client authentication on the request's body if request-body
   * client authentication is selected.
   *
   * @param opts The GaxiosOptions whose headers or data are to be modified
   *   depending on the client authentication mechanism to be used.
   */
  private injectAuthenticatedRequestBody;
  /**
   * Retry config for Auth-related requests.
   *
   * @remarks
   *
   * This is not a part of the default {@link AuthClient.transporter transporter/gaxios}
   * config as some downstream APIs would prefer if customers explicitly enable retries,
   * such as GCS.
   */
  protected static get RETRY_CONFIG(): GaxiosOptions;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/stscredentials.d.ts
/**
 * Defines the interface needed to initialize an StsCredentials instance.
 * The interface does not directly map to the spec and instead is converted
 * to be compliant with the JavaScript style guide. This is because this is
 * instantiated internally.
 * StsCredentials implement the OAuth 2.0 token exchange based on
 * https://tools.ietf.org/html/rfc8693.
 * Request options are defined in
 * https://tools.ietf.org/html/rfc8693#section-2.1
 */
interface StsCredentialsOptions {
  /**
   * REQUIRED. The value "urn:ietf:params:oauth:grant-type:token-exchange"
   * indicates that a token exchange is being performed.
   */
  grantType: string;
  /**
   * OPTIONAL. A URI that indicates the target service or resource where the
   * client intends to use the requested security token.
   */
  resource?: string;
  /**
   * OPTIONAL. The logical name of the target service where the client
   * intends to use the requested security token.  This serves a purpose
   * similar to the "resource" parameter but with the client providing a
   * logical name for the target service.
   */
  audience?: string;
  /**
   * OPTIONAL. A list of space-delimited, case-sensitive strings, as defined
   * in Section 3.3 of [RFC6749], that allow the client to specify the desired
   * scope of the requested security token in the context of the service or
   * resource where the token will be used.
   */
  scope?: string[];
  /**
   * OPTIONAL. An identifier, as described in Section 3 of [RFC8693], eg.
   * "urn:ietf:params:oauth:token-type:access_token" for the type of the
   * requested security token.
   */
  requestedTokenType?: string;
  /**
   * REQUIRED. A security token that represents the identity of the party on
   * behalf of whom the request is being made.
   */
  subjectToken: string;
  /**
   * REQUIRED. An identifier, as described in Section 3 of [RFC8693], that
   * indicates the type of the security token in the "subject_token" parameter.
   */
  subjectTokenType: string;
  actingParty?: {
    /**
     * OPTIONAL. A security token that represents the identity of the acting
     * party.  Typically, this will be the party that is authorized to use the
     * requested security token and act on behalf of the subject.
     */
    actorToken: string;
    /**
     * An identifier, as described in Section 3, that indicates the type of the
     * security token in the "actor_token" parameter. This is REQUIRED when the
     * "actor_token" parameter is present in the request but MUST NOT be
     * included otherwise.
     */
    actorTokenType: string;
  };
}
/**
 * Defines the OAuth 2.0 token exchange successful response based on
 * https://tools.ietf.org/html/rfc8693#section-2.2.1
 */
interface StsSuccessfulResponse {
  access_token: string;
  issued_token_type: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  res?: GaxiosResponse | null;
}
interface StsCredentialsConstructionOptions extends OAuthClientAuthHandlerOptions {
  /**
   * The client authentication credentials if available.
   */
  clientAuthentication?: ClientAuthentication;
  /**
   * The token exchange endpoint.
   */
  tokenExchangeEndpoint: string | URL;
}
/**
 * Implements the OAuth 2.0 token exchange based on
 * https://tools.ietf.org/html/rfc8693
 */
declare class StsCredentials extends OAuthClientAuthHandler {
  #private;
  /**
   * Initializes an STS credentials instance.
   *
   * @param options The STS credentials instance options. Passing an `tokenExchangeEndpoint` directly is **@DEPRECATED**.
   * @param clientAuthentication **@DEPRECATED**. Provide a {@link StsCredentialsConstructionOptions `StsCredentialsConstructionOptions`} object in the first parameter instead.
   */
  constructor(options?: StsCredentialsConstructionOptions | string | URL,
  /**
   * @deprecated - provide a {@link StsCredentialsConstructionOptions `StsCredentialsConstructionOptions`} object in the first parameter instead
   */

  clientAuthentication?: ClientAuthentication);
  /**
   * Exchanges the provided token for another type of token based on the
   * rfc8693 spec.
   * @param stsCredentialsOptions The token exchange options used to populate
   *   the token exchange request.
   * @param additionalHeaders Optional additional headers to pass along the
   *   request.
   * @param options Optional additional GCP-specific non-spec defined options
   *   to send with the request.
   *   Example: `&options=${encodeUriComponent(JSON.stringified(options))}`
   * @return A promise that resolves with the token exchange response containing
   *   the requested token and its expiration time.
   */
  exchangeToken(stsCredentialsOptions: StsCredentialsOptions, headers?: HeadersInit$1, options?: Parameters<JSON['stringify']>[0]): Promise<StsSuccessfulResponse>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/baseexternalclient.d.ts
/**
 * Shared options used to build {@link ExternalAccountClient} and
 * {@link ExternalAccountAuthorizedUserClient}.
 */
interface SharedExternalAccountClientOptions extends AuthClientOptions {
  /**
   *  The Security Token Service audience, which is usually the fully specified
   *  resource name of the workload or workforce pool provider.
   */
  audience: string;
  /**
   * The Security Token Service token URL used to exchange the third party token
   * for a GCP access token. If not provided, will default to
   * 'https://sts.googleapis.com/v1/token'
   */
  token_url?: string;
}
/**
 * Interface containing context about the requested external identity. This is
 * passed on all requests from external account clients to external identity suppliers.
 */
interface ExternalAccountSupplierContext {
  /**
   * The requested external account audience. For example:
   * * "//iam.googleapis.com/locations/global/workforcePools/$WORKFORCE_POOL_ID/providers/$PROVIDER_ID"
   * * "//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID"
   */
  audience: string;
  /**
   * The requested subject token type. Expected values include:
   * * "urn:ietf:params:oauth:token-type:jwt"
   * * "urn:ietf:params:aws:token-type:aws4_request"
   * * "urn:ietf:params:oauth:token-type:saml2"
   * * "urn:ietf:params:oauth:token-type:id_token"
   */
  subjectTokenType: string;
  /**
   * The {@link Gaxios} instance for calling external account
   * to use for requests.
   */
  transporter: Gaxios;
}
/**
 * Base external account credentials json interface.
 */
interface BaseExternalAccountClientOptions extends SharedExternalAccountClientOptions {
  /**
   * Credential type, should always be 'external_account'.
   */
  type?: string;
  /**
   * The Security Token Service subject token type based on the OAuth 2.0
   * token exchange spec. Expected values include:
   * * 'urn:ietf:params:oauth:token-type:jwt'
   * * 'urn:ietf:params:aws:token-type:aws4_request'
   * * 'urn:ietf:params:oauth:token-type:saml2'
   * * 'urn:ietf:params:oauth:token-type:id_token'
   */
  subject_token_type: string;
  /**
   * The URL for the service account impersonation request. This URL is required
   * for some APIs. If this URL is not available, the access token from the
   * Security Token Service is used directly.
   */
  service_account_impersonation_url?: string;
  /**
   * Object containing additional options for service account impersonation.
   */
  service_account_impersonation?: {
    /**
     * The desired lifetime of the impersonated service account access token.
     * If not provided, the default lifetime will be 3600 seconds.
     */
    token_lifetime_seconds?: number;
  };
  /**
   * The endpoint used to retrieve account related information.
   */
  token_info_url?: string;
  /**
   * Client ID of the service account from the console.
   */
  client_id?: string;
  /**
   * Client secret of the service account from the console.
   */
  client_secret?: string;
  /**
   * The workforce pool user project. Required when using a workforce identity
   * pool.
   */
  workforce_pool_user_project?: string;
  /**
   * The scopes to request during the authorization grant.
   */
  scopes?: string[];
  /**
   * @example
   * https://cloudresourcemanager.googleapis.com/v1/projects/
   **/
  cloud_resource_manager_url?: string | URL;
}
/**
 * Interface defining the successful response for iamcredentials
 * generateAccessToken API.
 * https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
 */
interface IamGenerateAccessTokenResponse {
  accessToken: string;
  /**
   * ISO format used for expiration time.
   *
   * @example
   * '2014-10-02T15:01:23.045123456Z'
   */
  expireTime: string;
}
/**
 * Internal interface for tracking the access token expiration time.
 */
interface CredentialsWithResponse$2 extends Credentials {
  res?: GaxiosResponse | null;
}
/**
 * Base external account client. This is used to instantiate AuthClients for
 * exchanging external account credentials for GCP access token and authorizing
 * requests to GCP APIs.
 * The base class implements common logic for exchanging various type of
 * external credentials for GCP access token. The logic of determining and
 * retrieving the external credential based on the environment and
 * credential_source will be left for the subclasses.
 */
declare abstract class BaseExternalAccountClient extends AuthClient {
  #private;
  /**
   * OAuth scopes for the GCP access token to use. When not provided,
   * the default https://www.googleapis.com/auth/cloud-platform is
   * used.
   */
  scopes?: string | string[];
  projectNumber: string | null;
  protected readonly audience: string;
  protected readonly subjectTokenType: string;
  protected stsCredential: StsCredentials;
  protected readonly clientAuth?: ClientAuthentication;
  protected credentialSourceType?: string;
  private cachedAccessToken;
  private readonly serviceAccountImpersonationUrl?;
  private readonly serviceAccountImpersonationLifetime?;
  private readonly workforcePoolUserProject?;
  private readonly configLifetimeRequested;
  private readonly tokenUrl;
  /**
   * @example
   * ```ts
   * new URL('https://cloudresourcemanager.googleapis.com/v1/projects/');
   * ```
   */
  protected cloudResourceManagerURL: URL | string;
  protected supplierContext: ExternalAccountSupplierContext;
  /**
   * Instantiate a BaseExternalAccountClient instance using the provided JSON
   * object loaded from an external account credentials file.
   * @param options The external account options object typically loaded
   *   from the external account JSON credential file. The camelCased options
   *   are aliases for the snake_cased options.
   */
  constructor(options: BaseExternalAccountClientOptions | SnakeToCamelObject<BaseExternalAccountClientOptions>);
  /** The service account email to be impersonated, if available. */
  getServiceAccountEmail(): string | null;
  /**
   * Provides a mechanism to inject GCP access tokens directly.
   * When the provided credential expires, a new credential, using the
   * external account options, is retrieved.
   * @param credentials The Credentials object to set on the current client.
   */
  setCredentials(credentials: Credentials): void;
  /**
   * Triggered when a external subject token is needed to be exchanged for a GCP
   * access token via GCP STS endpoint.
   * This abstract method needs to be implemented by subclasses depending on
   * the type of external credential used.
   * @return A promise that resolves with the external subject token.
   */
  abstract retrieveSubjectToken(): Promise<string>;
  /**
   * @return A promise that resolves with the current GCP access token
   *   response. If the current credential is expired, a new one is retrieved.
   */
  getAccessToken(): Promise<GetAccessTokenResponse>;
  /**
   * The main authentication interface. It takes an optional url which when
   * present is the endpoint being accessed, and returns a Promise which
   * resolves with authorization header fields.
   *
   * The result has the form:
   * { authorization: 'Bearer <access_token_value>' }
   */
  getRequestHeaders(): Promise<Headers>;
  /**
   * Provides a request implementation with OAuth 2.0 flow. In cases of
   * HTTP 401 and 403 responses, it automatically asks for a new access token
   * and replays the unsuccessful request.
   * @param opts Request options.
   * @param callback callback.
   * @return A promise that resolves with the HTTP response when no callback is
   *   provided.
   */
  request<T>(opts: GaxiosOptions): GaxiosPromise<T>;
  request<T>(opts: GaxiosOptions, callback: BodyResponseCallback<T>): void;
  /**
   * @return A promise that resolves with the project ID corresponding to the
   *   current workload identity pool or current workforce pool if
   *   determinable. For workforce pool credential, it returns the project ID
   *   corresponding to the workforcePoolUserProject.
   *   This is introduced to match the current pattern of using the Auth
   *   library:
   *   const projectId = await auth.getProjectId();
   *   const url = `https://dns.googleapis.com/dns/v1/projects/${projectId}`;
   *   const res = await client.request({ url });
   *   The resource may not have permission
   *   (resourcemanager.projects.get) to call this API or the required
   *   scopes may not be selected:
   *   https://cloud.google.com/resource-manager/reference/rest/v1/projects/get#authorization-scopes
   */
  getProjectId(): Promise<string | null>;
  /**
   * Authenticates the provided HTTP request, processes it and resolves with the
   * returned response.
   * @param opts The HTTP request options.
   * @param reAuthRetried Whether the current attempt is a retry after a failed attempt due to an auth failure.
   * @return A promise that resolves with the successful response.
   */
  protected requestAsync<T>(opts: GaxiosOptions, reAuthRetried?: boolean): Promise<GaxiosResponse<T>>;
  /**
   * Forces token refresh, even if unexpired tokens are currently cached.
   * External credentials are exchanged for GCP access tokens via the token
   * exchange endpoint and other settings provided in the client options
   * object.
   * If the service_account_impersonation_url is provided, an additional
   * step to exchange the external account GCP access token for a service
   * account impersonated token is performed.
   * @return A promise that resolves with the fresh GCP access tokens.
   */
  protected refreshAccessTokenAsync(): Promise<CredentialsWithResponse$2>;
  /**
   * Returns the workload identity pool project number if it is determinable
   * from the audience resource name.
   * @param audience The STS audience used to determine the project number.
   * @return The project number associated with the workload identity pool, if
   *   this can be determined from the STS audience field. Otherwise, null is
   *   returned.
   */
  private getProjectNumber;
  /**
   * Exchanges an external account GCP access token for a service
   * account impersonated access token using iamcredentials
   * GenerateAccessToken API.
   * @param token The access token to exchange for a service account access
   *   token.
   * @return A promise that resolves with the service account impersonated
   *   credentials response.
   */
  private getImpersonatedAccessToken;
  /**
   * Returns whether the provided credentials are expired or not.
   * If there is no expiry time, assumes the token is not expired or expiring.
   * @param accessToken The credentials to check for expiration.
   * @return Whether the credentials are expired or not.
   */
  private isExpired;
  /**
   * @return The list of scopes for the requested GCP access token.
   */
  private getScopesArray;
  private getMetricsHeaderValue;
  protected getTokenUrl(): string;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/identitypoolclient.d.ts
type SubjectTokenFormatType = 'json' | 'text';
/**
 * Supplier interface for subject tokens. This can be implemented to
 * return a subject token which can then be exchanged for a GCP token by an
 * {@link IdentityPoolClient}.
 */
interface SubjectTokenSupplier {
  /**
   * Gets a valid subject token for the requested external account identity.
   * Note that these are not cached by the calling {@link IdentityPoolClient},
   * so caching should be including in the implementation.
   * @param context {@link ExternalAccountSupplierContext} from the calling
   *   {@link IdentityPoolClient}, contains the requested audience and subject token type
   *   for the external account identity as well as the transport from the
   *   calling client to use for requests.
   * @return A promise that resolves with the requested subject token string.
   */
  getSubjectToken: (context: ExternalAccountSupplierContext) => Promise<string>;
}
/**
 * Url-sourced/file-sourced credentials json interface.
 * This is used for K8s and Azure workloads.
 */
interface IdentityPoolClientOptions extends BaseExternalAccountClientOptions {
  /**
   * Object containing options to retrieve identity pool credentials. A valid credential
   * source or a subject token supplier must be specified.
   */
  credential_source?: {
    /**
     * The file location to read the subject token from. Either this, a URL
     * or a certificate location should be specified.
     */
    file?: string;
    /**
     * The URL to call to retrieve the subject token. Either this, a file
     * location or a certificate location should be specified.
     */
    url?: string;
    /**
     * Optional headers to send on the request to the specified URL.
     */
    headers?: {
      [key: string]: string;
    };
    /**
     * The format that the subject token is in the file or the URL response.
     * If not provided, will default to reading the text string directly.
     */
    format?: {
      /**
       * The format type. Can either be 'text' or 'json'.
       */
      type: SubjectTokenFormatType;
      /**
       * The field name containing the subject token value if the type is 'json'.
       */
      subject_token_field_name?: string;
    };
    /**
     * The certificate location to call to retrieve the subject token. Either this, a file
     * location, or an url should be specified.
     * @example
     * File Format:
     * ```json
     * {
     * "cert_configs": {
     *    "workload": {
     *      "key_path": "$PATH_TO_LEAF_KEY",
     *      "cert_path": "$PATH_TO_LEAF_CERT"
     *    }
     *  }
     * }
     * ```
     */
    certificate?: {
      /**
       * Specify whether the certificate config should be used from the default location.
       * Either this or the certificate_config_location must be provided.
       * The certificate config file must be in the following JSON format:
       */
      use_default_certificate_config?: boolean;
      /**
       * Location to fetch certificate config from in case default config is not to be used.
       * Either this or use_default_certificate_config=true should be provided.
       */
      certificate_config_location?: string;
      /**
       * TrustChainPath specifies the path to a PEM-formatted file containing the X.509 certificate trust chain.
       * The file should contain any intermediate certificates needed to connect
       * the mTLS leaf certificate to a root certificate in the trust store.
       */
      trust_chain_path?: string;
    };
  };
  /**
   * The subject token supplier to call to retrieve the subject token to exchange
   * for a GCP access token. Either this or a valid credential source should
   * be specified.
   */
  subject_token_supplier?: SubjectTokenSupplier;
}
/**
 * Defines the Url-sourced and file-sourced external account clients mainly
 * used for K8s and Azure workloads.
 */
declare class IdentityPoolClient extends BaseExternalAccountClient {
  private readonly subjectTokenSupplier;
  /**
   * Instantiate an IdentityPoolClient instance using the provided JSON
   * object loaded from an external account credentials file.
   * An error is thrown if the credential is not a valid file-sourced or
   * url-sourced credential or a workforce pool user project is provided
   * with a non workforce audience.
   * @param options The external account options object typically loaded
   *   from the external account JSON credential file. The camelCased options
   *   are aliases for the snake_cased options.
   */
  constructor(options: IdentityPoolClientOptions | SnakeToCamelObject<IdentityPoolClientOptions>);
  /**
   * Triggered when a external subject token is needed to be exchanged for a GCP
   * access token via GCP STS endpoint. Gets a subject token by calling
   * the configured {@link SubjectTokenSupplier}
   * @return A promise that resolves with the external subject token.
   */
  retrieveSubjectToken(): Promise<string>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/awsrequestsigner.d.ts
/**
 * Interface defining AWS security credentials.
 * These are either determined from AWS security_credentials endpoint or
 * AWS environment variables.
 */
interface AwsSecurityCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  token?: string;
}
/**
 * Implements an AWS API request signer based on the AWS Signature Version 4
 * signing process.
 * https://docs.aws.amazon.com/general/latest/gr/signature-version-4.html
 */
declare class AwsRequestSigner {
  private readonly getCredentials;
  private readonly region;
  private readonly crypto;
  /**
   * Instantiates an AWS API request signer used to send authenticated signed
   * requests to AWS APIs based on the AWS Signature Version 4 signing process.
   * This also provides a mechanism to generate the signed request without
   * sending it.
   * @param getCredentials A mechanism to retrieve AWS security credentials
   *   when needed.
   * @param region The AWS region to use.
   */
  constructor(getCredentials: () => Promise<AwsSecurityCredentials>, region: string);
  /**
   * Generates the signed request for the provided HTTP request for calling
   * an AWS API. This follows the steps described at:
   * https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
   * @param amzOptions The AWS request options that need to be signed.
   * @return A promise that resolves with the GaxiosOptions containing the
   *   signed HTTP request parameters.
   */
  getRequestOptions(amzOptions: GaxiosOptions): Promise<GaxiosOptions>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/awsclient.d.ts
/**
 * AWS credentials JSON interface. This is used for AWS workloads.
 */
interface AwsClientOptions extends BaseExternalAccountClientOptions {
  /**
   * Object containing options to retrieve AWS security credentials. A valid credential
   * source or a aws security credentials supplier should be specified.
   */
  credential_source?: {
    /**
     * AWS environment ID. Currently only 'AWS1' is supported.
     */
    environment_id: string;
    /**
     * The EC2 metadata URL to retrieve the current AWS region from. If this is
     * not provided, the region should be present in the AWS_REGION or AWS_DEFAULT_REGION
     * environment variables.
     */
    region_url?: string;
    /**
     * The EC2 metadata URL to retrieve AWS security credentials. If this is not provided,
     * the credentials should be present in the AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
     * and AWS_SESSION_TOKEN environment variables.
     */
    url?: string;
    /**
     * The regional GetCallerIdentity action URL, used to determine the account
     * ID and its roles.
     */
    regional_cred_verification_url: string;
    /**
     *  The imdsv2 session token url is used to fetch session token from AWS
     *  which is later sent through headers for metadata requests. If the
     *  field is missing, then session token won't be fetched and sent with
     *  the metadata requests.
     *  The session token is required for IMDSv2 but optional for IMDSv1
     */
    imdsv2_session_token_url?: string;
  };
  /**
   * The AWS security credentials supplier to call to retrieve the AWS region
   * and AWS security credentials. Either this or a valid credential source
   * must be specified.
   */
  aws_security_credentials_supplier?: AwsSecurityCredentialsSupplier;
}
/**
 * Supplier interface for AWS security credentials. This can be implemented to
 * return an AWS region and AWS security credentials. These credentials can
 * then be exchanged for a GCP token by an {@link AwsClient}.
 */
interface AwsSecurityCredentialsSupplier {
  /**
   * Gets the active AWS region.
   * @param context {@link ExternalAccountSupplierContext} from the calling
   *   {@link AwsClient}, contains the requested audience and subject token type
   *   for the external account identity as well as the transport from the
   *   calling client to use for requests.
   * @return A promise that resolves with the AWS region string.
   */
  getAwsRegion: (context: ExternalAccountSupplierContext) => Promise<string>;
  /**
   * Gets valid AWS security credentials for the requested external account
   * identity. Note that these are not cached by the calling {@link AwsClient},
   * so caching should be including in the implementation.
   * @param context {@link ExternalAccountSupplierContext} from the calling
   *   {@link AwsClient}, contains the requested audience and subject token type
   *   for the external account identity as well as the transport from the
   *   calling client to use for requests.
   * @return A promise that resolves with the requested {@link AwsSecurityCredentials}.
   */
  getAwsSecurityCredentials: (context: ExternalAccountSupplierContext) => Promise<AwsSecurityCredentials>;
}
/**
 * AWS external account client. This is used for AWS workloads, where
 * AWS STS GetCallerIdentity serialized signed requests are exchanged for
 * GCP access token.
 */
declare class AwsClient extends BaseExternalAccountClient {
  #private;
  private readonly environmentId?;
  private readonly awsSecurityCredentialsSupplier;
  private readonly regionalCredVerificationUrl;
  private awsRequestSigner;
  private region;
  /**
   * @deprecated AWS client no validates the EC2 metadata address.
   **/
  static AWS_EC2_METADATA_IPV4_ADDRESS: string;
  /**
   * @deprecated AWS client no validates the EC2 metadata address.
   **/
  static AWS_EC2_METADATA_IPV6_ADDRESS: string;
  /**
   * Instantiates an AwsClient instance using the provided JSON
   * object loaded from an external account credentials file.
   * An error is thrown if the credential is not a valid AWS credential.
   * @param options The external account options object typically loaded
   *   from the external account JSON credential file.
   */
  constructor(options: AwsClientOptions | SnakeToCamelObject<AwsClientOptions>);
  private validateEnvironmentId;
  /**
   * Triggered when an external subject token is needed to be exchanged for a
   * GCP access token via GCP STS endpoint. This will call the
   * {@link AwsSecurityCredentialsSupplier} to retrieve an AWS region and AWS
   * Security Credentials, then use them to create a signed AWS STS request that
   * can be exchanged for a GCP access token.
   * @return A promise that resolves with the external subject token.
   */
  retrieveSubjectToken(): Promise<string>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/pluggable-auth-handler.d.ts
/**
 * Error thrown from the executable run by PluggableAuthClient.
 */
declare class ExecutableError extends Error {
  /**
   * The exit code returned by the executable.
   */
  readonly code: string;
  constructor(message: string, code: string);
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/pluggable-auth-client.d.ts
/**
 * Defines the credential source portion of the configuration for PluggableAuthClient.
 *
 * <p>Command is the only required field. If timeout_millis is not specified, the library will
 * default to a 30-second timeout.
 *
 * <pre>
 * Sample credential source for Pluggable Auth Client:
 * {
 *   ...
 *   "credential_source": {
 *     "executable": {
 *       "command": "/path/to/get/credentials.sh --arg1=value1 --arg2=value2",
 *       "timeout_millis": 5000,
 *       "output_file": "/path/to/generated/cached/credentials"
 *     }
 *   }
 * }
 * </pre>
 */
interface PluggableAuthClientOptions extends BaseExternalAccountClientOptions {
  credential_source: {
    executable: {
      /**
       * The command used to retrieve the 3rd party token.
       */
      command: string;
      /**
       * The timeout for executable to run in milliseconds. If none is provided it
       * will be set to the default timeout of 30 seconds.
       */
      timeout_millis?: number;
      /**
       * An optional output file location that will be checked for a cached response
       * from a previous run of the executable.
       */
      output_file?: string;
    };
  };
}
/**
 * PluggableAuthClient enables the exchange of workload identity pool external credentials for
 * Google access tokens by retrieving 3rd party tokens through a user supplied executable. These
 * scripts/executables are completely independent of the Google Cloud Auth libraries. These
 * credentials plug into ADC and will call the specified executable to retrieve the 3rd party token
 * to be exchanged for a Google access token.
 *
 * <p>To use these credentials, the GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES environment variable
 * must be set to '1'. This is for security reasons.
 *
 * <p>Both OIDC and SAML are supported. The executable must adhere to a specific response format
 * defined below.
 *
 * <p>The executable must print out the 3rd party token to STDOUT in JSON format. When an
 * output_file is specified in the credential configuration, the executable must also handle writing the
 * JSON response to this file.
 *
 * <pre>
 * OIDC response sample:
 * {
 *   "version": 1,
 *   "success": true,
 *   "token_type": "urn:ietf:params:oauth:token-type:id_token",
 *   "id_token": "HEADER.PAYLOAD.SIGNATURE",
 *   "expiration_time": 1620433341
 * }
 *
 * SAML2 response sample:
 * {
 *   "version": 1,
 *   "success": true,
 *   "token_type": "urn:ietf:params:oauth:token-type:saml2",
 *   "saml_response": "...",
 *   "expiration_time": 1620433341
 * }
 *
 * Error response sample:
 * {
 *   "version": 1,
 *   "success": false,
 *   "code": "401",
 *   "message": "Error message."
 * }
 * </pre>
 *
 * <p>The "expiration_time" field in the JSON response is only required for successful
 * responses when an output file was specified in the credential configuration
 *
 * <p>The auth libraries will populate certain environment variables that will be accessible by the
 * executable, such as: GOOGLE_EXTERNAL_ACCOUNT_AUDIENCE, GOOGLE_EXTERNAL_ACCOUNT_TOKEN_TYPE,
 * GOOGLE_EXTERNAL_ACCOUNT_INTERACTIVE, GOOGLE_EXTERNAL_ACCOUNT_IMPERSONATED_EMAIL, and
 * GOOGLE_EXTERNAL_ACCOUNT_OUTPUT_FILE.
 *
 * <p>Please see this repositories README for a complete executable request/response specification.
 */
declare class PluggableAuthClient extends BaseExternalAccountClient {
  /**
   * The command used to retrieve the third party token.
   */
  private readonly command;
  /**
   * The timeout in milliseconds for running executable,
   * set to default if none provided.
   */
  private readonly timeoutMillis;
  /**
   * The path to file to check for cached executable response.
   */
  private readonly outputFile?;
  /**
   * Executable and output file handler.
   */
  private readonly handler;
  /**
   * Instantiates a PluggableAuthClient instance using the provided JSON
   * object loaded from an external account credentials file.
   * An error is thrown if the credential is not a valid pluggable auth credential.
   * @param options The external account options object typically loaded from
   *   the external account JSON credential file.
   */
  constructor(options: PluggableAuthClientOptions);
  /**
   * Triggered when an external subject token is needed to be exchanged for a
   * GCP access token via GCP STS endpoint.
   * This uses the `options.credential_source` object to figure out how
   * to retrieve the token using the current environment. In this case,
   * this calls a user provided executable which returns the subject token.
   * The logic is summarized as:
   * 1. Validated that the executable is allowed to run. The
   *    GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES environment must be set to
   *    1 for security reasons.
   * 2. If an output file is specified by the user, check the file location
   *    for a response. If the file exists and contains a valid response,
   *    return the subject token from the file.
   * 3. Call the provided executable and return response.
   * @return A promise that resolves with the external subject token.
   */
  retrieveSubjectToken(): Promise<string>;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/externalclient.d.ts
type ExternalAccountClientOptions = IdentityPoolClientOptions | AwsClientOptions | PluggableAuthClientOptions;
/**
 * Dummy class with no constructor. Developers are expected to use fromJSON.
 */
declare class ExternalAccountClient {
  constructor();
  /**
   * This static method will instantiate the
   * corresponding type of external account credential depending on the
   * underlying credential source.
   *
   * **IMPORTANT**: This method does not validate the credential configuration.
   * A security risk occurs when a credential configuration configured with
   * malicious URLs is used. When the credential configuration is accepted from
   * an untrusted source, you should validate it before using it with this
   * method. For more details, see
   * https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   *
   * @param options The external account options object typically loaded
   *   from the external account JSON credential file.
   * @return A BaseExternalAccountClient instance or null if the options
   *   provided do not correspond to an external account credential.
   */
  static fromJSON(options: ExternalAccountClientOptions): BaseExternalAccountClient | null;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/externalAccountAuthorizedUserClient.d.ts
/**
 * The credentials JSON file type for external account authorized user clients.
 */
declare const EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE = "external_account_authorized_user";
/**
 * External Account Authorized User Credentials JSON interface.
 */
interface ExternalAccountAuthorizedUserClientOptions extends SharedExternalAccountClientOptions {
  type: typeof EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  token_info_url: string;
  revoke_url?: string;
}
/**
 * Internal interface for tracking the access token expiration time.
 */
interface CredentialsWithResponse$1 extends Credentials {
  res?: GaxiosResponse | null;
}
/**
 * External Account Authorized User Client. This is used for OAuth2 credentials
 * sourced using external identities through Workforce Identity Federation.
 * Obtaining the initial access and refresh token can be done through the
 * Google Cloud CLI.
 */
declare class ExternalAccountAuthorizedUserClient extends AuthClient {
  private cachedAccessToken;
  private readonly externalAccountAuthorizedUserHandler;
  private refreshToken;
  /**
   * Instantiates an ExternalAccountAuthorizedUserClient instances using the
   * provided JSON object loaded from a credentials files.
   * An error is throws if the credential is not valid.
   * @param options The external account authorized user option object typically
   *   from the external accoutn authorized user JSON credential file.
   */
  constructor(options: ExternalAccountAuthorizedUserClientOptions);
  getAccessToken(): Promise<{
    token?: string | null;
    res?: GaxiosResponse | null;
  }>;
  getRequestHeaders(): Promise<Headers>;
  request<T>(opts: GaxiosOptions): GaxiosPromise<T>;
  request<T>(opts: GaxiosOptions, callback: BodyResponseCallback<T>): void;
  /**
   * Authenticates the provided HTTP request, processes it and resolves with the
   * returned response.
   * @param opts The HTTP request options.
   * @param reAuthRetried Whether the current attempt is a retry after a failed attempt due to an auth failure.
   * @return A promise that resolves with the successful response.
   */
  protected requestAsync<T>(opts: GaxiosOptions, reAuthRetried?: boolean): Promise<GaxiosResponse<T>>;
  /**
   * Forces token refresh, even if unexpired tokens are currently cached.
   * @return A promise that resolves with the refreshed credential.
   */
  protected refreshAccessTokenAsync(): Promise<CredentialsWithResponse$1>;
  /**
   * Returns whether the provided credentials are expired or not.
   * If there is no expiry time, assumes the token is not expired or expiring.
   * @param credentials The credentials to check for expiration.
   * @return Whether the credentials are expired or not.
   */
  private isExpired;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/googleauth.d.ts
/**
 * Defines all types of explicit clients that are determined via ADC JSON
 * config file.
 */
type JSONClient = JWT | UserRefreshClient | BaseExternalAccountClient | ExternalAccountAuthorizedUserClient | Impersonated;
interface ProjectIdCallback {
  (err?: Error | null, projectId?: string | null): void;
}
interface CredentialCallback {
  (err: Error | null, result?: JSONClient): void;
}
interface ADCCallback {
  (err: Error | null, credential?: AuthClient, projectId?: string | null): void;
}
interface ADCResponse {
  credential: AuthClient;
  projectId: string | null;
}
interface GoogleAuthOptions<T extends AuthClient = AnyAuthClient> {
  /**
   * An API key to use, optional. Cannot be used with {@link GoogleAuthOptions.credentials `credentials`}.
   */
  apiKey?: string;
  /**
   * An `AuthClient` to use
   */
  authClient?: T;
  /**
   * @deprecated This option is being deprecated because of a potential security risk.
   *
   * This option does not validate the credential configuration. The security
   * risk occurs when a credential configuration is accepted from a source that
   * is not under your control and used without validation on your side.
   *
   * The recommended way to provide credentials is to create an `auth` object
   * using `google-auth-library` and pass it to the client constructor.
   * This will ensure that unexpected credential types with potential for
   * malicious intent are not loaded unintentionally. For example:
   * ```
   * const {GoogleAuth} = require('google-auth-library');
   * const auth = new GoogleAuth({
   *   // Scopes can be specified either as an array or as a single, space-delimited string.
   *   scopes: 'https://www.googleapis.com/auth/cloud-platform'
   * });
   * const client = new MyClient({ auth: auth });
   * ```
   *
   * If you are loading your credential configuration from an untrusted source and have
   * not mitigated the risks (e.g. by validating the configuration yourself), make
   * these changes as soon as possible to prevent security risks to your environment.
   *
   * Regardless of the method used, it is always your responsibility to validate
   * configurations received from external sources.
   *
   * For more details, see https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   */
  keyFilename?: string;
  /**
   * @deprecated This option is being deprecated because of a potential security risk.
   *
   * This option does not validate the credential configuration. The security
   * risk occurs when a credential configuration is accepted from a source that
   * is not under your control and used without validation on your side.
   *
   * The recommended way to provide credentials is to create an `auth` object
   * using `google-auth-library` and pass it to the client constructor.
   * This will ensure that unexpected credential types with potential for
   * malicious intent are not loaded unintentionally. For example:
   * ```
   * const {GoogleAuth} = require('google-auth-library');
   * const auth = new GoogleAuth({
   *   // Scopes can be specified either as an array or as a single, space-delimited string.
   *   scopes: 'https://www.googleapis.com/auth/cloud-platform'
   * });
   * const client = new MyClient({ auth: auth });
   * ```
   *
   * If you are loading your credential configuration from an untrusted source and have
   * not mitigated the risks (e.g. by validating the configuration yourself), make
   * these changes as soon as possible to prevent security risks to your environment.
   *
   * Regardless of the method used, it is always your responsibility to validate
   * configurations received from external sources.
   *
   * For more details, see https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   */
  keyFile?: string;
  /**
   * @deprecated This option is being deprecated because of a potential security risk.
   *
   * This option does not validate the credential configuration. The security
   * risk occurs when a credential configuration is accepted from a source that
   * is not under your control and used without validation on your side.
   *
   * The recommended way to provide credentials is to create an `auth` object
   * using `google-auth-library` and pass it to the client constructor.
   * This will ensure that unexpected credential types with potential for
   * malicious intent are not loaded unintentionally. For example:
   * ```
   * const {GoogleAuth} = require('google-auth-library');
   * const auth = new GoogleAuth({
   *   // Scopes can be specified either as an array or as a single, space-delimited string.
   *   scopes: 'https://www.googleapis.com/auth/cloud-platform'
   * });
   * const client = new MyClient({ auth: auth });
   * ```
   *
   * If you are loading your credential configuration from an untrusted source and have
   * not mitigated the risks (e.g. by validating the configuration yourself), make
   * these changes as soon as possible to prevent security risks to your environment.
   *
   * Regardless of the method used, it is always your responsibility to validate
   * configurations received from external sources.
   *
   * For more details, see https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   */
  credentials?: JWTInput | ExternalAccountClientOptions;
  /**
   * `AuthClientOptions` object passed to the constructor of the client
   */
  clientOptions?: Extract<ConstructorParameters<AnyAuthClientConstructor>[0], AuthClientOptions>;
  /**
   * Required scopes for the desired API request
   */
  scopes?: string | string[];
  /**
   * Your project ID.
   */
  projectId?: string;
  /**
   * The default service domain for a given Cloud universe.
   *
   * This is an ergonomic equivalent to {@link clientOptions}'s `universeDomain`
   * property and will be set for all generated {@link AuthClient}s.
   */
  universeDomain?: string;
}
declare class GoogleAuth<T extends AuthClient = AuthClient> {
  #private;
  /**
   * Caches a value indicating whether the auth layer is running on Google
   * Compute Engine.
   * @private
   */
  private checkIsGCE?;
  useJWTAccessWithScope?: boolean;
  defaultServicePath?: string;
  get isGCE(): boolean | undefined;
  private _findProjectIdPromise?;
  private _cachedProjectId?;
  jsonContent: JWTInput | ExternalAccountClientOptions | null;
  apiKey: string | null;
  cachedCredential: AnyAuthClient | T | null;
  /**
   * Scopes populated by the client library by default. We differentiate between
   * these and user defined scopes when deciding whether to use a self-signed JWT.
   */
  defaultScopes?: string | string[];
  private keyFilename?;
  private scopes?;
  private clientOptions;
  /**
   * Configuration is resolved in the following order of precedence:
   * - {@link GoogleAuthOptions.credentials `credentials`}
   * - {@link GoogleAuthOptions.keyFilename `keyFilename`}
   * - {@link GoogleAuthOptions.keyFile `keyFile`}
   *
   * {@link GoogleAuthOptions.clientOptions `clientOptions`} are passed to the
   * {@link AuthClient `AuthClient`s}.
   *
   * @param opts
   */
  constructor(opts?: GoogleAuthOptions<T>);
  setGapicJWTValues(client: JWT): void;
  /**
   * Obtains the default project ID for the application.
   *
   * Retrieves in the following order of precedence:
   * - The `projectId` provided in this object's construction
   * - GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT environment variable
   * - GOOGLE_APPLICATION_CREDENTIALS JSON file
   * - Cloud SDK: `gcloud config config-helper --format json`
   * - GCE project ID from metadata server
   */
  getProjectId(): Promise<string>;
  getProjectId(callback: ProjectIdCallback): void;
  /**
   * A temporary method for internal `getProjectId` usages where `null` is
   * acceptable. In a future major release, `getProjectId` should return `null`
   * (as the `Promise<string | null>` base signature describes) and this private
   * method should be removed.
   *
   * @returns Promise that resolves with project id (or `null`)
   */
  private getProjectIdOptional;
  /**
   * A private method for finding and caching a projectId.
   *
   * Supports environments in order of precedence:
   * - GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT environment variable
   * - GOOGLE_APPLICATION_CREDENTIALS JSON file
   * - Cloud SDK: `gcloud config config-helper --format json`
   * - GCE project ID from metadata server
   *
   * @returns projectId
   */
  private findAndCacheProjectId;
  private getProjectIdAsync;
  /**
   * Retrieves a universe domain from the metadata server via
   * {@link gcpMetadata.universe}.
   *
   * @returns a universe domain
   */
  getUniverseDomainFromMetadataServer(): Promise<string>;
  /**
   * Retrieves, caches, and returns the universe domain in the following order
   * of precedence:
   * - The universe domain in {@link GoogleAuth.clientOptions}
   * - An existing or ADC {@link AuthClient}'s universe domain
   * - {@link gcpMetadata.universe}, if {@link Compute} client
   *
   * @returns The universe domain
   */
  getUniverseDomain(): Promise<string>;
  /**
   * @returns Any scopes (user-specified or default scopes specified by the
   *   client library) that need to be set on the current Auth client.
   */
  private getAnyScopes;
  /**
   * Obtains the default service-level credentials for the application.
   * @param callback Optional callback.
   * @returns Promise that resolves with the ADCResponse (if no callback was
   * passed).
   */
  getApplicationDefault(): Promise<ADCResponse>;
  getApplicationDefault(callback: ADCCallback): void;
  getApplicationDefault(options: AuthClientOptions): Promise<ADCResponse>;
  getApplicationDefault(options: AuthClientOptions, callback: ADCCallback): void;
  private getApplicationDefaultAsync;
  /**
   * Determines whether the auth layer is running on Google Compute Engine.
   * Checks for GCP Residency, then fallback to checking if metadata server
   * is available.
   *
   * @returns A promise that resolves with the boolean.
   * @api private
   */
  _checkIsGCE(): Promise<boolean>;
  /**
   * Attempts to load default credentials from the environment variable path..
   * @returns Promise that resolves with the OAuth2Client or null.
   * @api private
   */
  _tryGetApplicationCredentialsFromEnvironmentVariable(options?: AuthClientOptions): Promise<JSONClient | null>;
  /**
   * Attempts to load default credentials from a well-known file location
   * @return Promise that resolves with the OAuth2Client or null.
   * @api private
   */
  _tryGetApplicationCredentialsFromWellKnownFile(options?: AuthClientOptions): Promise<JSONClient | null>;
  /**
   * Attempts to load default credentials from a file at the given path..
   * @param filePath The path to the file to read.
   * @returns Promise that resolves with the OAuth2Client
   * @api private
   */
  _getApplicationCredentialsFromFilePath(filePath: string, options?: AuthClientOptions): Promise<JSONClient>;
  /**
   * Create a credentials instance using a given impersonated input options.
   * @param json The impersonated input object.
   * @returns JWT or UserRefresh Client with data
   */
  fromImpersonatedJSON(json: ImpersonatedJWTInput): Impersonated;
  /**
   * Create a credentials instance using the given input options.
   * This client is not cached.
   *
   * **Important**: If you accept a credential configuration (credential JSON/File/Stream) from an external source for authentication to Google Cloud, you must validate it before providing it to any Google API or library. Providing an unvalidated credential configuration to Google APIs can compromise the security of your systems and data. For more information, refer to {@link https://cloud.google.com/docs/authentication/external/externally-sourced-credentials Validate credential configurations from external sources}.
   *
   * @deprecated This method is being deprecated because of a potential security risk.
   *
   * This method does not validate the credential configuration. The security
   * risk occurs when a credential configuration is accepted from a source that
   * is not under your control and used without validation on your side.
   *
   * If you know that you will be loading credential configurations of a
   * specific type, it is recommended to use a credential-type-specific
   * constructor. This will ensure that an unexpected credential type with
   * potential for malicious intent is not loaded unintentionally. You might
   * still have to do validation for certain credential types. Please follow
   * the recommendation for that method. For example, if you want to load only
   * service accounts, you can use the `JWT` constructor:
   * ```
   * const {JWT} = require('google-auth-library');
   * const keys = require('/path/to/key.json');
   * const client = new JWT({
   *   email: keys.client_email,
   *   key: keys.private_key,
   *   scopes: ['https://www.googleapis.com/auth/cloud-platform'],
   * });
   * ```
   *
   * If you are loading your credential configuration from an untrusted source and have
   * not mitigated the risks (e.g. by validating the configuration yourself), make
   * these changes as soon as possible to prevent security risks to your environment.
   *
   * Regardless of the method used, it is always your responsibility to validate
   * configurations received from external sources.
   *
   * For more details, see https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   *
   * @param json The input object.
   * @param options The JWT or UserRefresh options for the client
   * @returns JWT or UserRefresh Client with data
   */
  fromJSON(json: JWTInput | ImpersonatedJWTInput, options?: AuthClientOptions): JSONClient;
  /**
   * Return a JWT or UserRefreshClient from JavaScript object, caching both the
   * object used to instantiate and the client.
   * @param json The input object.
   * @param options The JWT or UserRefresh options for the client
   * @returns JWT or UserRefresh Client with data
   */
  private _cacheClientFromJSON;
  /**
   * Create a credentials instance using the given input stream.
   *
   * @deprecated This method is being deprecated because of a potential security risk.
   *
   * This method does not validate the credential configuration. The security
   * risk occurs when a credential configuration is accepted from a source that
   * is not under your control and used without validation on your side.
   *
   * If you know that you will be loading credential configurations of a
   * specific type, it is recommended to read and parse the stream, and then
   * use a credential-type-specific constructor. This will ensure that an
   * unexpected credential type with potential for malicious intent is not
   * loaded unintentionally. You might still have to do validation for certain
   * credential types. Please follow the recommendation for that method. For
   * example, if you want to load only service accounts, you can do:
   * ```
   * const {JWT} = require('google-auth-library');
   * const fs = require('fs');
   *
   * const stream = fs.createReadStream('path/to/key.json');
   * const chunks = [];
   * stream.on('data', (chunk) => chunks.push(chunk));
   * stream.on('end', () => {
   *   const keys = JSON.parse(Buffer.concat(chunks).toString());
   *   const client = new JWT({
   *     email: keys.client_email,
   *     key: keys.private_key,
   *     scopes: ['https://www.googleapis.com/auth/cloud-platform'],
   *   });
   *   // use client
   * });
   * ```
   *
   * If you are loading your credential configuration from an untrusted source and have
   * not mitigated the risks (e.g. by validating the configuration yourself), make
   * these changes as soon as possible to prevent security risks to your environment.
   *
   * Regardless of the method used, it is always your responsibility to validate
   * configurations received from external sources.
   *
   * For more details, see https://cloud.google.com/docs/authentication/external/externally-sourced-credentials.
   * @param inputStream The input stream.
   * @param callback Optional callback.
   */
  fromStream(inputStream: stream.Readable): Promise<JSONClient>;
  fromStream(inputStream: stream.Readable, callback: CredentialCallback): void;
  fromStream(inputStream: stream.Readable, options: AuthClientOptions): Promise<JSONClient>;
  fromStream(inputStream: stream.Readable, options: AuthClientOptions, callback: CredentialCallback): void;
  private fromStreamAsync;
  /**
   * Create a credentials instance using the given API key string.
   * The created client is not cached. In order to create and cache it use the {@link GoogleAuth.getClient `getClient`} method after first providing an {@link GoogleAuth.apiKey `apiKey`}.
   *
   * @param apiKey The API key string
   * @param options An optional options object.
   * @returns A JWT loaded from the key
   */
  fromAPIKey(apiKey: string, options?: AuthClientOptions): JWT;
  /**
   * Determines whether the current operating system is Windows.
   * @api private
   */
  private _isWindows;
  /**
   * Run the Google Cloud SDK command that prints the default project ID
   */
  private getDefaultServiceProjectId;
  /**
   * Loads the project id from environment variables.
   * @api private
   */
  private getProductionProjectId;
  /**
   * Loads the project id from the GOOGLE_APPLICATION_CREDENTIALS json file.
   * @api private
   */
  private getFileProjectId;
  /**
   * Gets the project ID from external account client if available.
   */
  private getExternalAccountClientProjectId;
  /**
   * Gets the Compute Engine project ID if it can be inferred.
   */
  private getGCEProjectId;
  /**
   * The callback function handles a credential object that contains the
   * client_email and private_key (if exists).
   * getCredentials first checks if the client is using an external account and
   * uses the service account email in place of client_email.
   * If that doesn't exist, it checks for these values from the user JSON.
   * If the user JSON doesn't exist, and the environment is on GCE, it gets the
   * client_email from the cloud metadata server.
   * @param callback Callback that handles the credential object that contains
   * a client_email and optional private key, or the error.
   * returned
   */
  getCredentials(): Promise<CredentialBody>;
  getCredentials(callback: (err: Error | null, credentials?: CredentialBody) => void): void;
  private getCredentialsAsync;
  /**
   * Automatically obtain an {@link AuthClient `AuthClient`} based on the
   * provided configuration. If no options were passed, use Application
   * Default Credentials.
   */
  getClient(): Promise<AnyAuthClient | T>;
  /**
   * Creates a client which will fetch an ID token for authorization.
   * @param targetAudience the audience for the fetched ID token.
   * @returns IdTokenClient for making HTTP calls authenticated with ID tokens.
   */
  getIdTokenClient(targetAudience: string): Promise<IdTokenClient>;
  /**
   * Automatically obtain application default credentials, and return
   * an access token for making requests.
   */
  getAccessToken(): Promise<string | null | undefined>;
  /**
   * Obtain the HTTP headers that will provide authorization for a given
   * request.
   */
  getRequestHeaders(url?: string | URL): Promise<Headers>;
  /**
   * Obtain credentials for a request, then attach the appropriate headers to
   * the request options.
   * @param opts Axios or Request options on which to attach the headers
   */
  authorizeRequest(opts?: Pick<GaxiosOptions, 'url' | 'headers'>): Promise<Pick<GaxiosOptions, "headers" | "url">>;
  /**
   * A {@link fetch `fetch`} compliant API for {@link GoogleAuth}.
   *
   * @see {@link GoogleAuth.request} for the classic method.
   *
   * @remarks
   *
   * This is useful as a drop-in replacement for `fetch` API usage.
   *
   * @example
   *
   * ```ts
   * const auth = new GoogleAuth();
   * const fetchWithAuth: typeof fetch = (...args) => auth.fetch(...args);
   * await fetchWithAuth('https://example.com');
   * ```
   *
   * @param args `fetch` API or {@link Gaxios.fetch `Gaxios#fetch`} parameters
   * @returns the {@link GaxiosResponse} with Gaxios-added properties
   */
  fetch<T>(...args: Parameters<AuthClient['fetch']>): Promise<GaxiosResponse<T>>;
  /**
   * Automatically obtain application default credentials, and make an
   * HTTP request using the given options.
   *
   * @see {@link GoogleAuth.fetch} for the modern method.
   *
   * @param opts Axios request options for the HTTP request.
   */
  request<T>(opts: GaxiosOptions): Promise<GaxiosResponse<T>>;
  /**
   * Determine the compute environment in which the code is running.
   */
  getEnv(): Promise<GCPEnv>;
  /**
   * Sign the given data with the current private key, or go out
   * to the IAM API to sign it.
   * @param data The data to be signed.
   * @param endpoint A custom endpoint to use.
   *
   * @example
   * ```
   * sign('data', 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/');
   * ```
   */
  sign(data: string, endpoint?: string): Promise<string>;
  private signBlob;
}
interface SignBlobResponse {
  keyId: string;
  signedBlob: string;
}
//#endregion
//#region node_modules/.pnpm/gcp-metadata@8.1.2/node_modules/gcp-metadata/build/src/gcp-residency.d.ts
/**
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Known paths unique to Google Compute Engine Linux instances
 */
declare const GCE_LINUX_BIOS_PATHS: {
  BIOS_DATE: string;
  BIOS_VENDOR: string;
};
/**
 * Determines if the process is running on a Google Cloud Serverless environment (Cloud Run or Cloud Functions instance).
 *
 * Uses the:
 * - {@link https://cloud.google.com/run/docs/container-contract#env-vars Cloud Run environment variables}.
 * - {@link https://cloud.google.com/functions/docs/env-var Cloud Functions environment variables}.
 *
 * @returns {boolean} `true` if the process is running on GCP serverless, `false` otherwise.
 */
declare function isGoogleCloudServerless(): boolean;
/**
 * Determines if the process is running on a Linux Google Compute Engine instance.
 *
 * @returns {boolean} `true` if the process is running on Linux GCE, `false` otherwise.
 */
declare function isGoogleComputeEngineLinux(): boolean;
/**
 * Determines if the process is running on a Google Compute Engine instance with a known
 * MAC address.
 *
 * @returns {boolean} `true` if the process is running on GCE (as determined by MAC address), `false` otherwise.
 */
declare function isGoogleComputeEngineMACAddress(): boolean;
/**
 * Determines if the process is running on a Google Compute Engine instance.
 *
 * @returns {boolean} `true` if the process is running on GCE, `false` otherwise.
 */
declare function isGoogleComputeEngine(): boolean;
/**
 * Determines if the process is running on Google Cloud Platform.
 *
 * @returns {boolean} `true` if the process is running on GCP, `false` otherwise.
 */
declare function detectGCPResidency(): boolean;
declare namespace index_d_exports$1 {
  export { BASE_PATH, BulkResults, GCE_LINUX_BIOS_PATHS, HEADERS, HEADER_NAME, HEADER_VALUE, HOST_ADDRESS, METADATA_SERVER_DETECTION, MetadataAccessor, Options$1 as Options, SECONDARY_HOST_ADDRESS, bulk, detectGCPResidency, gcpResidencyCache, getGCPResidency, instance, isAvailable, isGoogleCloudServerless, isGoogleComputeEngine, isGoogleComputeEngineLinux, isGoogleComputeEngineMACAddress, project, requestTimeout, resetIsAvailableCache, setGCPResidency, universe };
}
declare const BASE_PATH = "/computeMetadata/v1";
declare const HOST_ADDRESS = "http://169.254.169.254";
declare const SECONDARY_HOST_ADDRESS = "http://metadata.google.internal.";
declare const HEADER_NAME = "Metadata-Flavor";
declare const HEADER_VALUE = "Google";
declare const HEADERS: Readonly<{
  "Metadata-Flavor": "Google";
}>;
/**
 * Metadata server detection override options.
 *
 * Available via `process.env.METADATA_SERVER_DETECTION`.
 */
declare const METADATA_SERVER_DETECTION: Readonly<{
  'assume-present': "don't try to ping the metadata server, but assume it's present";
  none: "don't try to ping the metadata server, but don't try to use it either";
  'bios-only': "treat the result of a BIOS probe as canonical (don't fall back to pinging)";
  'ping-only': "skip the BIOS probe, and go straight to pinging";
}>;
type HeadersInit = ConstructorParameters<typeof Headers>[0];
interface Options$1 {
  params?: {
    [index: string]: string;
  };
  property?: string;
  headers?: HeadersInit;
}
interface MetadataAccessor {
  /**
   *
   * @example
   *
   * // equivalent to `project('project-id')`;
   * const metadataKey = 'project/project-id';
   */
  metadataKey: string;
  params?: Options$1['params'];
  headers?: Options$1['headers'];
  noResponseRetries?: number;
  fastFail?: boolean;
}
type BulkResults<T extends readonly MetadataAccessor[]> = { [key in T[number]['metadataKey']]: ReturnType<JSON['parse']> };
/**
 * Obtain metadata for the current GCE instance.
 *
 * @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
 *
 * @example
 * ```
 * const serviceAccount: {} = await instance('service-accounts/');
 * const serviceAccountEmail: string = await instance('service-accounts/default/email');
 * ```
 */
declare function instance<T = any>(options?: string | Options$1): Promise<T>;
/**
 * Obtain metadata for the current GCP project.
 *
 * @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
 *
 * @example
 * ```
 * const projectId: string = await project('project-id');
 * const numericProjectId: number = await project('numeric-project-id');
 * ```
 */
declare function project<T = any>(options?: string | Options$1): Promise<T>;
/**
 * Obtain metadata for the current universe.
 *
 * @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
 *
 * @example
 * ```
 * const universeDomain: string = await universe('universe-domain');
 * ```
 */
declare function universe<T>(options?: string | Options$1): Promise<T>;
/**
 * Retrieve metadata items in parallel.
 *
 * @see {@link https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys}
 *
 * @example
 * ```
 * const data = await bulk([
 *   {
 *     metadataKey: 'instance',
 *   },
 *   {
 *     metadataKey: 'project/project-id',
 *   },
 * ] as const);
 *
 * // data.instance;
 * // data['project/project-id'];
 * ```
 *
 * @param properties The metadata properties to retrieve
 * @returns The metadata in `metadatakey:value` format
 */
declare function bulk<T extends readonly Readonly<MetadataAccessor>[], R extends BulkResults<T> = BulkResults<T>>(properties: T): Promise<R>;
/**
 * Determine if the metadata server is currently available.
 */
declare function isAvailable(): Promise<boolean>;
/**
 * reset the memoized isAvailable() lookup.
 */
declare function resetIsAvailableCache(): void;
/**
 * A cache for the detected GCP Residency.
 */
declare let gcpResidencyCache: boolean | null;
/**
 * Detects GCP Residency.
 * Caches results to reduce costs for subsequent calls.
 *
 * @see setGCPResidency for setting
 */
declare function getGCPResidency(): boolean;
/**
 * Sets the detected GCP Residency.
 * Useful for forcing metadata server detection behavior.
 *
 * Set `null` to autodetect the environment (default behavior).
 * @see getGCPResidency for getting
 */
declare function setGCPResidency(value?: boolean | null): void;
/**
 * Obtain the timeout for requests to the metadata server.
 *
 * In certain environments and conditions requests can take longer than
 * the default timeout to complete. This function will determine the
 * appropriate timeout based on the environment.
 *
 * @returns {number} a request timeout duration in milliseconds.
 */
declare function requestTimeout(): number;
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/computeclient.d.ts
interface ComputeOptions extends OAuth2ClientOptions {
  /**
   * The service account email to use, or 'default'. A Compute Engine instance
   * may have multiple service accounts.
   */
  serviceAccountEmail?: string;
  /**
   * The scopes that will be requested when acquiring service account
   * credentials. Only applicable to modern App Engine and Cloud Function
   * runtimes as of March 2019.
   */
  scopes?: string | string[];
}
declare class Compute extends OAuth2Client {
  readonly serviceAccountEmail: string;
  scopes: string[];
  /**
   * Google Compute Engine service account credentials.
   *
   * Retrieve access token from the metadata server.
   * See: https://cloud.google.com/compute/docs/access/authenticate-workloads#applications
   */
  constructor(options?: ComputeOptions);
  /**
   * Refreshes the access token.
   * @param refreshToken Unused parameter
   */
  protected refreshTokenNoCache(): Promise<GetTokenResponse>;
  /**
   * Fetches an ID token.
   * @param targetAudience the audience for the fetched ID token.
   */
  fetchIdToken(targetAudience: string): Promise<string>;
  protected wrapError(e: GaxiosError): void;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/iam.d.ts
interface RequestMetadata {
  'x-goog-iam-authority-selector': string;
  'x-goog-iam-authorization-token': string;
}
declare class IAMAuth {
  selector: string;
  token: string;
  /**
   * IAM credentials.
   *
   * @param selector the iam authority selector
   * @param token the token
   * @constructor
   */
  constructor(selector: string, token: string);
  /**
   * Acquire the HTTP headers required to make an authenticated request.
   */
  getRequestHeaders(): {
    'x-goog-iam-authority-selector': string;
    'x-goog-iam-authorization-token': string;
  };
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/jwtaccess.d.ts
interface Claims {
  [index: string]: string;
}
declare class JWTAccess {
  email?: string | null;
  key?: string | null;
  keyId?: string | null;
  projectId?: string;
  eagerRefreshThresholdMillis: number;
  private cache;
  /**
   * JWTAccess service account credentials.
   *
   * Create a new access token by using the credential to create a new JWT token
   * that's recognized as the access token.
   *
   * @param email the service account email address.
   * @param key the private key that will be used to sign the token.
   * @param keyId the ID of the private key used to sign the token.
   */
  constructor(email?: string | null, key?: string | null, keyId?: string | null, eagerRefreshThresholdMillis?: number);
  /**
   * Ensures that we're caching a key appropriately, giving precedence to scopes vs. url
   *
   * @param url The URI being authorized.
   * @param scopes The scope or scopes being authorized
   * @returns A string that returns the cached key.
   */
  getCachedKey(url?: string, scopes?: string | string[]): string;
  /**
   * Get a non-expired access token, after refreshing if necessary.
   *
   * @param url The URI being authorized.
   * @param additionalClaims An object with a set of additional claims to
   * include in the payload.
   * @returns An object that includes the authorization header.
   */
  getRequestHeaders(url?: string, additionalClaims?: Claims, scopes?: string | string[]): Headers;
  /**
   * Returns an expiration time for the JWT token.
   *
   * @param iat The issued at time for the JWT.
   * @returns An expiration time for the JWT.
   */
  private static getExpirationTime;
  /**
   * Create a JWTAccess credentials instance using the given input options.
   * @param json The input object.
   */
  fromJSON(json: JWTInput): void;
  /**
   * Create a JWTAccess credentials instance using the given input stream.
   * @param inputStream The input stream.
   * @param callback Optional callback.
   */
  fromStream(inputStream: stream.Readable): Promise<void>;
  fromStream(inputStream: stream.Readable, callback: (err?: Error) => void): void;
  private fromStreamAsync;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/downscopedclient.d.ts
/**
 * Internal interface for tracking the access token expiration time.
 */
interface CredentialsWithResponse extends Credentials {
  res?: GaxiosResponse | null;
}
/**
 * Internal interface for tracking and returning the Downscoped access token
 * expiration time in epoch time (seconds).
 */
interface DownscopedAccessTokenResponse extends GetAccessTokenResponse {
  expirationTime?: number | null;
}
/**
 * Defines an upper bound of permissions available for a GCP credential.
 */
interface CredentialAccessBoundary {
  accessBoundary: {
    accessBoundaryRules: AccessBoundaryRule[];
  };
}
/** Defines an upper bound of permissions on a particular resource. */
interface AccessBoundaryRule {
  availablePermissions: string[];
  availableResource: string;
  availabilityCondition?: AvailabilityCondition;
}
/**
 * An optional condition that can be used as part of a
 * CredentialAccessBoundary to further restrict permissions.
 */
interface AvailabilityCondition {
  expression: string;
  title?: string;
  description?: string;
}
interface DownscopedClientOptions extends AuthClientOptions {
  /**
   * The source AuthClient to be downscoped based on the provided Credential Access Boundary rules.
   */
  authClient: AuthClient;
  /**
   * The Credential Access Boundary which contains a list of access boundary rules.
   * Each rule contains information on the resource that the rule applies to, the upper bound of the
   * permissions that are available on that resource and an optional
   * condition to further restrict permissions.
   */
  credentialAccessBoundary: CredentialAccessBoundary;
}
/**
 * Defines a set of Google credentials that are downscoped from an existing set
 * of Google OAuth2 credentials. This is useful to restrict the Identity and
 * Access Management (IAM) permissions that a short-lived credential can use.
 * The common pattern of usage is to have a token broker with elevated access
 * generate these downscoped credentials from higher access source credentials
 * and pass the downscoped short-lived access tokens to a token consumer via
 * some secure authenticated channel for limited access to Google Cloud Storage
 * resources.
 */
declare class DownscopedClient extends AuthClient {
  private readonly authClient;
  private readonly credentialAccessBoundary;
  private cachedDownscopedAccessToken;
  private readonly stsCredential;
  /**
   * Instantiates a downscoped client object using the provided source
   * AuthClient and credential access boundary rules.
   * To downscope permissions of a source AuthClient, a Credential Access
   * Boundary that specifies which resources the new credential can access, as
   * well as an upper bound on the permissions that are available on each
   * resource, has to be defined. A downscoped client can then be instantiated
   * using the source AuthClient and the Credential Access Boundary.
   * @param options the {@link DownscopedClientOptions `DownscopedClientOptions`} to use. Passing an `AuthClient` directly is **@DEPRECATED**.
   * @param credentialAccessBoundary **@DEPRECATED**. Provide a {@link DownscopedClientOptions `DownscopedClientOptions`} object in the first parameter instead.
   */
  constructor(
  /**
   * AuthClient is for backwards-compatibility.
   */

  options: AuthClient | DownscopedClientOptions,
  /**
   * @deprecated - provide a {@link DownscopedClientOptions `DownscopedClientOptions`} object in the first parameter instead
   */

  credentialAccessBoundary?: CredentialAccessBoundary);
  /**
   * Provides a mechanism to inject Downscoped access tokens directly.
   * The expiry_date field is required to facilitate determination of the token
   * expiration which would make it easier for the token consumer to handle.
   * @param credentials The Credentials object to set on the current client.
   */
  setCredentials(credentials: Credentials): void;
  getAccessToken(): Promise<DownscopedAccessTokenResponse>;
  /**
   * The main authentication interface. It takes an optional url which when
   * present is the endpoint being accessed, and returns a Promise which
   * resolves with authorization header fields.
   *
   * The result has the form:
   * { authorization: 'Bearer <access_token_value>' }
   */
  getRequestHeaders(): Promise<Headers>;
  /**
   * Provides a request implementation with OAuth 2.0 flow. In cases of
   * HTTP 401 and 403 responses, it automatically asks for a new access token
   * and replays the unsuccessful request.
   * @param opts Request options.
   * @param callback callback.
   * @return A promise that resolves with the HTTP response when no callback
   *   is provided.
   */
  request<T>(opts: GaxiosOptions): GaxiosPromise<T>;
  request<T>(opts: GaxiosOptions, callback: BodyResponseCallback<T>): void;
  /**
   * Authenticates the provided HTTP request, processes it and resolves with the
   * returned response.
   * @param opts The HTTP request options.
   * @param reAuthRetried Whether the current attempt is a retry after a failed attempt due to an auth failure
   * @return A promise that resolves with the successful response.
   */
  protected requestAsync<T>(opts: GaxiosOptions, reAuthRetried?: boolean): Promise<GaxiosResponse<T>>;
  /**
   * Forces token refresh, even if unexpired tokens are currently cached.
   * GCP access tokens are retrieved from authclient object/source credential.
   * Then GCP access tokens are exchanged for downscoped access tokens via the
   * token exchange endpoint.
   * @return A promise that resolves with the fresh downscoped access token.
   */
  protected refreshAccessTokenAsync(): Promise<CredentialsWithResponse>;
  /**
   * Returns whether the provided credentials are expired or not.
   * If there is no expiry time, assumes the token is not expired or expiring.
   * @param downscopedAccessToken The credentials to check for expiration.
   * @return Whether the credentials are expired or not.
   */
  private isExpired;
}
//#endregion
//#region node_modules/.pnpm/google-auth-library@10.6.2/node_modules/google-auth-library/build/src/auth/passthrough.d.ts
/**
 * An AuthClient without any Authentication information. Useful for:
 * - Anonymous access
 * - Local Emulators
 * - Testing Environments
 *
 */
declare class PassThroughClient extends AuthClient {
  /**
   * Creates a request without any authentication headers or checks.
   *
   * @remarks
   *
   * In testing environments it may be useful to change the provided
   * {@link AuthClient.transporter} for any desired request overrides/handling.
   *
   * @param opts
   * @returns The response of the request.
   */
  request<T>(opts: GaxiosOptions): Promise<GaxiosResponse<T>>;
  /**
   * A required method of the base class.
   * Always will return an empty object.
   *
   * @returns {}
   */
  getAccessToken(): Promise<GetAccessTokenResponse>;
  /**
   * A required method of the base class.
   * Always will return an empty object.
   *
   * @returns {}
   */
  getRequestHeaders(): Promise<Headers>;
}
declare namespace index_d_exports {
  export { AnyAuthClient, AnyAuthClientConstructor, AuthClient, AwsClient, AwsClientOptions, AwsRequestSigner, AwsSecurityCredentials, AwsSecurityCredentialsSupplier, BaseExternalAccountClient, BaseExternalAccountClientOptions, Certificates, Claims, ClientAuthentication$1 as ClientAuthentication, CodeChallengeMethod, CodeVerifierResults, Compute, ComputeOptions, CredentialAccessBoundary, CredentialBody, CredentialRequest, Credentials, DEFAULT_UNIVERSE, DownscopedClient, EXTERNAL_ACCOUNT_AUTHORIZED_USER_TYPE, ExecutableError, ExternalAccountAuthorizedUserClient, ExternalAccountAuthorizedUserClientOptions, ExternalAccountClient, ExternalAccountClientOptions, ExternalAccountSupplierContext, GCPEnv, GenerateAuthUrlOpts, GetTokenCallback, GetTokenOptions$1 as GetTokenOptions, GoogleAuth, GoogleAuthOptions, GoogleToken, IAMAuth, IamGenerateAccessTokenResponse, IdTokenClient, IdTokenProvider, IdentityPoolClient, IdentityPoolClientOptions, Impersonated, ImpersonatedOptions, JWT, JWTAccess, JWTInput, JWTOptions, LoginTicket, OAuth2Client, OAuth2ClientOptions, PassThroughClient, PluggableAuthClient, PluggableAuthClientOptions, ProjectIdCallback, RefreshOptions, RequestMetadata, SharedExternalAccountClientOptions, SubjectTokenSupplier, TokenData, TokenInfo, TokenOptions, TokenPayload, Transporter, UserRefreshClient, UserRefreshClientOptions, VerifyIdTokenOptions, auth, index_d_exports$2 as gaxios, index_d_exports$1 as gcpMetadata };
}
type ALL_EXPORTS = (typeof index_d_exports)[keyof typeof index_d_exports];
/**
 * A union type for all {@link AuthClient `AuthClient`} constructors.
 */
type AnyAuthClientConstructor = Extract<ALL_EXPORTS, typeof AuthClient>;
/**
 * A union type for all {@link AuthClient `AuthClient`}s.
 */
type AnyAuthClient = InstanceType<AnyAuthClientConstructor>;
declare const auth: GoogleAuth<AuthClient>;
//#endregion
//#region node_modules/.pnpm/@google+genai@2.7.0_@modelc_15db9c8a3bfa8b279bf2cd770b08af6c/node_modules/@google/genai/dist/genai.d.ts
/** Marks the end of user activity.

 This can only be sent if automatic (i.e. server-side) activity detection is
 disabled. */
declare interface ActivityEnd {}
/** The different ways of handling user activity. */
declare enum ActivityHandling {
  /**
   * If unspecified, the default behavior is `START_OF_ACTIVITY_INTERRUPTS`.
   */
  ACTIVITY_HANDLING_UNSPECIFIED = "ACTIVITY_HANDLING_UNSPECIFIED",
  /**
   * If true, start of activity will interrupt the model's response (also called "barge in"). The model's current response will be cut-off in the moment of the interruption. This is the default behavior.
   */
  START_OF_ACTIVITY_INTERRUPTS = "START_OF_ACTIVITY_INTERRUPTS",
  /**
   * The model's response will not be interrupted.
   */
  NO_INTERRUPTION = "NO_INTERRUPTION"
}
/** Marks the start of user activity.

 This can only be sent if automatic (i.e. server-side) activity detection is
 disabled. */
declare interface ActivityStart {}
/** Adapter size for tuning. This enum is not supported in Gemini API. */
declare enum AdapterSize {
  /**
   * Adapter size is unspecified.
   */
  ADAPTER_SIZE_UNSPECIFIED = "ADAPTER_SIZE_UNSPECIFIED",
  /**
   * Adapter size 1.
   */
  ADAPTER_SIZE_ONE = "ADAPTER_SIZE_ONE",
  /**
   * Adapter size 2.
   */
  ADAPTER_SIZE_TWO = "ADAPTER_SIZE_TWO",
  /**
   * Adapter size 4.
   */
  ADAPTER_SIZE_FOUR = "ADAPTER_SIZE_FOUR",
  /**
   * Adapter size 8.
   */
  ADAPTER_SIZE_EIGHT = "ADAPTER_SIZE_EIGHT",
  /**
   * Adapter size 16.
   */
  ADAPTER_SIZE_SIXTEEN = "ADAPTER_SIZE_SIXTEEN",
  /**
   * Adapter size 32.
   */
  ADAPTER_SIZE_THIRTY_TWO = "ADAPTER_SIZE_THIRTY_TWO"
}
/**
 * An agent definition for the CreateAgent API. This message is the target for
 * annotation-parser-based JSON parsing. New format: { "id": "customer-sentinel",
 * "base_agent": "", "system_instruction": "...", "base_environment": { "type":
 * "remote", "sources": [...] }, "tools": [ {"type": "code_execution"} ] }
 */
declare interface Agent$1 {
  /**
   * The unique identifier for the agent.
   */
  id?: string;
  /**
   * The base agent to extend.
   */
  base_agent?: string;
  /**
   * The environment configuration for the agent.
   */
  base_environment?: InteractionsAPI.Environment | string;
  /**
   * Agent description for developers to quickly read and understand.
   */
  description?: string;
  /**
   * System instruction for the agent.
   */
  system_instruction?: string;
  /**
   * The tools available to the agent.
   */
  tools?: Array<Agent$1.CodeExecution | Agent$1.GoogleSearch | Agent$1.URLContext | Agent$1.MCPServer>;
}
declare namespace Agent$1 {
  /**
   * A tool that can be used by the model to execute code.
   */
  interface CodeExecution {
    type: 'code_execution';
  }
  /**
   * A tool that can be used by the model to search Google.
   */
  interface GoogleSearch {
    type: 'google_search';
    /**
     * The types of search grounding to enable.
     */
    search_types?: Array<'web_search' | 'image_search' | 'enterprise_web_search'>;
  }
  /**
   * A tool that can be used by the model to fetch URL context.
   */
  interface URLContext {
    type: 'url_context';
  }
  /**
   * A MCPServer is a server that can be called by the model to perform actions.
   */
  interface MCPServer {
    type: 'mcp_server';
    /**
     * The allowed tools.
     */
    allowed_tools?: Array<InteractionsAPI.AllowedTools>;
    /**
     * Optional: Fields for authentication headers, timeouts, etc., if needed.
     */
    headers?: {
      [key: string]: string;
    };
    /**
     * The name of the MCPServer.
     */
    name?: string;
    /**
     * The full URL for the MCPServer endpoint. Example: "https://api.example.com/mcp"
     */
    url?: string;
  }
}
declare interface AgentCreateParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Body param: The unique identifier for the agent.
   */
  id?: string;
  /**
   * Body param: The base agent to extend.
   */
  base_agent?: string;
  /**
   * Body param: The environment configuration for the agent.
   */
  base_environment?: InteractionsAPI.Environment | string;
  /**
   * Body param: Agent description for developers to quickly read and understand.
   */
  description?: string;
  /**
   * Body param: System instruction for the agent.
   */
  system_instruction?: string;
  /**
   * Body param: The tools available to the agent.
   */
  tools?: Array<AgentCreateParams.CodeExecution | AgentCreateParams.GoogleSearch | AgentCreateParams.URLContext | AgentCreateParams.MCPServer>;
}
declare namespace AgentCreateParams {
  /**
   * A tool that can be used by the model to execute code.
   */
  interface CodeExecution {
    type: 'code_execution';
  }
  /**
   * A tool that can be used by the model to search Google.
   */
  interface GoogleSearch {
    type: 'google_search';
    /**
     * The types of search grounding to enable.
     */
    search_types?: Array<'web_search' | 'image_search' | 'enterprise_web_search'>;
  }
  /**
   * A tool that can be used by the model to fetch URL context.
   */
  interface URLContext {
    type: 'url_context';
  }
  /**
   * A MCPServer is a server that can be called by the model to perform actions.
   */
  interface MCPServer {
    type: 'mcp_server';
    /**
     * The allowed tools.
     */
    allowed_tools?: Array<InteractionsAPI.AllowedTools>;
    /**
     * Optional: Fields for authentication headers, timeouts, etc., if needed.
     */
    headers?: {
      [key: string]: string;
    };
    /**
     * The name of the MCPServer.
     */
    name?: string;
    /**
     * The full URL for the MCPServer endpoint. Example: "https://api.example.com/mcp"
     */
    url?: string;
  }
}
declare interface AgentDeleteParams {
  /**
   * Which version of the API to use.
   */
  api_version?: string;
}
/**
 * A generic empty message that you can re-use to avoid defining duplicated empty
 * messages in your APIs. A typical example is to use it as the request or the
 * response type of an API method. For instance:
 *
 *     service Foo {
 *       rpc Bar(google.protobuf.Empty) returns (google.protobuf.Empty);
 *     }
 */
declare interface AgentDeleteResponse {}
declare interface AgentGetParams {
  /**
   * Which version of the API to use.
   */
  api_version?: string;
}
declare interface AgentListParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Query param
   */
  pageSize?: number;
  /**
   * Query param
   */
  pageToken?: string;
  /**
   * Query param
   */
  parent?: string;
}
declare interface AgentListResponse {
  agents?: Array<Agent$1>;
  nextPageToken?: string;
}
declare class Agents extends BaseAgents {}
declare namespace Agents {
  export { type Agent$1 as Agent, type AgentListResponse, type AgentDeleteResponse, type AgentCreateParams, type AgentListParams, type AgentDeleteParams, type AgentGetParams };
}
/** Aggregation metric. This enum is not supported in Gemini API. */
declare enum AggregationMetric {
  /**
   * Unspecified aggregation metric.
   */
  AGGREGATION_METRIC_UNSPECIFIED = "AGGREGATION_METRIC_UNSPECIFIED",
  /**
   * Average aggregation metric. Not supported for Pairwise metric.
   */
  AVERAGE = "AVERAGE",
  /**
   * Mode aggregation metric.
   */
  MODE = "MODE",
  /**
   * Standard deviation aggregation metric. Not supported for pairwise metric.
   */
  STANDARD_DEVIATION = "STANDARD_DEVIATION",
  /**
   * Variance aggregation metric. Not supported for pairwise metric.
   */
  VARIANCE = "VARIANCE",
  /**
   * Minimum aggregation metric. Not supported for pairwise metric.
   */
  MINIMUM = "MINIMUM",
  /**
   * Maximum aggregation metric. Not supported for pairwise metric.
   */
  MAXIMUM = "MAXIMUM",
  /**
   * Median aggregation metric. Not supported for pairwise metric.
   */
  MEDIAN = "MEDIAN",
  /**
   * 90th percentile aggregation metric. Not supported for pairwise metric.
   */
  PERCENTILE_P90 = "PERCENTILE_P90",
  /**
   * 95th percentile aggregation metric. Not supported for pairwise metric.
   */
  PERCENTILE_P95 = "PERCENTILE_P95",
  /**
   * 99th percentile aggregation metric. Not supported for pairwise metric.
   */
  PERCENTILE_P99 = "PERCENTILE_P99"
}
/** The aggregation result for the entire dataset and all metrics. This data type is not supported in Gemini API. */
declare interface AggregationOutput {
  /** One AggregationResult per metric. */
  aggregationResults?: AggregationResult[];
  /** The dataset used for evaluation & aggregation. */
  dataset?: EvaluationDataset;
}
/** The aggregation result for a single metric. This data type is not supported in Gemini API. */
declare interface AggregationResult {
  /** Aggregation metric. */
  aggregationMetric?: AggregationMetric;
  /** Results for bleu metric. */
  bleuMetricValue?: BleuMetricValue;
  /** Result for code execution metric. */
  customCodeExecutionResult?: CustomCodeExecutionResult;
  /** Results for exact match metric. */
  exactMatchMetricValue?: ExactMatchMetricValue;
  /** Result for pairwise metric. */
  pairwiseMetricResult?: PairwiseMetricResult;
  /** Result for pointwise metric. */
  pointwiseMetricResult?: PointwiseMetricResult;
  /** Results for rouge metric. */
  rougeMetricValue?: RougeMetricValue;
}
/**
 * The configuration for allowed tools.
 */
declare interface AllowedTools {
  /**
   * The mode of the tool choice.
   */
  mode?: ToolChoiceType;
  /**
   * The names of the allowed tools.
   */
  tools?: Array<string>;
}
/**
 * Citation information for model-generated content.
 */
declare type Annotation = URLCitation | FileCitation | PlaceCitation;
/** The generic reusable api auth config. Deprecated. Please use AuthConfig (google/cloud/aiplatform/master/auth.proto) instead. This data type is not supported in Gemini API. */
declare interface ApiAuth {
  /** The API secret. */
  apiKeyConfig?: ApiAuthApiKeyConfig;
}
/** The API secret. This data type is not supported in Gemini API. */
declare interface ApiAuthApiKeyConfig {
  /** Required. The SecretManager secret version resource name storing API key. e.g. projects/{project}/secrets/{secret}/versions/{version} */
  apiKeySecretVersion?: string;
  /** The API key string. Either this or `api_key_secret_version` must be set. */
  apiKeyString?: string;
}
/**
 * The ApiClient class is used to send requests to the Gemini API or Vertex AI
 * endpoints.
 *
 * WARNING: This is an internal API and may change without notice. Direct usage
 * is not supported and may break your application.
 */
declare class ApiClient implements GeminiNextGenAPIClientAdapter {
  readonly clientOptions: ApiClientInitOptions;
  private readonly customBaseUrl?;
  constructor(opts: ApiClientInitOptions);
  isVertexAI(): boolean;
  getProject(): string | undefined;
  getLocation(): string | undefined;
  getCustomBaseUrl(): string | undefined;
  getAuthHeaders(): Promise<Headers>;
  getApiVersion(): string;
  getBaseUrl(): string;
  getRequestUrl(): string;
  getHeaders(): Record<string, string>;
  private getRequestUrlInternal;
  getBaseResourcePath(): string;
  getApiKey(): string | undefined;
  getWebsocketBaseUrl(): string;
  setBaseUrl(url: string): void;
  private constructUrl;
  private shouldPrependVertexProjectPath;
  request(request: HttpRequest): Promise<types.HttpResponse>;
  private patchHttpOptions;
  requestStream(request: HttpRequest): Promise<AsyncGenerator<types.HttpResponse>>;
  private includeExtraHttpOptionsToRequestInit;
  private unaryApiCall;
  private streamApiCall;
  processStreamResponse(response: Response): AsyncGenerator<types.HttpResponse>;
  private apiCall;
  getDefaultHeaders(): Record<string, string>;
  private getHeadersInternal;
  private getFileName;
  /**
   * Uploads a file asynchronously using Gemini API only, this is not supported
   * in Vertex AI.
   *
   * @param file The string path to the file to be uploaded or a Blob object.
   * @param config Optional parameters specified in the `UploadFileConfig`
   *     interface. @see {@link types.UploadFileConfig}
   * @return A promise that resolves to a `File` object.
   * @throws An error if called on a Vertex AI client.
   * @throws An error if the `mimeType` is not provided and can not be inferred,
   */
  uploadFile(file: string | Blob, config?: types.UploadFileConfig): Promise<types.File>;
  /**
   * Uploads a file to a given file search store asynchronously using Gemini API only, this is not supported
   * in Vertex AI.
   *
   * @param fileSearchStoreName The name of the file search store to upload the file to.
   * @param file The string path to the file to be uploaded or a Blob object.
   * @param config Optional parameters specified in the `UploadFileConfig`
   *     interface. @see {@link UploadFileConfig}
   * @return A promise that resolves to a `File` object.
   * @throws An error if called on a Vertex AI client.
   * @throws An error if the `mimeType` is not provided and can not be inferred,
   */
  uploadFileToFileSearchStore(fileSearchStoreName: string, file: string | Blob, config?: types.UploadToFileSearchStoreConfig): Promise<types.UploadToFileSearchStoreOperation>;
  /**
   * Downloads a file asynchronously to the specified path.
   *
   * @params params - The parameters for the download request, see {@link
   * types.DownloadFileParameters}
   */
  downloadFile(params: types.DownloadFileParameters): Promise<void>;
  private fetchUploadUrl;
}
/**
 * Options for initializing the ApiClient. The ApiClient uses the parameters
 * for authentication purposes as well as to infer if SDK should send the
 * request to Vertex AI or Gemini API.
 */
declare interface ApiClientInitOptions {
  /**
   * The object used for adding authentication headers to API requests.
   */
  auth: Auth;
  /**
   * The uploader to use for uploading files. This field is required for
   * creating a client, will be set through the Node_client or Web_client.
   */
  uploader: Uploader;
  /**
   * Optional. The downloader to use for downloading files. This field is
   * required for creating a client, will be set through the Node_client or
   * Web_client.
   */
  downloader: Downloader;
  /**
   * Optional. The Google Cloud project ID for Vertex AI users.
   * It is not the numeric project name.
   * If not provided, SDK will try to resolve it from runtime environment.
   */
  project?: string;
  /**
   * Optional. The Google Cloud project location for Vertex AI users.
   * If not provided, SDK will try to resolve it from runtime environment.
   */
  location?: string;
  /**
   * The API Key. This is required for Gemini API users.
   */
  apiKey?: string;
  /**
   * Optional. Set to true if you intend to call Vertex AI endpoints.
   * If unset, default SDK behavior is to call Gemini API.
   */
  vertexai?: boolean;
  /**
   * Optional. The API version for the endpoint.
   * If unset, SDK will choose a default api version.
   */
  apiVersion?: string;
  /**
   * Optional. A set of customizable configuration for HTTP requests.
   */
  httpOptions?: types.HttpOptions;
  /**
   * Optional. An extra string to append at the end of the User-Agent header.
   *
   * This can be used to e.g specify the runtime and its version.
   */
  userAgentExtra?: string;
}
declare class APIConnectionError extends APIError<undefined, undefined, undefined> {
  constructor({
    message,
    cause
  }: {
    message?: string | undefined;
    cause?: Error | undefined;
  });
}
declare class APIConnectionTimeoutError extends APIConnectionError {
  constructor({
    message
  }?: {
    message?: string;
  });
}
declare class APIError<TStatus extends number | undefined = number | undefined, THeaders extends Headers | undefined = Headers | undefined, TError extends Object | undefined = Object | undefined> extends GeminiNextGenAPIClientError {
  /** HTTP status for the response that caused the error */
  readonly status: TStatus;
  /** HTTP headers for the response that caused the error */
  readonly headers: THeaders;
  /** JSON body of the response that caused the error */
  readonly error: TError;
  constructor(status: TStatus, error: TError, message: string | undefined, headers: THeaders);
  private static makeMessage;
  static generate(status: number | undefined, errorResponse: Object | undefined, message: string | undefined, headers: Headers | undefined): APIError;
}
/**
 * API errors raised by the GenAI API.
 */
/** Config for authentication with API key. This data type is not supported in Gemini API. */
declare interface ApiKeyConfig {
  /** Optional. The name of the SecretManager secret version resource storing the API key. Format: `projects/{project}/secrets/{secrete}/versions/{version}` - If both `api_key_secret` and `api_key_string` are specified, this field takes precedence over `api_key_string`. - If specified, the `secretmanager.versions.access` permission should be granted to Vertex AI Extension Service Agent (https://cloud.google.com/vertex-ai/docs/general/access-control#service-agents) on the specified resource. */
  apiKeySecret?: string;
  /** Optional. The API key to be used in the request directly. */
  apiKeyString?: string;
  /** Optional. The location of the API key. */
  httpElementLocation?: HttpElementLocation;
  /** Optional. The parameter name of the API key. E.g. If the API request is "https://example.com/act?api_key=", "api_key" would be the parameter name. */
  name?: string;
}
/**
 * A subclass of `Promise` providing additional helper methods
 * for interacting with the SDK.
 */
declare class APIPromise<T> extends Promise<T> {
  private responsePromise;
  private parseResponse;
  private parsedPromise;
  private client;
  constructor(client: BaseGeminiNextGenAPIClient, responsePromise: Promise<APIResponseProps>, parseResponse?: (client: BaseGeminiNextGenAPIClient, props: APIResponseProps) => PromiseOrValue<T>);
  _thenUnwrap<U>(transform: (data: T, props: APIResponseProps) => U): APIPromise<U>;
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse(): Promise<Response>;
  /**
   * Gets the parsed response data and the raw `Response` instance.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  withResponse(): Promise<{
    data: T;
    response: Response;
  }>;
  private parse;
  then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}
declare abstract class APIResource {
  /**
   * The key path from the client. For example, a resource accessible as `client.resource.subresource` would
   * have a property `static override readonly _key = Object.freeze(['resource', 'subresource'] as const);`.
   */
  static readonly _key: readonly string[];
  protected _client: BaseGeminiNextGenAPIClient;
  constructor(client: BaseGeminiNextGenAPIClient);
}
declare type APIResponseProps = {
  response: Response;
  options: FinalRequestOptions;
  controller: AbortController;
  requestLogID: string;
  retryOfRequestLogID: string | undefined;
  startTime: number;
};
/** The API spec that the external API implements. This enum is not supported in Gemini API. */
declare enum ApiSpec {
  /**
   * Unspecified API spec. This value should not be used.
   */
  API_SPEC_UNSPECIFIED = "API_SPEC_UNSPECIFIED",
  /**
   * Simple search API spec.
   */
  SIMPLE_SEARCH = "SIMPLE_SEARCH",
  /**
   * Elastic search API spec.
   */
  ELASTIC_SEARCH = "ELASTIC_SEARCH"
}
declare class APIUserAbortError extends APIError<undefined, undefined, undefined> {
  constructor({
    message
  }?: {
    message?: string;
  });
}
/** Representation of an audio chunk. */
declare interface AudioChunk {
  /** Raw bytes of audio data.
   * @remarks Encoded as base64 string. */
  data?: string;
  /** MIME type of the audio chunk. */
  mimeType?: string;
  /** Prompts and config used for generating this audio chunk. */
  sourceMetadata?: LiveMusicSourceMetadata;
}
/**
 * An audio content block.
 */
declare interface AudioContent {
  type: 'audio';
  /**
   * The number of audio channels.
   */
  channels?: number;
  /**
   * The audio content.
   */
  data?: string;
  /**
   * The mime type of the audio.
   */
  mime_type?: 'audio/wav' | 'audio/mp3' | 'audio/aiff' | 'audio/aac' | 'audio/ogg' | 'audio/flac' | 'audio/mpeg' | 'audio/m4a' | 'audio/l16' | 'audio/opus' | 'audio/alaw' | 'audio/mulaw';
  /**
   * The sample rate of the audio.
   */
  sample_rate?: number;
  /**
   * The URI of the audio.
   */
  uri?: string;
}
/**
 * Configuration for audio output format.
 */
declare interface AudioResponseFormat {
  type: 'audio';
  /**
   * Bit rate in bits per second (bps). Only applicable for compressed formats (MP3,
   * Opus).
   */
  bit_rate?: number;
  /**
   * The delivery mode for the audio output.
   */
  delivery?: 'inline' | 'uri';
  /**
   * The MIME type of the audio output.
   */
  mime_type?: 'audio/mp3' | 'audio/ogg_opus' | 'audio/l16' | 'audio/wav' | 'audio/alaw' | 'audio/mulaw';
  /**
   * Sample rate in Hz.
   */
  sample_rate?: number;
}
/** The audio transcription configuration in Setup. */
declare interface AudioTranscriptionConfig {
  /** The language codes of the audio. BCP-47 language code. If not set, the transcription will be in the language detected by the model. If set, the server will use the language code specified in the model config as a hint for the language of the audio
   */
  languageCodes?: string[];
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * The Auth interface is used to authenticate with the API service.
 */
declare interface Auth {
  /**
   * Sets the headers needed to authenticate with the API service.
   *
   * @param headers - The Headers object that will be updated with the authentication headers.
   * @param url - The URL of the request.
   */
  addAuthHeaders(headers: Headers, url?: string): Promise<void>;
}
/** The authentication config to access the API. */
declare interface AuthConfig {
  /** The authentication config to access the API. Only API key is supported. This field is not supported in Gemini API. */
  apiKey?: string;
  /** Config for API key auth. */
  apiKeyConfig?: ApiKeyConfig;
  /** Type of auth scheme. */
  authType?: AuthType;
  /** Config for Google Service Account auth. */
  googleServiceAccountConfig?: AuthConfigGoogleServiceAccountConfig;
  /** Config for HTTP Basic auth. */
  httpBasicAuthConfig?: AuthConfigHttpBasicAuthConfig;
  /** Config for user oauth. */
  oauthConfig?: AuthConfigOauthConfig;
  /** Config for user OIDC auth. */
  oidcConfig?: AuthConfigOidcConfig;
}
/** Config for Google Service Account Authentication. This data type is not supported in Gemini API. */
declare interface AuthConfigGoogleServiceAccountConfig {
  /** Optional. The service account that the extension execution service runs as. - If the service account is specified, the `iam.serviceAccounts.getAccessToken` permission should be granted to Vertex AI Extension Service Agent (https://cloud.google.com/vertex-ai/docs/general/access-control#service-agents) on the specified service account. - If not specified, the Vertex AI Extension Service Agent will be used to execute the Extension. */
  serviceAccount?: string;
}
/** Config for HTTP Basic Authentication. This data type is not supported in Gemini API. */
declare interface AuthConfigHttpBasicAuthConfig {
  /** Required. The name of the SecretManager secret version resource storing the base64 encoded credentials. Format: `projects/{project}/secrets/{secrete}/versions/{version}` - If specified, the `secretmanager.versions.access` permission should be granted to Vertex AI Extension Service Agent (https://cloud.google.com/vertex-ai/docs/general/access-control#service-agents) on the specified resource. */
  credentialSecret?: string;
}
/** Config for user oauth. This data type is not supported in Gemini API. */
declare interface AuthConfigOauthConfig {
  /** Access token for extension endpoint. Only used to propagate token from [[ExecuteExtensionRequest.runtime_auth_config]] at request time. */
  accessToken?: string;
  /** The service account used to generate access tokens for executing the Extension. - If the service account is specified, the `iam.serviceAccounts.getAccessToken` permission should be granted to Vertex AI Extension Service Agent (https://cloud.google.com/vertex-ai/docs/general/access-control#service-agents) on the provided service account. */
  serviceAccount?: string;
}
/** Config for user OIDC auth. This data type is not supported in Gemini API. */
declare interface AuthConfigOidcConfig {
  /** OpenID Connect formatted ID token for extension endpoint. Only used to propagate token from [[ExecuteExtensionRequest.runtime_auth_config]] at request time. */
  idToken?: string;
  /** The service account used to generate an OpenID Connect (OIDC)-compatible JWT token signed by the Google OIDC Provider (accounts.google.com) for extension endpoint (https://cloud.google.com/iam/docs/create-short-lived-credentials-direct#sa-credentials-oidc). - The audience for the token will be set to the URL in the server url defined in the OpenApi spec. - If the service account is provided, the service account should grant `iam.serviceAccounts.getOpenIdToken` permission to Vertex AI Extension Service Agent (https://cloud.google.com/vertex-ai/docs/general/access-control#service-agents). */
  serviceAccount?: string;
}
declare class AuthenticationError extends APIError<401, Headers> {}
/** Config for auth_tokens.create parameters. */
declare interface AuthToken {
  /** The name of the auth token. */
  name?: string;
}
/** Type of auth scheme. This enum is not supported in Gemini API. */
declare enum AuthType {
  AUTH_TYPE_UNSPECIFIED = "AUTH_TYPE_UNSPECIFIED",
  /**
   * No Auth.
   */
  NO_AUTH = "NO_AUTH",
  /**
   * API Key Auth.
   */
  API_KEY_AUTH = "API_KEY_AUTH",
  /**
   * HTTP Basic Auth.
   */
  HTTP_BASIC_AUTH = "HTTP_BASIC_AUTH",
  /**
   * Google Service Account Auth.
   */
  GOOGLE_SERVICE_ACCOUNT_AUTH = "GOOGLE_SERVICE_ACCOUNT_AUTH",
  /**
   * OAuth auth.
   */
  OAUTH = "OAUTH",
  /**
   * OpenID Connect (OIDC) Auth.
   */
  OIDC_AUTH = "OIDC_AUTH"
}
/** Configures automatic detection of activity. */
declare interface AutomaticActivityDetection {
  /** If enabled, detected voice and text input count as activity. If disabled, the client must send activity signals. */
  disabled?: boolean;
  /** Determines how likely speech is to be detected. */
  startOfSpeechSensitivity?: StartSensitivity;
  /** Determines how likely detected speech is ended. */
  endOfSpeechSensitivity?: EndSensitivity;
  /** The required duration of detected speech before start-of-speech is committed. The lower this value the more sensitive the start-of-speech detection is and the shorter speech can be recognized. However, this also increases the probability of false positives. */
  prefixPaddingMs?: number;
  /** The required duration of detected non-speech (e.g. silence) before end-of-speech is committed. The larger this value, the longer speech gaps can be without interrupting the user's activity but this will increase the model's latency. */
  silenceDurationMs?: number;
}
/** The configuration for automatic function calling. */
declare interface AutomaticFunctionCallingConfig {
  /** Whether to disable automatic function calling.
   If not set or set to False, will enable automatic function calling.
   If set to True, will disable automatic function calling.
   */
  disable?: boolean;
  /** If automatic function calling is enabled,
   maximum number of remote calls for automatic function calling.
   This number should be a positive integer.
   If not set, SDK will set maximum number of remote calls to 10.
   */
  maximumRemoteCalls?: number;
  /** If automatic function calling is enabled,
   whether to ignore call history to the response.
   If not set, SDK will set ignore_call_history to false,
   and will append the call history to
   GenerateContentResponse.automatic_function_calling_history.
   */
  ignoreCallHistory?: boolean;
}
/** Autorater config used for evaluation. */
declare interface AutoraterConfig {
  /** Number of samples for each instance in the dataset.
   If not specified, the default is 4. Minimum value is 1, maximum value
   is 32. */
  samplingCount?: number;
  /** Optional. Default is true. Whether to flip the candidate and baseline
   responses. This is only applicable to the pairwise metric. If enabled, also
   provide PairwiseMetricSpec.candidate_response_field_name and
   PairwiseMetricSpec.baseline_response_field_name. When rendering
   PairwiseMetricSpec.metric_prompt_template, the candidate and baseline
   fields will be flipped for half of the samples to reduce bias. */
  flipEnabled?: boolean;
  /** The fully qualified name of the publisher model or tuned autorater
   endpoint to use.
     Publisher model format:
   `projects/{project}/locations/{location}/publishers/{publisher}/models/{model}`
     Tuned model endpoint format:
   `projects/{project}/locations/{location}/endpoints/{endpoint}` */
  autoraterModel?: string;
  /** Configuration options for model generation and outputs. */
  generationConfig?: GenerationConfig;
}
/** Configures the avatar to be used in the session. */
declare interface AvatarConfig {
  /** Pre-built avatar id. */
  avatarName?: string;
  /** Customized avatar appearance with a reference image. */
  customizedAvatar?: CustomizedAvatar;
  /** The bitrate of compressed audio. */
  audioBitrateBps?: number;
  /** The bitrate of compressed video output. */
  videoBitrateBps?: number;
}
declare class BadRequestError extends APIError<400, Headers> {}
declare class BaseAgents extends APIResource {
  static readonly _key: readonly ['agents'];
  /**
   * Creates a new Agent (Typed version for SDK).
   */
  create(params?: AgentCreateParams | null | undefined, options?: RequestOptions$2): APIPromise<Agent$1>;
  /**
   * Lists all Agents.
   */
  list(params?: AgentListParams | null | undefined, options?: RequestOptions$2): APIPromise<AgentListResponse>;
  /**
   * Deletes an Agent.
   */
  delete(id: string, params?: AgentDeleteParams | null | undefined, options?: RequestOptions$2): APIPromise<AgentDeleteResponse>;
  /**
   * Gets a specific Agent.
   */
  get(id: string, params?: AgentGetParams | null | undefined, options?: RequestOptions$2): APIPromise<Agent$1>;
}
declare interface BaseCreateAgentInteractionParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Body param: The name of the `Agent` used for generating the interaction.
   */
  agent: 'deep-research-pro-preview-12-2025' | 'deep-research-preview-04-2026' | 'deep-research-max-preview-04-2026' | (string & {});
  /**
   * Body param: The input for the interaction.
   */
  input: string | Array<Step> | Array<Content_2> | TextContent | ImageContent | AudioContent | DocumentContent | VideoContent;
  /**
   * Body param: Configuration parameters for the agent interaction.
   */
  agent_config?: DynamicAgentConfig | DeepResearchAgentConfig;
  /**
   * Body param: Input only. Whether to run the model interaction in the background.
   */
  background?: boolean;
  /**
   * Body param: The environment configuration for the interaction. Can be an object
   * specifying remote environment sources or a string referencing an existing
   * environment ID.
   */
  environment?: string | Environment_2;
  /**
   * Body param: The ID of the previous interaction, if any.
   */
  previous_interaction_id?: string;
  /**
   * Body param: Enforces that the generated response is a JSON object that complies
   * with the JSON schema specified in this field.
   */
  response_format?: Array<AudioResponseFormat | TextResponseFormat | ImageResponseFormat | unknown> | AudioResponseFormat | TextResponseFormat | ImageResponseFormat | unknown;
  /**
   * @deprecated Body param: The mime type of the response. This is required if
   * response_format is set.
   */
  response_mime_type?: string;
  /**
   * Body param: The requested modalities of the response (TEXT, IMAGE, AUDIO).
   */
  response_modalities?: Array<'text' | 'image' | 'audio' | 'video' | 'document'>;
  /**
   * Body param: The service tier for the interaction.
   */
  service_tier?: 'flex' | 'standard' | 'priority';
  /**
   * Body param: Input only. Whether to store the response and request for later
   * retrieval.
   */
  store?: boolean;
  /**
   * Body param: Input only. Whether the interaction will be streamed.
   */
  stream?: boolean;
  /**
   * Body param: System instruction for the interaction.
   */
  system_instruction?: string;
  /**
   * Body param: A list of tool declarations the model may call during interaction.
   */
  tools?: Array<Tool_2>;
  /**
   * Body param: Optional. Webhook configuration for receiving notifications when the
   * interaction completes.
   */
  webhook_config?: WebhookConfig_2;
}
declare interface BaseCreateModelInteractionParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Body param: The input for the interaction.
   */
  input: string | Array<Step> | Array<Content_2> | TextContent | ImageContent | AudioContent | DocumentContent | VideoContent;
  /**
   * Body param: The name of the `Model` used for generating the interaction.
   */
  model: Model_2;
  /**
   * Body param: Input only. Whether to run the model interaction in the background.
   */
  background?: boolean;
  /**
   * Body param: The environment configuration for the interaction. Can be an object
   * specifying remote environment sources or a string referencing an existing
   * environment ID.
   */
  environment?: string | Environment_2;
  /**
   * Body param: Input only. Configuration parameters for the model interaction.
   */
  generation_config?: GenerationConfig_2;
  /**
   * Body param: The ID of the previous interaction, if any.
   */
  previous_interaction_id?: string;
  /**
   * Body param: Enforces that the generated response is a JSON object that complies
   * with the JSON schema specified in this field.
   */
  response_format?: Array<AudioResponseFormat | TextResponseFormat | ImageResponseFormat | unknown> | AudioResponseFormat | TextResponseFormat | ImageResponseFormat | unknown;
  /**
   * @deprecated Body param: The mime type of the response. This is required if
   * response_format is set.
   */
  response_mime_type?: string;
  /**
   * Body param: The requested modalities of the response (TEXT, IMAGE, AUDIO).
   */
  response_modalities?: Array<'text' | 'image' | 'audio' | 'video' | 'document'>;
  /**
   * Body param: The service tier for the interaction.
   */
  service_tier?: 'flex' | 'standard' | 'priority';
  /**
   * Body param: Input only. Whether to store the response and request for later
   * retrieval.
   */
  store?: boolean;
  /**
   * Body param: Input only. Whether the interaction will be streamed.
   */
  stream?: boolean;
  /**
   * Body param: System instruction for the interaction.
   */
  system_instruction?: string;
  /**
   * Body param: A list of tool declarations the model may call during interaction.
   */
  tools?: Array<Tool_2>;
  /**
   * Body param: Optional. Webhook configuration for receiving notifications when the
   * interaction completes.
   */
  webhook_config?: WebhookConfig_2;
}
/**
 * Base class for Gemini Next Gen API API clients.
 */
declare class BaseGeminiNextGenAPIClient {
  apiKey: string | null;
  apiVersion: string;
  baseURL: string;
  maxRetries: number;
  timeout: number;
  logger: Logger;
  logLevel: LogLevel | undefined;
  fetchOptions: MergedRequestInit | undefined;
  private fetch;
  private encoder;
  protected idempotencyHeader?: string;
  private _options;
  private clientAdapter;
  /**
   * API Client for interfacing with the Gemini Next Gen API API.
   *
   * @param {string | null | undefined} [opts.apiKey=process.env['GEMINI_API_KEY'] ?? null]
   * @param {string | undefined} [opts.apiVersion=v1beta]
   * @param {string} [opts.baseURL=process.env['GEMINI_NEXT_GEN_API_BASE_URL'] ?? https://generativelanguage.googleapis.com] - Override the default base URL for the API.
   * @param {number} [opts.timeout=1 minute] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   */
  constructor({
    baseURL,
    apiKey,
    apiVersion,
    ...opts
  }: ClientOptions);
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options: Partial<ClientOptions>): this;
  /**
   * Check whether the base URL is set to its default.
   */
  private baseURLOverridden;
  protected defaultQuery(): Record<string, string | undefined> | undefined;
  protected validateHeaders({
    values,
    nulls
  }: NullableHeaders): void;
  protected authHeaders(opts: FinalRequestOptions): Promise<NullableHeaders | undefined>;
  /**
   * Basic re-implementation of `qs.stringify` for primitive types.
   */
  protected stringifyQuery(query: object | Record<string, unknown>): string;
  private getUserAgent;
  protected defaultIdempotencyKey(): string;
  protected makeStatusError(status: number, error: Object, message: string | undefined, headers: Headers): Errors.APIError;
  buildURL(path: string, query: Record<string, unknown> | null | undefined, defaultBaseURL?: string | undefined): string;
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
     */
  protected prepareOptions(options: FinalRequestOptions): Promise<void>;
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  protected prepareRequest(request: _RequestInit, {
    url,
    options
  }: {
    url: string;
    options: FinalRequestOptions;
  }): Promise<void>;
  get<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions$2>): APIPromise<Rsp>;
  post<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions$2>): APIPromise<Rsp>;
  patch<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions$2>): APIPromise<Rsp>;
  put<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions$2>): APIPromise<Rsp>;
  delete<Rsp>(path: string, opts?: PromiseOrValue<RequestOptions$2>): APIPromise<Rsp>;
  private methodRequest;
  request<Rsp>(options: PromiseOrValue<FinalRequestOptions>, remainingRetries?: number | null): APIPromise<Rsp>;
  private makeRequest;
  fetchWithTimeout(url: _RequestInfo, init: _RequestInit | undefined, ms: number, controller: AbortController): Promise<Response>;
  private shouldRetry;
  private retryRequest;
  private calculateDefaultRetryTimeoutMillis;
  buildRequest(inputOptions: FinalRequestOptions, {
    retryCount
  }?: {
    retryCount?: number;
  }): Promise<{
    req: FinalizedRequestInit;
    url: string;
    timeout: number;
  }>;
  private buildHeaders;
  private _makeAbort;
  private buildBody;
  static DEFAULT_TIMEOUT: number;
}
declare class BaseInteractions extends APIResource {
  static readonly _key: readonly ['interactions'];
  /**
   * Creates a new interaction.
   *
   * @example
   * ```ts
   * const interaction = await client.interactions.create({
   *   api_version: 'api_version',
   *   input: { text: 'text', type: 'text' },
   *   model: 'gemini-2.5-computer-use-preview-10-2025',
   * });
   * ```
   */
  create(params: CreateModelInteractionParamsNonStreaming, options?: RequestOptions$2): APIPromise<Interaction>;
  create(params: CreateModelInteractionParamsStreaming, options?: RequestOptions$2): APIPromise<Stream$1<InteractionSSEEvent>>;
  create(params: CreateAgentInteractionParamsNonStreaming, options?: RequestOptions$2): APIPromise<Interaction>;
  create(params: CreateAgentInteractionParamsStreaming, options?: RequestOptions$2): APIPromise<Stream$1<InteractionSSEEvent>>;
  create(params: BaseCreateModelInteractionParams | BaseCreateAgentInteractionParams, options?: RequestOptions$2): APIPromise<Stream$1<InteractionSSEEvent> | Interaction>;
  /**
   * Deletes the interaction by id.
   *
   * @example
   * ```ts
   * const interaction = await client.interactions.delete('id', {
   *   api_version: 'api_version',
   * });
   * ```
   */
  delete(id: string, params?: InteractionDeleteParams | null | undefined, options?: RequestOptions$2): APIPromise<unknown>;
  /**
   * Cancels an interaction by id. This only applies to background interactions that
   * are still running.
   *
   * @example
   * ```ts
   * const interaction = await client.interactions.cancel('id', {
   *   api_version: 'api_version',
   * });
   * ```
   */
  cancel(id: string, params?: InteractionCancelParams | null | undefined, options?: RequestOptions$2): APIPromise<Interaction>;
  /**
   * Retrieves the full details of a single interaction based on its
   * `Interaction.id`.
   *
   * @example
   * ```ts
   * const interaction = await client.interactions.get('id', {
   *   api_version: 'api_version',
   * });
   * ```
   */
  get(id: string, params?: InteractionGetParamsNonStreaming, options?: RequestOptions$2): APIPromise<Interaction>;
  get(id: string, params: InteractionGetParamsStreaming, options?: RequestOptions$2): APIPromise<Stream$1<InteractionSSEEvent>>;
  get(id: string, params?: InteractionGetParamsBase | undefined, options?: RequestOptions$2): APIPromise<Stream$1<InteractionSSEEvent> | Interaction>;
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare class BaseModule {}
/**
 * Parameters for setting the base URLs for the Gemini API and Vertex AI API.
 */
declare class BaseWebhooks extends APIResource {
  static readonly _key: readonly ['webhooks'];
  /**
   * Creates a new Webhook.
   */
  create(params: WebhookCreateParams, options?: RequestOptions$2): APIPromise<Webhook>;
  /**
   * Updates an existing Webhook.
   */
  update(id: string, params?: WebhookUpdateParams | null | undefined, options?: RequestOptions$2): APIPromise<Webhook>;
  /**
   * Lists all Webhooks.
   */
  list(params?: WebhookListParams | null | undefined, options?: RequestOptions$2): APIPromise<WebhookListResponse>;
  /**
   * Deletes a Webhook.
   */
  delete(id: string, params?: WebhookDeleteParams | null | undefined, options?: RequestOptions$2): APIPromise<WebhookDeleteResponse>;
  /**
   * Gets a specific Webhook.
   */
  get(id: string, params?: WebhookGetParams | null | undefined, options?: RequestOptions$2): APIPromise<Webhook>;
  /**
   * Sends a ping event to a Webhook.
   */
  ping(id: string, params?: WebhookPingParams | null | undefined, options?: RequestOptions$2): APIPromise<WebhookPingResponse>;
  /**
   * Generates a new signing secret for a Webhook.
   */
  rotateSigningSecret(id: string, params?: WebhookRotateSigningSecretParams | null | undefined, options?: RequestOptions$2): APIPromise<WebhookRotateSigningSecretResponse>;
}
declare class Batches extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Lists batch jobs.
   *
   * @param params - The parameters for the list request.
   * @return - A pager of batch jobs.
   *
   * @example
   * ```ts
   * const batchJobs = await ai.batches.list({config: {'pageSize': 2}});
   * for await (const batchJob of batchJobs) {
   *   console.log(batchJob);
   * }
   * ```
   */
  list: (params?: types.ListBatchJobsParameters) => Promise<Pager<types.BatchJob>>;
  /**
   * Create batch job.
   *
   * @param params - The parameters for create batch job request.
   * @return The created batch job.
   *
   * @example
   * ```ts
   * const response = await ai.batches.create({
   *   model: 'gemini-2.0-flash',
   *   src: {gcsUri: 'gs://bucket/path/to/file.jsonl', format: 'jsonl'},
   *   config: {
   *     dest: {gcsUri: 'gs://bucket/path/output/directory', format: 'jsonl'},
   *   }
   * });
   * console.log(response);
   * ```
   */
  create: (params: types.CreateBatchJobParameters) => Promise<types.BatchJob>;
  /**
   * **Experimental** Creates an embedding batch job.
   *
   * @param params - The parameters for create embedding batch job request.
   * @return The created batch job.
   *
   * @example
   * ```ts
   * const response = await ai.batches.createEmbeddings({
   *   model: 'text-embedding-004',
   *   src: {fileName: 'files/my_embedding_input'},
   * });
   * console.log(response);
   * ```
   */
  createEmbeddings: (params: types.CreateEmbeddingsBatchJobParameters) => Promise<types.BatchJob>;
  private createInlinedGenerateContentRequest;
  private getGcsUri;
  private getBigqueryUri;
  private formatDestination;
  /**
   * Internal method to create batch job.
   *
   * @param params - The parameters for create batch job request.
   * @return The created batch job.
   *
   */
  private createInternal;
  /**
   * Internal method to create batch job.
   *
   * @param params - The parameters for create batch job request.
   * @return The created batch job.
   *
   */
  private createEmbeddingsInternal;
  /**
   * Gets batch job configurations.
   *
   * @param params - The parameters for the get request.
   * @return The batch job.
   *
   * @example
   * ```ts
   * await ai.batches.get({name: '...'}); // The server-generated resource name.
   * ```
   */
  get(params: types.GetBatchJobParameters): Promise<types.BatchJob>;
  /**
   * Cancels a batch job.
   *
   * @param params - The parameters for the cancel request.
   * @return The empty response returned by the API.
   *
   * @example
   * ```ts
   * await ai.batches.cancel({name: '...'}); // The server-generated resource name.
   * ```
   */
  cancel(params: types.CancelBatchJobParameters): Promise<void>;
  private listInternal;
  /**
   * Deletes a batch job.
   *
   * @param params - The parameters for the delete request.
   * @return The empty response returned by the API.
   *
   * @example
   * ```ts
   * await ai.batches.delete({name: '...'}); // The server-generated resource name.
   * ```
   */
  delete(params: types.DeleteBatchJobParameters): Promise<types.DeleteResourceJob>;
}
/** Config for batches.create return value. */
declare interface BatchJob {
  /** The resource name of the BatchJob. Output only.".
   */
  name?: string;
  /** The display name of the BatchJob.
   */
  displayName?: string;
  /** The state of the BatchJob.
   */
  state?: JobState;
  /** Output only. Only populated when the job's state is JOB_STATE_FAILED or JOB_STATE_CANCELLED. */
  error?: JobError;
  /** The time when the BatchJob was created.
   */
  createTime?: string;
  /** Output only. Time when the Job for the first time entered the `JOB_STATE_RUNNING` state. */
  startTime?: string;
  /** The time when the BatchJob was completed. This field is for Gemini Enterprise Agent Platform only.
   */
  endTime?: string;
  /** The time when the BatchJob was last updated.
   */
  updateTime?: string;
  /** The name of the model that produces the predictions via the BatchJob.
   */
  model?: string;
  /** Configuration for the input data. This field is for Gemini Enterprise Agent Platform only.
   */
  src?: BatchJobSource;
  /** Configuration for the output data.
   */
  dest?: BatchJobDestination;
  /** Statistics on completed and failed prediction instances. This field is for Gemini Enterprise Agent Platform only.
   */
  completionStats?: CompletionStats;
  /** Information further describing the output of this job. Output only.
   */
  outputInfo?: BatchJobOutputInfo;
}
/** Config for `des` parameter. */
declare interface BatchJobDestination {
  /** Storage format of the output files. Must be one of:
   'jsonl', 'bigquery', 'vertex-dataset'.
   */
  format?: string;
  /** The Google Cloud Storage URI to the output file.
   */
  gcsUri?: string;
  /** The BigQuery URI to the output table.
   */
  bigqueryUri?: string;
  /** The Gemini Developer API's file resource name of the output data
   (e.g. "files/12345"). The file will be a JSONL file with a single response
   per line. The responses will be GenerateContentResponse messages formatted
   as JSON. The responses will be written in the same order as the input
   requests.
   */
  fileName?: string;
  /** The responses to the requests in the batch. Returned when the batch was
   built using inlined requests. The responses will be in the same order as
   the input requests.
   */
  inlinedResponses?: InlinedResponse[];
  /** The responses to the requests in the batch. Returned when the batch was
   built using inlined requests. The responses will be in the same order as
   the input requests.
   */
  inlinedEmbedContentResponses?: InlinedEmbedContentResponse[];
  /** This field is experimental and may change in future versions. The Vertex AI dataset destination.
   */
  vertexDataset?: VertexMultimodalDatasetDestination;
}
declare type BatchJobDestinationUnion = BatchJobDestination | string;
/** Represents the `output_info` field in batch jobs. */
declare interface BatchJobOutputInfo {
  /** This field is experimental and may change in future versions. The Vertex AI dataset name containing the output data. */
  vertexMultimodalDatasetName?: string;
  /** The full path of the Cloud Storage directory created, into which the prediction output is written. */
  gcsOutputDirectory?: string;
  /** The name of the BigQuery table created, in `predictions_TIMESTAMP` format, into which the prediction output is written. */
  bigqueryOutputTable?: string;
}
/** Config for `src` parameter. */
declare interface BatchJobSource {
  /** Storage format of the input files. Must be one of:
   'jsonl', 'bigquery', 'vertex-dataset'.
   */
  format?: string;
  /** The Google Cloud Storage URIs to input files.
   */
  gcsUri?: string[];
  /** The BigQuery URI to input table.
   */
  bigqueryUri?: string;
  /** The Gemini Developer API's file resource name of the input data
   (e.g. "files/12345").
   */
  fileName?: string;
  /** The Gemini Developer API's inlined input data to run batch job.
   */
  inlinedRequests?: InlinedRequest[];
  /** This field is experimental and may change in future versions. The Vertex AI dataset resource name to use as input. Must be of type multimodal.
   */
  vertexDatasetName?: string;
}
declare type BatchJobSourceUnion = BatchJobSource | InlinedRequest[] | string;
/** Specifies the function Behavior. Currently only non-blocking functions are supported. If not specified, the system keeps the current function call behavior. This field is currently only supported by the BidiGenerateContent method. */
declare enum Behavior {
  /**
   * This value is unspecified.
   */
  UNSPECIFIED = "UNSPECIFIED",
  /**
   * If set, the system will wait to receive the function response before continuing the conversation.
   */
  BLOCKING = "BLOCKING",
  /**
   * If set, the system will not wait to receive the function response. Instead, it will attempt to handle function responses as they become available while maintaining the conversation between the user and the model.
   */
  NON_BLOCKING = "NON_BLOCKING"
}
/** The BigQuery location for the input content. This data type is not supported in Gemini API. */
declare interface BigQuerySource {
  /** Required. BigQuery URI to a table, up to 2000 characters long. Accepted forms: * BigQuery path. For example: `bq://projectId.bqDatasetId.bqTableId`. */
  inputUri?: string;
}
/** Bleu metric value for an instance. This data type is not supported in Gemini API. */
declare interface BleuMetricValue {
  /** Output only. Bleu score. */
  score?: number;
}
/** A content blob. A Blob contains data of a specific media type. It is used to represent images, audio, and video. */
declare interface Blob_2 {
  /** Required. The raw bytes of the data.
   * @remarks Encoded as base64 string. */
  data?: string;
  /** Optional. The display name of the blob. Used to provide a label or filename to distinguish blobs. This field is only returned in `PromptMessage` for prompt management. It is used in the Gemini calls only when server-side tools (`code_execution`, `google_search`, and `url_context`) are enabled. This field is not supported in Gemini API. */
  displayName?: string;
  /** Required. The IANA standard MIME type of the source data. */
  mimeType?: string;
}
declare type BlobImageUnion = Blob_2;
/** Output only. The reason why the prompt was blocked. */
declare enum BlockedReason {
  /**
   * The blocked reason is unspecified.
   */
  BLOCKED_REASON_UNSPECIFIED = "BLOCKED_REASON_UNSPECIFIED",
  /**
   * The prompt was blocked for safety reasons.
   */
  SAFETY = "SAFETY",
  /**
   * The prompt was blocked for other reasons. For example, it may be due to the prompt's language, or because it contains other harmful content.
   */
  OTHER = "OTHER",
  /**
   * The prompt was blocked because it contains a term from the terminology blocklist.
   */
  BLOCKLIST = "BLOCKLIST",
  /**
   * The prompt was blocked because it contains prohibited content.
   */
  PROHIBITED_CONTENT = "PROHIBITED_CONTENT",
  /**
   * The prompt was blocked because it contains content that is unsafe for image generation.
   */
  IMAGE_SAFETY = "IMAGE_SAFETY",
  /**
   * The prompt was blocked by Model Armor. This enum value is not supported in Gemini API.
   */
  MODEL_ARMOR = "MODEL_ARMOR",
  /**
   * The prompt was blocked as a jailbreak attempt. This enum value is not supported in Gemini API.
   */
  JAILBREAK = "JAILBREAK"
}
declare const brand_privateNullableHeaders: unique symbol;
/** @ts-ignore For users with \@types/bun */
declare type BunRequestInit = globalThis.FetchRequestInit;
/** A resource used in LLM queries for users to explicitly specify what to cache. */
declare interface CachedContent {
  /** The server-generated resource name of the cached content. */
  name?: string;
  /** The user-generated meaningful display name of the cached content. */
  displayName?: string;
  /** The name of the publisher model to use for cached content. */
  model?: string;
  /** Creation time of the cache entry. */
  createTime?: string;
  /** When the cache entry was last updated in UTC time. */
  updateTime?: string;
  /** Expiration time of the cached content. */
  expireTime?: string;
  /** Metadata on the usage of the cached content. */
  usageMetadata?: CachedContentUsageMetadata;
}
/** Metadata on the usage of the cached content. */
declare interface CachedContentUsageMetadata {
  /** Duration of audio in seconds. This field is not supported in Gemini API. */
  audioDurationSeconds?: number;
  /** Number of images. This field is not supported in Gemini API. */
  imageCount?: number;
  /** Number of text characters. This field is not supported in Gemini API. */
  textCount?: number;
  /** Total number of tokens that the cached content consumes. */
  totalTokenCount?: number;
  /** Duration of video in seconds. This field is not supported in Gemini API. */
  videoDurationSeconds?: number;
}
declare class Caches extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Lists cached contents.
   *
   * @param params - The parameters for the list request.
   * @return - A pager of cached contents.
   *
   * @example
   * ```ts
   * const cachedContents = await ai.caches.list({config: {'pageSize': 2}});
   * for await (const cachedContent of cachedContents) {
   *   console.log(cachedContent);
   * }
   * ```
   */
  list: (params?: types.ListCachedContentsParameters) => Promise<Pager<types.CachedContent>>;
  /**
   * Creates a cached contents resource.
   *
   * @remarks
   * Context caching is only supported for specific models. See [Gemini
   * Developer API reference](https://ai.google.dev/gemini-api/docs/caching?lang=node/context-cac)
   * and [Gemini Enterprise Agent Platform reference](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview#supported_models)
   * for more information.
   *
   * @param params - The parameters for the create request.
   * @return The created cached content.
   *
   * @example
   * ```ts
   * const contents = ...; // Initialize the content to cache.
   * const response = await ai.caches.create({
   *   model: 'gemini-2.0-flash-001',
   *   config: {
   *    'contents': contents,
   *    'displayName': 'test cache',
   *    'systemInstruction': 'What is the sum of the two pdfs?',
   *    'ttl': '86400s',
   *  }
   * });
   * ```
   */
  create(params: types.CreateCachedContentParameters): Promise<types.CachedContent>;
  /**
   * Gets cached content configurations.
   *
   * @param params - The parameters for the get request.
   * @return The cached content.
   *
   * @example
   * ```ts
   * await ai.caches.get({name: '...'}); // The server-generated resource name.
   * ```
   */
  get(params: types.GetCachedContentParameters): Promise<types.CachedContent>;
  /**
   * Deletes cached content.
   *
   * @param params - The parameters for the delete request.
   * @return The empty response returned by the API.
   *
   * @example
   * ```ts
   * await ai.caches.delete({name: '...'}); // The server-generated resource name.
   * ```
   */
  delete(params: types.DeleteCachedContentParameters): Promise<types.DeleteCachedContentResponse>;
  /**
   * Updates cached content configurations.
   *
   * @param params - The parameters for the update request.
   * @return The updated cached content.
   *
   * @example
   * ```ts
   * const response = await ai.caches.update({
   *   name: '...',  // The server-generated resource name.
   *   config: {'ttl': '7600s'}
   * });
   * ```
   */
  update(params: types.UpdateCachedContentParameters): Promise<types.CachedContent>;
  private listInternal;
}
/**
 * CallableTool is an invokable tool that can be executed with external
 * application (e.g., via Model Context Protocol) or local functions with
 * function calling.
 */
declare interface CallableTool {
  /**
   * Returns tool that can be called by Gemini.
   */
  tool(): Promise<Tool>;
  /**
   * Executes the callable tool with the given function call arguments and
   * returns the response parts from the tool execution.
   */
  callTool(functionCalls: FunctionCall[]): Promise<Part[]>;
}
/**
 * CallableToolConfig is the configuration for a callable tool.
 */
declare interface CallableToolConfig {
  /**
   * Specifies the model's behavior after invoking this tool.
   */
  behavior?: Behavior;
  /**
   * Timeout for remote calls in milliseconds. Note this timeout applies only to
   * tool remote calls, and not making HTTP requests to the API. */
  timeout?: number;
}
/** Optional parameters. */
declare interface CancelBatchJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Config for batches.cancel parameters. */
declare interface CancelBatchJobParameters {
  /** A fully-qualified BatchJob resource name or ID.
   Example: "projects/.../locations/.../batchPredictionJobs/456"
   or "456" when project and location are initialized in the client.
   */
  name: string;
  /** Optional parameters for the request. */
  config?: CancelBatchJobConfig;
}
/** Optional parameters for tunings.cancel method. */
declare interface CancelTuningJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for the cancel method. */
declare interface CancelTuningJobParameters {
  /** The resource name of the tuning job. */
  name: string;
  /** Optional parameters for the request. */
  config?: CancelTuningJobConfig;
}
/** Empty response for tunings.cancel method. */
declare class CancelTuningJobResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** A response candidate generated from the model. */
declare interface Candidate {
  /** Contains the multi-part content of the response.
   */
  content?: Content;
  /** Source attribution of the generated content.
   */
  citationMetadata?: CitationMetadata;
  /** Describes the reason the model stopped generating tokens.
   */
  finishMessage?: string;
  /** Number of tokens for this candidate.
   */
  tokenCount?: number;
  /** The reason why the model stopped generating tokens.
   If empty, the model has not stopped generating the tokens.
   */
  finishReason?: FinishReason;
  /** Output only. Metadata returned when grounding is enabled. It
   contains the sources used to ground the generated content.
   */
  groundingMetadata?: GroundingMetadata;
  /** Output only. The average log probability of the tokens in this candidate. This is a length-normalized score that can be used to compare the quality of candidates of different lengths. A higher average log probability suggests a more confident and coherent response. */
  avgLogprobs?: number;
  /** Output only. The 0-based index of this candidate in the list of generated responses. This is useful for distinguishing between multiple candidates when `candidate_count` > 1. */
  index?: number;
  /** Output only. The detailed log probability information for the tokens in this candidate. This is useful for debugging, understanding model uncertainty, and identifying potential "hallucinations". */
  logprobsResult?: LogprobsResult;
  /** Output only. A list of ratings for the safety of a response candidate. There is at most one rating per category. */
  safetyRatings?: SafetyRating[];
  /** Output only. Metadata returned when the model uses the `url_context` tool to get information from a user-provided URL. */
  urlContextMetadata?: UrlContextMetadata;
}
/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 */
declare class Chat {
  private readonly apiClient;
  private readonly modelsModule;
  private readonly model;
  private readonly config;
  private history;
  private sendPromise;
  constructor(apiClient: ApiClient, modelsModule: Models, model: string, config?: types.GenerateContentConfig, history?: types.Content[]);
  /**
   * Sends a message to the model and returns the response.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessageStream} for streaming method.
   * @param params - parameters for sending messages within a chat session.
   * @returns The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessage({
   *   message: 'Why is the sky blue?'
   * });
   * console.log(response.text);
   * ```
   */
  sendMessage(params: types.SendMessageParameters): Promise<types.GenerateContentResponse>;
  /**
   * Sends a message to the model and returns the response in chunks.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessage} for non-streaming method.
   * @param params - parameters for sending the message.
   * @return The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessageStream({
   *   message: 'Why is the sky blue?'
   * });
   * for await (const chunk of response) {
   *   console.log(chunk.text);
   * }
   * ```
   */
  sendMessageStream(params: types.SendMessageParameters): Promise<AsyncGenerator<types.GenerateContentResponse>>;
  /**
   * Returns the chat history.
   *
   * @remarks
   * The history is a list of contents alternating between user and model.
   *
   * There are two types of history:
   * - The `curated history` contains only the valid turns between user and
   * model, which will be included in the subsequent requests sent to the model.
   * - The `comprehensive history` contains all turns, including invalid or
   *   empty model outputs, providing a complete record of the history.
   *
   * The history is updated after receiving the response from the model,
   * for streaming response, it means receiving the last chunk of the response.
   *
   * The `comprehensive history` is returned by default. To get the `curated
   * history`, set the `curated` parameter to `true`.
   *
   * @param curated - whether to return the curated history or the comprehensive
   *     history.
   * @return History contents alternating between user and model for the entire
   *     chat session.
   */
  getHistory(curated?: boolean): types.Content[];
  private processStreamResponse;
  private recordHistory;
}
/**
 * A utility class to create a chat session.
 */
declare class Chats {
  private readonly modelsModule;
  private readonly apiClient;
  constructor(modelsModule: Models, apiClient: ApiClient);
  /**
   * Creates a new chat session.
   *
   * @remarks
   * The config in the params will be used for all requests within the chat
   * session unless overridden by a per-request `config` in
   * @see {@link types.SendMessageParameters#config}.
   *
   * @param params - Parameters for creating a chat session.
   * @returns A new chat session.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({
   *   model: 'gemini-2.0-flash'
   *   config: {
   *     temperature: 0.5,
   *     maxOutputTokens: 1024,
   *   }
   * });
   * ```
   */
  create(params: types.CreateChatParameters): Chat;
}
/** Describes the machine learning model version checkpoint. */
declare interface Checkpoint {
  /** The ID of the checkpoint.
   */
  checkpointId?: string;
  /** The epoch of the checkpoint.
   */
  epoch?: string;
  /** The step of the checkpoint.
   */
  step?: string;
}
/** Config for telling the service how to chunk the file. */
declare interface ChunkingConfig {
  /** White space chunking configuration. */
  whiteSpaceConfig?: WhiteSpaceConfig;
}
/** A citation for a piece of generatedcontent. This data type is not supported in Gemini API. */
declare interface Citation {
  /** Output only. The end index of the citation in the content. */
  endIndex?: number;
  /** Output only. The license of the source of the citation. */
  license?: string;
  /** Output only. The publication date of the source of the citation. */
  publicationDate?: GoogleTypeDate;
  /** Output only. The start index of the citation in the content. */
  startIndex?: number;
  /** Output only. The title of the source of the citation. */
  title?: string;
  /** Output only. The URI of the source of the citation. */
  uri?: string;
}
/** Citation information when the model quotes another source. */
declare interface CitationMetadata {
  /** Contains citation information when the model directly quotes, at
   length, from another source. Can include traditional websites and code
   repositories.
   */
  citations?: Citation[];
}
declare interface ClientOptions {
  /**
   * Defaults to process.env['GEMINI_API_KEY'].
   */
  apiKey?: string | null | undefined;
  apiVersion?: string | undefined;
  /**
   * Override the default base URL for the API, e.g., "https://api.example.com/v2/"
   *
   * Defaults to process.env['GEMINI_NEXT_GEN_API_BASE_URL'].
   */
  baseURL?: string | null | undefined;
  /**
   * The maximum amount of time (in milliseconds) that the client should wait for a response
   * from the server before timing out a single request.
   *
   * Note that request timeouts are retried by default, so in a worst-case scenario you may wait
   * much longer than this timeout before the promise succeeds or fails.
   *
   * @unit milliseconds
   */
  timeout?: number | undefined;
  /**
   * Additional `RequestInit` options to be passed to `fetch` calls.
   * Properties will be overridden by per-request `fetchOptions`.
   */
  fetchOptions?: MergedRequestInit | undefined;
  /**
   * Specify a custom `fetch` function implementation.
   *
   * If not provided, we expect that `fetch` is defined globally.
   */
  fetch?: Fetch | undefined;
  /**
   * The maximum number of times that the client will retry a request in case of a
   * temporary failure, like a network error or a 5XX error from the server.
   *
   * @default 2
   */
  maxRetries?: number | undefined;
  /**
   * Default headers to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * header to `null` in request options.
   */
  defaultHeaders?: HeadersLike | undefined;
  /**
   * Default query parameters to include with every request to the API.
   *
   * These can be removed in individual requests by explicitly setting the
   * param to `undefined` in request options.
   */
  defaultQuery?: Record<string, string | undefined> | undefined;
  /**
   * Set the log level.
   *
   * Defaults to process.env['GEMINI_NEXT_GEN_API_LOG'] or 'warn' if it isn't set.
   */
  logLevel?: LogLevel | undefined;
  /**
   * Set the logger.
   *
   * Defaults to globalThis.console.
   */
  logger?: Logger | undefined;
  /**
   * The adapter to the parent API client instance (for accessing auth, project, location)
   */
  clientAdapter?: GeminiNextGenAPIClientAdapter | undefined;
}
/**
 * The arguments to pass to the code execution.
 */
declare interface CodeExecutionCallArguments {
  /**
   * The code to be executed.
   */
  code?: string;
  /**
   * Programming language of the `code`.
   */
  language?: 'python';
}
/**
 * Code execution call step.
 */
declare interface CodeExecutionCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  /**
   * Required. The arguments to pass to the code execution.
   */
  arguments: CodeExecutionCallStep.Arguments;
  type: 'code_execution_call';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace CodeExecutionCallStep {
  /**
   * Required. The arguments to pass to the code execution.
   */
  interface Arguments {
    /**
     * The code to be executed.
     */
    code?: string;
    /**
     * Programming language of the `code`.
     */
    language?: 'python';
  }
}
/** Result of executing the ExecutableCode. Generated only when the `CodeExecution` tool is used. */
declare interface CodeExecutionResult {
  /** Required. Outcome of the code execution. */
  outcome?: Outcome;
  /** Optional. Contains stdout when code execution is successful, stderr or other description otherwise. */
  output?: string;
  /** Optional. The identifier of the `ExecutableCode` part this result is for. Only populated if the corresponding `ExecutableCode` has an id. This field is not supported in Vertex AI. */
  id?: string;
}
/**
 * Code execution result step.
 */
declare interface CodeExecutionResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  /**
   * Required. The output of the code execution.
   */
  result: string;
  type: 'code_execution_result';
  /**
   * Whether the code execution resulted in an error.
   */
  is_error?: boolean;
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/** Success and error statistics of processing multiple entities (for example, DataItems or structured data rows) in batch. This data type is not supported in Gemini API. */
declare interface CompletionStats {
  /** Output only. The number of entities for which any error was encountered. */
  failedCount?: string;
  /** Output only. In cases when enough errors are encountered a job, pipeline, or operation may be failed as a whole. Below is the number of entities for which the processing had not been finished (either in successful or failed state). Set to -1 if the number is unknown (for example, the operation failed before the total entity number could be collected). */
  incompleteCount?: string;
  /** Output only. The number of entities that had been processed successfully. */
  successfulCount?: string;
  /** Output only. The number of the successful forecast points that are generated by the forecasting model. This is ONLY used by the forecasting batch prediction. */
  successfulForecastPointCount?: string;
}
/** Composite reinforcement tuning reward config. */
declare interface CompositeReinforcementTuningRewardConfig {
  weightedRewardConfigs?: CompositeReinforcementTuningRewardConfigWeightedRewardConfig[];
}
/** Composite reinforcement tuning reward config weighted reward config. */
declare interface CompositeReinforcementTuningRewardConfigWeightedRewardConfig {
  rewardConfig?: SingleReinforcementTuningRewardConfig;
  /** How much this single reward contributes to the total overall reward. */
  weight?: number;
}
/** Tool to support computer use. */
declare interface ComputerUse {
  /** Required. The environment being operated. */
  environment?: Environment;
  /** By default, predefined functions are included in the final model call.
   Some of them can be explicitly excluded from being automatically included.
   This can serve two purposes:
   1. Using a more restricted / different action space.
   2. Improving the definitions / instructions of predefined functions. */
  excludedPredefinedFunctions?: string[];
  /** Optional. Whether enable the prompt injection detection check on computer-use request.
   */
  enablePromptInjectionDetection?: boolean;
}
/** Optional parameters for computing tokens. */
declare interface ComputeTokensConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for computing tokens. */
declare interface ComputeTokensParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** Input content. */
  contents: ContentListUnion;
  /** Optional parameters for the request.
   */
  config?: ComputeTokensConfig;
}
/** Response for computing tokens. */
declare class ComputeTokensResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** Lists of tokens info from the input. A ComputeTokensRequest could have multiple instances with a prompt in each instance. We also need to return lists of tokens info for the request with multiple instances. */
  tokensInfo?: TokensInfo[];
}
/** Local tokenizer compute tokens result. */
declare interface ComputeTokensResult {
  /** Lists of tokens info from the input. */
  tokensInfo?: TokensInfo[];
}
declare type _ConditionalNodeReadableStream<R = any> = typeof globalThis extends {
  ReadableStream: any;
} ? never : _NodeReadableStream<R>;
declare class ConflictError extends APIError<409, Headers> {}
/** Contains the multi-part content of a message. */
declare interface Content {
  /** List of parts that constitute a single message. Each part may have
   a different IANA MIME type. */
  parts?: Part[];
  /** Optional. The producer of the content. Must be either 'user' or 'model'. If not set, the service will default to 'user'. */
  role?: string;
}
/**
 * The content of the response.
 */
declare type Content_2 = TextContent | ImageContent | AudioContent | DocumentContent | VideoContent;
/** The embedding generated from an input content. */
declare interface ContentEmbedding {
  /** A list of floats representing an embedding.
   */
  values?: number[];
  /** Gemini Enterprise Agent Platform only. Statistics of the input text associated with this
   embedding.
   */
  statistics?: ContentEmbeddingStatistics;
}
/** Statistics of the input text associated with the result of content embedding. */
declare interface ContentEmbeddingStatistics {
  /** Gemini Enterprise Agent Platform only. If the input text was truncated due to having
   a length longer than the allowed maximum input.
   */
  truncated?: boolean;
  /** Gemini Enterprise Agent Platform only. Number of tokens of the input text.
   */
  tokenCount?: number;
}
declare type ContentListUnion = Content | Content[] | PartUnion | PartUnion[];
/** A content reference image.

 A content reference image represents a subject to reference (ex. person,
 product, animal) provided by the user. It can optionally be provided in
 addition to a style reference image (ex. background, style reference). */
declare class ContentReferenceImage {
  /** The reference image for the editing operation. */
  referenceImage?: Image_2;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Internal method to convert to ReferenceImageAPIInternal. */
  toReferenceImageAPI(): ReferenceImageAPIInternal;
}
declare type ContentUnion = Content | PartUnion[] | PartUnion;
/** Enables context window compression -- mechanism managing model context window so it does not exceed given length. */
declare interface ContextWindowCompressionConfig {
  /** Number of tokens (before running turn) that triggers context window compression mechanism. */
  triggerTokens?: string;
  /** Sliding window compression mechanism. */
  slidingWindow?: SlidingWindow;
}
/** Configuration for a Control reference image. */
declare interface ControlReferenceConfig {
  /** The type of control reference image to use. */
  controlType?: ControlReferenceType;
  /** Defaults to False. When set to True, the control image will be
   computed by the model based on the control type. When set to False,
   the control image must be provided by the user. */
  enableControlImageComputation?: boolean;
}
/** A control reference image.

 The image of the control reference image is either a control image provided
 by the user, or a regular image which the backend will use to generate a
 control image of. In the case of the latter, the
 enable_control_image_computation field in the config should be set to True.

 A control image is an image that represents a sketch image of areas for the
 model to fill in based on the prompt. */
declare class ControlReferenceImage {
  /** The reference image for the editing operation. */
  referenceImage?: Image_2;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Configuration for the control reference image. */
  config?: ControlReferenceConfig;
  /** Internal method to convert to ReferenceImageAPIInternal. */
  toReferenceImageAPI(): ReferenceImageAPIInternal;
}
/** Enum representing the control type of a control reference image. */
declare enum ControlReferenceType {
  CONTROL_TYPE_DEFAULT = "CONTROL_TYPE_DEFAULT",
  CONTROL_TYPE_CANNY = "CONTROL_TYPE_CANNY",
  CONTROL_TYPE_SCRIBBLE = "CONTROL_TYPE_SCRIBBLE",
  CONTROL_TYPE_FACE_MESH = "CONTROL_TYPE_FACE_MESH"
}
/** Config for the count_tokens method. */
declare interface CountTokensConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Instructions for the model to steer it toward better performance.
   */
  systemInstruction?: ContentUnion;
  /** Code that enables the system to interact with external systems to
   perform an action outside of the knowledge and scope of the model.
   */
  tools?: Tool[];
  /** Configuration that the model uses to generate the response. Not
   supported by the Gemini Developer API.
   */
  generationConfig?: GenerationConfig;
}
/** Parameters for counting tokens. */
declare interface CountTokensParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** Input content. */
  contents: ContentListUnion;
  /** Configuration for counting tokens. */
  config?: CountTokensConfig;
}
/** Response for counting tokens. */
declare class CountTokensResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** Total number of tokens. */
  totalTokens?: number;
  /** Number of tokens in the cached part of the prompt (the cached content). */
  cachedContentTokenCount?: number;
}
/** Local tokenizer count tokens result. */
declare interface CountTokensResult {
  /** The total number of tokens. */
  totalTokens?: number;
}
declare interface CreateAgentInteractionParamsNonStreaming extends BaseCreateAgentInteractionParams {
  /**
   * Body param: Input only. Whether the interaction will be streamed.
   */
  stream?: false;
}
declare interface CreateAgentInteractionParamsStreaming extends BaseCreateAgentInteractionParams {
  /**
   * Body param: Input only. Whether the interaction will be streamed.
   */
  stream: true;
}
/** Optional parameters. */
declare interface CreateAuthTokenConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** An optional time after which, when using the resulting token,
   messages in Live API sessions will be rejected. (Gemini may
   preemptively close the session after this time.)
     If not set then this defaults to 30 minutes in the future. If set, this
   value must be less than 20 hours in the future. */
  expireTime?: string;
  /** The time after which new Live API sessions using the token
   resulting from this request will be rejected.
     If not set this defaults to 60 seconds in the future. If set, this value
   must be less than 20 hours in the future. */
  newSessionExpireTime?: string;
  /** The number of times the token can be used. If this value is zero
   then no limit is applied. Default is 1. Resuming a Live API session does
   not count as a use. */
  uses?: number;
  /** Configuration specific to Live API connections created using this token. */
  liveConnectConstraints?: LiveConnectConstraints;
  /** Additional fields to lock in the effective LiveConnectParameters. */
  lockAdditionalFields?: string[];
}
/** Config for auth_tokens.create parameters. */
declare interface CreateAuthTokenParameters {
  /** Optional parameters for the request. */
  config?: CreateAuthTokenConfig;
}
/** Config for optional parameters. */
declare interface CreateBatchJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The user-defined name of this BatchJob.
   */
  displayName?: string;
  /** GCS or BigQuery URI prefix for the output predictions. Example:
   "gs://path/to/output/data" or "bq://projectId.bqDatasetId.bqTableId".
   */
  dest?: BatchJobDestinationUnion;
  /** Webhook configuration for receiving notifications when the batch
   operation completes.
   */
  webhookConfig?: WebhookConfig;
}
/** Config for batches.create parameters. */
declare interface CreateBatchJobParameters {
  /** The name of the model to produces the predictions via the BatchJob.
   */
  model?: string;
  /** GCS URI(-s) or BigQuery URI to your input data to run batch job.
   Example: "gs://path/to/input/data" or "bq://projectId.bqDatasetId.bqTableId".
   */
  src: BatchJobSourceUnion;
  /** Optional parameters for creating a BatchJob.
   */
  config?: CreateBatchJobConfig;
}
/** Optional configuration for cached content creation. */
declare interface CreateCachedContentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The TTL for this resource. The expiration time is computed: now + TTL. It is a duration string, with up to nine fractional digits, terminated by 's'. Example: "3.5s". */
  ttl?: string;
  /** Timestamp of when this resource is considered expired. Uses RFC 3339 format, Example: 2014-10-02T15:01:23Z. */
  expireTime?: string;
  /** The user-generated meaningful display name of the cached content.
   */
  displayName?: string;
  /** The content to cache.
   */
  contents?: ContentListUnion;
  /** Developer set system instruction.
   */
  systemInstruction?: ContentUnion;
  /** A list of `Tools` the model may use to generate the next response.
   */
  tools?: Tool[];
  /** Configuration for the tools to use. This config is shared for all tools.
   */
  toolConfig?: ToolConfig;
  /** The Cloud KMS resource identifier of the customer managed
   encryption key used to protect a resource.
   The key needs to be in the same region as where the compute resource is
   created. See
   https://cloud.google.com/vertex-ai/docs/general/cmek for more
   details. If this is set, then all created CachedContent objects
   will be encrypted with the provided encryption key.
   Allowed formats: projects/{project}/locations/{location}/keyRings/{key_ring}/cryptoKeys/{crypto_key}
   */
  kmsKeyName?: string;
}
/** Parameters for caches.create method. */
declare interface CreateCachedContentParameters {
  /** ID of the model to use. Example: gemini-2.0-flash */
  model: string;
  /** Configuration that contains optional parameters.
   */
  config?: CreateCachedContentConfig;
}
/** Parameters for initializing a new chat session.

 These parameters are used when creating a chat session with the
 `chats.create()` method. */
declare interface CreateChatParameters {
  /** The name of the model to use for the chat session.
     For example: 'gemini-2.0-flash', 'gemini-2.0-flash-lite', etc. See Gemini API
   docs to find the available models.
   */
  model: string;
  /** Config for the entire chat session.
     This config applies to all requests within the session
   unless overridden by a per-request `config` in `SendMessageParameters`.
   */
  config?: GenerateContentConfig;
  /** The initial conversation history for the chat session.
     This allows you to start the chat with a pre-existing history. The history
   must be a list of `Content` alternating between 'user' and 'model' roles.
   It should start with a 'user' message.
   */
  history?: Content[];
}
/** Config for optional parameters. */
declare interface CreateEmbeddingsBatchJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The user-defined name of this BatchJob.
   */
  displayName?: string;
}
/** Config for batches.create parameters. */
declare interface CreateEmbeddingsBatchJobParameters {
  /** The name of the model to produces the predictions via the BatchJob.
   */
  model?: string;
  /** input data to run batch job".
   */
  src: EmbeddingsBatchJobSource;
  /** Optional parameters for creating a BatchJob.
   */
  config?: CreateEmbeddingsBatchJobConfig;
}
/** Used to override the default configuration. */
declare interface CreateFileConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Generates the parameters for the private _create method. */
declare interface CreateFileParameters {
  /** The file to be uploaded.
   mime_type: (Required) The MIME type of the file. Must be provided.
   name: (Optional) The name of the file in the destination (e.g.
   'files/sample-image').
   display_name: (Optional) The display name of the file.
   */
  file: File_2;
  /** Used to override the default configuration. */
  config?: CreateFileConfig;
}
/** Response for the create file method. */
declare class CreateFileResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Optional parameters for creating a file search store. */
declare interface CreateFileSearchStoreConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The human-readable display name for the file search store.
   */
  displayName?: string;
  /** The embedding model to use for the FileSearchStore.
   Format: `models/{model}`. If not specified, the default embedding model will be used.
   */
  embeddingModel?: string;
}
/** Config for file_search_stores.create parameters. */
declare interface CreateFileSearchStoreParameters {
  /** Optional parameters for creating a file search store.
   */
  config?: CreateFileSearchStoreConfig;
}
/**
 * Creates a `FunctionResponsePart` object from a `base64` encoded `string`.
 */
declare function createFunctionResponsePartFromBase64(data: string, mimeType: string): FunctionResponsePart;
/**
 * Creates a `FunctionResponsePart` object from a `URI` string.
 */
declare function createFunctionResponsePartFromUri(uri: string, mimeType: string): FunctionResponsePart;
/**
 * Creates a `Content` object with a model role from a `PartListUnion` object or `string`.
 */
declare function createModelContent(partOrString: PartListUnion | string): Content;
declare interface CreateModelInteractionParamsNonStreaming extends BaseCreateModelInteractionParams {
  /**
   * Body param: Input only. Whether the interaction will be streamed.
   */
  stream?: false;
}
declare interface CreateModelInteractionParamsStreaming extends BaseCreateModelInteractionParams {
  /**
   * Body param: Input only. Whether the interaction will be streamed.
   */
  stream: true;
}
/**
 * Creates a `Part` object from a `base64` encoded `string`.
 */
declare function createPartFromBase64(data: string, mimeType: string, mediaResolution?: PartMediaResolutionLevel): Part;
/**
 * Creates a `Part` object from the `outcome` and `output` of a `CodeExecutionResult` object.
 */
declare function createPartFromCodeExecutionResult(outcome: Outcome, output: string): Part;
/**
 * Creates a `Part` object from the `code` and `language` of an `ExecutableCode` object.
 */
declare function createPartFromExecutableCode(code: string, language: Language): Part;
/**
 * Creates a `Part` object from a `FunctionCall` object.
 */
declare function createPartFromFunctionCall(name: string, args: Record<string, unknown>): Part;
/**
 * Creates a `Part` object from a `FunctionResponse` object.
 */
declare function createPartFromFunctionResponse(id: string, name: string, response: Record<string, unknown>, parts?: FunctionResponsePart[]): Part;
/**
 * Creates a `Part` object from a `text` string.
 */
declare function createPartFromText(text: string): Part;
/**
 * Creates a `Part` object from a `URI` string.
 */
declare function createPartFromUri(uri: string, mimeType: string, mediaResolution?: PartMediaResolutionLevel): Part;
/** Fine-tuning job creation request - optional fields. */
declare interface CreateTuningJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The method to use for tuning (SUPERVISED_FINE_TUNING or PREFERENCE_TUNING or DISTILLATION or REINFORCEMENT_TUNING). If not set, the default method (SFT) will be used. */
  method?: TuningMethod;
  /** Validation dataset for tuning. The dataset must be formatted as a JSONL file. */
  validationDataset?: TuningValidationDataset;
  /** The display name of the tuned Model. The name can be up to 128 characters long and can consist of any UTF-8 characters. */
  tunedModelDisplayName?: string;
  /** The description of the TuningJob */
  description?: string;
  /** Number of complete passes the model makes over the entire training dataset during training. */
  epochCount?: number;
  /** Multiplier for adjusting the default learning rate. 1P models only. Mutually exclusive with learning_rate. */
  learningRateMultiplier?: number;
  /** If set to true, disable intermediate checkpoints and only the last checkpoint will be exported. Otherwise, enable intermediate checkpoints. */
  exportLastCheckpointOnly?: boolean;
  /** The optional checkpoint id of the pre-tuned model to use for tuning, if applicable. */
  preTunedModelCheckpointId?: string;
  /** Adapter size for tuning. */
  adapterSize?: AdapterSize;
  /** Tuning mode for tuning. */
  tuningMode?: TuningMode;
  /** Custom base model for tuning. This is only supported for OSS models in Gemini Enterprise Agent Platform. */
  customBaseModel?: string;
  /** The batch size hyperparameter for tuning. This is only supported for OSS models in Gemini Enterprise Agent Platform. */
  batchSize?: number;
  /** The learning rate for tuning. OSS models only. Mutually exclusive with learning_rate_multiplier. */
  learningRate?: number;
  /** Optional. The labels with user-defined metadata to organize TuningJob and generated resources such as Model and Endpoint. Label keys and values can be no longer than 64 characters (Unicode codepoints), can only contain lowercase letters, numeric characters, underscores and dashes. International characters are allowed. See https://goo.gl/xmQnxf for more information and examples of labels. */
  labels?: Record<string, string>;
  /** Weight for KL Divergence regularization, Preference Optimization tuning only. */
  beta?: number;
  /** The base teacher model that is being distilled. Distillation only. */
  baseTeacherModel?: string;
  /** The resource name of the Tuned teacher model. Distillation only. */
  tunedTeacherModelSource?: string;
  /** Multiplier for adjusting the weight of the SFT loss. Distillation only. */
  sftLossWeightMultiplier?: number;
  /** The Google Cloud Storage location where the tuning job outputs are written. */
  outputUri?: string;
  /** The encryption spec of the tuning job. Customer-managed encryption key options for a TuningJob. If this is set, then all resources created by the TuningJob will be encrypted with provided encryption key. */
  encryptionSpec?: EncryptionSpec;
  /** Reward function configuration for reinforcement tuning. Reinforcement tuning only. */
  rewardConfig?: SingleReinforcementTuningRewardConfig;
  /** Composite reward function configuration for reinforcement tuning. Reinforcement tuning only. */
  compositeRewardConfig?: CompositeReinforcementTuningRewardConfig;
  /** Number of different responses to generate per prompt during tuning. Reinforcement tuning only. */
  samplesPerPrompt?: number;
  /** How often at steps to evaluate the tuning job during training. Reinforcement tuning only. */
  evaluateInterval?: number;
  /** How often at steps to save checkpoints during training. Reinforcement tuning only. */
  checkpointInterval?: number;
  /** The maximum number of tokens to generate per prompt. Reinforcement tuning only. */
  maxOutputTokens?: number;
}
/** Fine-tuning job creation parameters - optional fields. */
declare interface CreateTuningJobParameters {
  /** The base model that is being tuned, e.g., "gemini-2.5-flash". */
  baseModel: string;
  /** Cloud Storage path to file containing training dataset for tuning. The dataset must be formatted as a JSONL file. */
  trainingDataset: TuningDataset;
  /** Configuration for the tuning job. */
  config?: CreateTuningJobConfig;
}
/** Fine-tuning job creation parameters - optional fields. */
declare interface CreateTuningJobParametersPrivate {
  /** The base model that is being tuned, e.g., "gemini-2.5-flash". */
  baseModel?: string;
  /** The PreTunedModel that is being tuned. */
  preTunedModel?: PreTunedModel;
  /** Cloud Storage path to file containing training dataset for tuning. The dataset must be formatted as a JSONL file. */
  trainingDataset: TuningDataset;
  /** Configuration for the tuning job. */
  config?: CreateTuningJobConfig;
}
/**
 * Creates a `Content` object with a user role from a `PartListUnion` object or `string`.
 */
declare function createUserContent(partOrString: PartListUnion | string): Content;
/** Result for custom code execution metric. This data type is not supported in Gemini API. */
declare interface CustomCodeExecutionResult {
  /** Output only. Custom code execution score. */
  score?: number;
}
/** Configures the customized avatar to be used in the session. */
declare interface CustomizedAvatar {
  /** The mime type of the reference image, e.g., "image/jpeg". */
  imageMimeType?: string;
  /** The data of the reference image. The dimensions of the reference
   image should be 9:16 (portrait) with a minimum resolution of 704x1280.
   * @remarks Encoded as base64 string. */
  imageData?: string;
}
/** User provided metadata stored as key-value pairs. This data type is not supported in Vertex AI. */
declare interface CustomMetadata {
  /** Required. The key of the metadata to store. */
  key?: string;
  /** The numeric value of the metadata to store. */
  numericValue?: number;
  /** The StringList value of the metadata to store. */
  stringListValue?: StringList;
  /** The string value of the metadata to store. */
  stringValue?: string;
}
/** Spec for custom output. This data type is not supported in Gemini API. */
declare interface CustomOutput {
  /** Output only. List of raw output strings. */
  rawOutputs?: RawOutput;
}
/** Distribution computed over a tuning dataset. This data type is not supported in Gemini API. */
declare interface DatasetDistribution {
  /** Output only. Defines the histogram bucket. */
  buckets?: DatasetDistributionDistributionBucket[];
  /** Output only. The maximum of the population values. */
  max?: number;
  /** Output only. The arithmetic mean of the values in the population. */
  mean?: number;
  /** Output only. The median of the values in the population. */
  median?: number;
  /** Output only. The minimum of the population values. */
  min?: number;
  /** Output only. The 5th percentile of the values in the population. */
  p5?: number;
  /** Output only. The 95th percentile of the values in the population. */
  p95?: number;
  /** Output only. Sum of a given population of values. */
  sum?: number;
}
/** Dataset bucket used to create a histogram for the distribution given a population of values. This data type is not supported in Gemini API. */
declare interface DatasetDistributionDistributionBucket {
  /** Output only. Number of values in the bucket. */
  count?: string;
  /** Output only. Left bound of the bucket. */
  left?: number;
  /** Output only. Right bound of the bucket. */
  right?: number;
}
/** Statistics computed over a tuning dataset. This data type is not supported in Gemini API. */
declare interface DatasetStats {
  /** Output only. A partial sample of the indices (starting from 1) of the dropped examples. */
  droppedExampleIndices?: string[];
  /** Output only. For each index in `dropped_example_indices`, the user-facing reason why the example was dropped. */
  droppedExampleReasons?: string[];
  /** Output only. Number of billable characters in the tuning dataset. */
  totalBillableCharacterCount?: string;
  /** Output only. Number of tuning characters in the tuning dataset. */
  totalTuningCharacterCount?: string;
  /** Output only. Number of examples in the tuning dataset. */
  tuningDatasetExampleCount?: string;
  /** Output only. Number of tuning steps for this Tuning Job. */
  tuningStepCount?: string;
  /** Output only. Sample user messages in the training dataset uri. */
  userDatasetExamples?: Content[];
  /** Output only. Dataset distributions for the user input tokens. */
  userInputTokenDistribution?: DatasetDistribution;
  /** Output only. Dataset distributions for the messages per example. */
  userMessagePerExampleDistribution?: DatasetDistribution;
  /** Output only. Dataset distributions for the user output tokens. */
  userOutputTokenDistribution?: DatasetDistribution;
}
/**
 * Configuration for the Deep Research agent.
 */
declare interface DeepResearchAgentConfig {
  type: 'deep-research';
  /**
   * Enables human-in-the-loop planning for the Deep Research agent. If set to true,
   * the Deep Research agent will provide a research plan in its response. The agent
   * will then proceed only if the user confirms the plan in the next turn.
   */
  collaborative_planning?: boolean;
  /**
   * Enables bigquery tool for the Deep Research agent.
   */
  enable_bigquery_tool?: boolean;
  /**
   * Whether to include thought summaries in the response.
   */
  thinking_summaries?: 'auto' | 'none';
  /**
   * Whether to include visualizations in the response.
   */
  visualization?: 'off' | 'auto';
}
/** Optional parameters for models.get method. */
declare interface DeleteBatchJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Config for batches.delete parameters. */
declare interface DeleteBatchJobParameters {
  /** A fully-qualified BatchJob resource name or ID.
   Example: "projects/.../locations/.../batchPredictionJobs/456"
   or "456" when project and location are initialized in the client.
   */
  name: string;
  /** Optional parameters for the request. */
  config?: DeleteBatchJobConfig;
}
/** Optional parameters for caches.delete method. */
declare interface DeleteCachedContentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for caches.delete method. */
declare interface DeleteCachedContentParameters {
  /** The server-generated resource name of the cached content.
   */
  name: string;
  /** Optional parameters for the request.
   */
  config?: DeleteCachedContentConfig;
}
/** Empty response for caches.delete method. */
declare class DeleteCachedContentResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Config for optional parameters. */
declare interface DeleteDocumentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** If set to true, any `Chunk`s and objects related to this `Document` will
   also be deleted.
   */
  force?: boolean;
}
/** Config for documents.delete parameters. */
declare interface DeleteDocumentParameters {
  /** The resource name of the Document.
   Example: fileSearchStores/file-search-store-foo/documents/documents-bar */
  name: string;
  /** Optional parameters for the request. */
  config?: DeleteDocumentConfig;
}
/** Used to override the default configuration. */
declare interface DeleteFileConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Generates the parameters for the get method. */
declare interface DeleteFileParameters {
  /** The name identifier for the file to be deleted. */
  name: string;
  /** Used to override the default configuration. */
  config?: DeleteFileConfig;
}
/** Response for the delete file method. */
declare class DeleteFileResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Optional parameters for deleting a FileSearchStore. */
declare interface DeleteFileSearchStoreConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** If set to true, any Documents and objects related to this FileSearchStore will also be deleted.
   If false (the default), a FAILED_PRECONDITION error will be returned if
   the FileSearchStore contains any Documents.
   */
  force?: boolean;
}
/** Config for file_search_stores.delete parameters. */
declare interface DeleteFileSearchStoreParameters {
  /** The resource name of the FileSearchStore. Example: `fileSearchStores/my-file-search-store-123` */
  name: string;
  /** Optional parameters for the request. */
  config?: DeleteFileSearchStoreConfig;
}
/** Configuration for deleting a tuned model. */
declare interface DeleteModelConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for deleting a tuned model. */
declare interface DeleteModelParameters {
  model: string;
  /** Optional parameters for the request. */
  config?: DeleteModelConfig;
}
declare class DeleteModelResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** The return value of delete operation. */
declare interface DeleteResourceJob {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  name?: string;
  done?: boolean;
  error?: JobError;
}
/** Statistics for distillation prompt dataset. These statistics do not include the responses sampled from the teacher model. This data type is not supported in Gemini API. */
declare interface DistillationDataStats {
  /** Output only. Statistics computed for the training dataset. */
  trainingDatasetStats?: DatasetStats;
}
/** Distillation hyperparameters for tuning. */
declare interface DistillationHyperParameters {
  /** The size of the adapter. Can be 'small', 'medium', or 'large'. */
  adapterSize?: AdapterSize;
  /** Number of complete passes the model makes over the entire training dataset
   during training. */
  epochCount?: string;
  /** Multiplier for adjusting the default learning rate. */
  learningRateMultiplier?: number;
  /** Generation config for Distillation teacher model sampling. Only the
   following fields are supported for distillation teacher samplings:
   - temperature
   - top_p
   - top_k
   - candidate_count
   - thinking_config */
  generationConfig?: GenerationConfig;
  /** The learning rate for distillation tuning. */
  learningRate?: number;
  /** Batch size for tuning. This feature is only available for open
   source models. */
  batchSize?: number;
}
/** Distillation sampling spec for tuning. */
declare interface DistillationSamplingSpec {
  /** The base teacher model that is being distilled. See [Supported
   models](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/tuning#supported_models). */
  baseTeacherModel?: string;
  /** The resource name of the Tuned teacher model. Format:
   `projects/{project}/locations/{location}/models/{model}`. */
  tunedTeacherModelSource?: string;
  /** Cloud Storage path to file containing validation dataset for distillation.
   The dataset must be formatted as a JSONL file. */
  validationDatasetUri?: string;
  /** Cloud Storage path to file containing prompt dataset for distillation.
   The dataset must be formatted as a JSONL file. */
  promptDatasetUri?: string;
  /** Hyperparameters for distillation tuning. */
  hyperparameters?: DistillationHyperParameters;
}
/** Distillation tuning spec for tuning. */
declare interface DistillationSpec {
  /** Optional. Cloud Storage path to file containing prompt dataset for distillation. The dataset must be formatted as a JSONL file. */
  promptDatasetUri?: string;
  /** The base teacher model that is being distilled. See [Supported models](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/tuning#supported_models). */
  baseTeacherModel?: string;
  /** Optional. Hyperparameters for Distillation. */
  hyperParameters?: DistillationHyperParameters;
  /** Deprecated. A path in a Cloud Storage bucket, which will be treated as the root output directory of the distillation pipeline. It is used by the system to generate the paths of output artifacts. */
  pipelineRootDirectory?: string;
  /** The student model that is being tuned, e.g., "google/gemma-2b-1.1-it". Deprecated. Use base_model instead. */
  studentModel?: string;
  /** Deprecated. Cloud Storage path to file containing training dataset for tuning. The dataset must be formatted as a JSONL file. */
  trainingDatasetUri?: string;
  /** The resource name of the Tuned teacher model. Format: `projects/{project}/locations/{location}/models/{model}`. */
  tunedTeacherModelSource?: string;
  /** Optional. Cloud Storage path to file containing validation dataset for tuning. The dataset must be formatted as a JSONL file. */
  validationDatasetUri?: string;
  /** Optional. Specifies the tuning mode for distillation (sft part). This feature is only available for open source models. */
  tuningMode?: TuningMode;
}
/** A Document is a collection of Chunks. */
declare interface Document_2 {
  /** Immutable. Identifier. The `Document` resource name. The ID (name excluding the "fileSearchStores/&#42;/documents/" prefix) can contain up to 40 characters that are lowercase alphanumeric or dashes (-). The ID cannot start or end with a dash. If the name is empty on create, a unique name will be derived from `display_name` along with a 12 character random suffix. Example: `fileSearchStores/{file_search_store_id}/documents/my-awesome-doc-123a456b789c` */
  name?: string;
  /** Optional. The human-readable display name for the `Document`. The display name must be no more than 512 characters in length, including spaces. Example: "Semantic Retriever Documentation". */
  displayName?: string;
  /** Output only. Current state of the `Document`. */
  state?: DocumentState;
  /** Output only. The size of raw bytes ingested into the Document. */
  sizeBytes?: string;
  /** Output only. The mime type of the Document. */
  mimeType?: string;
  /** Output only. The Timestamp of when the `Document` was created. */
  createTime?: string;
  /** Optional. User provided custom metadata stored as key-value pairs used for querying. A `Document` can have a maximum of 20 `CustomMetadata`. */
  customMetadata?: CustomMetadata[];
  /** Output only. The Timestamp of when the `Document` was last updated. */
  updateTime?: string;
}
/**
 * A document content block.
 */
declare interface DocumentContent {
  type: 'document';
  /**
   * The document content.
   */
  data?: string;
  /**
   * The mime type of the document.
   */
  mime_type?: 'application/pdf' | 'text/csv';
  /**
   * The URI of the document.
   */
  uri?: string;
}
declare class Documents extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Lists documents.
   *
   * @param params - The parameters for the list request.
   * @return - A pager of documents.
   *
   * @example
   * ```ts
   * const documents = await ai.documents.list({parent:'rag_store_name', config: {'pageSize': 2}});
   * for await (const document of documents) {
   *   console.log(document);
   * }
   * ```
   */
  list: (params: types.ListDocumentsParameters) => Promise<Pager<types.Document>>;
  /**
   * Gets a Document.
   *
   * @param params - The parameters for getting a document.
   * @return Document.
   */
  get(params: types.GetDocumentParameters): Promise<types.Document>;
  /**
   * Deletes a Document.
   *
   * @param params - The parameters for deleting a document.
   */
  delete(params: types.DeleteDocumentParameters): Promise<void>;
  private listInternal;
}
/** Output only. Current state of the `Document`. This enum is not supported in Vertex AI. */
declare enum DocumentState {
  /**
   * The default value. This value is used if the state is omitted.
   */
  STATE_UNSPECIFIED = "STATE_UNSPECIFIED",
  /**
   * Some `Chunks` of the `Document` are being processed (embedding and vector storage).
   */
  STATE_PENDING = "STATE_PENDING",
  /**
   * All `Chunks` of the `Document` is processed and available for querying.
   */
  STATE_ACTIVE = "STATE_ACTIVE",
  /**
   * Some `Chunks` of the `Document` failed processing.
   */
  STATE_FAILED = "STATE_FAILED"
}
/** @ts-ignore */
declare type _DOMReadableStream<R = any> = globalThis.ReadableStream<R>;
declare type DownloadableFileUnion = string | File_2 | GeneratedVideo | Video;
declare interface Downloader {
  /**
   * Downloads a file to the given location.
   *
   * @param params The parameters for downloading the file.
   * @param apiClient The ApiClient to use for uploading.
   * @return A Promises that resolves when the download is complete.
   */
  download(params: DownloadFileParameters, apiClient: ApiClient): Promise<void>;
}
/** Used to override the default configuration. */
declare interface DownloadFileConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters used to download a file. */
declare interface DownloadFileParameters {
  /** The file to download. It can be a file name, a file object or a generated video. */
  file: DownloadableFileUnion;
  /** Location where the file should be downloaded to. */
  downloadPath: string;
  /** Configuration to for the download operation. */
  config?: DownloadFileConfig;
}
/** Used to override the default configuration. */
declare interface DownloadMediaConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/**
 * Configuration for dynamic agents.
 */
declare interface DynamicAgentConfig {
  type: 'dynamic';
  [k: string]: unknown;
}
/** Describes the options to customize dynamic retrieval. */
declare interface DynamicRetrievalConfig {
  /** Optional. The threshold to be used in dynamic retrieval. If not set, a system default value is used. */
  dynamicThreshold?: number;
  /** The mode of the predictor to be used in dynamic retrieval. */
  mode?: DynamicRetrievalConfigMode;
}
/** The mode of the predictor to be used in dynamic retrieval. */
declare enum DynamicRetrievalConfigMode {
  /**
   * Always trigger retrieval.
   */
  MODE_UNSPECIFIED = "MODE_UNSPECIFIED",
  /**
   * Run retrieval only when system decides it is necessary.
   */
  MODE_DYNAMIC = "MODE_DYNAMIC"
}
/** Configuration for editing an image. */
declare interface EditImageConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Cloud Storage URI used to store the generated images. */
  outputGcsUri?: string;
  /** Description of what to discourage in the generated images. */
  negativePrompt?: string;
  /** Number of images to generate. */
  numberOfImages?: number;
  /** Aspect ratio of the generated images. Supported values are
   "1:1", "3:4", "4:3", "9:16", and "16:9". */
  aspectRatio?: string;
  /** Controls how much the model adheres to the text prompt. Large
   values increase output and prompt alignment, but may compromise image
   quality. */
  guidanceScale?: number;
  /** Random seed for image generation. This is not available when
   ``add_watermark`` is set to true. */
  seed?: number;
  /** Filter level for safety filtering. */
  safetyFilterLevel?: SafetyFilterLevel;
  /** Allows generation of people by the model. */
  personGeneration?: PersonGeneration;
  /** Whether to report the safety scores of each generated image and
   the positive prompt in the response. */
  includeSafetyAttributes?: boolean;
  /** Whether to include the Responsible AI filter reason if the image
   is filtered out of the response. */
  includeRaiReason?: boolean;
  /** Language of the text in the prompt. */
  language?: ImagePromptLanguage;
  /** MIME type of the generated image. */
  outputMimeType?: string;
  /** Compression quality of the generated image (for ``image/jpeg``
   only). */
  outputCompressionQuality?: number;
  /** Whether to add a watermark to the generated images. */
  addWatermark?: boolean;
  /** User specified labels to track billing usage. */
  labels?: Record<string, string>;
  /** Describes the editing mode for the request. */
  editMode?: EditMode;
  /** The number of sampling steps. A higher value has better image
   quality, while a lower value has better latency. */
  baseSteps?: number;
}
/** Parameters for the request to edit an image. */
declare interface EditImageParameters {
  /** The model to use. */
  model: string;
  /** A text description of the edit to apply to the image. */
  prompt: string;
  /** The reference images for Imagen 3 editing. */
  referenceImages: ReferenceImage[];
  /** Configuration for editing. */
  config?: EditImageConfig;
}
/** Response for the request to edit an image. */
declare class EditImageResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** Generated images. */
  generatedImages?: GeneratedImage[];
}
/** Enum representing the editing mode. */
declare enum EditMode {
  EDIT_MODE_DEFAULT = "EDIT_MODE_DEFAULT",
  EDIT_MODE_INPAINT_REMOVAL = "EDIT_MODE_INPAINT_REMOVAL",
  EDIT_MODE_INPAINT_INSERTION = "EDIT_MODE_INPAINT_INSERTION",
  EDIT_MODE_OUTPAINT = "EDIT_MODE_OUTPAINT",
  EDIT_MODE_CONTROLLED_EDITING = "EDIT_MODE_CONTROLLED_EDITING",
  EDIT_MODE_STYLE = "EDIT_MODE_STYLE",
  EDIT_MODE_BGSWAP = "EDIT_MODE_BGSWAP",
  EDIT_MODE_PRODUCT_IMAGE = "EDIT_MODE_PRODUCT_IMAGE"
}
/** Parameters for the embed_content method. */
declare interface EmbedContentBatch {
  /** The content to embed. Only the `parts.text` fields will be counted.
   */
  contents?: ContentListUnion;
  /** Configuration that contains optional parameters.
   */
  config?: EmbedContentConfig;
}
/** Optional parameters for the embed_content method. */
declare interface EmbedContentConfig {
  /** Type of task for which the embedding will be used.
   */
  taskType?: string;
  /** Title for the text. Only applicable when TaskType is
   `RETRIEVAL_DOCUMENT`.
   */
  title?: string;
  /** Reduced dimension for the output embedding. If set,
   excessive values in the output embedding are truncated from the end.
   Supported by newer models since 2024 only. You cannot set this value if
   using the earlier model (`models/embedding-001`).
   */
  outputDimensionality?: number;
  /** Gemini Enterprise Agent Platform only. The MIME type of the input.
   */
  mimeType?: string;
  /** Gemini Enterprise Agent Platform only. Whether to silently truncate inputs longer than
   the max sequence length. If this option is set to false, oversized inputs
   will lead to an INVALID_ARGUMENT error, similar to other text APIs.
   */
  autoTruncate?: boolean;
  /** Gemini Enterprise Agent Platform only. Whether to enable OCR for document content.
   Only applicable to Gemini Embedding 2 models.
   */
  documentOcr?: boolean;
  /** Gemini Enterprise Agent Platform only. Whether to extract audio from video content.
   Only applicable to Gemini Embedding 2 models.
   */
  audioTrackExtraction?: boolean;
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Request-level metadata for the Gemini Enterprise Agent Platform Embed Content API. */
declare interface EmbedContentMetadata {
  /** Gemini Enterprise Agent Platform only. The total number of billable characters included
   in the request.
   */
  billableCharacterCount?: number;
}
/** Parameters for the embed_content method. */
declare interface EmbedContentParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** The content to embed. Only the `parts.text` fields will be counted.
   */
  contents: ContentListUnion;
  /** Configuration that contains optional parameters.
   */
  config?: EmbedContentConfig;
}
/** Parameters for the _embed_content method. */
declare interface EmbedContentParametersPrivate {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** The content to embed. Only the `parts.text` fields will be counted.
   */
  contents?: ContentListUnion;
  /** The single content to embed. Only the `parts.text` fields will be counted.
   */
  content?: ContentUnion;
  /** The Gemini Enterprise Agent Platform embedding API to use.
   */
  embeddingApiType?: EmbeddingApiType;
  /** Configuration that contains optional parameters.
   */
  config?: EmbedContentConfig;
}
/** Response for the embed_content method. */
declare class EmbedContentResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** The embeddings for each request, in the same order as provided in
   the batch request.
   */
  embeddings?: ContentEmbedding[];
  /** Gemini Enterprise Agent Platform only. Metadata about the request.
   */
  metadata?: EmbedContentMetadata;
}
/** Enum representing the Gemini Enterprise Agent Platform embedding API to use. */
declare enum EmbeddingApiType {
  /**
   * predict API endpoint (default)
   */
  PREDICT = "PREDICT",
  /**
   * embedContent API Endpoint
   */
  EMBED_CONTENT = "EMBED_CONTENT"
}
declare interface EmbeddingsBatchJobSource {
  /** The Gemini Developer API's file resource name of the input data
   (e.g. "files/12345").
   */
  fileName?: string;
  /** The Gemini Developer API's inlined input data to run batch job.
   */
  inlinedRequests?: EmbedContentBatch;
}
/** Represents a customer-managed encryption key specification that can be applied to a Vertex AI resource. This data type is not supported in Gemini API. */
declare interface EncryptionSpec {
  /** Required. Resource name of the Cloud KMS key used to protect the resource. The Cloud KMS key must be in the same region as the resource. It must have the format `projects/{project}/locations/{location}/keyRings/{key_ring}/cryptoKeys/{crypto_key}`. */
  kmsKeyName?: string;
}
/** An endpoint where you deploy models. */
declare interface Endpoint {
  /** Resource name of the endpoint. */
  name?: string;
  /** ID of the model that's deployed to the endpoint. */
  deployedModelId?: string;
}
/** End of speech sensitivity. */
declare enum EndSensitivity {
  /**
   * The default is END_SENSITIVITY_LOW.
   */
  END_SENSITIVITY_UNSPECIFIED = "END_SENSITIVITY_UNSPECIFIED",
  /**
   * Automatic detection ends speech more often.
   */
  END_SENSITIVITY_HIGH = "END_SENSITIVITY_HIGH",
  /**
   * Automatic detection ends speech less often.
   */
  END_SENSITIVITY_LOW = "END_SENSITIVITY_LOW"
}
/** Tool to search public web data, powered by Vertex AI Search and Sec4 compliance. This data type is not supported in Gemini API. */
declare interface EnterpriseWebSearch {
  /** Optional. Sites with confidence level chosen & above this value will be blocked from the search results. */
  blockingConfidence?: PhishBlockThreshold;
  /** Optional. List of domains to be excluded from the search results. The default limit is 2000 domains. */
  excludeDomains?: string[];
}
/** An entity representing the segmented area. */
declare interface EntityLabel {
  /** The label of the segmented entity. */
  label?: string;
  /** The confidence score of the detected label. */
  score?: number;
}
/** The environment being operated. */
declare enum Environment {
  /**
   * Defaults to browser.
   */
  ENVIRONMENT_UNSPECIFIED = "ENVIRONMENT_UNSPECIFIED",
  /**
   * Operates in a web browser.
   */
  ENVIRONMENT_BROWSER = "ENVIRONMENT_BROWSER",
  /**
   * Operates in a mobile environment.
   */
  ENVIRONMENT_MOBILE = "ENVIRONMENT_MOBILE",
  /**
   * Operates in a desktop environment.
   */
  ENVIRONMENT_DESKTOP = "ENVIRONMENT_DESKTOP"
}
/**
 * Configuration for a custom environment.
 */
declare interface Environment_2 {
  type: 'remote';
  /**
   * Network configuration for the environment.
   */
  network?: 'disabled' | Environment_2.Allowlist;
  sources?: Array<Environment_2.Source>;
}
declare namespace Environment_2 {
  /**
   * Outbound networking configuration for the sandbox. When specified, restricts
   * which external domains the sandbox can reach. Omit entirely to allow all
   * outbound traffic with no header injection.
   */
  interface Allowlist {
    /**
     * List of allowed outbound domains. Only requests to listed domains are permitted.
     * Use [{'domain': '*'}] to allow all domains while still injecting headers on
     * specific ones.
     */
    allowlist?: Array<Allowlist.Allowlist>;
  }
  namespace Allowlist {
    /**
     * A single domain allowlist rule with optional header injection.
     */
    interface Allowlist {
      /**
       * Domain to allow outbound requests to. Supports wildcards (e.g.
       * '_.googleapis.com'). Use '_' to allow all domains.
       */
      domain: string;
      /**
       * Headers to inject on all outbound requests matching this domain. Each entry is a
       * flat {header_name: header_value} object. The egress proxy injects these
       * automatically.
       */
      transform?: Array<{
        [key: string]: string;
      }>;
    }
  }
  /**
   * A source to be mounted into the environment.
   */
  interface Source {
    /**
     * The inline content if `type` is `INLINE`.
     */
    content?: string;
    /**
     * Optional encoding for inline content (e.g. `base64`).
     */
    encoding?: string;
    /**
     * The source of the environment. For GCS, this is the GCS path. For GitHub, this
     * is the GitHub path.
     */
    source?: string;
    /**
     * Where the source should appear in the environment.
     */
    target?: string;
    type?: 'gcs' | 'inline' | 'repository' | 'skill_registry';
  }
}
declare interface ErrorEvent_2 {
  event_type: 'error';
  /**
   * Error message from an interaction.
   */
  error?: ErrorEvent_2.Error;
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: ErrorEvent_2.Metadata;
}
declare namespace ErrorEvent_2 {
  /**
   * Error message from an interaction.
   */
  interface Error {
    /**
     * A URI that identifies the error type.
     */
    code?: string;
    /**
     * A human-readable error message.
     */
    message?: string;
  }
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
declare namespace Errors {
  export { GeminiNextGenAPIClientError, APIError, APIUserAbortError, APIConnectionError, APIConnectionTimeoutError, BadRequestError, AuthenticationError, PermissionDeniedError, NotFoundError, ConflictError, UnprocessableEntityError, RateLimitError, InternalServerError };
}
/** The results from an evaluation run performed by the EvaluationService. This data type is not supported in Gemini API. */
declare class EvaluateDatasetResponse {
  /** Output only. Aggregation statistics derived from results of EvaluationService. */
  aggregationOutput?: AggregationOutput;
  /** Output only. Output info for EvaluationService. */
  outputInfo?: OutputInfo;
}
/** Evaluate Dataset Run Result for Tuning Job. This data type is not supported in Gemini API. */
declare interface EvaluateDatasetRun {
  /** Output only. The checkpoint id used in the evaluation run. Only populated when evaluating checkpoints. */
  checkpointId?: string;
  /** Output only. The error of the evaluation run if any. */
  error?: GoogleRpcStatus;
  /** Output only. Results for EvaluationService. */
  evaluateDatasetResponse?: EvaluateDatasetResponse;
  /** Output only. The resource name of the evaluation run. Format: `projects/{project}/locations/{location}/evaluationRuns/{evaluation_run_id}`. */
  evaluationRun?: string;
  /** Output only. Deprecated: The updated architecture uses evaluation_run instead. */
  operationName?: string;
}
/** The dataset used for evaluation. This data type is not supported in Gemini API. */
declare interface EvaluationDataset {
  /** BigQuery source holds the dataset. */
  bigquerySource?: BigQuerySource;
  /** Cloud storage source holds the dataset. Currently only one Cloud Storage file path is supported. */
  gcsSource?: GcsSource;
}
/** Exact match metric value for an instance. This data type is not supported in Gemini API. */
declare interface ExactMatchMetricValue {
  /** Output only. Exact match score. */
  score?: number;
}
/** Code generated by the model that is meant to be executed, and the result returned to the model. Generated when using the `CodeExecution` tool, in which the code will be automatically executed, and a corresponding CodeExecutionResult will also be generated. */
declare interface ExecutableCode {
  /** Required. The code to be executed. */
  code?: string;
  /** Required. Programming language of the `code`. */
  language?: Language;
  /** Optional. Unique identifier of the `ExecutableCode` part. The server returns the `CodeExecutionResult` with the matching `id`. This field is not supported in Vertex AI. */
  id?: string;
}
/** Retrieve from data source powered by external API for grounding. The external API is not owned by Google, but need to follow the pre-defined API spec. This data type is not supported in Gemini API. */
declare interface ExternalApi {
  /** The authentication config to access the API. Deprecated. Please use auth_config instead. */
  apiAuth?: ApiAuth;
  /** The API spec that the external API implements. */
  apiSpec?: ApiSpec;
  /** The authentication config to access the API. */
  authConfig?: AuthConfig;
  /** Parameters for the elastic search API. */
  elasticSearchParams?: ExternalApiElasticSearchParams;
  /** The endpoint of the external API. The system will call the API at this endpoint to retrieve the data for grounding. Example: https://acme.com:443/search */
  endpoint?: string;
  /** Parameters for the simple search API. */
  simpleSearchParams?: ExternalApiSimpleSearchParams;
}
/** The search parameters to use for the ELASTIC_SEARCH spec. This data type is not supported in Gemini API. */
declare interface ExternalApiElasticSearchParams {
  /** The ElasticSearch index to use. */
  index?: string;
  /** Optional. Number of hits (chunks) to request. When specified, it is passed to Elasticsearch as the `num_hits` param. */
  numHits?: number;
  /** The ElasticSearch search template to use. */
  searchTemplate?: string;
}
/** The search parameters to use for SIMPLE_SEARCH spec. This data type is not supported in Gemini API. */
declare interface ExternalApiSimpleSearchParams {}
/** Options for feature selection preference. */
declare enum FeatureSelectionPreference {
  FEATURE_SELECTION_PREFERENCE_UNSPECIFIED = "FEATURE_SELECTION_PREFERENCE_UNSPECIFIED",
  PRIORITIZE_QUALITY = "PRIORITIZE_QUALITY",
  BALANCED = "BALANCED",
  PRIORITIZE_COST = "PRIORITIZE_COST"
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
declare interface FetchPredictOperationConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for the fetchPredictOperation method. */
declare interface FetchPredictOperationParameters {
  /** The server-assigned name for the operation. */
  operationName: string;
  resourceName: string;
  /** Used to override the default configuration. */
  config?: FetchPredictOperationConfig;
}
/** @ts-ignore For users who use Deno */
declare type FetchRequestInit = NonNullable<OverloadedParameters<typeof fetch>[1]>;
/** A file uploaded to the API. */
declare interface File_2 {
  /** The `File` resource name. The ID (name excluding the "files/" prefix) can contain up to 40 characters that are lowercase alphanumeric or dashes (-). The ID cannot start or end with a dash. If the name is empty on create, a unique name will be generated. Example: `files/123-456` */
  name?: string;
  /** Optional. The human-readable display name for the `File`. The display name must be no more than 512 characters in length, including spaces. Example: 'Welcome Image' */
  displayName?: string;
  /** Output only. MIME type of the file. */
  mimeType?: string;
  /** Output only. Size of the file in bytes. */
  sizeBytes?: string;
  /** Output only. The timestamp of when the `File` was created. */
  createTime?: string;
  /** Output only. The timestamp of when the `File` will be deleted. Only set if the `File` is scheduled to expire. */
  expirationTime?: string;
  /** Output only. The timestamp of when the `File` was last updated. */
  updateTime?: string;
  /** Output only. SHA-256 hash of the uploaded bytes. The hash value is encoded in base64 format. */
  sha256Hash?: string;
  /** Output only. The URI of the `File`. */
  uri?: string;
  /** Output only. The URI of the `File`, only set for downloadable (generated) files. */
  downloadUri?: string;
  /** Output only. Processing state of the File. */
  state?: FileState;
  /** Output only. The source of the `File`. */
  source?: FileSource;
  /** Output only. Metadata for a video. */
  videoMetadata?: Record<string, unknown>;
  /** Output only. Error status if File processing failed. */
  error?: FileStatus;
}
/**
 * A file citation annotation.
 */
declare interface FileCitation {
  type: 'file_citation';
  /**
   * User provided metadata about the retrieved context.
   */
  custom_metadata?: {
    [key: string]: unknown;
  };
  /**
   * The URI of the file.
   */
  document_uri?: string;
  /**
   * End of the attributed segment, exclusive.
   */
  end_index?: number;
  /**
   * The name of the file.
   */
  file_name?: string;
  /**
   * Media ID in-case of image citations, if applicable.
   */
  media_id?: string;
  /**
   * Page number of the cited document, if applicable.
   */
  page_number?: number;
  /**
   * Source attributed for a portion of the text.
   */
  source?: string;
  /**
   * Start of segment of the response that is attributed to this source.
   *
   * Index indicates the start of the segment, measured in bytes.
   */
  start_index?: number;
}
/** URI-based data. A FileData message contains a URI pointing to data of a specific media type. It is used to represent images, audio, and video stored in Google Cloud Storage. */
declare interface FileData {
  /** Optional. The display name of the file. Used to provide a label or filename to distinguish files. This field is only returned in `PromptMessage` for prompt management. It is used in the Gemini calls only when server side tools (`code_execution`, `google_search`, and `url_context`) are enabled. This field is not supported in Gemini API. */
  displayName?: string;
  /** Required. The URI of the file in Google Cloud Storage. */
  fileUri?: string;
  /** Required. The IANA standard MIME type of the source data. */
  mimeType?: string;
}
declare class Files extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Lists files.
   *
   * @param params - The parameters for the list request.
   * @return - A pager of files.
   *
   * @example
   * ```ts
   * const files = await ai.files.list({config: {'pageSize': 2}});
   * for await (const file of files) {
   *   console.log(file);
   * }
   * ```
   */
  list: (params?: types.ListFilesParameters) => Promise<Pager<types.File>>;
  /**
   * Uploads a file asynchronously to the Gemini API.
   * This method is not available in Gemini Enterprise Agent Platform (previously known as Vertex AI).
   * Supported upload sources:
   * - Node.js: File path (string) or Blob object.
   * - Browser: Blob object (e.g., File).
   *
   * @remarks
   * The `mimeType` can be specified in the `config` parameter. If omitted:
   *  - For file path (string) inputs, the `mimeType` will be inferred from the
   *     file extension.
   *  - For Blob object inputs, the `mimeType` will be set to the Blob's `type`
   *     property.
   * Somex eamples for file extension to mimeType mapping:
   * .txt -> text/plain
   * .json -> application/json
   * .jpg  -> image/jpeg
   * .png -> image/png
   * .mp3 -> audio/mpeg
   * .mp4 -> video/mp4
   *
   * This section can contain multiple paragraphs and code examples.
   *
   * @param params - Optional parameters specified in the
   *        `types.UploadFileParameters` interface.
   *         @see {@link types.UploadFileParameters#config} for the optional
   *         config in the parameters.
   * @return A promise that resolves to a `types.File` object.
   * @throws An error if called on a Gemini Enterprise Agent Platform (previously known as Vertex AI) client.
   * @throws An error if the `mimeType` is not provided and can not be inferred,
   * the `mimeType` can be provided in the `params.config` parameter.
   * @throws An error occurs if a suitable upload location cannot be established.
   *
   * @example
   * The following code uploads a file to Gemini API.
   *
   * ```ts
   * const file = await ai.files.upload({file: 'file.txt', config: {
   *   mimeType: 'text/plain',
   * }});
   * console.log(file.name);
   * ```
   */
  upload(params: types.UploadFileParameters): Promise<types.File>;
  /**
   * Downloads a remotely stored file asynchronously to a location specified in
   * the `params` object. This method only works on Node environment, to
   * download files in the browser, use a browser compliant method like an <a>
   * tag.
   *
   * @param params - The parameters for the download request.
   *
   * @example
   * The following code downloads an example file named "files/mehozpxf877d" as
   * "file.txt".
   *
   * ```ts
   * await ai.files.download({file: file.name, downloadPath: 'file.txt'});
   * ```
   */
  download(params: types.DownloadFileParameters): Promise<void>;
  /**
   * Registers Google Cloud Storage files for use with the API.
   * This method is only available in Node.js environments.
   */
  registerFiles(params: types.RegisterFilesParameters): Promise<types.RegisterFilesResponse>;
  protected _registerFiles(params: types.InternalRegisterFilesParameters): Promise<types.RegisterFilesResponse>;
  private listInternal;
  private createInternal;
  /**
   * Retrieves the file information from the service.
   *
   * @param params - The parameters for the get request
   * @return The Promise that resolves to the types.File object requested.
   *
   * @example
   * ```ts
   * const config: GetFileParameters = {
   *   name: fileName,
   * };
   * file = await ai.files.get(config);
   * console.log(file.name);
   * ```
   */
  get(params: types.GetFileParameters): Promise<types.File>;
  /**
   * Deletes a remotely stored file.
   *
   * @param params - The parameters for the delete request.
   * @return The DeleteFileResponse, the response for the delete method.
   *
   * @example
   * The following code deletes an example file named "files/mehozpxf877d".
   *
   * ```ts
   * await ai.files.delete({name: file.name});
   * ```
   */
  delete(params: types.DeleteFileParameters): Promise<types.DeleteFileResponse>;
  private registerFilesInternal;
}
/** The FileSearch tool that retrieves knowledge from Semantic Retrieval corpora. Files are imported to Semantic Retrieval corpora using the ImportFile API. This data type is not supported in Vertex AI. */
declare interface FileSearch {
  /** Required. The names of the file_search_stores to retrieve from. Example: `fileSearchStores/my-file-search-store-123` */
  fileSearchStoreNames?: string[];
  /** Optional. The number of semantic retrieval chunks to retrieve. */
  topK?: number;
  /** Optional. Metadata filter to apply to the semantic retrieval documents and chunks. */
  metadataFilter?: string;
}
/**
 * File Search call step.
 */
declare interface FileSearchCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  type: 'file_search_call';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/**
 * File Search result step.
 */
declare interface FileSearchResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  type: 'file_search_result';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/** A collection of Documents. */
declare interface FileSearchStore {
  /** Output only. Immutable. Identifier. The `FileSearchStore` resource name. It is an ID (name excluding the "fileSearchStores/" prefix) that can contain up to 40 characters that are lowercase alphanumeric or dashes (-). It is output only. The unique name will be derived from `display_name` along with a 12 character random suffix. Example: `fileSearchStores/my-awesome-file-search-store-123a456b789c` If `display_name` is not provided, the name will be randomly generated. */
  name?: string;
  /** Optional. The human-readable display name for the `FileSearchStore`. The display name must be no more than 512 characters in length, including spaces. Example: "Docs on Semantic Retriever". */
  displayName?: string;
  /** Output only. The Timestamp of when the `FileSearchStore` was created. */
  createTime?: string;
  /** Output only. The Timestamp of when the `FileSearchStore` was last updated. */
  updateTime?: string;
  /** Output only. The number of documents in the `FileSearchStore` that are active and ready for retrieval. */
  activeDocumentsCount?: string;
  /** Output only. The number of documents in the `FileSearchStore` that are being processed. */
  pendingDocumentsCount?: string;
  /** Output only. The number of documents in the `FileSearchStore` that have failed processing. */
  failedDocumentsCount?: string;
  /** Output only. The size of raw bytes ingested into the `FileSearchStore`. This is the total size of all the documents in the `FileSearchStore`. */
  sizeBytes?: string;
  /** The embedding model used by the FileSearchStore. */
  embeddingModel?: string;
}
declare class FileSearchStores extends BaseModule {
  private readonly apiClient;
  readonly documents: Documents;
  constructor(apiClient: ApiClient, documents?: Documents);
  /**
   * Lists file search stores.
   *
   * @param params - The parameters for the list request.
   * @return - A pager of file search stores.
   *
   * @example
   * ```ts
   * const fileSearchStores = await ai.fileSearchStores.list({config: {'pageSize': 2}});
   * for await (const fileSearchStore of fileSearchStores) {
   *   console.log(fileSearchStore);
   * }
   * ```
   */
  list: (params?: types.ListFileSearchStoresParameters) => Promise<Pager<types.FileSearchStore>>;
  /**
   * Uploads a file asynchronously to a given File Search Store.
   * This method is not available in Gemini Enterprise Agent Platform (previously known as Vertex AI).
   * Supported upload sources:
   * - Node.js: File path (string) or Blob object.
   * - Browser: Blob object (e.g., File).
   *
   * @remarks
   * The `mimeType` can be specified in the `config` parameter. If omitted:
   *  - For file path (string) inputs, the `mimeType` will be inferred from the
   *     file extension.
   *  - For Blob object inputs, the `mimeType` will be set to the Blob's `type`
   *     property.
   *
   * This section can contain multiple paragraphs and code examples.
   *
   * @param params - Optional parameters specified in the
   *        `types.UploadToFileSearchStoreParameters` interface.
   *         @see {@link types.UploadToFileSearchStoreParameters#config} for the optional
   *         config in the parameters.
   * @return A promise that resolves to a long running operation.
   * @throws An error if called on a Gemini Enterprise Agent Platform (previously known as Vertex AI) client.
   * @throws An error if the `mimeType` is not provided and can not be inferred,
   * the `mimeType` can be provided in the `params.config` parameter.
   * @throws An error occurs if a suitable upload location cannot be established.
   *
   * @example
   * The following code uploads a file to a given file search store.
   *
   * ```ts
   * const operation = await ai.fileSearchStores.upload({fileSearchStoreName: 'fileSearchStores/foo-bar', file: 'file.txt', config: {
   *   mimeType: 'text/plain',
   * }});
   * console.log(operation.name);
   * ```
   */
  uploadToFileSearchStore(params: types.UploadToFileSearchStoreParameters): Promise<types.UploadToFileSearchStoreOperation>;
  /**
   * Downloads media using a Media ID or URI.
   * This method is only supported in the Gemini Developer client.
   *
   * @param uri - The URI or Media ID of the blob.
   * @param config - Optional configuration for the download.
   * @returns A promise that resolves to the blob data as a Uint8Array.
   */
  downloadMedia(uri: string, config?: types.DownloadMediaConfig): Promise<Uint8Array>;
  /**
   * Creates a File Search Store.
   *
   * @param params - The parameters for creating a File Search Store.
   * @return FileSearchStore.
   */
  create(params: types.CreateFileSearchStoreParameters): Promise<types.FileSearchStore>;
  /**
   * Gets a File Search Store.
   *
   * @param params - The parameters for getting a File Search Store.
   * @return FileSearchStore.
   */
  get(params: types.GetFileSearchStoreParameters): Promise<types.FileSearchStore>;
  /**
   * Deletes a File Search Store.
   *
   * @param params - The parameters for deleting a File Search Store.
   */
  delete(params: types.DeleteFileSearchStoreParameters): Promise<void>;
  private listInternal;
  private uploadToFileSearchStoreInternal;
  /**
   * Imports a File from File Service to a FileSearchStore.
   *
   * This is a long-running operation, see aip.dev/151
   *
   * @param params - The parameters for importing a file to a file search store.
   * @return ImportFileOperation.
   */
  importFile(params: types.ImportFileParameters): Promise<types.ImportFileOperation>;
}
/** Source of the File. */
declare enum FileSource {
  SOURCE_UNSPECIFIED = "SOURCE_UNSPECIFIED",
  UPLOADED = "UPLOADED",
  GENERATED = "GENERATED",
  REGISTERED = "REGISTERED"
}
/**
 * Represents the size and mimeType of a file. The information is used to
 * request the upload URL from the https://generativelanguage.googleapis.com/upload/v1beta/files endpoint.
 * This interface defines the structure for constructing and executing HTTP
 * requests.
 */
declare interface FileStat {
  /**
   * The size of the file in bytes.
   */
  size: number;
  /**
   * The MIME type of the file.
   */
  type: string | undefined;
}
/** State for the lifecycle of a File. */
declare enum FileState {
  STATE_UNSPECIFIED = "STATE_UNSPECIFIED",
  PROCESSING = "PROCESSING",
  ACTIVE = "ACTIVE",
  FAILED = "FAILED"
}
/** Status of a File that uses a common error model. */
declare interface FileStatus {
  /** A list of messages that carry the error details. There is a common set of message types for APIs to use. */
  details?: Record<string, unknown>[];
  /** A list of messages that carry the error details. There is a common set of message types for APIs to use. */
  message?: string;
  /** The status code. 0 for OK, 1 for CANCELLED */
  code?: number;
}
declare type FinalizedRequestInit = RequestInit & {
  headers: Headers;
};
declare type FinalRequestOptions = RequestOptions$2 & {
  method: HTTPMethod;
  path: string;
};
/** Output only. The reason why the model stopped generating tokens.

 If empty, the model has not stopped generating the tokens. */
declare enum FinishReason {
  /**
   * The finish reason is unspecified.
   */
  FINISH_REASON_UNSPECIFIED = "FINISH_REASON_UNSPECIFIED",
  /**
   * Token generation reached a natural stopping point or a configured stop sequence.
   */
  STOP = "STOP",
  /**
   * Token generation reached the configured maximum output tokens.
   */
  MAX_TOKENS = "MAX_TOKENS",
  /**
   * Token generation stopped because the content potentially contains safety violations. NOTE: When streaming, [content][] is empty if content filters blocks the output.
   */
  SAFETY = "SAFETY",
  /**
   * The token generation stopped because of potential recitation.
   */
  RECITATION = "RECITATION",
  /**
   * The token generation stopped because of using an unsupported language.
   */
  LANGUAGE = "LANGUAGE",
  /**
   * All other reasons that stopped the token generation.
   */
  OTHER = "OTHER",
  /**
   * Token generation stopped because the content contains forbidden terms.
   */
  BLOCKLIST = "BLOCKLIST",
  /**
   * Token generation stopped for potentially containing prohibited content.
   */
  PROHIBITED_CONTENT = "PROHIBITED_CONTENT",
  /**
   * Token generation stopped because the content potentially contains Sensitive Personally Identifiable Information (SPII).
   */
  SPII = "SPII",
  /**
   * The function call generated by the model is invalid.
   */
  MALFORMED_FUNCTION_CALL = "MALFORMED_FUNCTION_CALL",
  /**
   * Token generation stopped because generated images have safety violations.
   */
  IMAGE_SAFETY = "IMAGE_SAFETY",
  /**
   * The tool call generated by the model is invalid.
   */
  UNEXPECTED_TOOL_CALL = "UNEXPECTED_TOOL_CALL",
  /**
   * Image generation stopped because the generated images have prohibited content.
   */
  IMAGE_PROHIBITED_CONTENT = "IMAGE_PROHIBITED_CONTENT",
  /**
   * The model was expected to generate an image, but none was generated.
   */
  NO_IMAGE = "NO_IMAGE",
  /**
   * Image generation stopped because the generated image may be a recitation from a source.
   */
  IMAGE_RECITATION = "IMAGE_RECITATION",
  /**
   * Image generation stopped for a reason not otherwise specified.
   */
  IMAGE_OTHER = "IMAGE_OTHER"
}
/** Tuning Spec for Full Fine Tuning. This data type is not supported in Gemini API. */
declare interface FullFineTuningSpec {
  /** Optional. Hyperparameters for Full Fine Tuning. */
  hyperParameters?: SupervisedHyperParameters;
  /** Required. Training dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  trainingDatasetUri?: string;
  /** Optional. Validation dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  validationDatasetUri?: string;
}
/**
 * A tool that can be used by the model.
 */
declare interface Function_2 {
  type: 'function';
  /**
   * A description of the function.
   */
  description?: string;
  /**
   * The name of the function.
   */
  name?: string;
  /**
   * The JSON Schema for the function's parameters.
   */
  parameters?: unknown;
}
/** A predicted FunctionCall returned from the model that contains a string representing the FunctionDeclaration.name and a structured JSON object containing the parameters and their values. */
declare interface FunctionCall {
  /** Optional. The unique id of the function call. If populated, the client to execute the `function_call` and return the response with the matching `id`. */
  id?: string;
  /** Optional. The function parameters and values in JSON object format. See FunctionDeclaration.parameters for parameter details. */
  args?: Record<string, unknown>;
  /** Optional. The name of the function to call. Matches FunctionDeclaration.name. */
  name?: string;
  /** Optional. The partial argument value of the function call. If provided, represents the arguments/fields that are streamed incrementally. This field is not supported in Gemini API. */
  partialArgs?: PartialArg[];
  /** Optional. Whether this is the last part of the FunctionCall. If true, another partial message for the current FunctionCall is expected to follow. This field is not supported in Gemini API. */
  willContinue?: boolean;
}
/** Function calling config. */
declare interface FunctionCallingConfig {
  /** Optional. Function names to call. Only set when the Mode is ANY. Function names should match FunctionDeclaration.name. With mode set to ANY, model will predict a function call from the set of function names provided. */
  allowedFunctionNames?: string[];
  /** Optional. Function calling mode. */
  mode?: FunctionCallingConfigMode;
  /** Optional. When set to true, arguments of a single function call will be streamed out in multiple parts/contents/responses. Partial parameter results will be returned in the `FunctionCall.partial_args` field. This field is not supported in Gemini API. */
  streamFunctionCallArguments?: boolean;
}
/** Function calling mode. */
declare enum FunctionCallingConfigMode {
  /**
   * Unspecified function calling mode. This value should not be used.
   */
  MODE_UNSPECIFIED = "MODE_UNSPECIFIED",
  /**
   * Default model behavior, model decides to predict either function calls or natural language response.
   */
  AUTO = "AUTO",
  /**
   * Model is constrained to always predicting function calls only. If "allowed_function_names" are set, the predicted function calls will be limited to any one of "allowed_function_names", else the predicted function calls will be any one of the provided "function_declarations".
   */
  ANY = "ANY",
  /**
   * Model will not predict any function calls. Model behavior is same as when not passing any function declarations.
   */
  NONE = "NONE",
  /**
   * Model is constrained to predict either function calls or natural language response. If "allowed_function_names" are set, the predicted function calls will be limited to any one of "allowed_function_names", else the predicted function calls will be any one of the provided "function_declarations".
   */
  VALIDATED = "VALIDATED"
}
/**
 * A function tool call step.
 */
declare interface FunctionCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  /**
   * Required. The arguments to pass to the function.
   */
  arguments: {
    [key: string]: unknown;
  };
  /**
   * Required. The name of the tool to call.
   */
  name: string;
  type: 'function_call';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/** Structured representation of a function declaration as defined by the [OpenAPI 3.0 specification](https://spec.openapis.org/oas/v3.0.3). Included in this declaration are the function name, description, parameters and response type. This FunctionDeclaration is a representation of a block of code that can be used as a `Tool` by the model and executed by the client. */
declare interface FunctionDeclaration {
  /** Optional. Description and purpose of the function. Model uses it to decide how and whether to call the function. */
  description?: string;
  /** Required. The name of the function to call. Must start with a letter or an underscore. Must be a-z, A-Z, 0-9, or contain underscores, dots, colons and dashes, with a maximum length of 128. */
  name?: string;
  /** Optional. Describes the parameters to this function in JSON Schema Object format. Reflects the Open API 3.03 Parameter Object. string Key: the name of the parameter. Parameter names are case sensitive. Schema Value: the Schema defining the type used for the parameter. For function with no parameters, this can be left unset. Parameter names must start with a letter or an underscore and must only contain chars a-z, A-Z, 0-9, or underscores with a maximum length of 64. Example with 1 required and 1 optional parameter: type: OBJECT properties: param1: type: STRING param2: type: INTEGER required: - param1 */
  parameters?: Schema;
  /** Optional. Describes the parameters to the function in JSON Schema format. The schema must describe an object where the properties are the parameters to the function. For example: ``` { "type": "object", "properties": { "name": { "type": "string" }, "age": { "type": "integer" } }, "additionalProperties": false, "required": ["name", "age"], "propertyOrdering": ["name", "age"] } ``` This field is mutually exclusive with `parameters`. */
  parametersJsonSchema?: unknown;
  /** Optional. Describes the output from this function in JSON Schema format. Reflects the Open API 3.03 Response Object. The Schema defines the type used for the response value of the function. */
  response?: Schema;
  /** Optional. Describes the output from this function in JSON Schema format. The value specified by the schema is the response value of the function. This field is mutually exclusive with `response`. */
  responseJsonSchema?: unknown;
  /** Optional. Specifies the function Behavior. Currently only non-blocking functions are supported. If not specified, the system keeps the current function call behavior. This field is currently only supported by the BidiGenerateContent method. */
  behavior?: Behavior;
}
/** A function response. */
declare class FunctionResponse {
  /** Signals that function call continues, and more responses will be returned, turning the function call into a generator. Is only applicable to NON_BLOCKING function calls (see FunctionDeclaration.behavior for details), ignored otherwise. If false, the default, future responses will not be considered. Is only applicable to NON_BLOCKING function calls, is ignored otherwise. If set to false, future responses will not be considered. It is allowed to return empty `response` with `will_continue=False` to signal that the function call is finished. */
  willContinue?: boolean;
  /** Specifies how the response should be scheduled in the conversation. Only applicable to NON_BLOCKING function calls, is ignored otherwise. Defaults to WHEN_IDLE. */
  scheduling?: FunctionResponseScheduling;
  /** List of parts that constitute a function response. Each part may
   have a different IANA MIME type. */
  parts?: FunctionResponsePart[];
  /** Optional. The id of the function call this response is for. Populated by the client to match the corresponding function call `id`. */
  id?: string;
  /** Required. The name of the function to call. Matches FunctionDeclaration.name and FunctionCall.name. */
  name?: string;
  /** Required. The function response in JSON object format. Use "output" key to specify function output and "error" key to specify error details (if any). If "output" and "error" keys are not specified, then whole "response" is treated as function output. */
  response?: Record<string, unknown>;
}
/** Raw media bytes for function response.

 Text should not be sent as raw bytes, use the FunctionResponse.response
 field. */
declare class FunctionResponseBlob {
  /** Required. The IANA standard MIME type of the source data. */
  mimeType?: string;
  /** Required. Inline media bytes.
   * @remarks Encoded as base64 string. */
  data?: string;
  /** Optional. Display name of the blob.
   Used to provide a label or filename to distinguish blobs. */
  displayName?: string;
}
/** URI based data for function response. */
declare class FunctionResponseFileData {
  /** Required. URI. */
  fileUri?: string;
  /** Required. The IANA standard MIME type of the source data. */
  mimeType?: string;
  /** Optional. Display name of the file.
   Used to provide a label or filename to distinguish files. */
  displayName?: string;
}
/** A datatype containing media that is part of a `FunctionResponse` message.

 A `FunctionResponsePart` consists of data which has an associated datatype. A
 `FunctionResponsePart` can only contain one of the accepted types in
 `FunctionResponsePart.data`.

 A `FunctionResponsePart` must have a fixed IANA MIME type identifying the
 type and subtype of the media if the `inline_data` field is filled with raw
 bytes. */
declare class FunctionResponsePart {
  /** Optional. Inline media bytes. */
  inlineData?: FunctionResponseBlob;
  /** Optional. URI based data. */
  fileData?: FunctionResponseFileData;
}
/** Specifies how the response should be scheduled in the conversation. */
declare enum FunctionResponseScheduling {
  /**
   * This value is unused.
   */
  SCHEDULING_UNSPECIFIED = "SCHEDULING_UNSPECIFIED",
  /**
   * Only add the result to the conversation context, do not interrupt or trigger generation.
   */
  SILENT = "SILENT",
  /**
   * Add the result to the conversation context, and prompt to generate output without interrupting ongoing generation.
   */
  WHEN_IDLE = "WHEN_IDLE",
  /**
   * Add the result to the conversation context, interrupt ongoing generation and prompt to generate output.
   */
  INTERRUPT = "INTERRUPT"
}
/**
 * Result of a function tool call.
 */
declare interface FunctionResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  /**
   * The result of the tool call.
   */
  result: unknown | Array<TextContent | ImageContent> | string;
  type: 'function_result';
  /**
   * Whether the tool call resulted in an error.
   */
  is_error?: boolean;
  /**
   * The name of the tool that was called.
   */
  name?: string;
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/** The Google Cloud Storage location for the input content. This data type is not supported in Gemini API. */
declare interface GcsSource {
  /** Required. Google Cloud Storage URI(-s) to the input file(s). May contain wildcards. For more information on wildcards, see https://cloud.google.com/storage/docs/wildcards. */
  uris?: string[];
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare interface GeminiNextGenAPIClientAdapter {
  isVertexAI: () => boolean;
  getProject: () => string | undefined;
  getLocation: () => string | undefined;
  getAuthHeaders: () => Headers | Promise<Headers>;
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare class GeminiNextGenAPIClientError extends Error {}
/** Input example for preference optimization. This data type is not supported in Gemini API. */
declare interface GeminiPreferenceExample {
  /** List of completions for a given prompt. */
  completions?: GeminiPreferenceExampleCompletion[];
  /** Multi-turn contents that represents the Prompt. */
  contents?: Content[];
}
/** Completion and its preference score. This data type is not supported in Gemini API. */
declare interface GeminiPreferenceExampleCompletion {
  /** Single turn completion for the given prompt. */
  completion?: Content;
  /** The score for the given completion. */
  score?: number;
}
/** Optional model configuration parameters.

 For more information, see `Content generation parameters
 <https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters>`_. */
declare interface GenerateContentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Instructions for the model to steer it toward better performance.
   For example, "Answer as concisely as possible" or "Don't use technical
   terms in your response".
   */
  systemInstruction?: ContentUnion;
  /** Value that controls the degree of randomness in token selection.
   Lower temperatures are good for prompts that require a less open-ended or
   creative response, while higher temperatures can lead to more diverse or
   creative results.
   */
  temperature?: number;
  /** Tokens are selected from the most to least probable until the sum
   of their probabilities equals this value. Use a lower value for less
   random responses and a higher value for more random responses.
   */
  topP?: number;
  /** For each token selection step, the ``top_k`` tokens with the
   highest probabilities are sampled. Then tokens are further filtered based
   on ``top_p`` with the final token selected using temperature sampling. Use
   a lower number for less random responses and a higher number for more
   random responses.
   */
  topK?: number;
  /** Number of response variations to return.
   */
  candidateCount?: number;
  /** Maximum number of tokens that can be generated in the response.
   */
  maxOutputTokens?: number;
  /** List of strings that tells the model to stop generating text if one
   of the strings is encountered in the response.
   */
  stopSequences?: string[];
  /** Whether to return the log probabilities of the tokens that were
   chosen by the model at each step.
   */
  responseLogprobs?: boolean;
  /** Number of top candidate tokens to return the log probabilities for
   at each generation step.
   */
  logprobs?: number;
  /** Positive values penalize tokens that already appear in the
   generated text, increasing the probability of generating more diverse
   content.
   */
  presencePenalty?: number;
  /** Positive values penalize tokens that repeatedly appear in the
   generated text, increasing the probability of generating more diverse
   content.
   */
  frequencyPenalty?: number;
  /** When ``seed`` is fixed to a specific number, the model makes a best
   effort to provide the same response for repeated requests. By default, a
   random number is used.
   */
  seed?: number;
  /** Output response mimetype of the generated candidate text.
   Supported mimetype:
   - `text/plain`: (default) Text output.
   - `application/json`: JSON response in the candidates.
   The model needs to be prompted to output the appropriate response type,
   otherwise the behavior is undefined.
   */
  responseMimeType?: string;
  /** The `Schema` object allows the definition of input and output data types.
   These types can be objects, but also primitives and arrays.
   Represents a select subset of an [OpenAPI 3.0 schema
   object](https://spec.openapis.org/oas/v3.0.3#schema).
   If set, a compatible response_mime_type must also be set.
   Compatible mimetypes: `application/json`: Schema for JSON response.
     If `response_schema` doesn't process your schema correctly, try using
   `response_json_schema` instead.
   */
  responseSchema?: SchemaUnion;
  /** Optional. Output schema of the generated response.
   This is an alternative to `response_schema` that accepts [JSON
   Schema](https://json-schema.org/). If set, `response_schema` must be
   omitted, but `response_mime_type` is required. While the full JSON Schema
   may be sent, not all features are supported. Specifically, only the
   following properties are supported: - `$id` - `$defs` - `$ref` - `$anchor`
   - `type` - `format` - `title` - `description` - `enum` (for strings and
   numbers) - `items` - `prefixItems` - `minItems` - `maxItems` - `minimum` -
   `maximum` - `anyOf` - `oneOf` (interpreted the same as `anyOf`) -
   `properties` - `additionalProperties` - `required` The non-standard
   `propertyOrdering` property may also be set. Cyclic references are
   unrolled to a limited degree and, as such, may only be used within
   non-required properties. (Nullable properties are not sufficient.) If
   `$ref` is set on a sub-schema, no other properties, except for than those
   starting as a `$`, may be set. */
  responseJsonSchema?: unknown;
  /** Configuration for model router requests.
   */
  routingConfig?: GenerationConfigRoutingConfig;
  /** Configuration for model selection.
   */
  modelSelectionConfig?: ModelSelectionConfig;
  /** Safety settings in the request to block unsafe content in the
   response.
   */
  safetySettings?: SafetySetting[];
  /** Code that enables the system to interact with external systems to
   perform an action outside of the knowledge and scope of the model.
   */
  tools?: ToolListUnion;
  /** Associates model output to a specific function call.
   */
  toolConfig?: ToolConfig;
  /** Labels with user-defined metadata to break down billed charges. */
  labels?: Record<string, string>;
  /** Resource name of a context cache that can be used in subsequent
   requests.
   */
  cachedContent?: string;
  /** The requested modalities of the response. Represents the set of
   modalities that the model can return.
   */
  responseModalities?: string[];
  /** If specified, the media resolution specified will be used.
   */
  mediaResolution?: MediaResolution;
  /** The speech generation configuration.
   */
  speechConfig?: SpeechConfigUnion;
  /** If enabled, audio timestamp will be included in the request to the
   model.
   */
  audioTimestamp?: boolean;
  /** The configuration for automatic function calling.
   */
  automaticFunctionCalling?: AutomaticFunctionCallingConfig;
  /** The thinking features configuration.
   */
  thinkingConfig?: ThinkingConfig;
  /** The image generation configuration.
   */
  imageConfig?: ImageConfig;
  /** Enables enhanced civic answers. It may not be available for all
   models. This field is not supported in Gemini Enterprise Agent Platform.
   */
  enableEnhancedCivicAnswers?: boolean;
  /** Settings for prompt and response sanitization using the Model Armor
   service. If supplied, safety_settings must not be supplied.
   */
  modelArmorConfig?: ModelArmorConfig;
  /** The service tier to use for the request. For example, ServiceTier.FLEX. */
  serviceTier?: ServiceTier;
}
/** Config for models.generate_content parameters. */
declare interface GenerateContentParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** Content of the request.
   */
  contents: ContentListUnion;
  /** Configuration that contains optional model parameters.
   */
  config?: GenerateContentConfig;
}
/** Response message for PredictionService.GenerateContent. */
declare class GenerateContentResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** Response variations returned by the model.
   */
  candidates?: Candidate[];
  /** Timestamp when the request is made to the server.
   */
  createTime?: string;
  /** The history of automatic function calling.
   */
  automaticFunctionCallingHistory?: Content[];
  /** Output only. The model version used to generate the response. */
  modelVersion?: string;
  /** Output only. Content filter results for a prompt sent in the request. Note: Sent only in the first stream chunk. Only happens when no candidates were generated due to content violations. */
  promptFeedback?: GenerateContentResponsePromptFeedback;
  /** Output only. response_id is used to identify each response. It is the encoding of the event_id. */
  responseId?: string;
  /** Usage metadata about the response(s). */
  usageMetadata?: GenerateContentResponseUsageMetadata;
  /** Output only. The current model status of this model. This field is not supported in Vertex AI. */
  modelStatus?: ModelStatus;
  /**
   * Returns the concatenation of all text parts from the first candidate in the response.
   *
   * @remarks
   * If there are multiple candidates in the response, the text from the first
   * one will be returned.
   * If there are non-text parts in the response, the concatenation of all text
   * parts will be returned, and a warning will be logged.
   * If there are thought parts in the response, the concatenation of all text
   * parts excluding the thought parts will be returned.
   *
   * @example
   * ```ts
   * const response = await ai.models.generateContent({
   *   model: 'gemini-2.0-flash',
   *   contents:
   *     'Why is the sky blue?',
   * });
   *
   * console.debug(response.text);
   * ```
   */
  get text(): string | undefined;
  /**
   * Returns the concatenation of all inline data parts from the first candidate
   * in the response.
   *
   * @remarks
   * If there are multiple candidates in the response, the inline data from the
   * first one will be returned. If there are non-inline data parts in the
   * response, the concatenation of all inline data parts will be returned, and
   * a warning will be logged.
   */
  get data(): string | undefined;
  /**
   * Returns the function calls from the first candidate in the response.
   *
   * @remarks
   * If there are multiple candidates in the response, the function calls from
   * the first one will be returned.
   * If there are no function calls in the response, undefined will be returned.
   *
   * @example
   * ```ts
   * const controlLightFunctionDeclaration: FunctionDeclaration = {
   *   name: 'controlLight',
   *   parameters: {
   *   type: Type.OBJECT,
   *   description: 'Set the brightness and color temperature of a room light.',
   *   properties: {
   *     brightness: {
   *       type: Type.NUMBER,
   *       description:
   *         'Light level from 0 to 100. Zero is off and 100 is full brightness.',
   *     },
   *     colorTemperature: {
   *       type: Type.STRING,
   *       description:
   *         'Color temperature of the light fixture which can be `daylight`, `cool` or `warm`.',
   *     },
   *   },
   *   required: ['brightness', 'colorTemperature'],
   *  };
   *  const response = await ai.models.generateContent({
   *     model: 'gemini-2.0-flash',
   *     contents: 'Dim the lights so the room feels cozy and warm.',
   *     config: {
   *       tools: [{functionDeclarations: [controlLightFunctionDeclaration]}],
   *       toolConfig: {
   *         functionCallingConfig: {
   *           mode: FunctionCallingConfigMode.ANY,
   *           allowedFunctionNames: ['controlLight'],
   *         },
   *       },
   *     },
   *   });
   *  console.debug(JSON.stringify(response.functionCalls));
   * ```
   */
  get functionCalls(): FunctionCall[] | undefined;
  /**
   * Returns the first executable code from the first candidate in the response.
   *
   * @remarks
   * If there are multiple candidates in the response, the executable code from
   * the first one will be returned.
   * If there are no executable code in the response, undefined will be
   * returned.
   *
   * @example
   * ```ts
   * const response = await ai.models.generateContent({
   *   model: 'gemini-2.0-flash',
   *   contents:
   *     'What is the sum of the first 50 prime numbers? Generate and run code for the calculation, and make sure you get all 50.'
   *   config: {
   *     tools: [{codeExecution: {}}],
   *   },
   * });
   *
   * console.debug(response.executableCode);
   * ```
   */
  get executableCode(): string | undefined;
  /**
   * Returns the first code execution result from the first candidate in the response.
   *
   * @remarks
   * If there are multiple candidates in the response, the code execution result from
   * the first one will be returned.
   * If there are no code execution result in the response, undefined will be returned.
   *
   * @example
   * ```ts
   * const response = await ai.models.generateContent({
   *   model: 'gemini-2.0-flash',
   *   contents:
   *     'What is the sum of the first 50 prime numbers? Generate and run code for the calculation, and make sure you get all 50.'
   *   config: {
   *     tools: [{codeExecution: {}}],
   *   },
   * });
   *
   * console.debug(response.codeExecutionResult);
   * ```
   */
  get codeExecutionResult(): string | undefined;
}
/** Content filter results for a prompt sent in the request. Note: This is sent only in the first stream chunk and only if no candidates were generated due to content violations. */
declare class GenerateContentResponsePromptFeedback {
  /** Output only. The reason why the prompt was blocked. */
  blockReason?: BlockedReason;
  /** Output only. A readable message that explains the reason why the prompt was blocked. This field is not supported in Gemini API. */
  blockReasonMessage?: string;
  /** Output only. A list of safety ratings for the prompt. There is one rating per category. */
  safetyRatings?: SafetyRating[];
}
/** Usage metadata about the content generation request and response. This message provides a detailed breakdown of token usage and other relevant metrics. This data type is not supported in Gemini API. */
declare class GenerateContentResponseUsageMetadata {
  /** Output only. A detailed breakdown of the token count for each modality in the cached content. */
  cacheTokensDetails?: ModalityTokenCount[];
  /** Output only. The number of tokens in the cached content that was used for this request. */
  cachedContentTokenCount?: number;
  /** The total number of tokens in the generated candidates. */
  candidatesTokenCount?: number;
  /** Output only. A detailed breakdown of the token count for each modality in the generated candidates. */
  candidatesTokensDetails?: ModalityTokenCount[];
  /** The total number of tokens in the prompt. This includes any text, images, or other media provided in the request. When `cached_content` is set, this also includes the number of tokens in the cached content. */
  promptTokenCount?: number;
  /** Output only. A detailed breakdown of the token count for each modality in the prompt. */
  promptTokensDetails?: ModalityTokenCount[];
  /** Output only. The number of tokens that were part of the model's generated "thoughts" output, if applicable. */
  thoughtsTokenCount?: number;
  /** Output only. The number of tokens in the results from tool executions, which are provided back to the model as input, if applicable. */
  toolUsePromptTokenCount?: number;
  /** Output only. A detailed breakdown by modality of the token counts from the results of tool executions, which are provided back to the model as input. */
  toolUsePromptTokensDetails?: ModalityTokenCount[];
  /** The total number of tokens for the entire request. This is the sum of `prompt_token_count`, `candidates_token_count`, `tool_use_prompt_token_count`, and `thoughts_token_count`. */
  totalTokenCount?: number;
  /** Output only. The traffic type for this request. */
  trafficType?: TrafficType;
}
/** An output image. */
declare interface GeneratedImage {
  /** The output image data. */
  image?: Image_2;
  /** Responsible AI filter reason if the image is filtered out of the
   response. */
  raiFilteredReason?: string;
  /** Safety attributes of the image. Lists of RAI categories and their
   scores of each content. */
  safetyAttributes?: SafetyAttributes;
  /** The rewritten prompt used for the image generation if the prompt
   enhancer is enabled. */
  enhancedPrompt?: string;
}
/** A generated image mask. */
declare interface GeneratedImageMask {
  /** The generated image mask. */
  mask?: Image_2;
  /** The detected entities on the segmented area. */
  labels?: EntityLabel[];
}
/** A generated video. */
declare interface GeneratedVideo {
  /** The output video */
  video?: Video;
}
/** The config for generating an images. */
declare interface GenerateImagesConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Cloud Storage URI used to store the generated images. */
  outputGcsUri?: string;
  /** Description of what to discourage in the generated images. */
  negativePrompt?: string;
  /** Number of images to generate. */
  numberOfImages?: number;
  /** Aspect ratio of the generated images. Supported values are
   "1:1", "3:4", "4:3", "9:16", and "16:9". */
  aspectRatio?: string;
  /** Controls how much the model adheres to the text prompt. Large
   values increase output and prompt alignment, but may compromise image
   quality. */
  guidanceScale?: number;
  /** Random seed for image generation. This is not available when
   ``add_watermark`` is set to true. */
  seed?: number;
  /** Filter level for safety filtering. */
  safetyFilterLevel?: SafetyFilterLevel;
  /** Allows generation of people by the model. */
  personGeneration?: PersonGeneration;
  /** Whether to report the safety scores of each generated image and
   the positive prompt in the response. */
  includeSafetyAttributes?: boolean;
  /** Whether to include the Responsible AI filter reason if the image
   is filtered out of the response. */
  includeRaiReason?: boolean;
  /** Language of the text in the prompt. */
  language?: ImagePromptLanguage;
  /** MIME type of the generated image. */
  outputMimeType?: string;
  /** Compression quality of the generated image (for ``image/jpeg``
   only). */
  outputCompressionQuality?: number;
  /** Whether to add a watermark to the generated images. */
  addWatermark?: boolean;
  /** User specified labels to track billing usage. */
  labels?: Record<string, string>;
  /** The size of the largest dimension of the generated image.
   Supported sizes are 1K and 2K (not supported for Imagen 3 models). */
  imageSize?: string;
  /** Whether to use the prompt rewriting logic. */
  enhancePrompt?: boolean;
}
/** The parameters for generating images. */
declare interface GenerateImagesParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** Text prompt that typically describes the images to output.
   */
  prompt: string;
  /** Configuration for generating images.
   */
  config?: GenerateImagesConfig;
}
/** The output images response. */
declare class GenerateImagesResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** List of generated images. */
  generatedImages?: GeneratedImage[];
  /** Safety attributes of the positive prompt. Only populated if
   ``include_safety_attributes`` is set to True. */
  positivePromptSafetyAttributes?: SafetyAttributes;
}
/** Configuration for generating videos. */
declare interface GenerateVideosConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Number of output videos. */
  numberOfVideos?: number;
  /** The gcs bucket where to save the generated videos. */
  outputGcsUri?: string;
  /** Frames per second for video generation. */
  fps?: number;
  /** Duration of the clip for video generation in seconds. */
  durationSeconds?: number;
  /** The RNG seed. If RNG seed is exactly same for each request with
   unchanged inputs, the prediction results will be consistent. Otherwise,
   a random RNG seed will be used each time to produce a different
   result. */
  seed?: number;
  /** The aspect ratio for the generated video. 16:9 (landscape) and
   9:16 (portrait) are supported. */
  aspectRatio?: string;
  /** The resolution for the generated video. 720p and 1080p are
   supported. */
  resolution?: string;
  /** Whether allow to generate person videos, and restrict to specific
   ages. Supported values are: dont_allow, allow_adult. */
  personGeneration?: string;
  /** The pubsub topic where to publish the video generation
   progress. */
  pubsubTopic?: string;
  /** Explicitly state what should not be included in the generated
   videos. */
  negativePrompt?: string;
  /** Whether to use the prompt rewriting logic. */
  enhancePrompt?: boolean;
  /** Whether to generate audio along with the video. */
  generateAudio?: boolean;
  /** Image to use as the last frame of generated videos.
   Only supported for image to video use cases. */
  lastFrame?: Image_2;
  /** The images to use as the references to generate the videos.
   If this field is provided, the text prompt field must also be provided.
   The image, video, or last_frame field are not supported. Each image must
   be associated with a type. Veo 2 supports up to 3 asset images *or* 1
   style image. */
  referenceImages?: VideoGenerationReferenceImage[];
  /** The mask to use for generating videos. */
  mask?: VideoGenerationMask;
  /** Compression quality of the generated videos. */
  compressionQuality?: VideoCompressionQuality;
  /** User specified labels to track billing usage. */
  labels?: Record<string, string>;
  /** Webhook configuration for receiving notifications when the
   video generation operation completes. */
  webhookConfig?: WebhookConfig;
  /** Resize mode of the image input for video generation. */
  resizeMode?: ImageResizeMode;
}
/** A video generation operation. */
declare class GenerateVideosOperation implements Operation<GenerateVideosResponse> {
  /** The server-assigned name, which is only unique within the same service that originally returns it. If you use the default HTTP mapping, the `name` should be a resource name ending with `operations/{unique_id}`. */
  name?: string;
  /** Service-specific metadata associated with the operation. It typically contains progress information and common metadata such as create time. Some services might not provide such metadata.  Any method that returns a long-running operation should document the metadata type, if any. */
  metadata?: Record<string, unknown>;
  /** If the value is `false`, it means the operation is still in progress. If `true`, the operation is completed, and either `error` or `response` is available. */
  done?: boolean;
  /** The error result of the operation in case of failure or cancellation. */
  error?: Record<string, unknown>;
  /** The generated videos. */
  response?: GenerateVideosResponse;
  /**
   * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
   */
  _fromAPIResponse({
    apiResponse,
    _isVertexAI
  }: OperationFromAPIResponseParameters): Operation<GenerateVideosResponse>;
  /** The full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Class that represents the parameters for generating videos. */
declare interface GenerateVideosParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** The text prompt for generating the videos.
   Optional if image or video is provided. */
  prompt?: string;
  /** The input image for generating the videos.
   Optional if prompt is provided. Not allowed if video is provided. */
  image?: Image_2;
  /** The input video for video extension use cases.
   Optional if prompt is provided. Not allowed if image is provided. */
  video?: Video;
  /** A set of source input(s) for video generation. */
  source?: GenerateVideosSource;
  /** Configuration for generating videos. */
  config?: GenerateVideosConfig;
}
/** Response with generated videos. */
declare class GenerateVideosResponse {
  /** List of the generated videos */
  generatedVideos?: GeneratedVideo[];
  /** Returns if any videos were filtered due to RAI policies. */
  raiMediaFilteredCount?: number;
  /** Returns rai failure reasons if any. */
  raiMediaFilteredReasons?: string[];
}
/** A set of source input(s) for video generation. */
declare interface GenerateVideosSource {
  /** The text prompt for generating the videos.
   Optional if image or video is provided. */
  prompt?: string;
  /** The input image for generating the videos.
   Optional if prompt is provided. Not allowed if video is provided. */
  image?: Image_2;
  /** The input video for video extension use cases.
   Optional if prompt is provided. Not allowed if image is provided. */
  video?: Video;
}
/** Generation config. */
declare interface GenerationConfig {
  /** Optional. Config for model selection. */
  modelSelectionConfig?: ModelSelectionConfig;
  /** Output schema of the generated response. This is an alternative to
   `response_schema` that accepts [JSON Schema](https://json-schema.org/).
   */
  responseJsonSchema?: unknown;
  /** Optional. If enabled, audio timestamps will be included in the request to the model. This can be useful for synchronizing audio with other modalities in the response. This field is not supported in Gemini API. */
  audioTimestamp?: boolean;
  /** Optional. The number of candidate responses to generate. A higher `candidate_count` can provide more options to choose from, but it also consumes more resources. This can be useful for generating a variety of responses and selecting the best one. */
  candidateCount?: number;
  /** Optional. If enabled, the model will detect emotions and adapt its responses accordingly. For example, if the model detects that the user is frustrated, it may provide a more empathetic response. This field is not supported in Gemini API. */
  enableAffectiveDialog?: boolean;
  /** Optional. Penalizes tokens based on their frequency in the generated text. A positive value helps to reduce the repetition of words and phrases. Valid values can range from [-2.0, 2.0]. */
  frequencyPenalty?: number;
  /** Optional. The number of top log probabilities to return for each token. This can be used to see which other tokens were considered likely candidates for a given position. A higher value will return more options, but it will also increase the size of the response. */
  logprobs?: number;
  /** Optional. The maximum number of tokens to generate in the response. A token is approximately four characters. The default value varies by model. This parameter can be used to control the length of the generated text and prevent overly long responses. */
  maxOutputTokens?: number;
  /** Optional. The token resolution at which input media content is sampled. This is used to control the trade-off between the quality of the response and the number of tokens used to represent the media. A higher resolution allows the model to perceive more detail, which can lead to a more nuanced response, but it will also use more tokens. This does not affect the image dimensions sent to the model. */
  mediaResolution?: MediaResolution;
  /** Optional. Penalizes tokens that have already appeared in the generated text. A positive value encourages the model to generate more diverse and less repetitive text. Valid values can range from [-2.0, 2.0]. */
  presencePenalty?: number;
  /** Optional. If set to true, the log probabilities of the output tokens are returned. Log probabilities are the logarithm of the probability of a token appearing in the output. A higher log probability means the token is more likely to be generated. This can be useful for analyzing the model's confidence in its own output and for debugging. */
  responseLogprobs?: boolean;
  /** Optional. The IANA standard MIME type of the response. The model will generate output that conforms to this MIME type. Supported values include 'text/plain' (default) and 'application/json'. The model needs to be prompted to output the appropriate response type, otherwise the behavior is undefined. */
  responseMimeType?: string;
  /** Optional. The modalities of the response. The model will generate a response that includes all the specified modalities. For example, if this is set to `[TEXT, IMAGE]`, the response will include both text and an image. */
  responseModalities?: Modality[];
  /** Optional. Lets you to specify a schema for the model's response, ensuring that the output conforms to a particular structure. This is useful for generating structured data such as JSON. The schema is a subset of the [OpenAPI 3.0 schema object](https://spec.openapis.org/oas/v3.0.3#schema) object. When this field is set, you must also set the `response_mime_type` to `application/json`. */
  responseSchema?: Schema;
  /** Optional. Routing configuration. This field is not supported in Gemini API. */
  routingConfig?: GenerationConfigRoutingConfig;
  /** Optional. A seed for the random number generator. By setting a seed, you can make the model's output mostly deterministic. For a given prompt and parameters (like temperature, top_p, etc.), the model will produce the same response every time. However, it's not a guaranteed absolute deterministic behavior. This is different from parameters like `temperature`, which control the *level* of randomness. `seed` ensures that the "random" choices the model makes are the same on every run, making it essential for testing and ensuring reproducible results. */
  seed?: number;
  /** Optional. The speech generation config. */
  speechConfig?: SpeechConfig;
  /** Optional. A list of character sequences that will stop the model from generating further tokens. If a stop sequence is generated, the output will end at that point. This is useful for controlling the length and structure of the output. For example, you can use ["\n", "###"] to stop generation at a new line or a specific marker. */
  stopSequences?: string[];
  /** Optional. Controls the randomness of the output. A higher temperature results in more creative and diverse responses, while a lower temperature makes the output more predictable and focused. The valid range is (0.0, 2.0]. */
  temperature?: number;
  /** Optional. Configuration for thinking features. An error will be returned if this field is set for models that don't support thinking. */
  thinkingConfig?: ThinkingConfig;
  /** Optional. Specifies the top-k sampling threshold. The model considers only the top k most probable tokens for the next token. This can be useful for generating more coherent and less random text. For example, a `top_k` of 40 means the model will choose the next word from the 40 most likely words. */
  topK?: number;
  /** Optional. Specifies the nucleus sampling threshold. The model considers only the smallest set of tokens whose cumulative probability is at least `top_p`. This helps generate more diverse and less repetitive responses. For example, a `top_p` of 0.9 means the model considers tokens until the cumulative probability of the tokens to select from reaches 0.9. It's recommended to adjust either temperature or `top_p`, but not both. */
  topP?: number;
  /** Optional. Enables enhanced civic answers. It may not be available for all models. This field is not supported in Vertex AI. */
  enableEnhancedCivicAnswers?: boolean;
}
/**
 * Configuration parameters for model interactions.
 */
declare interface GenerationConfig_2 {
  /**
   * @deprecated Configuration for image interaction.
   */
  image_config?: ImageConfig_2;
  /**
   * The maximum number of tokens to include in the response.
   */
  max_output_tokens?: number;
  /**
   * Seed used in decoding for reproducibility.
   */
  seed?: number;
  /**
   * Configuration for speech interaction.
   */
  speech_config?: Array<SpeechConfig_2>;
  /**
   * A list of character sequences that will stop output interaction.
   */
  stop_sequences?: Array<string>;
  /**
   * Controls the randomness of the output.
   */
  temperature?: number;
  /**
   * The level of thought tokens that the model should generate.
   */
  thinking_level?: ThinkingLevel_2;
  /**
   * Whether to include thought summaries in the response.
   */
  thinking_summaries?: 'auto' | 'none';
  /**
   * The tool choice configuration.
   */
  tool_choice?: ToolChoiceType | ToolChoiceConfig;
  /**
   * The maximum cumulative probability of tokens to consider when sampling.
   */
  top_p?: number;
}
/** The configuration for routing the request to a specific model. This can be used to control which model is used for the generation, either automatically or by specifying a model name. This data type is not supported in Gemini API. */
declare interface GenerationConfigRoutingConfig {
  /** In this mode, the model is selected automatically based on the content of the request. */
  autoMode?: GenerationConfigRoutingConfigAutoRoutingMode;
  /** In this mode, the model is specified manually. */
  manualMode?: GenerationConfigRoutingConfigManualRoutingMode;
}
/** The configuration for automated routing. When automated routing is specified, the routing will be determined by the pretrained routing model and customer provided model routing preference. This data type is not supported in Gemini API. */
declare interface GenerationConfigRoutingConfigAutoRoutingMode {
  /** The model routing preference. */
  modelRoutingPreference?: 'UNKNOWN' | 'PRIORITIZE_QUALITY' | 'BALANCED' | 'PRIORITIZE_COST';
}
/** The configuration for manual routing. When manual routing is specified, the model will be selected based on the model name provided. This data type is not supported in Gemini API. */
declare interface GenerationConfigRoutingConfigManualRoutingMode {
  /** The name of the model to use. Only public LLM models are accepted. */
  modelName?: string;
}
/**
 * Config for thinking feature.
 *
 * @deprecated This interface will be deprecated. Please use `ThinkingConfig` instead.
 */
declare interface GenerationConfigThinkingConfig extends ThinkingConfig {}
/** Optional parameters. */
declare interface GetBatchJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Config for batches.get parameters. */
declare interface GetBatchJobParameters {
  /** A fully-qualified BatchJob resource name or ID.
   Example: "projects/.../locations/.../batchPredictionJobs/456"
   or "456" when project and location are initialized in the client.
   */
  name: string;
  /** Optional parameters for the request. */
  config?: GetBatchJobConfig;
}
/** Optional parameters for caches.get method. */
declare interface GetCachedContentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for caches.get method. */
declare interface GetCachedContentParameters {
  /** The server-generated resource name of the cached content.
   */
  name: string;
  /** Optional parameters for the request.
   */
  config?: GetCachedContentConfig;
}
/** Optional Config. */
declare interface GetDocumentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for documents.get. */
declare interface GetDocumentParameters {
  /** The resource name of the Document.
   Example: fileSearchStores/file-search-store-foo/documents/documents-bar */
  name: string;
  /** Optional parameters for the request. */
  config?: GetDocumentConfig;
}
/** Used to override the default configuration. */
declare interface GetFileConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Generates the parameters for the get method. */
declare interface GetFileParameters {
  /** The name identifier for the file to retrieve. */
  name: string;
  /** Used to override the default configuration. */
  config?: GetFileConfig;
}
/** Optional parameters for getting a FileSearchStore. */
declare interface GetFileSearchStoreConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Config for file_search_stores.get parameters. */
declare interface GetFileSearchStoreParameters {
  /** The resource name of the FileSearchStore. Example: `fileSearchStores/my-file-search-store-123` */
  name: string;
  /** Optional parameters for the request. */
  config?: GetFileSearchStoreConfig;
}
/** Optional parameters for models.get method. */
declare interface GetModelConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
declare interface GetModelParameters {
  model: string;
  /** Optional parameters for the request. */
  config?: GetModelConfig;
}
declare interface GetOperationConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for the GET method. */
declare interface GetOperationParameters {
  /** The server-assigned name for the operation. */
  operationName: string;
  /** Used to override the default configuration. */
  config?: GetOperationConfig;
}
/** Optional parameters for tunings.get method. */
declare interface GetTuningJobConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Parameters for the get method. */
declare interface GetTuningJobParameters {
  name: string;
  /** Optional parameters for the request. */
  config?: GetTuningJobConfig;
}
/**
 * The Google GenAI SDK.
 *
 * @remarks
 * Provides access to the GenAI features through either the {@link https://cloud.google.com/vertex-ai/docs/reference/rest | Gemini API}
 * or the {@link https://cloud.google.com/vertex-ai/docs/reference/rest | Vertex AI API}.
 *
 * The {@link GoogleGenAIOptions.vertexai} value determines which of the API services to use.
 *
 * When using the Gemini API, a {@link GoogleGenAIOptions.apiKey} must also be set,
 * when using Vertex AI {@link GoogleGenAIOptions.project} and {@link GoogleGenAIOptions.location} must also be set.
 *
 * @example
 * Initializing the SDK for using the Gemini API:
 * ```ts
 * import {GoogleGenAI} from '@google/genai';
 * const ai = new GoogleGenAI({apiKey: 'GEMINI_API_KEY'});
 * ```
 *
 * @example
 * Initializing the SDK for using the Vertex AI API:
 * ```ts
 * import {GoogleGenAI} from '@google/genai';
 * const ai = new GoogleGenAI({
 *   vertexai: true,
 *   project: 'PROJECT_ID',
 *   location: 'PROJECT_LOCATION'
 * });
 * ```
 *
 */
declare class GoogleGenAI {
  protected readonly apiClient: ApiClient;
  private readonly apiKey?;
  readonly vertexai: boolean;
  private readonly apiVersion?;
  private readonly httpOptions?;
  readonly models: Models;
  readonly live: Live;
  readonly batches: Batches;
  readonly chats: Chats;
  readonly caches: Caches;
  readonly files: Files;
  readonly operations: Operations;
  readonly authTokens: Tokens;
  readonly tunings: Tunings;
  readonly fileSearchStores: FileSearchStores;
  private _interactions;
  private _webhooks;
  private _agents;
  private _nextGenClient;
  private getNextGenClient;
  get interactions(): Interactions;
  get webhooks(): Webhooks;
  get agents(): Agents;
  constructor(options: GoogleGenAIOptions$1);
}
/**
 * Google Gen AI SDK's configuration options.
 *
 * See {@link GoogleGenAI} for usage samples.
 */
declare interface GoogleGenAIOptions$1 {
  /**
   * Optional. Determines whether to use the Vertex AI or the Gemini API.
   *
   * @remarks
   * When true, the {@link https://cloud.google.com/vertex-ai/docs/reference/rest | Gemini Enterprise Agent Platform API} will used.
   * When false, the {@link https://ai.google.dev/api | Gemini API} will be used.
   * When both enterprise and vertexai are set, and they have different values,
   * an Error will be thrown.
   *
   * If unset, default SDK behavior is to use the Gemini API service.
   */
  enterprise?: boolean;
  /**
   * Optional. Determines whether to use the Vertex AI (now Gemini Enterprise Agent Platform) or the Gemini API.
   * The `enterprise` flag is recommended instead.
   *
   * @remarks
   * When true, the {@link https://cloud.google.com/vertex-ai/docs/reference/rest | Vertex AI API} will used.
   * When false, the {@link https://ai.google.dev/api | Gemini API} will be used.
   * When both enterprise and vertexai are set, and they have different values,
   * an Error will be thrown.
   *
   * If unset, default SDK behavior is to use the Gemini API service.
   */
  vertexai?: boolean;
  /**
   * Optional. The Google Cloud project ID for Vertex AI clients.
   *
   * Find your project ID: https://cloud.google.com/resource-manager/docs/creating-managing-projects#identifying_projects
   *
   * @remarks
   * Only supported on Node runtimes, ignored on browser runtimes.
   */
  project?: string;
  /**
   * Optional. The Google Cloud project {@link https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations | location} for Vertex AI clients.
   *
   * @remarks
   * Only supported on Node runtimes, ignored on browser runtimes.
   *
   */
  location?: string;
  /**
   * The API Key, required for Gemini API clients.
   *
   * @remarks
   * Required on browser runtimes.
   */
  apiKey?: string;
  /**
   * Optional. The API version to use.
   *
   * @remarks
   * If unset, the default API version will be used.
   */
  apiVersion?: string;
  /**
   * Optional. Authentication options defined by the by google-auth-library for Vertex AI clients.
   *
   * @remarks
   * @see {@link https://github.com/googleapis/google-auth-library-nodejs/blob/v9.15.0/src/auth/googleauth.ts | GoogleAuthOptions interface in google-auth-library-nodejs}.
   *
   * Only supported on Node runtimes, ignored on browser runtimes.
   *
   */
  googleAuthOptions?: GoogleAuthOptions;
  /**
   * Optional. A set of customizable configuration for HTTP requests.
   */
  httpOptions?: HttpOptions;
}
/** Tool to retrieve knowledge from Google Maps. */
declare interface GoogleMaps {
  /** The authentication config to access the API. Only API key is supported. This field is not supported in Gemini API. */
  authConfig?: AuthConfig;
  /** Optional. Whether to return a widget context token in the GroundingMetadata of the response. Developers can use the widget context token to render a Google Maps widget with geospatial context related to the places that the model references in the response. */
  enableWidget?: boolean;
}
/**
 * The arguments to pass to the Google Maps tool.
 */
declare interface GoogleMapsCallArguments {
  /**
   * The queries to be executed.
   */
  queries?: Array<string>;
}
/**
 * Google Maps call step.
 */
declare interface GoogleMapsCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  type: 'google_maps_call';
  /**
   * The arguments to pass to the Google Maps tool.
   */
  arguments?: GoogleMapsCallStep.Arguments;
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace GoogleMapsCallStep {
  /**
   * The arguments to pass to the Google Maps tool.
   */
  interface Arguments {
    /**
     * The queries to be executed.
     */
    queries?: Array<string>;
  }
}
/**
 * The result of the Google Maps.
 */
declare interface GoogleMapsResult {
  /**
   * The places that were found.
   */
  places?: Array<GoogleMapsResult.Place>;
  /**
   * Resource name of the Google Maps widget context token.
   */
  widget_context_token?: string;
}
declare namespace GoogleMapsResult {
  interface Place {
    /**
     * Title of the place.
     */
    name?: string;
    /**
     * The ID of the place, in `places/{place_id}` format.
     */
    place_id?: string;
    /**
     * Snippets of reviews that are used to generate answers about the features of a
     * given place in Google Maps.
     */
    review_snippets?: Array<Place.ReviewSnippet>;
    /**
     * URI reference of the place.
     */
    url?: string;
  }
  namespace Place {
    /**
     * Encapsulates a snippet of a user review that answers a question about the
     * features of a specific place in Google Maps.
     */
    interface ReviewSnippet {
      /**
       * The ID of the review snippet.
       */
      review_id?: string;
      /**
       * Title of the review.
       */
      title?: string;
      /**
       * A link that corresponds to the user review on Google Maps.
       */
      url?: string;
    }
  }
}
/**
 * Google Maps result step.
 */
declare interface GoogleMapsResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  result: Array<GoogleMapsResultStep.Result>;
  type: 'google_maps_result';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace GoogleMapsResultStep {
  /**
   * The result of the Google Maps.
   */
  interface Result {
    places?: Array<Result.Place>;
    widget_context_token?: string;
  }
  namespace Result {
    interface Place {
      name?: string;
      place_id?: string;
      review_snippets?: Array<Place.ReviewSnippet>;
      url?: string;
    }
    namespace Place {
      /**
       * Encapsulates a snippet of a user review that answers a question about the
       * features of a specific place in Google Maps.
       */
      interface ReviewSnippet {
        /**
         * The ID of the review snippet.
         */
        review_id?: string;
        /**
         * Title of the review.
         */
        title?: string;
        /**
         * A link that corresponds to the user review on Google Maps.
         */
        url?: string;
      }
    }
  }
}
/** The `Status` type defines a logical error model that is suitable for different programming environments, including REST APIs and RPC APIs. It is used by [gRPC](https://github.com/grpc). Each `Status` message contains three pieces of data: error code, error message, and error details. You can find out more about this error model and how to work with it in the [API Design Guide](https://cloud.google.com/apis/design/errors). This data type is not supported in Gemini API. */
declare interface GoogleRpcStatus {
  /** The status code, which should be an enum value of google.rpc.Code. */
  code?: number;
  /** A list of messages that carry the error details. There is a common set of message types for APIs to use. */
  details?: Record<string, unknown>[];
  /** A developer-facing error message, which should be in English. Any user-facing error message should be localized and sent in the google.rpc.Status.details field, or localized by the client. */
  message?: string;
}
/** GoogleSearch tool type. Tool to support Google Search in Model. Powered by Google. */
declare interface GoogleSearch {
  /** Optional. The set of search types to enable. If not set, web search is enabled by default. */
  searchTypes?: SearchTypes;
  /** Optional. Sites with confidence level chosen & above this value will be blocked from the search results. This field is not supported in Gemini API. */
  blockingConfidence?: PhishBlockThreshold;
  /** Optional. List of domains to be excluded from the search results. The default limit is 2000 domains. Example: ["amazon.com", "facebook.com"]. This field is not supported in Gemini API. */
  excludeDomains?: string[];
  /** Optional. Filter search results to a specific time range. If customers set a start time, they must set an end time (and vice versa). This field is not supported in Vertex AI. */
  timeRangeFilter?: Interval;
}
/**
 * The arguments to pass to Google Search.
 */
declare interface GoogleSearchCallArguments {
  /**
   * Web search queries for the following-up web search.
   */
  queries?: Array<string>;
}
/**
 * Google Search call step.
 */
declare interface GoogleSearchCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  /**
   * Required. The arguments to pass to Google Search.
   */
  arguments: GoogleSearchCallStep.Arguments;
  type: 'google_search_call';
  /**
   * The type of search grounding enabled.
   */
  search_type?: 'web_search' | 'image_search' | 'enterprise_web_search';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace GoogleSearchCallStep {
  /**
   * Required. The arguments to pass to Google Search.
   */
  interface Arguments {
    /**
     * Web search queries for the following-up web search.
     */
    queries?: Array<string>;
  }
}
/**
 * The result of the Google Search.
 */
declare interface GoogleSearchResult {
  /**
   * Web content snippet that can be embedded in a web page or an app webview.
   */
  search_suggestions?: string;
}
/**
 * Google Search result step.
 */
declare interface GoogleSearchResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  /**
   * Required. The results of the Google Search.
   */
  result: Array<GoogleSearchResultStep.Result>;
  type: 'google_search_result';
  /**
   * Whether the Google Search resulted in an error.
   */
  is_error?: boolean;
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace GoogleSearchResultStep {
  /**
   * The result of the Google Search.
   */
  interface Result {
    /**
     * Web content snippet that can be embedded in a web page or an app webview.
     */
    search_suggestions?: string;
  }
}
/** Tool to retrieve public web data for grounding, powered by Google. */
declare interface GoogleSearchRetrieval {
  /** Specifies the dynamic retrieval configuration for the given source. */
  dynamicRetrievalConfig?: DynamicRetrievalConfig;
}
/** Represents a whole or partial calendar date, such as a birthday. The time of day and time zone are either specified elsewhere or are insignificant. The date is relative to the Gregorian Calendar. This can represent one of the following: * A full date, with non-zero year, month, and day values. * A month and day, with a zero year (for example, an anniversary). * A year on its own, with a zero month and a zero day. * A year and month, with a zero day (for example, a credit card expiration date). Related types: * google.type.TimeOfDay * google.type.DateTime * google.protobuf.Timestamp. This data type is not supported in Gemini API. */
declare interface GoogleTypeDate {
  /** Day of a month. Must be from 1 to 31 and valid for the year and month, or 0 to specify a year by itself or a year and month where the day isn't significant. */
  day?: number;
  /** Month of a year. Must be from 1 to 12, or 0 to specify a year without a month and day. */
  month?: number;
  /** Year of the date. Must be from 1 to 9999, or 0 to specify a date without a year. */
  year?: number;
}
/** A piece of evidence that supports a claim made by the model.

 This is used to show a citation for a claim made by the model. When grounding
 is enabled, the model returns a `GroundingChunk` that contains a reference to
 the source of the information. */
declare interface GroundingChunk {
  /** A grounding chunk from an image search result. See the `Image` message for details. */
  image?: GroundingChunkImage;
  /** A `Maps` chunk is a piece of evidence that comes from Google Maps.
     It contains information about a place, such as its name, address, and
   reviews. This is used to provide the user with rich, location-based
   information. */
  maps?: GroundingChunkMaps;
  /** A grounding chunk from a data source retrieved by a retrieval tool, such as Vertex AI Search. See the `RetrievedContext` message for details */
  retrievedContext?: GroundingChunkRetrievedContext;
  /** A grounding chunk from a web page, typically from Google Search. See the `Web` message for details. */
  web?: GroundingChunkWeb;
}
/** User provided metadata about the GroundingFact. This data type is not supported in Vertex AI. */
declare interface GroundingChunkCustomMetadata {
  /** The key of the metadata. */
  key?: string;
  /** Optional. The numeric value of the metadata. The expected range for this value depends on the specific `key` used. */
  numericValue?: number;
  /** Optional. A list of string values for the metadata. */
  stringListValue?: GroundingChunkStringList;
  /** Optional. The string value of the metadata. */
  stringValue?: string;
}
/** An `Image` chunk is a piece of evidence that comes from an image search result. It contains the URI of the image search result and the URI of the image. This is used to provide the user with a link to the source of the information. */
declare interface GroundingChunkImage {
  /** The URI of the image search result page. */
  sourceUri?: string;
  /** The URI of the image. */
  imageUri?: string;
  /** The title of the image search result page. */
  title?: string;
  /** The domain of the image search result page. */
  domain?: string;
}
/** A `Maps` chunk is a piece of evidence that comes from Google Maps.

 It contains information about a place, such as its name, address, and reviews.
 This is used to provide the user with rich, location-based information. */
declare interface GroundingChunkMaps {
  /** The sources that were used to generate the place answer.
     This includes review snippets and photos that were used to generate the
   answer, as well as URIs to flag content. */
  placeAnswerSources?: GroundingChunkMapsPlaceAnswerSources;
  /** This Place's resource name, in `places/{place_id}` format.
     This can be used to look up the place in the Google Maps API. */
  placeId?: string;
  /** The text of the place answer. */
  text?: string;
  /** The title of the place. */
  title?: string;
  /** The URI of the place. */
  uri?: string;
  /** Output only. Route information. */
  route?: GroundingChunkMapsRoute;
}
/** The sources that were used to generate the place answer.

 This includes review snippets and photos that were used to generate the
 answer, as well as URIs to flag content. */
declare interface GroundingChunkMapsPlaceAnswerSources {
  /** Snippets of reviews that were used to generate the answer. */
  reviewSnippet?: GroundingChunkMapsPlaceAnswerSourcesReviewSnippet[];
  /** A link where users can flag a problem with the generated answer. */
  flagContentUri?: string;
  /** Snippets of reviews that were used to generate the answer. */
  reviewSnippets?: GroundingChunkMapsPlaceAnswerSourcesReviewSnippet[];
}
/** Author attribution for a photo or review. */
declare interface GroundingChunkMapsPlaceAnswerSourcesAuthorAttribution {
  /** Name of the author of the Photo or Review. */
  displayName?: string;
  /** Profile photo URI of the author of the Photo or Review. */
  photoUri?: string;
  /** URI of the author of the Photo or Review. */
  uri?: string;
}
/** Encapsulates a review snippet. */
declare interface GroundingChunkMapsPlaceAnswerSourcesReviewSnippet {
  /** This review's author. */
  authorAttribution?: GroundingChunkMapsPlaceAnswerSourcesAuthorAttribution;
  /** A link where users can flag a problem with the review. */
  flagContentUri?: string;
  /** A link to show the review on Google Maps. */
  googleMapsUri?: string;
  /** A string of formatted recent time, expressing the review time relative to the current time in a form appropriate for the language and country. */
  relativePublishTimeDescription?: string;
  /** A reference representing this place review which may be used to look up this place review again. */
  review?: string;
  /** Id of the review referencing the place. */
  reviewId?: string;
  /** Title of the review. */
  title?: string;
}
/** Route information from Google Maps. This data type is not supported in Gemini API. */
declare interface GroundingChunkMapsRoute {
  /** The total distance of the route, in meters. */
  distanceMeters?: number;
  /** The total duration of the route. */
  duration?: string;
  /** An encoded polyline of the route. See https://developers.google.com/maps/documentation/utilities/polylinealgorithm */
  encodedPolyline?: string;
}
/** Context retrieved from a data source to ground the model's response. This is used when a retrieval tool fetches information from a user-provided corpus or a public dataset. */
declare interface GroundingChunkRetrievedContext {
  /** Output only. The full resource name of the referenced Vertex AI Search document. This is used to identify the specific document that was retrieved. The format is `projects/{project}/locations/{location}/collections/{collection}/dataStores/{data_store}/branches/{branch}/documents/{document}`. This field is not supported in Gemini API. */
  documentName?: string;
  /** Additional context for a Retrieval-Augmented Generation (RAG) retrieval result. This is populated only when the RAG retrieval tool is used. This field is not supported in Gemini API. */
  ragChunk?: RagChunk;
  /** The content of the retrieved data source. */
  text?: string;
  /** The title of the retrieved data source. */
  title?: string;
  /** The URI of the retrieved data source. */
  uri?: string;
  /** Optional. User-provided metadata about the retrieved context. This field is not supported in Vertex AI. */
  customMetadata?: GroundingChunkCustomMetadata[];
  /** Optional. Name of the `FileSearchStore` containing the document. Example: `fileSearchStores/123`. This field is not supported in Vertex AI. */
  fileSearchStore?: string;
  /** Optional. Page number of the retrieved context, if applicable. This field is not supported in Vertex AI. */
  pageNumber?: number;
  /** Optional. The media blob resource name for multimodal file search results. Format: fileSearchStores/{file_search_store_id}/media/{blob_id}. This field is not supported in Vertex AI. */
  mediaId?: string;
}
/** A list of string values. This data type is not supported in Vertex AI. */
declare interface GroundingChunkStringList {
  /** The string values of the list. */
  values?: string[];
}
/** A `Web` chunk is a piece of evidence that comes from a web page. It contains the URI of the web page, the title of the page, and the domain of the page. This is used to provide the user with a link to the source of the information. */
declare interface GroundingChunkWeb {
  /** The domain of the web page that contains the evidence. This can be used to filter out low-quality sources. This field is not supported in Gemini API. */
  domain?: string;
  /** The title of the web page that contains the evidence. */
  title?: string;
  /** The URI of the web page that contains the evidence. */
  uri?: string;
}
/** Information for various kinds of grounding. */
declare interface GroundingMetadata {
  /** Optional. The image search queries that were used to generate the content. This field is populated only when the grounding source is Google Search with the Image Search search_type enabled. */
  imageSearchQueries?: string[];
  /** A list of supporting references retrieved from the grounding
   source. This field is populated when the grounding source is Google
   Search, Vertex AI Search, or Google Maps.
   */
  groundingChunks?: GroundingChunk[];
  /** List of grounding support. */
  groundingSupports?: GroundingSupport[];
  /** Metadata related to retrieval in the grounding flow. */
  retrievalMetadata?: RetrievalMetadata;
  /** Optional. Google search entry for the following-up web
   searches. */
  searchEntryPoint?: SearchEntryPoint;
  /** Web search queries for the following-up web search. */
  webSearchQueries?: string[];
  /** Optional. Output only. A token that can be used to render a Google Maps widget with the contextual data. This field is populated only when the grounding source is Google Maps. */
  googleMapsWidgetContextToken?: string;
  /** Optional. The queries that were executed by the retrieval tools. This field is populated only when the grounding source is a retrieval tool, such as Vertex AI Search. This field is not supported in Gemini API. */
  retrievalQueries?: string[];
  /** Optional. Output only. A list of URIs that can be used to flag a place or review for inappropriate content. This field is populated only when the grounding source is Google Maps. This field is not supported in Gemini API. */
  sourceFlaggingUris?: GroundingMetadataSourceFlaggingUri[];
}
/** A URI that can be used to flag a place or review for inappropriate content. This is populated only when the grounding source is Google Maps. This data type is not supported in Gemini API. */
declare interface GroundingMetadataSourceFlaggingUri {
  /** The URI that can be used to flag the content. */
  flagContentUri?: string;
  /** The ID of the place or review. */
  sourceId?: string;
}
/** Grounding support. */
declare interface GroundingSupport {
  /** Confidence score of the support references.
     Ranges from 0 to 1. 1 is the most confident. This list must have the
   same size as the grounding_chunk_indices. */
  confidenceScores?: number[];
  /** A list of indices (into 'grounding_chunk') specifying the
   citations associated with the claim. For instance [1,3,4] means that
   grounding_chunk[1], grounding_chunk[3], grounding_chunk[4] are the
   retrieved content attributed to the claim. */
  groundingChunkIndices?: number[];
  /** Segment of the content this support belongs to. */
  segment?: Segment;
  /** Indices into the `rendered_parts` field of the `GroundingMetadata` message. These indices specify which rendered parts are associated with this support message. */
  renderedParts?: number[];
}
/** The method for blocking content. If not specified, the default behavior is to use the probability score. This enum is not supported in Gemini API. */
declare enum HarmBlockMethod {
  /**
   * The harm block method is unspecified.
   */
  HARM_BLOCK_METHOD_UNSPECIFIED = "HARM_BLOCK_METHOD_UNSPECIFIED",
  /**
   * The harm block method uses both probability and severity scores.
   */
  SEVERITY = "SEVERITY",
  /**
   * The harm block method uses the probability score.
   */
  PROBABILITY = "PROBABILITY"
}
/** The threshold for blocking content. If the harm probability exceeds this threshold, the content will be blocked. */
declare enum HarmBlockThreshold {
  /**
   * The harm block threshold is unspecified.
   */
  HARM_BLOCK_THRESHOLD_UNSPECIFIED = "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
  /**
   * Block content with a low harm probability or higher.
   */
  BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE",
  /**
   * Block content with a medium harm probability or higher.
   */
  BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE",
  /**
   * Block content with a high harm probability.
   */
  BLOCK_ONLY_HIGH = "BLOCK_ONLY_HIGH",
  /**
   * Do not block any content, regardless of its harm probability.
   */
  BLOCK_NONE = "BLOCK_NONE",
  /**
   * Turn off the safety filter entirely.
   */
  OFF = "OFF"
}
/** The harm category to be blocked. */
declare enum HarmCategory {
  /**
   * Default value. This value is unused.
   */
  HARM_CATEGORY_UNSPECIFIED = "HARM_CATEGORY_UNSPECIFIED",
  /**
   * Abusive, threatening, or content intended to bully, torment, or ridicule.
   */
  HARM_CATEGORY_HARASSMENT = "HARM_CATEGORY_HARASSMENT",
  /**
   * Content that promotes violence or incites hatred against individuals or groups based on certain attributes.
   */
  HARM_CATEGORY_HATE_SPEECH = "HARM_CATEGORY_HATE_SPEECH",
  /**
   * Content that contains sexually explicit material.
   */
  HARM_CATEGORY_SEXUALLY_EXPLICIT = "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  /**
   * Content that promotes, facilitates, or enables dangerous activities.
   */
  HARM_CATEGORY_DANGEROUS_CONTENT = "HARM_CATEGORY_DANGEROUS_CONTENT",
  /**
   * Deprecated: Election filter is not longer supported. The harm category is civic integrity.
   */
  HARM_CATEGORY_CIVIC_INTEGRITY = "HARM_CATEGORY_CIVIC_INTEGRITY",
  /**
   * Images that contain hate speech. This enum value is not supported in Gemini API.
   */
  HARM_CATEGORY_IMAGE_HATE = "HARM_CATEGORY_IMAGE_HATE",
  /**
   * Images that contain dangerous content. This enum value is not supported in Gemini API.
   */
  HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT = "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT",
  /**
   * Images that contain harassment. This enum value is not supported in Gemini API.
   */
  HARM_CATEGORY_IMAGE_HARASSMENT = "HARM_CATEGORY_IMAGE_HARASSMENT",
  /**
   * Images that contain sexually explicit content. This enum value is not supported in Gemini API.
   */
  HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT = "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT",
  /**
   * Prompts designed to bypass safety filters. This enum value is not supported in Gemini API.
   */
  HARM_CATEGORY_JAILBREAK = "HARM_CATEGORY_JAILBREAK"
}
/** Output only. The probability of harm for this category. */
declare enum HarmProbability {
  /**
   * The harm probability is unspecified.
   */
  HARM_PROBABILITY_UNSPECIFIED = "HARM_PROBABILITY_UNSPECIFIED",
  /**
   * The harm probability is negligible.
   */
  NEGLIGIBLE = "NEGLIGIBLE",
  /**
   * The harm probability is low.
   */
  LOW = "LOW",
  /**
   * The harm probability is medium.
   */
  MEDIUM = "MEDIUM",
  /**
   * The harm probability is high.
   */
  HIGH = "HIGH"
}
/** Output only. The severity of harm for this category. This enum is not supported in Gemini API. */
declare enum HarmSeverity {
  /**
   * The harm severity is unspecified.
   */
  HARM_SEVERITY_UNSPECIFIED = "HARM_SEVERITY_UNSPECIFIED",
  /**
   * The harm severity is negligible.
   */
  HARM_SEVERITY_NEGLIGIBLE = "HARM_SEVERITY_NEGLIGIBLE",
  /**
   * The harm severity is low.
   */
  HARM_SEVERITY_LOW = "HARM_SEVERITY_LOW",
  /**
   * The harm severity is medium.
   */
  HARM_SEVERITY_MEDIUM = "HARM_SEVERITY_MEDIUM",
  /**
   * The harm severity is high.
   */
  HARM_SEVERITY_HIGH = "HARM_SEVERITY_HIGH"
}
declare type HeadersLike = Headers | readonly HeaderValue[][] | Record<string, HeaderValue | readonly HeaderValue[]> | undefined | null | NullableHeaders;
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare type HeaderValue = string | undefined | null;
/** The location of the API key. This enum is not supported in Gemini API. */
declare enum HttpElementLocation {
  HTTP_IN_UNSPECIFIED = "HTTP_IN_UNSPECIFIED",
  /**
   * Element is in the HTTP request query.
   */
  HTTP_IN_QUERY = "HTTP_IN_QUERY",
  /**
   * Element is in the HTTP request header.
   */
  HTTP_IN_HEADER = "HTTP_IN_HEADER",
  /**
   * Element is in the HTTP request path.
   */
  HTTP_IN_PATH = "HTTP_IN_PATH",
  /**
   * Element is in the HTTP request body.
   */
  HTTP_IN_BODY = "HTTP_IN_BODY",
  /**
   * Element is in the HTTP request cookie.
   */
  HTTP_IN_COOKIE = "HTTP_IN_COOKIE"
}
declare type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** HTTP options to be used in each of the requests. */
declare interface HttpOptions {
  /** The base URL for the AI platform service endpoint. */
  baseUrl?: string;
  /** The resource scope used to constructing the resource name when base_url is set */
  baseUrlResourceScope?: ResourceScope;
  /** Specifies the version of the API to use. */
  apiVersion?: string;
  /** Additional HTTP headers to be sent with the request. */
  headers?: Record<string, string>;
  /** Timeout for the request in milliseconds. */
  timeout?: number;
  /** Extra parameters to add to the request body.
   The structure must match the backend API's request structure.
   - Gemini Enterprise Agent Platform backend API docs: https://cloud.google.com/vertex-ai/docs/reference/rest
   - GeminiAPI backend API docs: https://ai.google.dev/api/rest */
  extraBody?: Record<string, unknown>;
  /** HTTP retry options for the request. */
  retryOptions?: HttpRetryOptions;
}
/**
 * Represents the necessary information to send a request to an API endpoint.
 * This interface defines the structure for constructing and executing HTTP
 * requests.
 */
declare interface HttpRequest {
  /**
   * URL path from the modules, this path is appended to the base API URL to
   * form the complete request URL.
   *
   * If you wish to set full URL, use httpOptions.baseUrl instead. Example to
   * set full URL in the request:
   *
   * const request: HttpRequest = {
   *   path: '',
   *   httpOptions: {
   *     baseUrl: 'https://<custom-full-url>',
   *     apiVersion: '',
   *   },
   *   httpMethod: 'GET',
   * };
   *
   * The result URL will be: https://<custom-full-url>
   *
   */
  path: string;
  /**
   * Optional query parameters to be appended to the request URL.
   */
  queryParams?: Record<string, string>;
  /**
   * Optional request body in json string or Blob format, GET request doesn't
   * need a request body.
   */
  body?: string | Blob;
  /**
   * The HTTP method to be used for the request.
   */
  httpMethod: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /**
   * Optional set of customizable configuration for HTTP requests.
   */
  httpOptions?: types.HttpOptions;
  /**
   * Optional abort signal which can be used to cancel the request.
   */
  abortSignal?: AbortSignal;
}
/** A wrapper class for the http response. */
declare class HttpResponse {
  /** Used to retain the processed HTTP headers in the response. */
  headers?: Record<string, string>;
  /**
   * The original http response.
   */
  responseInternal: Response;
  constructor(response: Response);
  json(): Promise<unknown>;
}
/** HTTP retry options to be used in each of the requests. */
declare interface HttpRetryOptions {
  /** Maximum number of attempts, including the original request.
   If 0 or 1, it means no retries. If not specified, default to 5. */
  attempts?: number;
}
/** An image. */
declare interface Image_2 {
  /** The Cloud Storage URI of the image. ``Image`` can contain a value
   for this field or the ``image_bytes`` field but not both. */
  gcsUri?: string;
  /** The image bytes data. ``Image`` can contain a value for this field
   or the ``gcs_uri`` field but not both.
   * @remarks Encoded as base64 string. */
  imageBytes?: string;
  /** The MIME type of the image. */
  mimeType?: string;
}
/** The image generation configuration to be used in GenerateContentConfig. */
declare interface ImageConfig {
  /** Aspect ratio of the generated images. Supported values are
   "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", and "21:9". */
  aspectRatio?: string;
  /** Optional. Specifies the size of generated images. Supported
   values are `1K`, `2K`, `4K`. If not specified, the model will use default
   value `1K`. */
  imageSize?: string;
  /** Controls the generation of people. Supported values are:
   ALLOW_ALL, ALLOW_ADULT, ALLOW_NONE. */
  personGeneration?: string;
  /** Optional. Controls whether prominent people (celebrities) generation is allowed. If used with personGeneration, personGeneration enum would take precedence. For instance, if ALLOW_NONE is set, all person generation would be blocked. If this field is unspecified, the default behavior is to allow prominent people. This field is not supported in Gemini API. */
  prominentPeople?: ProminentPeople;
  /** MIME type of the generated image. This field is not
   supported in Gemini API. */
  outputMimeType?: string;
  /** Compression quality of the generated image (for
   ``image/jpeg`` only). This field is not supported in Gemini API. */
  outputCompressionQuality?: number;
  /** Optional. The image output format for generated images. This field is not supported in Gemini API. */
  imageOutputOptions?: ImageConfigImageOutputOptions;
}
/**
 * The configuration for image interaction.
 */
declare interface ImageConfig_2 {
  aspect_ratio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' | '1:8' | '8:1' | '1:4' | '4:1';
  image_size?: '1K' | '2K' | '4K' | '512';
}
/** The image output format for generated images. This data type is not supported in Gemini API. */
declare interface ImageConfigImageOutputOptions {
  /** Optional. The compression quality of the output image. */
  compressionQuality?: number;
  /** Optional. The image format that the output should be saved as. */
  mimeType?: string;
}
/**
 * An image content block.
 */
declare interface ImageContent {
  type: 'image';
  /**
   * The image content.
   */
  data?: string;
  /**
   * The mime type of the image.
   */
  mime_type?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/heic' | 'image/heif' | 'image/gif' | 'image/bmp' | 'image/tiff';
  /**
   * The resolution of the media.
   */
  resolution?: 'low' | 'medium' | 'high' | 'ultra_high';
  /**
   * The URI of the image.
   */
  uri?: string;
}
/** Enum that specifies the language of the text in the prompt. */
declare enum ImagePromptLanguage {
  /**
   * Auto-detect the language.
   */
  auto = "auto",
  /**
   * English
   */
  en = "en",
  /**
   * Japanese
   */
  ja = "ja",
  /**
   * Korean
   */
  ko = "ko",
  /**
   * Hindi
   */
  hi = "hi",
  /**
   * Chinese
   */
  zh = "zh",
  /**
   * Portuguese
   */
  pt = "pt",
  /**
   * Spanish
   */
  es = "es"
}
/** Resize mode for the image input for video generation. */
declare enum ImageResizeMode {
  /**
   * Crop the image to fit the correct aspect ratio (so we lose parts
   of the image in the process).
   */
  CROP = "CROP",
  /**
   * Pad the image to fit the correct aspect ratio (so we don't lose
   any parts of the image in the process).
   */
  PAD = "PAD"
}
/**
 * Configuration for image output format.
 */
declare interface ImageResponseFormat {
  type: 'image';
  /**
   * The aspect ratio for the image output.
   */
  aspect_ratio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' | '1:8' | '8:1' | '1:4' | '4:1';
  /**
   * The delivery mode for the image output.
   */
  delivery?: 'inline' | 'uri';
  /**
   * The size of the image output.
   */
  image_size?: '512' | '1K' | '2K' | '4K';
  /**
   * The MIME type of the image output.
   */
  mime_type?: 'image/jpeg';
}
/** Image search for grounding and related configurations. */
declare interface ImageSearch {}
/** Optional parameters for importing a file. */
declare interface ImportFileConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** User provided custom metadata stored as key-value pairs used for querying. */
  customMetadata?: CustomMetadata[];
  /** Config for telling the service how to chunk the file. */
  chunkingConfig?: ChunkingConfig;
}
/** Long-running operation for importing a file to a FileSearchStore. */
declare class ImportFileOperation implements Operation<ImportFileResponse> {
  /** The server-assigned name, which is only unique within the same service that originally returns it. If you use the default HTTP mapping, the `name` should be a resource name ending with `operations/{unique_id}`. */
  name?: string;
  /** Service-specific metadata associated with the operation. It typically contains progress information and common metadata such as create time. Some services might not provide such metadata.  Any method that returns a long-running operation should document the metadata type, if any. */
  metadata?: Record<string, unknown>;
  /** If the value is `false`, it means the operation is still in progress. If `true`, the operation is completed, and either `error` or `response` is available. */
  done?: boolean;
  /** The error result of the operation in case of failure or cancellation. */
  error?: Record<string, unknown>;
  /** The result of the ImportFile operation, available when the operation is done. */
  response?: ImportFileResponse;
  /**
   * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
   */
  _fromAPIResponse({
    apiResponse,
    _isVertexAI
  }: OperationFromAPIResponseParameters): Operation<ImportFileResponse>;
  /** The full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Config for file_search_stores.import_file parameters. */
declare interface ImportFileParameters {
  /** The resource name of the FileSearchStore. Example: `fileSearchStores/my-file-search-store-123` */
  fileSearchStoreName: string;
  /** The name of the File API File to import. Example: `files/abc-123` */
  fileName: string;
  /** Optional parameters for the request. */
  config?: ImportFileConfig;
}
/** Response for ImportFile to import a File API file with a file search store. */
declare class ImportFileResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** The name of the FileSearchStore containing Documents. */
  parent?: string;
  /** The identifier for the Document imported. */
  documentName?: string;
}
/** Config for `inlined_embedding_responses` parameter. */
declare class InlinedEmbedContentResponse {
  /** Output only. The response to the request. */
  response?: SingleEmbedContentResponse;
  /** Output only. The error encountered while processing the request. */
  error?: JobError;
  /** Output only. The metadata associated with the request. */
  metadata?: Record<string, unknown>;
}
/** Config for inlined request. */
declare interface InlinedRequest {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model?: string;
  /** Content of the request.
   */
  contents?: ContentListUnion;
  /** The metadata to be associated with the request. */
  metadata?: Record<string, string>;
  /** Configuration that contains optional model parameters.
   */
  config?: GenerateContentConfig;
}
/** Config for `inlined_responses` parameter. */
declare class InlinedResponse {
  /** The response to the request.
   */
  response?: GenerateContentResponse;
  /** The metadata to be associated with the request. */
  metadata?: Record<string, string>;
  /** The error encountered while processing the request.
   */
  error?: JobError;
}
/**
 * The Interaction resource.
 */
declare interface Interaction {
  /**
   * Required. Output only. A unique identifier for the interaction completion.
   */
  id: string;
  /**
   * Required. Output only. The time at which the response was created in ISO 8601
   * format (YYYY-MM-DDThh:mm:ssZ).
   */
  created: string;
  /**
   * Required. Output only. The status of the interaction.
   */
  status: 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'budget_exceeded';
  /**
   * Required. Output only. The steps that make up the interaction.
   */
  steps: Array<Step>;
  /**
   * Required. Output only. The time at which the response was last updated in ISO
   * 8601 format (YYYY-MM-DDThh:mm:ssZ).
   */
  updated: string;
  /**
   * The name of the `Agent` used for generating the interaction.
   */
  agent?: 'deep-research-pro-preview-12-2025' | 'deep-research-preview-04-2026' | 'deep-research-max-preview-04-2026' | (string & {});
  /**
   * Configuration parameters for the agent interaction.
   */
  agent_config?: DynamicAgentConfig | DeepResearchAgentConfig;
  /**
   * The environment configuration for the interaction. Can be an object specifying
   * remote environment sources or a string referencing an existing environment ID.
   */
  environment?: string | Environment_2;
  /**
   * Output only. The environment ID for the interaction. Only populated if
   * environment config is set in the request.
   */
  environment_id?: string;
  /**
   * The input for the interaction.
   */
  input?: string | Array<Step> | Array<Content_2> | TextContent | ImageContent | AudioContent | DocumentContent | VideoContent;
  /**
   * The name of the `Model` used for generating the interaction.
   */
  model?: Model_2;
  /**
   * The ID of the previous interaction, if any.
   */
  previous_interaction_id?: string;
  /**
   * Enforces that the generated response is a JSON object that complies with the
   * JSON schema specified in this field.
   */
  response_format?: Array<AudioResponseFormat | TextResponseFormat | ImageResponseFormat | unknown> | AudioResponseFormat | TextResponseFormat | ImageResponseFormat | unknown;
  /**
   * @deprecated The mime type of the response. This is required if response_format
   * is set.
   */
  response_mime_type?: string;
  /**
   * The requested modalities of the response (TEXT, IMAGE, AUDIO).
   */
  response_modalities?: Array<'text' | 'image' | 'audio' | 'video' | 'document'>;
  /**
   * @deprecated Output only. The role of the interaction.
   */
  role?: string;
  /**
   * The service tier for the interaction.
   */
  service_tier?: 'flex' | 'standard' | 'priority';
  /**
   * System instruction for the interaction.
   */
  system_instruction?: string;
  /**
   * A list of tool declarations the model may call during interaction.
   */
  tools?: Array<Tool_2>;
  /**
   * Output only. Statistics on the interaction request's token usage.
   */
  usage?: Usage;
  /**
   * Optional. Webhook configuration for receiving notifications when the interaction
   * completes.
   */
  webhook_config?: WebhookConfig_2;
  /**
   * Concatenated text from the last model output in response to the current request.
   *
   * Note: this is added by the SDK.
   */
  output_text?: string;
  /**
   * The last image generated by the model in response to the current request.
   *
   * Note: this is added by the SDK.
   */
  output_image?: ImageContent;
  /**
   * The last audio generated by the model in response to the current request.
   *
   * Note: this is added by the SDK.
   */
  output_audio?: AudioContent;
  /**
   * The last video generated by the model in response to the current request.
   *
   * Note: this is added by the SDK.
   */
  output_video?: VideoContent;
}
declare interface InteractionCancelParams {
  /**
   * Which version of the API to use.
   */
  api_version?: string;
}
declare interface InteractionCompletedEvent {
  event_type: 'interaction.completed';
  /**
   * Required. The completed interaction with empty outputs to reduce the payload
   * size. Use the preceding ContentDelta events for the actual output.
   */
  interaction: Interaction;
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: InteractionCompletedEvent.Metadata;
}
declare namespace InteractionCompletedEvent {
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
declare interface InteractionCreatedEvent {
  event_type: 'interaction.created';
  /**
   * The Interaction resource.
   */
  interaction: Interaction;
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: InteractionCreatedEvent.Metadata;
}
declare namespace InteractionCreatedEvent {
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
declare type InteractionCreateParams = CreateModelInteractionParamsNonStreaming | CreateModelInteractionParamsStreaming | CreateAgentInteractionParamsNonStreaming | CreateAgentInteractionParamsStreaming;
declare interface InteractionDeleteParams {
  /**
   * Which version of the API to use.
   */
  api_version?: string;
}
declare type InteractionDeleteResponse = unknown;
declare type InteractionGetParams = InteractionGetParamsNonStreaming | InteractionGetParamsStreaming;
declare namespace InteractionGetParams {
  type InteractionGetParamsNonStreaming = InteractionsAPI.InteractionGetParamsNonStreaming;
  type InteractionGetParamsStreaming = InteractionsAPI.InteractionGetParamsStreaming;
}
declare interface InteractionGetParamsBase {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Query param: If set to true, includes the input in the response.
   */
  include_input?: boolean;
  /**
   * Query param: Optional. If set, resumes the interaction stream from the next
   * chunk after the event marked by the event id. Can only be used if `stream` is
   * true.
   */
  last_event_id?: string;
  /**
   * Query param: If set to true, the generated content will be streamed
   * incrementally.
   */
  stream?: boolean;
}
declare interface InteractionGetParamsNonStreaming extends InteractionGetParamsBase {
  /**
   * Query param: If set to true, the generated content will be streamed
   * incrementally.
   */
  stream?: false;
}
declare interface InteractionGetParamsStreaming extends InteractionGetParamsBase {
  /**
   * Query param: If set to true, the generated content will be streamed
   * incrementally.
   */
  stream: true;
}
declare class Interactions extends BaseInteractions {}
declare namespace Interactions {
  export { type AllowedTools, type Annotation, type AudioContent, type AudioResponseFormat, type CodeExecutionCallArguments, type CodeExecutionCallStep, type CodeExecutionResultStep, type Content_2 as Content, type DeepResearchAgentConfig, type DocumentContent, type DynamicAgentConfig, type Environment_2 as Environment, type ErrorEvent_2 as ErrorEvent, type FileCitation, type FileSearchCallStep, type FileSearchResultStep, type Function_2 as Function, type FunctionCallStep, type FunctionResultStep, type GenerationConfig_2 as GenerationConfig, type GoogleMapsCallArguments, type GoogleMapsCallStep, type GoogleMapsResult, type GoogleMapsResultStep, type GoogleSearchCallArguments, type GoogleSearchCallStep, type GoogleSearchResult, type GoogleSearchResultStep, type ImageConfig_2 as ImageConfig, type ImageContent, type ImageResponseFormat, type Interaction, type InteractionCompletedEvent, type InteractionCreatedEvent, type InteractionSSEEvent, type InteractionStatusUpdate, type MCPServerToolCallStep, type MCPServerToolResultStep, type Model_2 as Model, type ModelOutputStep, type PlaceCitation, type SpeechConfig_2 as SpeechConfig, type Step, type StepDelta, type StepStart, type StepStop, type TextContent, type TextResponseFormat, type ThinkingLevel_2 as ThinkingLevel, type ThoughtStep, type Tool_2 as Tool, type ToolChoiceConfig, type ToolChoiceType, type URLCitation, type URLContextCallArguments, type URLContextCallStep, type URLContextResult, type URLContextResultStep, type Usage, type UserInputStep, type VideoContent, type WebhookConfig_2 as WebhookConfig, type InteractionDeleteResponse, type InteractionCreateParams, type CreateModelInteractionParamsNonStreaming, type CreateModelInteractionParamsStreaming, type CreateAgentInteractionParamsNonStreaming, type CreateAgentInteractionParamsStreaming, type InteractionDeleteParams, type InteractionCancelParams, type InteractionGetParams, type InteractionGetParamsNonStreaming, type InteractionGetParamsStreaming };
}
declare namespace InteractionsAPI {
  export { BaseInteractions, Interactions, AllowedTools, Annotation, AudioContent, AudioResponseFormat, CodeExecutionCallArguments, CodeExecutionCallStep, CodeExecutionResultStep, Content_2 as Content, DeepResearchAgentConfig, DocumentContent, DynamicAgentConfig, Environment_2 as Environment, ErrorEvent_2 as ErrorEvent, FileCitation, FileSearchCallStep, FileSearchResultStep, Function_2 as Function, FunctionCallStep, FunctionResultStep, GenerationConfig_2 as GenerationConfig, GoogleMapsCallArguments, GoogleMapsCallStep, GoogleMapsResult, GoogleMapsResultStep, GoogleSearchCallArguments, GoogleSearchCallStep, GoogleSearchResult, GoogleSearchResultStep, ImageConfig_2 as ImageConfig, ImageContent, ImageResponseFormat, Interaction, InteractionCompletedEvent, InteractionCreatedEvent, InteractionSSEEvent, InteractionStatusUpdate, MCPServerToolCallStep, MCPServerToolResultStep, Model_2 as Model, ModelOutputStep, PlaceCitation, SpeechConfig_2 as SpeechConfig, Step, StepDelta, StepStart, StepStop, TextContent, TextResponseFormat, ThinkingLevel_2 as ThinkingLevel, ThoughtStep, Tool_2 as Tool, ToolChoiceConfig, ToolChoiceType, URLCitation, URLContextCallArguments, URLContextCallStep, URLContextResult, URLContextResultStep, Usage, UserInputStep, VideoContent, WebhookConfig_2 as WebhookConfig, InteractionDeleteResponse, InteractionCreateParams, BaseCreateModelInteractionParams, BaseCreateAgentInteractionParams, CreateModelInteractionParamsNonStreaming, CreateModelInteractionParamsStreaming, CreateAgentInteractionParamsNonStreaming, CreateAgentInteractionParamsStreaming, InteractionDeleteParams, InteractionCancelParams, InteractionGetParams, InteractionGetParamsBase, InteractionGetParamsNonStreaming, InteractionGetParamsStreaming };
}
declare type InteractionSSEEvent = InteractionCreatedEvent | InteractionCompletedEvent | InteractionStatusUpdate | ErrorEvent_2 | StepStart | StepDelta | StepStop;
declare interface InteractionStatusUpdate {
  event_type: 'interaction.status_update';
  interaction_id: string;
  status: 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'budget_exceeded';
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: InteractionStatusUpdate.Metadata;
}
declare namespace InteractionStatusUpdate {
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
/** Parameters for the private _Register method. */
declare interface InternalRegisterFilesParameters {
  /** The Google Cloud Storage URIs to register. Example: `gs://bucket/object`. */
  uris: string[];
  /** Used to override the default configuration. */
  config?: RegisterFilesConfig;
}
declare class InternalServerError extends APIError<number, Headers> {}
/** Represents a time interval, encoded as a Timestamp start (inclusive) and a Timestamp end (exclusive). The start must be less than or equal to the end. When the start equals the end, the interval is empty (matches no time). When both start and end are unspecified, the interval matches any time. */
declare interface Interval {
  /** Optional. Exclusive end of the interval. If specified, a Timestamp matching this interval will have to be before the end. */
  endTime?: string;
  /** Optional. Inclusive start of the interval. If specified, a Timestamp matching this interval will have to be the same or after the start. */
  startTime?: string;
}
/** Job error. */
declare interface JobError {
  /** A list of messages that carry the error details. There is a common set of message types for APIs to use. */
  details?: string[];
  /** The status code. */
  code?: number;
  /** A developer-facing error message, which should be in English. Any user-facing error message should be localized and sent in the `details` field. */
  message?: string;
}
/** Job state. */
declare enum JobState {
  /**
   * The job state is unspecified.
   */
  JOB_STATE_UNSPECIFIED = "JOB_STATE_UNSPECIFIED",
  /**
   * The job has been just created or resumed and processing has not yet begun.
   */
  JOB_STATE_QUEUED = "JOB_STATE_QUEUED",
  /**
   * The service is preparing to run the job.
   */
  JOB_STATE_PENDING = "JOB_STATE_PENDING",
  /**
   * The job is in progress.
   */
  JOB_STATE_RUNNING = "JOB_STATE_RUNNING",
  /**
   * The job completed successfully.
   */
  JOB_STATE_SUCCEEDED = "JOB_STATE_SUCCEEDED",
  /**
   * The job failed.
   */
  JOB_STATE_FAILED = "JOB_STATE_FAILED",
  /**
   * The job is being cancelled. From this state the job may only go to either `JOB_STATE_SUCCEEDED`, `JOB_STATE_FAILED` or `JOB_STATE_CANCELLED`.
   */
  JOB_STATE_CANCELLING = "JOB_STATE_CANCELLING",
  /**
   * The job has been cancelled.
   */
  JOB_STATE_CANCELLED = "JOB_STATE_CANCELLED",
  /**
   * The job has been stopped, and can be resumed.
   */
  JOB_STATE_PAUSED = "JOB_STATE_PAUSED",
  /**
   * The job has expired.
   */
  JOB_STATE_EXPIRED = "JOB_STATE_EXPIRED",
  /**
   * The job is being updated. Only jobs in the `JOB_STATE_RUNNING` state can be updated. After updating, the job goes back to the `JOB_STATE_RUNNING` state.
   */
  JOB_STATE_UPDATING = "JOB_STATE_UPDATING",
  /**
   * The job is partially succeeded, some results may be missing due to errors.
   */
  JOB_STATE_PARTIALLY_SUCCEEDED = "JOB_STATE_PARTIALLY_SUCCEEDED"
}
/** Programming language of the `code`. */
declare enum Language {
  /**
   * Unspecified language. This value should not be used.
   */
  LANGUAGE_UNSPECIFIED = "LANGUAGE_UNSPECIFIED",
  /**
   * Python >= 3.10, with numpy and simpy available.
   */
  PYTHON = "PYTHON"
}
/** An object that represents a latitude/longitude pair. This is expressed as a pair of doubles to represent degrees latitude and degrees longitude. Unless specified otherwise, this object must conform to the WGS84 standard. Values must be within normalized ranges. */
declare interface LatLng {
  /** The latitude in degrees. It must be in the range [-90.0, +90.0]. */
  latitude?: number;
  /** The longitude in degrees. It must be in the range [-180.0, +180.0]. */
  longitude?: number;
}
/** Config for optional parameters. */
declare interface ListBatchJobsConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
  filter?: string;
}
/** Config for batches.list parameters. */
declare interface ListBatchJobsParameters {
  config?: ListBatchJobsConfig;
}
/** Config for batches.list return value. */
declare class ListBatchJobsResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  nextPageToken?: string;
  batchJobs?: BatchJob[];
}
/** Config for caches.list method. */
declare interface ListCachedContentsConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
}
/** Parameters for caches.list method. */
declare interface ListCachedContentsParameters {
  /** Configuration that contains optional parameters.
   */
  config?: ListCachedContentsConfig;
}
declare class ListCachedContentsResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  nextPageToken?: string;
  /** List of cached contents.
   */
  cachedContents?: CachedContent[];
}
/** Config for optional parameters. */
declare interface ListDocumentsConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
}
/** Config for documents.list parameters. */
declare interface ListDocumentsParameters {
  /** The resource name of the FileSearchStores. Example: `fileSearchStore/file-search-store-foo` */
  parent: string;
  config?: ListDocumentsConfig;
}
/** Config for documents.list return value. */
declare class ListDocumentsResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** A token, which can be sent as `page_token` to retrieve the next page. If this field is omitted, there are no more pages. */
  nextPageToken?: string;
  /** The returned `Document`s. */
  documents?: Document_2[];
}
declare interface ListFilesConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
}
/** Optional parameters for listing FileSearchStore. */
declare interface ListFileSearchStoresConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
}
/** Config for file_search_stores.list parameters. */
declare interface ListFileSearchStoresParameters {
  /** Optional parameters for the list request. */
  config?: ListFileSearchStoresConfig;
}
/** Config for file_search_stores.list return value. */
declare class ListFileSearchStoresResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** A token, which can be sent as `page_token` to retrieve the next page. If this field is omitted, there are no more pages. */
  nextPageToken?: string;
  /** The returned file search stores. */
  fileSearchStores?: FileSearchStore[];
}
/** Generates the parameters for the list method. */
declare interface ListFilesParameters {
  /** Used to override the default configuration. */
  config?: ListFilesConfig;
}
/** Response for the list files method. */
declare class ListFilesResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** A token that can be sent as a `page_token` into a subsequent `ListFiles` call. */
  nextPageToken?: string;
  /** The list of `File`s. */
  files?: File_2[];
}
declare interface ListModelsConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
  filter?: string;
  /** Set true to list base models, false to list tuned models. */
  queryBase?: boolean;
}
declare interface ListModelsParameters {
  config?: ListModelsConfig;
}
declare class ListModelsResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  nextPageToken?: string;
  models?: Model[];
}
/** Configuration for the list tuning jobs method. */
declare interface ListTuningJobsConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  pageSize?: number;
  pageToken?: string;
  filter?: string;
}
/** Parameters for the list tuning jobs method. */
declare interface ListTuningJobsParameters {
  config?: ListTuningJobsConfig;
}
/** Response for the list tuning jobs method. */
declare class ListTuningJobsResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** A token to retrieve the next page of results. Pass this token in a subsequent [GenAiTuningService.ListTuningJobs] call to retrieve the next page of results. */
  nextPageToken?: string;
  /** The tuning jobs that match the request. */
  tuningJobs?: TuningJob[];
}
/**
 Live class encapsulates the configuration for live interaction with the
 Generative Language API. It embeds ApiClient for general API settings.

 @experimental
 */
declare class Live {
  private readonly apiClient;
  private readonly auth;
  private readonly webSocketFactory;
  readonly music: LiveMusic;
  constructor(apiClient: ApiClient, auth: Auth, webSocketFactory: WebSocketFactory);
  /**
   Establishes a connection to the specified model with the given
   configuration and returns a Session object representing that connection.
     @experimental Built-in MCP support is an experimental feature, may change in
   future versions.
     @remarks
     @param params - The parameters for establishing a connection to the model.
   @return A live session.
     @example
   ```ts
   let model: string;
   if (GOOGLE_GENAI_USE_VERTEXAI) {
   model = 'gemini-2.0-flash-live-preview-04-09';
   } else {
   model = 'gemini-live-2.5-flash-preview';
   }
   const session = await ai.live.connect({
   model: model,
   config: {
   responseModalities: [Modality.AUDIO],
   },
   callbacks: {
   onopen: () => {
   console.log('Connected to the socket.');
   },
   onmessage: (e: MessageEvent) => {
   console.log('Received message from the server: %s\n', debug(e.data));
   },
   onerror: (e: ErrorEvent) => {
   console.log('Error occurred: %s\n', debug(e.error));
   },
   onclose: (e: CloseEvent) => {
   console.log('Connection closed.');
   },
   },
   });
   ```
   */
  connect(params: types.LiveConnectParameters): Promise<Session>;
  private isCallableTool;
}
/** Callbacks for the live API. */
declare interface LiveCallbacks {
  /**
   * Called when the websocket connection is established.
   */
  onopen?: (() => void) | null;
  /**
   * Called when a message is received from the server.
   */
  onmessage: (e: LiveServerMessage) => void;
  /**
   * Called when an error occurs.
   */
  onerror?: ((e: ErrorEvent) => void) | null;
  /**
   * Called when the websocket connection is closed.
   */
  onclose?: ((e: CloseEvent) => void) | null;
}
/** Incremental update of the current conversation delivered from the client.

 All the content here will unconditionally be appended to the conversation
 history and used as part of the prompt to the model to generate content.

 A message here will interrupt any current model generation. */
declare interface LiveClientContent {
  /** The content appended to the current conversation with the model.
     For single-turn queries, this is a single instance. For multi-turn
   queries, this is a repeated field that contains conversation history and
   latest request.
   */
  turns?: Content[];
  /** If true, indicates that the server content generation should start with
   the currently accumulated prompt. Otherwise, the server will await
   additional messages before starting generation. */
  turnComplete?: boolean;
}
/** Messages sent by the client in the API call. */
declare interface LiveClientMessage {
  /** Message to be sent by the system when connecting to the API. SDK users should not send this message. */
  setup?: LiveClientSetup;
  /** Incremental update of the current conversation delivered from the client. */
  clientContent?: LiveClientContent;
  /** User input that is sent in real time. */
  realtimeInput?: LiveClientRealtimeInput;
  /** Response to a `ToolCallMessage` received from the server. */
  toolResponse?: LiveClientToolResponse;
}
/** User input that is sent in real time.

 This is different from `LiveClientContent` in a few ways:

 - Can be sent continuously without interruption to model generation.
 - If there is a need to mix data interleaved across the
 `LiveClientContent` and the `LiveClientRealtimeInput`, server attempts to
 optimize for best response, but there are no guarantees.
 - End of turn is not explicitly specified, but is rather derived from user
 activity (for example, end of speech).
 - Even before the end of turn, the data is processed incrementally
 to optimize for a fast start of the response from the model.
 - Is always assumed to be the user's input (cannot be used to populate
 conversation history). */
declare interface LiveClientRealtimeInput {
  /** Inlined bytes data for media input. */
  mediaChunks?: Blob_2[];
  /** The realtime audio input stream. */
  audio?: Blob_2;
  /**
   Indicates that the audio stream has ended, e.g. because the microphone was
   turned off.
     This should only be sent when automatic activity detection is enabled
   (which is the default).
     The client can reopen the stream by sending an audio message.
   */
  audioStreamEnd?: boolean;
  /** The realtime video input stream. */
  video?: Blob_2;
  /** The realtime text input stream. */
  text?: string;
  /** Marks the start of user activity. */
  activityStart?: ActivityStart;
  /** Marks the end of user activity. */
  activityEnd?: ActivityEnd;
}
/** Message contains configuration that will apply for the duration of the streaming session. */
declare interface LiveClientSetup {
  /**
   The fully qualified name of the publisher model or tuned model endpoint to
   use.
   */
  model?: string;
  /** The generation configuration for the session.
   Note: only a subset of fields are supported.
   */
  generationConfig?: GenerationConfig;
  /** The user provided system instructions for the model.
   Note: only text should be used in parts and content in each part will be
   in a separate paragraph. */
  systemInstruction?: ContentUnion;
  /**  A list of `Tools` the model may use to generate the next response.
     A `Tool` is a piece of code that enables the system to interact with
   external systems to perform an action, or set of actions, outside of
   knowledge and scope of the model. */
  tools?: ToolListUnion;
  /** Configures the realtime input behavior in BidiGenerateContent. */
  realtimeInputConfig?: RealtimeInputConfig;
  /** Configures session resumption mechanism.
     If included server will send SessionResumptionUpdate messages. */
  sessionResumption?: SessionResumptionConfig;
  /** Configures context window compression mechanism.
     If included, server will compress context window to fit into given length. */
  contextWindowCompression?: ContextWindowCompressionConfig;
  /** The transcription of the input aligns with the input audio language.
   */
  inputAudioTranscription?: AudioTranscriptionConfig;
  /** The transcription of the output aligns with the language code
   specified for the output audio.
   */
  outputAudioTranscription?: AudioTranscriptionConfig;
  /** Configures the proactivity of the model. This allows the model to respond proactively to
   the input and to ignore irrelevant input. */
  proactivity?: ProactivityConfig;
  /** Configures the explicit VAD signal. If enabled, the client will send
   vad_signal to indicate the start and end of speech. This allows the server
   to process the audio more efficiently. */
  explicitVadSignal?: boolean;
  /** Configures the avatar model behavior. */
  avatarConfig?: AvatarConfig;
  /** Safety settings in the request to block unsafe content in the
   response.
   */
  safetySettings?: SafetySetting[];
}
/** Client generated response to a `ToolCall` received from the server.

 Individual `FunctionResponse` objects are matched to the respective
 `FunctionCall` objects by the `id` field.

 Note that in the unary and server-streaming GenerateContent APIs function
 calling happens by exchanging the `Content` parts, while in the bidi
 GenerateContent APIs function calling happens over this dedicated set of
 messages. */
declare class LiveClientToolResponse {
  /** The response to the function calls. */
  functionResponses?: FunctionResponse[];
}
/** Session config for the API connection. */
declare interface LiveConnectConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The generation configuration for the session. */
  generationConfig?: GenerationConfig;
  /** The requested modalities of the response. Represents the set of
   modalities that the model can return. Defaults to AUDIO if not specified.
   */
  responseModalities?: Modality[];
  /** Value that controls the degree of randomness in token selection.
   Lower temperatures are good for prompts that require a less open-ended or
   creative response, while higher temperatures can lead to more diverse or
   creative results.
   */
  temperature?: number;
  /** Tokens are selected from the most to least probable until the sum
   of their probabilities equals this value. Use a lower value for less
   random responses and a higher value for more random responses.
   */
  topP?: number;
  /** For each token selection step, the ``top_k`` tokens with the
   highest probabilities are sampled. Then tokens are further filtered based
   on ``top_p`` with the final token selected using temperature sampling. Use
   a lower number for less random responses and a higher number for more
   random responses.
   */
  topK?: number;
  /** Maximum number of tokens that can be generated in the response.
   */
  maxOutputTokens?: number;
  /** If specified, the media resolution specified will be used.
   */
  mediaResolution?: MediaResolution;
  /** When ``seed`` is fixed to a specific number, the model makes a best
   effort to provide the same response for repeated requests. By default, a
   random number is used.
   */
  seed?: number;
  /** The speech generation configuration.
   */
  speechConfig?: SpeechConfig;
  /** Config for thinking features.
   An error will be returned if this field is set for models that don't
   support thinking.
   */
  thinkingConfig?: ThinkingConfig;
  /** If enabled, the model will detect emotions and adapt its responses accordingly. */
  enableAffectiveDialog?: boolean;
  /** The user provided system instructions for the model.
   Note: only text should be used in parts and content in each part will be
   in a separate paragraph. */
  systemInstruction?: ContentUnion;
  /** A list of `Tools` the model may use to generate the next response.
     A `Tool` is a piece of code that enables the system to interact with
   external systems to perform an action, or set of actions, outside of
   knowledge and scope of the model. */
  tools?: ToolListUnion;
  /** Configures session resumption mechanism.
     If included the server will send SessionResumptionUpdate messages. */
  sessionResumption?: SessionResumptionConfig;
  /** The transcription of the input aligns with the input audio language.
   */
  inputAudioTranscription?: AudioTranscriptionConfig;
  /** The transcription of the output aligns with the language code
   specified for the output audio.
   */
  outputAudioTranscription?: AudioTranscriptionConfig;
  /** Configures the realtime input behavior in BidiGenerateContent. */
  realtimeInputConfig?: RealtimeInputConfig;
  /** Configures context window compression mechanism.
     If included, server will compress context window to fit into given length. */
  contextWindowCompression?: ContextWindowCompressionConfig;
  /** Configures the proactivity of the model. This allows the model to respond proactively to
   the input and to ignore irrelevant input. */
  proactivity?: ProactivityConfig;
  /** Configures the explicit VAD signal. If enabled, the client will send
   vad_signal to indicate the start and end of speech. This allows the server
   to process the audio more efficiently. */
  explicitVadSignal?: boolean;
  /** Configures the avatar model behavior. */
  avatarConfig?: AvatarConfig;
  /** Safety settings in the request to block unsafe content in the
   response.
   */
  safetySettings?: SafetySetting[];
  /** Config for stream translation. */
  streamTranslationConfig?: StreamTranslationConfig;
}
/** Config for LiveConnectConstraints for Auth Token creation. */
declare interface LiveConnectConstraints {
  /** ID of the model to configure in the ephemeral token for Live API.
   For a list of models, see `Gemini models
   <https://ai.google.dev/gemini-api/docs/models>`. */
  model?: string;
  /** Configuration specific to Live API connections created using this token. */
  config?: LiveConnectConfig;
}
/** Parameters for connecting to the live API. */
declare interface LiveConnectParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** callbacks */
  callbacks: LiveCallbacks;
  /** Optional configuration parameters for the request.
   */
  config?: LiveConnectConfig;
}
/**
 LiveMusic class encapsulates the configuration for live music
 generation via Lyria Live models.

 @experimental
 */
declare class LiveMusic {
  private readonly apiClient;
  private readonly auth;
  private readonly webSocketFactory;
  constructor(apiClient: ApiClient, auth: Auth, webSocketFactory: WebSocketFactory);
  /**
   Establishes a connection to the specified model and returns a
   LiveMusicSession object representing that connection.
     @experimental
     @remarks
     @param params - The parameters for establishing a connection to the model.
   @return A live session.
     @example
   ```ts
   let model = 'models/lyria-realtime-exp';
   const session = await ai.live.music.connect({
   model: model,
   callbacks: {
   onmessage: (e: MessageEvent) => {
   console.log('Received message from the server: %s\n', debug(e.data));
   },
   onerror: (e: ErrorEvent) => {
   console.log('Error occurred: %s\n', debug(e.error));
   },
   onclose: (e: CloseEvent) => {
   console.log('Connection closed.');
   },
   },
   });
   ```
   */
  connect(params: types.LiveMusicConnectParameters): Promise<LiveMusicSession>;
}
/** Callbacks for the realtime music API. */
declare interface LiveMusicCallbacks {
  /**
   * Called when a message is received from the server.
   */
  onmessage: (e: LiveMusicServerMessage) => void;
  /**
   * Called when an error occurs.
   */
  onerror?: ((e: ErrorEvent) => void) | null;
  /**
   * Called when the websocket connection is closed.
   */
  onclose?: ((e: CloseEvent) => void) | null;
}
/** User input to start or steer the music. */
declare interface LiveMusicClientContent {
  /** Weighted prompts as the model input. */
  weightedPrompts?: WeightedPrompt[];
}
/** Messages sent by the client in the LiveMusicClientMessage call. */
declare interface LiveMusicClientMessage {
  /** Message to be sent in the first (and only in the first) `LiveMusicClientMessage`.
   Clients should wait for a `LiveMusicSetupComplete` message before
   sending any additional messages. */
  setup?: LiveMusicClientSetup;
  /** User input to influence music generation. */
  clientContent?: LiveMusicClientContent;
  /** Configuration for music generation. */
  musicGenerationConfig?: LiveMusicGenerationConfig;
  /** Playback control signal for the music generation. */
  playbackControl?: LiveMusicPlaybackControl;
}
/** Message to be sent by the system when connecting to the API. */
declare interface LiveMusicClientSetup {
  /** The model's resource name. Format: `models/{model}`. */
  model?: string;
}
/** Parameters for connecting to the live API. */
declare interface LiveMusicConnectParameters {
  /** The model's resource name. */
  model: string;
  /** Callbacks invoked on server events. */
  callbacks: LiveMusicCallbacks;
}
/** A prompt that was filtered with the reason. */
declare interface LiveMusicFilteredPrompt {
  /** The text prompt that was filtered. */
  text?: string;
  /** The reason the prompt was filtered. */
  filteredReason?: string;
}
/** Configuration for music generation. */
declare interface LiveMusicGenerationConfig {
  /** Controls the variance in audio generation. Higher values produce
   higher variance. Range is [0.0, 3.0]. */
  temperature?: number;
  /** Controls how the model selects tokens for output. Samples the topK
   tokens with the highest probabilities. Range is [1, 1000]. */
  topK?: number;
  /** Seeds audio generation. If not set, the request uses a randomly
   generated seed. */
  seed?: number;
  /** Controls how closely the model follows prompts.
   Higher guidance follows more closely, but will make transitions more
   abrupt. Range is [0.0, 6.0]. */
  guidance?: number;
  /** Beats per minute. Range is [60, 200]. */
  bpm?: number;
  /** Density of sounds. Range is [0.0, 1.0]. */
  density?: number;
  /** Brightness of the music. Range is [0.0, 1.0]. */
  brightness?: number;
  /** Scale of the generated music. */
  scale?: Scale;
  /** Whether the audio output should contain bass. */
  muteBass?: boolean;
  /** Whether the audio output should contain drums. */
  muteDrums?: boolean;
  /** Whether the audio output should contain only bass and drums. */
  onlyBassAndDrums?: boolean;
  /** The mode of music generation. Default mode is QUALITY. */
  musicGenerationMode?: MusicGenerationMode;
}
/** The playback control signal to apply to the music generation. */
declare enum LiveMusicPlaybackControl {
  /**
   * This value is unused.
   */
  PLAYBACK_CONTROL_UNSPECIFIED = "PLAYBACK_CONTROL_UNSPECIFIED",
  /**
   * Start generating the music.
   */
  PLAY = "PLAY",
  /**
   * Hold the music generation. Use PLAY to resume from the current position.
   */
  PAUSE = "PAUSE",
  /**
   * Stop the music generation and reset the context (prompts retained).
   Use PLAY to restart the music generation.
   */
  STOP = "STOP",
  /**
   * Reset the context of the music generation without stopping it.
   Retains the current prompts and config.
   */
  RESET_CONTEXT = "RESET_CONTEXT"
}
/** Server update generated by the model in response to client messages.

 Content is generated as quickly as possible, and not in real time.
 Clients may choose to buffer and play it out in real time. */
declare interface LiveMusicServerContent {
  /** The audio chunks that the model has generated. */
  audioChunks?: AudioChunk[];
}
/** Response message for the LiveMusicClientMessage call. */
declare class LiveMusicServerMessage {
  /** Message sent in response to a `LiveMusicClientSetup` message from the client.
   Clients should wait for this message before sending any additional messages. */
  setupComplete?: LiveMusicServerSetupComplete;
  /** Content generated by the model in response to client messages. */
  serverContent?: LiveMusicServerContent;
  /** A prompt that was filtered with the reason. */
  filteredPrompt?: LiveMusicFilteredPrompt;
  /**
   * Returns the first audio chunk from the server content, if present.
   *
   * @remarks
   * If there are no audio chunks in the response, undefined will be returned.
   */
  get audioChunk(): AudioChunk | undefined;
}
/** Sent in response to a `LiveMusicClientSetup` message from the client. */
declare interface LiveMusicServerSetupComplete {}
/**
 Represents a connection to the API.

 @experimental
 */
declare class LiveMusicSession {
  readonly conn: WebSocket_2;
  private readonly apiClient;
  constructor(conn: WebSocket_2, apiClient: ApiClient);
  /**
   Sets inputs to steer music generation. Updates the session's current
   weighted prompts.
     @param params - Contains one property, `weightedPrompts`.
     - `weightedPrompts` to send to the model; weights are normalized to
   sum to 1.0.
     @experimental
   */
  setWeightedPrompts(params: types.LiveMusicSetWeightedPromptsParameters): Promise<void>;
  /**
   Sets a configuration to the model. Updates the session's current
   music generation config.
     @param params - Contains one property, `musicGenerationConfig`.
     - `musicGenerationConfig` to set in the model. Passing an empty or
   undefined config to the model will reset the config to defaults.
     @experimental
   */
  setMusicGenerationConfig(params: types.LiveMusicSetConfigParameters): Promise<void>;
  private sendPlaybackControl;
  /**
   * Start the music stream.
   *
   * @experimental
   */
  play(): void;
  /**
   * Temporarily halt the music stream. Use `play` to resume from the current
   * position.
   *
   * @experimental
   */
  pause(): void;
  /**
   * Stop the music stream and reset the state. Retains the current prompts
   * and config.
   *
   * @experimental
   */
  stop(): void;
  /**
   * Resets the context of the music generation without stopping it.
   * Retains the current prompts and config.
   *
   * @experimental
   */
  resetContext(): void;
  /**
   Terminates the WebSocket connection.
     @experimental
   */
  close(): void;
}
/** Parameters for setting config for the live music API. */
declare interface LiveMusicSetConfigParameters {
  /** Configuration for music generation. */
  musicGenerationConfig: LiveMusicGenerationConfig;
}
/** Parameters for setting weighted prompts for the live music API. */
declare interface LiveMusicSetWeightedPromptsParameters {
  /** A map of text prompts to weights to use for the generation request. */
  weightedPrompts: WeightedPrompt[];
}
/** Prompts and config used for generating this audio chunk. */
declare interface LiveMusicSourceMetadata {
  /** Weighted prompts for generating this audio chunk. */
  clientContent?: LiveMusicClientContent;
  /** Music generation config for generating this audio chunk. */
  musicGenerationConfig?: LiveMusicGenerationConfig;
}
/** Parameters for sending client content to the live API. */
declare interface LiveSendClientContentParameters {
  /** Client content to send to the session. */
  turns?: ContentListUnion;
  /** If true, indicates that the server content generation should start with
   the currently accumulated prompt. Otherwise, the server will await
   additional messages before starting generation. */
  turnComplete?: boolean;
}
/** Parameters for sending realtime input to the live API. */
declare interface LiveSendRealtimeInputParameters {
  /** Realtime input to send to the session. */
  media?: BlobImageUnion;
  /** The realtime audio input stream. */
  audio?: Blob_2;
  /**
   Indicates that the audio stream has ended, e.g. because the microphone was
   turned off.
     This should only be sent when automatic activity detection is enabled
   (which is the default).
     The client can reopen the stream by sending an audio message.
   */
  audioStreamEnd?: boolean;
  /** The realtime video input stream. */
  video?: BlobImageUnion;
  /** The realtime text input stream. */
  text?: string;
  /** Marks the start of user activity. */
  activityStart?: ActivityStart;
  /** Marks the end of user activity. */
  activityEnd?: ActivityEnd;
}
/** Parameters for sending tool responses to the live API. */
declare class LiveSendToolResponseParameters {
  /** Tool responses to send to the session. */
  functionResponses: FunctionResponse[] | FunctionResponse;
}
/** Incremental server update generated by the model in response to client messages.

 Content is generated as quickly as possible, and not in real time. Clients
 may choose to buffer and play it out in real time. */
declare interface LiveServerContent {
  /** The content that the model has generated as part of the current conversation with the user. */
  modelTurn?: Content;
  /** If true, indicates that the model is done generating. Generation will only start in response to additional client messages. Can be set alongside `content`, indicating that the `content` is the last in the turn. */
  turnComplete?: boolean;
  /** If true, indicates that a client message has interrupted current model generation. If the client is playing out the content in realtime, this is a good signal to stop and empty the current queue. */
  interrupted?: boolean;
  /** Metadata returned to client when grounding is enabled. */
  groundingMetadata?: GroundingMetadata;
  /** If true, indicates that the model is done generating. When model is
   interrupted while generating there will be no generation_complete message
   in interrupted turn, it will go through interrupted > turn_complete.
   When model assumes realtime playback there will be delay between
   generation_complete and turn_complete that is caused by model
   waiting for playback to finish. If true, indicates that the model
   has finished generating all content. This is a signal to the client
   that it can stop sending messages. */
  generationComplete?: boolean;
  /** Input transcription. The transcription is independent to the model
   turn which means it doesn’t imply any ordering between transcription and
   model turn. */
  inputTranscription?: Transcription;
  /** Output transcription. The transcription is independent to the model
   turn which means it doesn’t imply any ordering between transcription and
   model turn.
   */
  outputTranscription?: Transcription;
  /** Metadata related to url context retrieval tool. */
  urlContextMetadata?: UrlContextMetadata;
  /** Reason for the turn is complete. */
  turnCompleteReason?: TurnCompleteReason;
  /** If true, indicates that the model is not generating content because
   it is waiting for more input from the user, e.g. because it expects the
   user to continue talking. */
  waitingForInput?: boolean;
}
/** Server will not be able to service client soon. */
declare interface LiveServerGoAway {
  /** The remaining time before the connection will be terminated as ABORTED. The minimal time returned here is specified differently together with the rate limits for a given model. */
  timeLeft?: string;
}
/** Response message for API call. */
declare class LiveServerMessage {
  /** Sent in response to a `LiveClientSetup` message from the client. */
  setupComplete?: LiveServerSetupComplete;
  /** Content generated by the model in response to client messages. */
  serverContent?: LiveServerContent;
  /** Request for the client to execute the `function_calls` and return the responses with the matching `id`s. */
  toolCall?: LiveServerToolCall;
  /** Notification for the client that a previously issued `ToolCallMessage` with the specified `id`s should have been not executed and should be cancelled. */
  toolCallCancellation?: LiveServerToolCallCancellation;
  /** Usage metadata about model response(s). */
  usageMetadata?: UsageMetadata;
  /** Server will disconnect soon. */
  goAway?: LiveServerGoAway;
  /** Update of the session resumption state. */
  sessionResumptionUpdate?: LiveServerSessionResumptionUpdate;
  /** Voice activity detection signal. Allowlisted only. */
  voiceActivityDetectionSignal?: VoiceActivityDetectionSignal;
  /** Voice activity signal. */
  voiceActivity?: VoiceActivity;
  /**
   * Returns the concatenation of all text parts from the server content if present.
   *
   * @remarks
   * If there are non-text parts in the response, the concatenation of all text
   * parts will be returned, and a warning will be logged.
   */
  get text(): string | undefined;
  /**
   * Returns the concatenation of all inline data parts from the server content if present.
   *
   * @remarks
   * If there are non-inline data parts in the
   * response, the concatenation of all inline data parts will be returned, and
   * a warning will be logged.
   */
  get data(): string | undefined;
}
/** Update of the session resumption state.

 Only sent if `session_resumption` was set in the connection config. */
declare interface LiveServerSessionResumptionUpdate {
  /** New handle that represents state that can be resumed. Empty if `resumable`=false. */
  newHandle?: string;
  /** True if session can be resumed at this point. It might be not possible to resume session at some points. In that case we send update empty new_handle and resumable=false. Example of such case could be model executing function calls or just generating. Resuming session (using previous session token) in such state will result in some data loss. */
  resumable?: boolean;
  /** Index of last message sent by client that is included in state represented by this SessionResumptionToken. Only sent when `SessionResumptionConfig.transparent` is set.
     Presence of this index allows users to transparently reconnect and avoid issue of losing some part of realtime audio input/video. If client wishes to temporarily disconnect (for example as result of receiving GoAway) they can do it without losing state by buffering messages sent since last `SessionResmumptionTokenUpdate`. This field will enable them to limit buffering (avoid keeping all requests in RAM).
     Note: This should not be used for when resuming a session at some time later -- in those cases partial audio and video frames arelikely not needed. */
  lastConsumedClientMessageIndex?: string;
}
/** Sent in response to a `LiveGenerateContentSetup` message from the client. */
declare interface LiveServerSetupComplete {
  /** The session id of the live session. */
  sessionId?: string;
}
/** Request for the client to execute the `function_calls` and return the responses with the matching `id`s. */
declare interface LiveServerToolCall {
  /** The function call to be executed. */
  functionCalls?: FunctionCall[];
}
/** Notification for the client that a previously issued `ToolCallMessage` with the specified `id`s should have been not executed and should be cancelled.

 If there were side-effects to those tool calls, clients may attempt to undo
 the tool calls. This message occurs only in cases where the clients interrupt
 server turns. */
declare interface LiveServerToolCallCancellation {
  /** The ids of the tool calls to be cancelled. */
  ids?: string[];
}
declare type LogFn = (message: string, ...rest: unknown[]) => void;
declare type Logger = {
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
};
declare type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';
/** The log probabilities of the tokens generated by the model. This is useful for understanding the model's confidence in its predictions and for debugging. For example, you can use log probabilities to identify when the model is making a less confident prediction or to explore alternative responses that the model considered. A low log probability can also indicate that the model is "hallucinating" or generating factually incorrect information. */
declare interface LogprobsResult {
  /** A list of the chosen candidate tokens at each decoding step. The length of this list is equal to the total number of decoding steps. Note that the chosen candidate might not be in `top_candidates`. */
  chosenCandidates?: LogprobsResultCandidate[];
  /** A list of the top candidate tokens at each decoding step. The length of this list is equal to the total number of decoding steps. */
  topCandidates?: LogprobsResultTopCandidates[];
  /** Sum of log probabilities for all tokens. This field is not supported in Vertex AI. */
  logProbabilitySum?: number;
}
/** A single token and its associated log probability. */
declare interface LogprobsResultCandidate {
  /** The log probability of this token. A higher value indicates that the model was more confident in this token. The log probability can be used to assess the relative likelihood of different tokens and to identify when the model is uncertain. */
  logProbability?: number;
  /** The token's string representation. */
  token?: string;
  /** The token's numerical ID. While the `token` field provides the string representation of the token, the `token_id` is the numerical representation that the model uses internally. This can be useful for developers who want to build custom logic based on the model's vocabulary. */
  tokenId?: number;
}
/** A list of the top candidate tokens and their log probabilities at each decoding step. This can be used to see what other tokens the model considered. */
declare interface LogprobsResultTopCandidates {
  /** The list of candidate tokens, sorted by log probability in descending order. */
  candidates?: LogprobsResultCandidate[];
}
/** Configuration for a Mask reference image. */
declare interface MaskReferenceConfig {
  /** Prompts the model to generate a mask instead of you needing to
   provide one (unless MASK_MODE_USER_PROVIDED is used). */
  maskMode?: MaskReferenceMode;
  /** A list of up to 5 class ids to use for semantic segmentation.
   Automatically creates an image mask based on specific objects. */
  segmentationClasses?: number[];
  /** Dilation percentage of the mask provided.
   Float between 0 and 1. */
  maskDilation?: number;
}
/** A mask reference image.

 This encapsulates either a mask image provided by the user and configs for
 the user provided mask, or only config parameters for the model to generate
 a mask.

 A mask image is an image whose non-zero values indicate where to edit the base
 image. If the user provides a mask image, the mask must be in the same
 dimensions as the raw image. */
declare class MaskReferenceImage {
  /** The reference image for the editing operation. */
  referenceImage?: Image_2;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Configuration for the mask reference image. */
  config?: MaskReferenceConfig;
  /** Internal method to convert to ReferenceImageAPIInternal. */
  toReferenceImageAPI(): ReferenceImageAPIInternal;
}
/** Enum representing the mask mode of a mask reference image. */
declare enum MaskReferenceMode {
  MASK_MODE_DEFAULT = "MASK_MODE_DEFAULT",
  MASK_MODE_USER_PROVIDED = "MASK_MODE_USER_PROVIDED",
  MASK_MODE_BACKGROUND = "MASK_MODE_BACKGROUND",
  MASK_MODE_FOREGROUND = "MASK_MODE_FOREGROUND",
  MASK_MODE_SEMANTIC = "MASK_MODE_SEMANTIC"
}
/** A MCPServer is a server that can be called by the model to perform actions. It is a server that implements the MCP protocol. Next ID: 6. This data type is not supported in Vertex AI. */
declare interface McpServer {
  /** The name of the MCPServer. */
  name?: string;
  /** A transport that can stream HTTP requests and responses. */
  streamableHttpTransport?: StreamableHttpTransport;
}
/**
 * MCPServer tool call step.
 */
declare interface MCPServerToolCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  /**
   * Required. The JSON object of arguments for the function.
   */
  arguments: {
    [key: string]: unknown;
  };
  /**
   * Required. The name of the tool which was called.
   */
  name: string;
  /**
   * Required. The name of the used MCP server.
   */
  server_name: string;
  type: 'mcp_server_tool_call';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/**
 * MCPServer tool result step.
 */
declare interface MCPServerToolResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  /**
   * The output from the MCP server call. Can be simple text or rich content.
   */
  result: unknown | string | Array<TextContent | ImageContent>;
  type: 'mcp_server_tool_result';
  /**
   * Name of the tool which is called for this specific tool call.
   */
  name?: string;
  /**
   * The name of the used MCP server.
   */
  server_name?: string;
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
/**
 * Creates a McpCallableTool from MCP clients and an optional config.
 *
 * The callable tool can invoke the MCP clients with given function call
 * arguments. (often for automatic function calling).
 * Use the config to modify tool parameters such as behavior.
 *
 * @experimental Built-in MCP support is an experimental feature, may change in future
 * versions.
 */
/** Server content modalities. */
declare enum MediaModality {
  /**
   * The modality is unspecified.
   */
  MODALITY_UNSPECIFIED = "MODALITY_UNSPECIFIED",
  /**
   * Plain text.
   */
  TEXT = "TEXT",
  /**
   * Images.
   */
  IMAGE = "IMAGE",
  /**
   * Video.
   */
  VIDEO = "VIDEO",
  /**
   * Audio.
   */
  AUDIO = "AUDIO",
  /**
   * Document, e.g. PDF.
   */
  DOCUMENT = "DOCUMENT"
}
/** The media resolution to use. */
declare enum MediaResolution {
  /**
   * Media resolution has not been set
   */
  MEDIA_RESOLUTION_UNSPECIFIED = "MEDIA_RESOLUTION_UNSPECIFIED",
  /**
   * Media resolution set to low (64 tokens).
   */
  MEDIA_RESOLUTION_LOW = "MEDIA_RESOLUTION_LOW",
  /**
   * Media resolution set to medium (256 tokens).
   */
  MEDIA_RESOLUTION_MEDIUM = "MEDIA_RESOLUTION_MEDIUM",
  /**
   * Media resolution set to high (zoomed reframing with 256 tokens).
   */
  MEDIA_RESOLUTION_HIGH = "MEDIA_RESOLUTION_HIGH"
}
/**
 * This type contains `RequestInit` options that may be available on the current runtime,
 * including per-platform extensions like `dispatcher`, `agent`, `client`, etc.
 */
declare type MergedRequestInit = RequestInits & /** We don't include these in the types as they'll be overridden for every request. */Partial<Record<'body' | 'headers' | 'method' | 'signal', never>>;
/** Server content modalities. */
declare enum Modality {
  /**
   * The modality is unspecified.
   */
  MODALITY_UNSPECIFIED = "MODALITY_UNSPECIFIED",
  /**
   * Indicates the model should return text
   */
  TEXT = "TEXT",
  /**
   * Indicates the model should return images.
   */
  IMAGE = "IMAGE",
  /**
   * Indicates the model should return audio.
   */
  AUDIO = "AUDIO",
  /**
   * Indicates the model should return video.
   */
  VIDEO = "VIDEO"
}
/** Represents token counting info for a single modality. */
declare interface ModalityTokenCount {
  /** The modality associated with this token count. */
  modality?: MediaModality;
  /** The number of tokens counted for this modality. */
  tokenCount?: number;
}
/** A trained machine learning model. */
declare interface Model {
  /** Resource name of the model. */
  name?: string;
  /** Display name of the model. */
  displayName?: string;
  /** Description of the model. */
  description?: string;
  /** Version ID of the model. A new version is committed when a new
   model version is uploaded or trained under an existing model ID. The
   version ID is an auto-incrementing decimal number in string
   representation. */
  version?: string;
  /** List of deployed models created from this base model. Note that a
   model could have been deployed to endpoints in different locations. */
  endpoints?: Endpoint[];
  /** Labels with user-defined metadata to organize your models. */
  labels?: Record<string, string>;
  /** Information about the tuned model from the base model. */
  tunedModelInfo?: TunedModelInfo;
  /** The maximum number of input tokens that the model can handle. */
  inputTokenLimit?: number;
  /** The maximum number of output tokens that the model can generate. */
  outputTokenLimit?: number;
  /** List of actions that are supported by the model. */
  supportedActions?: string[];
  /** The default checkpoint id of a model version.
   */
  defaultCheckpointId?: string;
  /** The checkpoints of the model. */
  checkpoints?: Checkpoint[];
  /** Temperature value used for sampling set when the dataset was saved.
   This value is used to tune the degree of randomness. */
  temperature?: number;
  /** The maximum temperature value used for sampling set when the
   dataset was saved. This value is used to tune the degree of randomness. */
  maxTemperature?: number;
  /** Optional. Specifies the nucleus sampling threshold. The model
   considers only the smallest set of tokens whose cumulative probability is
   at least `top_p`. This helps generate more diverse and less repetitive
   responses. For example, a `top_p` of 0.9 means the model considers tokens
   until the cumulative probability of the tokens to select from reaches 0.9.
   It's recommended to adjust either temperature or `top_p`, but not both. */
  topP?: number;
  /** Optional. Specifies the top-k sampling threshold. The model
   considers only the top k most probable tokens for the next token. This can
   be useful for generating more coherent and less random text. For example,
   a `top_k` of 40 means the model will choose the next word from the 40 most
   likely words. */
  topK?: number;
  /** Whether the model supports thinking features. If true, thoughts are
   returned only if the model supports thought and thoughts are available. */
  thinking?: boolean;
}
/**
 * The model that will complete your prompt.\n\nSee
 * [models](https://ai.google.dev/gemini-api/docs/models) for additional details.
 */
declare type Model_2 = 'gemini-2.5-computer-use-preview-10-2025' | 'gemini-2.5-flash' | 'gemini-2.5-flash-image' | 'gemini-2.5-flash-lite' | 'gemini-2.5-flash-lite-preview-09-2025' | 'gemini-2.5-flash-native-audio-preview-12-2025' | 'gemini-2.5-flash-preview-09-2025' | 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro' | 'gemini-2.5-pro-preview-tts' | 'gemini-3-flash-preview' | 'gemini-3-pro-image-preview' | 'gemini-3-pro-preview' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-image-preview' | 'gemini-3.1-flash-lite' | 'gemini-3.1-flash-lite-preview' | 'gemini-3.1-flash-tts-preview' | 'lyria-3-clip-preview' | 'lyria-3-pro-preview' | 'gemini-3.5-flash' | (string & {});
/** Configuration for Model Armor. Model Armor is a Google Cloud service that provides safety and security filtering for prompts and responses. It helps protect your AI applications from risks such as harmful content, sensitive data leakage, and prompt injection attacks. This data type is not supported in Gemini API. */
declare interface ModelArmorConfig {
  /** Optional. The resource name of the Model Armor template to use for prompt screening. A Model Armor template is a set of customized filters and thresholds that define how Model Armor screens content. If specified, Model Armor will use this template to check the user's prompt for safety and security risks before it is sent to the model. The name must be in the format `projects/{project}/locations/{location}/templates/{template}`. */
  promptTemplateName?: string;
  /** Optional. The resource name of the Model Armor template to use for response screening. A Model Armor template is a set of customized filters and thresholds that define how Model Armor screens content. If specified, Model Armor will use this template to check the model's response for safety and security risks before it is returned to the user. The name must be in the format `projects/{project}/locations/{location}/templates/{template}`. */
  responseTemplateName?: string;
}
/**
 * Output generated by the model.
 */
declare interface ModelOutputStep {
  type: 'model_output';
  content?: Array<Content_2>;
}
declare class Models extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Calculates embeddings for the given contents.
   *
   * @param params - The parameters for embedding contents.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.embedContent({
   *  model: 'text-embedding-004',
   *  contents: [
   *    'What is your name?',
   *    'What is your favorite color?',
   *  ],
   *  config: {
   *    outputDimensionality: 64,
   *  },
   * });
   * console.log(response);
   * ```
   */
  embedContent: (params: types.EmbedContentParameters) => Promise<types.EmbedContentResponse>;
  /**
   * Makes an API request to generate content with a given model.
   *
   * For the `model` parameter, supported formats for Gemini Enterprise Agent Platform API include:
   * - The Gemini model ID, for example: 'gemini-2.0-flash'
   * - The full resource name starts with 'projects/', for example:
   *  'projects/my-project-id/locations/us-central1/publishers/google/models/gemini-2.0-flash'
   * - The partial resource name with 'publishers/', for example:
   *  'publishers/google/models/gemini-2.0-flash' or
   *  'publishers/meta/models/llama-3.1-405b-instruct-maas'
   * - `/` separated publisher and model name, for example:
   * 'google/gemini-2.0-flash' or 'meta/llama-3.1-405b-instruct-maas'
   *
   * For the `model` parameter, supported formats for Gemini API include:
   * - The Gemini model ID, for example: 'gemini-2.0-flash'
   * - The model name starts with 'models/', for example:
   *  'models/gemini-2.0-flash'
   * - For tuned models, the model name starts with 'tunedModels/',
   * for example:
   * 'tunedModels/1234567890123456789'
   *
   * Some models support multimodal input and output.
   *
   * @param params - The parameters for generating content.
   * @return The response from generating content.
   *
   * @example
   * ```ts
   * const response = await ai.models.generateContent({
   *   model: 'gemini-2.0-flash',
   *   contents: 'why is the sky blue?',
   *   config: {
   *     candidateCount: 2,
   *   }
   * });
   * console.log(response);
   * ```
   */
  generateContent: (params: types.GenerateContentParameters) => Promise<types.GenerateContentResponse>;
  /**
   * This logic is needed for GenerateContentConfig only.
   * Previously we made GenerateContentConfig.responseSchema field to accept
   * unknown. Since v1.9.0, we switch to use backend JSON schema support.
   * To maintain backward compatibility, we move the data that was treated as
   * JSON schema from the responseSchema field to the responseJsonSchema field.
   */
  private maybeMoveToResponseJsonSchem;
  /**
   * Makes an API request to generate content with a given model and yields the
   * response in chunks.
   *
   * For the `model` parameter, supported formats for Gemini Enterprise Agent Platform API include:
   * - The Gemini model ID, for example: 'gemini-2.0-flash'
   * - The full resource name starts with 'projects/', for example:
   *  'projects/my-project-id/locations/us-central1/publishers/google/models/gemini-2.0-flash'
   * - The partial resource name with 'publishers/', for example:
   *  'publishers/google/models/gemini-2.0-flash' or
   *  'publishers/meta/models/llama-3.1-405b-instruct-maas'
   * - `/` separated publisher and model name, for example:
   * 'google/gemini-2.0-flash' or 'meta/llama-3.1-405b-instruct-maas'
   *
   * For the `model` parameter, supported formats for Gemini API include:
   * - The Gemini model ID, for example: 'gemini-2.0-flash'
   * - The model name starts with 'models/', for example:
   *  'models/gemini-2.0-flash'
   * - For tuned models, the model name starts with 'tunedModels/',
   * for example:
   *  'tunedModels/1234567890123456789'
   *
   * Some models support multimodal input and output.
   *
   * @param params - The parameters for generating content with streaming response.
   * @return The response from generating content.
   *
   * @example
   * ```ts
   * const response = await ai.models.generateContentStream({
   *   model: 'gemini-2.0-flash',
   *   contents: 'why is the sky blue?',
   *   config: {
   *     maxOutputTokens: 200,
   *   }
   * });
   * for await (const chunk of response) {
   *   console.log(chunk);
   * }
   * ```
   */
  generateContentStream: (params: types.GenerateContentParameters) => Promise<AsyncGenerator<types.GenerateContentResponse>>;
  /**
   * Transforms the CallableTools in the parameters to be simply Tools, it
   * copies the params into a new object and replaces the tools, it does not
   * modify the original params. Also sets the MCP usage header if there are
   * MCP tools in the parameters.
   */
  private processParamsMaybeAddMcpUsage;
  private initAfcToolsMap;
  private processAfcStream;
  /**
   * Generates an image based on a text description and configuration.
   *
   * @param params - The parameters for generating images.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await client.models.generateImages({
   *  model: 'imagen-4.0-generate-001',
   *  prompt: 'Robot holding a red skateboard',
   *  config: {
   *    numberOfImages: 1,
   *    includeRaiReason: true,
   *  },
   * });
   * console.log(response?.generatedImages?.[0]?.image?.imageBytes);
   * ```
   */
  generateImages: (params: types.GenerateImagesParameters) => Promise<types.GenerateImagesResponse>;
  list: (params?: types.ListModelsParameters) => Promise<Pager<types.Model>>;
  /**
   * Edits an image based on a prompt, list of reference images, and configuration.
   *
   * @param params - The parameters for editing an image.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await client.models.editImage({
   *  model: 'imagen-3.0-capability-001',
   *  prompt: 'Generate an image containing a mug with the product logo [1] visible on the side of the mug.',
   *  referenceImages: [subjectReferenceImage]
   *  config: {
   *    numberOfImages: 1,
   *    includeRaiReason: true,
   *  },
   * });
   * console.log(response?.generatedImages?.[0]?.image?.imageBytes);
   * ```
   */
  editImage: (params: types.EditImageParameters) => Promise<types.EditImageResponse>;
  /**
   * Upscales an image based on an image, upscale factor, and configuration.
   * Only supported in Gemini Enterprise Agent Platform currently.
   *
   * @param params - The parameters for upscaling an image.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await client.models.upscaleImage({
   *  model: 'imagen-4.0-upscale-preview',
   *  image: image,
   *  upscaleFactor: 'x2',
   *  config: {
   *    includeRaiReason: true,
   *  },
   * });
   * console.log(response?.generatedImages?.[0]?.image?.imageBytes);
   * ```
   */
  upscaleImage: (params: types.UpscaleImageParameters) => Promise<types.UpscaleImageResponse>;
  /**
   *  Generates videos based on a text description and configuration.
   *
   * @param params - The parameters for generating videos.
   * @return A Promise<GenerateVideosOperation> which allows you to track the progress and eventually retrieve the generated videos using the operations.get method.
   *
   * @example
   * ```ts
   * const operation = await ai.models.generateVideos({
   *  model: 'veo-2.0-generate-001',
   *  source: {
   *    prompt: 'A neon hologram of a cat driving at top speed',
   *  },
   *  config: {
   *    numberOfVideos: 1
   * });
   *
   * while (!operation.done) {
   *   await new Promise(resolve => setTimeout(resolve, 10000));
   *   operation = await ai.operations.getVideosOperation({operation: operation});
   * }
   *
   * console.log(operation.response?.generatedVideos?.[0]?.video?.uri);
   * ```
   */
  generateVideos: (params: types.GenerateVideosParameters) => Promise<types.GenerateVideosOperation>;
  private generateContentInternal;
  private generateContentStreamInternal;
  /**
   * Calculates embeddings for the given contents. Only text is supported.
   *
   * @param params - The parameters for embedding contents.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.embedContent({
   *  model: 'text-embedding-004',
   *  contents: [
   *    'What is your name?',
   *    'What is your favorite color?',
   *  ],
   *  config: {
   *    outputDimensionality: 64,
   *  },
   * });
   * console.log(response);
   * ```
   */
  private embedContentInternal;
  /**
   * Private method for generating images.
   */
  private generateImagesInternal;
  /**
   * Private method for editing an image.
   */
  private editImageInternal;
  /**
   * Private method for upscaling an image.
   */
  private upscaleImageInternal;
  /**
   * Recontextualizes an image.
   *
   * There is one type of recontextualization currently supported:
   * 1) Virtual Try-On: Generate images of persons modeling fashion products.
   *
   * @param params - The parameters for recontextualizing an image.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.recontextImage({
   *  model: 'virtual-try-on-001',
   *  source: {
   *    personImage: personImage,
   *    productImages: [productImage],
   *  },
   *  config: {
   *    numberOfImages: 1,
   *  },
   * });
   * console.log(response?.generatedImages?.[0]?.image?.imageBytes);
   * ```
   */
  recontextImage(params: types.RecontextImageParameters): Promise<types.RecontextImageResponse>;
  /**
   * Segments an image, creating a mask of a specified area.
   *
   * @param params - The parameters for segmenting an image.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.segmentImage({
   *  model: 'image-segmentation-001',
   *  source: {
   *    image: image,
   *  },
   *  config: {
   *    mode: 'foreground',
   *  },
   * });
   * console.log(response?.generatedMasks?.[0]?.mask?.imageBytes);
   * ```
   */
  segmentImage(params: types.SegmentImageParameters): Promise<types.SegmentImageResponse>;
  /**
   * Fetches information about a model by name.
   *
   * @example
   * ```ts
   * const modelInfo = await ai.models.get({model: 'gemini-2.0-flash'});
   * ```
   */
  get(params: types.GetModelParameters): Promise<types.Model>;
  private listInternal;
  /**
   * Updates a tuned model by its name.
   *
   * @param params - The parameters for updating the model.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.update({
   *   model: 'tuned-model-name',
   *   config: {
   *     displayName: 'New display name',
   *     description: 'New description',
   *   },
   * });
   * ```
   */
  update(params: types.UpdateModelParameters): Promise<types.Model>;
  /**
   * Deletes a tuned model by its name.
   *
   * @param params - The parameters for deleting the model.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.delete({model: 'tuned-model-name'});
   * ```
   */
  delete(params: types.DeleteModelParameters): Promise<types.DeleteModelResponse>;
  /**
   * Counts the number of tokens in the given contents. Multimodal input is
   * supported for Gemini models.
   *
   * @param params - The parameters for counting tokens.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.countTokens({
   *  model: 'gemini-2.0-flash',
   *  contents: 'The quick brown fox jumps over the lazy dog.'
   * });
   * console.log(response);
   * ```
   */
  countTokens(params: types.CountTokensParameters): Promise<types.CountTokensResponse>;
  /**
   * Given a list of contents, returns a corresponding TokensInfo containing
   * the list of tokens and list of token ids.
   *
   * This method is not supported by the Gemini Developer API.
   *
   * @param params - The parameters for computing tokens.
   * @return The response from the API.
   *
   * @example
   * ```ts
   * const response = await ai.models.computeTokens({
   *  model: 'gemini-2.0-flash',
   *  contents: 'What is your name?'
   * });
   * console.log(response);
   * ```
   */
  computeTokens(params: types.ComputeTokensParameters): Promise<types.ComputeTokensResponse>;
  /**
   * Private method for generating videos.
   */
  private generateVideosInternal;
}
/** Config for model selection. */
declare interface ModelSelectionConfig {
  /** Options for feature selection preference. */
  featureSelectionPreference?: FeatureSelectionPreference;
}
/** The stage of the underlying model. This enum is not supported in Vertex AI. */
declare enum ModelStage {
  /**
   * Unspecified model stage.
   */
  MODEL_STAGE_UNSPECIFIED = "MODEL_STAGE_UNSPECIFIED",
  /**
   * The underlying model is subject to lots of tunings.
   */
  UNSTABLE_EXPERIMENTAL = "UNSTABLE_EXPERIMENTAL",
  /**
   * Models in this stage are for experimental purposes only.
   */
  EXPERIMENTAL = "EXPERIMENTAL",
  /**
   * Models in this stage are more mature than experimental models.
   */
  PREVIEW = "PREVIEW",
  /**
   * Models in this stage are considered stable and ready for production use.
   */
  STABLE = "STABLE",
  /**
   * If the model is on this stage, it means that this model is on the path to deprecation in near future. Only existing customers can use this model.
   */
  LEGACY = "LEGACY",
  /**
   * Models in this stage are deprecated. These models cannot be used.
   */
  DEPRECATED = "DEPRECATED",
  /**
   * Models in this stage are retired. These models cannot be used.
   */
  RETIRED = "RETIRED"
}
/** The status of the underlying model. This is used to indicate the stage of the underlying model and the retirement time if applicable. This data type is not supported in Vertex AI. */
declare interface ModelStatus {
  /** A message explaining the model status. */
  message?: string;
  /** The stage of the underlying model. */
  modelStage?: ModelStage;
  /** The time at which the model will be retired. */
  retirementTime?: string;
}
/** Configuration for a multi-speaker text-to-speech request. */
declare interface MultiSpeakerVoiceConfig {
  /** Required. A list of configurations for the voices of the speakers. Exactly two speaker voice configurations must be provided. */
  speakerVoiceConfigs?: SpeakerVoiceConfig[];
}
/** The mode of music generation. */
declare enum MusicGenerationMode {
  /**
   * Rely on the server default generation mode.
   */
  MUSIC_GENERATION_MODE_UNSPECIFIED = "MUSIC_GENERATION_MODE_UNSPECIFIED",
  /**
   * Steer text prompts to regions of latent space with higher quality
   music.
   */
  QUALITY = "QUALITY",
  /**
   * Steer text prompts to regions of latent space with a larger
   diversity of music.
   */
  DIVERSITY = "DIVERSITY",
  /**
   * Steer text prompts to regions of latent space more likely to
   generate music with vocals.
   */
  VOCALIZATION = "VOCALIZATION"
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Shims for types that we can't always rely on being available globally.
 *
 * Note: these only exist at the type-level, there is no corresponding runtime
 * version for any of these symbols.
 */
declare type NeverToAny<T> = T extends never ? any : T;
/** @ts-ignore For users with node-fetch@2 */
declare type NodeFetch2RequestInit = NotAny<import('../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../../../node_modules/@types/node-fetch/index.d.ts').RequestInit>;
/** @ts-ignore For users with node-fetch@3, doesn't need file extension because types are at ./@types/index.d.ts */
declare type NodeFetch3RequestInit = NotAny<import('../node_modules/node-fetch').RequestInit> | NotAny<import('../../node_modules/node-fetch').RequestInit> | NotAny<import('../../../node_modules/node-fetch').RequestInit> | NotAny<import('../../../../node_modules/node-fetch').RequestInit> | NotAny<RequestInit$3> | NotAny<import('../../../../../../node_modules/node-fetch').RequestInit> | NotAny<import('../../../../../../../node_modules/node-fetch').RequestInit> | NotAny<import('../../../../../../../../node_modules/node-fetch').RequestInit> | NotAny<import('../../../../../../../../../node_modules/node-fetch').RequestInit> | NotAny<import('../../../../../../../../../../node_modules/node-fetch').RequestInit>;
/** @ts-ignore */
declare type _NodeReadableStream<R = any> = ReadableStream$1<R>;
declare type NotAny<T> = [0] extends [1 & T] ? never : T;
declare class NotFoundError extends APIError<404, Headers> {}
/**
 * @internal
 * Users can pass explicit nulls to unset default headers. When we parse them
 * into a standard headers type we need to preserve that information.
 */
declare type NullableHeaders = {
  /** Brand check, prevent users from creating a NullableHeaders. */[brand_privateNullableHeaders]: true; /** Parsed headers. */
  values: Headers; /** Set of lowercase header names explicitly set to null. */
  nulls: Set<string>;
};
/** A long-running operation. */
declare interface Operation<T> {
  /** The server-assigned name, which is only unique within the same service that originally returns it. If you use the default HTTP mapping, the `name` should be a resource name ending with `operations/{unique_id}`. */
  name?: string;
  /** Service-specific metadata associated with the operation. It typically contains progress information and common metadata such as create time. Some services might not provide such metadata.  Any method that returns a long-running operation should document the metadata type, if any. */
  metadata?: Record<string, unknown>;
  /** If the value is `false`, it means the operation is still in progress. If `true`, the operation is completed, and either `error` or `response` is available. */
  done?: boolean;
  /** The error result of the operation in case of failure or cancellation. */
  error?: Record<string, unknown>;
  /** The response if the operation is successful. */
  response?: T;
  /**
   * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
   */
  _fromAPIResponse({
    apiResponse,
    _isVertexAI
  }: OperationFromAPIResponseParameters): Operation<T>;
}
/** Parameters of the fromAPIResponse method of the Operation class. */
declare interface OperationFromAPIResponseParameters {
  /** The API response to be converted to an Operation. */
  apiResponse: Record<string, unknown>;
  /** Whether the API response is from Vertex AI. */
  _isVertexAI: boolean;
}
/** Parameters for the get method of the operations module. */
declare interface OperationGetParameters<T, U extends Operation<T>> {
  /** Used to override the default configuration. */
  config?: GetOperationConfig;
  /** The operation to be retrieved. */
  operation: U;
}
declare class Operations extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Gets the status of a long-running operation.
   *
   * @param parameters The parameters for the get operation request.
   * @return The updated Operation object, with the latest status or result.
   */
  getVideosOperation(parameters: types.OperationGetParameters<types.GenerateVideosResponse, types.GenerateVideosOperation>): Promise<types.GenerateVideosOperation>;
  /**
   * Gets the status of a long-running operation.
   *
   * @param parameters The parameters for the get operation request.
   * @return The updated Operation object, with the latest status or result.
   */
  get<T, U extends types.Operation<T>>(parameters: types.OperationGetParameters<T, U>): Promise<types.Operation<T>>;
  private getVideosOperationInternal;
  private fetchPredictVideosOperationInternal;
}
/** Outcome of the code execution. */
declare enum Outcome {
  /**
   * Unspecified status. This value should not be used.
   */
  OUTCOME_UNSPECIFIED = "OUTCOME_UNSPECIFIED",
  /**
   * Code execution completed successfully. `output` contains the stdout, if any.
   */
  OUTCOME_OK = "OUTCOME_OK",
  /**
   * Code execution failed. `output` contains the stderr and stdout, if any.
   */
  OUTCOME_FAILED = "OUTCOME_FAILED",
  /**
   * Code execution ran for too long, and was cancelled. There may or may not be a partial `output` present.
   */
  OUTCOME_DEADLINE_EXCEEDED = "OUTCOME_DEADLINE_EXCEEDED"
}
/** Describes the info for output of EvaluationService. This data type is not supported in Gemini API. */
declare interface OutputInfo {
  /** Output only. The full path of the Cloud Storage directory created, into which the evaluation results and aggregation results are written. */
  gcsOutputDirectory?: string;
}
/**
 * Some environments overload the global fetch function, and Parameters<T> only gets the last signature.
 */
declare type OverloadedParameters<T> = T extends ({
  (...args: infer A): unknown;
  (...args: infer B): unknown;
  (...args: infer C): unknown;
  (...args: infer D): unknown;
}) ? A | B | C | D : T extends ({
  (...args: infer A): unknown;
  (...args: infer B): unknown;
  (...args: infer C): unknown;
}) ? A | B | C : T extends ({
  (...args: infer A): unknown;
  (...args: infer B): unknown;
}) ? A | B : T extends ((...args: infer A) => unknown) ? A : never;
declare enum PagedItem {
  PAGED_ITEM_BATCH_JOBS = "batchJobs",
  PAGED_ITEM_MODELS = "models",
  PAGED_ITEM_TUNING_JOBS = "tuningJobs",
  PAGED_ITEM_FILES = "files",
  PAGED_ITEM_CACHED_CONTENTS = "cachedContents",
  PAGED_ITEM_FILE_SEARCH_STORES = "fileSearchStores",
  PAGED_ITEM_DOCUMENTS = "documents",
  PAGED_ITEM_SKILLS = "skills"
}
declare interface PagedItemConfig {
  parent?: string;
  config?: {
    pageToken?: string;
    pageSize?: number;
  };
}
declare interface PagedItemResponse<T> {
  nextPageToken?: string;
  sdkHttpResponse?: types.HttpResponse;
  batchJobs?: T[];
  models?: T[];
  tuningJobs?: T[];
  files?: T[];
  cachedContents?: T[];
  fileSearchStores?: T[];
  documents?: T[];
  skills?: T[];
}
/**
 * Pager class for iterating through paginated results.
 */
declare class Pager<T> implements AsyncIterable<T> {
  private nameInternal;
  private pageInternal;
  private paramsInternal;
  private pageInternalSize;
  private sdkHttpResponseInternal?;
  protected requestInternal: (params: PagedItemConfig) => Promise<PagedItemResponse<T>>;
  protected idxInternal: number;
  constructor(name: PagedItem, request: (params: PagedItemConfig) => Promise<PagedItemResponse<T>>, response: PagedItemResponse<T>, params: PagedItemConfig);
  private init;
  private initNextPage;
  /**
   * Returns the current page, which is a list of items.
   *
   * @remarks
   * The first page is retrieved when the pager is created. The returned list of
   * items could be a subset of the entire list.
   */
  get page(): T[];
  /**
   * Returns the type of paged item (for example, ``batch_jobs``).
   */
  get name(): PagedItem;
  /**
   * Returns the length of the page fetched each time by this pager.
   *
   * @remarks
   * The number of items in the page is less than or equal to the page length.
   */
  get pageSize(): number;
  /**
   * Returns the headers of the API response.
   */
  get sdkHttpResponse(): types.HttpResponse | undefined;
  /**
   * Returns the parameters when making the API request for the next page.
   *
   * @remarks
   * Parameters contain a set of optional configs that can be
   * used to customize the API request. For example, the `pageToken` parameter
   * contains the token to request the next page.
   */
  get params(): PagedItemConfig;
  /**
   * Returns the total number of items in the current page.
   */
  get pageLength(): number;
  /**
   * Returns the item at the given index.
   */
  getItem(index: number): T;
  /**
   * Returns an async iterator that support iterating through all items
   * retrieved from the API.
   *
   * @remarks
   * The iterator will automatically fetch the next page if there are more items
   * to fetch from the API.
   *
   * @example
   *
   * ```ts
   * const pager = await ai.files.list({config: {pageSize: 10}});
   * for await (const file of pager) {
   *   console.log(file.name);
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterator<T>;
  /**
   * Fetches the next page of items. This makes a new API request.
   *
   * @throws {Error} If there are no more pages to fetch.
   *
   * @example
   *
   * ```ts
   * const pager = await ai.files.list({config: {pageSize: 10}});
   * let page = pager.page;
   * while (true) {
   *   for (const file of page) {
   *     console.log(file.name);
   *   }
   *   if (!pager.hasNextPage()) {
   *     break;
   *   }
   *   page = await pager.nextPage();
   * }
   * ```
   */
  nextPage(): Promise<T[]>;
  /**
   * Returns true if there are more pages to fetch from the API.
   */
  hasNextPage(): boolean;
}
/** Output only. Pairwise metric choice. This enum is not supported in Gemini API. */
declare enum PairwiseChoice {
  /**
   * Unspecified prediction choice.
   */
  PAIRWISE_CHOICE_UNSPECIFIED = "PAIRWISE_CHOICE_UNSPECIFIED",
  /**
   * Baseline prediction wins
   */
  BASELINE = "BASELINE",
  /**
   * Candidate prediction wins
   */
  CANDIDATE = "CANDIDATE",
  /**
   * Winner cannot be determined
   */
  TIE = "TIE"
}
/** Spec for pairwise metric result. This data type is not supported in Gemini API. */
declare interface PairwiseMetricResult {
  /** Output only. Spec for custom output. */
  customOutput?: CustomOutput;
  /** Output only. Explanation for pairwise metric score. */
  explanation?: string;
  /** Output only. Pairwise metric choice. */
  pairwiseChoice?: PairwiseChoice;
}
/** A datatype containing media content.

 Exactly one field within a Part should be set, representing the specific type
 of content being conveyed. Using multiple fields within the same `Part`
 instance is considered invalid. */
declare interface Part {
  /** Media resolution for the input media.
   */
  mediaResolution?: PartMediaResolution;
  /** Optional. The result of executing the ExecutableCode. */
  codeExecutionResult?: CodeExecutionResult;
  /** Optional. Code generated by the model that is intended to be executed. */
  executableCode?: ExecutableCode;
  /** Optional. The URI-based data of the part. This can be used to include files from Google Cloud Storage. */
  fileData?: FileData;
  /** Optional. A predicted function call returned from the model. This contains the name of the function to call and the arguments to pass to the function. */
  functionCall?: FunctionCall;
  /** Optional. The result of a function call. This is used to provide the model with the result of a function call that it predicted. */
  functionResponse?: FunctionResponse;
  /** Optional. The inline data content of the part. This can be used to include images, audio, or video in a request. */
  inlineData?: Blob_2;
  /** Optional. The text content of the part. When sent from the VSCode Gemini Code Assist extension, references to @mentioned items will be converted to markdown boldface text. For example `@my-repo` will be converted to and sent as `**my-repo**` by the IDE agent. */
  text?: string;
  /** Optional. Indicates whether the `part` represents the model's thought process or reasoning. */
  thought?: boolean;
  /** Optional. An opaque signature for the thought so it can be reused in subsequent requests.
   * @remarks Encoded as base64 string. */
  thoughtSignature?: string;
  /** Optional. Video metadata. The metadata should only be specified while the video data is presented in inline_data or file_data. */
  videoMetadata?: VideoMetadata;
  /** Server-side tool call. This field is populated when the model predicts a tool invocation that should be executed on the server. The client is expected to echo this message back to the API. */
  toolCall?: ToolCall;
  /** The output from a server-side ToolCall execution. This field is populated by the client with the results of executing the corresponding ToolCall. */
  toolResponse?: ToolResponse;
  /** Custom metadata associated with the Part. Agents using genai.Part as content representation may need to keep track of the additional information. For example it can be name of a file/source from which the Part originates or a way to multiplex multiple Part streams. This field is not supported in Vertex AI. */
  partMetadata?: Record<string, unknown>;
}
/** Partial argument value of the function call. This data type is not supported in Gemini API. */
declare interface PartialArg {
  /** Optional. Represents a boolean value. */
  boolValue?: boolean;
  /** Required. A JSON Path (RFC 9535) to the argument being streamed. https://datatracker.ietf.org/doc/html/rfc9535. e.g. "$.foo.bar[0].data". */
  jsonPath?: string;
  /** Optional. Represents a null value. */
  nullValue?: 'NULL_VALUE';
  /** Optional. Represents a double value. */
  numberValue?: number;
  /** Optional. Represents a string value. */
  stringValue?: string;
  /** Optional. Whether this is not the last part of the same json_path. If true, another PartialArg message for the current json_path is expected to follow. */
  willContinue?: boolean;
}
declare type PartListUnion = PartUnion[] | PartUnion;
/** Media resolution for the input media. */
declare interface PartMediaResolution {
  /** The tokenization quality used for given media.
   */
  level?: PartMediaResolutionLevel;
  /** Specifies the required sequence length for media tokenization.
   */
  numTokens?: number;
}
/** The tokenization quality used for given media. */
declare enum PartMediaResolutionLevel {
  /**
   * Media resolution has not been set.
   */
  MEDIA_RESOLUTION_UNSPECIFIED = "MEDIA_RESOLUTION_UNSPECIFIED",
  /**
   * Media resolution set to low.
   */
  MEDIA_RESOLUTION_LOW = "MEDIA_RESOLUTION_LOW",
  /**
   * Media resolution set to medium.
   */
  MEDIA_RESOLUTION_MEDIUM = "MEDIA_RESOLUTION_MEDIUM",
  /**
   * Media resolution set to high.
   */
  MEDIA_RESOLUTION_HIGH = "MEDIA_RESOLUTION_HIGH",
  /**
   * Media resolution set to ultra high.
   */
  MEDIA_RESOLUTION_ULTRA_HIGH = "MEDIA_RESOLUTION_ULTRA_HIGH"
}
/** Tuning spec for Partner models. This data type is not supported in Gemini API. */
declare interface PartnerModelTuningSpec {
  /** Hyperparameters for tuning. The accepted hyper_parameters and their valid range of values will differ depending on the base model. */
  hyperParameters?: Record<string, unknown>;
  /** Required. Cloud Storage path to file containing training dataset for tuning. The dataset must be formatted as a JSONL file. */
  trainingDatasetUri?: string;
  /** Optional. Cloud Storage path to file containing validation dataset for tuning. The dataset must be formatted as a JSONL file. */
  validationDatasetUri?: string;
}
declare type PartUnion = Part | string;
declare class PermissionDeniedError extends APIError<403, Headers> {}
/** Enum that controls the generation of people. */
declare enum PersonGeneration {
  /**
   * Block generation of images of people.
   */
  DONT_ALLOW = "DONT_ALLOW",
  /**
   * Generate images of adults, but not children.
   */
  ALLOW_ADULT = "ALLOW_ADULT",
  /**
   * Generate images that include adults and children.
   */
  ALLOW_ALL = "ALLOW_ALL"
}
/** Sites with confidence level chosen & above this value will be blocked from the search results. This enum is not supported in Gemini API. */
declare enum PhishBlockThreshold {
  /**
   * Defaults to unspecified.
   */
  PHISH_BLOCK_THRESHOLD_UNSPECIFIED = "PHISH_BLOCK_THRESHOLD_UNSPECIFIED",
  /**
   * Blocks Low and above confidence URL that is risky.
   */
  BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE",
  /**
   * Blocks Medium and above confidence URL that is risky.
   */
  BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE",
  /**
   * Blocks High and above confidence URL that is risky.
   */
  BLOCK_HIGH_AND_ABOVE = "BLOCK_HIGH_AND_ABOVE",
  /**
   * Blocks Higher and above confidence URL that is risky.
   */
  BLOCK_HIGHER_AND_ABOVE = "BLOCK_HIGHER_AND_ABOVE",
  /**
   * Blocks Very high and above confidence URL that is risky.
   */
  BLOCK_VERY_HIGH_AND_ABOVE = "BLOCK_VERY_HIGH_AND_ABOVE",
  /**
   * Blocks Extremely high confidence URL that is risky.
   */
  BLOCK_ONLY_EXTREMELY_HIGH = "BLOCK_ONLY_EXTREMELY_HIGH"
}
/**
 * A place citation annotation.
 */
declare interface PlaceCitation {
  type: 'place_citation';
  /**
   * End of the attributed segment, exclusive.
   */
  end_index?: number;
  /**
   * Title of the place.
   */
  name?: string;
  /**
   * The ID of the place, in `places/{place_id}` format.
   */
  place_id?: string;
  /**
   * Snippets of reviews that are used to generate answers about the features of a
   * given place in Google Maps.
   */
  review_snippets?: Array<PlaceCitation.ReviewSnippet>;
  /**
   * Start of segment of the response that is attributed to this source.
   *
   * Index indicates the start of the segment, measured in bytes.
   */
  start_index?: number;
  /**
   * URI reference of the place.
   */
  url?: string;
}
declare namespace PlaceCitation {
  /**
   * Encapsulates a snippet of a user review that answers a question about the
   * features of a specific place in Google Maps.
   */
  interface ReviewSnippet {
    /**
     * The ID of the review snippet.
     */
    review_id?: string;
    /**
     * Title of the review.
     */
    title?: string;
    /**
     * A link that corresponds to the user review on Google Maps.
     */
    url?: string;
  }
}
/** Spec for pointwise metric result. This data type is not supported in Gemini API. */
declare interface PointwiseMetricResult {
  /** Output only. Spec for custom output. */
  customOutput?: CustomOutput;
  /** Output only. Explanation for pointwise metric score. */
  explanation?: string;
  /** Output only. Pointwise metric score. */
  score?: number;
}
/** Configuration for a prebuilt voice. */
declare interface PrebuiltVoiceConfig {
  /** The name of the prebuilt voice to use. */
  voiceName?: string;
}
/** Statistics computed for datasets used for preference optimization. This data type is not supported in Gemini API. */
declare interface PreferenceOptimizationDataStats {
  /** Output only. A partial sample of the indices (starting from 1) of the dropped examples. */
  droppedExampleIndices?: string[];
  /** Output only. For each index in `dropped_example_indices`, the user-facing reason why the example was dropped. */
  droppedExampleReasons?: string[];
  /** Output only. Dataset distributions for scores variance per example. */
  scoreVariancePerExampleDistribution?: DatasetDistribution;
  /** Output only. Dataset distributions for scores. */
  scoresDistribution?: DatasetDistribution;
  /** Output only. Number of billable tokens in the tuning dataset. */
  totalBillableTokenCount?: string;
  /** Output only. Number of examples in the tuning dataset. */
  tuningDatasetExampleCount?: string;
  /** Output only. Number of tuning steps for this Tuning Job. */
  tuningStepCount?: string;
  /** Output only. Sample user examples in the training dataset. */
  userDatasetExamples?: GeminiPreferenceExample[];
  /** Output only. Dataset distributions for the user input tokens. */
  userInputTokenDistribution?: DatasetDistribution;
  /** Output only. Dataset distributions for the user output tokens. */
  userOutputTokenDistribution?: DatasetDistribution;
}
/** Hyperparameters for Preference Optimization. This data type is not supported in Gemini API. */
declare interface PreferenceOptimizationHyperParameters {
  /** Optional. Adapter size for preference optimization. */
  adapterSize?: AdapterSize;
  /** Optional. Weight for KL Divergence regularization. */
  beta?: number;
  /** Optional. Number of complete passes the model makes over the entire training dataset during training. */
  epochCount?: string;
  /** Optional. Multiplier for adjusting the default learning rate. */
  learningRateMultiplier?: number;
}
/** Preference optimization tuning spec for tuning. */
declare interface PreferenceOptimizationSpec {
  /** Optional. If set to true, disable intermediate checkpoints for Preference Optimization and only the last checkpoint will be exported. Otherwise, enable intermediate checkpoints for Preference Optimization. Default is false. */
  exportLastCheckpointOnly?: boolean;
  /** Optional. Hyperparameters for Preference Optimization. */
  hyperParameters?: PreferenceOptimizationHyperParameters;
  /** Required. Cloud Storage path to file containing training dataset for preference optimization tuning. The dataset must be formatted as a JSONL file. */
  trainingDatasetUri?: string;
  /** Optional. Cloud Storage path to file containing validation dataset for preference optimization tuning. The dataset must be formatted as a JSONL file. */
  validationDatasetUri?: string;
}
/** A pre-tuned model for continuous tuning. This data type is not supported in Gemini API. */
declare interface PreTunedModel {
  /** Output only. The name of the base model this PreTunedModel was tuned from. */
  baseModel?: string;
  /** Optional. The source checkpoint id. If not specified, the default checkpoint will be used. */
  checkpointId?: string;
  /** The resource name of the Model. E.g., a model resource name with a specified version id or alias: `projects/{project}/locations/{location}/models/{model}@{version_id}` `projects/{project}/locations/{location}/models/{model}@{alias}` Or, omit the version id to use the default version: `projects/{project}/locations/{location}/models/{model}` */
  tunedModelName?: string;
}
/** Config for proactivity features. */
declare interface ProactivityConfig {
  /** If enabled, the model can reject responding to the last prompt. For
   example, this allows the model to ignore out of context speech or to stay
   silent if the user did not make a request, yet. */
  proactiveAudio?: boolean;
}
/** An image of the product. */
declare interface ProductImage {
  /** An image of the product to be recontextualized. */
  productImage?: Image_2;
}
/** Controls whether prominent people (celebrities) generation is allowed. If used with personGeneration, personGeneration enum would take precedence. For instance, if ALLOW_NONE is set, all person generation would be blocked. If this field is unspecified, the default behavior is to allow prominent people. This enum is not supported in Gemini API. */
declare enum ProminentPeople {
  /**
   * Unspecified value. The model will proceed with the default behavior, which is to allow generation of prominent people.
   */
  PROMINENT_PEOPLE_UNSPECIFIED = "PROMINENT_PEOPLE_UNSPECIFIED",
  /**
   * Allows the model to generate images of prominent people.
   */
  ALLOW_PROMINENT_PEOPLE = "ALLOW_PROMINENT_PEOPLE",
  /**
   * Prevents the model from generating images of prominent people.
   */
  BLOCK_PROMINENT_PEOPLE = "BLOCK_PROMINENT_PEOPLE"
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare type PromiseOrValue<T> = T | Promise<T>;
/** A RagChunk includes the content of a chunk of a RagFile, and associated metadata. This data type is not supported in Gemini API. */
declare interface RagChunk {
  /** If populated, represents where the chunk starts and ends in the document. */
  pageSpan?: RagChunkPageSpan;
  /** The content of the chunk. */
  text?: string;
  /** The ID of the chunk. */
  chunkId?: string;
  /** The ID of the file that the chunk belongs to. */
  fileId?: string;
}
/** Represents where the chunk starts and ends in the document. This data type is not supported in Gemini API. */
declare interface RagChunkPageSpan {
  /** Page where chunk starts in the document. Inclusive. 1-indexed. */
  firstPage?: number;
  /** Page where chunk ends in the document. Inclusive. 1-indexed. */
  lastPage?: number;
}
/** Specifies the context retrieval config. This data type is not supported in Gemini API. */
declare interface RagRetrievalConfig {
  /** Optional. Config for filters. */
  filter?: RagRetrievalConfigFilter;
  /** Optional. Config for Hybrid Search. */
  hybridSearch?: RagRetrievalConfigHybridSearch;
  /** Optional. Config for ranking and reranking. */
  ranking?: RagRetrievalConfigRanking;
  /** Optional. The number of contexts to retrieve. */
  topK?: number;
}
/** Config for filters. This data type is not supported in Gemini API. */
declare interface RagRetrievalConfigFilter {
  /** Optional. String for metadata filtering. */
  metadataFilter?: string;
  /** Optional. Only returns contexts with vector distance smaller than the threshold. */
  vectorDistanceThreshold?: number;
  /** Optional. Only returns contexts with vector similarity larger than the threshold. */
  vectorSimilarityThreshold?: number;
}
/** Config for Hybrid Search. This data type is not supported in Gemini API. */
declare interface RagRetrievalConfigHybridSearch {
  /** Optional. Alpha value controls the weight between dense and sparse vector search results. The range is [0, 1], while 0 means sparse vector search only and 1 means dense vector search only. The default value is 0.5 which balances sparse and dense vector search equally. */
  alpha?: number;
}
/** Config for ranking and reranking. This data type is not supported in Gemini API. */
declare interface RagRetrievalConfigRanking {
  /** Optional. Config for LlmRanker. */
  llmRanker?: RagRetrievalConfigRankingLlmRanker;
  /** Optional. Config for Rank Service. */
  rankService?: RagRetrievalConfigRankingRankService;
}
/** Config for LlmRanker. This data type is not supported in Gemini API. */
declare interface RagRetrievalConfigRankingLlmRanker {
  /** Optional. The model name used for ranking. See [Supported models](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#supported-models). */
  modelName?: string;
}
/** Config for Rank Service. This data type is not supported in Gemini API. */
declare interface RagRetrievalConfigRankingRankService {
  /** Optional. The model name of the rank service. Format: `semantic-ranker-512@latest` */
  modelName?: string;
}
declare class RateLimitError extends APIError<429, Headers> {}
/** Raw output. This data type is not supported in Gemini API. */
declare interface RawOutput {
  /** Output only. Raw output string. */
  rawOutput?: string[];
}
/** A raw reference image.

 A raw reference image represents the base image to edit, provided by the user.
 It can optionally be provided in addition to a mask reference image or
 a style reference image. */
declare class RawReferenceImage {
  /** The reference image for the editing operation. */
  referenceImage?: Image_2;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Internal method to convert to ReferenceImageAPIInternal. */
  toReferenceImageAPI(): ReferenceImageAPIInternal;
}
declare type _ReadableStream_2<R = any> = NeverToAny<([0] extends [1 & _DOMReadableStream<R>] ? never : _DOMReadableStream<R>) | ([0] extends [1 & _ConditionalNodeReadableStream<R>] ? never : _ConditionalNodeReadableStream<R>)>;
/** Marks the end of user activity.

 This can only be sent if automatic (i.e. server-side) activity detection is
 disabled. */
declare interface RealtimeInputConfig {
  /** If not set, automatic activity detection is enabled by default. If automatic voice detection is disabled, the client must send activity signals. */
  automaticActivityDetection?: AutomaticActivityDetection;
  /** Defines what effect activity has. */
  activityHandling?: ActivityHandling;
  /** Defines which input is included in the user's turn. */
  turnCoverage?: TurnCoverage;
}
/** Configuration for recontextualizing an image. */
declare interface RecontextImageConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Number of images to generate. */
  numberOfImages?: number;
  /** The number of sampling steps. A higher value has better image
   quality, while a lower value has better latency. */
  baseSteps?: number;
  /** Cloud Storage URI used to store the generated images. */
  outputGcsUri?: string;
  /** Random seed for image generation. */
  seed?: number;
  /** Filter level for safety filtering. */
  safetyFilterLevel?: SafetyFilterLevel;
  /** Whether allow to generate person images, and restrict to specific
   ages. */
  personGeneration?: PersonGeneration;
  /** Whether to add a SynthID watermark to the generated images. */
  addWatermark?: boolean;
  /** MIME type of the generated image. */
  outputMimeType?: string;
  /** Compression quality of the generated image (for ``image/jpeg``
   only). */
  outputCompressionQuality?: number;
  /** Whether to use the prompt rewriting logic. */
  enhancePrompt?: boolean;
  /** User specified labels to track billing usage. */
  labels?: Record<string, string>;
}
/** The parameters for recontextualizing an image. */
declare interface RecontextImageParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** A set of source input(s) for image recontextualization. */
  source: RecontextImageSource;
  /** Configuration for image recontextualization. */
  config?: RecontextImageConfig;
}
/** The output images response. */
declare class RecontextImageResponse {
  /** List of generated images. */
  generatedImages?: GeneratedImage[];
}
/** A set of source input(s) for image recontextualization. */
declare interface RecontextImageSource {
  /** A text prompt for guiding the model during image
   recontextualization. Not supported for Virtual Try-On. */
  prompt?: string;
  /** Image of the person or subject who will be wearing the
   product(s). */
  personImage?: Image_2;
  /** A list of product images. */
  productImages?: ProductImage[];
}
declare type ReferenceImage = RawReferenceImage | MaskReferenceImage | ControlReferenceImage | StyleReferenceImage | SubjectReferenceImage | ContentReferenceImage;
/** Private class that represents a Reference image that is sent to API. */
declare interface ReferenceImageAPIInternal {
  /** The reference image for the editing operation. */
  referenceImage?: types.Image;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Configuration for the mask reference image. */
  maskImageConfig?: types.MaskReferenceConfig;
  /** Configuration for the control reference image. */
  controlImageConfig?: types.ControlReferenceConfig;
  /** Configuration for the style reference image. */
  styleImageConfig?: types.StyleReferenceConfig;
  /** Configuration for the subject reference image. */
  subjectImageConfig?: types.SubjectReferenceConfig;
}
/** Used to override the default configuration. */
declare interface RegisterFilesConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
}
/** Generates the parameters for the private registerFiles method. */
declare interface RegisterFilesParameters {
  /**
   * The authentication object.
   */
  auth?: any;
  /**
   * The Google Cloud Storage URIs to register. Example: `gs://bucket/object`.
   */
  uris: string[];
  /** Used to override the default configuration. */
  config?: RegisterFilesConfig;
}
/** Response for the _register file method. */
declare class RegisterFilesResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** The registered files. */
  files?: File_2[];
}
/** Reinforcement tuning autorater scorer. */
declare interface ReinforcementTuningAutoraterScorer {
  /** Autorater config for evaluation. */
  autoraterConfig?: AutoraterConfig;
}
/** Represents a recorded session. */
declare interface ReplayFile {
  replayId?: string;
  interactions?: ReplayInteraction[];
}
/** Represents a single interaction, request and response in a replay. */
declare interface ReplayInteraction {
  request?: ReplayRequest;
  response?: ReplayResponse;
}
/** Represents a single request in a replay. */
declare interface ReplayRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  bodySegments?: Record<string, unknown>[];
}
/** Represents a single response in a replay. */
declare class ReplayResponse {
  statusCode?: number;
  headers?: Record<string, string>;
  bodySegments?: Record<string, unknown>[];
  sdkResponseSegments?: Record<string, unknown>[];
}
/** The configuration for the replicated voice to use. */
declare interface ReplicatedVoiceConfig {
  /** The mimetype of the voice sample. The only currently supported
   value is `audio/wav`. This represents 16-bit signed little-endian wav
   data, with a 24kHz sampling rate.
   */
  mimeType?: string;
  /** The sample of the custom voice.
     * @remarks Encoded as base64 string. */
  voiceSampleAudio?: string;
}
/**
 * The type for the first argument to `fetch`.
 *
 * https://developer.mozilla.org/docs/Web/API/Window/fetch#resource
 */
declare type _RequestInfo = Request | URL | string;
/**
 * An alias to the builtin `RequestInit` type so we can
 * easily alias it in import statements if there are name clashes.
 *
 * https://developer.mozilla.org/docs/Web/API/RequestInit
 */
declare type _RequestInit = RequestInit;
declare type RequestInits = NotAny<UndiciTypesRequestInit> | NotAny<UndiciRequestInit> | NotAny<BunRequestInit> | NotAny<NodeFetch2RequestInit> | NotAny<NodeFetch3RequestInit> | NotAny<RequestInit> | NotAny<FetchRequestInit>;
declare type RequestOptions$2 = {
  /**
   * The HTTP method for the request (e.g., 'get', 'post', 'put', 'delete').
   */
  method?: HTTPMethod;
  /**
   * The URL path for the request.
   *
   * @example "/v1/foo"
   */
  path?: string;
  /**
   * Query parameters to include in the request URL.
   */
  query?: object | undefined | null;
  /**
   * The request body. Can be a string, JSON object, FormData, or other supported types.
   */
  body?: unknown;
  /**
   * HTTP headers to include with the request. Can be a Headers object, plain object, or array of tuples.
   */
  headers?: HeadersLike;
  /**
   * The maximum number of times that the client will retry a request in case of a
   * temporary failure, like a network error or a 5XX error from the server.
   *
   * @default 2
   */
  maxRetries?: number;
  stream?: boolean | undefined;
  /**
   * The maximum amount of time (in milliseconds) that the client should wait for a response
   * from the server before timing out a single request.
   *
   * @unit milliseconds
   */
  timeout?: number;
  /**
   * Additional `RequestInit` options to be passed to the underlying `fetch` call.
   * These options will be merged with the client's default fetch options.
   */
  fetchOptions?: MergedRequestInit;
  /**
   * An AbortSignal that can be used to cancel the request.
   */
  signal?: AbortSignal | undefined | null;
  /**
   * A unique key for this request to enable idempotency.
   */
  idempotencyKey?: string;
  /**
   * Override the default base URL for this specific request.
   */
  defaultBaseURL?: string | undefined;
  __binaryResponse?: boolean | undefined;
  __streamClass?: typeof Stream$1;
};
/** Resource scope. */
declare enum ResourceScope {
  /**
   * When setting base_url, this value configures resource scope to be the collection.
   The resource name will not include api version, project, or location.
   For example, if base_url is set to "https://aiplatform.googleapis.com",
   then the resource name for a Model would be
   "https://aiplatform.googleapis.com/publishers/google/models/gemini-3-pro-preview
   */
  COLLECTION = "COLLECTION"
}
/** Defines a retrieval tool that model can call to access external knowledge. This data type is not supported in Gemini API. */
declare interface Retrieval {
  /** Optional. Deprecated. This option is no longer supported. */
  disableAttribution?: boolean;
  /** Use data source powered by external API for grounding. */
  externalApi?: ExternalApi;
  /** Set to use data source powered by Vertex AI Search. */
  vertexAiSearch?: VertexAISearch;
  /** Set to use data source powered by Vertex RAG store. User data is uploaded via the VertexRagDataService. */
  vertexRagStore?: VertexRagStore;
}
/** Retrieval config. */
declare interface RetrievalConfig {
  /** The location of the user. */
  latLng?: LatLng;
  /** The language code of the user. */
  languageCode?: string;
}
/** Metadata returned to client when grounding is enabled. */
declare interface RetrievalMetadata {
  /** Optional. Score indicating how likely information from google
   search could help answer the prompt. The score is in the range [0, 1],
   where 0 is the least likely and 1 is the most likely. This score is only
   populated when google search grounding and dynamic retrieval is enabled.
   It will be compared to the threshold to determine whether to trigger
   Google search. */
  googleSearchDynamicRetrievalScore?: number;
}
/** Rouge metric value for an instance. This data type is not supported in Gemini API. */
declare interface RougeMetricValue {
  /** Output only. Rouge score. */
  score?: number;
}
/** Safety attributes of a GeneratedImage or the user-provided prompt. */
declare interface SafetyAttributes {
  /** List of RAI categories. */
  categories?: string[];
  /** List of scores of each categories. */
  scores?: number[];
  /** Internal use only. */
  contentType?: string;
}
/** Enum that controls the safety filter level for objectionable content. */
declare enum SafetyFilterLevel {
  BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE",
  BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE",
  BLOCK_ONLY_HIGH = "BLOCK_ONLY_HIGH",
  BLOCK_NONE = "BLOCK_NONE"
}
/** A safety rating for a piece of content. The safety rating contains the harm category and the harm probability level. */
declare interface SafetyRating {
  /** Output only. Indicates whether the content was blocked because of this rating. */
  blocked?: boolean;
  /** Output only. The harm category of this rating. */
  category?: HarmCategory;
  /** Output only. The overwritten threshold for the safety category of Gemini 2.0 image out. If minors are detected in the output image, the threshold of each safety category will be overwritten if user sets a lower threshold. This field is not supported in Gemini API. */
  overwrittenThreshold?: HarmBlockThreshold;
  /** Output only. The probability of harm for this category. */
  probability?: HarmProbability;
  /** Output only. The probability score of harm for this category. This field is not supported in Gemini API. */
  probabilityScore?: number;
  /** Output only. The severity of harm for this category. This field is not supported in Gemini API. */
  severity?: HarmSeverity;
  /** Output only. The severity score of harm for this category. This field is not supported in Gemini API. */
  severityScore?: number;
}
/** A safety setting that affects the safety-blocking behavior. A SafetySetting consists of a harm category and a threshold for that category. */
declare interface SafetySetting {
  /** Required. The harm category to be blocked. */
  category?: HarmCategory;
  /** Optional. The method for blocking content. If not specified, the default behavior is to use the probability score. This field is not supported in Gemini API. */
  method?: HarmBlockMethod;
  /** Required. The threshold for blocking content. If the harm probability exceeds this threshold, the content will be blocked. */
  threshold?: HarmBlockThreshold;
}
/** Scale of the generated music. */
declare enum Scale {
  /**
   * Default value. This value is unused.
   */
  SCALE_UNSPECIFIED = "SCALE_UNSPECIFIED",
  /**
   * C major or A minor.
   */
  C_MAJOR_A_MINOR = "C_MAJOR_A_MINOR",
  /**
   * Db major or Bb minor.
   */
  D_FLAT_MAJOR_B_FLAT_MINOR = "D_FLAT_MAJOR_B_FLAT_MINOR",
  /**
   * D major or B minor.
   */
  D_MAJOR_B_MINOR = "D_MAJOR_B_MINOR",
  /**
   * Eb major or C minor
   */
  E_FLAT_MAJOR_C_MINOR = "E_FLAT_MAJOR_C_MINOR",
  /**
   * E major or Db minor.
   */
  E_MAJOR_D_FLAT_MINOR = "E_MAJOR_D_FLAT_MINOR",
  /**
   * F major or D minor.
   */
  F_MAJOR_D_MINOR = "F_MAJOR_D_MINOR",
  /**
   * Gb major or Eb minor.
   */
  G_FLAT_MAJOR_E_FLAT_MINOR = "G_FLAT_MAJOR_E_FLAT_MINOR",
  /**
   * G major or E minor.
   */
  G_MAJOR_E_MINOR = "G_MAJOR_E_MINOR",
  /**
   * Ab major or F minor.
   */
  A_FLAT_MAJOR_F_MINOR = "A_FLAT_MAJOR_F_MINOR",
  /**
   * A major or Gb minor.
   */
  A_MAJOR_G_FLAT_MINOR = "A_MAJOR_G_FLAT_MINOR",
  /**
   * Bb major or G minor.
   */
  B_FLAT_MAJOR_G_MINOR = "B_FLAT_MAJOR_G_MINOR",
  /**
   * B major or Ab minor.
   */
  B_MAJOR_A_FLAT_MINOR = "B_MAJOR_A_FLAT_MINOR"
}
/** Schema is used to define the format of input/output data.

 Represents a select subset of an [OpenAPI 3.0 schema
 object](https://spec.openapis.org/oas/v3.0.3#schema-object). More fields may
 be added in the future as needed. */
declare interface Schema {
  /** Optional. The instance must be valid against any (one or more) of the subschemas listed in `any_of`. */
  anyOf?: Schema[];
  /** Optional. Default value to use if the field is not specified. */
  default?: unknown;
  /** Optional. Describes the data. The model uses this field to understand the purpose of the schema and how to use it. It is a best practice to provide a clear and descriptive explanation for the schema and its properties here, rather than in the prompt. */
  description?: string;
  /** Optional. Possible values of the field. This field can be used to restrict a value to a fixed set of values. To mark a field as an enum, set `format` to `enum` and provide the list of possible values in `enum`. For example: 1. To define directions: `{type:STRING, format:enum, enum:["EAST", "NORTH", "SOUTH", "WEST"]}` 2. To define apartment numbers: `{type:INTEGER, format:enum, enum:["101", "201", "301"]}` */
  enum?: string[];
  /** Optional. Example of an instance of this schema. */
  example?: unknown;
  /** Optional. The format of the data. For `NUMBER` type, format can be `float` or `double`. For `INTEGER` type, format can be `int32` or `int64`. For `STRING` type, format can be `email`, `byte`, `date`, `date-time`, `password`, and other formats to further refine the data type. */
  format?: string;
  /** Optional. If type is `ARRAY`, `items` specifies the schema of elements in the array. */
  items?: Schema;
  /** Optional. If type is `ARRAY`, `max_items` specifies the maximum number of items in an array. */
  maxItems?: string;
  /** Optional. If type is `STRING`, `max_length` specifies the maximum length of the string. */
  maxLength?: string;
  /** Optional. If type is `OBJECT`, `max_properties` specifies the maximum number of properties that can be provided. */
  maxProperties?: string;
  /** Optional. If type is `INTEGER` or `NUMBER`, `maximum` specifies the maximum allowed value. */
  maximum?: number;
  /** Optional. If type is `ARRAY`, `min_items` specifies the minimum number of items in an array. */
  minItems?: string;
  /** Optional. If type is `STRING`, `min_length` specifies the minimum length of the string. */
  minLength?: string;
  /** Optional. If type is `OBJECT`, `min_properties` specifies the minimum number of properties that can be provided. */
  minProperties?: string;
  /** Optional. If type is `INTEGER` or `NUMBER`, `minimum` specifies the minimum allowed value. */
  minimum?: number;
  /** Optional. Indicates if the value of this field can be null. */
  nullable?: boolean;
  /** Optional. If type is `STRING`, `pattern` specifies a regular expression that the string must match. */
  pattern?: string;
  /** Optional. If type is `OBJECT`, `properties` is a map of property names to schema definitions for each property of the object. */
  properties?: Record<string, Schema>;
  /** Optional. Order of properties displayed or used where order matters. This is not a standard field in OpenAPI specification, but can be used to control the order of properties. */
  propertyOrdering?: string[];
  /** Optional. If type is `OBJECT`, `required` lists the names of properties that must be present. */
  required?: string[];
  /** Optional. Title for the schema. */
  title?: string;
  /** Optional. Data type of the schema field. */
  type?: Type;
}
declare type SchemaUnion = Schema | unknown;
/** An image mask representing a brush scribble. */
declare interface ScribbleImage {
  /** The brush scribble to guide segmentation. Valid for the interactive mode. */
  image?: Image_2;
}
/** The entry point used to search for grounding sources. */
declare interface SearchEntryPoint {
  /** Optional. Web content snippet that can be embedded in a web page
   or an app webview. */
  renderedContent?: string;
  /** Optional. JSON representing array of tuples.
   * @remarks Encoded as base64 string. */
  sdkBlob?: string;
}
/** Different types of search that can be enabled on the GoogleSearch tool. */
declare interface SearchTypes {
  /** Optional. Setting this field enables web search. Only text results are returned. */
  webSearch?: WebSearch;
  /** Optional. Setting this field enables image search. Image bytes are returned. */
  imageSearch?: ImageSearch;
}
/** Segment of the content this support belongs to. */
declare interface Segment {
  /** Output only. Start index in the given Part, measured in bytes.
     Offset from the start of the Part, inclusive, starting at zero. */
  startIndex?: number;
  /** Output only. End index in the given Part, measured in bytes.
     Offset from the start of the Part, exclusive, starting at zero. */
  endIndex?: number;
  /** Output only. The index of a Part object within its parent
   Content object. */
  partIndex?: number;
  /** Output only. The text corresponding to the segment from the
   response. */
  text?: string;
}
/** Configuration for segmenting an image. */
declare interface SegmentImageConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The segmentation mode to use. */
  mode?: SegmentMode;
  /** The maximum number of predictions to return up to, by top
   confidence score. */
  maxPredictions?: number;
  /** The confidence score threshold for the detections as a decimal
   value. Only predictions with a confidence score higher than this
   threshold will be returned. */
  confidenceThreshold?: number;
  /** A decimal value representing how much dilation to apply to the
   masks. 0 for no dilation. 1.0 means the masked area covers the whole
   image. */
  maskDilation?: number;
  /** The binary color threshold to apply to the masks. The threshold
   can be set to a decimal value between 0 and 255 non-inclusive.
   Set to -1 for no binary color thresholding. */
  binaryColorThreshold?: number;
  /** User specified labels to track billing usage. */
  labels?: Record<string, string>;
}
/** The parameters for segmenting an image. */
declare interface SegmentImageParameters {
  /** ID of the model to use. For a list of models, see `Google models
   <https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models>`_. */
  model: string;
  /** A set of source input(s) for image segmentation. */
  source: SegmentImageSource;
  /** Configuration for image segmentation. */
  config?: SegmentImageConfig;
}
/** The output images response. */
declare class SegmentImageResponse {
  /** List of generated image masks.
   */
  generatedMasks?: GeneratedImageMask[];
}
/** A set of source input(s) for image segmentation. */
declare interface SegmentImageSource {
  /** A text prompt for guiding the model during image segmentation.
   Required for prompt mode and semantic mode, disallowed for other modes. */
  prompt?: string;
  /** The image to be segmented. */
  image?: Image_2;
  /** The brush scribble to guide segmentation.
   Required for the interactive mode, disallowed for other modes. */
  scribbleImage?: ScribbleImage;
}
/** Enum that represents the segmentation mode. */
declare enum SegmentMode {
  FOREGROUND = "FOREGROUND",
  BACKGROUND = "BACKGROUND",
  PROMPT = "PROMPT",
  SEMANTIC = "SEMANTIC",
  INTERACTIVE = "INTERACTIVE"
}
/** Parameters for sending a message within a chat session.

 These parameters are used with the `chat.sendMessage()` method. */
declare interface SendMessageParameters {
  /** The message to send to the model.
     The SDK will combine all parts into a single 'user' content to send to
   the model.
   */
  message: PartListUnion;
  /**  Config for this specific request.
     Please note that the per-request config does not change the chat level
   config, nor inherit from it. If you intend to use some values from the
   chat's default config, you must explicitly copy them into this per-request
   config.
   */
  config?: GenerateContentConfig;
}
/** Pricing and performance service tier. */
declare enum ServiceTier {
  /**
   * Default service tier, which is standard.
   */
  UNSPECIFIED = "unspecified",
  /**
   * Flex service tier.
   */
  FLEX = "flex",
  /**
   * Standard service tier.
   */
  STANDARD = "standard",
  /**
   * Priority service tier.
   */
  PRIORITY = "priority"
}
/**
 Represents a connection to the API.

 @experimental
 */
declare class Session {
  readonly conn: WebSocket_2;
  private readonly apiClient;
  constructor(conn: WebSocket_2, apiClient: ApiClient);
  private tLiveClientContent;
  private tLiveClienttToolResponse;
  /**
   Send a message over the established connection.
     @param params - Contains two **optional** properties, `turns` and
   `turnComplete`.
     - `turns` will be converted to a `Content[]`
   - `turnComplete: true` [default] indicates that you are done sending
   content and expect a response. If `turnComplete: false`, the server
   will wait for additional messages before starting generation.
     @experimental
     @remarks
   There are two ways to send messages to the live API:
   `sendClientContent` and `sendRealtimeInput`.
     `sendClientContent` messages are added to the model context **in order**.
   Having a conversation using `sendClientContent` messages is roughly
   equivalent to using the `Chat.sendMessageStream`, except that the state of
   the `chat` history is stored on the API server instead of locally.
     Because of `sendClientContent`'s order guarantee, the model cannot respons
   as quickly to `sendClientContent` messages as to `sendRealtimeInput`
   messages. This makes the biggest difference when sending objects that have
   significant preprocessing time (typically images).
     The `sendClientContent` message sends a `Content[]`
   which has more options than the `Blob` sent by `sendRealtimeInput`.
     So the main use-cases for `sendClientContent` over `sendRealtimeInput` are:
     - Sending anything that can't be represented as a `Blob` (text,
   `sendClientContent({turns="Hello?"}`)).
   - Managing turns when not using audio input and voice activity detection.
   (`sendClientContent({turnComplete:true})` or the short form
   `sendClientContent()`)
   - Prefilling a conversation context
   ```
   sendClientContent({
   turns: [
   Content({role:user, parts:...}),
   Content({role:user, parts:...}),
   ...
   ]
   })
   ```
   @experimental
   */
  sendClientContent(params: types.LiveSendClientContentParameters): void;
  /**
   Send a realtime message over the established connection.
     @param params - Contains one property, `media`.
     - `media` will be converted to a `Blob`
     @experimental
     @remarks
   Use `sendRealtimeInput` for realtime audio chunks and video frames (images).
     With `sendRealtimeInput` the api will respond to audio automatically
   based on voice activity detection (VAD).
     `sendRealtimeInput` is optimized for responsivness at the expense of
   deterministic ordering guarantees. Audio and video tokens are to the
   context when they become available.
     Note: The Call signature expects a `Blob` object, but only a subset
   of audio and image mimetypes are allowed.
   */
  sendRealtimeInput(params: types.LiveSendRealtimeInputParameters): void;
  /**
   Send a function response message over the established connection.
     @param params - Contains property `functionResponses`.
     - `functionResponses` will be converted to a `functionResponses[]`
     @remarks
   Use `sendFunctionResponse` to reply to `LiveServerToolCall` from the server.
     Use {@link types.LiveConnectConfig#tools} to configure the callable functions.
     @experimental
   */
  sendToolResponse(params: types.LiveSendToolResponseParameters): void;
  /**
   Terminates the WebSocket connection.
     @experimental
     @example
   ```ts
   let model: string;
   if (GOOGLE_GENAI_USE_VERTEXAI) {
   model = 'gemini-2.0-flash-live-preview-04-09';
   } else {
   model = 'gemini-live-2.5-flash-preview';
   }
   const session = await ai.live.connect({
   model: model,
   config: {
   responseModalities: [Modality.AUDIO],
   }
   });
     session.close();
   ```
   */
  close(): void;
}
/** Configuration of session resumption mechanism.

 Included in `LiveConnectConfig.session_resumption`. If included server
 will send `LiveServerSessionResumptionUpdate` messages. */
declare interface SessionResumptionConfig {
  /** Session resumption handle of previous session (session to restore).
     If not present new session will be started. */
  handle?: string;
  /** If set the server will send `last_consumed_client_message_index` in the `session_resumption_update` messages to allow for transparent reconnections. */
  transparent?: boolean;
}
/**
 * Represents a signing secret used to verify webhook payloads.
 */
declare interface SigningSecret {
  /**
   * Output only. The expiration date of the signing secret.
   */
  expire_time?: string;
  /**
   * Output only. The truncated version of the signing secret.
   */
  truncated_secret?: string;
}
/** Config for `response` parameter. */
declare class SingleEmbedContentResponse {
  /** The response to the request.
   */
  embedding?: ContentEmbedding;
  /** The error encountered while processing the request.
   */
  tokenCount?: string;
}
/** Single reinforcement tuning reward config. */
declare interface SingleReinforcementTuningRewardConfig {
  autoraterScorer?: ReinforcementTuningAutoraterScorer;
}
/** Context window will be truncated by keeping only suffix of it.

 Context window will always be cut at start of USER role turn. System
 instructions and `BidiGenerateContentSetup.prefix_turns` will not be
 subject to the sliding window mechanism, they will always stay at the
 beginning of context window. */
declare interface SlidingWindow {
  /** Session reduction target -- how many tokens we should keep. Window shortening operation has some latency costs, so we should avoid running it on every turn. Should be < trigger_tokens. If not set, trigger_tokens/2 is assumed. */
  targetTokens?: string;
}
/** Configuration for a single speaker in a multi-speaker setup. */
declare interface SpeakerVoiceConfig {
  /** Required. The name of the speaker. This should be the same as the speaker name used in the prompt. */
  speaker?: string;
  /** Required. The configuration for the voice of this speaker. */
  voiceConfig?: VoiceConfig;
}
/** Config for speech generation and transcription. */
declare interface SpeechConfig {
  /** The configuration in case of single-voice output. */
  voiceConfig?: VoiceConfig;
  /** Optional. The language code (ISO 639-1) for the speech synthesis. */
  languageCode?: string;
  /** The configuration for a multi-speaker text-to-speech request. This field is mutually exclusive with `voice_config`. */
  multiSpeakerVoiceConfig?: MultiSpeakerVoiceConfig;
}
/**
 * The configuration for speech interaction.
 */
declare interface SpeechConfig_2 {
  /**
   * The language of the speech.
   */
  language?: string;
  /**
   * The speaker's name, it should match the speaker name given in the prompt.
   */
  speaker?: string;
  /**
   * The voice of the speaker.
   */
  voice?: string;
}
declare type SpeechConfigUnion = SpeechConfig | string;
/** Start of speech sensitivity. */
declare enum StartSensitivity {
  /**
   * The default is START_SENSITIVITY_LOW.
   */
  START_SENSITIVITY_UNSPECIFIED = "START_SENSITIVITY_UNSPECIFIED",
  /**
   * Automatic detection will detect the start of speech more often.
   */
  START_SENSITIVITY_HIGH = "START_SENSITIVITY_HIGH",
  /**
   * Automatic detection will detect the start of speech less often.
   */
  START_SENSITIVITY_LOW = "START_SENSITIVITY_LOW"
}
/**
 * A step in the interaction.
 */
declare type Step = UserInputStep | ModelOutputStep | ThoughtStep | FunctionCallStep | CodeExecutionCallStep | URLContextCallStep | MCPServerToolCallStep | GoogleSearchCallStep | FileSearchCallStep | GoogleMapsCallStep | FunctionResultStep | CodeExecutionResultStep | URLContextResultStep | GoogleSearchResultStep | MCPServerToolResultStep | FileSearchResultStep | GoogleMapsResultStep;
declare interface StepDelta {
  delta: StepDelta.Text | StepDelta.Image | StepDelta.Audio | StepDelta.Document | StepDelta.Video | StepDelta.ThoughtSummary | StepDelta.ThoughtSignature | StepDelta.TextAnnotationDelta | StepDelta.ArgumentsDelta | StepDelta.CodeExecutionCall | StepDelta.URLContextCall | StepDelta.GoogleSearchCall | StepDelta.MCPServerToolCall | StepDelta.FileSearchCall | StepDelta.GoogleMapsCall | StepDelta.CodeExecutionResult | StepDelta.URLContextResult | StepDelta.GoogleSearchResult | StepDelta.MCPServerToolResult | StepDelta.FileSearchResult | StepDelta.GoogleMapsResult | StepDelta.FunctionResult;
  event_type: 'step.delta';
  index: number;
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: StepDelta.Metadata;
}
declare namespace StepDelta {
  interface Text {
    text: string;
    type: 'text';
  }
  interface Image {
    type: 'image';
    data?: string;
    mime_type?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/heic' | 'image/heif' | 'image/gif' | 'image/bmp' | 'image/tiff';
    /**
     * The resolution of the media.
     */
    resolution?: 'low' | 'medium' | 'high' | 'ultra_high';
    uri?: string;
  }
  interface Audio {
    type: 'audio';
    /**
     * The number of audio channels.
     */
    channels?: number;
    data?: string;
    mime_type?: 'audio/wav' | 'audio/mp3' | 'audio/aiff' | 'audio/aac' | 'audio/ogg' | 'audio/flac' | 'audio/mpeg' | 'audio/m4a' | 'audio/l16' | 'audio/opus' | 'audio/alaw' | 'audio/mulaw';
    /**
     * @deprecated Deprecated. Use sample_rate instead. The value is ignored.
     */
    rate?: number;
    /**
     * The sample rate of the audio.
     */
    sample_rate?: number;
    uri?: string;
  }
  interface Document {
    type: 'document';
    data?: string;
    mime_type?: 'application/pdf' | 'text/csv';
    uri?: string;
  }
  interface Video {
    type: 'video';
    data?: string;
    mime_type?: 'video/mp4' | 'video/mpeg' | 'video/mpg' | 'video/mov' | 'video/avi' | 'video/x-flv' | 'video/webm' | 'video/wmv' | 'video/3gpp';
    /**
     * The resolution of the media.
     */
    resolution?: 'low' | 'medium' | 'high' | 'ultra_high';
    uri?: string;
  }
  interface ThoughtSummary {
    type: 'thought_summary';
    /**
     * A new summary item to be added to the thought.
     */
    content?: InteractionsAPI.TextContent | InteractionsAPI.ImageContent;
  }
  interface ThoughtSignature {
    type: 'thought_signature';
    /**
     * Signature to match the backend source to be part of the generation.
     */
    signature?: string;
  }
  interface TextAnnotationDelta {
    type: 'text_annotation_delta';
    /**
     * Citation information for model-generated content.
     */
    annotations?: Array<InteractionsAPI.Annotation>;
  }
  interface ArgumentsDelta {
    type: 'arguments_delta';
    arguments?: string;
  }
  interface CodeExecutionCall {
    /**
     * The arguments to pass to the code execution.
     */
    arguments: InteractionsAPI.CodeExecutionCallArguments;
    type: 'code_execution_call';
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface URLContextCall {
    /**
     * The arguments to pass to the URL context.
     */
    arguments: InteractionsAPI.URLContextCallArguments;
    type: 'url_context_call';
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface GoogleSearchCall {
    /**
     * The arguments to pass to Google Search.
     */
    arguments: InteractionsAPI.GoogleSearchCallArguments;
    type: 'google_search_call';
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface MCPServerToolCall {
    arguments: {
      [key: string]: unknown;
    };
    name: string;
    server_name: string;
    type: 'mcp_server_tool_call';
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface FileSearchCall {
    type: 'file_search_call';
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface GoogleMapsCall {
    type: 'google_maps_call';
    /**
     * The arguments to pass to the Google Maps tool.
     */
    arguments?: InteractionsAPI.GoogleMapsCallArguments;
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface CodeExecutionResult {
    result: string;
    type: 'code_execution_result';
    is_error?: boolean;
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface URLContextResult {
    result: Array<InteractionsAPI.URLContextResult>;
    type: 'url_context_result';
    is_error?: boolean;
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface GoogleSearchResult {
    result: Array<InteractionsAPI.GoogleSearchResult>;
    type: 'google_search_result';
    is_error?: boolean;
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface MCPServerToolResult {
    result: unknown | Array<InteractionsAPI.TextContent | InteractionsAPI.ImageContent> | string;
    type: 'mcp_server_tool_result';
    name?: string;
    server_name?: string;
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface FileSearchResult {
    result: Array<unknown>;
    type: 'file_search_result';
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface GoogleMapsResult {
    type: 'google_maps_result';
    /**
     * The results of the Google Maps.
     */
    result?: Array<InteractionsAPI.GoogleMapsResult>;
    /**
     * A signature hash for backend validation.
     */
    signature?: string;
  }
  interface FunctionResult {
    /**
     * Required. ID to match the ID from the function call block.
     */
    call_id: string;
    result: unknown | Array<InteractionsAPI.TextContent | InteractionsAPI.ImageContent> | string;
    type: 'function_result';
    is_error?: boolean;
    name?: string;
  }
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
declare interface StepStart {
  event_type: 'step.start';
  index: number;
  /**
   * A step in the interaction.
   */
  step: Step;
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: StepStart.Metadata;
}
declare namespace StepStart {
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
declare interface StepStop {
  event_type: 'step.stop';
  index: number;
  /**
   * The event_id token to be used to resume the interaction stream, from this event.
   */
  event_id?: string;
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  metadata?: StepStop.Metadata;
}
declare namespace StepStop {
  /**
   * Optional metadata accompanying ANY streamed event.
   */
  interface Metadata {
    /**
     * Statistics on the interaction request's token usage.
     */
    usage?: InteractionsAPI.Usage;
  }
}
declare class Stream$1<Item> implements AsyncIterable<Item> {
  private iterator;
  controller: AbortController;
  private client;
  constructor(iterator: () => AsyncIterator<Item>, controller: AbortController, client?: BaseGeminiNextGenAPIClient);
  static fromSSEResponse<Item>(response: Response, controller: AbortController, client?: BaseGeminiNextGenAPIClient): Stream$1<Item>;
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream<Item>(readableStream: _ReadableStream_2, controller: AbortController, client?: BaseGeminiNextGenAPIClient): Stream$1<Item>;
  [Symbol.asyncIterator](): AsyncIterator<Item>;
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee(): [Stream$1<Item>, Stream$1<Item>];
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream(): _ReadableStream_2;
}
/** A transport that can stream HTTP requests and responses. Next ID: 6. This data type is not supported in Vertex AI. */
declare interface StreamableHttpTransport {
  /** Optional: Fields for authentication headers, timeouts, etc., if needed. */
  headers?: Record<string, string>;
  /** Timeout for SSE read operations. */
  sseReadTimeout?: string;
  /** Whether to close the client session when the transport closes. */
  terminateOnClose?: boolean;
  /** HTTP timeout for regular operations. */
  timeout?: string;
  /** The full URL for the MCPServer endpoint. Example: "https://api.example.com/mcp". */
  url?: string;
}
/** Config for stream translation. */
declare interface StreamTranslationConfig {
  /** If true, the model will generate audio when the target language is
   spoken, essentially it will parrot the input. If false, we will not produce
   audio for the target language. */
  echoTargetLanguage?: boolean;
  /** The target language for translation. Supported values are BCP-47
   language codes (e.g. "en", "es", "fr"). */
  targetLanguageCode?: string;
}
/** User provided string values assigned to a single metadata key. This data type is not supported in Vertex AI. */
declare interface StringList {
  /** The string values of the metadata to store. */
  values?: string[];
}
/** Configuration for a Style reference image. */
declare interface StyleReferenceConfig {
  /** A text description of the style to use for the generated image. */
  styleDescription?: string;
}
/** A style reference image.

 This encapsulates a style reference image provided by the user, and
 additionally optional config parameters for the style reference image.

 A raw reference image can also be provided as a destination for the style to
 be applied to. */
declare class StyleReferenceImage {
  /** The reference image for the editing operation. */
  referenceImage?: Image_2;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Configuration for the style reference image. */
  config?: StyleReferenceConfig;
  /** Internal method to convert to ReferenceImageAPIInternal. */
  toReferenceImageAPI(): ReferenceImageAPIInternal;
}
/** Configuration for a Subject reference image. */
declare interface SubjectReferenceConfig {
  /** The subject type of a subject reference image. */
  subjectType?: SubjectReferenceType;
  /** Subject description for the image. */
  subjectDescription?: string;
}
/** A subject reference image.

 This encapsulates a subject reference image provided by the user, and
 additionally optional config parameters for the subject reference image.

 A raw reference image can also be provided as a destination for the subject to
 be applied to. */
declare class SubjectReferenceImage {
  /** The reference image for the editing operation. */
  referenceImage?: Image_2;
  /** The id of the reference image. */
  referenceId?: number;
  /** The type of the reference image. Only set by the SDK. */
  referenceType?: string;
  /** Configuration for the subject reference image. */
  config?: SubjectReferenceConfig;
  toReferenceImageAPI(): ReferenceImageAPIInternal;
}
/** Enum representing the subject type of a subject reference image. */
declare enum SubjectReferenceType {
  SUBJECT_TYPE_DEFAULT = "SUBJECT_TYPE_DEFAULT",
  SUBJECT_TYPE_PERSON = "SUBJECT_TYPE_PERSON",
  SUBJECT_TYPE_ANIMAL = "SUBJECT_TYPE_ANIMAL",
  SUBJECT_TYPE_PRODUCT = "SUBJECT_TYPE_PRODUCT"
}
/** Hyperparameters for SFT. This data type is not supported in Gemini API. */
declare interface SupervisedHyperParameters {
  /** Optional. Adapter size for tuning. */
  adapterSize?: AdapterSize;
  /** Optional. Batch size for tuning. This feature is only available for open source models. */
  batchSize?: string;
  /** Optional. Number of complete passes the model makes over the entire training dataset during training. */
  epochCount?: string;
  /** Optional. Learning rate for tuning. Mutually exclusive with `learning_rate_multiplier`. This feature is only available for open source models. */
  learningRate?: number;
  /** Optional. Multiplier for adjusting the default learning rate. Mutually exclusive with `learning_rate`. This feature is only available for 1P models. */
  learningRateMultiplier?: number;
}
/** Dataset distribution for Supervised Tuning. This data type is not supported in Gemini API. */
declare interface SupervisedTuningDatasetDistribution {
  /** Output only. Sum of a given population of values that are billable. */
  billableSum?: string;
  /** Output only. Defines the histogram bucket. */
  buckets?: SupervisedTuningDatasetDistributionDatasetBucket[];
  /** Output only. The maximum of the population values. */
  max?: number;
  /** Output only. The arithmetic mean of the values in the population. */
  mean?: number;
  /** Output only. The median of the values in the population. */
  median?: number;
  /** Output only. The minimum of the population values. */
  min?: number;
  /** Output only. The 5th percentile of the values in the population. */
  p5?: number;
  /** Output only. The 95th percentile of the values in the population. */
  p95?: number;
  /** Output only. Sum of a given population of values. */
  sum?: string;
}
/** Dataset bucket used to create a histogram for the distribution given a population of values. This data type is not supported in Gemini API. */
declare interface SupervisedTuningDatasetDistributionDatasetBucket {
  /** Output only. Number of values in the bucket. */
  count?: number;
  /** Output only. Left bound of the bucket. */
  left?: number;
  /** Output only. Right bound of the bucket. */
  right?: number;
}
/** Tuning data statistics for Supervised Tuning. This data type is not supported in Gemini API. */
declare interface SupervisedTuningDataStats {
  /** Output only. For each index in `truncated_example_indices`, the user-facing reason why the example was dropped. */
  droppedExampleReasons?: string[];
  /** Output only. Number of billable characters in the tuning dataset. */
  totalBillableCharacterCount?: string;
  /** Output only. Number of billable tokens in the tuning dataset. */
  totalBillableTokenCount?: string;
  /** Output only. The number of examples in the dataset that have been dropped. An example can be dropped for reasons including: too many tokens, contains an invalid image, contains too many images, etc. */
  totalTruncatedExampleCount?: string;
  /** Output only. Number of tuning characters in the tuning dataset. */
  totalTuningCharacterCount?: string;
  /** Output only. A partial sample of the indices (starting from 1) of the dropped examples. */
  truncatedExampleIndices?: string[];
  /** Output only. Number of examples in the tuning dataset. */
  tuningDatasetExampleCount?: string;
  /** Output only. Number of tuning steps for this Tuning Job. */
  tuningStepCount?: string;
  /** Output only. Sample user messages in the training dataset uri. */
  userDatasetExamples?: Content[];
  /** Output only. Dataset distributions for the user input tokens. */
  userInputTokenDistribution?: SupervisedTuningDatasetDistribution;
  /** Output only. Dataset distributions for the messages per example. */
  userMessagePerExampleDistribution?: SupervisedTuningDatasetDistribution;
  /** Output only. Dataset distributions for the user output tokens. */
  userOutputTokenDistribution?: SupervisedTuningDatasetDistribution;
}
/** Supervised tuning spec for tuning. */
declare interface SupervisedTuningSpec {
  /** Optional. If set to true, disable intermediate checkpoints for SFT and only the last checkpoint will be exported. Otherwise, enable intermediate checkpoints for SFT. Default is false. */
  exportLastCheckpointOnly?: boolean;
  /** Optional. Hyperparameters for SFT. */
  hyperParameters?: SupervisedHyperParameters;
  /** Required. Training dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  trainingDatasetUri?: string;
  /** Tuning mode. */
  tuningMode?: TuningMode;
  /** Optional. Validation dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  validationDatasetUri?: string;
}
declare interface TestTableFile {
  comment?: string;
  testMethod?: string;
  parameterNames?: string[];
  testTable?: TestTableItem[];
}
declare interface TestTableItem {
  /** The name of the test. This is used to derive the replay id. */
  name?: string;
  /** The parameters to the test. Use pydantic models. */
  parameters?: Record<string, unknown>;
  /** Expects an exception for MLDev matching the string. */
  exceptionIfMldev?: string;
  /** Expects an exception for Vertex matching the string. */
  exceptionIfVertex?: string;
  /** Use if you don't want to use the default replay id which is derived from the test name. */
  overrideReplayId?: string;
  /** True if the parameters contain an unsupported union type. This test  will be skipped for languages that do not support the union type. */
  hasUnion?: boolean;
  /** When set to a reason string, this test will be skipped in the API mode. Use this flag for tests that can not be reproduced with the real API. E.g. a test that deletes a resource. */
  skipInApiMode?: string;
  /** Keys to ignore when comparing the request and response. This is useful for tests that are not deterministic. */
  ignoreKeys?: string[];
}
/**
 * A text content block.
 */
declare interface TextContent {
  /**
   * Required. The text content.
   */
  text: string;
  type: 'text';
  /**
   * Citation information for model-generated content.
   */
  annotations?: Array<Annotation>;
}
/**
 * Configuration for text output format.
 */
declare interface TextResponseFormat {
  type: 'text';
  /**
   * The MIME type of the text output.
   */
  mime_type?: 'application/json' | 'text/plain';
  /**
   * The JSON schema that the output should conform to. Only applicable when
   * mime_type is application/json.
   */
  schema?: {
    [key: string]: unknown;
  };
}
/** The thinking features configuration. */
declare interface ThinkingConfig {
  /** Indicates whether to include thoughts in the response. If true, thoughts are returned only if the model supports thought and thoughts are available.
   */
  includeThoughts?: boolean;
  /** Indicates the thinking budget in tokens. 0 is DISABLED. -1 is AUTOMATIC. The default values and allowed ranges are model dependent.
   */
  thinkingBudget?: number;
  /** Optional. The number of thoughts tokens that the model should generate. */
  thinkingLevel?: ThinkingLevel;
}
/** The number of thoughts tokens that the model should generate. */
declare enum ThinkingLevel {
  /**
   * Unspecified thinking level.
   */
  THINKING_LEVEL_UNSPECIFIED = "THINKING_LEVEL_UNSPECIFIED",
  /**
   * MINIMAL thinking level.
   */
  MINIMAL = "MINIMAL",
  /**
   * Low thinking level.
   */
  LOW = "LOW",
  /**
   * Medium thinking level.
   */
  MEDIUM = "MEDIUM",
  /**
   * High thinking level.
   */
  HIGH = "HIGH"
}
declare type ThinkingLevel_2 = 'minimal' | 'low' | 'medium' | 'high';
/**
 * A thought step.
 */
declare interface ThoughtStep {
  type: 'thought';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
  /**
   * A summary of the thought.
   */
  summary?: Array<TextContent | ImageContent>;
}
declare class Tokens extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Creates an ephemeral auth token resource.
   *
   * @experimental
   *
   * @remarks
   * Ephemeral auth tokens is only supported in the Gemini Developer API.
   * It can be used for the session connection to the Live constrained API.
   * Support in v1alpha only.
   *
   * @param params - The parameters for the create request.
   * @return The created auth token.
   *
   * @example
   * ```ts
   * const ai = new GoogleGenAI({
   *     apiKey: token.name,
   *     httpOptions: { apiVersion: 'v1alpha' }  // Support in v1alpha only.
   * });
   *
   * // Case 1: If LiveEphemeralParameters is unset, unlock LiveConnectConfig
   * // when using the token in Live API sessions. Each session connection can
   * // use a different configuration.
   * const config: CreateAuthTokenConfig = {
   *     uses: 3,
   *     expireTime: '2025-05-01T00:00:00Z',
   * }
   * const token = await ai.tokens.create(config);
   *
   * // Case 2: If LiveEphemeralParameters is set, lock all fields in
   * // LiveConnectConfig when using the token in Live API sessions. For
   * // example, changing `outputAudioTranscription` in the Live API
   * // connection will be ignored by the API.
   * const config: CreateAuthTokenConfig =
   *     uses: 3,
   *     expireTime: '2025-05-01T00:00:00Z',
   *     LiveEphemeralParameters: {
   *        model: 'gemini-2.0-flash-001',
   *        config: {
   *           'responseModalities': ['AUDIO'],
   *           'systemInstruction': 'Always answer in English.',
   *        }
   *     }
   * }
   * const token = await ai.tokens.create(config);
   *
   * // Case 3: If LiveEphemeralParameters is set and lockAdditionalFields is
   * // set, lock LiveConnectConfig with set and additional fields (e.g.
   * // responseModalities, systemInstruction, temperature in this example) when
   * // using the token in Live API sessions.
   * const config: CreateAuthTokenConfig =
   *     uses: 3,
   *     expireTime: '2025-05-01T00:00:00Z',
   *     LiveEphemeralParameters: {
   *        model: 'gemini-2.0-flash-001',
   *        config: {
   *           'responseModalities': ['AUDIO'],
   *           'systemInstruction': 'Always answer in English.',
   *        }
   *     },
   *     lockAdditionalFields: ['temperature'],
   * }
   * const token = await ai.tokens.create(config);
   *
   * // Case 4: If LiveEphemeralParameters is set and lockAdditionalFields is
   * // empty array, lock LiveConnectConfig with set fields (e.g.
   * // responseModalities, systemInstruction in this example) when using the
   * // token in Live API sessions.
   * const config: CreateAuthTokenConfig =
   *     uses: 3,
   *     expireTime: '2025-05-01T00:00:00Z',
   *     LiveEphemeralParameters: {
   *        model: 'gemini-2.0-flash-001',
   *        config: {
   *           'responseModalities': ['AUDIO'],
   *           'systemInstruction': 'Always answer in English.',
   *        }
   *     },
   *     lockAdditionalFields: [],
   * }
   * const token = await ai.tokens.create(config);
   * ```
   */
  create(params: types.CreateAuthTokenParameters): Promise<types.AuthToken>;
}
/** Tokens info with a list of tokens and the corresponding list of token ids. */
declare interface TokensInfo {
  /** Optional fields for the role from the corresponding Content. */
  role?: string;
  /** A list of token ids from the input. */
  tokenIds?: string[];
  /** A list of tokens from the input.
   * @remarks Encoded as base64 string. */
  tokens?: string[];
}
/** Tool details of a tool that the model may use to generate a response. */
declare interface Tool {
  /** Optional. Retrieval tool type. System will always execute the provided retrieval tool(s) to get external knowledge to answer the prompt. Retrieval results are presented to the model for generation. This field is not supported in Gemini API. */
  retrieval?: Retrieval;
  /** Optional. Tool to support the model interacting directly with the
   computer. If enabled, it automatically populates computer-use specific
   Function Declarations. */
  computerUse?: ComputerUse;
  /** Optional. FileSearch tool type. Tool to retrieve knowledge from Semantic Retrieval corpora. This field is not supported in Vertex AI. */
  fileSearch?: FileSearch;
  /** Optional. GoogleSearch tool type. Tool to support Google Search in Model. Powered by Google. */
  googleSearch?: GoogleSearch;
  /** Optional. Tool that allows grounding the model's response with
   geospatial context related to the user's query. */
  googleMaps?: GoogleMaps;
  /** Optional. CodeExecution tool type. Enables the model to execute code as part of generation. */
  codeExecution?: ToolCodeExecution;
  /** Optional. Tool to support searching public web data, powered by Vertex AI Search and Sec4 compliance. This field is not supported in Gemini API. */
  enterpriseWebSearch?: EnterpriseWebSearch;
  /** Optional. Function tool type. One or more function declarations to be passed to the model along with the current user query. Model may decide to call a subset of these functions by populating FunctionCall in the response. User should provide a FunctionResponse for each function call in the next turn. Based on the function responses, Model will generate the final response back to the user. Maximum 512 function declarations can be provided. */
  functionDeclarations?: FunctionDeclaration[];
  /** Optional. Specialized retrieval tool that is powered by Google Search. */
  googleSearchRetrieval?: GoogleSearchRetrieval;
  /** Optional. If specified, Vertex AI will use Parallel.ai to search for information to answer user queries. The search results will be grounded on Parallel.ai and presented to the model for response generation. This field is not supported in Gemini API. */
  parallelAiSearch?: ToolParallelAiSearch;
  /** Optional. Tool to support URL context retrieval. */
  urlContext?: UrlContext;
  /** Optional. MCP Servers to connect to. This field is not supported in Vertex AI. */
  mcpServers?: McpServer[];
}
/**
 * A tool that can be used by the model.
 */
declare type Tool_2 = Function_2 | Tool_2.CodeExecution | Tool_2.URLContext | Tool_2.ComputerUse | Tool_2.MCPServer | Tool_2.GoogleSearch | Tool_2.FileSearch | Tool_2.GoogleMaps | Tool_2.Retrieval;
declare namespace Tool_2 {
  /**
   * A tool that can be used by the model to execute code.
   */
  interface CodeExecution {
    type: 'code_execution';
  }
  /**
   * A tool that can be used by the model to fetch URL context.
   */
  interface URLContext {
    type: 'url_context';
  }
  /**
   * A tool that can be used by the model to interact with the computer.
   */
  interface ComputerUse {
    type: 'computer_use';
    /**
     * The environment being operated.
     */
    environment?: 'browser';
    /**
     * The list of predefined functions that are excluded from the model call.
     */
    excluded_predefined_functions?: Array<string>;
  }
  /**
   * A MCPServer is a server that can be called by the model to perform actions.
   */
  interface MCPServer {
    type: 'mcp_server';
    /**
     * The allowed tools.
     */
    allowed_tools?: Array<InteractionsAPI.AllowedTools>;
    /**
     * Optional: Fields for authentication headers, timeouts, etc., if needed.
     */
    headers?: {
      [key: string]: string;
    };
    /**
     * The name of the MCPServer.
     */
    name?: string;
    /**
     * The full URL for the MCPServer endpoint. Example: "https://api.example.com/mcp"
     */
    url?: string;
  }
  /**
   * A tool that can be used by the model to search Google.
   */
  interface GoogleSearch {
    type: 'google_search';
    /**
     * The types of search grounding to enable.
     */
    search_types?: Array<'web_search' | 'image_search' | 'enterprise_web_search'>;
  }
  /**
   * A tool that can be used by the model to search files.
   */
  interface FileSearch {
    type: 'file_search';
    /**
     * The file search store names to search.
     */
    file_search_store_names?: Array<string>;
    /**
     * Metadata filter to apply to the semantic retrieval documents and chunks.
     */
    metadata_filter?: string;
    /**
     * The number of semantic retrieval chunks to retrieve.
     */
    top_k?: number;
  }
  /**
   * A tool that can be used by the model to call Google Maps.
   */
  interface GoogleMaps {
    type: 'google_maps';
    /**
     * Whether to return a widget context token in the tool call result of the
     * response.
     */
    enable_widget?: boolean;
    /**
     * The latitude of the user's location.
     */
    latitude?: number;
    /**
     * The longitude of the user's location.
     */
    longitude?: number;
  }
  /**
   * A tool that can be used by the model to retrieve files.
   */
  interface Retrieval {
    type: 'retrieval';
    /**
     * The types of file retrieval to enable.
     */
    retrieval_types?: Array<'vertex_ai_search'>;
    /**
     * Used to specify configuration for VertexAISearch.
     */
    vertex_ai_search_config?: Retrieval.VertexAISearchConfig;
  }
  namespace Retrieval {
    /**
     * Used to specify configuration for VertexAISearch.
     */
    interface VertexAISearchConfig {
      /**
       * Optional. Used to specify Vertex AI Search datastores.
       */
      datastores?: Array<string>;
      /**
       * Optional. Used to specify Vertex AI Search engine.
       */
      engine?: string;
    }
  }
}
/** A predicted server-side `ToolCall` returned from the model.

 This message contains information about a tool that the model wants to invoke.
 The client is NOT expected to execute this `ToolCall`. Instead, the
 client should pass this `ToolCall` back to the API in a subsequent turn
 within a `Content` message, along with the corresponding `ToolResponse`. */
declare interface ToolCall {
  /** Unique identifier of the tool call. The server returns the tool response with the matching `id`. */
  id?: string;
  /** The type of tool that was called. */
  toolType?: ToolType;
  /** The tool call arguments. Example: {"arg1": "value1", "arg2": "value2"}. */
  args?: Record<string, unknown>;
}
/**
 * The tool choice configuration containing allowed tools.
 */
declare interface ToolChoiceConfig {
  /**
   * The allowed tools.
   */
  allowed_tools?: AllowedTools;
}
declare type ToolChoiceType = 'auto' | 'any' | 'none' | 'validated';
/** Tool that executes code generated by the model, and automatically returns the result to the model. See also ExecutableCode and CodeExecutionResult, which are input and output to this tool. This data type is not supported in Gemini API. */
declare interface ToolCodeExecution {}
/** Tool config. This config is shared for all tools provided in the request. */
declare interface ToolConfig {
  /** Optional. Retrieval config. */
  retrievalConfig?: RetrievalConfig;
  /** Optional. Function calling config. */
  functionCallingConfig?: FunctionCallingConfig;
  /** Optional. If true, the API response will include the server-side tool calls and responses within the `Content` message. This allows clients to observe the server's tool interactions. This field is not supported in Vertex AI. */
  includeServerSideToolInvocations?: boolean;
}
declare type ToolListUnion = ToolUnion[];
/** ParallelAiSearch tool type. A tool that uses the Parallel.ai search engine for grounding. This data type is not supported in Gemini API. */
declare interface ToolParallelAiSearch {
  /** Optional. The API key for ParallelAiSearch. If an API key is not provided, the system will attempt to verify access by checking for an active Parallel.ai subscription through the Google Cloud Marketplace. See https://docs.parallel.ai/search/search-quickstart for more details. */
  apiKey?: string;
  /** Optional. Custom configs for ParallelAiSearch. This field can be used to pass any parameter from the Parallel.ai Search API. See the Parallel.ai documentation for the full list of available parameters and their usage: https://docs.parallel.ai/api-reference/search-beta/search Currently only `source_policy`, `excerpts`, `max_results`, `mode`, `fetch_policy` can be set via this field. For example: { "source_policy": { "include_domains": ["google.com", "wikipedia.org"], "exclude_domains": ["example.com"] }, "fetch_policy": { "max_age_seconds": 3600 } } */
  customConfigs?: Record<string, unknown>;
}
/** The output from a server-side `ToolCall` execution.

 This message contains the results of a tool invocation that was initiated by a
 `ToolCall` from the model. The client should pass this `ToolResponse` back to
 the API in a subsequent turn within a `Content` message, along with the
 corresponding `ToolCall`. */
declare class ToolResponse {
  /** The identifier of the tool call this response is for. */
  id?: string;
  /** The type of tool that was called, matching the tool_type in the corresponding ToolCall. */
  toolType?: ToolType;
  /** The tool response. */
  response?: Record<string, unknown>;
}
/** The type of tool in the function call. */
declare enum ToolType {
  /**
   * Unspecified tool type.
   */
  TOOL_TYPE_UNSPECIFIED = "TOOL_TYPE_UNSPECIFIED",
  /**
   * Google search tool, maps to Tool.google_search.search_types.web_search.
   */
  GOOGLE_SEARCH_WEB = "GOOGLE_SEARCH_WEB",
  /**
   * Image search tool, maps to Tool.google_search.search_types.image_search.
   */
  GOOGLE_SEARCH_IMAGE = "GOOGLE_SEARCH_IMAGE",
  /**
   * URL context tool, maps to Tool.url_context.
   */
  URL_CONTEXT = "URL_CONTEXT",
  /**
   * Google maps tool, maps to Tool.google_maps.
   */
  GOOGLE_MAPS = "GOOGLE_MAPS",
  /**
   * File search tool, maps to Tool.file_search.
   */
  FILE_SEARCH = "FILE_SEARCH"
}
declare type ToolUnion = Tool | CallableTool;
/** Output only. The traffic type for this request. This enum is not supported in Gemini API. */
declare enum TrafficType {
  /**
   * Unspecified request traffic type.
   */
  TRAFFIC_TYPE_UNSPECIFIED = "TRAFFIC_TYPE_UNSPECIFIED",
  /**
   * The request was processed using Pay-As-You-Go quota.
   */
  ON_DEMAND = "ON_DEMAND",
  /**
   * Type for Priority Pay-As-You-Go traffic.
   */
  ON_DEMAND_PRIORITY = "ON_DEMAND_PRIORITY",
  /**
   * Type for Flex traffic.
   */
  ON_DEMAND_FLEX = "ON_DEMAND_FLEX",
  /**
   * Type for Provisioned Throughput traffic.
   */
  PROVISIONED_THROUGHPUT = "PROVISIONED_THROUGHPUT"
}
/** Audio transcription in Server Conent. */
declare interface Transcription {
  /** Optional. Transcription text. */
  text?: string;
  /** Optional. The bool indicates the end of the transcription. */
  finished?: boolean;
}
/** TunedModel for the Tuned Model of a Tuning Job. */
declare interface TunedModel {
  /** Output only. The resource name of the TunedModel.
   Format: `projects/{project}/locations/{location}/models/{model}@{version_id}`
   When tuning from a base model, the version_id will be 1.
   For continuous tuning, the version id will be incremented by 1 from the
   last version id in the parent model. E.g., `projects/{project}/locations/{location}/models/{model}@{last_version_id + 1}`
   */
  model?: string;
  /** Output only. A resource name of an Endpoint.
   Format: `projects/{project}/locations/{location}/endpoints/{endpoint}`.
   */
  endpoint?: string;
  /** The checkpoints associated with this TunedModel.
   This field is only populated for tuning jobs that enable intermediate
   checkpoints. */
  checkpoints?: TunedModelCheckpoint[];
}
/** TunedModelCheckpoint for the Tuned Model of a Tuning Job. */
declare interface TunedModelCheckpoint {
  /** The ID of the checkpoint.
   */
  checkpointId?: string;
  /** The epoch of the checkpoint.
   */
  epoch?: string;
  /** The step of the checkpoint.
   */
  step?: string;
  /** The Endpoint resource name that the checkpoint is deployed to.
   Format: `projects/{project}/locations/{location}/endpoints/{endpoint}`.
   */
  endpoint?: string;
}
/** A tuned machine learning model. */
declare interface TunedModelInfo {
  /** ID of the base model that you want to tune. */
  baseModel?: string;
  /** Date and time when the base model was created. */
  createTime?: string;
  /** Date and time when the base model was last updated. */
  updateTime?: string;
}
/** Supervised fine-tuning training dataset. */
declare interface TuningDataset {
  /** GCS URI of the file containing training dataset in JSONL format. */
  gcsUri?: string;
  /** The resource name of the Gemini Enterprise Agent Platform (previously known as Vertex AI) Multimodal Dataset that is used as training dataset. Example: 'projects/my-project-id-or-number/locations/my-location/datasets/my-dataset-id'. */
  vertexDatasetResource?: string;
  /** Inline examples with simple input/output text. */
  examples?: TuningExample[];
}
/** The tuning data statistic values for TuningJob. This data type is not supported in Gemini API. */
declare interface TuningDataStats {
  /** Output only. Statistics for distillation prompt dataset. These statistics do not include the responses sampled from the teacher model. */
  distillationDataStats?: DistillationDataStats;
  /** Output only. Statistics for preference optimization. */
  preferenceOptimizationDataStats?: PreferenceOptimizationDataStats;
  /** The SFT Tuning data stats. */
  supervisedTuningDataStats?: SupervisedTuningDataStats;
}
/** A single example for tuning. This data type is not supported in Vertex AI. */
declare interface TuningExample {
  /** Required. The expected model output. */
  output?: string;
  /** Optional. Text model input. */
  textInput?: string;
}
/** A tuning job. */
declare interface TuningJob {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** Output only. Identifier. Resource name of a TuningJob. Format: `projects/{project}/locations/{location}/tuningJobs/{tuning_job}` */
  name?: string;
  /** Output only. The detailed state of the job. */
  state?: JobState;
  /** Output only. Time when the TuningJob was created. */
  createTime?: string;
  /** Output only. Time when the TuningJob for the first time entered the `JOB_STATE_RUNNING` state. */
  startTime?: string;
  /** Output only. Time when the TuningJob entered any of the following JobStates: `JOB_STATE_SUCCEEDED`, `JOB_STATE_FAILED`, `JOB_STATE_CANCELLED`, `JOB_STATE_EXPIRED`. */
  endTime?: string;
  /** Output only. Time when the TuningJob was most recently updated. */
  updateTime?: string;
  /** Output only. Only populated when job's state is `JOB_STATE_FAILED` or `JOB_STATE_CANCELLED`. */
  error?: GoogleRpcStatus;
  /** Optional. The description of the TuningJob. */
  description?: string;
  /** The base model that is being tuned. See [Supported models](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/tuning#supported_models). */
  baseModel?: string;
  /** Output only. The tuned model resources associated with this TuningJob. */
  tunedModel?: TunedModel;
  /** The pre-tuned model for continuous tuning. */
  preTunedModel?: PreTunedModel;
  /** Tuning Spec for Supervised Fine Tuning. */
  supervisedTuningSpec?: SupervisedTuningSpec;
  /** Tuning Spec for Preference Optimization. */
  preferenceOptimizationSpec?: PreferenceOptimizationSpec;
  /** Tuning Spec for Distillation. */
  distillationSpec?: DistillationSpec;
  /** Output only. The tuning data statistics associated with this TuningJob. */
  tuningDataStats?: TuningDataStats;
  /** Customer-managed encryption key options for a TuningJob. If this is set, then all resources created by the TuningJob will be encrypted with the provided encryption key. */
  encryptionSpec?: EncryptionSpec;
  /** Tuning Spec for open sourced and third party Partner models. */
  partnerModelTuningSpec?: PartnerModelTuningSpec;
  /** Optional. The user-provided path to custom model weights. Set this field to tune a custom model. The path must be a Cloud Storage directory that contains the model weights in .safetensors format along with associated model metadata files. If this field is set, the base_model field must still be set to indicate which base model the custom model is derived from. This feature is only available for open source models. */
  customBaseModel?: string;
  /** Output only. Evaluation runs for the Tuning Job. */
  evaluateDatasetRuns?: EvaluateDatasetRun[];
  /** Output only. The Experiment associated with this TuningJob. */
  experiment?: string;
  /** Tuning Spec for Full Fine Tuning. */
  fullFineTuningSpec?: FullFineTuningSpec;
  /** Optional. The labels with user-defined metadata to organize TuningJob and generated resources such as Model and Endpoint. Label keys and values can be no longer than 64 characters (Unicode codepoints), can only contain lowercase letters, numeric characters, underscores and dashes. International characters are allowed. See https://goo.gl/xmQnxf for more information and examples of labels. */
  labels?: Record<string, string>;
  /** Optional. Cloud Storage path to the directory where tuning job outputs are written to. This field is only available and required for open source models. */
  outputUri?: string;
  /** Output only. The resource name of the PipelineJob associated with the TuningJob. Format: `projects/{project}/locations/{location}/pipelineJobs/{pipeline_job}`. */
  pipelineJob?: string;
  /** The service account that the tuningJob workload runs as. If not specified, the Vertex AI Secure Fine-Tuned Service Agent in the project will be used. See https://cloud.google.com/iam/docs/service-agents#vertex-ai-secure-fine-tuning-service-agent Users starting the pipeline must have the `iam.serviceAccounts.actAs` permission on this service account. */
  serviceAccount?: string;
  /** Optional. The display name of the TunedModel. The name can be up to 128 characters long and can consist of any UTF-8 characters. For continuous tuning, tuned_model_display_name will by default use the same display name as the pre-tuned model. If a new display name is provided, the tuning job will create a new model instead of a new version. */
  tunedModelDisplayName?: string;
  /** Output only. The detail state of the tuning job (while the overall `JobState` is running). */
  tuningJobState?: TuningJobState;
  /** Tuning Spec for Veo Tuning. */
  veoTuningSpec?: VeoTuningSpec;
  /** Output only. Tuning Job metadata. */
  tuningJobMetadata?: TuningJobMetadata;
  /** Tuning Spec for Veo LoRA Tuning. */
  veoLoraTuningSpec?: VeoLoraTuningSpec;
  distillationSamplingSpec?: DistillationSamplingSpec;
}
/** Tuning job metadata. This data type is not supported in Gemini API. */
declare interface TuningJobMetadata {
  /** Output only. The number of epochs that have been completed. */
  completedEpochCount?: string;
  /** Output only. The number of steps that have been completed. Set for Multi-Step RL. */
  completedStepCount?: string;
}
/** Output only. The detail state of the tuning job (while the overall `JobState` is running). This enum is not supported in Gemini API. */
declare enum TuningJobState {
  /**
   * Default tuning job state.
   */
  TUNING_JOB_STATE_UNSPECIFIED = "TUNING_JOB_STATE_UNSPECIFIED",
  /**
   * Tuning job is waiting for job quota.
   */
  TUNING_JOB_STATE_WAITING_FOR_QUOTA = "TUNING_JOB_STATE_WAITING_FOR_QUOTA",
  /**
   * Tuning job is validating the dataset.
   */
  TUNING_JOB_STATE_PROCESSING_DATASET = "TUNING_JOB_STATE_PROCESSING_DATASET",
  /**
   * Tuning job is waiting for hardware capacity.
   */
  TUNING_JOB_STATE_WAITING_FOR_CAPACITY = "TUNING_JOB_STATE_WAITING_FOR_CAPACITY",
  /**
   * Tuning job is running.
   */
  TUNING_JOB_STATE_TUNING = "TUNING_JOB_STATE_TUNING",
  /**
   * Tuning job is doing some post processing steps.
   */
  TUNING_JOB_STATE_POST_PROCESSING = "TUNING_JOB_STATE_POST_PROCESSING"
}
/** Enum representing the tuning method. */
declare enum TuningMethod {
  /**
   * Supervised fine tuning.
   */
  SUPERVISED_FINE_TUNING = "SUPERVISED_FINE_TUNING",
  /**
   * Preference optimization tuning.
   */
  PREFERENCE_TUNING = "PREFERENCE_TUNING",
  /**
   * Distillation tuning.
   */
  DISTILLATION = "DISTILLATION",
  /**
   * Reinforcement tuning.
   */
  REINFORCEMENT_TUNING = "REINFORCEMENT_TUNING"
}
/** Tuning mode. This enum is not supported in Gemini API. */
declare enum TuningMode {
  /**
   * Tuning mode is unspecified.
   */
  TUNING_MODE_UNSPECIFIED = "TUNING_MODE_UNSPECIFIED",
  /**
   * Full fine-tuning mode.
   */
  TUNING_MODE_FULL = "TUNING_MODE_FULL",
  /**
   * PEFT adapter tuning mode.
   */
  TUNING_MODE_PEFT_ADAPTER = "TUNING_MODE_PEFT_ADAPTER"
}
/** A long-running operation. */
declare interface TuningOperation {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** The server-assigned name, which is only unique within the same service that originally returns it. If you use the default HTTP mapping, the `name` should be a resource name ending with `operations/{unique_id}`. */
  name?: string;
  /** Service-specific metadata associated with the operation. It typically contains progress information and common metadata such as create time. Some services might not provide such metadata.  Any method that returns a long-running operation should document the metadata type, if any. */
  metadata?: Record<string, unknown>;
  /** If the value is `false`, it means the operation is still in progress. If `true`, the operation is completed, and either `error` or `response` is available. */
  done?: boolean;
  /** The error result of the operation in case of failure or cancellation. */
  error?: Record<string, unknown>;
}
declare class Tunings extends BaseModule {
  private readonly apiClient;
  constructor(apiClient: ApiClient);
  /**
   * Lists tuning jobs.
   *
   * @param params - The parameters for the list request.
   * @return - A pager of tuning jobs.
   *
   * @example
   * ```ts
   * const tuningJobs = await ai.tunings.list({config: {'pageSize': 2}});
   * for await (const tuningJob of tuningJobs) {
   *   console.log(tuningJob);
   * }
   * ```
   */
  list: (params?: types.ListTuningJobsParameters) => Promise<Pager<types.TuningJob>>;
  /**
   * Gets a TuningJob.
   *
   * @param name - The resource name of the tuning job.
   * @return - A TuningJob object.
   *
   * @experimental - The SDK's tuning implementation is experimental, and may
   * change in future versions.
   */
  get: (params: types.GetTuningJobParameters) => Promise<types.TuningJob>;
  /**
   * Creates a supervised fine-tuning job.
   *
   * @param params - The parameters for the tuning job.
   * @return - A TuningJob operation.
   *
   * @experimental - The SDK's tuning implementation is experimental, and may
   * change in future versions.
   */
  tune: (params: types.CreateTuningJobParameters) => Promise<types.TuningJob>;
  private getInternal;
  private listInternal;
  /**
   * Cancels a tuning job.
   *
   * @param params - The parameters for the cancel request.
   * @return The empty response returned by the API.
   *
   * @example
   * ```ts
   * await ai.tunings.cancel({name: '...'}); // The server-generated resource name.
   * ```
   */
  cancel(params: types.CancelTuningJobParameters): Promise<types.CancelTuningJobResponse>;
  private tuneInternal;
  private tuneMldevInternal;
}
/** The speed of the tuning job. Only supported for Veo 3.0 models. This enum is not supported in Gemini API. */
declare enum TuningSpeed {
  /**
   * The default / unset value. For Veo 3.0 models, this defaults to FAST.
   */
  TUNING_SPEED_UNSPECIFIED = "TUNING_SPEED_UNSPECIFIED",
  /**
   * Regular tuning speed.
   */
  REGULAR = "REGULAR",
  /**
   * Fast tuning speed.
   */
  FAST = "FAST"
}
/** The tuning task for Veo. This enum is not supported in Gemini API. */
declare enum TuningTask {
  /**
   * Default value. This value is unused.
   */
  TUNING_TASK_UNSPECIFIED = "TUNING_TASK_UNSPECIFIED",
  /**
   * Tuning task for image to video.
   */
  TUNING_TASK_I2V = "TUNING_TASK_I2V",
  /**
   * Tuning task for text to video.
   */
  TUNING_TASK_T2V = "TUNING_TASK_T2V",
  /**
   * Tuning task for reference to video.
   */
  TUNING_TASK_R2V = "TUNING_TASK_R2V"
}
declare interface TuningValidationDataset {
  /** GCS URI of the file containing validation dataset in JSONL format. */
  gcsUri?: string;
  /** The resource name of the Gemini Enterprise Agent Platform (previously known as Vertex AI) Multimodal Dataset that is used as validation dataset. Example: 'projects/my-project-id-or-number/locations/my-location/datasets/my-dataset-id'. */
  vertexDatasetResource?: string;
}
/** The reason why the turn is complete. */
declare enum TurnCompleteReason {
  /**
   * Default value. Reason is unspecified.
   */
  TURN_COMPLETE_REASON_UNSPECIFIED = "TURN_COMPLETE_REASON_UNSPECIFIED",
  /**
   * The function call generated by the model is invalid.
   */
  MALFORMED_FUNCTION_CALL = "MALFORMED_FUNCTION_CALL",
  /**
   * The response is rejected by the model.
   */
  RESPONSE_REJECTED = "RESPONSE_REJECTED",
  /**
   * Needs more input from the user.
   */
  NEED_MORE_INPUT = "NEED_MORE_INPUT",
  /**
   * Input content is prohibited.
   */
  PROHIBITED_INPUT_CONTENT = "PROHIBITED_INPUT_CONTENT",
  /**
   * Input image contains prohibited content.
   */
  IMAGE_PROHIBITED_INPUT_CONTENT = "IMAGE_PROHIBITED_INPUT_CONTENT",
  /**
   * Input text contains prominent person reference.
   */
  INPUT_TEXT_CONTAIN_PROMINENT_PERSON_PROHIBITED = "INPUT_TEXT_CONTAIN_PROMINENT_PERSON_PROHIBITED",
  /**
   * Input image contains celebrity.
   */
  INPUT_IMAGE_CELEBRITY = "INPUT_IMAGE_CELEBRITY",
  /**
   * Input image contains photo realistic child.
   */
  INPUT_IMAGE_PHOTO_REALISTIC_CHILD_PROHIBITED = "INPUT_IMAGE_PHOTO_REALISTIC_CHILD_PROHIBITED",
  /**
   * Input text contains NCII content.
   */
  INPUT_TEXT_NCII_PROHIBITED = "INPUT_TEXT_NCII_PROHIBITED",
  /**
   * Other input safety issue.
   */
  INPUT_OTHER = "INPUT_OTHER",
  /**
   * Input contains IP violation.
   */
  INPUT_IP_PROHIBITED = "INPUT_IP_PROHIBITED",
  /**
   * Input matched blocklist.
   */
  BLOCKLIST = "BLOCKLIST",
  /**
   * Input is unsafe for image generation.
   */
  UNSAFE_PROMPT_FOR_IMAGE_GENERATION = "UNSAFE_PROMPT_FOR_IMAGE_GENERATION",
  /**
   * Generated image failed safety check.
   */
  GENERATED_IMAGE_SAFETY = "GENERATED_IMAGE_SAFETY",
  /**
   * Generated content failed safety check.
   */
  GENERATED_CONTENT_SAFETY = "GENERATED_CONTENT_SAFETY",
  /**
   * Generated audio failed safety check.
   */
  GENERATED_AUDIO_SAFETY = "GENERATED_AUDIO_SAFETY",
  /**
   * Generated video failed safety check.
   */
  GENERATED_VIDEO_SAFETY = "GENERATED_VIDEO_SAFETY",
  /**
   * Generated content is prohibited.
   */
  GENERATED_CONTENT_PROHIBITED = "GENERATED_CONTENT_PROHIBITED",
  /**
   * Generated content matched blocklist.
   */
  GENERATED_CONTENT_BLOCKLIST = "GENERATED_CONTENT_BLOCKLIST",
  /**
   * Generated image is prohibited.
   */
  GENERATED_IMAGE_PROHIBITED = "GENERATED_IMAGE_PROHIBITED",
  /**
   * Generated image contains celebrity.
   */
  GENERATED_IMAGE_CELEBRITY = "GENERATED_IMAGE_CELEBRITY",
  /**
   * Generated image contains prominent people detected by rewriter.
   */
  GENERATED_IMAGE_PROMINENT_PEOPLE_DETECTED_BY_REWRITER = "GENERATED_IMAGE_PROMINENT_PEOPLE_DETECTED_BY_REWRITER",
  /**
   * Generated image contains identifiable people.
   */
  GENERATED_IMAGE_IDENTIFIABLE_PEOPLE = "GENERATED_IMAGE_IDENTIFIABLE_PEOPLE",
  /**
   * Generated image contains minors.
   */
  GENERATED_IMAGE_MINORS = "GENERATED_IMAGE_MINORS",
  /**
   * Generated image contains IP violation.
   */
  OUTPUT_IMAGE_IP_PROHIBITED = "OUTPUT_IMAGE_IP_PROHIBITED",
  /**
   * Other generated content issue.
   */
  GENERATED_OTHER = "GENERATED_OTHER",
  /**
   * Max regeneration attempts reached.
   */
  MAX_REGENERATION_REACHED = "MAX_REGENERATION_REACHED"
}
/** Options about which input is included in the user's turn. */
declare enum TurnCoverage {
  /**
   * If unspecified, the default behavior is `TURN_INCLUDES_ONLY_ACTIVITY`.
   */
  TURN_COVERAGE_UNSPECIFIED = "TURN_COVERAGE_UNSPECIFIED",
  /**
   * The users turn only includes activity since the last turn, excluding inactivity (e.g. silence on the audio stream). This is the default behavior.
   */
  TURN_INCLUDES_ONLY_ACTIVITY = "TURN_INCLUDES_ONLY_ACTIVITY",
  /**
   * The users turn includes all realtime input since the last turn, including inactivity (e.g. silence on the audio stream).
   */
  TURN_INCLUDES_ALL_INPUT = "TURN_INCLUDES_ALL_INPUT",
  /**
   * Includes audio activity and all video since the last turn. With automatic activity detection, audio activity means speech and excludes silence.
   */
  TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO = "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"
}
/** Data type of the schema field. */
declare enum Type {
  /**
   * Not specified, should not be used.
   */
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  /**
   * OpenAPI string type
   */
  STRING = "STRING",
  /**
   * OpenAPI number type
   */
  NUMBER = "NUMBER",
  /**
   * OpenAPI integer type
   */
  INTEGER = "INTEGER",
  /**
   * OpenAPI boolean type
   */
  BOOLEAN = "BOOLEAN",
  /**
   * OpenAPI array type
   */
  ARRAY = "ARRAY",
  /**
   * OpenAPI object type
   */
  OBJECT = "OBJECT",
  /**
   * Null type
   */
  NULL = "NULL"
}
declare namespace types {
  export { createFunctionResponsePartFromBase64, createFunctionResponsePartFromUri, createPartFromUri, createPartFromText, createPartFromFunctionCall, createPartFromFunctionResponse, createPartFromBase64, createPartFromCodeExecutionResult, createPartFromExecutableCode, createUserContent, createModelContent, Outcome, Language, FunctionResponseScheduling, Type, Environment, AuthType, HttpElementLocation, ApiSpec, PhishBlockThreshold, Behavior, DynamicRetrievalConfigMode, ThinkingLevel, PersonGeneration, ProminentPeople, HarmCategory, HarmBlockMethod, HarmBlockThreshold, FunctionCallingConfigMode, FinishReason, HarmProbability, HarmSeverity, UrlRetrievalStatus, BlockedReason, TrafficType, Modality, ModelStage, MediaResolution, TuningMode, AdapterSize, JobState, TuningJobState, AggregationMetric, PairwiseChoice, TuningSpeed, TuningTask, VideoOrientation, DocumentState, PartMediaResolutionLevel, ToolType, ResourceScope, ServiceTier, FeatureSelectionPreference, EmbeddingApiType, SafetyFilterLevel, ImagePromptLanguage, MaskReferenceMode, ControlReferenceType, SubjectReferenceType, EditMode, SegmentMode, VideoGenerationReferenceType, VideoGenerationMaskMode, VideoCompressionQuality, ImageResizeMode, TuningMethod, FileState, FileSource, TurnCompleteReason, MediaModality, VadSignalType, VoiceActivityType, StartSensitivity, EndSensitivity, ActivityHandling, TurnCoverage, Scale, MusicGenerationMode, LiveMusicPlaybackControl, PartMediaResolution, ToolCall, ToolResponse, CodeExecutionResult, ExecutableCode, FileData, PartialArg, FunctionCall, FunctionResponseBlob, FunctionResponseFileData, FunctionResponsePart, FunctionResponse, Blob_2 as Blob, VideoMetadata, Part, Content, HttpRetryOptions, HttpOptions, Schema, ModelSelectionConfig, ComputerUse, ApiKeyConfig, AuthConfigGoogleServiceAccountConfig, AuthConfigHttpBasicAuthConfig, AuthConfigOauthConfig, AuthConfigOidcConfig, AuthConfig, GoogleMaps, ApiAuthApiKeyConfig, ApiAuth, ExternalApiElasticSearchParams, ExternalApiSimpleSearchParams, ExternalApi, VertexAISearchDataStoreSpec, VertexAISearch, VertexRagStoreRagResource, RagRetrievalConfigFilter, RagRetrievalConfigHybridSearch, RagRetrievalConfigRankingLlmRanker, RagRetrievalConfigRankingRankService, RagRetrievalConfigRanking, RagRetrievalConfig, VertexRagStore, Retrieval, FileSearch, WebSearch, ImageSearch, SearchTypes, Interval, GoogleSearch, ToolCodeExecution, EnterpriseWebSearch, FunctionDeclaration, DynamicRetrievalConfig, GoogleSearchRetrieval, ToolParallelAiSearch, UrlContext, StreamableHttpTransport, McpServer, Tool, ReplicatedVoiceConfig, PrebuiltVoiceConfig, VoiceConfig, SpeakerVoiceConfig, MultiSpeakerVoiceConfig, SpeechConfig, AutomaticFunctionCallingConfig, ThinkingConfig, ImageConfigImageOutputOptions, ImageConfig, GenerationConfigRoutingConfigAutoRoutingMode, GenerationConfigRoutingConfigManualRoutingMode, GenerationConfigRoutingConfig, SafetySetting, LatLng, RetrievalConfig, FunctionCallingConfig, ToolConfig, ModelArmorConfig, GenerateContentConfig, GenerateContentParameters, HttpResponse, LiveCallbacks, GoogleTypeDate, Citation, CitationMetadata, GroundingChunkMapsPlaceAnswerSourcesAuthorAttribution, GroundingChunkMapsPlaceAnswerSourcesReviewSnippet, GroundingChunkMapsPlaceAnswerSources, GroundingChunkMapsRoute, GroundingChunkMaps, GroundingChunkImage, RagChunkPageSpan, RagChunk, GroundingChunkStringList, GroundingChunkCustomMetadata, GroundingChunkRetrievedContext, GroundingChunkWeb, GroundingChunk, Segment, GroundingSupport, RetrievalMetadata, SearchEntryPoint, GroundingMetadataSourceFlaggingUri, GroundingMetadata, LogprobsResultCandidate, LogprobsResultTopCandidates, LogprobsResult, SafetyRating, UrlMetadata, UrlContextMetadata, Candidate, GenerateContentResponsePromptFeedback, ModalityTokenCount, GenerateContentResponseUsageMetadata, ModelStatus, GenerateContentResponse, ReferenceImage, EditImageParameters, EmbedContentConfig, EmbedContentParametersPrivate, ContentEmbeddingStatistics, ContentEmbedding, EmbedContentMetadata, EmbedContentResponse, GenerateImagesConfig, GenerateImagesParameters, Image_2 as Image, SafetyAttributes, GeneratedImage, GenerateImagesResponse, MaskReferenceConfig, ControlReferenceConfig, StyleReferenceConfig, SubjectReferenceConfig, EditImageConfig, EditImageResponse, UpscaleImageResponse, ProductImage, RecontextImageSource, RecontextImageConfig, RecontextImageParameters, RecontextImageResponse, ScribbleImage, SegmentImageSource, SegmentImageConfig, SegmentImageParameters, EntityLabel, GeneratedImageMask, SegmentImageResponse, GetModelConfig, GetModelParameters, Endpoint, TunedModelInfo, Checkpoint, Model, ListModelsConfig, ListModelsParameters, ListModelsResponse, UpdateModelConfig, UpdateModelParameters, DeleteModelConfig, DeleteModelParameters, DeleteModelResponse, GenerationConfig, CountTokensConfig, CountTokensParameters, CountTokensResponse, ComputeTokensConfig, ComputeTokensParameters, TokensInfo, ComputeTokensResponse, Video, GenerateVideosSource, VideoGenerationReferenceImage, VideoGenerationMask, WebhookConfig, GenerateVideosConfig, GenerateVideosParameters, GeneratedVideo, GenerateVideosResponse, Operation, GenerateVideosOperation, GetTuningJobConfig, GetTuningJobParameters, TunedModelCheckpoint, TunedModel, SupervisedHyperParameters, SupervisedTuningSpec, PreferenceOptimizationHyperParameters, PreferenceOptimizationSpec, DistillationHyperParameters, DistillationSamplingSpec, DistillationSpec, GoogleRpcStatus, PreTunedModel, DatasetDistributionDistributionBucket, DatasetDistribution, DatasetStats, DistillationDataStats, GeminiPreferenceExampleCompletion, GeminiPreferenceExample, PreferenceOptimizationDataStats, SupervisedTuningDatasetDistributionDatasetBucket, SupervisedTuningDatasetDistribution, SupervisedTuningDataStats, TuningDataStats, EncryptionSpec, PartnerModelTuningSpec, BleuMetricValue, CustomCodeExecutionResult, ExactMatchMetricValue, RawOutput, CustomOutput, PairwiseMetricResult, PointwiseMetricResult, RougeMetricValue, AggregationResult, BigQuerySource, GcsSource, EvaluationDataset, AggregationOutput, OutputInfo, EvaluateDatasetResponse, EvaluateDatasetRun, FullFineTuningSpec, VeoHyperParameters, VeoTuningSpec, TuningJobMetadata, VeoLoraTuningSpec, TuningJob, ListTuningJobsConfig, ListTuningJobsParameters, ListTuningJobsResponse, CancelTuningJobConfig, CancelTuningJobParameters, CancelTuningJobResponse, TuningExample, TuningDataset, TuningValidationDataset, AutoraterConfig, ReinforcementTuningAutoraterScorer, SingleReinforcementTuningRewardConfig, CompositeReinforcementTuningRewardConfigWeightedRewardConfig, CompositeReinforcementTuningRewardConfig, CreateTuningJobConfig, CreateTuningJobParametersPrivate, TuningOperation, CreateCachedContentConfig, CreateCachedContentParameters, CachedContentUsageMetadata, CachedContent, GetCachedContentConfig, GetCachedContentParameters, DeleteCachedContentConfig, DeleteCachedContentParameters, DeleteCachedContentResponse, UpdateCachedContentConfig, UpdateCachedContentParameters, ListCachedContentsConfig, ListCachedContentsParameters, ListCachedContentsResponse, GetDocumentConfig, GetDocumentParameters, StringList, CustomMetadata, Document_2 as Document, DeleteDocumentConfig, DeleteDocumentParameters, ListDocumentsConfig, ListDocumentsParameters, ListDocumentsResponse, CreateFileSearchStoreConfig, CreateFileSearchStoreParameters, FileSearchStore, GetFileSearchStoreConfig, GetFileSearchStoreParameters, DeleteFileSearchStoreConfig, DeleteFileSearchStoreParameters, ListFileSearchStoresConfig, ListFileSearchStoresParameters, ListFileSearchStoresResponse, WhiteSpaceConfig, ChunkingConfig, UploadToFileSearchStoreConfig, UploadToFileSearchStoreParameters, UploadToFileSearchStoreResumableResponse, ImportFileConfig, ImportFileParameters, ImportFileResponse, ImportFileOperation, ListFilesConfig, ListFilesParameters, FileStatus, File_2 as File, ListFilesResponse, CreateFileConfig, CreateFileParameters, CreateFileResponse, GetFileConfig, GetFileParameters, DeleteFileConfig, DeleteFileParameters, DeleteFileResponse, RegisterFilesConfig, InternalRegisterFilesParameters, RegisterFilesResponse, InlinedRequest, BatchJobSource, VertexMultimodalDatasetDestination, JobError, InlinedResponse, SingleEmbedContentResponse, InlinedEmbedContentResponse, BatchJobDestination, CreateBatchJobConfig, CreateBatchJobParameters, BatchJobOutputInfo, CompletionStats, BatchJob, EmbedContentBatch, EmbeddingsBatchJobSource, CreateEmbeddingsBatchJobConfig, CreateEmbeddingsBatchJobParameters, GetBatchJobConfig, GetBatchJobParameters, CancelBatchJobConfig, CancelBatchJobParameters, ListBatchJobsConfig, ListBatchJobsParameters, ListBatchJobsResponse, DeleteBatchJobConfig, DeleteBatchJobParameters, DeleteResourceJob, GetOperationConfig, GetOperationParameters, FetchPredictOperationConfig, FetchPredictOperationParameters, TestTableItem, TestTableFile, ReplayRequest, ReplayResponse, ReplayInteraction, ReplayFile, UploadFileConfig, DownloadFileConfig, DownloadFileParameters, UpscaleImageConfig, UpscaleImageParameters, RawReferenceImage, MaskReferenceImage, ControlReferenceImage, StyleReferenceImage, SubjectReferenceImage, ContentReferenceImage, LiveServerSetupComplete, Transcription, LiveServerContent, LiveServerToolCall, LiveServerToolCallCancellation, UsageMetadata, LiveServerGoAway, LiveServerSessionResumptionUpdate, VoiceActivityDetectionSignal, VoiceActivity, LiveServerMessage, OperationFromAPIResponseParameters, GenerationConfigThinkingConfig, RegisterFilesParameters, AutomaticActivityDetection, RealtimeInputConfig, SessionResumptionConfig, SlidingWindow, ContextWindowCompressionConfig, AudioTranscriptionConfig, ProactivityConfig, CustomizedAvatar, AvatarConfig, LiveClientSetup, LiveClientContent, ActivityStart, ActivityEnd, LiveClientRealtimeInput, LiveClientToolResponse, LiveClientMessage, StreamTranslationConfig, LiveConnectConfig, LiveConnectParameters, CreateChatParameters, SendMessageParameters, LiveSendClientContentParameters, LiveSendRealtimeInputParameters, LiveSendToolResponseParameters, LiveMusicClientSetup, WeightedPrompt, LiveMusicClientContent, LiveMusicGenerationConfig, LiveMusicClientMessage, LiveMusicServerSetupComplete, LiveMusicSourceMetadata, AudioChunk, LiveMusicServerContent, LiveMusicFilteredPrompt, LiveMusicServerMessage, LiveMusicCallbacks, UploadFileParameters, CallableTool, CallableToolConfig, LiveMusicConnectParameters, LiveMusicSetConfigParameters, LiveMusicSetWeightedPromptsParameters, AuthToken, LiveConnectConstraints, CreateAuthTokenConfig, CreateAuthTokenParameters, OperationGetParameters, CountTokensResult, ComputeTokensResult, CreateTuningJobParameters, EmbedContentParameters, UploadToFileSearchStoreResponse, UploadToFileSearchStoreOperation, DownloadMediaConfig, BlobImageUnion, PartUnion, PartListUnion, ContentUnion, ContentListUnion, SchemaUnion, SpeechConfigUnion, ToolUnion, ToolListUnion, DownloadableFileUnion, BatchJobSourceUnion, BatchJobDestinationUnion };
}
/** @ts-ignore For users with undici */
declare type UndiciRequestInit = NotAny<import('../node_modules/undici/index.d.ts').RequestInit> | NotAny<import('../../node_modules/undici/index.d.ts').RequestInit> | NotAny<import('../../../node_modules/undici/index.d.ts').RequestInit> | NotAny<import('../../../../node_modules/undici/index.d.ts').RequestInit> | NotAny<import('../../../../../node_modules/undici/index.d.ts').RequestInit> | NotAny<import('../../../../../../node_modules/undici/index.d.ts').RequestInit> | NotAny<RequestInit$2> | NotAny<RequestInit$4> | NotAny<import('../../../../../../../../../node_modules/undici/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../../../node_modules/undici/index.d.ts').RequestInit>;
/**
 * These imports attempt to get types from a parent package's dependencies.
 * Unresolved bare specifiers can trigger [automatic type acquisition][1] in some projects, which
 * would cause typescript to show types not present at runtime. To avoid this, we import
 * directly from parent node_modules folders.
 *
 * We need to check multiple levels because we don't know what directory structure we'll be in.
 * For example, pnpm generates directories like this:
 * ```
 * node_modules
 * ├── .pnpm
 * │   └── pkg@1.0.0
 * │       └── node_modules
 * │           └── pkg
 * │               └── internal
 * │                   └── types.d.ts
 * ├── pkg -> .pnpm/pkg@1.0.0/node_modules/pkg
 * └── undici
 * ```
 *
 * [1]: https://www.typescriptlang.org/tsconfig/#typeAcquisition
 */
/** @ts-ignore For users with \@types/node */
declare type UndiciTypesRequestInit = NotAny<import('../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<RequestInit$1> | NotAny<import('../../../../../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../../../../../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../../node_modules/undici-types/index.d.ts').RequestInit> | NotAny<import('../../../../../../../../../../node_modules/undici-types/index.d.ts').RequestInit>;
declare class UnprocessableEntityError extends APIError<422, Headers> {}
/** Optional parameters for caches.update method. */
declare interface UpdateCachedContentConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The TTL for this resource. The expiration time is computed: now + TTL. It is a duration string, with up to nine fractional digits, terminated by 's'. Example: "3.5s". */
  ttl?: string;
  /** Timestamp of when this resource is considered expired. Uses RFC 3339 format, Example: 2014-10-02T15:01:23Z. */
  expireTime?: string;
}
declare interface UpdateCachedContentParameters {
  /** The server-generated resource name of the cached content.
   */
  name: string;
  /** Configuration that contains optional parameters.
   */
  config?: UpdateCachedContentConfig;
}
/** Configuration for updating a tuned model. */
declare interface UpdateModelConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  displayName?: string;
  description?: string;
  defaultCheckpointId?: string;
}
/** Configuration for updating a tuned model. */
declare interface UpdateModelParameters {
  model: string;
  config?: UpdateModelConfig;
}
declare interface Uploader {
  /**
   * Uploads a file to the given upload url.
   *
   * @param file The file to upload. file is in string type or a Blob.
   * @param uploadUrl The upload URL as a string is where the file will be
   *     uploaded to. The uploadUrl must be a url that was returned by the
   * https://generativelanguage.googleapis.com/upload/v1beta/files endpoint
   * @param apiClient The ApiClient to use for uploading.
   * @return A Promise that resolves to types.File.
   */
  upload(file: string | Blob, uploadUrl: string, apiClient: ApiClient, httpOptions?: HttpOptions): Promise<File_2>;
  /**
   * Uploads a file to file search store via the given upload url.
   *
   * @param file The file to upload. file is in string type or a Blob.
   * @param uploadUrl The upload URL as a string is where the file will be
   *     uploaded to. The uploadUrl must be a url that was returned by the
   * https://generativelanguage.googleapis.com/upload/v1beta/{file_search_store_name}:uploadToFileSearchStore endpoint
   * @param apiClient The ApiClient to use for uploading.
   * @param httpOptions Optional HTTP options to merge.
   * @return A Promise that resolves to types.UploadToFileSearchStoreOperation.
   */
  uploadToFileSearchStore(file: string | Blob, uploadUrl: string, apiClient: ApiClient, httpOptions?: HttpOptions): Promise<UploadToFileSearchStoreOperation>;
  /**
   * Returns the file's mimeType and the size of a given file. If the file is a
   * string path, the file type is determined by the file extension. If the
   * file's type cannot be determined, the type will be set to undefined.
   *
   * @param file The file to get the stat for. Can be a string path or a Blob.
   * @return A Promise that resolves to the file stat of the given file.
   */
  stat(file: string | Blob): Promise<FileStat>;
}
/** Used to override the default configuration. */
declare interface UploadFileConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** The name of the file in the destination (e.g., 'files/sample-image'. If not provided one will be generated. */
  name?: string;
  /** mime_type: The MIME type of the file. If not provided, it will be inferred from the file extension. */
  mimeType?: string;
  /** Optional display name of the file. */
  displayName?: string;
}
/** Parameters for the upload file method. */
declare interface UploadFileParameters {
  /** The string path to the file to be uploaded or a Blob object. */
  file: string | globalThis.Blob;
  /** Configuration that contains optional parameters. */
  config?: UploadFileConfig;
}
/** Optional parameters for uploading a file to a FileSearchStore. */
declare interface UploadToFileSearchStoreConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** MIME type of the file to be uploaded. If not provided, it will be inferred from the file extension. */
  mimeType?: string;
  /** Display name of the created document. */
  displayName?: string;
  /** User provided custom metadata stored as key-value pairs used for querying. */
  customMetadata?: CustomMetadata[];
  /** Config for telling the service how to chunk the file. */
  chunkingConfig?: ChunkingConfig;
}
/** Long-running operation for uploading a file to a FileSearchStore. */
declare class UploadToFileSearchStoreOperation implements Operation<UploadToFileSearchStoreResponse> {
  /** The server-assigned name, which is only unique within the same service that originally returns it. If you use the default HTTP mapping, the `name` should be a resource name ending with `operations/{unique_id}`. */
  name?: string;
  /** Service-specific metadata associated with the operation. It typically contains progress information and common metadata such as create time. Some services might not provide such metadata.  Any method that returns a long-running operation should document the metadata type, if any. */
  metadata?: Record<string, unknown>;
  /** If the value is `false`, it means the operation is still in progress. If `true`, the operation is completed, and either `error` or `response` is available. */
  done?: boolean;
  /** The error result of the operation in case of failure or cancellation. */
  error?: Record<string, unknown>;
  /** The result of the UploadToFileSearchStore operation, available when the operation is done. */
  response?: UploadToFileSearchStoreResponse;
  /**
   * Instantiates an Operation of the same type as the one being called with the fields set from the API response.
   */
  _fromAPIResponse({
    apiResponse,
    _isVertexAI
  }: OperationFromAPIResponseParameters): Operation<UploadToFileSearchStoreResponse>;
  /** The full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Generates the parameters for the private _upload_to_file_search_store method. */
declare interface UploadToFileSearchStoreParameters {
  /** The resource name of the FileSearchStore. Example: `fileSearchStores/my-file-search-store-123` */
  fileSearchStoreName: string;
  /** Used to override the default configuration. */
  config?: UploadToFileSearchStoreConfig;
}
/** Parameters for the upload file to file search store method. */
declare interface UploadToFileSearchStoreParameters {
  /** The name of the file search store to upload. */
  fileSearchStoreName: string;
  /** The string path to the file to be uploaded or a Blob object. */
  file: string | globalThis.Blob;
  /** Configuration that contains optional parameters. */
  config?: UploadToFileSearchStoreConfig;
}
/** The response when long-running operation for uploading a file to a FileSearchStore complete. */
declare class UploadToFileSearchStoreResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** The name of the FileSearchStore containing Documents. */
  parent?: string;
  /** The identifier for the Document imported. */
  documentName?: string;
}
/** Response for the resumable upload method. */
declare class UploadToFileSearchStoreResumableResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
}
/** Configuration for upscaling an image.

 For more information on this configuration, refer to
 the `Imagen API reference documentation
 <https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/imagen-api>`_. */
declare interface UpscaleImageConfig {
  /** Used to override HTTP request options. */
  httpOptions?: HttpOptions;
  /** Abort signal which can be used to cancel the request.
     NOTE: AbortSignal is a client-only operation. Using it to cancel an
   operation will not cancel the request in the service. You will still
   be charged usage for any applicable operations.
   */
  abortSignal?: AbortSignal;
  /** Cloud Storage URI used to store the generated images. */
  outputGcsUri?: string;
  /** Filter level for safety filtering. */
  safetyFilterLevel?: SafetyFilterLevel;
  /** Allows generation of people by the model. */
  personGeneration?: PersonGeneration;
  /** Whether to include a reason for filtered-out images in the
   response. */
  includeRaiReason?: boolean;
  /** The image format that the output should be saved as. */
  outputMimeType?: string;
  /** The level of compression. Only applicable if the
   ``output_mime_type`` is ``image/jpeg``. */
  outputCompressionQuality?: number;
  /** Whether to add an image enhancing step before upscaling.
   It is expected to suppress the noise and JPEG compression artifacts
   from the input image. */
  enhanceInputImage?: boolean;
  /** With a higher image preservation factor, the original image
   pixels are more respected. With a lower image preservation factor, the
   output image will have be more different from the input image, but
   with finer details and less noise. */
  imagePreservationFactor?: number;
  /** User specified labels to track billing usage. */
  labels?: Record<string, string>;
}
/** User-facing config UpscaleImageParameters. */
declare interface UpscaleImageParameters {
  /** The model to use. */
  model: string;
  /** The input image to upscale. */
  image: Image_2;
  /** The factor to upscale the image (x2 or x4). */
  upscaleFactor: string;
  /** Configuration for upscaling. */
  config?: UpscaleImageConfig;
}
declare class UpscaleImageResponse {
  /** Used to retain the full HTTP response. */
  sdkHttpResponse?: HttpResponse;
  /** Generated images. */
  generatedImages?: GeneratedImage[];
}
/**
 * A URL citation annotation.
 */
declare interface URLCitation {
  type: 'url_citation';
  /**
   * End of the attributed segment, exclusive.
   */
  end_index?: number;
  /**
   * Start of segment of the response that is attributed to this source.
   *
   * Index indicates the start of the segment, measured in bytes.
   */
  start_index?: number;
  /**
   * The title of the URL.
   */
  title?: string;
  /**
   * The URL.
   */
  url?: string;
}
/** Tool to support URL context. */
declare interface UrlContext {}
/**
 * The arguments to pass to the URL context.
 */
declare interface URLContextCallArguments {
  /**
   * The URLs to fetch.
   */
  urls?: Array<string>;
}
/**
 * URL context call step.
 */
declare interface URLContextCallStep {
  /**
   * Required. A unique ID for this specific tool call.
   */
  id: string;
  /**
   * Required. The arguments to pass to the URL context.
   */
  arguments: URLContextCallStep.Arguments;
  type: 'url_context_call';
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace URLContextCallStep {
  /**
   * Required. The arguments to pass to the URL context.
   */
  interface Arguments {
    /**
     * The URLs to fetch.
     */
    urls?: Array<string>;
  }
}
/** Metadata returned when the model uses the `url_context` tool to get information from a user-provided URL. */
declare interface UrlContextMetadata {
  /** Output only. A list of URL metadata, with one entry for each URL retrieved by the tool. */
  urlMetadata?: UrlMetadata[];
}
/**
 * The result of the URL context.
 */
declare interface URLContextResult {
  /**
   * The status of the URL retrieval.
   */
  status?: 'success' | 'error' | 'paywall' | 'unsafe';
  /**
   * The URL that was fetched.
   */
  url?: string;
}
/**
 * URL context result step.
 */
declare interface URLContextResultStep {
  /**
   * Required. ID to match the ID from the function call block.
   */
  call_id: string;
  /**
   * Required. The results of the URL context.
   */
  result: Array<URLContextResultStep.Result>;
  type: 'url_context_result';
  /**
   * Whether the URL context resulted in an error.
   */
  is_error?: boolean;
  /**
   * A signature hash for backend validation.
   */
  signature?: string;
}
declare namespace URLContextResultStep {
  /**
   * The result of the URL context.
   */
  interface Result {
    /**
     * The status of the URL retrieval.
     */
    status?: 'success' | 'error' | 'paywall' | 'unsafe';
    /**
     * The URL that was fetched.
     */
    url?: string;
  }
}
/** The metadata for a single URL retrieval. */
declare interface UrlMetadata {
  /** The URL retrieved by the tool. */
  retrievedUrl?: string;
  /** The status of the URL retrieval. */
  urlRetrievalStatus?: UrlRetrievalStatus;
}
/** The status of the URL retrieval. */
declare enum UrlRetrievalStatus {
  /**
   * Default value. This value is unused.
   */
  URL_RETRIEVAL_STATUS_UNSPECIFIED = "URL_RETRIEVAL_STATUS_UNSPECIFIED",
  /**
   * The URL was retrieved successfully.
   */
  URL_RETRIEVAL_STATUS_SUCCESS = "URL_RETRIEVAL_STATUS_SUCCESS",
  /**
   * The URL retrieval failed.
   */
  URL_RETRIEVAL_STATUS_ERROR = "URL_RETRIEVAL_STATUS_ERROR",
  /**
   * Url retrieval is failed because the content is behind paywall. This enum value is not supported in Vertex AI.
   */
  URL_RETRIEVAL_STATUS_PAYWALL = "URL_RETRIEVAL_STATUS_PAYWALL",
  /**
   * Url retrieval is failed because the content is unsafe. This enum value is not supported in Vertex AI.
   */
  URL_RETRIEVAL_STATUS_UNSAFE = "URL_RETRIEVAL_STATUS_UNSAFE"
}
/**
 * Statistics on the interaction request's token usage.
 */
declare interface Usage {
  /**
   * A breakdown of cached token usage by modality.
   */
  cached_tokens_by_modality?: Array<Usage.CachedTokensByModality>;
  /**
   * Grounding tool count.
   */
  grounding_tool_count?: Array<Usage.GroundingToolCount>;
  /**
   * A breakdown of input token usage by modality.
   */
  input_tokens_by_modality?: Array<Usage.InputTokensByModality>;
  /**
   * A breakdown of output token usage by modality.
   */
  output_tokens_by_modality?: Array<Usage.OutputTokensByModality>;
  /**
   * A breakdown of tool-use token usage by modality.
   */
  tool_use_tokens_by_modality?: Array<Usage.ToolUseTokensByModality>;
  /**
   * Number of tokens in the cached part of the prompt (the cached content).
   */
  total_cached_tokens?: number;
  /**
   * Number of tokens in the prompt (context).
   */
  total_input_tokens?: number;
  /**
   * Total number of tokens across all the generated responses.
   */
  total_output_tokens?: number;
  /**
   * Number of tokens of thoughts for thinking models.
   */
  total_thought_tokens?: number;
  /**
   * Total token count for the interaction request (prompt + responses + other
   * internal tokens).
   */
  total_tokens?: number;
  /**
   * Number of tokens present in tool-use prompt(s).
   */
  total_tool_use_tokens?: number;
}
declare namespace Usage {
  /**
   * The token count for a single response modality.
   */
  interface CachedTokensByModality {
    /**
     * The modality associated with the token count.
     */
    modality?: 'text' | 'image' | 'audio' | 'video' | 'document';
    /**
     * Number of tokens for the modality.
     */
    tokens?: number;
  }
  /**
   * The number of grounding tool counts.
   */
  interface GroundingToolCount {
    /**
     * The number of grounding tool counts.
     */
    count?: number;
    /**
     * The grounding tool type associated with the count.
     */
    type?: 'google_search' | 'google_maps' | 'retrieval';
  }
  /**
   * The token count for a single response modality.
   */
  interface InputTokensByModality {
    /**
     * The modality associated with the token count.
     */
    modality?: 'text' | 'image' | 'audio' | 'video' | 'document';
    /**
     * Number of tokens for the modality.
     */
    tokens?: number;
  }
  /**
   * The token count for a single response modality.
   */
  interface OutputTokensByModality {
    /**
     * The modality associated with the token count.
     */
    modality?: 'text' | 'image' | 'audio' | 'video' | 'document';
    /**
     * Number of tokens for the modality.
     */
    tokens?: number;
  }
  /**
   * The token count for a single response modality.
   */
  interface ToolUseTokensByModality {
    /**
     * The modality associated with the token count.
     */
    modality?: 'text' | 'image' | 'audio' | 'video' | 'document';
    /**
     * Number of tokens for the modality.
     */
    tokens?: number;
  }
}
/** Usage metadata about response(s). */
declare interface UsageMetadata {
  /** Number of tokens in the prompt. When `cached_content` is set, this is still the total effective prompt size meaning this includes the number of tokens in the cached content. */
  promptTokenCount?: number;
  /** Number of tokens in the cached part of the prompt (the cached content). */
  cachedContentTokenCount?: number;
  /** Total number of tokens across all the generated response candidates. */
  responseTokenCount?: number;
  /** Number of tokens present in tool-use prompt(s). */
  toolUsePromptTokenCount?: number;
  /** Number of tokens of thoughts for thinking models. */
  thoughtsTokenCount?: number;
  /** Total token count for prompt, response candidates, and tool-use prompts(if present). */
  totalTokenCount?: number;
  /** List of modalities that were processed in the request input. */
  promptTokensDetails?: ModalityTokenCount[];
  /** List of modalities that were processed in the cache input. */
  cacheTokensDetails?: ModalityTokenCount[];
  /** List of modalities that were returned in the response. */
  responseTokensDetails?: ModalityTokenCount[];
  /** List of modalities that were processed in the tool-use prompt. */
  toolUsePromptTokensDetails?: ModalityTokenCount[];
  /** Traffic type. This shows whether a request consumes Pay-As-You-Go
   or Provisioned Throughput quota. */
  trafficType?: TrafficType;
}
/**
 * Input provided by the user.
 */
declare interface UserInputStep {
  type: 'user_input';
  content?: Array<Content_2>;
}
/** The type of the VAD signal. */
declare enum VadSignalType {
  /**
   * The default is VAD_SIGNAL_TYPE_UNSPECIFIED.
   */
  VAD_SIGNAL_TYPE_UNSPECIFIED = "VAD_SIGNAL_TYPE_UNSPECIFIED",
  /**
   * Start of sentence signal.
   */
  VAD_SIGNAL_TYPE_SOS = "VAD_SIGNAL_TYPE_SOS",
  /**
   * End of sentence signal.
   */
  VAD_SIGNAL_TYPE_EOS = "VAD_SIGNAL_TYPE_EOS"
}
/** Hyperparameters for Veo. This data type is not supported in Gemini API. */
declare interface VeoHyperParameters {
  /** Optional. Number of complete passes the model makes over the entire training dataset during training. */
  epochCount?: string;
  /** Optional. Multiplier for adjusting the default learning rate. */
  learningRateMultiplier?: number;
  /** The tuning task for Veo. */
  tuningTask?: TuningTask;
  /** Optional. The ratio of Google internal dataset to use in the training mixture, in range of `[0, 1)`. If `0.2`, it means 20% of Google internal dataset and 80% of user dataset will be used for training. If not set, the default value is 0.1. */
  veoDataMixtureRatio?: number;
  /** Optional. The adapter size for LoRA tuning. */
  adapterSize?: AdapterSize;
  /** The speed of the tuning job. Only supported for Veo 3.0 models. */
  tuningSpeed?: TuningSpeed;
}
/** Tuning Spec for Veo LoRA Model Tuning. This data type is not supported in Gemini API. */
declare interface VeoLoraTuningSpec {
  /** Optional. Hyperparameters for Veo LoRA. */
  hyperParameters?: VeoHyperParameters;
  /** Required. Training dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  trainingDatasetUri?: string;
  /** Optional. Validation dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  validationDatasetUri?: string;
  /** Optional. The orientation of the video. Defaults to LANDSCAPE. */
  videoOrientation?: VideoOrientation;
}
/** Tuning Spec for Veo Model Tuning. This data type is not supported in Gemini API. */
declare interface VeoTuningSpec {
  /** Optional. Hyperparameters for Veo. */
  hyperParameters?: VeoHyperParameters;
  /** Required. Training dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  trainingDatasetUri?: string;
  /** Optional. Validation dataset used for tuning. The dataset can be specified as either a Cloud Storage path to a JSONL file or as the resource name of a Vertex Multimodal Dataset. */
  validationDatasetUri?: string;
}
/** Retrieve from Vertex AI Search datastore or engine for grounding. datastore and engine are mutually exclusive. See https://cloud.google.com/products/agent-builder. This data type is not supported in Gemini API. */
declare interface VertexAISearch {
  /** Specifications that define the specific DataStores to be searched, along with configurations for those data stores. This is only considered for Engines with multiple data stores. It should only be set if engine is used. */
  dataStoreSpecs?: VertexAISearchDataStoreSpec[];
  /** Optional. Fully-qualified Vertex AI Search data store resource ID. Format: `projects/{project}/locations/{location}/collections/{collection}/dataStores/{dataStore}` */
  datastore?: string;
  /** Optional. Fully-qualified Vertex AI Search engine resource ID. Format: `projects/{project}/locations/{location}/collections/{collection}/engines/{engine}` */
  engine?: string;
  /** Optional. Filter strings to be passed to the search API. */
  filter?: string;
  /** Optional. Number of search results to return per query. The default value is 10. The maximumm allowed value is 10. */
  maxResults?: number;
}
/** Define data stores within engine to filter on in a search call and configurations for those data stores. For more information, see https://cloud.google.com/generative-ai-app-builder/docs/reference/rpc/google.cloud.discoveryengine.v1#datastorespec. This data type is not supported in Gemini API. */
declare interface VertexAISearchDataStoreSpec {
  /** Full resource name of DataStore, such as Format: `projects/{project}/locations/{location}/collections/{collection}/dataStores/{dataStore}` */
  dataStore?: string;
  /** Optional. Filter specification to filter documents in the data store specified by data_store field. For more information on filtering, see [Filtering](https://cloud.google.com/generative-ai-app-builder/docs/filter-search-metadata) */
  filter?: string;
}
/** This class is experimental and may change in future versions.

 The specification for an output Vertex AI multimodal dataset. */
declare interface VertexMultimodalDatasetDestination {
  /** The BigQuery destination for the multimodal dataset. */
  bigqueryDestination?: string;
  /** The display name of the multimodal dataset. */
  displayName?: string;
}
/** Retrieve from Vertex RAG Store for grounding. This data type is not supported in Gemini API. */
declare interface VertexRagStore {
  /** Optional. Deprecated. Please use rag_resources instead. */
  ragCorpora?: string[];
  /** Optional. The representation of the rag source. It can be used to specify corpus only or ragfiles. Currently only support one corpus or multiple files from one corpus. In the future we may open up multiple corpora support. */
  ragResources?: VertexRagStoreRagResource[];
  /** Optional. The retrieval config for the Rag query. */
  ragRetrievalConfig?: RagRetrievalConfig;
  /** Optional. Number of top k results to return from the selected corpora. */
  similarityTopK?: number;
  /** Optional. Currently only supported for Gemini Multimodal Live API. In Gemini Multimodal Live API, if `store_context` bool is specified, Gemini will leverage it to automatically memorize the interactions between the client and Gemini, and retrieve context when needed to augment the response generation for users' ongoing and future interactions. */
  storeContext?: boolean;
  /** Optional. Only return results with vector distance smaller than the threshold. */
  vectorDistanceThreshold?: number;
}
/** The definition of the Rag resource. This data type is not supported in Gemini API. */
declare interface VertexRagStoreRagResource {
  /** Optional. RagCorpora resource name. Format: `projects/{project}/locations/{location}/ragCorpora/{rag_corpus}` */
  ragCorpus?: string;
  /** Optional. rag_file_id. The files should be in the same rag_corpus set in rag_corpus field. */
  ragFileIds?: string[];
}
/** A generated video. */
declare interface Video {
  /** Path to another storage. */
  uri?: string;
  /** Video bytes.
   * @remarks Encoded as base64 string. */
  videoBytes?: string;
  /** Video encoding, for example ``video/mp4``. */
  mimeType?: string;
}
/** Enum that controls the compression quality of the generated videos. */
declare enum VideoCompressionQuality {
  /**
   * Optimized video compression quality. This will produce videos
   with a compressed, smaller file size.
   */
  OPTIMIZED = "OPTIMIZED",
  /**
   * Lossless video compression quality. This will produce videos
   with a larger file size.
   */
  LOSSLESS = "LOSSLESS"
}
/**
 * A video content block.
 */
declare interface VideoContent {
  type: 'video';
  /**
   * The video content.
   */
  data?: string;
  /**
   * The mime type of the video.
   */
  mime_type?: 'video/mp4' | 'video/mpeg' | 'video/mpg' | 'video/mov' | 'video/avi' | 'video/x-flv' | 'video/webm' | 'video/wmv' | 'video/3gpp';
  /**
   * The resolution of the media.
   */
  resolution?: 'low' | 'medium' | 'high' | 'ultra_high';
  /**
   * The URI of the video.
   */
  uri?: string;
}
/** A mask for video generation. */
declare interface VideoGenerationMask {
  /** The image mask to use for generating videos. */
  image?: Image_2;
  /** Describes how the mask will be used. Inpainting masks must
   match the aspect ratio of the input video. Outpainting masks can be
   either 9:16 or 16:9. */
  maskMode?: VideoGenerationMaskMode;
}
/** Enum for the mask mode of a video generation mask. */
declare enum VideoGenerationMaskMode {
  /**
   * The image mask contains a masked rectangular region which is
   applied on the first frame of the input video. The object described in
   the prompt is inserted into this region and will appear in subsequent
   frames.
   */
  INSERT = "INSERT",
  /**
   * The image mask is used to determine an object in the
   first video frame to track. This object is removed from the video.
   */
  REMOVE = "REMOVE",
  /**
   * The image mask is used to determine a region in the
   video. Objects in this region will be removed.
   */
  REMOVE_STATIC = "REMOVE_STATIC",
  /**
   * The image mask contains a masked rectangular region where
   the input video will go. The remaining area will be generated. Video
   masks are not supported.
   */
  OUTPAINT = "OUTPAINT"
}
/** A reference image for video generation. */
declare interface VideoGenerationReferenceImage {
  /** The reference image. */
  image?: Image_2;
  /** The type of the reference image, which defines how the reference
   image will be used to generate the video. */
  referenceType?: VideoGenerationReferenceType;
}
/** Enum for the reference type of a video generation reference image. */
declare enum VideoGenerationReferenceType {
  /**
   * A reference image that provides assets to the generated video,
   such as the scene, an object, a character, etc.
   */
  ASSET = "ASSET",
  /**
   * A reference image that provides aesthetics including colors,
   lighting, texture, etc., to be used as the style of the generated video,
   such as 'anime', 'photography', 'origami', etc.
   */
  STYLE = "STYLE"
}
/** Provides metadata for a video, including the start and end offsets for clipping and the frame rate. */
declare interface VideoMetadata {
  /** Optional. The end offset of the video. */
  endOffset?: string;
  /** Optional. The frame rate of the video sent to the model. If not specified, the default value is 1.0. The valid range is (0.0, 24.0]. */
  fps?: number;
  /** Optional. The start offset of the video. */
  startOffset?: string;
}
/** The orientation of the video. Defaults to LANDSCAPE. This enum is not supported in Gemini API. */
declare enum VideoOrientation {
  /**
   * Unspecified video orientation. Defaults to landscape.
   */
  VIDEO_ORIENTATION_UNSPECIFIED = "VIDEO_ORIENTATION_UNSPECIFIED",
  /**
   * Landscape orientation (e.g. 16:9, 1280x720).
   */
  LANDSCAPE = "LANDSCAPE",
  /**
   * Portrait orientation (e.g. 9:16, 720x1280).
   */
  PORTRAIT = "PORTRAIT"
}
/** Voice activity signal. */
declare interface VoiceActivity {
  /** The type of the voice activity signal. */
  voiceActivityType?: VoiceActivityType;
}
declare interface VoiceActivityDetectionSignal {
  /** The type of the VAD signal. */
  vadSignalType?: VadSignalType;
}
/** The type of the voice activity signal. */
declare enum VoiceActivityType {
  /**
   * The default is VOICE_ACTIVITY_TYPE_UNSPECIFIED.
   */
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  /**
   * Start of sentence signal.
   */
  ACTIVITY_START = "ACTIVITY_START",
  /**
   * End of sentence signal.
   */
  ACTIVITY_END = "ACTIVITY_END"
}
/** The configuration for the voice to use. */
declare interface VoiceConfig {
  /** The configuration for a replicated voice, which is a clone of a
   user's voice that can be used for speech synthesis. If this is unset, a
   default voice is used. */
  replicatedVoiceConfig?: ReplicatedVoiceConfig;
  /** The configuration for a prebuilt voice. */
  prebuiltVoiceConfig?: PrebuiltVoiceConfig;
}
/**
 * A Webhook resource.
 */
declare interface Webhook {
  /**
   * Required. The events that the webhook is subscribed to. Available events:
   *
   * - batch.succeeded
   * - batch.expired
   * - batch.failed
   * - interaction.requires_action
   * - interaction.completed
   * - interaction.failed
   * - video.generated
   */
  subscribed_events: Array<'batch.succeeded' | 'batch.expired' | 'batch.failed' | 'interaction.requires_action' | 'interaction.completed' | 'interaction.failed' | 'video.generated' | (string & {})>;
  /**
   * Required. The URI to which webhook events will be sent.
   */
  uri: string;
  /**
   * Output only. The ID of the webhook.
   */
  id?: string;
  /**
   * Output only. The timestamp when the webhook was created.
   */
  create_time?: string;
  /**
   * Optional. The user-provided name of the webhook.
   */
  name?: string;
  /**
   * Output only. The new signing secret for the webhook. Only populated on create.
   */
  new_signing_secret?: string;
  /**
   * Output only. The signing secrets associated with this webhook.
   */
  signing_secrets?: Array<SigningSecret>;
  /**
   * Output only. The state of the webhook.
   */
  state?: 'enabled' | 'disabled' | 'disabled_due_to_failed_deliveries';
  /**
   * Output only. The timestamp when the webhook was last updated.
   */
  update_time?: string;
}
/** Configuration for webhook notifications.

 Used to configure webhook endpoints that will receive notifications
 when long-running operations (e.g., batch jobs, video generation) complete. */
declare interface WebhookConfig {
  /** The webhook URIs to receive notifications. If set, these
   webhook URIs will be used instead of the registered webhooks. */
  uris?: string[];
  /** User metadata that will be included in each webhook event
   notification. Use this to attach custom key-value data to correlate
   webhook events with your internal systems. */
  userMetadata?: Record<string, unknown>;
}
/**
 * Message for configuring webhook events for a request.
 */
declare interface WebhookConfig_2 {
  /**
   * Optional. If set, these webhook URIs will be used for webhook events instead of
   * the registered webhooks.
   */
  uris?: Array<string>;
  /**
   * Optional. The user metadata that will be returned on each event emission to the
   * webhooks.
   */
  user_metadata?: {
    [key: string]: unknown;
  };
}
declare interface WebhookCreateParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Body param: Required. The events that the webhook is subscribed to. Available
   * events:
   *
   * - batch.succeeded
   * - batch.expired
   * - batch.failed
   * - interaction.requires_action
   * - interaction.completed
   * - interaction.failed
   * - video.generated
   */
  subscribed_events: Array<'batch.succeeded' | 'batch.expired' | 'batch.failed' | 'interaction.requires_action' | 'interaction.completed' | 'interaction.failed' | 'video.generated' | (string & {})>;
  /**
   * Body param: Required. The URI to which webhook events will be sent.
   */
  uri: string;
  /**
   * Body param: Optional. The user-provided name of the webhook.
   */
  name?: string;
}
declare interface WebhookDeleteParams {
  /**
   * Which version of the API to use.
   */
  api_version?: string;
}
/**
 * A generic empty message that you can re-use to avoid defining duplicated empty
 * messages in your APIs. A typical example is to use it as the request or the
 * response type of an API method. For instance:
 *
 *     service Foo {
 *       rpc Bar(google.protobuf.Empty) returns (google.protobuf.Empty);
 *     }
 */
declare interface WebhookDeleteResponse {}
declare interface WebhookGetParams {
  /**
   * Which version of the API to use.
   */
  api_version?: string;
}
declare interface WebhookListParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Query param: Optional. The maximum number of webhooks to return. The service may
   * return fewer than this value. If unspecified, at most 50 webhooks will be
   * returned. The maximum value is 1000.
   */
  page_size?: number;
  /**
   * Query param: Optional. A page token, received from a previous `ListWebhooks`
   * call. Provide this to retrieve the subsequent page.
   */
  page_token?: string;
}
/**
 * Response message for WebhookService.ListWebhooks.
 */
declare interface WebhookListResponse {
  /**
   * A token, which can be sent as `page_token` to retrieve the next page. If this
   * field is omitted, there are no subsequent pages.
   */
  next_page_token?: string;
  /**
   * The webhooks.
   */
  webhooks?: Array<Webhook>;
}
declare interface WebhookPingParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Body param: Request message for WebhookService.PingWebhook.
   */
  body?: WebhookPingParams.Body;
}
declare namespace WebhookPingParams {
  /**
   * Request message for WebhookService.PingWebhook.
   */
  interface Body {}
}
/**
 * Response message for WebhookService.PingWebhook.
 */
declare interface WebhookPingResponse {}
declare interface WebhookRotateSigningSecretParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Body param: Optional. The revocation behavior for previous signing secrets.
   */
  revocation_behavior?: 'revoke_previous_secrets_after_h24' | 'revoke_previous_secrets_immediately';
}
/**
 * Response message for WebhookService.RotateSigningSecret.
 */
declare interface WebhookRotateSigningSecretResponse {
  /**
   * Output only. The newly generated signing secret.
   */
  secret?: string;
}
declare class Webhooks extends BaseWebhooks {}
declare namespace Webhooks {
  export { type SigningSecret, type Webhook, type WebhookListResponse, type WebhookDeleteResponse, type WebhookPingResponse, type WebhookRotateSigningSecretResponse, type WebhookCreateParams, type WebhookUpdateParams, type WebhookListParams, type WebhookDeleteParams, type WebhookGetParams, type WebhookPingParams, type WebhookRotateSigningSecretParams };
}
declare interface WebhookUpdateParams {
  /**
   * Path param: Which version of the API to use.
   */
  api_version?: string;
  /**
   * Query param: Optional. The list of fields to update.
   */
  update_mask?: string;
  /**
   * Body param: Optional. The user-provided name of the webhook.
   */
  name?: string;
  /**
   * Body param: Optional. The state of the webhook.
   */
  state?: 'enabled' | 'disabled' | 'disabled_due_to_failed_deliveries';
  /**
   * Body param: Optional. The events that the webhook is subscribed to. Available
   * events:
   *
   * - batch.succeeded
   * - batch.expired
   * - batch.failed
   * - interaction.requires_action
   * - interaction.completed
   * - interaction.failed
   * - video.generated
   */
  subscribed_events?: Array<'batch.succeeded' | 'batch.expired' | 'batch.failed' | 'interaction.requires_action' | 'interaction.completed' | 'interaction.failed' | 'video.generated' | (string & {})>;
  /**
   * Body param: Optional. The URI to which webhook events will be sent.
   */
  uri?: string;
}
/** Standard web search for grounding and related configurations. Only text results are returned. */
declare interface WebSearch {}
declare interface WebSocket_2 {
  /**
   * Connects the socket to the server.
   */
  connect(): void;
  /**
   * Sends a message to the server.
   */
  send(message: string): void;
  /**
   * Closes the socket connection.
   */
  close(): void;
}
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
declare interface WebSocketCallbacks {
  onopen: () => void;
  onerror: (e: any) => void;
  onmessage: (e: any) => void;
  onclose: (e: any) => void;
}
declare interface WebSocketFactory {
  /**
   * Returns a new WebSocket instance.
   */
  create(url: string, headers: Record<string, string>, callbacks: WebSocketCallbacks): WebSocket_2;
}
/** Maps a prompt to a relative weight to steer music generation. */
declare interface WeightedPrompt {
  /** Text prompt. */
  text?: string;
  /** Weight of the prompt. The weight is used to control the relative
   importance of the prompt. Higher weights are more important than lower
   weights.
     Weight must not be 0. Weights of all weighted_prompts in this
   LiveMusicClientContent message will be normalized. */
  weight?: number;
}
/** Configuration for a white space chunking algorithm. */
declare interface WhiteSpaceConfig {
  /** Maximum number of tokens per chunk. */
  maxTokensPerChunk?: number;
  /** Maximum number of overlapping tokens between two adjacent chunks. */
  maxOverlapTokens?: number;
}
//#endregion
//#region extensions/google/google-genai-runtime.d.ts
type GoogleGenAIClient = InstanceType<typeof GoogleGenAI>;
type GoogleGenAIOptions = ConstructorParameters<typeof GoogleGenAI>[0];
declare function createGoogleGenAI(options: GoogleGenAIOptions): GoogleGenAIClient;
//#endregion
export { GoogleGenAIClient, createGoogleGenAI };