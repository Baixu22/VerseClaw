/// <reference types="node" />
import { a as __toESM, i as __require, t as __commonJSMin } from "../../chunk-D0VCBZRD.js";
import { Blob as Blob$1, File as File$1 } from "node:buffer";
import fs from "node:fs";
import { URL as URL$1, URLSearchParams as URLSearchParams$1 } from "node:url";
import { Duplex, Readable, Writable } from "node:stream";
import JSON5 from "json5";
import { IpcNetConnectOpts, Socket, TcpNetConnectOpts } from "node:net";
import { Static, TSchema, Type } from "typebox";
import { EventEmitter } from "node:events";
import { AutocompleteItem, AutocompleteProvider, Box, Component, Container, Editor, EditorComponent, EditorTheme, Input, KeyId, KeybindingsManager, OverlayHandle, OverlayOptions, SelectList, SettingsList, TUI } from "@earendil-works/pi-tui";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ConnectionOptions, TLSSocket } from "node:tls";
import { Readable as Readable$1 } from "stream";
import { EventEmitter as EventEmitter$1 } from "events";
import { Agent } from "http";
import { ReadableStream as ReadableStream$1 } from "stream/web";
//#region ../node_modules/.pnpm/@earendil-works+pi-ai@0.75._3ea128c92bbfa86e7bf0be095ab1043e/node_modules/@earendil-works/pi-ai/dist/types.d.ts
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}
interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
/**
 * Compatibility settings for OpenAI-compatible completions APIs.
 * Use this to override URL-based auto-detection for custom providers.
 */
interface OpenAICompletionsCompat {
  /** Whether the provider supports the `store` field. Default: auto-detected from URL. */
  supportsStore?: boolean;
  /** Whether the provider supports the `developer` role (vs `system`). Default: auto-detected from URL. */
  supportsDeveloperRole?: boolean;
  /** Whether the provider supports `reasoning_effort`. Default: auto-detected from URL. */
  supportsReasoningEffort?: boolean;
  /** Whether the provider supports `stream_options: { include_usage: true }` for token usage in streaming responses. Default: true. */
  supportsUsageInStreaming?: boolean;
  /** Which field to use for max tokens. Default: auto-detected from URL. */
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  /** Whether tool results require the `name` field. Default: auto-detected from URL. */
  requiresToolResultName?: boolean;
  /** Whether a user message after tool results requires an assistant message in between. Default: auto-detected from URL. */
  requiresAssistantAfterToolResult?: boolean;
  /** Whether thinking blocks must be converted to text blocks with <thinking> delimiters. Default: auto-detected from URL. */
  requiresThinkingAsText?: boolean;
  /** Whether all replayed assistant messages must include an empty reasoning_content field when reasoning is enabled. Default: auto-detected from URL. */
  requiresReasoningContentOnAssistantMessages?: boolean;
  /** Format for reasoning/thinking parameter. "openai" uses reasoning_effort, "openrouter" uses reasoning: { effort }, "deepseek" uses thinking: { type } plus reasoning_effort, "together" uses reasoning: { enabled } plus reasoning_effort when supported, "zai" uses top-level enable_thinking: boolean, "qwen" uses top-level enable_thinking: boolean, and "qwen-chat-template" uses chat_template_kwargs.enable_thinking. Default: "openai". */
  thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "zai" | "qwen" | "qwen-chat-template";
  /** OpenRouter-specific routing preferences. Only used when baseUrl points to OpenRouter. */
  openRouterRouting?: OpenRouterRouting;
  /** Vercel AI Gateway routing preferences. Only used when baseUrl points to Vercel AI Gateway. */
  vercelGatewayRouting?: VercelGatewayRouting;
  /** Whether z.ai supports top-level `tool_stream: true` for streaming tool call deltas. Default: false. */
  zaiToolStream?: boolean;
  /** Whether the provider supports the `strict` field in tool definitions. Default: true. */
  supportsStrictMode?: boolean;
  /** Cache control convention for prompt caching. "anthropic" applies Anthropic-style `cache_control` markers to the system prompt, last tool definition, and last user/assistant text content. */
  cacheControlFormat?: "anthropic";
  /** Whether to send known session-affinity headers (`session_id`, `x-client-request-id`, `x-session-affinity`) from `options.sessionId` when caching is enabled. Default: false. */
  sendSessionAffinityHeaders?: boolean;
  /** Whether the provider supports long prompt cache retention (`prompt_cache_retention: "24h"` or Anthropic-style `cache_control.ttl: "1h"`, depending on format). Default: true. */
  supportsLongCacheRetention?: boolean;
}
/** Compatibility settings for OpenAI Responses APIs. */
interface OpenAIResponsesCompat {
  /** Whether to send the OpenAI `session_id` cache-affinity header from `options.sessionId` when caching is enabled. Default: true. */
  sendSessionIdHeader?: boolean;
  /** Whether the provider supports `prompt_cache_retention: "24h"`. Default: true. */
  supportsLongCacheRetention?: boolean;
}
/** Compatibility settings for Anthropic Messages-compatible APIs. */
interface AnthropicMessagesCompat {
  /**
   * Whether the provider accepts per-tool `eager_input_streaming`.
   * When false, the Anthropic provider omits `tools[].eager_input_streaming`
   * and sends the legacy `fine-grained-tool-streaming-2025-05-14` beta header
   * for tool-enabled requests.
   * Default: true.
   */
  supportsEagerToolInputStreaming?: boolean;
  /** Whether the provider supports Anthropic long cache retention (`cache_control.ttl: "1h"`). Default: true. */
  supportsLongCacheRetention?: boolean;
  /**
   * Whether to send the `x-session-affinity` header from `options.sessionId`
   * when caching is enabled. Required for providers like Fireworks that use
   * session affinity for prompt cache routing (requests to the same replica
   * maximize cache hits).
   * Default: false.
   */
  sendSessionAffinityHeaders?: boolean;
  /**
   * Whether the provider supports Anthropic-style `cache_control` markers on
   * tool definitions. When false, `cache_control` is omitted from tool params.
   * Some Anthropic-compatible providers (e.g., Fireworks) do not support this
   * field on tools and may reject or ignore it.
   * Default: true.
   */
  supportsCacheControlOnTools?: boolean;
}
/**
 * OpenRouter provider routing preferences.
 * Controls which upstream providers OpenRouter routes requests to.
 * Sent as the `provider` field in the OpenRouter API request body.
 * @see https://openrouter.ai/docs/guides/routing/provider-selection
 */
interface OpenRouterRouting {
  /** Whether to allow backup providers to serve requests. Default: true. */
  allow_fallbacks?: boolean;
  /** Whether to filter providers to only those that support all parameters in the request. Default: false. */
  require_parameters?: boolean;
  /** Data collection setting. "allow" (default): allow providers that may store/train on data. "deny": only use providers that don't collect user data. */
  data_collection?: "deny" | "allow";
  /** Whether to restrict routing to only ZDR (Zero Data Retention) endpoints. */
  zdr?: boolean;
  /** Whether to restrict routing to only models that allow text distillation. */
  enforce_distillable_text?: boolean;
  /** An ordered list of provider names/slugs to try in sequence, falling back to the next if unavailable. */
  order?: string[];
  /** List of provider names/slugs to exclusively allow for this request. */
  only?: string[];
  /** List of provider names/slugs to skip for this request. */
  ignore?: string[];
  /** A list of quantization levels to filter providers by (e.g., ["fp16", "bf16", "fp8", "fp6", "int8", "int4", "fp4", "fp32"]). */
  quantizations?: string[];
  /** Sorting strategy. Can be a string (e.g., "price", "throughput", "latency") or an object with `by` and `partition`. */
  sort?: string | {
    /** The sorting metric: "price", "throughput", "latency". */by?: string; /** Partitioning strategy: "model" (default) or "none". */
    partition?: string | null;
  };
  /** Maximum price per million tokens (USD). */
  max_price?: {
    /** Price per million prompt tokens. */prompt?: number | string; /** Price per million completion tokens. */
    completion?: number | string; /** Price per image. */
    image?: number | string; /** Price per audio unit. */
    audio?: number | string; /** Price per request. */
    request?: number | string;
  };
  /** Preferred minimum throughput (tokens/second). Can be a number (applies to p50) or an object with percentile-specific cutoffs. */
  preferred_min_throughput?: number | {
    /** Minimum tokens/second at the 50th percentile. */p50?: number; /** Minimum tokens/second at the 75th percentile. */
    p75?: number; /** Minimum tokens/second at the 90th percentile. */
    p90?: number; /** Minimum tokens/second at the 99th percentile. */
    p99?: number;
  };
  /** Preferred maximum latency (seconds). Can be a number (applies to p50) or an object with percentile-specific cutoffs. */
  preferred_max_latency?: number | {
    /** Maximum latency in seconds at the 50th percentile. */p50?: number; /** Maximum latency in seconds at the 75th percentile. */
    p75?: number; /** Maximum latency in seconds at the 90th percentile. */
    p90?: number; /** Maximum latency in seconds at the 99th percentile. */
    p99?: number;
  };
}
/**
 * Vercel AI Gateway routing preferences.
 * Controls which upstream providers the gateway routes requests to.
 * @see https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 */
interface VercelGatewayRouting {
  /** List of provider slugs to exclusively use for this request (e.g., ["bedrock", "anthropic"]). */
  only?: string[];
  /** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
  order?: string[];
}
//#endregion
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/utility.d.ts
type AutocompletePrimitiveBaseType<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : never;
type Autocomplete<T> = T | (AutocompletePrimitiveBaseType<T> & Record<never, never>);
//#endregion
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/header.d.ts
/**
 * The header type declaration of `undici`.
 */
type IncomingHttpHeaders = Record<string, string | string[] | undefined>;
/**
 * The header type declaration of `undici` for outgoing requests.
 */
type OutgoingHttpHeaders = Record<string, number | string | string[] | undefined>;
type HeaderNames = Autocomplete<'Accept' | 'Accept-CH' | 'Accept-Charset' | 'Accept-Encoding' | 'Accept-Language' | 'Accept-Patch' | 'Accept-Post' | 'Accept-Ranges' | 'Access-Control-Allow-Credentials' | 'Access-Control-Allow-Headers' | 'Access-Control-Allow-Methods' | 'Access-Control-Allow-Origin' | 'Access-Control-Expose-Headers' | 'Access-Control-Max-Age' | 'Access-Control-Request-Headers' | 'Access-Control-Request-Method' | 'Age' | 'Allow' | 'Alt-Svc' | 'Alt-Used' | 'Authorization' | 'Cache-Control' | 'Clear-Site-Data' | 'Connection' | 'Content-Disposition' | 'Content-Encoding' | 'Content-Language' | 'Content-Length' | 'Content-Location' | 'Content-Range' | 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' | 'Content-Type' | 'Cookie' | 'Cross-Origin-Embedder-Policy' | 'Cross-Origin-Opener-Policy' | 'Cross-Origin-Resource-Policy' | 'Date' | 'Device-Memory' | 'ETag' | 'Expect' | 'Expect-CT' | 'Expires' | 'Forwarded' | 'From' | 'Host' | 'If-Match' | 'If-Modified-Since' | 'If-None-Match' | 'If-Range' | 'If-Unmodified-Since' | 'Keep-Alive' | 'Last-Modified' | 'Link' | 'Location' | 'Max-Forwards' | 'Origin' | 'Permissions-Policy' | 'Priority' | 'Proxy-Authenticate' | 'Proxy-Authorization' | 'Range' | 'Referer' | 'Referrer-Policy' | 'Retry-After' | 'Sec-Fetch-Dest' | 'Sec-Fetch-Mode' | 'Sec-Fetch-Site' | 'Sec-Fetch-User' | 'Sec-Purpose' | 'Sec-WebSocket-Accept' | 'Server' | 'Server-Timing' | 'Service-Worker-Navigation-Preload' | 'Set-Cookie' | 'SourceMap' | 'Strict-Transport-Security' | 'TE' | 'Timing-Allow-Origin' | 'Trailer' | 'Transfer-Encoding' | 'Upgrade' | 'Upgrade-Insecure-Requests' | 'User-Agent' | 'Vary' | 'Via' | 'WWW-Authenticate' | 'X-Content-Type-Options' | 'X-Frame-Options'>;
type IANARegisteredMimeType = Autocomplete<'audio/aac' | 'video/x-msvideo' | 'image/avif' | 'video/av1' | 'application/octet-stream' | 'image/bmp' | 'text/css' | 'text/csv' | 'application/vnd.ms-fontobject' | 'application/epub+zip' | 'image/gif' | 'application/gzip' | 'text/html' | 'image/x-icon' | 'text/calendar' | 'image/jpeg' | 'text/javascript' | 'application/json' | 'application/ld+json' | 'audio/x-midi' | 'audio/mpeg' | 'video/mp4' | 'video/mpeg' | 'audio/ogg' | 'video/ogg' | 'application/ogg' | 'audio/opus' | 'font/otf' | 'application/pdf' | 'image/png' | 'application/rtf' | 'image/svg+xml' | 'image/tiff' | 'video/mp2t' | 'font/ttf' | 'text/plain' | 'application/wasm' | 'video/webm' | 'audio/webm' | 'image/webp' | 'font/woff' | 'font/woff2' | 'application/xhtml+xml' | 'application/xml' | 'application/zip' | 'video/3gpp' | 'video/3gpp2' | 'model/gltf+json' | 'model/gltf-binary'>;
type KnownHeaderValues = {
  'content-type': IANARegisteredMimeType;
};
type HeaderRecord = { [K in HeaderNames | Lowercase<HeaderNames>]?: Lowercase<K> extends keyof KnownHeaderValues ? KnownHeaderValues[Lowercase<K>] : string };
//#endregion
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/readable.d.ts
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/fetch.d.ts
type BodyInit = ArrayBuffer | AsyncIterable<Uint8Array> | Blob$1 | FormData$1 | Iterable<Uint8Array> | NodeJS.ArrayBufferView | URLSearchParams$1 | null | string;
interface SpecIterator<T, TReturn = any, TNext = undefined> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
}
interface SpecIteratorObject<T, TReturn = undefined, TNext = unknown> extends SpecIterator<T, TReturn, TNext> {
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
interface SpecIterableIterator<T> extends SpecIteratorObject<T> {
  [Symbol.iterator](): SpecIterableIterator<T>;
}
interface SpecIterable<T> {
  [Symbol.iterator](): SpecIterableIterator<T>;
}
type HeadersInit = [string, string][] | HeaderRecord | Headers$1;
declare class Headers$1 implements SpecIterable<[string, string]> {
  constructor(init?: HeadersInit);
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
//#endregion
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/formdata.d.ts
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/connector.d.ts
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/client-stats.d.ts
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/client.d.ts
type ClientConnectOptions<TOpaque = null> = Omit<Dispatcher.ConnectOptions<TOpaque>, 'origin'>;
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
  override connect<TOpaque = null>(options: ClientConnectOptions<TOpaque>): Promise<Dispatcher.ConnectData<TOpaque>>;
  override connect<TOpaque = null>(options: ClientConnectOptions<TOpaque>, callback: (err: Error | null, data: Dispatcher.ConnectData<TOpaque>) => void): void;
}
declare namespace Client$1 {
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
    connect?: Partial<buildConnector.BuildOptions> | buildConnector.connector;
    /** The maximum number of requests to send over a single connection before it is reset. Use `0` to disable this limit. Default: `null`. */
    maxRequestsPerClient?: number;
    /** Local IP address the socket should connect from. */
    localAddress?: string;
    /** Max response body size in bytes, -1 is disabled */
    maxResponseSize?: number;
    /** WebSocket-specific options */
    webSocket?: Client$1.WebSocketOptions;
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/errors.d.ts
declare namespace Errors {
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/dispatcher.d.ts
type UndiciHeaders = OutgoingHttpHeaders | string[] | Iterable<[string, string | string[] | undefined]> | null;
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
  on(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  on(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  on(eventName: 'drain', callback: (origin: URL$1) => void): this;
  once(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  once(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  once(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  once(eventName: 'drain', callback: (origin: URL$1) => void): this;
  off(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  off(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  off(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  off(eventName: 'drain', callback: (origin: URL$1) => void): this;
  addListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  addListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  addListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  addListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  removeListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  removeListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  removeListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  removeListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  prependListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  prependOnceListener(eventName: 'connect', callback: (origin: URL$1, targets: readonly Dispatcher[]) => void): this;
  prependOnceListener(eventName: 'disconnect', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependOnceListener(eventName: 'connectionError', callback: (origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void): this;
  prependOnceListener(eventName: 'drain', callback: (origin: URL$1) => void): this;
  listeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher[]) => void)[];
  listeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  listeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  listeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  rawListeners(eventName: 'connect'): ((origin: URL$1, targets: readonly Dispatcher[]) => void)[];
  rawListeners(eventName: 'disconnect'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  rawListeners(eventName: 'connectionError'): ((origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError) => void)[];
  rawListeners(eventName: 'drain'): ((origin: URL$1) => void)[];
  emit(eventName: 'connect', origin: URL$1, targets: readonly Dispatcher[]): boolean;
  emit(eventName: 'disconnect', origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError): boolean;
  emit(eventName: 'connectionError', origin: URL$1, targets: readonly Dispatcher[], error: Errors.UndiciError): boolean;
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
    /** For H2, it appends the expect: 100-continue header, and halts the request body until a 100-continue is received from the remote server */
    expectContinue?: boolean;
  }
  export interface ConnectOptions<TOpaque = null> {
    origin: string | URL$1;
    path: string;
    /** Default: `null` */
    headers?: UndiciHeaders;
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
    headers?: UndiciHeaders;
    /** A string of comma separated protocols, in descending preference order. Default: `'Websocket'` */
    protocol?: string;
    /** Default: `null` */
    signal?: AbortSignal | EventEmitter | null;
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
    rawHeaders?: Buffer[] | string[] | IncomingHttpHeaders | null;
    rawTrailers?: Buffer[] | string[] | IncomingHttpHeaders | null;
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
    /** Invoked when response is received, before headers have been read. **/
    onResponseStarted?(): void;
    /** Invoked when a body chunk is sent to the server. May be invoked multiple times for chunked requests */
    onBodySent?(chunk: Buffer): void;
    /** Invoked after the request body is fully sent. */
    onRequestSent?(): void;
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
//#region ../node_modules/.pnpm/undici-types@8.3.0/node_modules/undici-types/mock-interceptor.d.ts
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
//#region ../node_modules/.pnpm/@google+genai@1.52.0_@model_3c31a015b14462b3a4f0aafd311f0f16/node_modules/@google/genai/dist/genai.d.ts
//#endregion
//#region ../node_modules/.pnpm/@earendil-works+pi-agent-co_0a0e3a3e1096bc1c9a3a65ae533aa8c7/node_modules/@earendil-works/pi-agent-core/dist/harness/messages.d.ts
interface BashExecutionMessage$1 {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  excludeFromContext?: boolean;
}
interface CustomMessage$1<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: T;
  timestamp: number;
}
interface BranchSummaryMessage$1 {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}
interface CompactionSummaryMessage$1 {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}
declare module "../types.ts" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage$1;
    custom: CustomMessage$1;
    branchSummary: BranchSummaryMessage$1;
    compactionSummary: CompactionSummaryMessage$1;
  }
}
//#endregion
//#region ../node_modules/.pnpm/@earendil-works+pi-coding-a_998091a29946ec209e36f7c0d09f7c02/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.d.ts
/**
 * Message type for bash executions via the ! command.
 */
interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  /** If true, this message is excluded from LLM context (!! prefix) */
  excludeFromContext?: boolean;
}
/**
 * Message type for extension-injected messages via sendMessage().
 * These are custom messages that extensions can inject into the conversation.
 */
interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: T;
  timestamp: number;
}
interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}
interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}
/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
//#endregion
//#region ../node_modules/.pnpm/@earendil-works+pi-coding-a_998091a29946ec209e36f7c0d09f7c02/node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.d.ts
interface AppKeybindings {
  "app.interrupt": true;
  "app.clear": true;
  "app.exit": true;
  "app.suspend": true;
  "app.thinking.cycle": true;
  "app.model.cycleForward": true;
  "app.model.cycleBackward": true;
  "app.model.select": true;
  "app.tools.expand": true;
  "app.thinking.toggle": true;
  "app.session.toggleNamedFilter": true;
  "app.editor.external": true;
  "app.message.followUp": true;
  "app.message.dequeue": true;
  "app.clipboard.pasteImage": true;
  "app.session.new": true;
  "app.session.tree": true;
  "app.session.fork": true;
  "app.session.resume": true;
  "app.tree.foldOrUp": true;
  "app.tree.unfoldOrDown": true;
  "app.tree.editLabel": true;
  "app.tree.toggleLabelTimestamp": true;
  "app.session.togglePath": true;
  "app.session.toggleSort": true;
  "app.session.rename": true;
  "app.session.delete": true;
  "app.session.deleteNoninvasive": true;
  "app.models.save": true;
  "app.models.enableAll": true;
  "app.models.clearAll": true;
  "app.models.toggleProvider": true;
  "app.models.reorderUp": true;
  "app.models.reorderDown": true;
  "app.tree.filter.default": true;
  "app.tree.filter.noTools": true;
  "app.tree.filter.userOnly": true;
  "app.tree.filter.labeledOnly": true;
  "app.tree.filter.all": true;
  "app.tree.filter.cycleForward": true;
  "app.tree.filter.cycleBackward": true;
}
declare module "@earendil-works/pi-tui" {
  interface Keybindings extends AppKeybindings {}
}
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/channels/chat-type.d.ts
type ChatType = "direct" | "group" | "channel";
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.tts.d.ts
type TtsProvider = string;
type TtsMode = "final" | "all";
type TtsAutoMode = "off" | "always" | "inbound" | "tagged";
type TtsModelOverrideConfig = {
  /** Enable model-provided overrides for TTS. */enabled?: boolean; /** Allow model-provided TTS text blocks. */
  allowText?: boolean; /** Allow model-provided provider override (default: false). */
  allowProvider?: boolean; /** Allow model-provided voice/voiceId override. */
  allowVoice?: boolean; /** Allow model-provided modelId override. */
  allowModelId?: boolean; /** Allow model-provided voice settings override. */
  allowVoiceSettings?: boolean; /** Allow model-provided normalization or language overrides. */
  allowNormalization?: boolean; /** Allow model-provided seed override. */
  allowSeed?: boolean;
};
type TtsProviderConfigMap = Record<string, Record<string, unknown>>;
type TtsPersonaFallbackPolicy = "preserve-persona" | "provider-defaults" | "fail";
type TtsPersonaPromptConfig = {
  profile?: string;
  scene?: string;
  sampleContext?: string;
  style?: string;
  accent?: string;
  pacing?: string;
  constraints?: string[];
};
type TtsPersonaConfig = {
  label?: string;
  description?: string; /** Preferred provider for this persona. Explicit provider prefs still win. */
  provider?: TtsProvider;
  fallbackPolicy?: TtsPersonaFallbackPolicy;
  prompt?: TtsPersonaPromptConfig; /** Provider-specific persona bindings keyed by speech provider id. */
  providers?: TtsProviderConfigMap;
};
type TtsConfig = {
  /** Auto-TTS mode (preferred). */auto?: TtsAutoMode; /** @deprecated Use auto. */
  enabled?: boolean; /** Apply TTS to final replies only or to all replies (tool/block/final). */
  mode?: TtsMode; /** Primary TTS provider (fallbacks are automatic). */
  provider?: TtsProvider; /** Active TTS persona id. */
  persona?: string; /** Named TTS personas. */
  personas?: Record<string, TtsPersonaConfig>; /** Optional model override for TTS auto-summary (provider/model or alias). */
  summaryModel?: string; /** Allow the model to override TTS parameters. */
  modelOverrides?: TtsModelOverrideConfig; /** Provider-specific TTS settings keyed by speech provider id. */
  providers?: TtsProviderConfigMap; /** Optional path for local TTS user preferences JSON. */
  prefsPath?: string; /** Hard cap for text sent to TTS (chars). */
  maxTextLength?: number; /** API request timeout (ms). */
  timeoutMs?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/shared/silent-reply-policy.d.ts
type SilentReplyPolicy = "allow" | "disallow";
type SilentReplyConversationType = "direct" | "group" | "internal";
type SilentReplyPolicyShape = Partial<Record<Exclude<SilentReplyConversationType, "direct">, SilentReplyPolicy>>;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.secrets.d.ts
type SecretRefSource = "env" | "file" | "exec";
/**
 * Stable identifier for a secret in a configured source.
 * Examples:
 * - env source: provider "default", id "OPENAI_API_KEY"
 * - file source: provider "mounted-json", id "/providers/openai/apiKey"
 * - exec source: provider "vault", id "openai/api-key"
 */
type SecretRef = {
  source: SecretRefSource;
  provider: string;
  id: string;
};
type SecretInput = string | SecretRef;
type EnvSecretProviderConfig = {
  source: "env"; /** Optional env var allowlist (exact names). */
  allowlist?: string[];
};
type FileSecretProviderMode = "singleValue" | "json";
type FileSecretProviderConfig = {
  source: "file";
  path: string;
  mode?: FileSecretProviderMode;
  timeoutMs?: number;
  maxBytes?: number;
  allowInsecurePath?: boolean;
};
type ExecSecretProviderConfig = {
  source: "exec";
  command: string;
  args?: string[];
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  maxOutputBytes?: number;
  jsonOnly?: boolean;
  env?: Record<string, string>;
  passEnv?: string[];
  trustedDirs?: string[];
  allowInsecurePath?: boolean;
  allowSymlinkCommand?: boolean;
};
type SecretProviderConfig = EnvSecretProviderConfig | FileSecretProviderConfig | ExecSecretProviderConfig;
type SecretsConfig = {
  providers?: Record<string, SecretProviderConfig>;
  defaults?: {
    env?: string;
    file?: string;
    exec?: string;
  };
  resolution?: {
    maxProviderConcurrency?: number;
    maxRefsPerProvider?: number;
    maxBatchBytes?: number;
  };
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.sandbox.d.ts
type SandboxDockerSettings = {
  /** Docker image to use for sandbox containers. */image?: string; /** Prefix for sandbox container names. */
  containerPrefix?: string; /** Container workdir mount path (default: /workspace). */
  workdir?: string; /** Run container rootfs read-only. */
  readOnlyRoot?: boolean; /** Extra tmpfs mounts for read-only containers. */
  tmpfs?: string[]; /** Container network mode (bridge|none|custom). */
  network?: string; /** Container user (uid:gid). */
  user?: string; /** Drop Linux capabilities. */
  capDrop?: string[]; /** Explicit environment variables for sandbox container creation and exec. */
  env?: Record<string, string>; /** Optional setup command run once after container creation (array entries are joined by newline). */
  setupCommand?: string; /** Limit container PIDs (0 = Docker default). */
  pidsLimit?: number; /** Limit container memory (e.g. 512m, 2g, or bytes as number). */
  memory?: string | number; /** Limit container memory swap (same format as memory). */
  memorySwap?: string | number; /** Limit container CPU shares (e.g. 0.5, 1, 2). */
  cpus?: number; /** GPU devices to expose via Docker --gpus (e.g. "all", "device=GPU-uuid"). */
  gpus?: string;
  /**
   * Set ulimit values by name (e.g. nofile, nproc).
   * Use "soft:hard" string, a number, or { soft, hard }.
   */
  ulimits?: Record<string, string | number | {
    soft?: number;
    hard?: number;
  }>; /** Seccomp profile (path or profile name). */
  seccompProfile?: string; /** AppArmor profile name. */
  apparmorProfile?: string; /** DNS servers (e.g. ["1.1.1.1", "8.8.8.8"]). */
  dns?: string[]; /** Extra host mappings (e.g. ["api.local:10.0.0.2"]). */
  extraHosts?: string[]; /** Additional bind mounts (host:container:mode format, e.g. ["/host/path:/container/path:rw"]). */
  binds?: string[];
  /**
   * Dangerous override: allow bind mounts that target reserved container paths
   * like /workspace or /agent.
   */
  dangerouslyAllowReservedContainerTargets?: boolean;
  /**
   * Dangerous override: allow bind mount sources outside runtime allowlisted roots
   * (workspace + agent workspace roots).
   */
  dangerouslyAllowExternalBindSources?: boolean;
  /**
   * Dangerous override: allow Docker `network: "container:<id>"` namespace joins.
   * Default behavior blocks container namespace joins to preserve sandbox isolation.
   */
  dangerouslyAllowContainerNamespaceJoin?: boolean;
};
type SandboxBrowserSettings = {
  enabled?: boolean;
  image?: string;
  containerPrefix?: string; /** Docker network for sandbox browser containers (default: openclaw-sandbox-browser). */
  network?: string;
  cdpPort?: number; /** Optional CIDR allowlist for CDP ingress at the container edge (for example: 172.21.0.1/32). */
  cdpSourceRange?: string;
  vncPort?: number;
  noVncPort?: number;
  headless?: boolean;
  enableNoVnc?: boolean;
  /**
   * Allow sandboxed sessions to target the host browser control server.
   * Default: false.
   */
  allowHostControl?: boolean;
  /**
   * When true (default), sandboxed browser control will try to start/reattach to
   * the sandbox browser container when a tool call needs it.
   */
  autoStart?: boolean; /** Max time to wait for CDP to become reachable after auto-start (ms). */
  autoStartTimeoutMs?: number; /** Additional bind mounts for the browser container only. When set, replaces docker.binds for the browser container. */
  binds?: string[];
};
type SandboxPruneSettings = {
  /** Prune if idle for more than N hours (0 disables). */idleHours?: number; /** Prune if older than N days (0 disables). */
  maxAgeDays?: number;
};
type SandboxSshSettings = {
  /** SSH target in user@host[:port] form. */target?: string; /** SSH client command. Default: "ssh". */
  command?: string; /** Absolute remote root used for per-scope workspaces. */
  workspaceRoot?: string; /** Enforce host-key verification. Default: true. */
  strictHostKeyChecking?: boolean; /** Allow OpenSSH host-key updates. Default: true. */
  updateHostKeys?: boolean; /** Existing private key path on the host. */
  identityFile?: string; /** Existing SSH certificate path on the host. */
  certificateFile?: string; /** Existing known_hosts file path on the host. */
  knownHostsFile?: string; /** Inline or SecretRef-backed private key contents. */
  identityData?: SecretInput; /** Inline or SecretRef-backed SSH certificate contents. */
  certificateData?: SecretInput; /** Inline or SecretRef-backed known_hosts contents. */
  knownHostsData?: SecretInput;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.agents-shared.d.ts
type AgentModelConfig = string | {
  /** Primary model (provider/model). */primary?: string; /** Per-agent model fallbacks (provider/model). */
  fallbacks?: string[];
};
type AgentToolModelConfig = string | {
  /** Primary model (provider/model). */primary?: string; /** Per-tool model fallbacks (provider/model). */
  fallbacks?: string[]; /** Optional provider request timeout in milliseconds for capabilities that support it. */
  timeoutMs?: number;
};
type AgentEmbeddedHarnessConfig = {
  /** Agent runtime id. Omitted uses "pi"; "auto" opts into plugin harness auto-selection. */runtime?: string;
};
type AgentRuntimePolicyConfig = {
  /** Agent runtime id. Omitted uses "pi"; "auto" opts into plugin harness auto-selection. */id?: string;
};
type AgentSandboxConfig = {
  mode?: "off" | "non-main" | "all"; /** Sandbox runtime backend id. Default: "docker". */
  backend?: string; /** Agent workspace access inside the sandbox. */
  workspaceAccess?: "none" | "ro" | "rw";
  /**
   * Session tools visibility for sandboxed sessions.
   * - "spawned": only allow session tools to target sessions spawned from this session (default)
   * - "all": allow session tools to target any session
   */
  sessionToolsVisibility?: "spawned" | "all"; /** Container/workspace scope for sandbox isolation. */
  scope?: "session" | "agent" | "shared";
  workspaceRoot?: string; /** Docker-specific sandbox settings. */
  docker?: SandboxDockerSettings; /** SSH-specific sandbox settings. */
  ssh?: SandboxSshSettings; /** Optional sandboxed browser settings. */
  browser?: SandboxBrowserSettings; /** Auto-prune sandbox settings. */
  prune?: SandboxPruneSettings;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.base.d.ts
type TypingMode = "never" | "instant" | "thinking" | "message";
type SessionScope = "per-sender" | "global";
type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
type ReplyToMode = "off" | "first" | "all" | "batched";
type GroupPolicy = "open" | "disabled" | "allowlist";
type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
type ContextVisibilityMode = "all" | "allowlist" | "allowlist_quote";
type TextChunkMode = "length" | "newline";
type StreamingMode = "off" | "partial" | "block" | "progress";
type ChannelStreamingCommandTextMode = "raw" | "status";
type OutboundRetryConfig = {
  /** Max retry attempts for outbound requests (default: 3). */attempts?: number; /** Minimum retry delay in ms (default: 300-500ms depending on provider). */
  minDelayMs?: number; /** Maximum retry delay cap in ms (default: 30000). */
  maxDelayMs?: number; /** Jitter factor (0-1) applied to delays (default: 0.1). */
  jitter?: number;
};
type BlockStreamingCoalesceConfig = {
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
};
type BlockStreamingChunkConfig = {
  minChars?: number;
  maxChars?: number;
  breakPreference?: "paragraph" | "newline" | "sentence";
};
type ChannelStreamingProgressConfig = {
  /** Initial progress title. "auto" picks from labels; false hides the title. Default: "auto". */label?: string | false; /** Candidate labels for label="auto". Defaults to OpenClaw's built-in progress labels. */
  labels?: string[]; /** Maximum number of progress lines to keep below the label. Default: 8. */
  maxLines?: number; /** Maximum characters per compact progress line before truncation. Default: 120. */
  maxLineChars?: number; /** Progress draft renderer. "text" is the portable fallback; "rich" lets supported channels use structured UI. */
  render?: "text" | "rich"; /** Include compact tool/task progress in the draft. Default: true. */
  toolProgress?: boolean; /** Command/exec progress detail in the draft. "raw" preserves released behavior; "status" shows only the tool label. Default: "raw". */
  commandText?: ChannelStreamingCommandTextMode;
};
type ChannelStreamingPreviewConfig = {
  /** Chunking thresholds for preview-draft updates while streaming. */chunk?: BlockStreamingChunkConfig;
  /**
   * Render live tool/activity updates into the preview draft for channels that
   * edit a single preview message in place.
   * Default: true.
   */
  toolProgress?: boolean; /** Command/exec progress detail in the preview. "raw" preserves released behavior; "status" shows only the tool label. Default: "raw". */
  commandText?: ChannelStreamingCommandTextMode;
};
type ChannelStreamingBlockConfig = {
  /** Enable chunked block-reply delivery for channels that support it. */enabled?: boolean; /** Merge streamed block replies before sending. */
  coalesce?: BlockStreamingCoalesceConfig;
};
type ChannelStreamingConfig = {
  /**
   * Preview streaming mode:
   * - "off": disable preview updates
   * - "partial": update one preview in place
   * - "block": emit larger chunked preview updates
   * - "progress": progress/status preview mode for channels that support it
   */
  mode?: StreamingMode; /** Chunking mode for outbound text delivery. */
  chunkMode?: TextChunkMode;
  /**
   * Channel-specific native transport streaming toggle.
   * Used today by Slack's native stream API.
   */
  nativeTransport?: boolean;
  preview?: ChannelStreamingPreviewConfig;
  progress?: ChannelStreamingProgressConfig;
  block?: ChannelStreamingBlockConfig;
};
type ChannelPreviewStreamingConfig = Pick<ChannelStreamingConfig, "mode" | "chunkMode" | "preview" | "progress" | "block">;
type SlackChannelStreamingConfig = Pick<ChannelStreamingConfig, "mode" | "chunkMode" | "preview" | "progress" | "block" | "nativeTransport">;
type MarkdownTableMode = "off" | "bullets" | "code" | "block";
type MarkdownConfig = {
  /** Table rendering mode (off|bullets|code|block). */tables?: MarkdownTableMode;
};
type HumanDelayConfig = {
  /** Delay style for block replies (off|natural|custom). */mode?: "off" | "natural" | "custom"; /** Minimum delay in milliseconds (default: 800). */
  minMs?: number; /** Maximum delay in milliseconds (default: 2500). */
  maxMs?: number;
};
type SessionSendPolicyAction = "allow" | "deny";
type SessionSendPolicyMatch = {
  channel?: string;
  chatType?: ChatType;
  /**
   * Session key prefix match.
   * Note: some consumers match against a normalized key (for example, stripping `agent:<id>:`).
   */
  keyPrefix?: string; /** Optional raw session-key prefix match for consumers that normalize session keys. */
  rawKeyPrefix?: string;
};
type SessionSendPolicyRule = {
  action: SessionSendPolicyAction;
  match?: SessionSendPolicyMatch;
};
type SessionSendPolicyConfig = {
  default?: SessionSendPolicyAction;
  rules?: SessionSendPolicyRule[];
};
type SessionResetMode = "daily" | "idle";
type SessionResetConfig = {
  mode?: SessionResetMode; /** Local hour (0-23) for the daily reset boundary. */
  atHour?: number; /** Sliding idle window (minutes). When set with daily mode, whichever expires first wins. */
  idleMinutes?: number;
};
type SessionResetByTypeConfig = {
  direct?: SessionResetConfig; /** @deprecated Use `direct` instead. Kept for backward compatibility. */
  dm?: SessionResetConfig;
  group?: SessionResetConfig;
  thread?: SessionResetConfig;
};
type SessionThreadBindingsConfig = {
  /**
   * Master switch for thread-bound session routing features.
   * Channel/provider keys can override this default.
   */
  enabled?: boolean;
  /**
   * Inactivity window for thread-bound sessions (hours).
   * Session auto-unfocuses after this amount of idle time. Set to 0 to disable. Default: 24.
   */
  idleHours?: number;
  /**
   * Optional hard max age for thread-bound sessions (hours).
   * Session auto-unfocuses once this age is reached even if active. Set to 0 to disable. Default: 0.
   */
  maxAgeHours?: number;
  /**
   * Allow channel integrations to create thread-bound work sessions from
   * sessions_spawn or native ACP spawn flows. Channel/account keys can override.
   * Default: true when thread bindings are enabled.
   */
  spawnSessions?: boolean;
  /**
   * Default context mode for native subagents spawned into a bound thread.
   * Default: "fork" so the child starts from the requester transcript.
   */
  defaultSpawnContext?: "isolated" | "fork";
};
type SessionConfig = {
  scope?: SessionScope; /** DM session scoping (default: "main"). */
  dmScope?: DmScope; /** Map platform-prefixed identities (e.g. "telegram:123") to canonical DM peers. */
  identityLinks?: Record<string, string[]>;
  resetTriggers?: string[];
  idleMinutes?: number;
  reset?: SessionResetConfig;
  resetByType?: SessionResetByTypeConfig; /** Channel-specific reset overrides (e.g. { discord: { mode: "idle", idleMinutes: 10080 } }). */
  resetByChannel?: Record<string, SessionResetConfig>;
  store?: string;
  typingIntervalSeconds?: number;
  typingMode?: TypingMode;
  mainKey?: string;
  sendPolicy?: SessionSendPolicyConfig; /** Session transcript write-lock acquisition policy. */
  writeLock?: SessionWriteLockConfig;
  agentToAgent?: {
    /** Max ping-pong turns between requester/target (0-20). Default: 5. */maxPingPongTurns?: number;
  }; /** Shared defaults for thread-bound session routing across channels/providers. */
  threadBindings?: SessionThreadBindingsConfig; /** Automatic session store maintenance (pruning, capping, archive retention, disk budget). */
  maintenance?: SessionMaintenanceConfig;
};
type SessionWriteLockConfig = {
  /** How long to wait while acquiring a session transcript write lock. Default: 60000. */acquireTimeoutMs?: number; /** When an existing lock can be treated as stale and reclaimed. Default: 1800000. */
  staleMs?: number; /** Maximum in-process hold time before the watchdog releases the lock. Default: 300000. */
  maxHoldMs?: number;
};
type SessionMaintenanceMode = "enforce" | "warn";
type SessionMaintenanceConfig = {
  /** Whether to enforce maintenance or warn only. Default: "warn". */mode?: SessionMaintenanceMode; /** Remove session entries older than this duration (e.g. "30d", "12h"). Default: "30d". */
  pruneAfter?: string | number; /** @deprecated Use pruneAfter instead. */
  pruneDays?: number; /** Maximum number of session entries to keep. Default: 500. */
  maxEntries?: number; /** @deprecated Ignored. Run `openclaw doctor --fix` to remove. */
  rotateBytes?: number | string;
  /**
   * Retention for archived reset transcripts (`*.reset.<timestamp>`).
   * Set `false` to disable reset-archive cleanup. Default: same as `pruneAfter` (30d).
   */
  resetArchiveRetention?: string | number | false;
  /**
   * Optional per-agent sessions-directory disk budget (e.g. "500mb").
   * When exceeded, warn (mode=warn) or enforce oldest-first cleanup (mode=enforce).
   */
  maxDiskBytes?: number | string;
  /**
   * Target size after disk-budget cleanup (high-water mark), e.g. "400mb".
   * Default: 80% of maxDiskBytes.
   */
  highWaterBytes?: number | string;
};
type LoggingConfig = {
  level?: "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  file?: string; /** Maximum size of a single log file in bytes before rotation. Default: 100 MB. */
  maxFileBytes?: number;
  consoleLevel?: "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  consoleStyle?: "pretty" | "compact" | "json"; /** Redact sensitive tokens in log sinks and persisted transcript text. Default: "tools". Safety-boundary UI/tool/diagnostic payloads may still redact when this is "off". */
  redactSensitive?: "off" | "tools"; /** Regex patterns used to redact sensitive tokens from logs and transcripts. */
  redactPatterns?: string[];
};
type DiagnosticsOtelConfig = {
  enabled?: boolean;
  endpoint?: string;
  tracesEndpoint?: string;
  metricsEndpoint?: string;
  logsEndpoint?: string;
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;
  serviceName?: string;
  traces?: boolean;
  metrics?: boolean;
  logs?: boolean; /** Trace sample rate (0.0 - 1.0). */
  sampleRate?: number; /** Metric export interval (ms). */
  flushIntervalMs?: number;
  /**
   * Opt-in raw content capture for OTEL span attributes.
   * Boolean `true` captures non-system message/tool content; the object form
   * can enable each content class explicitly.
   */
  captureContent?: boolean | {
    enabled?: boolean;
    inputMessages?: boolean;
    outputMessages?: boolean;
    toolInputs?: boolean;
    toolOutputs?: boolean;
    systemPrompt?: boolean;
  };
};
type DiagnosticsCacheTraceConfig = {
  enabled?: boolean;
  filePath?: string;
  includeMessages?: boolean;
  includePrompt?: boolean;
  includeSystem?: boolean;
};
type DiagnosticsConfig = {
  enabled?: boolean; /** Optional ad-hoc diagnostics flags (e.g. "telegram.http"). */
  flags?: string[]; /** Threshold in ms before a processing session with no observed progress logs diagnostics. */
  stuckSessionWarnMs?: number; /** Threshold in ms before eligible stalled active work may be aborted for recovery. */
  stuckSessionAbortMs?: number; /** Capture a redacted stability snapshot when memory pressure reaches critical. Default: false. */
  memoryPressureSnapshot?: boolean;
  otel?: DiagnosticsOtelConfig;
  cacheTrace?: DiagnosticsCacheTraceConfig;
};
type WebReconnectConfig = {
  initialMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number;
  maxAttempts?: number;
};
type WebWhatsAppConfig = {
  /** Baileys application ping interval in milliseconds. Default: 25000. */keepAliveIntervalMs?: number; /** WebSocket opening handshake timeout in milliseconds. Default: 60000. */
  connectTimeoutMs?: number; /** Baileys query timeout in milliseconds. Default: 60000. */
  defaultQueryTimeoutMs?: number;
};
type WebConfig = {
  /** If false, do not start the WhatsApp web provider. Default: true. */enabled?: boolean;
  heartbeatSeconds?: number;
  reconnect?: WebReconnectConfig;
  whatsapp?: WebWhatsAppConfig;
};
type AgentElevatedAllowFromConfig = Partial<Record<string, Array<string | number>>>;
type IdentityConfig = {
  name?: string;
  theme?: string;
  emoji?: string; /** Avatar image: workspace-relative path, http(s) URL, or data URI. */
  avatar?: string;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/infra/exec-safe-bin-policy-profiles.d.ts
type SafeBinProfileFixture = {
  minPositional?: number;
  maxPositional?: number;
  allowedValueFlags?: readonly string[];
  deniedFlags?: readonly string[];
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.memory.d.ts
type MemoryBackend = "builtin" | "qmd";
type MemoryCitationsMode = "auto" | "on" | "off";
type MemoryQmdSearchMode = "query" | "search" | "vsearch";
type MemoryQmdStartupMode = "off" | "idle" | "immediate";
type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  qmd?: MemoryQmdConfig;
};
type MemoryQmdConfig = {
  command?: string;
  mcporter?: MemoryQmdMcporterConfig;
  searchMode?: MemoryQmdSearchMode;
  searchTool?: string;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};
type MemoryQmdMcporterConfig = {
  /**
   * Route QMD searches through mcporter (MCP runtime) instead of spawning `qmd` per query.
   * Requires:
   * - `mcporter` installed and on PATH
   * - A configured mcporter server that runs `qmd mcp` with `lifecycle: keep-alive`
   */
  enabled?: boolean; /** mcporter server name (defaults to "qmd") */
  serverName?: string; /** Start the mcporter daemon automatically (defaults to true when enabled). */
  startDaemon?: boolean;
};
type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};
type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};
type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  startup?: MemoryQmdStartupMode;
  startupDelayMs?: number;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};
type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.provider-request.d.ts
type ConfiguredProviderRequestAuth = {
  mode: "provider-default";
} | {
  mode: "authorization-bearer";
  token: SecretInput;
} | {
  mode: "header";
  headerName: string;
  value: SecretInput;
  prefix?: string;
};
type ConfiguredProviderRequestTls = {
  ca?: SecretInput;
  cert?: SecretInput;
  key?: SecretInput;
  passphrase?: SecretInput;
  serverName?: string;
  insecureSkipVerify?: boolean;
};
type ConfiguredProviderRequestProxy = {
  mode: "env-proxy";
  tls?: ConfiguredProviderRequestTls;
} | {
  mode: "explicit-proxy";
  url: string;
  tls?: ConfiguredProviderRequestTls;
};
type ConfiguredProviderRequest = {
  headers?: Record<string, SecretInput>;
  auth?: ConfiguredProviderRequestAuth;
  proxy?: ConfiguredProviderRequestProxy;
  tls?: ConfiguredProviderRequestTls;
};
type ConfiguredModelProviderRequest = ConfiguredProviderRequest & {
  allowPrivateNetwork?: boolean;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.tools.d.ts
type MediaUnderstandingScopeMatch = {
  channel?: string;
  chatType?: ChatType;
  keyPrefix?: string;
};
type MediaUnderstandingScopeRule = {
  action: SessionSendPolicyAction;
  match?: MediaUnderstandingScopeMatch;
};
type MediaUnderstandingScopeConfig = {
  default?: SessionSendPolicyAction;
  rules?: MediaUnderstandingScopeRule[];
};
type MediaUnderstandingCapability = "image" | "audio" | "video";
type MediaUnderstandingAttachmentsConfig = {
  /** Select the first matching attachment or process multiple. */mode?: "first" | "all"; /** Max number of attachments to process (default: 1). */
  maxAttachments?: number; /** Attachment ordering preference. */
  prefer?: "first" | "last" | "path" | "url";
};
type MediaProviderRequestConfig = {
  /** Optional provider-specific query params (merged into requests). */providerOptions?: Record<string, Record<string, string | number | boolean>>; /** @deprecated Use providerOptions.deepgram instead. */
  deepgram?: {
    detectLanguage?: boolean;
    punctuate?: boolean;
    smartFormat?: boolean;
  }; /** Optional base URL override for provider requests. */
  baseUrl?: string; /** Optional headers merged into provider requests. */
  headers?: Record<string, string>; /** Optional request transport overrides for provider HTTP calls. */
  request?: ConfiguredProviderRequest;
};
type MediaUnderstandingModelConfig = MediaProviderRequestConfig & {
  /** provider API id (e.g. openai, google). */provider?: string; /** Model id for provider-based understanding. */
  model?: string; /** Optional capability tags for shared model lists. */
  capabilities?: MediaUnderstandingCapability[]; /** Use a CLI command instead of provider API. */
  type?: "provider" | "cli"; /** CLI binary (required when type=cli). */
  command?: string; /** CLI args (template-enabled). */
  args?: string[]; /** Optional prompt override for this model entry. */
  prompt?: string; /** Optional max output characters for this model entry. */
  maxChars?: number; /** Optional max bytes for this model entry. */
  maxBytes?: number; /** Optional timeout override (seconds) for this model entry. */
  timeoutSeconds?: number; /** Optional language hint for audio transcription. */
  language?: string; /** Auth profile id to use for this provider. */
  profile?: string; /** Preferred profile id if multiple are available. */
  preferredProfile?: string;
};
type MediaUnderstandingConfig = MediaProviderRequestConfig & {
  /** Enable media understanding when models are configured. */enabled?: boolean; /** Optional scope gating for understanding. */
  scope?: MediaUnderstandingScopeConfig; /** Default max bytes to send. */
  maxBytes?: number; /** Default max output characters. */
  maxChars?: number; /** Default prompt. */
  prompt?: string; /** Internal request-scoped prompt override injected by CLI/runtime wrappers. */
  _requestPromptOverride?: string; /** Default timeout (seconds). */
  timeoutSeconds?: number; /** Default language hint (audio). */
  language?: string; /** Internal request-scoped language override injected by CLI/runtime wrappers. */
  _requestLanguageOverride?: string; /** Attachment selection policy. */
  attachments?: MediaUnderstandingAttachmentsConfig; /** Ordered model list (fallbacks in order). */
  models?: MediaUnderstandingModelConfig[];
  /**
   * Echo the audio transcript back to the originating chat before agent processing.
   * Lets users verify what was heard. Default: false.
   */
  echoTranscript?: boolean;
  /**
   * Format string for the echoed transcript. Use `{transcript}` as placeholder.
   * Default: '📝 "{transcript}"'
   */
  echoFormat?: string;
};
type LinkModelConfig = {
  /** Use a CLI command for link processing. */type?: "cli"; /** CLI binary (required when type=cli). */
  command: string; /** CLI args (template-enabled). */
  args?: string[]; /** Optional timeout override (seconds) for this model entry. */
  timeoutSeconds?: number;
};
type LinkToolsConfig = {
  /** Enable link understanding when models are configured. */enabled?: boolean; /** Optional scope gating for understanding. */
  scope?: MediaUnderstandingScopeConfig; /** Max number of links to process per message. */
  maxLinks?: number; /** Default timeout (seconds). */
  timeoutSeconds?: number; /** Ordered model list (fallbacks in order). */
  models?: LinkModelConfig[];
};
type MediaToolsConfig = {
  /** Shared model list applied across image/audio/video. */models?: MediaUnderstandingModelConfig[]; /** Max concurrent media understanding runs. */
  concurrency?: number;
  asyncCompletion?: {
    /**
     * Deprecated compatibility flag. Async media generation completions stay
     * requester-session mediated so source delivery policy remains agent-owned.
     */
    directSend?: boolean;
  };
  image?: MediaUnderstandingConfig;
  audio?: MediaUnderstandingConfig;
  video?: MediaUnderstandingConfig;
};
type ToolProfileId = "minimal" | "coding" | "messaging" | "full";
type ToolLoopDetectionDetectorConfig = {
  /** Enable warning/blocking for repeated identical calls to the same tool/params. */genericRepeat?: boolean; /** Enable warning/blocking for known no-progress polling loops. */
  knownPollNoProgress?: boolean; /** Enable warning/blocking for no-progress ping-pong alternating patterns. */
  pingPong?: boolean;
};
type ToolLoopPostCompactionGuardConfig = {
  /** How many attempts post-compaction the guard remains armed (default: 3). */windowSize?: number;
};
type ToolLoopDetectionConfig = {
  /** Enable tool-loop protection (default: false). */enabled?: boolean; /** Maximum tool call history entries retained for loop detection (default: 30). */
  historySize?: number; /** Warning threshold before a warning-only loop classification (default: 10). */
  warningThreshold?: number; /** Block repeated calls to the same unavailable tool after this many misses (default: 10). */
  unknownToolThreshold?: number; /** Critical threshold for blocking repetitive loops (default: 20). */
  criticalThreshold?: number; /** Global no-progress breaker threshold (default: 30). */
  globalCircuitBreakerThreshold?: number; /** Detector toggles. */
  detectors?: ToolLoopDetectionDetectorConfig; /** Post-compaction loop guard: aborts when the agent repeats the same (tool, args, result) immediately after auto-compaction-retry. */
  postCompactionGuard?: ToolLoopPostCompactionGuardConfig;
};
type ToolSearchConfig = boolean | {
  /** Enable compact search/call cataloging for large tool sets. */enabled?: boolean; /** Exposed model surface. "code" exposes tool_search_code; "tools" exposes structured fallback tools. */
  mode?: "code" | "tools"; /** Timeout in milliseconds for one tool_search_code execution. Runtime clamps to 1s..60s. */
  codeTimeoutMs?: number; /** Default search result count when the model omits a limit. Runtime clamps to maxSearchLimit. */
  searchDefaultLimit?: number; /** Maximum search result count. Runtime clamps to 1..50. */
  maxSearchLimit?: number;
};
type CodeModeConfig = boolean | {
  /** Enable generic OpenClaw code mode. Default: false. */enabled?: boolean; /** Guest runtime. Only quickjs-wasi is supported. */
  runtime?: "quickjs-wasi"; /** Model-facing mode. Only "only" is supported: expose exec/wait and hide normal tools. */
  mode?: "only"; /** Accepted source languages. */
  languages?: Array<"javascript" | "typescript">; /** Wall-clock limit in milliseconds for one exec or wait call. */
  timeoutMs?: number; /** QuickJS heap limit in bytes. */
  memoryLimitBytes?: number; /** Maximum serialized output bytes. */
  maxOutputBytes?: number; /** Maximum serialized snapshot bytes. */
  maxSnapshotBytes?: number; /** Maximum concurrent nested tool calls. */
  maxPendingToolCalls?: number; /** Retention for suspended snapshots. */
  snapshotTtlSeconds?: number; /** Default search result count for tools.search. */
  searchDefaultLimit?: number; /** Maximum search result count for tools.search. */
  maxSearchLimit?: number;
};
type SessionsToolsVisibility = "self" | "tree" | "agent" | "all";
type ToolPolicyConfig = {
  allow?: string[];
  /**
   * Additional allowlist entries merged into the effective allowlist.
   *
   * Intended for additive configuration (e.g., "also allow lobster") without forcing
   * users to replace/duplicate an existing allowlist or profile.
   */
  alsoAllow?: string[];
  deny?: string[];
  profile?: ToolProfileId;
};
type GroupToolPolicyConfig = {
  allow?: string[]; /** Additional allowlist entries merged into allow. */
  alsoAllow?: string[];
  deny?: string[];
};
/**
 * Per-sender overrides.
 *
 * Prefer explicit key prefixes:
 * - channel:<channelId>:<senderId>
 * - id:<senderId>
 * - e164:<phone>
 * - username:<handle>
 * - name:<display-name>
 * - * (wildcard)
 *
 * Legacy unprefixed keys are supported for backward compatibility and are matched as senderId only.
 */
type GroupToolPolicyBySenderConfig = Record<string, GroupToolPolicyConfig>;
type ExecToolConfig = {
  /** Exec host routing (default: auto). */host?: "auto" | "sandbox" | "gateway" | "node"; /** Exec security mode (default: deny). */
  security?: "deny" | "allowlist" | "full"; /** Exec ask mode (default: on-miss). */
  ask?: "off" | "on-miss" | "always"; /** Default node binding for exec.host=node (node id/name). */
  node?: string; /** Directories to prepend to PATH when running exec (gateway/sandbox). */
  pathPrepend?: string[]; /** Safe stdin-only binaries that can run without allowlist entries. */
  safeBins?: string[];
  /**
   * Require explicit approval for interpreter inline-eval forms (`python -c`, `node -e`, etc.).
   * Prevents silent allowlist reuse and allow-always persistence for those forms.
   */
  strictInlineEval?: boolean; /** Render parser-derived command highlights in exec approval prompts (default: false). */
  commandHighlighting?: boolean; /** Extra explicit directories trusted for safeBins path checks (never derived from PATH). */
  safeBinTrustedDirs?: string[]; /** Optional custom safe-bin profiles for entries in tools.exec.safeBins. */
  safeBinProfiles?: Record<string, SafeBinProfileFixture>; /** Default time (ms) before an exec command auto-backgrounds. */
  backgroundMs?: number; /** Default timeout (seconds) before auto-killing exec commands. */
  timeoutSec?: number; /** Emit a running notice (ms) when approval-backed exec runs long (default: 10000, 0 = off). */
  approvalRunningNoticeMs?: number; /** How long to keep finished sessions in memory (ms). */
  cleanupMs?: number; /** Emit a system event and heartbeat when a backgrounded exec exits. */
  notifyOnExit?: boolean;
  /**
   * Also emit success exit notifications when a backgrounded exec has no output.
   * Default false to reduce context noise.
   */
  notifyOnExitEmptySuccess?: boolean; /** apply_patch subtool configuration. */
  applyPatch?: {
    /** Enable apply_patch for OpenAI models (default: true; set false to disable). */enabled?: boolean;
    /**
     * Restrict apply_patch paths to the workspace directory.
     * Default: true (safer; does not affect read/write/edit).
     */
    workspaceOnly?: boolean;
    /**
     * Optional allowlist of model ids that can use apply_patch.
     * Accepts either raw ids (e.g. "gpt-5.4") or full ids (e.g. "openai/gpt-5.4").
     */
    allowModels?: string[];
  };
};
type FsToolsConfig = {
  /**
   * Restrict filesystem tools (read/write/edit/apply_patch) to the agent workspace directory.
   * Default: false (unrestricted, matches legacy behavior).
   */
  workspaceOnly?: boolean;
};
type AgentToolsConfig = {
  /** Base tool profile applied before allow/deny lists. */profile?: ToolProfileId;
  allow?: string[]; /** Additional allowlist entries merged into allow and/or profile allowlist. */
  alsoAllow?: string[];
  deny?: string[]; /** Optional tool policy overrides keyed by provider id or "provider/model". */
  byProvider?: Record<string, ToolPolicyConfig>; /** Per-sender tool policy overrides keyed by sender identity. */
  toolsBySender?: GroupToolPolicyBySenderConfig; /** Per-agent code mode override; merges over the top-level tools.codeMode config. */
  codeMode?: CodeModeConfig; /** Per-agent elevated exec gate (can only further restrict global tools.elevated). */
  elevated?: {
    /** Enable or disable elevated mode for this agent (default: true). */enabled?: boolean; /** Approved senders for /elevated (per-provider allowlists). */
    allowFrom?: AgentElevatedAllowFromConfig;
  }; /** Exec tool defaults for this agent. */
  exec?: ExecToolConfig; /** Filesystem tool path guards. */
  fs?: FsToolsConfig; /** Runtime loop detection for repetitive/ stuck tool-call patterns. */
  loopDetection?: ToolLoopDetectionConfig; /** Message tool configuration for this agent. */
  message?: MessageToolsConfig;
  sandbox?: {
    tools?: {
      allow?: string[]; /** Additional allowlist entries merged into allow and/or the sandbox default allowlist. */
      alsoAllow?: string[];
      deny?: string[];
    };
  };
};
type MemorySearchConfig = {
  /** Enable vector memory search (default: true). */enabled?: boolean; /** Sources to index and search (default: ["memory"]). */
  sources?: Array<"memory" | "sessions">; /** Extra paths to include in memory search (directories or .md files). */
  extraPaths?: string[]; /** Optional QMD-specific extra collections for cross-agent search. */
  qmd?: {
    /** Additional QMD collections appended for this agent's search scope. */extraCollections?: MemoryQmdIndexPath[];
  }; /** Optional multimodal file indexing for selected extra paths. */
  multimodal?: {
    /** Enable image/audio embeddings from extraPaths. */enabled?: boolean; /** Which non-text file types to index. */
    modalities?: Array<"image" | "audio" | "all">; /** Max bytes allowed per multimodal file before it is skipped. */
    maxFileBytes?: number;
  }; /** Experimental memory search settings. */
  experimental?: {
    /** Enable session transcript indexing (experimental, default: false). */sessionMemory?: boolean;
  }; /** Memory embedding provider adapter id. */
  provider?: string;
  remote?: {
    baseUrl?: string;
    apiKey?: SecretInput;
    headers?: Record<string, string>; /** Max concurrent non-batch embedding tasks during indexing. Useful for slower local providers such as Ollama. */
    nonBatchConcurrency?: number;
    batch?: {
      /** Enable batch API for embedding indexing (OpenAI/Gemini; default: true). */enabled?: boolean; /** Wait for batch completion (default: true). */
      wait?: boolean; /** Max concurrent batch jobs (default: 2). */
      concurrency?: number; /** Poll interval in ms (default: 5000). */
      pollIntervalMs?: number; /** Timeout in minutes (default: 60). */
      timeoutMinutes?: number;
    };
  }; /** Fallback memory embedding provider adapter id when embeddings fail. */
  fallback?: string; /** Embedding model id (remote) or alias (local). */
  model?: string; /** Optional provider-specific embedding input_type for query and document requests. */
  inputType?: string; /** Optional provider-specific embedding input_type for query-time memory search. */
  queryInputType?: string; /** Optional provider-specific embedding input_type for document/index embeddings. */
  documentInputType?: string;
  /**
   * Gemini embedding-2 models only: output vector dimensions.
   * Supported values today are 768, 1536, and 3072.
   */
  outputDimensionality?: number; /** Local embedding settings (node-llama-cpp). */
  local?: {
    /** GGUF model path or hf: URI. */modelPath?: string; /** Optional cache directory for local models. */
    modelCacheDir?: string;
    /**
     * Context window size for the local embedding context (default: 4096).
     * Use `"auto"` to defer to node-llama-cpp, which picks up to the model's
     * trained maximum — not recommended for 8B+ models.
     */
    contextSize?: number | "auto";
  }; /** Index storage configuration. */
  store?: {
    driver?: "sqlite";
    path?: string;
    fts?: {
      /** FTS5 tokenizer (default: "unicode61"). Use "trigram" for CJK text support. */tokenizer?: "unicode61" | "trigram";
    };
    vector?: {
      /** Enable sqlite-vec extension for vector search (default: true). */enabled?: boolean; /** Optional override path to sqlite-vec extension (.dylib/.so/.dll). */
      extensionPath?: string;
    };
    cache?: {
      /** Enable embedding cache (default: true). */enabled?: boolean; /** Optional max cache entries per provider/model. */
      maxEntries?: number;
    };
  }; /** Chunking configuration. */
  chunking?: {
    tokens?: number;
    overlap?: number;
  }; /** Sync behavior. */
  sync?: {
    onSessionStart?: boolean;
    onSearch?: boolean;
    watch?: boolean;
    watchDebounceMs?: number;
    intervalMinutes?: number;
    /**
     * Timeout in seconds for inline embedding batches during memory indexing.
     * Unset uses provider defaults: 600s for local/self-hosted providers, 120s for hosted providers.
     */
    embeddingBatchTimeoutSeconds?: number;
    sessions?: {
      /** Minimum appended bytes before session transcripts are reindexed. */deltaBytes?: number; /** Minimum appended JSONL lines before session transcripts are reindexed. */
      deltaMessages?: number; /** Force session reindex after compaction-triggered transcript updates (default: true). */
      postCompactionForce?: boolean;
    };
  }; /** Query behavior. */
  query?: {
    maxResults?: number;
    minScore?: number;
    hybrid?: {
      /** Enable hybrid BM25 + vector search (default: true). */enabled?: boolean; /** Weight for vector similarity when merging results (0-1). */
      vectorWeight?: number; /** Weight for BM25 text relevance when merging results (0-1). */
      textWeight?: number; /** Multiplier for candidate pool size (default: 4). */
      candidateMultiplier?: number; /** Optional MMR re-ranking for result diversity. */
      mmr?: {
        /** Enable MMR re-ranking (default: false). */enabled?: boolean; /** Lambda: 0 = max diversity, 1 = max relevance (default: 0.7). */
        lambda?: number;
      }; /** Optional temporal decay to boost recency in hybrid scoring. */
      temporalDecay?: {
        /** Enable temporal decay (default: false). */enabled?: boolean; /** Half-life in days for exponential decay (default: 30). */
        halfLifeDays?: number;
      };
    };
  }; /** Index cache behavior. */
  cache?: {
    /** Cache chunk embeddings in SQLite (default: true). */enabled?: boolean; /** Optional cap on cached embeddings (best-effort). */
    maxEntries?: number;
  };
};
type ToolsConfig = {
  /** Base tool profile applied before allow/deny lists. */profile?: ToolProfileId;
  allow?: string[]; /** Additional allowlist entries merged into allow and/or profile allowlist. */
  alsoAllow?: string[];
  deny?: string[]; /** Optional tool policy overrides keyed by provider id or "provider/model". */
  byProvider?: Record<string, ToolPolicyConfig>; /** Per-sender tool policy overrides keyed by sender identity. */
  toolsBySender?: GroupToolPolicyBySenderConfig;
  web?: {
    search?: {
      /** Enable managed web_search and optional Codex-native web search. */enabled?: boolean; /** Search provider id. */
      provider?: string; /** Shared API key slot used by providers that do not need nested config. */
      apiKey?: SecretInput; /** Default search results count (1-10). */
      maxResults?: number; /** Timeout in seconds for search requests. */
      timeoutSeconds?: number; /** Cache TTL in minutes for search results. */
      cacheTtlMinutes?: number; /** Optional native Codex web search for Codex-capable models. */
      openaiCodex?: {
        /** Enable native Codex web search for eligible models. */enabled?: boolean; /** Use cached or live external web access. Default: "cached". */
        mode?: "cached" | "live"; /** Optional allowlist of domains passed to the native Codex tool. */
        allowedDomains?: string[]; /** Optional Codex native search context size hint. */
        contextSize?: "low" | "medium" | "high"; /** Optional approximate user location passed to the native Codex tool. */
        userLocation?: {
          country?: string;
          region?: string;
          city?: string;
          timezone?: string;
        };
      };
    } & Record<string, unknown>; /** X (formerly Twitter) search tool configuration using xAI Grok. */
    x_search?: {
      /** Enable X search tool (default: true when xAI auth is available via plugin config or XAI_API_KEY). */enabled?: boolean; /** Model id to use for X search. */
      model?: string; /** Keep inline citations in the xAI response payload when available. */
      inlineCitations?: boolean; /** Optional max search/tool turns for xAI to use internally. */
      maxTurns?: number; /** Timeout in seconds for X search requests. */
      timeoutSeconds?: number; /** Cache TTL in minutes for X search results. */
      cacheTtlMinutes?: number;
    };
    fetch?: {
      /** Enable web fetch tool (default: true). */enabled?: boolean; /** Web fetch fallback provider id. */
      provider?: string; /** Max characters to return from fetched content. */
      maxChars?: number; /** Hard cap for maxChars (tool or config), defaults to 50000. */
      maxCharsCap?: number; /** Max download size before truncation, defaults to 2000000. */
      maxResponseBytes?: number; /** Timeout in seconds for fetch requests. */
      timeoutSeconds?: number; /** Cache TTL in minutes for fetched content. */
      cacheTtlMinutes?: number; /** Maximum number of redirects to follow (default: 3). */
      maxRedirects?: number; /** Override User-Agent header for fetch requests. */
      userAgent?: string; /** Use Readability to extract main content (default: true). */
      readability?: boolean; /** Route web_fetch through a trusted HTTP(S) env proxy and let the proxy resolve DNS. Enable only when that proxy enforces outbound policy. */
      useTrustedEnvProxy?: boolean; /** SSRF policy configuration for web_fetch. */
      ssrfPolicy?: {
        /** Allow RFC 2544 benchmark range IPs (198.18.0.0/15) for fake-IP proxy compatibility (e.g., Clash TUN mode, Surge). */allowRfc2544BenchmarkRange?: boolean; /** Allow IPv6 Unique Local Addresses (fc00::/7) for trusted fake-IP proxy compatibility. */
        allowIpv6UniqueLocalRange?: boolean;
      };
    };
  };
  media?: MediaToolsConfig;
  links?: LinkToolsConfig; /** Message tool configuration. */
  message?: MessageToolsConfig;
  agentToAgent?: {
    /** Enable agent-to-agent messaging tools. Default: false. */enabled?: boolean; /** Allowlist of agent ids or patterns (implementation-defined). */
    allow?: string[];
  };
  /**
   * Session tool visibility controls which sessions can be targeted by session tools
   * (sessions_list, sessions_history, sessions_send).
   *
   * Default: "tree" (current session + spawned subagent sessions).
   */
  sessions?: {
    /**
     * - "self": only the current session
     * - "tree": current session + sessions spawned by this session (default)
     * - "agent": any session belonging to the current agent id (can include other users)
     * - "all": any session (cross-agent still requires tools.agentToAgent)
     */
    visibility?: SessionsToolsVisibility;
  }; /** Elevated exec permissions for the host machine. */
  elevated?: {
    /** Enable or disable elevated mode (default: true). */enabled?: boolean; /** Approved senders for /elevated (per-provider allowlists). */
    allowFrom?: AgentElevatedAllowFromConfig;
  }; /** Exec tool defaults. */
  exec?: ExecToolConfig; /** Filesystem tool path guards. */
  fs?: FsToolsConfig; /** Runtime loop detection for repetitive/ stuck tool-call patterns. */
  loopDetection?: ToolLoopDetectionConfig; /** Compact large OpenClaw, MCP, and client tool catalogs behind search/call tools. */
  toolSearch?: ToolSearchConfig; /** Generic code mode: expose exec/wait and hide normal tools behind a QuickJS catalog bridge. */
  codeMode?: CodeModeConfig; /** Sub-agent tool policy defaults (deny wins). */
  subagents?: {
    tools?: {
      allow?: string[]; /** Additional allowlist entries merged into allow and/or default sub-agent denylist. */
      alsoAllow?: string[];
      deny?: string[];
    };
  }; /** Sandbox tool policy defaults (deny wins). */
  sandbox?: {
    tools?: {
      allow?: string[]; /** Additional allowlist entries merged into allow and/or the sandbox default allowlist. */
      alsoAllow?: string[];
      deny?: string[];
    };
  }; /** Experimental tool flags. Default off unless explicitly enabled, except strict-agentic GPT-5 OpenAI/Codex runs may auto-enable `planTool`. */
  experimental?: {
    /** Enable the structured `update_plan` tool explicitly outside strict-agentic execution mode. */planTool?: boolean;
  };
};
type MessageToolsConfig = {
  /**
   * @deprecated Use tools.message.crossContext settings.
   * Allows cross-context sends across providers.
   */
  allowCrossContextSend?: boolean;
  crossContext?: {
    /** Allow sends to other channels within the same provider (default: true). */allowWithinProvider?: boolean; /** Allow sends across different providers (default: false). */
    allowAcrossProviders?: boolean; /** Cross-context marker configuration. */
    marker?: {
      /** Enable origin markers for cross-context sends (default: true). */enabled?: boolean; /** Text prefix template, supports {channel}. */
      prefix?: string; /** Text suffix template, supports {channel}. */
      suffix?: string;
    };
  };
  actions?: {
    /** Message action names exposed and accepted by the message tool. */allow?: string[];
  };
  broadcast?: {
    /** Enable broadcast action (default: true). */enabled?: boolean;
  };
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.agent-defaults.d.ts
type AgentContextInjection = "always" | "continuation-skip" | "never";
type OptionalBootstrapFileName = "SOUL.md" | "USER.md" | "HEARTBEAT.md" | "IDENTITY.md";
type EmbeddedPiExecutionContract = "default" | "strict-agentic";
type SubagentDelegationMode = "suggest" | "prefer";
type Gpt5PromptOverlayConfig = {
  /** Friendly interaction-style layer for GPT-5-family models (default: friendly). */personality?: "friendly" | "on" | "off";
};
type PromptOverlaysConfig = {
  /** Shared GPT-5-family prompt overlay used across providers. */gpt5?: Gpt5PromptOverlayConfig;
};
type AgentModelEntryConfig = {
  alias?: string; /** Provider-specific API parameters (e.g., GLM-4.7 thinking mode). */
  params?: Record<string, unknown>; /** Optional agent execution runtime for this specific provider/model entry. */
  agentRuntime?: AgentRuntimePolicyConfig; /** Enable streaming for this model (default: true, false for Ollama to avoid SDK issue #1205). */
  streaming?: boolean;
};
type AgentContextPruningConfig = {
  mode?: "off" | "cache-ttl"; /** TTL to consider cache expired (duration string, default unit: minutes). */
  ttl?: string;
  keepLastAssistants?: number;
  softTrimRatio?: number;
  hardClearRatio?: number;
  minPrunableToolChars?: number;
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  softTrim?: {
    maxChars?: number;
    headChars?: number;
    tailChars?: number;
  };
  hardClear?: {
    enabled?: boolean;
    placeholder?: string;
  };
};
type AgentStartupContextConfig = {
  /** Enable runtime-owned startup-context prelude on bare session resets (default: true). */enabled?: boolean; /** Which bare reset commands should receive startup context (default: ["new", "reset"]). */
  applyOn?: Array<"new" | "reset">; /** How many dated memory files to load counting backward from today (default: 2). */
  dailyMemoryDays?: number; /** Max bytes to read from each daily memory file before skipping (default: 16384). */
  maxFileBytes?: number; /** Max characters retained from each daily memory file (default: 1200). */
  maxFileChars?: number; /** Max total characters retained across the startup prelude (default: 2800). */
  maxTotalChars?: number;
};
type AgentContextLimitsConfig = {
  /** Default max chars returned by memory_get before truncation metadata/notice (default: 12000). */memoryGetMaxChars?: number; /** Default line window for memory_get when lines is omitted (default: 120). */
  memoryGetDefaultLines?: number; /** Max chars kept for a single live tool result before truncation (default: 16000). */
  toolResultMaxChars?: number; /** Max chars retained from post-compaction AGENTS.md context injection (default: 1800). */
  postCompactionMaxChars?: number;
};
type AgentRunRetriesConfig = {
  /** Base number of run retry iterations (default: 24). */base?: number; /** Additional run retry iterations per fallback profile (default: 8). */
  perProfile?: number; /** Minimum limit for run retry iterations (default: 32). */
  min?: number; /** Maximum limit for run retry iterations (default: 160). */
  max?: number;
};
type CliBackendConfig = {
  /** CLI command to execute (absolute path or on PATH). */command: string; /** Base args applied to every invocation. */
  args?: string[]; /** Output parsing mode (default: json). */
  output?: "json" | "text" | "jsonl"; /** Output parsing mode when resuming a CLI session. */
  resumeOutput?: "json" | "text" | "jsonl"; /** JSONL event dialect for CLIs with provider-specific stream formats. */
  jsonlDialect?: "claude-stream-json"; /** Long-lived CLI process mode. */
  liveSession?: "claude-stdio"; /** Prompt input mode (default: arg). */
  input?: "arg" | "stdin"; /** Max prompt length for arg mode (if exceeded, stdin is used). */
  maxPromptArgChars?: number; /** Extra env vars injected for this CLI. */
  env?: Record<string, string>; /** Env vars to remove before launching this CLI. */
  clearEnv?: string[]; /** Flag used to pass model id (e.g. --model). */
  modelArg?: string; /** Model aliases mapping (config model id → CLI model id). */
  modelAliases?: Record<string, string>; /** Flag used to pass session id (e.g. --session-id). */
  sessionArg?: string; /** Extra args used when resuming a session (use {sessionId} placeholder). */
  sessionArgs?: string[]; /** Alternate args to use when resuming a session (use {sessionId} placeholder). */
  resumeArgs?: string[]; /** When to pass session ids. */
  sessionMode?: "always" | "existing" | "none"; /** JSON fields to read session id from (in order). */
  sessionIdFields?: string[]; /** Flag used to pass system prompt. */
  systemPromptArg?: string; /** Flag used to pass a system prompt file. */
  systemPromptFileArg?: string; /** Config override flag used to pass a system prompt file (e.g. -c). */
  systemPromptFileConfigArg?: string; /** Config override key used to pass a system prompt file. */
  systemPromptFileConfigKey?: string; /** System prompt behavior (append vs replace). */
  systemPromptMode?: "append" | "replace"; /** When to send system prompt. */
  systemPromptWhen?: "first" | "always" | "never"; /** Flag used to pass image paths. */
  imageArg?: string; /** How to pass multiple images. */
  imageMode?: "repeat" | "list"; /** Where staged image files should live before handing them to the CLI. */
  imagePathScope?: "temp" | "workspace"; /** Serialize runs for this CLI. */
  serialize?: boolean; /** Opt in to bounded raw transcript reseed before compaction for safe session resets. */
  reseedFromRawTranscriptWhenUncompacted?: boolean; /** Runtime reliability tuning for this backend's process lifecycle. */
  reliability?: {
    /** Live-session output caps for CLIs that stream JSONL through a long-lived process. */outputLimits?: {
      /** Max raw JSONL characters retained for one live CLI turn. */maxTurnRawChars?: number; /** Max raw JSONL lines retained for one live CLI turn. */
      maxTurnLines?: number;
    }; /** No-output watchdog tuning (fresh vs resumed runs). */
    watchdog?: {
      /** Fresh/new sessions (non-resume). */fresh?: {
        /** Fixed watchdog timeout in ms (overrides ratio when set). */noOutputTimeoutMs?: number; /** Fraction of overall timeout used when fixed timeout is not set. */
        noOutputTimeoutRatio?: number; /** Lower bound for computed watchdog timeout. */
        minMs?: number; /** Upper bound for computed watchdog timeout. */
        maxMs?: number;
      }; /** Resume sessions. */
      resume?: {
        /** Fixed watchdog timeout in ms (overrides ratio when set). */noOutputTimeoutMs?: number; /** Fraction of overall timeout used when fixed timeout is not set. */
        noOutputTimeoutRatio?: number; /** Lower bound for computed watchdog timeout. */
        minMs?: number; /** Upper bound for computed watchdog timeout. */
        maxMs?: number;
      };
    };
  };
};
type AgentDefaultsConfig = {
  /** Global default provider params applied to all models before per-model and per-agent overrides. */params?: Record<string, unknown>; /** Default agent runtime policy. */
  agentRuntime?: AgentRuntimePolicyConfig; /** @deprecated Use agentRuntime. */
  embeddedHarness?: AgentEmbeddedHarnessConfig; /** Primary model and fallbacks (provider/model). Accepts string or {primary,fallbacks}. */
  model?: AgentModelConfig; /** Optional image-capable model and fallbacks (provider/model). Accepts string or {primary,fallbacks}. */
  imageModel?: AgentToolModelConfig; /** Optional image-generation model and fallbacks (provider/model). Accepts string or {primary,fallbacks}. */
  imageGenerationModel?: AgentToolModelConfig; /** Optional video-generation model and fallbacks (provider/model). Accepts string or {primary,fallbacks}. */
  videoGenerationModel?: AgentToolModelConfig; /** Optional music-generation model and fallbacks (provider/model). Accepts string or {primary,fallbacks}. */
  musicGenerationModel?: AgentToolModelConfig;
  /**
   * When true (default), shared image/music/video generation appends other
   * auth-backed provider defaults after explicit primary/fallback refs. Set to
   * false to disable implicit cross-provider fallback while keeping explicit
   * fallbacks.
   */
  mediaGenerationAutoProviderFallback?: boolean; /** Optional PDF-capable model and fallbacks (provider/model). Accepts string or {primary,fallbacks}. */
  pdfModel?: AgentToolModelConfig; /** Maximum PDF file size in megabytes (default: 10). */
  pdfMaxBytesMb?: number; /** Maximum number of PDF pages to process (default: 20). */
  pdfMaxPages?: number; /** Model catalog with optional aliases (full provider/model keys). */
  models?: Record<string, AgentModelEntryConfig>; /** Agent working directory (preferred). Used as the default cwd for agent runs. */
  workspace?: string; /** Optional default allowlist of skills for agents that do not set agents.list[].skills. */
  skills?: string[]; /** Silent-reply policy by conversation type. */
  silentReply?: SilentReplyPolicyShape; /** Optional repository root for system prompt runtime line (overrides auto-detect). */
  repoRoot?: string; /** Optional full system prompt replacement. Primarily for prompt debugging and controlled experiments. */
  systemPromptOverride?: string; /** Provider-independent prompt overlays applied by model family. */
  promptOverlays?: PromptOverlaysConfig; /** Skip bootstrap (BOOTSTRAP.md creation, etc.) for pre-configured deployments. */
  skipBootstrap?: boolean;
  /**
   * List of optional bootstrap filenames to skip writing to the workspace root.
   * Applies to: SOUL.md, USER.md, HEARTBEAT.md, IDENTITY.md.
   * Required workspace setup such as AGENTS.md and TOOLS.md still runs.
   * Example: ["SOUL.md", "USER.md", "HEARTBEAT.md", "IDENTITY.md"]
   */
  skipOptionalBootstrapFiles?: OptionalBootstrapFileName[];
  /**
   * Controls when workspace bootstrap files (AGENTS.md, SOUL.md, etc.) are
   * injected into the system prompt:
   * - always: inject on every turn (default)
   * - continuation-skip: skip injection on safe continuation turns once the
   *   transcript already contains a completed assistant turn
   */
  contextInjection?: AgentContextInjection; /** Max chars for injected bootstrap files before truncation (default: 20000). */
  bootstrapMaxChars?: number; /** Max total chars across all injected bootstrap files (default: 150000). */
  bootstrapTotalMaxChars?: number; /** Experimental agent-default flags. Keep off unless you are intentionally testing a preview surface. */
  experimental?: {
    /**
     * Drop heavyweight non-essential default tools for weaker or smaller local
     * model backends. Experimental preview only.
     */
    localModelLean?: boolean;
  };
  /**
   * Agent-visible bootstrap truncation warning mode:
   * - off: do not inject warning text
   * - once: inject once per unique truncation signature
   * - always: inject on every run with truncation (default)
   */
  bootstrapPromptTruncationWarning?: "off" | "once" | "always"; /** Optional IANA timezone for the user (used in system prompt; defaults to host timezone). */
  userTimezone?: string; /** Runtime-owned first-turn startup context for bare /new and /reset. */
  startupContext?: AgentStartupContextConfig; /** Focused context-budget overrides for high-volume injected/read surfaces. */
  contextLimits?: AgentContextLimitsConfig; /** Time format in system prompt: auto (OS preference), 12-hour, or 24-hour. */
  timeFormat?: "auto" | "12" | "24";
  /**
   * Envelope timestamp timezone: "utc" (default), "local", "user", or an IANA timezone string.
   */
  envelopeTimezone?: string;
  /**
   * Include absolute timestamps in message envelopes ("on" | "off", default: "on").
   */
  envelopeTimestamp?: "on" | "off";
  /**
   * Include elapsed time in message envelopes ("on" | "off", default: "on").
   */
  envelopeElapsed?: "on" | "off"; /** Optional context window cap (used for runtime estimates + status %). */
  contextTokens?: number; /** Optional CLI backends for text-only fallback (claude-cli, etc.). */
  cliBackends?: Record<string, CliBackendConfig>; /** Opt-in: prune old tool results from the LLM context to reduce token usage. */
  contextPruning?: AgentContextPruningConfig; /** Compaction tuning and pre-compaction memory flush behavior. */
  compaction?: AgentCompactionConfig; /** Outer run loop retry iteration boundaries. */
  runRetries?: AgentRunRetriesConfig; /** Embedded Pi runner hardening and compatibility controls. */
  embeddedPi?: {
    /**
     * How embedded Pi should trust workspace-local `.pi/config/settings.json`.
     * - sanitize (default): apply project settings except shellPath/shellCommandPrefix
     * - ignore: ignore project settings entirely
     * - trusted: trust project settings as-is
     */
    projectSettingsPolicy?: "trusted" | "sanitize" | "ignore";
    /**
     * Embedded Pi execution contract:
     * - default: keep the standard runner behavior
     * - strict-agentic: on OpenAI/OpenAI Codex GPT-5-family runs, keep acting until hitting a real blocker
     */
    executionContract?: EmbeddedPiExecutionContract;
  }; /** Vector memory search configuration (per-agent overrides supported). */
  memorySearch?: MemorySearchConfig; /** Default thinking level when no /think directive is present. */
  thinkingDefault?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | "max"; /** Default verbose level when no /verbose directive is present. */
  verboseDefault?: "off" | "on" | "full";
  /**
   * Detail mode for user-visible tool progress in /verbose and editable progress drafts.
   * - explain: compact human summary (default)
   * - raw: include raw command/detail when available
   */
  toolProgressDetail?: "explain" | "raw"; /** Default reasoning level when no /reasoning directive is present. */
  reasoningDefault?: "off" | "on" | "stream"; /** Default elevated level when no /elevated directive is present. */
  elevatedDefault?: "off" | "on" | "ask" | "full"; /** Default block streaming level when no override is present. */
  blockStreamingDefault?: "off" | "on";
  /**
   * Block streaming boundary:
   * - "text_end": end of each assistant text content block (before tool calls)
   * - "message_end": end of the whole assistant message (may include tool blocks)
   */
  blockStreamingBreak?: "text_end" | "message_end"; /** Soft block chunking for streamed replies (min/max chars, prefer paragraph/newline). */
  blockStreamingChunk?: BlockStreamingChunkConfig;
  /**
   * Block reply coalescing (merge streamed chunks before send).
   * idleMs: wait time before flushing when idle.
   */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig; /** Human-like delay between block replies. */
  humanDelay?: HumanDelayConfig;
  timeoutSeconds?: number; /** Max inbound media size in MB for agent-visible attachments (text note or future image attach). */
  mediaMaxMb?: number;
  /**
   * Max image side length (pixels) when sanitizing base64 image payloads in transcripts/tool results.
   * Default: 1200.
   */
  imageMaxDimensionPx?: number;
  typingIntervalSeconds?: number; /** Typing indicator start mode (never|instant|thinking|message). */
  typingMode?: TypingMode; /** Periodic background heartbeat runs. */
  heartbeat?: {
    /** Heartbeat interval (duration string, default unit: minutes; default: 30m). */every?: string; /** Optional active-hours window (local time); heartbeats run only inside this window. */
    activeHours?: {
      /** Start time (24h, HH:MM). Inclusive. */start?: string; /** End time (24h, HH:MM). Exclusive. Use "24:00" for end-of-day. */
      end?: string; /** Timezone for the window ("user", "local", or IANA TZ id). Default: "user". */
      timezone?: string;
    }; /** Heartbeat model override (provider/model). */
    model?: string; /** Session key for heartbeat runs ("main" or explicit session key). */
    session?: string; /** Delivery target ("last", "none", or a channel id). */
    target?: string; /** Direct/DM delivery policy. Default: "allow". */
    directPolicy?: "allow" | "block"; /** Optional delivery override (E.164 for WhatsApp, chat id for Telegram). Supports :topic:NNN suffix for Telegram topics. */
    to?: string; /** Optional account id for multi-account channels. */
    accountId?: string; /** Override the heartbeat prompt body (default: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."). */
    prompt?: string; /** Include the ## Heartbeats system prompt section for the default agent (default: true). */
    includeSystemPromptSection?: boolean; /** Max chars allowed after HEARTBEAT_OK before delivery (default: 30). */
    ackMaxChars?: number; /** Suppress tool error warning payloads during heartbeat runs. */
    suppressToolErrorWarnings?: boolean; /** Run timeout in seconds for heartbeat agent turns. */
    timeoutSeconds?: number;
    /**
     * If true, run heartbeat turns with lightweight bootstrap context.
     * Lightweight mode keeps only HEARTBEAT.md from workspace bootstrap files.
     */
    lightContext?: boolean;
    /**
     * If true, run heartbeat turns in an isolated session with no prior
     * conversation history. The heartbeat only sees its bootstrap context
     * (HEARTBEAT.md when lightContext is also enabled). Dramatically reduces
     * per-heartbeat token cost by avoiding the full session transcript.
     */
    isolatedSession?: boolean;
    /**
     * If true, defer heartbeat runs while this agent's session-keyed subagent or nested command lanes are busy.
     * Cron lanes are always treated as busy for heartbeat deferral.
     */
    skipWhenBusy?: boolean;
    /**
     * When enabled, deliver the model's reasoning payload for heartbeat runs (when available)
     * as a separate message prefixed with `Thinking.` (same as `/reasoning on`).
     *
     * Default: false (only the final heartbeat payload is delivered).
     */
    includeReasoning?: boolean;
  }; /** Max concurrent agent runs across all conversations. Default: 1 (sequential). */
  maxConcurrent?: number; /** Sub-agent defaults (spawned via sessions_spawn). */
  subagents?: {
    /** Prompt-only guidance for how strongly the main agent should delegate work. Default: "suggest". */delegationMode?: SubagentDelegationMode; /** Default allowlist of target agent ids for sessions_spawn. Use "*" to allow any configured target. */
    allowAgents?: string[]; /** Max concurrent sub-agent runs (global lane: "subagent"). Default: 1. */
    maxConcurrent?: number; /** Maximum depth allowed for sessions_spawn chains. Default behavior: 1 (no nested spawns). */
    maxSpawnDepth?: number; /** Maximum active children a single requester session may spawn. Default behavior: 5. */
    maxChildrenPerAgent?: number; /** Auto-archive sub-agent sessions after N minutes (default: 60, set 0 to disable). */
    archiveAfterMinutes?: number; /** Default model selection for spawned sub-agents (string or {primary,fallbacks}). */
    model?: AgentModelConfig; /** Default thinking level for spawned sub-agents (e.g. "off", "low", "medium", "high"). */
    thinking?: string; /** Default run timeout in seconds for spawned sub-agents (0 = no timeout). */
    runTimeoutSeconds?: number; /** Gateway timeout in ms for sub-agent announce delivery calls (default: 120000). */
    announceTimeoutMs?: number; /** Require explicit agentId in sessions_spawn (no default same-as-caller). Default: false. */
    requireAgentId?: boolean;
  }; /** Optional sandbox settings for non-main sessions. */
  sandbox?: AgentSandboxConfig;
};
type AgentCompactionMode = "default" | "safeguard";
type AgentCompactionPostIndexSyncMode = "off" | "async" | "await";
type AgentCompactionIdentifierPolicy = "strict" | "off" | "custom";
type AgentCompactionQualityGuardConfig = {
  /** Enable compaction summary quality audits and regeneration retries. Default: false. */enabled?: boolean; /** Maximum regeneration retries after a failed quality audit. Default: 1 when enabled. */
  maxRetries?: number;
};
type AgentCompactionMidTurnPrecheckConfig = {
  /**
   * Enable structured context pressure checks after tool results are appended
   * and before the next Pi model call. Default: false.
   */
  enabled?: boolean;
};
type AgentCompactionConfig = {
  /** Compaction summarization mode. */mode?: AgentCompactionMode; /** Pi reserve tokens target before floor enforcement. */
  reserveTokens?: number; /** Pi keepRecentTokens budget used for cut-point selection. */
  keepRecentTokens?: number; /** Minimum reserve tokens enforced for Pi compaction (0 disables the floor). */
  reserveTokensFloor?: number; /** Max share of context window for history during safeguard pruning (0.1–0.9, default 0.5). */
  maxHistoryShare?: number; /** Additional compaction-summary instructions that can preserve language or persona continuity. */
  customInstructions?: string; /** Preserve this many most-recent user/assistant turns verbatim in compaction summary context. */
  recentTurnsPreserve?: number; /** Identifier-preservation instruction policy for compaction summaries. */
  identifierPolicy?: AgentCompactionIdentifierPolicy; /** Custom identifier-preservation instructions used when identifierPolicy is "custom". */
  identifierInstructions?: string; /** Optional quality-audit retries for safeguard compaction summaries. */
  qualityGuard?: AgentCompactionQualityGuardConfig; /** Mid-turn precheck for tool-loop context pressure. Default: disabled. */
  midTurnPrecheck?: AgentCompactionMidTurnPrecheckConfig; /** Post-compaction session memory index sync mode. */
  postIndexSync?: AgentCompactionPostIndexSyncMode; /** Pre-compaction memory flush (agentic turn). Default: enabled. */
  memoryFlush?: AgentCompactionMemoryFlushConfig;
  /**
   * H2/H3 section names from AGENTS.md to inject after compaction.
   * Defaults to ["Session Startup", "Red Lines"] when unset.
   * Set to [] to disable post-compaction context injection entirely.
   */
  postCompactionSections?: string[];
  /** Optional model override for compaction summarization (e.g. "openrouter/anthropic/claude-sonnet-4-6").
   * When set, compaction uses this model instead of the agent's primary model.
   * Falls back to the primary model when unset. */
  model?: string; /** Maximum time in seconds for a single compaction operation (default: 900). */
  timeoutSeconds?: number;
  /**
   * Id of a registered compaction provider plugin.
   * When set, the provider's summarize() is called instead of
   * the built-in summarizeInStages(). Falls back to built-in on failure.
   */
  provider?: string;
  /**
   * Rotate the active session JSONL file after compaction so the next turn
   * starts from the compaction summary and unsummarized tail while the old
   * transcript stays archived.
   * Default: false (existing behavior preserved).
   */
  truncateAfterCompaction?: boolean;
  /**
   * Trigger a normal local compaction when the active session JSONL reaches
   * this size (bytes, or byte-size string like "20mb"). Set to 0/unset to
   * disable. Requires truncateAfterCompaction so successful compaction can
   * rotate to a smaller successor transcript. This does not split raw
   * transcript bytes.
   */
  maxActiveTranscriptBytes?: number | string;
  /**
   * Send brief compaction notices to the user when compaction starts and completes.
   * Default: false (silent by default).
   */
  notifyUser?: boolean;
};
type AgentCompactionMemoryFlushConfig = {
  /** Enable the pre-compaction memory flush (default: true). */enabled?: boolean; /** Optional provider/model override used only for pre-compaction memory flush turns. */
  model?: string; /** Run the memory flush when context is within this many tokens of the compaction threshold. */
  softThresholdTokens?: number;
  /**
   * Force a memory flush when transcript size reaches this threshold
   * (bytes, or byte-size string like "2mb"). Set to 0 to disable.
   */
  forceFlushTranscriptBytes?: number | string; /** User prompt used for the memory flush turn (NO_REPLY is enforced if missing). */
  prompt?: string; /** System prompt appended for the memory flush turn. */
  systemPrompt?: string;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.queue.d.ts
type QueueMode = "steer" | "followup" | "collect" | "interrupt";
type QueueDropPolicy = "old" | "new" | "summarize";
type QueueModeByProvider = {
  whatsapp?: QueueMode;
  telegram?: QueueMode;
  discord?: QueueMode;
  irc?: QueueMode;
  googlechat?: QueueMode;
  slack?: QueueMode;
  mattermost?: QueueMode;
  signal?: QueueMode;
  imessage?: QueueMode;
  msteams?: QueueMode;
  webchat?: QueueMode;
  matrix?: QueueMode;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.messages.d.ts
type GroupChatConfig = {
  mentionPatterns?: string[];
  historyLimit?: number;
  /**
   * Controls how unmentioned always-on group chatter is submitted.
   * Default: "user_request".
   */
  unmentionedInbound?: "user_request" | "room_event";
  /**
   * Controls how group/channel inbound events produce visible room replies. The
   * message-tool mode requires explicit message sends for visible room output;
   * final text stays private when the model misses the tool.
   * Default: "automatic".
   */
  visibleReplies?: "automatic" | "message_tool";
};
type DmConfig = {
  historyLimit?: number;
};
type QueueConfig = {
  mode?: QueueMode;
  byChannel?: QueueModeByProvider;
  debounceMs?: number; /** Per-channel debounce overrides (ms). */
  debounceMsByChannel?: InboundDebounceByProvider;
  cap?: number;
  drop?: QueueDropPolicy;
};
type InboundDebounceByProvider = Record<string, number>;
type InboundDebounceConfig = {
  debounceMs?: number;
  byChannel?: InboundDebounceByProvider;
};
type BroadcastStrategy = "parallel" | "sequential";
type BroadcastConfig = {
  /** Default processing strategy for broadcast peers. */strategy?: BroadcastStrategy;
  /**
   * Map peer IDs to arrays of agent IDs that should ALL process messages.
   *
   * Note: the index signature includes `undefined` so `strategy?: ...` remains type-safe.
   */
  [peerId: string]: string[] | BroadcastStrategy | undefined;
};
type AudioConfig = {
  /** @deprecated Use tools.media.audio.models instead. */transcription?: {
    command: string[];
    timeoutSeconds?: number;
  };
};
type StatusReactionsEmojiConfig = {
  thinking?: string;
  tool?: string;
  coding?: string;
  web?: string;
  deploy?: string;
  build?: string;
  concierge?: string;
  done?: string;
  error?: string;
  stallSoft?: string;
  stallHard?: string;
  compacting?: string;
};
type StatusReactionsTimingConfig = {
  /** Debounce interval for intermediate states (ms). Default: 700. */debounceMs?: number; /** Soft stall warning timeout (ms). Default: 25000. */
  stallSoftMs?: number; /** Hard stall warning timeout (ms). Default: 60000. */
  stallHardMs?: number; /** How long to hold done emoji before cleanup (ms). Default: 1500. */
  doneHoldMs?: number; /** How long to hold error emoji before cleanup (ms). Default: 2500. */
  errorHoldMs?: number;
};
type StatusReactionsConfig = {
  /** Enable lifecycle status reactions (default: false). */enabled?: boolean; /** Override default emojis. */
  emojis?: StatusReactionsEmojiConfig; /** Override default timing. */
  timing?: StatusReactionsTimingConfig;
};
type MessagesConfig = {
  /** @deprecated Use `whatsapp.messagePrefix` (WhatsApp-only inbound prefix). */messagePrefix?: string;
  /**
   * Controls how source inbound events produce visible replies across direct,
   * group, and channel conversations. Group/channel events still default to
   * `groupChat.visibleReplies` when it is set.
   *
   * Default: "automatic". In group/channel rooms, "message_tool" keeps final
   * text private unless the model sends visibly through the message tool.
   */
  visibleReplies?: "automatic" | "message_tool";
  /**
   * Prefix auto-added to all outbound replies.
   *
   * - string: explicit prefix (may include template variables)
   * - special value: `"auto"` derives `[{agents.list[].identity.name}]` for the routed agent (when set)
   *
   * Supported template variables (case-insensitive):
   * - `{model}` - short model name (e.g., `claude-opus-4-6`, `gpt-4o`)
   * - `{modelFull}` - full model identifier (e.g., `anthropic/claude-opus-4-6`)
   * - `{provider}` - provider name (e.g., `anthropic`, `openai`)
   * - `{thinkingLevel}` or `{think}` - current thinking level (`high`, `low`, `off`)
   * - `{identity.name}` or `{identityName}` - agent identity name
   *
   * Example: `"[{model} | think:{thinkingLevel}]"` → `"[claude-opus-4-6 | think:high]"`
   *
   * Unresolved variables remain as literal text (e.g., `{model}` if context unavailable).
   *
   * Default: none
   */
  responsePrefix?: string;
  groupChat?: GroupChatConfig;
  queue?: QueueConfig; /** Debounce rapid inbound messages per sender (global + per-channel overrides). */
  inbound?: InboundDebounceConfig; /** Emoji reaction used to acknowledge inbound messages (empty disables). */
  ackReaction?: string; /** When to send ack reactions. Default: "group-mentions". */
  ackReactionScope?: "group-mentions" | "group-all" | "direct" | "all" | "off" | "none"; /** Remove ack reaction after reply is sent (default: false). */
  removeAckAfterReply?: boolean; /** Lifecycle status reactions configuration. */
  statusReactions?: StatusReactionsConfig; /** When true, suppress ⚠️ tool-error warnings from being shown to the user. Default: false. */
  suppressToolErrors?: boolean; /** Text-to-speech settings for outbound replies. */
  tts?: TtsConfig;
};
type NativeCommandsSetting = boolean | "auto";
type CommandOwnerDisplay = "raw" | "hash";
/**
 * Per-provider allowlist for command authorization.
 * Keys are channel IDs (e.g., "discord", "whatsapp") or "*" for global default.
 * Values are arrays of sender IDs allowed to use commands on that channel.
 */
type CommandAllowFrom = Record<string, Array<string | number>>;
type CommandsConfig = {
  /** Enable native command registration when supported (default: "auto"). */native?: NativeCommandsSetting; /** Enable native skill command registration when supported (default: "auto"). */
  nativeSkills?: NativeCommandsSetting; /** Enable text command parsing (default: true). */
  text?: boolean; /** Allow bash chat command (`!`; `/bash` alias) (default: false). */
  bash?: boolean; /** How long bash waits before backgrounding (default: 2000; 0 backgrounds immediately). */
  bashForegroundMs?: number; /** Allow /config command (default: false). */
  config?: boolean; /** Allow /mcp command for OpenClaw-managed MCP settings (default: false). */
  mcp?: boolean; /** Allow /plugins command for plugin listing and enablement toggles (default: false). */
  plugins?: boolean; /** Allow /debug command (default: false). */
  debug?: boolean; /** Allow restart commands/tools (default: true). */
  restart?: boolean; /** Enforce access-group allowlists/policies for commands (default: true). */
  useAccessGroups?: boolean; /** Explicit owner allowlist for owner-scoped commands (channel-native IDs). */
  ownerAllowFrom?: Array<string | number>; /** How owner IDs are rendered in system prompts. */
  ownerDisplay?: CommandOwnerDisplay; /** Secret used to key owner ID hashes when ownerDisplay is "hash". */
  ownerDisplaySecret?: string;
  /**
   * Per-provider allowlist restricting who can use slash commands.
   * If set, overrides the channel's allowFrom for command authorization.
   * Use "*" key for global default, provider-specific keys override the global.
   * Example: { "*": ["user1"], discord: ["user:123"] }
   */
  allowFrom?: CommandAllowFrom;
};
type ProviderCommandsConfig = {
  /** Override native command registration for this provider (bool or "auto"). */native?: NativeCommandsSetting; /** Override native skill command registration for this provider (bool or "auto"). */
  nativeSkills?: NativeCommandsSetting;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.skills.d.ts
type SkillConfig = {
  enabled?: boolean;
  apiKey?: SecretInput;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
};
type SkillsLoadConfig = {
  /**
   * Additional skill folders to scan (lowest precedence).
   * Each directory should contain skill subfolders with `SKILL.md`.
   */
  extraDirs?: string[];
  /**
   * Real target directories that skill symlinks may resolve into even when they
   * sit outside the configured source root.
   */
  allowSymlinkTargets?: string[]; /** Watch skill folders for changes and refresh the skills snapshot. */
  watch?: boolean; /** Debounce for the skills watcher (ms). */
  watchDebounceMs?: number;
};
type SkillsInstallConfig = {
  preferBrew?: boolean;
  nodeManager?: "npm" | "pnpm" | "yarn" | "bun"; /** Allow gateway clients to install zip archives staged through skills.upload.*. */
  allowUploadedArchives?: boolean;
};
type SkillsLimitsConfig = {
  /** Max number of immediate child directories to consider under a skills root before treating it as suspicious. */maxCandidatesPerRoot?: number; /** Max number of skills to load per skills source (bundled/managed/workspace/extra). */
  maxSkillsLoadedPerSource?: number; /** Max number of skills to include in the model-facing skills prompt. */
  maxSkillsInPrompt?: number; /** Max characters for the model-facing skills prompt block (approx). */
  maxSkillsPromptChars?: number; /** Max size (bytes) allowed for a SKILL.md file to be considered. */
  maxSkillFileBytes?: number;
};
type SkillsConfig = {
  /** Optional bundled-skill allowlist (only affects bundled skills). */allowBundled?: string[];
  load?: SkillsLoadConfig;
  install?: SkillsInstallConfig;
  limits?: SkillsLimitsConfig;
  entries?: Record<string, SkillConfig>;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.agents.d.ts
type AgentRuntimeAcpConfig = {
  /** ACP harness adapter id (for example codex, claude). */agent?: string; /** Optional ACP backend override for this agent runtime. */
  backend?: string; /** Optional ACP session mode override. */
  mode?: "persistent" | "oneshot"; /** Optional runtime working directory override. */
  cwd?: string;
};
type AgentRuntimeConfig = {
  type: "embedded";
} | {
  type: "acp";
  acp?: AgentRuntimeAcpConfig;
};
type AgentBindingMatch = {
  channel: string;
  accountId?: string;
  peer?: {
    kind: ChatType;
    id: string;
  };
  guildId?: string;
  teamId?: string; /** Discord role IDs used for role-based routing. */
  roles?: string[];
};
type AgentRouteBinding = {
  /** Missing type is interpreted as route for backward compatibility. */type?: "route";
  agentId: string;
  comment?: string;
  match: AgentBindingMatch;
  session?: {
    /** Optional session scoping override for conversations matched by this binding. */dmScope?: DmScope;
  };
};
type AgentAcpBinding = {
  type: "acp";
  agentId: string;
  comment?: string;
  match: AgentBindingMatch;
  acp?: {
    mode?: "persistent" | "oneshot";
    label?: string;
    cwd?: string;
    backend?: string;
  };
};
type AgentBinding = AgentRouteBinding | AgentAcpBinding;
type AgentConfig = {
  id: string;
  default?: boolean;
  name?: string; /** Optional human-authored agent description. */
  description?: string;
  workspace?: string;
  agentDir?: string; /** Optional per-agent full system prompt replacement. */
  systemPromptOverride?: AgentDefaultsConfig["systemPromptOverride"]; /** Optional per-agent agent runtime policy override. */
  agentRuntime?: AgentRuntimePolicyConfig; /** @deprecated Use agentRuntime. */
  embeddedHarness?: AgentEmbeddedHarnessConfig;
  model?: AgentModelConfig; /** Per-model metadata overrides for this agent. */
  models?: Record<string, AgentModelEntryConfig>; /** @deprecated Legacy per-agent compaction config is kept for raw doctor migration/repair. */
  compaction?: AgentDefaultsConfig["compaction"]; /** Optional per-agent default thinking level (overrides agents.defaults.thinkingDefault). */
  thinkingDefault?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | "max"; /** Optional per-agent default verbosity level. */
  verboseDefault?: "off" | "on" | "full"; /** Optional per-agent tool progress detail mode. */
  toolProgressDetail?: AgentDefaultsConfig["toolProgressDetail"]; /** Optional per-agent default reasoning visibility. */
  reasoningDefault?: "on" | "off" | "stream"; /** Optional per-agent default for fast mode. */
  fastModeDefault?: boolean; /** Optional per-agent bootstrap/context injection mode override. */
  contextInjection?: AgentDefaultsConfig["contextInjection"]; /** Optional per-agent max chars for each injected bootstrap file. */
  bootstrapMaxChars?: AgentDefaultsConfig["bootstrapMaxChars"]; /** Optional per-agent max total chars across injected bootstrap files. */
  bootstrapTotalMaxChars?: AgentDefaultsConfig["bootstrapTotalMaxChars"]; /** Optional per-agent experimental flags. Omitted fields inherit agents.defaults.experimental. */
  experimental?: AgentDefaultsConfig["experimental"]; /** Optional allowlist of skills for this agent; omitting it inherits agents.defaults.skills when set, and an explicit list replaces defaults instead of merging. */
  skills?: string[];
  memorySearch?: MemorySearchConfig; /** Human-like delay between block replies for this agent. */
  humanDelay?: HumanDelayConfig; /** Optional per-agent TTS overrides, deep-merged over messages.tts. */
  tts?: TtsConfig; /** Optional per-agent skills subsystem overrides. */
  skillsLimits?: Pick<SkillsLimitsConfig, "maxSkillsPromptChars">; /** Optional per-agent overrides for selected context/token-heavy limits. */
  contextLimits?: AgentContextLimitsConfig;
  contextTokens?: number; /** Optional per-agent heartbeat overrides. */
  heartbeat?: AgentDefaultsConfig["heartbeat"];
  identity?: IdentityConfig;
  groupChat?: GroupChatConfig;
  subagents?: {
    /** Prompt-only guidance for how strongly this agent should delegate work. */delegationMode?: SubagentDelegationMode; /** Allow spawning sub-agents under other agent ids. Use "*" to allow any configured target. */
    allowAgents?: string[]; /** Per-agent default model for spawned sub-agents (string or {primary,fallbacks}). */
    model?: AgentModelConfig; /** Require explicit agentId in sessions_spawn (no default same-as-caller). */
    requireAgentId?: boolean;
  }; /** Optional outer run loop retry boundaries. */
  runRetries?: AgentDefaultsConfig["runRetries"]; /** Optional per-agent embedded Pi overrides. */
  embeddedPi?: {
    /** Optional per-agent execution contract override. */executionContract?: EmbeddedPiExecutionContract;
  }; /** Optional per-agent sandbox overrides. */
  sandbox?: AgentSandboxConfig; /** Optional per-agent stream params (e.g. cacheRetention, temperature). */
  params?: Record<string, unknown>;
  tools?: AgentToolsConfig; /** Optional runtime descriptor for this agent. */
  runtime?: AgentRuntimeConfig;
};
type AgentsConfig = {
  defaults?: AgentDefaultsConfig;
  list?: AgentConfig[];
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/acp/runtime/types.d.ts
type AcpSessionUpdateTag = "agent_message_chunk" | "agent_thought_chunk" | "tool_call" | "tool_call_update" | "usage_update" | "available_commands_update" | "current_mode_update" | "config_option_update" | "session_info_update" | "plan" | (string & {});
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.acp.d.ts
type AcpDispatchConfig = {
  /** Master switch for ACP turn dispatch in the reply pipeline. */enabled?: boolean;
};
type AcpStreamConfig = {
  /** Coalescer idle flush window in milliseconds for ACP streamed text. */coalesceIdleMs?: number; /** Maximum text size per streamed chunk. */
  maxChunkChars?: number; /** Suppresses repeated ACP status/tool projection lines within a turn. */
  repeatSuppression?: boolean; /** Live streams chunks or waits for terminal event before delivery. */
  deliveryMode?: "live" | "final_only"; /** Separator inserted before visible text when hidden tool events occurred. */
  hiddenBoundarySeparator?: "none" | "space" | "newline" | "paragraph"; /** Maximum assistant output characters forwarded per turn. */
  maxOutputChars?: number; /** Maximum visible characters for projected session/update lines. */
  maxSessionUpdateChars?: number;
  /**
   * Per-sessionUpdate visibility overrides.
   * Keys not listed here fall back to OpenClaw defaults.
   */
  tagVisibility?: Partial<Record<AcpSessionUpdateTag, boolean>>;
};
type AcpRuntimeConfig = {
  /** Idle runtime TTL in minutes for ACP session workers. */ttlMinutes?: number; /** Optional operator install/setup command shown by `/acp install` and `/acp doctor`. */
  installCommand?: string;
};
type AcpConfig = {
  /** Global ACP runtime gate. */enabled?: boolean;
  dispatch?: AcpDispatchConfig; /** Backend id registered by ACP runtime plugin (for example: acpx). */
  backend?: string; /** Fallback backend ids tried when the primary backend fails with UNAVAILABLE. */
  fallbacks?: string[];
  defaultAgent?: string;
  allowedAgents?: string[];
  maxConcurrentSessions?: number;
  stream?: AcpStreamConfig;
  runtime?: AcpRuntimeConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.access-groups.d.ts
type DiscordChannelAudienceAccessGroup = {
  /**
   * Discord dynamic audience backed by the users who can currently view a guild
   * channel.
   */
  type: "discord.channelAudience"; /** Guild ID that owns the channel. */
  guildId: string; /** Channel ID whose effective ViewChannel permission defines the audience. */
  channelId: string; /** Audience predicate. Defaults to canViewChannel. */
  membership?: "canViewChannel";
};
type MessageSendersAccessGroup = {
  /**
   * Static sender allowlists that can be referenced by any message channel via
   * accessGroup:<name>.
   */
  type: "message.senders"; /** Sender entries by channel id, plus optional "*" entries shared by all channels. */
  members: Record<string, string[]>;
};
type AccessGroupConfig = DiscordChannelAudienceAccessGroup | MessageSendersAccessGroup;
type AccessGroupsConfig = Record<string, AccessGroupConfig>;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.approvals.d.ts
type NativeExecApprovalEnableMode = boolean | "auto";
type ExecApprovalForwardingMode = "session" | "targets" | "both";
type ExecApprovalForwardTarget = {
  /** Channel id (e.g. "discord", "slack", or plugin channel id). */channel: string; /** Destination id (channel id, user id, etc. depending on channel). */
  to: string; /** Optional account id for multi-account channels. */
  accountId?: string; /** Optional thread id to reply inside a thread. */
  threadId?: string | number;
};
type ExecApprovalForwardingConfig = {
  /** Enable forwarding exec approvals to chat channels. Default: false. */enabled?: boolean; /** Delivery mode (session=origin chat, targets=config targets, both=both). Default: session. */
  mode?: ExecApprovalForwardingMode; /** Only forward approvals for these agent IDs. Omit = all agents. */
  agentFilter?: string[]; /** Only forward approvals matching these session key patterns (substring or regex). */
  sessionFilter?: string[]; /** Explicit delivery targets (used when mode includes targets). */
  targets?: ExecApprovalForwardTarget[];
};
type ApprovalsConfig = {
  exec?: ExecApprovalForwardingConfig;
  plugin?: ExecApprovalForwardingConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.auth.d.ts
type AuthProfileConfig = {
  provider: string;
  /**
   * Auth route selected by this profile id.
   * - api_key: static provider API key
   * - oauth: refreshable OAuth credentials (access+refresh+expires)
   * - token: static bearer-style token (optionally expiring; no refresh)
   * - aws-sdk: AWS SDK default credential chain (no secret in auth-profiles.json)
   */
  mode: "api_key" | "aws-sdk" | "oauth" | "token";
  email?: string;
  displayName?: string;
};
type AuthConfig = {
  profiles?: Record<string, AuthProfileConfig>;
  order?: Record<string, string[]>;
  cooldowns?: {
    /** Default billing backoff (hours). Default: 5. */billingBackoffHours?: number; /** Optional per-provider billing backoff (hours). */
    billingBackoffHoursByProvider?: Record<string, number>; /** Billing backoff cap (hours). Default: 24. */
    billingMaxHours?: number;
    /**
     * Base backoff for high-confidence permanent-auth failures (minutes).
     * Default: 10.
     */
    authPermanentBackoffMinutes?: number;
    /**
     * Cap for high-confidence permanent-auth backoff (minutes). Default: 60.
     */
    authPermanentMaxMinutes?: number;
    /**
     * Failure window for backoff counters (hours). If no failures occur within
     * this window, counters reset. Default: 24.
     */
    failureWindowHours?: number;
    /**
     * Maximum same-provider auth-profile rotations to allow for overloaded
     * errors before escalating to cross-provider model fallback. Default: 1.
     */
    overloadedProfileRotations?: number;
    /**
     * Fixed delay before retrying an overloaded provider/profile rotation.
     * Default: 0.
     */
    overloadedBackoffMs?: number;
    /**
     * Maximum same-provider auth-profile rotations to allow for rate-limit
     * errors before escalating to cross-provider model fallback. Default: 1.
     */
    rateLimitedProfileRotations?: number;
  };
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.browser.d.ts
type BrowserProfileConfig = {
  /** CDP port for this profile. Allocated once at creation, persisted permanently. */cdpPort?: number; /** CDP URL for this profile (use for remote Chrome). */
  cdpUrl?: string; /** Explicit user data directory for existing-session Chrome MCP attachment. */
  userDataDir?: string; /** Override the Chrome MCP command for existing-session profiles. */
  mcpCommand?: string; /** Extra Chrome MCP arguments for existing-session profiles. */
  mcpArgs?: string[]; /** Profile driver (default: openclaw). */
  driver?: "openclaw" | "clawd" | "existing-session"; /** If true, launch this profile in headless mode. Falls back to browser.headless. */
  headless?: boolean; /** Browser executable path for this profile. Falls back to browser.executablePath. */
  executablePath?: string; /** If true, never launch a browser for this profile; only attach. Falls back to browser.attachOnly. */
  attachOnly?: boolean; /** Profile color (hex). Auto-assigned at creation. */
  color: string;
};
type BrowserSnapshotDefaults = {
  /** Default snapshot mode (applies when mode is not provided). */mode?: "efficient";
};
type BrowserTabCleanupConfig = {
  /** Enable best-effort cleanup for tracked primary-agent browser tabs. Default: true */enabled?: boolean; /** Close tracked tabs after this many idle minutes. Set 0 to disable idle cleanup. Default: 120 */
  idleMinutes?: number; /** Keep at most this many tracked tabs per primary session. Set 0 to disable the cap. Default: 8 */
  maxTabsPerSession?: number; /** Cleanup sweep interval in minutes. Default: 5 */
  sweepMinutes?: number;
};
type BrowserSsrFPolicyConfig = {
  /** If true, permit browser navigation to private/internal networks. Default: true */dangerouslyAllowPrivateNetwork?: boolean;
  /**
   * Explicitly allowed hostnames (exact-match), including blocked names like localhost.
   * Example: ["localhost", "metadata.internal"]
   */
  allowedHostnames?: string[];
  /**
   * Hostname allowlist patterns for browser navigation.
   * Supports exact hosts and "*.example.com" wildcard subdomains.
   */
  hostnameAllowlist?: string[];
};
type BrowserConfig = {
  enabled?: boolean; /** If false, disable browser act:evaluate (arbitrary JS). Default: true */
  evaluateEnabled?: boolean; /** Base URL of the CDP endpoint (for remote browsers). Default: loopback CDP on the derived port. */
  cdpUrl?: string; /** Remote CDP HTTP timeout (ms). Default: 1500. */
  remoteCdpTimeoutMs?: number; /** Remote CDP WebSocket handshake timeout (ms). Default: max(remoteCdpTimeoutMs * 2, 2000). */
  remoteCdpHandshakeTimeoutMs?: number; /** Local managed browser launch discovery timeout (ms). Default: 15000. */
  localLaunchTimeoutMs?: number; /** Local managed browser post-launch CDP readiness timeout (ms). Default: 8000. */
  localCdpReadyTimeoutMs?: number; /** Default browser act timeout (ms). Default: 60000. */
  actionTimeoutMs?: number; /** Accent color for the openclaw browser profile (hex). Default: #FF4500 */
  color?: string; /** Override the browser executable path (all platforms). */
  executablePath?: string; /** Start Chrome headless (best-effort). Default: false */
  headless?: boolean; /** Pass --no-sandbox to Chrome (Linux containers). Default: false */
  noSandbox?: boolean; /** If true: never launch; only attach to an existing browser. Default: false */
  attachOnly?: boolean; /** Starting local CDP port for auto-assigned browser profiles. Default derives from gateway port. */
  cdpPortRangeStart?: number; /** Default profile to use when profile param is omitted. Default: "chrome" */
  defaultProfile?: string; /** Named browser profiles with explicit CDP ports or URLs. */
  profiles?: Record<string, BrowserProfileConfig>; /** Default snapshot options (applied by the browser tool/CLI when unset). */
  snapshotDefaults?: BrowserSnapshotDefaults; /** Best-effort cleanup policy for tabs opened by primary-agent browser sessions. */
  tabCleanup?: BrowserTabCleanupConfig; /** SSRF policy for browser navigation/open-tab operations. */
  ssrfPolicy?: BrowserSsrFPolicyConfig;
  /**
   * Additional Chrome launch arguments.
   * Useful for stealth flags, window size overrides, or custom user-agent strings.
   * Example: ["--window-size=1920,1080", "--disable-infobars"]
   */
  extraArgs?: string[];
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.bot-loop-protection.d.ts
type ChannelBotLoopProtectionConfig = {
  /** Enable pair loop protection for channels that support it. */enabled?: boolean; /** Maximum events a sender/receiver pair may exchange within the window. */
  maxEventsPerWindow?: number; /** Sliding window length in seconds. */
  windowSeconds?: number; /** Cooldown seconds applied to a pair after the limit is hit. */
  cooldownSeconds?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.channel-health.d.ts
type ChannelHeartbeatVisibilityConfig = {
  /** Show HEARTBEAT_OK acknowledgments in chat (default: false). */showOk?: boolean; /** Show heartbeat alerts with actual content (default: true). */
  showAlerts?: boolean; /** Emit indicator events for UI status display (default: true). */
  useIndicator?: boolean;
};
type ChannelHealthMonitorConfig = {
  /**
   * Enable channel-health-monitor restarts for this channel or account.
   * Inherits the global gateway setting when omitted.
   */
  enabled?: boolean;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.discord.d.ts
type DiscordPluralKitConfig = {
  enabled?: boolean;
  token?: string;
};
type DiscordMentionAliasesConfig = Record<string, string>;
type DiscordDmConfig = {
  /** If false, ignore all incoming Discord DMs. Default: true. */enabled?: boolean; /** Direct message access policy (default: pairing). */
  policy?: DmPolicy; /** Allowlist for DM senders (ids or names). */
  allowFrom?: string[]; /** If true, allow group DMs (default: false). */
  groupEnabled?: boolean; /** Optional allowlist for group DM channels (ids or slugs). */
  groupChannels?: string[];
};
type DiscordGuildChannelConfig = {
  requireMention?: boolean;
  /**
   * If true, drop messages that mention another user/role but not this one (not @everyone/@here).
   * Default: false.
   */
  ignoreOtherMentions?: boolean; /** Optional tool policy overrides for this channel. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** If specified, only load these skills for this channel. Omit = all skills; empty = no skills. */
  skills?: string[]; /** If false, disable the bot for this channel. */
  enabled?: boolean; /** Optional allowlist for channel senders (ids or names). */
  users?: string[]; /** Optional allowlist for channel senders by role ID. */
  roles?: string[]; /** Optional system prompt snippet for this channel. */
  systemPrompt?: string; /** If false, omit thread starter context for this channel (default: true). */
  includeThreadStarter?: boolean; /** If true, automatically create a thread for each new message in this channel. */
  autoThread?: boolean; /** Archive duration (minutes) for auto-created threads. Valid values: 60, 1440, 4320, 10080. */
  autoArchiveDuration?: "60" | "1440" | "4320" | "10080" | 60 | 1440 | 4320 | 10080; /** Naming strategy for auto-created threads. "message" uses message text; "generated" renames with an LLM title. */
  autoThreadName?: "message" | "generated";
};
type DiscordReactionNotificationMode = "off" | "own" | "all" | "allowlist";
type DiscordGuildEntry = {
  slug?: string;
  requireMention?: boolean;
  /**
   * If true, drop messages that mention another user/role but not this one (not @everyone/@here).
   * Default: false.
   */
  ignoreOtherMentions?: boolean; /** Optional tool policy overrides for this guild (used when channel override is missing). */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** Reaction notification mode (off|own|all|allowlist). Default: own. */
  reactionNotifications?: DiscordReactionNotificationMode; /** Optional allowlist for guild senders (ids or names). */
  users?: string[]; /** Optional allowlist for guild senders by role ID. */
  roles?: string[];
  channels?: Record<string, DiscordGuildChannelConfig>;
};
type DiscordActionConfig = {
  reactions?: boolean;
  stickers?: boolean;
  polls?: boolean;
  permissions?: boolean;
  messages?: boolean;
  threads?: boolean;
  pins?: boolean;
  search?: boolean;
  memberInfo?: boolean;
  roleInfo?: boolean;
  roles?: boolean;
  channelInfo?: boolean;
  voiceStatus?: boolean;
  events?: boolean;
  moderation?: boolean;
  emojiUploads?: boolean;
  stickerUploads?: boolean;
  channels?: boolean; /** Enable bot presence/activity changes (default: false). */
  presence?: boolean;
};
type DiscordIntentsConfig = {
  /** Enable Guild Presences privileged intent (requires Portal opt-in). Default: false. */presence?: boolean; /** Enable Guild Members privileged intent (requires Portal opt-in). Default: false. */
  guildMembers?: boolean; /** Enable Guild Voice States intent. Defaults to voice.enabled, unless explicitly set. */
  voiceStates?: boolean;
};
type DiscordVoiceAutoJoinConfig = {
  /** Guild ID that owns the voice channel. */guildId: string; /** Voice channel ID to join. */
  channelId: string;
};
type DiscordVoiceAllowedChannelConfig = {
  /** Guild ID that owns the voice channel. */guildId: string; /** Voice channel ID allowed for realtime voice sessions. */
  channelId: string;
};
type DiscordVoiceMode = "stt-tts" | "agent-proxy" | "bidi";
type DiscordVoiceRealtimeConsultPolicy = "auto" | "always";
type DiscordVoiceRealtimeToolPolicy = "safe-read-only" | "owner" | "none";
type DiscordVoiceRealtimeBootstrapContextFile = "IDENTITY.md" | "USER.md" | "SOUL.md";
type DiscordVoiceRealtimeConfig = {
  /** Realtime voice provider id, for example "openai". */provider?: string; /** Provider realtime session model, for example "gpt-realtime-2". */
  model?: string; /** Provider realtime output voice, for example "cedar". */
  voice?: string; /** System instructions passed to the realtime provider. */
  instructions?: string; /** Tool policy for bidi realtime consult calls. */
  toolPolicy?: DiscordVoiceRealtimeToolPolicy; /** Whether bidi should force the OpenClaw agent brain for every substantive turn. */
  consultPolicy?: DiscordVoiceRealtimeConsultPolicy; /** Agent profile bootstrap files to include in realtime provider instructions. Defaults to IDENTITY.md, USER.md, and SOUL.md; set [] to disable. */
  bootstrapContextFiles?: DiscordVoiceRealtimeBootstrapContextFile[]; /** Allow Discord speaker-start events to interrupt active realtime playback. */
  bargeIn?: boolean; /** Minimum assistant playback duration before a barge-in truncates audio. Default: 250ms; set 0 for immediate interruption. */
  minBargeInAudioEndMs?: number; /** Debounce window before buffered transcripts are sent to the OpenClaw agent. */
  debounceMs?: number; /** Provider-specific realtime voice config keyed by provider id. */
  providers?: Record<string, Record<string, unknown> | undefined>;
};
type DiscordVoiceAgentSessionConfig = {
  /** Which OpenClaw conversation should receive voice turns. Default: "voice". */mode?: "voice" | "target"; /** Discord target used when mode is "target", for example "channel:123". */
  target?: string;
};
type DiscordVoiceConfig = {
  /** Enable Discord voice channel conversations (default: true). */enabled?: boolean; /** Voice conversation mode. Default: agent-proxy. */
  mode?: DiscordVoiceMode; /** Route voice turns through an existing OpenClaw Discord conversation. */
  agentSession?: DiscordVoiceAgentSessionConfig; /** Optional LLM model override for Discord voice channel responses. */
  model?: string; /** Realtime provider settings for agent-proxy or bidi modes. */
  realtime?: DiscordVoiceRealtimeConfig; /** Voice channels to auto-join on startup. */
  autoJoin?: DiscordVoiceAutoJoinConfig[]; /** If false, configured followUsers are ignored without removing the saved user list. */
  followUsersEnabled?: boolean; /** Discord user IDs whose current voice channel the bot should follow. */
  followUsers?: string[]; /** Voice channels the bot is allowed to join or remain in. Unset means any voice channel is allowed. */
  allowedChannels?: DiscordVoiceAllowedChannelConfig[]; /** Enable/disable DAVE end-to-end encryption (default: true; Discord may require this). */
  daveEncryption?: boolean; /** Consecutive decrypt failures before DAVE session reinitialization (default: 24). */
  decryptionFailureTolerance?: number; /** Initial @discordjs/voice Ready wait in milliseconds (default: 30000). */
  connectTimeoutMs?: number; /** Grace period for Discord voice reconnect signalling after a disconnect (default: 15000). */
  reconnectGraceMs?: number; /** Silence grace after Discord reports a speaker ended before finalizing STT capture (default: 2500). */
  captureSilenceGraceMs?: number; /** Optional TTS overrides for Discord voice output. */
  tts?: TtsConfig;
};
type DiscordExecApprovalConfig = {
  /** Enable mode for Discord exec approvals on this account. Default: auto when approvers can be resolved; false disables. */enabled?: NativeExecApprovalEnableMode; /** Discord user IDs to receive approval prompts. Optional: falls back to commands.ownerAllowFrom when possible. */
  approvers?: string[]; /** Only forward approvals for these agent IDs. Omit = all agents. */
  agentFilter?: string[]; /** Only forward approvals matching these session key patterns (substring or regex). */
  sessionFilter?: string[]; /** Delete approval DMs after approval, denial, or timeout. Default: false. */
  cleanupAfterResolve?: boolean;
  /** Where to send approval prompts. "dm" sends to approver DMs (default), "channel" sends to the
   *  originating Discord channel, "both" sends to both. When target is "channel" or "both", buttons
   *  are only usable by resolved approvers; other users receive an ephemeral denial. */
  target?: "dm" | "channel" | "both";
};
type DiscordAgentComponentsConfig = {
  /** Enable agent-controlled interactive components (buttons, select menus). Default: true. */enabled?: boolean;
};
type DiscordUiComponentsConfig = {
  /** Accent color used by Discord component containers (hex). */accentColor?: string;
};
type DiscordUiConfig = {
  components?: DiscordUiComponentsConfig;
};
type DiscordThreadBindingsConfig = {
  /**
   * Enable Discord thread binding features (/focus, thread-bound delivery, and
   * thread-bound subagent session flows). Overrides session.threadBindings.enabled
   * when set.
   */
  enabled?: boolean;
  /**
   * Inactivity window for thread-bound sessions in hours.
   * Session auto-unfocuses after this amount of idle time. Set to 0 to disable. Default: 24.
   */
  idleHours?: number;
  /**
   * Optional hard max age for thread-bound sessions in hours.
   * Session auto-unfocuses once this age is reached even if active. Set to 0 to disable. Default: 0.
   */
  maxAgeHours?: number;
  /**
   * Allow session spawns to auto-create + bind Discord threads.
   * Applies to native subagent and ACP thread spawns. Default: true.
   */
  spawnSessions?: boolean;
  /**
   * Default context mode for native subagents spawned into a bound Discord thread.
   * Default: "fork".
   */
  defaultSpawnContext?: "isolated" | "fork";
  /**
   * @deprecated Use spawnSessions instead.
   */
  spawnSubagentSessions?: boolean;
  /**
   * @deprecated Use spawnSessions instead.
   */
  spawnAcpSessions?: boolean;
};
type DiscordSlashCommandConfig = {
  /** Reply ephemerally (default: true). */ephemeral?: boolean;
};
type DiscordThreadConfig = {
  /** If true, Discord thread sessions inherit the parent channel transcript. Default: false. */inheritParent?: boolean;
};
type DiscordAutoPresenceConfig = {
  /** Enable automatic runtime/quota-based Discord presence updates. Default: false. */enabled?: boolean; /** Poll interval for evaluating runtime availability state (ms). Default: 30000. */
  intervalMs?: number; /** Minimum spacing between actual gateway presence updates (ms). Default: 15000. */
  minUpdateIntervalMs?: number; /** Optional custom status text while runtime is healthy; supports plain text. */
  healthyText?: string; /** Optional custom status text while runtime/quota state is degraded or unknown. */
  degradedText?: string; /** Optional custom status text while runtime detects quota/token exhaustion. */
  exhaustedText?: string;
};
type DiscordAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[]; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Override native command registration for Discord (bool or "auto"). */
  commands?: ProviderCommandsConfig; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** If false, do not start this Discord account. Default: true. */
  enabled?: boolean;
  token?: SecretInput; /** Optional Discord application/client ID. Set this when REST application lookup is blocked. */
  applicationId?: string; /** HTTP(S) proxy URL for Discord gateway WebSocket connections. */
  proxy?: string; /** Timeout for Discord /gateway/bot metadata lookup before falling back to the default gateway URL. Default: 30000. */
  gatewayInfoTimeoutMs?: number; /** Startup wait for the gateway READY event before restarting the socket. Default: 15000. */
  gatewayReadyTimeoutMs?: number; /** Runtime reconnect wait for the gateway READY event before force-stopping the lifecycle. Default: 30000. */
  gatewayRuntimeReadyTimeoutMs?: number; /** Allow bot-authored messages to trigger replies (default: false). Set "mentions" to gate on mentions. */
  allowBots?: boolean | "mentions";
  /**
   * Sliding-window guard that suppresses runaway two-bot exchanges. Default on
   * whenever `allowBots` lets bot messages reach dispatch. See #58789.
   */
  botLoopProtection?: {
    /** Enable the bot-pair sliding-window guard (default: true when allowBots is set). */enabled?: boolean; /** Maximum messages a single bot pair may exchange in the configured window. Default: 20. */
    maxEventsPerWindow?: number; /** Sliding window length in seconds. Default: 60. */
    windowSeconds?: number; /** Cooldown seconds applied to a bot pair after the limit is hit. Default: 60. */
    cooldownSeconds?: number;
  };
  /**
   * Break-glass override: allow mutable identity matching (names/tags/slugs) in allowlists.
   * Default behavior is ID-only matching.
   */
  dangerouslyAllowNameMatching?: boolean;
  /**
   * Deterministic outbound @handle rewrites for known Discord users.
   * Keys are handles without the leading @; values are Discord user IDs.
   */
  mentionAliases?: DiscordMentionAliasesConfig;
  /**
   * Controls how guild channel messages are handled:
   * - "open": guild channels bypass allowlists; mention-gating applies
   * - "disabled": block all guild channel messages
   * - "allowlist": only allow channels present in discord.guilds.*.channels
   */
  groupPolicy?: GroupPolicy; /** Supplemental context visibility policy (all|allowlist|allowlist_quote). */
  contextVisibility?: ContextVisibilityMode; /** Outbound text chunk size (chars). Default: 2000. */
  textChunkLimit?: number;
  /**
   * Suppress Discord-generated link embeds for outbound messages. Default: true.
   * Explicit `embeds` payloads are still sent normally.
   */
  suppressEmbeds?: boolean; /** Streaming + chunking settings. Prefer this nested shape over legacy flat keys. */
  streaming?: ChannelPreviewStreamingConfig;
  /**
   * Soft max line count per Discord message.
   * Discord clients can clip/collapse very tall messages; splitting by lines
   * keeps replies readable in-channel. Default: 17.
   */
  maxLinesPerMessage?: number;
  mediaMaxMb?: number;
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by user ID. */
  dms?: Record<string, DmConfig>; /** Retry policy for outbound Discord API calls. */
  retry?: OutboundRetryConfig; /** Per-action tool gating (default: true for all). */
  actions?: DiscordActionConfig; /** Control reply threading when reply tags are present (off|first|all|batched). */
  replyToMode?: ReplyToMode; /** Thread session behavior. */
  thread?: DiscordThreadConfig;
  /**
   * Canonical DM policy key. Doctor migrates legacy channels.discord.dm.policy here.
   * Legacy key: channels.discord.dm.policy.
   */
  dmPolicy?: DmPolicy;
  /**
   * Canonical DM allowlist. Doctor migrates legacy channels.discord.dm.allowFrom here.
   * Legacy key: channels.discord.dm.allowFrom.
   */
  allowFrom?: string[]; /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string;
  dm?: DiscordDmConfig; /** New per-guild config keyed by guild id or slug. */
  guilds?: Record<string, DiscordGuildEntry>; /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig; /** Exec approval forwarding configuration. */
  execApprovals?: DiscordExecApprovalConfig; /** Agent-controlled interactive components (buttons, select menus). */
  agentComponents?: DiscordAgentComponentsConfig; /** Discord UI customization (components, modals, etc.). */
  ui?: DiscordUiConfig; /** Slash command configuration. */
  slashCommand?: DiscordSlashCommandConfig; /** Thread binding lifecycle settings (focus/subagent thread sessions). */
  threadBindings?: DiscordThreadBindingsConfig; /** Privileged Gateway Intents (must also be enabled in Discord Developer Portal). */
  intents?: DiscordIntentsConfig; /** Voice channel conversation settings. */
  voice?: DiscordVoiceConfig; /** PluralKit identity resolution for proxied messages. */
  pluralkit?: DiscordPluralKitConfig; /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;
  /**
   * Per-channel ack reaction override.
   * Discord supports both unicode emoji and custom emoji names.
   */
  ackReaction?: string; /** When to send ack reactions for this Discord account. Overrides messages.ackReactionScope. */
  ackReactionScope?: "group-mentions" | "group-all" | "direct" | "all" | "off" | "none"; /** Bot activity status text (e.g. "Watching X"). */
  activity?: string; /** Bot status (online|dnd|idle|invisible). Defaults to online when presence is configured. */
  status?: "online" | "dnd" | "idle" | "invisible"; /** Automatic runtime/quota presence signaling (status text + status mapping). */
  autoPresence?: DiscordAutoPresenceConfig; /** Activity type (0=Game, 1=Streaming, 2=Listening, 3=Watching, 4=Custom, 5=Competing). Defaults to 4 (Custom) when activity is set. */
  activityType?: 0 | 1 | 2 | 3 | 4 | 5; /** Streaming URL (Twitch/YouTube). Required when activityType=1. */
  activityUrl?: string;
  /**
   * Legacy compatibility block. Discord no longer enforces channel-owned
   * timeouts for queued inbound agent runs.
   */
  inboundWorker?: {
    /**
     * Ignored. Queued Discord agent runs are governed by the session/tool/runtime
     * lifecycle, not by Discord channel config.
     */
    runTimeoutMs?: number;
  };
  /**
   * Discord EventQueue configuration. Controls how Discord gateway events are processed.
   * `listenerTimeout` only covers gateway listener work such as normalization and enqueue.
   * It does not control the lifetime of queued inbound agent turns.
   */
  eventQueue?: {
    /** Max time (ms) a single listener can run before being killed. Default: 120000. */listenerTimeout?: number; /** Max events queued before backpressure is applied. Default: 10000. */
    maxQueueSize?: number; /** Max concurrent event processing operations. Default: 50. */
    maxConcurrency?: number;
  };
};
type DiscordConfig = {
  /** Optional per-account Discord configuration (multi-account). */accounts?: Record<string, DiscordAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & DiscordAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.googlechat.d.ts
type GoogleChatDmConfig = {
  /** If false, ignore all incoming Google Chat DMs. Default: true. */enabled?: boolean; /** Direct message access policy (default: pairing). */
  policy?: DmPolicy; /** Allowlist for DM senders (user ids or emails). */
  allowFrom?: Array<string | number>;
};
type GoogleChatGroupConfig = {
  /** If false, disable the bot in this space. */enabled?: boolean; /** Require mentioning the bot to trigger replies. */
  requireMention?: boolean; /** Sliding-window bot-pair loop guard for accepted bot-authored Google Chat messages. */
  botLoopProtection?: ChannelBotLoopProtectionConfig; /** Allowlist of users that can invoke the bot in this space. */
  users?: Array<string | number>; /** Optional system prompt for this space. */
  systemPrompt?: string;
};
type GoogleChatActionConfig = {
  reactions?: boolean;
};
type GoogleChatAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[]; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** If false, do not start this Google Chat account. Default: true. */
  enabled?: boolean; /** Allow bot-authored messages to trigger replies (default: false). */
  allowBots?: boolean; /** Sliding-window bot-pair loop guard for accepted bot-authored Google Chat messages. */
  botLoopProtection?: ChannelBotLoopProtectionConfig;
  /**
   * Break-glass override: allow mutable principal matching (raw email entries) in allowlists.
   * Default behavior is ID-only matching.
   */
  dangerouslyAllowNameMatching?: boolean; /** Default mention requirement for space messages (default: true). */
  requireMention?: boolean;
  /**
   * Controls how space messages are handled:
   * - "open": spaces bypass allowlists; mention-gating applies
   * - "disabled": block all space messages
   * - "allowlist": only allow spaces present in channels.googlechat.groups
   */
  groupPolicy?: GroupPolicy; /** Optional allowlist for space senders (user ids or emails). */
  groupAllowFrom?: Array<string | number>; /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string; /** Per-space configuration keyed by space id or name. */
  groups?: Record<string, GoogleChatGroupConfig>; /** Service account JSON (inline string, object, or secret reference). */
  serviceAccount?: string | Record<string, unknown> | SecretRef; /** Explicit secret reference for service account JSON. */
  serviceAccountRef?: SecretRef; /** Service account JSON file path. */
  serviceAccountFile?: string; /** Webhook audience type (app-url or project-number). */
  audienceType?: "app-url" | "project-number"; /** Audience value (app URL or project number). */
  audience?: string; /** Exact add-on principal to accept when app-url delivery uses add-on tokens. */
  appPrincipal?: string; /** Google Chat webhook path (default: /googlechat). */
  webhookPath?: string; /** Google Chat webhook URL (used to derive the path). */
  webhookUrl?: string; /** Optional bot user resource name (users/...). */
  botUser?: string; /** Max space messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by user id. */
  dms?: Record<string, DmConfig>; /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number; /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean; /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  mediaMaxMb?: number; /** Control reply threading when reply tags are present (off|first|all|batched). */
  replyToMode?: ReplyToMode; /** Per-action tool gating (default: true for all). */
  actions?: GoogleChatActionConfig;
  dm?: GoogleChatDmConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig;
  /**
   * Typing indicator mode (default: "message").
   * - "none": No indicator
   * - "message": Send "_<name> is typing..._" then edit with response
   * - "reaction": React with 👀 to user message, remove on reply
   *   NOTE: Reaction mode requires user OAuth (not supported with service account auth).
   *   If configured, falls back to message mode with a warning.
   */
  typingIndicator?: "none" | "message" | "reaction"; /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;
};
type GoogleChatConfig = {
  /** Optional per-account Google Chat configuration (multi-account). */accounts?: Record<string, GoogleChatAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & GoogleChatAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.imessage.d.ts
type IMessageActionConfig = {
  reactions?: boolean;
  edit?: boolean;
  unsend?: boolean;
  reply?: boolean;
  sendWithEffect?: boolean;
  renameGroup?: boolean;
  setGroupIcon?: boolean;
  addParticipant?: boolean;
  removeParticipant?: boolean;
  leaveGroup?: boolean;
  sendAttachment?: boolean;
};
type IMessageReactionNotificationMode = "off" | "own" | "all";
type IMessageAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[]; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** If false, do not start this iMessage account. Default: true. */
  enabled?: boolean; /** imsg CLI binary path (default: imsg). */
  cliPath?: string; /** Optional Messages db path override. */
  dbPath?: string; /** Remote SSH host token for SCP attachment fetches (`host` or `user@host`). */
  remoteHost?: string; /** Enable or disable private API message actions. */
  actions?: IMessageActionConfig; /** Optional default send service (imessage|sms|auto). */
  service?: "imessage" | "sms" | "auto"; /** Optional default region (used when sending SMS). */
  region?: string; /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy; /** Optional allowlist for inbound handles or chat_id targets. */
  allowFrom?: Array<string | number>; /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string; /** Optional allowlist for group senders or chat_id targets. */
  groupAllowFrom?: Array<string | number>;
  /**
   * Controls how group messages are handled:
   * - "open": groups bypass allowFrom; mention-gating applies
   * - "disabled": block all group messages entirely
   * - "allowlist": only allow group messages from senders in groupAllowFrom/allowFrom
   */
  groupPolicy?: GroupPolicy; /** Supplemental context visibility policy (all|allowlist|allowlist_quote). */
  contextVisibility?: ContextVisibilityMode; /** Max group messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by user ID. */
  dms?: Record<string, DmConfig>; /** Include attachments + reactions in watch payloads. */
  includeAttachments?: boolean; /** Allowed local iMessage attachment roots (supports single-segment `*` wildcards). */
  attachmentRoots?: string[]; /** Allowed remote iMessage attachment roots for SCP fetches (supports `*`). */
  remoteAttachmentRoots?: string[]; /** Max outbound media size in MB. */
  mediaMaxMb?: number; /** Timeout for probe/RPC operations in milliseconds (default: 10000). */
  probeTimeoutMs?: number; /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number; /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean; /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig; /** When private API is available, mark inbound chats read before dispatch (default: true). */
  sendReadReceipts?: boolean;
  /**
   * Controls inbound tapback notifications:
   * - "off": ignore tapbacks
   * - "own" (default): notify only when users react to bot-authored messages
   * - "all": notify for all inbound tapbacks from authorized senders
   */
  reactionNotifications?: IMessageReactionNotificationMode;
  /**
   * Merge consecutive same-sender DM rows from `chat.db` into a single agent
   * turn, so Apple's split-send (`<command> <URL>` arriving as two separate
   * rows ~0.8-2.0 s apart) lands as one merged message. DM-only — group chats
   * keep instant per-message dispatch. Widens the default inbound debounce
   * window to 2500 ms when enabled without an explicit
   * `messages.inbound.byChannel.imessage`. Default: `false`.
   */
  coalesceSameSenderDms?: boolean;
  groups?: Record<string, {
    requireMention?: boolean;
    tools?: GroupToolPolicyConfig;
    toolsBySender?: GroupToolPolicyBySenderConfig;
    /**
     * Per-group system prompt. Injected into the agent's system prompt on
     * every turn that handles a message in that group. Matches the shape
     * already supported by Discord, Telegram, IRC, Slack, GoogleChat, and
     * other group-capable channels. The wildcard `groups["*"]` entry is
     * also honored.
     */
    systemPrompt?: string;
  }>;
  /**
   * Catchup: replay inbound messages that arrived in `chat.db` while the
   * gateway was offline (crash, restart, mac sleep). Disabled by default.
   * See https://github.com/openclaw/openclaw/issues/78649.
   */
  catchup?: {
    /** Master switch. Default `false`. */enabled?: boolean;
    /**
     * Maximum age of replayable messages in minutes. Messages older than
     * `now - maxAgeMinutes` are skipped even when the cursor is older.
     * Defense against runaway replay (the inverse of #62761). Default
     * `120` (2 h). Clamp `[1, 720]`.
     */
    maxAgeMinutes?: number;
    /**
     * Maximum messages to replay per catchup pass. Default `50`. Clamp
     * `[1, 500]`.
     */
    perRunLimit?: number;
    /**
     * On first run when no cursor exists, look back this many minutes.
     * Default `30`.
     */
    firstRunLookbackMinutes?: number;
    /**
     * Per-message retry ceiling. After this many consecutive failed
     * dispatch attempts against the same message guid, catchup logs a
     * `warn` and force-advances the cursor past the wedged message.
     * Default `10`. Clamp `[1, 1000]`.
     */
    maxFailureRetries?: number;
  }; /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig; /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;
};
type IMessageConfig = {
  /** Optional per-account iMessage configuration (multi-account). */accounts?: Record<string, IMessageAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & IMessageAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.channel-messaging-common.d.ts
type CommonChannelMessagingConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[]; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** If false, do not start this account. Default: true. */
  enabled?: boolean; /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy; /** Optional allowlist for inbound DM senders. */
  allowFrom?: Array<string | number>; /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string; /** Optional allowlist for group/channel senders. */
  groupAllowFrom?: Array<string | number>; /** Group/channel message handling policy. */
  groupPolicy?: GroupPolicy;
  /**
   * Supplemental context visibility policy for fetched/group context.
   * - "all": include all quoted/thread/history context
   * - "allowlist": only include context from allowlisted senders
   * - "allowlist_quote": same as allowlist, but keep explicit quote/reply context
   */
  contextVisibility?: ContextVisibilityMode; /** Max group/channel messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by sender ID. */
  dms?: Record<string, DmConfig>; /** Outbound text chunk size (chars). */
  textChunkLimit?: number; /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean; /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig; /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig; /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string; /** Max outbound media size in MB. */
  mediaMaxMb?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.irc.d.ts
type IrcAccountConfig = CommonChannelMessagingConfig & {
  /** IRC server hostname (example: irc.example.com). */host?: string; /** IRC server port (default: 6697 with TLS, otherwise 6667). */
  port?: number; /** Use TLS for IRC connection (default: true). */
  tls?: boolean; /** IRC nickname to identify this bot. */
  nick?: string; /** IRC USER field username (defaults to nick). */
  username?: string; /** IRC USER field realname (default: OpenClaw). */
  realname?: string; /** Optional IRC server password (sensitive). */
  password?: string; /** Optional file path containing IRC server password. */
  passwordFile?: string; /** Optional NickServ identify/register settings. */
  nickserv?: {
    /** Enable NickServ identify/register after connect (default: enabled when password is set). */enabled?: boolean; /** NickServ service nick (default: NickServ). */
    service?: string; /** NickServ password (sensitive). */
    password?: string; /** Optional file path containing NickServ password. */
    passwordFile?: string; /** If true, send NickServ REGISTER on connect. */
    register?: boolean; /** Email used with NickServ REGISTER. */
    registerEmail?: string;
  }; /** Auto-join channel list at connect (example: ["#openclaw"]). */
  channels?: string[]; /** Outbound text chunk size (chars). Default: 350. */
  textChunkLimit?: number;
  groups?: Record<string, {
    requireMention?: boolean;
    tools?: GroupToolPolicyConfig;
    toolsBySender?: GroupToolPolicyBySenderConfig;
    allowFrom?: Array<string | number>;
    skills?: string[];
    enabled?: boolean;
    systemPrompt?: string;
  }>; /** Optional mention patterns specific to IRC channel messages. */
  mentionPatterns?: string[];
};
type IrcConfig = {
  /** Optional per-account IRC configuration (multi-account). */accounts?: Record<string, IrcAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & IrcAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.msteams.d.ts
type MSTeamsWebhookConfig = {
  /** Port for the webhook server. Default: 3978. */port?: number; /** Path for the messages endpoint. Default: /api/messages. */
  path?: string;
};
/**
 * Bot Framework OAuth SSO configuration for Microsoft Teams.
 *
 * When enabled, the plugin handles the `signin/tokenExchange` and
 * `signin/verifyState` invoke activities that Teams sends after an
 * `oauthCard` is presented to the user. The exchanged user token is
 * persisted via the Bot Framework User Token service so downstream
 * tools can call Microsoft Graph with delegated permissions.
 *
 * Prerequisites (Azure portal):
 * - The bot's Azure AD (Entra) app is configured with an exposed API
 *   scope (for example `access_as_user`) and lists the Teams client
 *   IDs in `knownClientApplications`.
 * - The Bot Framework channel registration has an OAuth Connection
 *   Setting whose name matches `connectionName` below, pointing at
 *   the same Azure AD app.
 */
type MSTeamsSsoConfig = {
  /** If true, handle signin/tokenExchange + signin/verifyState invokes. Default: false. */enabled?: boolean;
  /**
   * Name of the OAuth connection configured on the Bot Framework channel
   * registration (Azure Bot resource). Required when `enabled` is true.
   */
  connectionName?: string;
};
/** Reply style for MS Teams messages. */
type MSTeamsReplyStyle = "thread" | "top-level";
/** Channel-level config for MS Teams. */
type MSTeamsChannelConfig = {
  /** Require @mention to respond. Default: true. */requireMention?: boolean; /** Optional tool policy overrides for this channel. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** Reply style: "thread" replies to the message, "top-level" posts a new message. */
  replyStyle?: MSTeamsReplyStyle;
};
/** Team-level config for MS Teams. */
type MSTeamsTeamConfig = {
  /** Default requireMention for channels in this team. */requireMention?: boolean; /** Default tool policy for channels in this team. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** Default reply style for channels in this team. */
  replyStyle?: MSTeamsReplyStyle; /** Per-channel overrides. Key is conversation ID (e.g., "19:...@thread.tacv2"). */
  channels?: Record<string, MSTeamsChannelConfig>;
};
type MSTeamsConfig = {
  /** If false, do not start the MS Teams provider. Default: true. */enabled?: boolean; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[];
  /**
   * Break-glass override: allow mutable identity matching (display names/UPNs) in allowlists.
   * Default behavior is ID-only matching.
   */
  dangerouslyAllowNameMatching?: boolean; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** Azure Bot App ID (from Azure Bot registration). */
  appId?: string; /** Azure Bot App Password / Client Secret. */
  appPassword?: SecretInput; /** Azure AD Tenant ID (for single-tenant bots). */
  tenantId?: string;
  /**
   * Authentication type.
   * - `"secret"` (default): uses `appPassword` (client secret).
   * - `"federated"`: uses workload identity / managed identity / certificate.
   */
  authType?: "secret" | "federated"; /** Path to a PEM certificate file for certificate-based auth. Used when `authType` is `"federated"`. */
  certificatePath?: string; /** Certificate thumbprint (hex SHA-1) for certificate-based auth. */
  certificateThumbprint?: string; /** If `true`, use Azure Managed Identity (system- or user-assigned) instead of a certificate. */
  useManagedIdentity?: boolean; /** User-assigned managed-identity client ID. When omitted with `useManagedIdentity: true`, system-assigned identity is used. */
  managedIdentityClientId?: string; /** Webhook server configuration. */
  webhook?: MSTeamsWebhookConfig; /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy; /** Allowlist for DM senders (AAD object IDs or UPNs). */
  allowFrom?: Array<string>; /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string; /** Optional allowlist for group/channel senders (AAD object IDs or UPNs). */
  groupAllowFrom?: Array<string>;
  /**
   * Controls how group/channel messages are handled:
   * - "open": groups bypass allowFrom; mention-gating applies
   * - "disabled": block all group messages
   * - "allowlist": only allow group messages from senders in groupAllowFrom/allowFrom
   */
  groupPolicy?: GroupPolicy; /** Supplemental context visibility policy (all|allowlist|allowlist_quote). */
  contextVisibility?: ContextVisibilityMode; /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number; /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline"; /** Preview/progress streaming config for visible in-progress replies. */
  streaming?: ChannelPreviewStreamingConfig; /** Send native Teams typing indicator before replies. Default: true for groups/channels; DMs use informative stream status. */
  typingIndicator?: boolean; /** Enable progressive block-by-block message delivery instead of a single reply. */
  blockStreaming?: boolean; /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  /**
   * Allowed host suffixes for inbound attachment downloads.
   * Use ["*"] to allow any host (not recommended).
   */
  mediaAllowHosts?: Array<string>;
  /**
   * Allowed host suffixes for attaching Authorization headers to inbound media retries.
   * Use specific hosts only; avoid multi-tenant suffixes.
   */
  mediaAuthAllowHosts?: Array<string>; /** Default: require @mention to respond in channels/groups. */
  requireMention?: boolean; /** Max group/channel messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by user ID. */
  dms?: Record<string, DmConfig>; /** Default reply style: "thread" replies to the message, "top-level" posts a new message. */
  replyStyle?: MSTeamsReplyStyle; /** Per-team config. Key is team ID (from the /team/ URL path segment). */
  teams?: Record<string, MSTeamsTeamConfig>; /** Max media size in MB (default: 100MB for OneDrive upload support). */
  mediaMaxMb?: number; /** SharePoint site ID for file uploads in group chats/channels (e.g., "contoso.sharepoint.com,guid1,guid2"). */
  sharePointSiteId?: string; /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel. */
  healthMonitor?: ChannelHealthMonitorConfig; /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string; /** Show a welcome Adaptive Card when the bot is added to a 1:1 chat. Default: true. */
  welcomeCard?: boolean; /** Custom prompt starter labels shown on the welcome card. */
  promptStarters?: string[]; /** Show a welcome message when the bot is added to a group chat. Default: false. */
  groupWelcomeCard?: boolean; /** Enable the Teams feedback loop (thumbs up/down) on AI-generated messages. Default: true. */
  feedbackEnabled?: boolean; /** Enable background reflection when a user gives negative feedback. Default: true. */
  feedbackReflection?: boolean; /** Minimum interval (ms) between reflections per session. Default: 300000 (5 min). */
  feedbackReflectionCooldownMs?: number; /** Delegated auth settings for user-scoped Graph API actions (e.g., reactions). */
  delegatedAuth?: {
    /** Enable delegated auth (user sign-in for Graph actions that need user scope). */enabled?: boolean; /** Additional scopes to request during OAuth consent. */
    scopes?: string[];
  }; /** Bot Framework OAuth SSO (signin/tokenExchange + signin/verifyState) settings. */
  sso?: MSTeamsSsoConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.signal.d.ts
type SignalReactionNotificationMode = "off" | "own" | "all" | "allowlist";
type SignalReactionLevel = "off" | "ack" | "minimal" | "extensive";
type SignalApiMode = "auto" | "native" | "container";
type SignalGroupConfig = {
  requireMention?: boolean; /** Emit internal message hooks for mention-skipped group messages. */
  ingest?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
};
type SignalAccountConfig = CommonChannelMessagingConfig & {
  /** Optional explicit E.164 account for signal-cli. */account?: string; /** Optional account UUID for signal-cli (used for loop protection). */
  accountUuid?: string; /** Optional full base URL for signal-cli HTTP daemon. */
  httpUrl?: string; /** HTTP host for signal-cli daemon (default 127.0.0.1). */
  httpHost?: string; /** HTTP port for signal-cli daemon (default 8080). */
  httpPort?: number; /** signal-cli binary path (default: signal-cli). */
  cliPath?: string; /** Auto-start signal-cli daemon (default: true if httpUrl not set). */
  autoStart?: boolean; /** Max time to wait for signal-cli daemon startup (ms, cap 120000). */
  startupTimeoutMs?: number;
  receiveMode?: "on-start" | "manual";
  ignoreAttachments?: boolean;
  ignoreStories?: boolean;
  sendReadReceipts?: boolean; /** Per-group overrides keyed by Signal group id (or "*"). */
  groups?: Record<string, SignalGroupConfig>; /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number; /** Reaction notification mode (off|own|all|allowlist). Default: own. */
  reactionNotifications?: SignalReactionNotificationMode; /** Allowlist for reaction notifications when mode is allowlist. */
  reactionAllowlist?: Array<string | number>; /** Action toggles for message tool capabilities. */
  actions?: {
    /** Enable/disable sending reactions via message tool (default: true). */reactions?: boolean;
  };
  /**
   * Controls agent reaction behavior:
   * - "off": No reactions
   * - "ack": Only automatic ack reactions (👀 when processing)
   * - "minimal": Agent can react sparingly (default)
   * - "extensive": Agent can react liberally
   */
  reactionLevel?: SignalReactionLevel;
};
type SignalConfig = {
  /**
   * Signal API mode (channel-global):
   * - "auto" (default): Auto-detect based on available endpoints
   * - "native": Use native signal-cli with JSON-RPC + SSE (/api/v1/rpc, /api/v1/events)
   * - "container": Use bbernhard/signal-cli-rest-api with REST + WebSocket (/v2/send, /v1/receive/{account}).
   *   Requires the container to run with MODE=json-rpc for real-time message receiving.
   */
  apiMode?: SignalApiMode; /** Optional per-account Signal configuration (multi-account). */
  accounts?: Record<string, SignalAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & SignalAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.slack.d.ts
type SlackDmConfig = {
  /** If false, ignore all incoming Slack DMs. Default: true. */enabled?: boolean; /** Direct message access policy (default: pairing). */
  policy?: DmPolicy; /** Allowlist for DM senders (ids). */
  allowFrom?: Array<string | number>; /** If true, allow group DMs (default: false). */
  groupEnabled?: boolean; /** Optional allowlist for group DM channels (ids or slugs). */
  groupChannels?: Array<string | number>; /** @deprecated Prefer channels.slack.replyToModeByChatType.direct. */
  replyToMode?: ReplyToMode;
};
type SlackChannelConfig = {
  /** If false, disable the bot in this channel. */enabled?: boolean; /** Require mentioning the bot to trigger replies. */
  requireMention?: boolean; /** Optional tool policy overrides for this channel. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** Allow bot-authored messages to trigger replies (default: false). Set to "mentions" to only allow bot messages that @mention this bot. */
  allowBots?: boolean | "mentions"; /** Sliding-window bot-pair loop guard for accepted bot-authored Slack messages. */
  botLoopProtection?: ChannelBotLoopProtectionConfig; /** Allowlist of users that can invoke the bot in this channel. */
  users?: Array<string | number>; /** Optional skill filter for this channel. */
  skills?: string[]; /** Optional system prompt for this channel. */
  systemPrompt?: string;
};
type SlackReactionNotificationMode = "off" | "own" | "all" | "allowlist";
type SlackExecApprovalTarget = "dm" | "channel" | "both";
type SlackExecApprovalConfig = {
  /** Enable mode for Slack exec approvals on this account. Default: auto when approvers can be resolved; false disables. */enabled?: NativeExecApprovalEnableMode; /** Slack user IDs allowed to approve exec requests. Optional: falls back to commands.ownerAllowFrom when possible. */
  approvers?: Array<string | number>; /** Only forward approvals for these agent IDs. Omit = all agents. */
  agentFilter?: string[]; /** Only forward approvals matching these session key patterns (substring or regex). */
  sessionFilter?: string[]; /** Where to send approval prompts. Default: "dm". */
  target?: SlackExecApprovalTarget;
};
type SlackCapabilitiesConfig = string[] | {
  interactiveReplies?: boolean;
};
type SlackActionConfig = {
  reactions?: boolean;
  messages?: boolean;
  pins?: boolean;
  search?: boolean;
  permissions?: boolean;
  memberInfo?: boolean;
  channelInfo?: boolean;
  emojiList?: boolean;
};
type SlackSlashCommandConfig = {
  /** Enable handling for the configured slash command (default: false). */enabled?: boolean; /** Slash command name (default: "openclaw"). */
  name?: string; /** Session key prefix for slash commands (default: "slack:slash"). */
  sessionPrefix?: string; /** Reply ephemerally (default: true). */
  ephemeral?: boolean;
};
type SlackThreadConfig = {
  /** Scope for thread history context (thread|channel). Default: thread. */historyScope?: "thread" | "channel"; /** If true, thread sessions inherit the parent channel transcript. Default: false. */
  inheritParent?: boolean; /** Maximum number of thread messages to fetch as context when starting a new thread session (default: 20). Set to 0 to disable thread history fetching. */
  initialHistoryLimit?: number;
  /**
   * If true, require explicit @mention even inside threads where the bot has
   * previously participated. By default (false), replying in a thread where
   * the bot is a participant counts as an implicit mention and bypasses
   * requireMention gating. Set to true to suppress implicit thread mentions
   * so only explicit @bot mentions trigger replies in threads.
   */
  requireExplicitMention?: boolean;
};
type SlackSocketModeConfig = {
  /** Slack SDK pong timeout in milliseconds. Socket Mode only. Default: 15000. */clientPingTimeout?: number; /** Slack SDK server ping timeout in milliseconds. Socket Mode only. */
  serverPingTimeout?: number; /** Enable Slack SDK ping/pong transport logging. Socket Mode only. */
  pingPongLoggingEnabled?: boolean;
};
type SlackAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** Slack connection mode (socket|http). Default: socket. */
  mode?: "socket" | "http"; /** Slack SDK Socket Mode transport options. Ignored in HTTP mode. */
  socketMode?: SlackSocketModeConfig; /** Slack signing secret (required for HTTP mode). */
  signingSecret?: string; /** Slack Events API webhook path (default: /slack/events). */
  webhookPath?: string; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: SlackCapabilitiesConfig; /** Slack-native exec approval delivery + approver authorization. */
  execApprovals?: SlackExecApprovalConfig; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Override native command registration for Slack (bool or "auto"). */
  commands?: ProviderCommandsConfig; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** If false, do not start this Slack account. Default: true. */
  enabled?: boolean;
  botToken?: string;
  appToken?: string;
  userToken?: string; /** If true, restrict user token to read operations only. Default: true. */
  userTokenReadOnly?: boolean; /** Allow bot-authored messages to trigger replies (default: false). Set to "mentions" to only allow bot messages that @mention this bot. */
  allowBots?: boolean | "mentions"; /** Sliding-window bot-pair loop guard for accepted bot-authored Slack messages. */
  botLoopProtection?: ChannelBotLoopProtectionConfig;
  /**
   * Break-glass override: allow mutable identity matching (name/slug) in allowlists.
   * Default behavior is ID-only matching.
   */
  dangerouslyAllowNameMatching?: boolean; /** Default mention requirement for channel messages (default: true). */
  requireMention?: boolean;
  /**
   * Controls how channel messages are handled:
   * - "open": channels bypass allowlists; mention-gating applies
   * - "disabled": block all channel messages
   * - "allowlist": only allow channels present in channels.slack.channels
   */
  groupPolicy?: GroupPolicy; /** Supplemental context visibility policy (all|allowlist|allowlist_quote). */
  contextVisibility?: ContextVisibilityMode; /** Max channel messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by user ID. */
  dms?: Record<string, DmConfig>;
  textChunkLimit?: number; /** Pass through Slack chat.postMessage link unfurl control. Default: false. */
  unfurlLinks?: boolean; /** Pass through Slack chat.postMessage media unfurl control. Omitted by default. */
  unfurlMedia?: boolean; /** Streaming + chunking settings. Prefer this nested shape over legacy flat keys. */
  streaming?: SlackChannelStreamingConfig;
  mediaMaxMb?: number; /** Reaction notification mode (off|own|all|allowlist). Default: own. */
  reactionNotifications?: SlackReactionNotificationMode; /** Allowlist for reaction notifications when mode is allowlist. */
  reactionAllowlist?: Array<string | number>; /** Control reply threading when reply tags are present (off|first|all|batched). */
  replyToMode?: ReplyToMode;
  /**
   * Optional per-chat-type reply threading overrides.
   * Example: { direct: "all", group: "first", channel: "off" }.
   */
  replyToModeByChatType?: Partial<Record<"direct" | "group" | "channel", ReplyToMode>>; /** Thread session behavior. */
  thread?: SlackThreadConfig;
  actions?: SlackActionConfig;
  slashCommand?: SlackSlashCommandConfig;
  /**
   * Canonical DM policy key. Doctor migrates legacy channels.slack.dm.policy here.
   * Legacy key: channels.slack.dm.policy.
   */
  dmPolicy?: DmPolicy;
  /**
   * Canonical DM allowlist. Doctor migrates legacy channels.slack.dm.allowFrom here.
   * Legacy key: channels.slack.dm.allowFrom.
   */
  allowFrom?: Array<string | number>; /** Default delivery target for CLI --deliver when no explicit --reply-to is provided. */
  defaultTo?: string;
  dm?: SlackDmConfig;
  channels?: Record<string, SlackChannelConfig>; /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig; /** Outbound response prefix override for this channel/account. */
  responsePrefix?: string;
  /**
   * Per-channel ack reaction override.
   * Slack uses shortcodes (e.g., "eyes") rather than unicode emoji.
   */
  ackReaction?: string; /** Reaction emoji added while processing a reply (e.g. "hourglass_flowing_sand"). Removed when done. Useful as a typing indicator fallback when assistant mode is not enabled. */
  typingReaction?: string;
};
type SlackConfig = {
  /** Optional per-account Slack configuration (multi-account). */accounts?: Record<string, SlackAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & SlackAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.telegram.d.ts
type TelegramActionConfig = {
  reactions?: boolean;
  sendMessage?: boolean; /** Enable poll creation. Requires sendMessage to also be enabled. */
  poll?: boolean;
  deleteMessage?: boolean;
  editMessage?: boolean; /** Enable sticker actions (send and search). */
  sticker?: boolean; /** Enable forum topic creation. */
  createForumTopic?: boolean; /** Enable forum topic editing (rename / change icon). */
  editForumTopic?: boolean;
};
type TelegramThreadBindingsConfig = SessionThreadBindingsConfig & {
  /**
   * @deprecated Use spawnSessions instead.
   */
  spawnSubagentSessions?: boolean;
  /**
   * @deprecated Use spawnSessions instead.
   */
  spawnAcpSessions?: boolean;
};
type TelegramNetworkConfig = {
  /** Override Node's autoSelectFamily behavior (true = enable, false = disable). */autoSelectFamily?: boolean;
  /**
   * DNS result order for network requests ("ipv4first" | "verbatim").
   * Set to "ipv4first" to prioritize IPv4 addresses and work around IPv6 issues.
   * Default: "ipv4first" on Node 22+ to avoid common fetch failures.
   */
  dnsResultOrder?: "ipv4first" | "verbatim";
  /**
   * Dangerous opt-in for Telegram media downloads in trusted fake-IP or
   * transparent-proxy environments that resolve api.telegram.org to
   * private/internal/special-use addresses.
   */
  dangerouslyAllowPrivateNetwork?: boolean;
};
type TelegramInlineButtonsScope = "off" | "dm" | "group" | "all" | "allowlist";
type TelegramExecApprovalTarget = "dm" | "channel" | "both";
type TelegramStreamingPreviewConfig = ChannelStreamingPreviewConfig & {
  /** Use Telegram-native ephemeral draft UI for DM preview tool progress. */nativeToolProgress?: boolean; /** Telegram sender/user IDs allowed to use native DM preview tool progress. */
  nativeToolProgressAllowFrom?: Array<string | number>;
};
type TelegramPreviewStreamingConfig = Omit<ChannelPreviewStreamingConfig, "preview"> & {
  preview?: TelegramStreamingPreviewConfig;
};
type TelegramExecApprovalConfig = {
  /** Enable mode for Telegram exec approvals on this account. Default: auto when approvers can be resolved; false disables. */enabled?: NativeExecApprovalEnableMode; /** Telegram user IDs allowed to approve exec requests. Optional: falls back to numeric owner IDs inferred from commands.ownerAllowFrom when possible. */
  approvers?: Array<string | number>; /** Only forward approvals for these agent IDs. Omit = all agents. */
  agentFilter?: string[]; /** Only forward approvals matching these session key patterns (substring or regex). */
  sessionFilter?: string[]; /** Where to send approval prompts. Default: "dm". */
  target?: TelegramExecApprovalTarget;
};
type TelegramCapabilitiesConfig = string[] | {
  inlineButtons?: TelegramInlineButtonsScope;
};
/** Custom command definition for Telegram bot menu. */
type TelegramCustomCommand = {
  /** Command name (without leading /). */command: string; /** Description shown in Telegram command menu. */
  description: string;
};
type TelegramAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: TelegramCapabilitiesConfig; /** Telegram-native exec approval delivery + approver authorization. */
  execApprovals?: TelegramExecApprovalConfig; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Override native command registration for Telegram (bool or "auto"). */
  commands?: ProviderCommandsConfig; /** Custom commands to register in Telegram's command menu (merged with native). */
  customCommands?: TelegramCustomCommand[]; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean;
  /**
   * Controls how Telegram direct chats (DMs) are handled:
   * - "pairing" (default): unknown senders get a pairing code; owner must approve
   * - "allowlist": only allow senders in allowFrom (or paired allow store)
   * - "open": allow all inbound DMs (requires allowFrom to include "*")
   * - "disabled": ignore all inbound DMs
   */
  dmPolicy?: DmPolicy; /** If false, do not start this Telegram account. Default: true. */
  enabled?: boolean;
  botToken?: string; /** Path to a regular file containing the bot token; symlinks are rejected. */
  tokenFile?: string; /** Control reply threading when reply tags are present (off|first|all|batched). */
  replyToMode?: ReplyToMode; /** Direct-message threading behavior. Defaults to flat DM sessions. */
  dm?: TelegramDmConfig;
  groups?: Record<string, TelegramGroupConfig>; /** Per-DM configuration for Telegram DM topics (key is chat ID). */
  direct?: Record<string, TelegramDirectConfig>; /** DM allowlist (numeric Telegram user IDs). Onboarding can resolve @username to IDs. */
  allowFrom?: Array<string | number>; /** Default delivery target for CLI `--deliver` when no explicit `--reply-to` is provided. */
  defaultTo?: string | number; /** Optional allowlist for Telegram group senders (numeric Telegram user IDs). */
  groupAllowFrom?: Array<string | number>;
  /**
   * Controls how group messages are handled:
   * - "open": groups bypass allowFrom, only mention-gating applies
   * - "disabled": block all group messages entirely
   * - "allowlist": only allow group messages from senders in groupAllowFrom/allowFrom
   */
  groupPolicy?: GroupPolicy; /** Supplemental context visibility policy (all|allowlist|allowlist_quote). */
  contextVisibility?: ContextVisibilityMode; /** Max group messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM config overrides keyed by user ID. */
  dms?: Record<string, DmConfig>; /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number; /** Streaming + chunking settings. Prefer this nested shape over legacy flat keys. */
  streaming?: TelegramPreviewStreamingConfig;
  mediaMaxMb?: number; /** Telegram API client timeout in seconds (grammY ApiClientOptions). */
  timeoutSeconds?: number; /** Buffer window for Telegram media groups/albums before dispatching them as one inbound message. Default: 500ms. */
  mediaGroupFlushMs?: number; /** Telegram polling watchdog threshold in milliseconds. Default: 120000. */
  pollingStallThresholdMs?: number; /** Retry policy for outbound Telegram API calls. */
  retry?: OutboundRetryConfig; /** Network transport overrides for Telegram. */
  network?: TelegramNetworkConfig;
  proxy?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string; /** Local webhook listener bind host (default: 127.0.0.1). */
  webhookHost?: string; /** Local webhook listener bind port (default: 8787). */
  webhookPort?: number; /** Path to the self-signed certificate (PEM) to upload to Telegram during webhook registration. */
  webhookCertPath?: string; /** Per-action tool gating (default: true for all). */
  actions?: TelegramActionConfig; /** Telegram thread/conversation binding overrides. */
  threadBindings?: TelegramThreadBindingsConfig;
  /**
   * Controls which user reactions trigger notifications:
   * - "off" (default): ignore all reactions
   * - "own": notify when users react to bot messages
   * - "all": notify agent of all reactions
   */
  reactionNotifications?: "off" | "own" | "all";
  /**
   * Controls agent's reaction capability:
   * - "off": agent cannot react
   * - "ack" (default): bot sends acknowledgment reactions (👀 while processing)
   * - "minimal": agent can react sparingly (guideline: 1 per 5-10 exchanges)
   * - "extensive": agent can react liberally when appropriate
   */
  reactionLevel?: "off" | "ack" | "minimal" | "extensive"; /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig; /** Controls whether link previews are shown in outbound messages. Default: true. */
  linkPreview?: boolean; /** Send Telegram bot error replies silently (no notification sound). Default: false. */
  silentErrorReplies?: boolean; /** Controls outbound error reporting: always, once per cooldown window, or silent. */
  errorPolicy?: "always" | "once" | "silent"; /** Cooldown window for `errorPolicy: "once"` in milliseconds. */
  errorCooldownMs?: number;
  /**
   * Per-channel outbound response prefix override.
   *
   * When set, this takes precedence over the global `messages.responsePrefix`.
   * Use `""` to explicitly disable a global prefix for this channel.
   * Use `"auto"` to derive `[{identity.name}]` from the routed agent.
   */
  responsePrefix?: string;
  /**
   * Per-channel ack reaction override.
   * Telegram expects unicode emoji (e.g., "👀") rather than shortcodes.
   */
  ackReaction?: string; /** Custom Telegram Bot API root URL (e.g. "https://my-proxy.example.com" or a local Bot API server), not a /bot<TOKEN> endpoint. */
  apiRoot?: string; /** Trusted local filesystem roots for self-hosted Telegram Bot API absolute file_path values. */
  trustedLocalFileRoots?: string[]; /** Auto-rename DM forum topics on first message using LLM. Default: true. */
  autoTopicLabel?: AutoTopicLabelConfig;
};
type TelegramDmThreadReplies = "off" | "inbound" | "always";
type TelegramDmConfig = {
  /** DM-only session threading override for message_thread_id (off|inbound|always). Default: off. */threadReplies?: TelegramDmThreadReplies;
};
type TelegramTopicConfig = {
  requireMention?: boolean; /** Emit internal message hooks for mention-skipped topic messages. */
  ingest?: boolean; /** Per-topic override for group message policy (open|disabled|allowlist). */
  groupPolicy?: GroupPolicy; /** If specified, only load these skills for this topic. Omit = all skills; empty = no skills. */
  skills?: string[]; /** If false, disable the bot for this topic. */
  enabled?: boolean; /** Optional allowlist for topic senders (numeric Telegram user IDs). */
  allowFrom?: Array<string | number>; /** Optional system prompt snippet for this topic. */
  systemPrompt?: string; /** If true, skip automatic voice-note transcription for mention detection in this topic. */
  disableAudioPreflight?: boolean; /** Route this topic to a specific agent (overrides group-level and binding routing). */
  agentId?: string; /** Controls outbound error reporting for this topic. */
  errorPolicy?: "always" | "once" | "silent"; /** Cooldown window for `errorPolicy: "once"` in milliseconds. */
  errorCooldownMs?: number;
};
type TelegramGroupConfig = {
  requireMention?: boolean; /** Emit internal message hooks for mention-skipped group messages. */
  ingest?: boolean; /** Per-group override for group message policy (open|disabled|allowlist). */
  groupPolicy?: GroupPolicy; /** Optional tool policy overrides for this group. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** If specified, only load these skills for this group (when no topic). Omit = all skills; empty = no skills. */
  skills?: string[]; /** Per-topic configuration (key is message_thread_id as string) */
  topics?: Record<string, TelegramTopicConfig>; /** If false, disable the bot for this group (and its topics). */
  enabled?: boolean; /** Optional allowlist for group senders (numeric Telegram user IDs). */
  allowFrom?: Array<string | number>; /** Optional system prompt snippet for this group. */
  systemPrompt?: string; /** If true, skip automatic voice-note transcription for mention detection in this group. */
  disableAudioPreflight?: boolean; /** Controls outbound error reporting for this group. */
  errorPolicy?: "always" | "once" | "silent"; /** Cooldown window for `errorPolicy: "once"` in milliseconds. */
  errorCooldownMs?: number;
};
/** Config for LLM-based auto-topic labeling. */
type AutoTopicLabelConfig = boolean | {
  enabled?: boolean; /** Custom prompt for LLM-based topic naming. */
  prompt?: string;
};
type TelegramDirectConfig = {
  /** Per-DM override for DM message policy (open|disabled|allowlist). */dmPolicy?: DmPolicy; /** Controls whether Telegram DM message_thread_id values split sessions. Default: off unless topic config requires it. */
  threadReplies?: "off" | "inbound" | "always"; /** Optional tool policy overrides for this DM. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** If specified, only load these skills for this DM (when no topic). Omit = all skills; empty = no skills. */
  skills?: string[]; /** Per-topic configuration for DM topics (key is message_thread_id as string) */
  topics?: Record<string, TelegramTopicConfig>; /** If false, disable the bot for this DM (and its topics). */
  enabled?: boolean; /** If true, require messages to be from a topic when topics are enabled. */
  requireTopic?: boolean; /** Optional allowlist for DM senders (numeric Telegram user IDs). */
  allowFrom?: Array<string | number>; /** Optional system prompt snippet for this DM. */
  systemPrompt?: string; /** Controls outbound error reporting for this DM. */
  errorPolicy?: "always" | "once" | "silent"; /** Cooldown window for `errorPolicy: "once"` in milliseconds. */
  errorCooldownMs?: number; /** Auto-rename DM forum topics on first message using LLM. Default: true. */
  autoTopicLabel?: AutoTopicLabelConfig;
};
type TelegramConfig = {
  /** Optional per-account Telegram configuration (multi-account). */accounts?: Record<string, TelegramAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & TelegramAccountConfig;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/utils/reaction-level.d.ts
type ReactionLevel = "off" | "ack" | "minimal" | "extensive";
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.whatsapp.d.ts
type WhatsAppActionConfig = {
  reactions?: boolean;
  sendMessage?: boolean;
  polls?: boolean;
};
type WhatsAppReactionLevel = ReactionLevel;
type WhatsAppGroupConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig; /** Optional system prompt for this group. */
  systemPrompt?: string;
};
type WhatsAppDirectConfig = {
  /** Optional system prompt for this direct chat. */systemPrompt?: string;
};
type WhatsAppAckReactionConfig = {
  /** Emoji to use for acknowledgment (e.g., "👀"). Empty = disabled. */emoji?: string; /** Send reactions in direct chats. Default: true. */
  direct?: boolean;
  /**
   * Send reactions in group chats:
   * - "always": react to all group messages
   * - "mentions": react only when bot is mentioned
   * - "never": never react in groups
   * Default: "mentions"
   */
  group?: "always" | "mentions" | "never";
};
type WhatsAppSharedConfig = {
  /** Whether the WhatsApp channel is enabled. */enabled?: boolean; /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy; /** Same-phone setup (bot uses your personal WhatsApp number). */
  selfChatMode?: boolean; /** Optional allowlist for WhatsApp direct chats (E.164). */
  allowFrom?: string[]; /** Default delivery target for CLI `--deliver` when no explicit `--reply-to` is provided (E.164 or group JID). */
  defaultTo?: string; /** Optional allowlist for WhatsApp group senders (E.164). */
  groupAllowFrom?: string[];
  /**
   * Controls how group messages are handled:
   * - "open": groups bypass allowFrom, only mention-gating applies
   * - "disabled": block all group messages entirely
   * - "allowlist": only allow group messages from senders in groupAllowFrom/allowFrom
   */
  groupPolicy?: GroupPolicy; /** Supplemental context visibility policy (all|allowlist|allowlist_quote). */
  contextVisibility?: ContextVisibilityMode; /** Max group messages to keep as history context (0 disables). */
  historyLimit?: number; /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number; /** Per-DM history overrides keyed by user ID. */
  dms?: Record<string, DmConfig>; /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number; /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline"; /** Maximum media file size in MB. Default: 50. */
  mediaMaxMb?: number; /** Disable block streaming for this account. */
  blockStreaming?: boolean; /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  groups?: Record<string, WhatsAppGroupConfig>; /** Per-direct-chat prompt overrides keyed by user ID or `*` wildcard. */
  direct?: Record<string, WhatsAppDirectConfig>; /** Acknowledgment reaction sent immediately upon message receipt. */
  ackReaction?: WhatsAppAckReactionConfig;
  /**
   * Controls agent reaction behavior:
   * - "off": No reactions
   * - "ack": Only automatic ack reactions
   * - "minimal" (default): Agent can react sparingly
   * - "extensive": Agent can react liberally
   */
  reactionLevel?: WhatsAppReactionLevel; /** Debounce window (ms) for batching rapid consecutive messages from the same sender (0 to disable). */
  debounceMs?: number; /** Reply threading mode for auto-replies (off|first|all|batched). */
  replyToMode?: ReplyToMode; /** Heartbeat visibility settings. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Channel health monitor overrides for this channel/account. */
  healthMonitor?: ChannelHealthMonitorConfig;
};
type WhatsAppConfigCore = {
  /** Optional provider capability tags used for agent/runtime guidance. */capabilities?: string[]; /** Markdown formatting overrides (tables). */
  markdown?: MarkdownConfig; /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean; /** Send read receipts for incoming messages (default true). */
  sendReadReceipts?: boolean; /** Inbound message prefix override (WhatsApp only). */
  messagePrefix?: string; /** Outbound response prefix override. */
  responsePrefix?: string;
};
type WhatsAppConfig = WhatsAppConfigCore & WhatsAppSharedConfig & {
  /** Optional per-account WhatsApp configuration (multi-account). */accounts?: Record<string, WhatsAppAccountConfig>; /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string; /** Per-action tool gating (default: true for all). */
  actions?: WhatsAppActionConfig;
};
type WhatsAppAccountConfig = WhatsAppConfigCore & WhatsAppSharedConfig & {
  /** Optional display name for this account (used in CLI/UI lists). */name?: string; /** If false, do not start this WhatsApp account provider. Default: true. */
  enabled?: boolean; /** Override auth directory (Baileys multi-file auth state). */
  authDir?: string;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.channels.d.ts
type ChannelDefaultsConfig = {
  groupPolicy?: GroupPolicy;
  contextVisibility?: ContextVisibilityMode; /** Default heartbeat visibility for all channels. */
  heartbeat?: ChannelHeartbeatVisibilityConfig; /** Default pair loop guard settings for channels that support bot loop protection. */
  botLoopProtection?: ChannelBotLoopProtectionConfig;
};
type ChannelModelByChannelConfig = Record<string, Record<string, string>>;
interface ChannelsConfig {
  defaults?: ChannelDefaultsConfig;
  /** Map provider -> channel id -> model override. */
  modelByChannel?: ChannelModelByChannelConfig;
  discord?: DiscordConfig;
  googlechat?: GoogleChatConfig;
  imessage?: IMessageConfig;
  irc?: IrcConfig;
  msteams?: MSTeamsConfig;
  signal?: SignalConfig;
  slack?: SlackConfig;
  telegram?: TelegramConfig;
  whatsapp?: WhatsAppConfig;
  /**
   * Channel sections are plugin-owned and keyed by arbitrary channel ids.
   * Keep the lookup permissive so augmented channel configs remain ergonomic at call sites.
   */
  [key: string]: any;
}
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.cli.d.ts
type CliBannerTaglineMode = "random" | "default" | "off";
type CliConfig = {
  banner?: {
    /**
     * Controls CLI banner tagline behavior.
     * - "random": pick from tagline pool (default)
     * - "default": always use DEFAULT_TAGLINE
     * - "off": hide tagline text
     */
    taglineMode?: CliBannerTaglineMode;
  };
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.commitments.d.ts
type CommitmentsConfig = {
  /** Enable inferred follow-up extraction, storage, and heartbeat delivery. Default: false. */enabled?: boolean; /** Maximum inferred follow-up commitments delivered per agent session in a rolling day. Default: 3. */
  maxPerDay?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.crestodian.d.ts
type CrestodianRescueConfig = {
  /**
   * Remote message rescue gate.
   * "auto" enables only for YOLO host posture with sandboxing off.
   */
  enabled?: "auto" | boolean; /** Restrict rescue to owner DMs. Default: true. */
  ownerDmOnly?: boolean; /** Pending write approval TTL in minutes. Default: 15. */
  pendingTtlMinutes?: number;
};
type CrestodianConfig = {
  rescue?: CrestodianRescueConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.cron.d.ts
/** Error types that can trigger retries for one-shot jobs. */
type CronRetryOn = "rate_limit" | "overloaded" | "network" | "timeout" | "server_error";
type CronRetryConfig = {
  /** Max retries for transient errors before permanent disable (default: 3). */maxAttempts?: number; /** Backoff delays in ms for each retry attempt (default: [30000, 60000, 300000]). */
  backoffMs?: number[]; /** Error types to retry; omit to retry all transient types. */
  retryOn?: CronRetryOn[];
};
type CronFailureAlertConfig = {
  enabled?: boolean;
  after?: number;
  cooldownMs?: number;
  includeSkipped?: boolean;
  mode?: "announce" | "webhook";
  accountId?: string;
};
type CronFailureDestinationConfig = {
  channel?: string;
  to?: string;
  accountId?: string;
  mode?: "announce" | "webhook";
};
type CronConfig = {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number; /** Override default retry policy for one-shot jobs on transient errors. */
  retry?: CronRetryConfig;
  /**
   * @deprecated Legacy fallback webhook URL used only for stored jobs with notify=true.
   * Prefer per-job delivery.mode="webhook" with delivery.to.
   */
  webhook?: string; /** Bearer token for cron webhook POST delivery. */
  webhookToken?: SecretInput;
  /**
   * How long to retain completed cron run sessions before automatic pruning.
   * Accepts a duration string (e.g. "24h", "7d", "1h30m") or `false` to disable pruning.
   * Default: "24h".
   */
  sessionRetention?: string | false;
  /**
   * Run-log pruning controls for `cron/runs/<jobId>.jsonl`.
   * Defaults: `maxBytes=2_000_000`, `keepLines=2000`.
   */
  runLog?: {
    maxBytes?: number | string;
    keepLines?: number;
  };
  failureAlert?: CronFailureAlertConfig; /** Default destination for failure notifications across all cron jobs. */
  failureDestination?: CronFailureDestinationConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.gateway.d.ts
type GatewayBindMode = "auto" | "lan" | "loopback" | "custom" | "tailnet";
type GatewayTlsConfig = {
  /** Enable TLS for the gateway server. */enabled?: boolean; /** Auto-generate a self-signed cert if cert/key are missing (default: true). */
  autoGenerate?: boolean; /** PEM certificate path for the gateway server. */
  certPath?: string; /** PEM private key path for the gateway server. */
  keyPath?: string; /** Optional PEM CA bundle for TLS clients (mTLS or custom roots). */
  caPath?: string;
};
type WideAreaDiscoveryConfig = {
  enabled?: boolean; /** Optional unicast DNS-SD domain (e.g. "openclaw.internal"). */
  domain?: string;
};
type MdnsDiscoveryMode = "off" | "minimal" | "full";
type MdnsDiscoveryConfig = {
  /**
   * mDNS/Bonjour discovery broadcast mode (default: minimal).
   * - off: disable mDNS entirely
   * - minimal: omit cliPath/sshPort from TXT records
   * - full: include cliPath/sshPort in TXT records
   */
  mode?: MdnsDiscoveryMode;
};
type DiscoveryConfig = {
  wideArea?: WideAreaDiscoveryConfig;
  mdns?: MdnsDiscoveryConfig;
};
type TalkProviderConfig = {
  /** Provider API key (optional; provider-specific env fallback may apply). */apiKey?: SecretInput; /** Provider-owned Talk config fields. */
  [key: string]: unknown;
};
type TalkRealtimeConfig = {
  /** Active realtime voice provider. */provider?: string; /** Provider-specific realtime voice config keyed by provider id. */
  providers?: Record<string, TalkProviderConfig>; /** Provider model override for realtime sessions. */
  model?: string; /** Provider voice override for realtime sessions. */
  voice?: string; /** Additional system instructions appended to realtime Talk sessions. */
  instructions?: string; /** Realtime execution mode. */
  mode?: "realtime" | "stt-tts" | "transcription"; /** Byte/session transport. */
  transport?: "webrtc" | "provider-websocket" | "gateway-relay" | "managed-room"; /** Tool/agent strategy for realtime sessions. */
  brain?: "agent-consult" | "direct-tools" | "none";
};
type TalkConfig = {
  /** Active Talk TTS provider (for example "acme-speech"). */provider?: string; /** Provider-specific Talk config keyed by provider id. */
  providers?: Record<string, TalkProviderConfig>; /** Realtime Talk provider, model, voice, mode, transport, and brain config. */
  realtime?: TalkRealtimeConfig; /** Optional thinking level override for the agent run behind Talk realtime consults. */
  consultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive" | "max"; /** Optional fast mode override for the agent run behind Talk realtime consults. */
  consultFastMode?: boolean; /** BCP 47 locale id used for Talk speech recognition on device nodes. */
  speechLocale?: string; /** Stop speaking when user starts talking (default: true). */
  interruptOnSpeech?: boolean; /** Milliseconds of user silence before Talk mode sends the transcript after a pause. */
  silenceTimeoutMs?: number;
};
type GatewayControlUiConfig = {
  /** If false, the Gateway will not serve the Control UI (default /). */enabled?: boolean; /** Optional base path prefix for the Control UI (e.g. "/openclaw"). */
  basePath?: string; /** Optional filesystem root for Control UI assets (defaults to dist/control-ui). */
  root?: string;
  /**
   * Embed sandbox mode for hosted Control UI previews.
   * - strict: no script execution inside embeds
   * - scripts: allow scripts while keeping embeds origin-isolated (default)
   * - trusted: allow scripts and same-origin privileges
   */
  embedSandbox?: "strict" | "scripts" | "trusted";
  /**
   * DANGEROUS: Allow hosted embeds to load absolute external http(s) URLs.
   * Default off; prefer hosted /__openclaw__/canvas or /__openclaw__/a2ui content.
   */
  allowExternalEmbedUrls?: boolean; /** Optional max-width for grouped Control UI chat messages (default: min(900px, 68%)). */
  chatMessageMaxWidth?: string; /** Allowed browser origins for Control UI/WebChat websocket connections. */
  allowedOrigins?: string[];
  /**
   * DANGEROUS: Keep Host-header origin fallback behavior.
   * Supported long-term for deployments that intentionally rely on this policy.
   */
  dangerouslyAllowHostHeaderOriginFallback?: boolean;
  /**
   * Insecure-auth toggle.
   * Control UI still requires secure context + device identity unless
   * dangerouslyDisableDeviceAuth is enabled.
   */
  allowInsecureAuth?: boolean; /** DANGEROUS: Disable device identity checks for the Control UI (default: false). */
  dangerouslyDisableDeviceAuth?: boolean;
};
type GatewayAuthMode = "none" | "token" | "password" | "trusted-proxy";
/**
 * Configuration for trusted reverse proxy authentication.
 * Used when Clawdbot runs behind an identity-aware proxy (Pomerium, Caddy + OAuth, etc.)
 * that handles authentication and passes user identity via headers.
 */
type GatewayTrustedProxyConfig = {
  /**
   * Header name containing the authenticated user identity (required).
   * Common values: "x-forwarded-user", "x-remote-user", "x-pomerium-claim-email"
   */
  userHeader: string;
  /**
   * Additional headers that MUST be present for the request to be trusted.
   * Use this to verify the request actually came through the proxy.
   * Example: ["x-forwarded-proto", "x-forwarded-host"]
   */
  requiredHeaders?: string[];
  /**
   * Optional allowlist of user identities that can access the gateway.
   * If empty or omitted, all authenticated users from the proxy are allowed.
   * Example: ["nick@example.com", "admin@company.org"]
   */
  allowUsers?: string[];
  /**
   * Allow loopback proxy sources (127.0.0.1, ::1) in trusted-proxy mode.
   * Default false; enable only when a same-host reverse proxy is the intended
   * trust boundary and direct Gateway access is otherwise locked down.
   */
  allowLoopback?: boolean;
};
type GatewayAuthConfig = {
  /** Authentication mode for Gateway connections. Defaults to token when unset. */mode?: GatewayAuthMode; /** Shared token for token mode (plaintext or SecretRef). */
  token?: SecretInput; /** Shared password for password mode (consider env instead). */
  password?: SecretInput; /** Allow Tailscale identity headers when serve mode is enabled. */
  allowTailscale?: boolean; /** Rate-limit configuration for failed authentication attempts. */
  rateLimit?: GatewayAuthRateLimitConfig;
  /**
   * Configuration for trusted-proxy auth mode.
   * Required when mode is "trusted-proxy".
   */
  trustedProxy?: GatewayTrustedProxyConfig;
};
type GatewayAuthRateLimitConfig = {
  /** Maximum failed attempts per IP before blocking.  @default 10 */maxAttempts?: number; /** Sliding window duration in milliseconds.  @default 60000 (1 min) */
  windowMs?: number; /** Lockout duration in milliseconds after the limit is exceeded.  @default 300000 (5 min) */
  lockoutMs?: number; /** Exempt localhost/loopback addresses from auth rate limiting.  @default true */
  exemptLoopback?: boolean;
};
type GatewayTailscaleMode = "off" | "serve" | "funnel";
type GatewayTailscaleConfig = {
  /** Tailscale exposure mode for the Gateway control UI. */mode?: GatewayTailscaleMode; /** Reset serve/funnel configuration on shutdown. */
  resetOnExit?: boolean;
  /**
   * When `mode="serve"` and an externally configured Tailscale Funnel route
   * already covers the gateway port, skip re-applying `tailscale serve` on
   * startup. Lets operators manage Funnel exposure outside OpenClaw without
   * losing it across gateway restarts.
   */
  preserveFunnel?: boolean;
};
type GatewayRemoteConfig = {
  /** Whether remote gateway surfaces are enabled. Default: true when absent. */enabled?: boolean; /** Remote Gateway WebSocket URL (ws:// or wss://). */
  url?: string; /** Transport for macOS remote connections (ssh tunnel or direct WS). */
  transport?: "ssh" | "direct"; /** Gateway port on the remote SSH host. Defaults to 18789. */
  remotePort?: number; /** Token for remote auth (when the gateway requires token auth). */
  token?: SecretInput; /** Password for remote auth (when the gateway requires password auth). */
  password?: SecretInput; /** Expected TLS certificate fingerprint (sha256) for remote gateways. */
  tlsFingerprint?: string; /** SSH target for tunneling remote Gateway (user@host). */
  sshTarget?: string; /** SSH identity file path for tunneling remote Gateway. */
  sshIdentity?: string;
};
type GatewayReloadMode = "off" | "restart" | "hot" | "hybrid";
type GatewayReloadConfig = {
  /** Reload strategy for config changes (default: hybrid). */mode?: GatewayReloadMode; /** Debounce window for config reloads (ms). Default: 300. */
  debounceMs?: number;
  /**
   * Optional maximum time (ms) to wait for in-flight operations to complete
   * before forcing a restart. Absent uses the gateway's default bounded wait;
   * 0 waits indefinitely and logs periodic still-pending warnings.
   * Lower positive values risk aborting active subagent LLM calls.
   * @see https://github.com/openclaw/openclaw/issues/65485
   */
  deferralTimeoutMs?: number;
};
type GatewayHttpChatCompletionsConfig = {
  /**
   * If false, the Gateway will not serve `POST /v1/chat/completions`.
   * Default: false when absent.
   */
  enabled?: boolean;
  /**
   * Max request body size in bytes for `/v1/chat/completions`.
   * Default: 20MB.
   */
  maxBodyBytes?: number;
  /**
   * Max number of `image_url` parts processed from the latest user message.
   * Default: 8.
   */
  maxImageParts?: number;
  /**
   * Max cumulative decoded image bytes for all `image_url` parts in one request.
   * Default: 20MB.
   */
  maxTotalImageBytes?: number; /** Image input controls for `image_url` parts. */
  images?: GatewayHttpChatCompletionsImagesConfig;
};
type GatewayHttpChatCompletionsImagesConfig = {
  /** Allow URL fetches for `image_url` parts. Default: false. */allowUrl?: boolean;
  /**
   * Optional hostname allowlist for URL fetches.
   * Supports exact hosts and `*.example.com` wildcards.
   */
  urlAllowlist?: string[]; /** Allowed MIME types (case-insensitive). */
  allowedMimes?: string[]; /** Max bytes per image. Default: 10MB. */
  maxBytes?: number; /** Max redirects when fetching a URL. Default: 3. */
  maxRedirects?: number; /** Fetch timeout in ms. Default: 10s. */
  timeoutMs?: number;
};
type GatewayHttpResponsesConfig = {
  /**
   * If false, the Gateway will not serve `POST /v1/responses` (OpenResponses API).
   * Default: false when absent.
   */
  enabled?: boolean;
  /**
   * Max request body size in bytes for `/v1/responses`.
   * Default: 20MB.
   */
  maxBodyBytes?: number;
  /**
   * Max number of URL-based `input_file` + `input_image` parts per request.
   * Default: 8.
   */
  maxUrlParts?: number; /** File inputs (input_file). */
  files?: GatewayHttpResponsesFilesConfig; /** Image inputs (input_image). */
  images?: GatewayHttpResponsesImagesConfig;
};
type GatewayHttpResponsesFilesConfig = {
  /** Allow URL fetches for input_file. Default: true. */allowUrl?: boolean;
  /**
   * Optional hostname allowlist for URL fetches.
   * Supports exact hosts and `*.example.com` wildcards.
   */
  urlAllowlist?: string[]; /** Allowed MIME types (case-insensitive). */
  allowedMimes?: string[]; /** Max bytes per file. Default: 5MB. */
  maxBytes?: number; /** Max decoded characters per file. Default: 200k. */
  maxChars?: number; /** Max redirects when fetching a URL. Default: 3. */
  maxRedirects?: number; /** Fetch timeout in ms. Default: 10s. */
  timeoutMs?: number; /** PDF handling (application/pdf). */
  pdf?: GatewayHttpResponsesPdfConfig;
};
type GatewayHttpResponsesPdfConfig = {
  /** Max pages to parse/render. Default: 4. */maxPages?: number; /** Max pixels per rendered page. Default: 4M. */
  maxPixels?: number; /** Minimum extracted text length to skip rasterization. Default: 200 chars. */
  minTextChars?: number;
};
type GatewayHttpResponsesImagesConfig = {
  /** Allow URL fetches for input_image. Default: true. */allowUrl?: boolean;
  /**
   * Optional hostname allowlist for URL fetches.
   * Supports exact hosts and `*.example.com` wildcards.
   */
  urlAllowlist?: string[]; /** Allowed MIME types (case-insensitive). */
  allowedMimes?: string[]; /** Max bytes per image. Default: 10MB. */
  maxBytes?: number; /** Max redirects when fetching a URL. Default: 3. */
  maxRedirects?: number; /** Fetch timeout in ms. Default: 10s. */
  timeoutMs?: number;
};
type GatewayHttpEndpointsConfig = {
  chatCompletions?: GatewayHttpChatCompletionsConfig;
  responses?: GatewayHttpResponsesConfig;
};
type GatewayHttpSecurityHeadersConfig = {
  /**
   * Value for the Strict-Transport-Security response header.
   * Set to false to disable explicitly.
   *
   * Example: "max-age=31536000; includeSubDomains"
   */
  strictTransportSecurity?: string | false;
};
type GatewayHttpConfig = {
  endpoints?: GatewayHttpEndpointsConfig;
  securityHeaders?: GatewayHttpSecurityHeadersConfig;
};
type GatewayPushApnsRelayConfig = {
  /** Base HTTPS URL for the external iOS APNs relay service. */baseUrl?: string; /** Timeout in milliseconds for relay send requests (default: 10000). */
  timeoutMs?: number;
};
type GatewayPushApnsConfig = {
  relay?: GatewayPushApnsRelayConfig;
};
type GatewayPushConfig = {
  apns?: GatewayPushApnsConfig;
};
type GatewayNodePairingConfig = {
  /**
   * Opt-in CIDR/IP allowlist for auto-approving first-time node-role pairing.
   * Only applies to fresh node pairing requests with no requested scopes.
   * Default: unset/disabled.
   */
  autoApproveCidrs?: string[];
};
type GatewayNodesConfig = {
  /** Browser routing policy for node-hosted browser proxies. */browser?: {
    /** Routing mode (default: auto). */mode?: "auto" | "manual" | "off"; /** Pin to a specific node id/name (optional). */
    node?: string;
  }; /** Pairing policy for node-role gateway clients. */
  pairing?: GatewayNodePairingConfig; /** Additional node.invoke commands to allow on the gateway. */
  allowCommands?: string[]; /** Commands to deny even if they appear in the defaults or node claims. */
  denyCommands?: string[];
};
type GatewayToolsConfig = {
  /** Tools to deny via gateway HTTP /tools/invoke (extends defaults). */deny?: string[]; /** Tools to explicitly allow (removes from default deny list). */
  allow?: string[];
};
type GatewayWebchatConfig = {
  /** Max characters per text field in chat.history responses before truncation (default: 12000). */chatHistoryMaxChars?: number;
};
type GatewayConfig = {
  /** Single multiplexed port for Gateway WS + HTTP (default: 18789). */port?: number;
  /**
   * Explicit gateway mode. When set to "remote", local gateway start is disabled.
   * When set to "local", the CLI may start the gateway locally.
   */
  mode?: "local" | "remote";
  /**
   * Bind address policy for the Gateway WebSocket + Control UI HTTP server.
   * - auto: Loopback (127.0.0.1) if available, else 0.0.0.0 (fallback to all interfaces)
   * - lan: 0.0.0.0 (all interfaces, no fallback)
   * - loopback: 127.0.0.1 (local-only)
   * - tailnet: Tailnet IPv4 if available (100.64.0.0/10), else loopback
   * - custom: User-specified IP, fallback to 0.0.0.0 if unavailable (requires customBindHost)
   * Default: loopback (127.0.0.1).
   */
  bind?: GatewayBindMode; /** Custom IP address for bind="custom" mode. Fallback: 0.0.0.0. */
  customBindHost?: string;
  controlUi?: GatewayControlUiConfig;
  auth?: GatewayAuthConfig;
  tailscale?: GatewayTailscaleConfig;
  remote?: GatewayRemoteConfig;
  reload?: GatewayReloadConfig;
  tls?: GatewayTlsConfig;
  http?: GatewayHttpConfig;
  push?: GatewayPushConfig;
  nodes?: GatewayNodesConfig;
  /**
   * IPs of trusted reverse proxies (e.g. Traefik, nginx). When a connection
   * arrives from one of these IPs, the Gateway trusts `x-forwarded-for`
   * to determine the client IP for local pairing and HTTP checks.
   */
  trustedProxies?: string[];
  /**
   * Allow `x-real-ip` as a fallback only when `x-forwarded-for` is missing.
   * Default: false (safer fail-closed behavior).
   */
  allowRealIpFallback?: boolean; /** Tool access restrictions for HTTP /tools/invoke endpoint. */
  tools?: GatewayToolsConfig; /** WebChat display/history settings. */
  webchat?: GatewayWebchatConfig;
  /**
   * Pre-auth Gateway WebSocket handshake timeout in milliseconds.
   * Env var OPENCLAW_HANDSHAKE_TIMEOUT_MS takes precedence. Default: 15000.
   */
  handshakeTimeoutMs?: number;
  /**
   * Channel health monitor interval in minutes.
   * Periodically checks channel health and restarts unhealthy channels.
   * Set to 0 to disable. Default: 5.
   */
  channelHealthCheckMinutes?: number;
  /**
   * Stale transport-activity threshold in minutes for the channel health monitor.
   * A connected channel that reports no provider-proven transport activity for
   * this duration is treated as a stale socket and restarted. Default: 30.
   */
  channelStaleEventThresholdMinutes?: number;
  /**
   * Maximum number of health-monitor-initiated channel restarts per hour.
   * Once this limit is reached, the monitor skips further restarts until
   * the rolling window expires. Default: 10.
   */
  channelMaxRestartsPerHour?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.installs.d.ts
type InstallRecordBase = {
  source: "npm" | "archive" | "path" | "clawhub" | "git";
  spec?: string;
  sourcePath?: string;
  installPath?: string;
  version?: string;
  resolvedName?: string;
  resolvedVersion?: string;
  resolvedSpec?: string;
  integrity?: string;
  shasum?: string;
  resolvedAt?: string;
  installedAt?: string;
  clawhubUrl?: string;
  clawhubPackage?: string;
  clawhubFamily?: "code-plugin" | "bundle-plugin";
  clawhubChannel?: "official" | "community" | "private";
  artifactKind?: "legacy-zip" | "npm-pack";
  artifactFormat?: "zip" | "tgz";
  npmIntegrity?: string;
  npmShasum?: string;
  npmTarballName?: string;
  clawpackSha256?: string;
  clawpackSpecVersion?: number;
  clawpackManifestSha256?: string;
  clawpackSize?: number;
  gitUrl?: string;
  gitRef?: string;
  gitCommit?: string;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.hooks.d.ts
type HookMappingMatch = {
  path?: string;
  source?: string;
};
type HookMappingTransform = {
  module: string;
  export?: string;
};
type HookMappingConfig = {
  id?: string;
  match?: HookMappingMatch;
  action?: "wake" | "agent";
  wakeMode?: "now" | "next-heartbeat";
  name?: string; /** Route this hook to a specific agent (unknown ids fall back to the default agent). */
  agentId?: string;
  sessionKey?: string;
  messageTemplate?: string;
  textTemplate?: string;
  deliver?: boolean; /** DANGEROUS: Disable external content safety wrapping for this hook. */
  allowUnsafeExternalContent?: boolean;
  /**
   * "last" or any runtime channel id (including plugin channels).
   * Validation against configured/registered channels happens in gateway hooks runtime.
   */
  channel?: "last" | (string & {});
  to?: string; /** Override model for this hook (provider/model or alias). */
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
  transform?: HookMappingTransform;
};
type HooksGmailTailscaleMode = "off" | "serve" | "funnel";
type HooksGmailConfig = {
  account?: string;
  label?: string;
  topic?: string;
  subscription?: string;
  pushToken?: string;
  hookUrl?: string;
  includeBody?: boolean;
  maxBytes?: number;
  renewEveryMinutes?: number; /** DANGEROUS: Disable external content safety wrapping for Gmail hooks. */
  allowUnsafeExternalContent?: boolean;
  serve?: {
    bind?: string;
    port?: number;
    path?: string;
  };
  tailscale?: {
    mode?: HooksGmailTailscaleMode;
    path?: string; /** Optional tailscale serve/funnel target (port, host:port, or full URL). */
    target?: string;
  }; /** Optional model override for Gmail hook processing (provider/model or alias). */
  model?: string; /** Optional thinking level override for Gmail hook processing. */
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
};
type HookConfig = {
  enabled?: boolean;
  env?: Record<string, string>;
  [key: string]: unknown;
};
type HookInstallRecord = InstallRecordBase & {
  hooks?: string[];
};
type InternalHooksConfig = {
  /** Enable hooks system */enabled?: boolean; /** Per-hook configuration overrides */
  entries?: Record<string, HookConfig>; /** Load configuration */
  load?: {
    /** Additional hook directories to scan */extraDirs?: string[];
  }; /** Install records for hook packs or hooks */
  installs?: Record<string, HookInstallRecord>;
};
type HooksConfig = {
  enabled?: boolean;
  path?: string;
  token?: string;
  /**
   * Default session key used for hook agent runs when no request/mapping session key is used.
   * If omitted, OpenClaw generates `hook:<uuid>` per request.
   */
  defaultSessionKey?: string;
  /**
   * Allow `sessionKey` from external `/hooks/agent` request payloads.
   * Default: false.
   */
  allowRequestSessionKey?: boolean;
  /**
   * Optional allowlist for explicit session keys (request + mapping). Example: ["hook:"].
   * Empty/omitted means no prefix restriction.
   */
  allowedSessionKeyPrefixes?: string[];
  /**
   * Restrict explicit hook `agentId` routing to these agent ids.
   * Omit or include `*` to allow any agent. Set `[]` to deny all explicit `agentId` routing.
   */
  allowedAgentIds?: string[];
  maxBodyBytes?: number;
  presets?: string[];
  transformsDir?: string;
  mappings?: HookMappingConfig[];
  gmail?: HooksGmailConfig; /** Internal agent event hooks */
  internal?: InternalHooksConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.mcp.d.ts
type McpCodexToolApprovalMode = "auto" | "prompt" | "approve";
type McpServerCodexConfig = {
  /** OpenClaw agent ids that should receive this server in Codex app-server threads. */agents?: string[]; /** Codex MCP tool approval mode emitted as default_tools_approval_mode. */
  defaultToolsApprovalMode?: McpCodexToolApprovalMode; /** Codex-native spelling accepted for operator-authored config. */
  default_tools_approval_mode?: McpCodexToolApprovalMode;
};
type McpServerConfig = {
  /** Stdio transport: command to spawn. */command?: string; /** Stdio transport: arguments for the command. */
  args?: string[]; /** Environment variables passed to the server process (stdio only). */
  env?: Record<string, string | number | boolean>; /** Working directory for stdio server. */
  cwd?: string; /** Alias for cwd. */
  workingDirectory?: string; /** HTTP transport: URL of the remote MCP server (http or https). */
  url?: string; /** HTTP transport type for remote MCP servers. */
  transport?: "sse" | "streamable-http"; /** HTTP transport: extra HTTP headers sent with every request. */
  headers?: Record<string, string | number | boolean>; /** Optional connection timeout in milliseconds. */
  connectionTimeoutMs?: number; /** Codex-specific projection controls for Codex app-server/runtime config. */
  codex?: McpServerCodexConfig;
  [key: string]: unknown;
};
type McpConfig = {
  /** Named MCP server definitions managed by OpenClaw. */servers?: Record<string, McpServerConfig>;
  /**
   * Idle TTL for session-scoped bundled MCP runtimes, in milliseconds.
   *
   * Defaults to 10 minutes. Set to 0 to disable idle eviction.
   */
  sessionIdleTtlMs?: number;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.models.d.ts
declare const MODEL_APIS: readonly ["openai-completions", "openai-responses", "openai-codex-responses", "anthropic-messages", "google-generative-ai", "github-copilot", "bedrock-converse-stream", "ollama", "azure-openai-responses"];
type ModelApi = (typeof MODEL_APIS)[number];
type SupportedOpenAICompatFields = Pick<OpenAICompletionsCompat, "supportsStore" | "supportsDeveloperRole" | "supportsReasoningEffort" | "supportsUsageInStreaming" | "supportsStrictMode" | "maxTokensField" | "requiresToolResultName" | "requiresAssistantAfterToolResult" | "requiresThinkingAsText" | "openRouterRouting" | "vercelGatewayRouting" | "zaiToolStream" | "cacheControlFormat" | "sendSessionAffinityHeaders" | "supportsLongCacheRetention">;
type SupportedOpenAIResponsesCompatFields = Pick<OpenAIResponsesCompat, "sendSessionIdHeader" | "supportsLongCacheRetention">;
type SupportedAnthropicMessagesCompatFields = Pick<AnthropicMessagesCompat, "supportsEagerToolInputStreaming" | "supportsLongCacheRetention">;
type SupportedThinkingFormat = NonNullable<OpenAICompletionsCompat["thinkingFormat"]> | "deepseek" | "openrouter" | "together";
type ModelCompatConfig = SupportedOpenAICompatFields & SupportedOpenAIResponsesCompatFields & SupportedAnthropicMessagesCompatFields & {
  thinkingFormat?: SupportedThinkingFormat;
  supportedReasoningEfforts?: string[];
  reasoningEffortMap?: Record<string, string>;
  visibleReasoningDetailTypes?: string[];
  supportsTools?: boolean;
  supportsPromptCacheKey?: boolean;
  requiresStringContent?: boolean;
  strictMessageKeys?: boolean;
  toolSchemaProfile?: string;
  unsupportedToolSchemaKeywords?: string[];
  nativeWebSearchTool?: boolean;
  toolCallArgumentsEncoding?: string;
  requiresMistralToolIds?: boolean;
  requiresOpenAiAnthropicToolPayload?: boolean;
};
type ModelProviderAuthMode = "api-key" | "aws-sdk" | "oauth" | "token";
type ModelProviderLocalServiceConfig = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  healthUrl?: string;
  readyTimeoutMs?: number;
  idleStopMs?: number;
};
type ModelDefinitionConfig = {
  id: string;
  name: string;
  api?: ModelApi;
  baseUrl?: string;
  reasoning: boolean;
  input: Array<"text" | "image" | "video" | "audio">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    /** Optional tiered pricing.  When present, cost calculation uses
     *  per-tier rates instead of the flat rates above.  Prices are
     *  USD / million tokens; ranges are half-open `[start, end)` on the
     *  input-token axis. */
    tieredPricing?: Array<{
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number; /** Bounded tier: `[start, end)`. Open-ended top tier: `[start]` (normalized to `[start, Infinity]` at load time). */
      range: [number, number] | [number];
    }>;
  };
  contextWindow: number;
  /**
   * Optional effective runtime cap used for compaction/session budgeting.
   * Keeps provider/native contextWindow metadata intact while letting configs
   * prefer a smaller practical window.
   */
  contextTokens?: number;
  maxTokens: number; /** Provider-specific request/runtime parameters passed through to provider plugins. */
  params?: Record<string, unknown>; /** Optional agent execution runtime override for this provider/model pair. */
  agentRuntime?: AgentRuntimePolicyConfig;
  headers?: Record<string, string>;
  compat?: ModelCompatConfig;
  metadataSource?: "models-add";
};
type ModelProviderConfig = {
  baseUrl: string;
  apiKey?: SecretInput;
  auth?: ModelProviderAuthMode;
  api?: ModelApi;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  injectNumCtxForOpenAICompat?: boolean; /** Provider-specific runtime parameters interpreted by provider plugins. */
  params?: Record<string, unknown>; /** Optional default agent execution runtime for models under this provider. */
  agentRuntime?: AgentRuntimePolicyConfig; /** Optional local service to start before calling this provider. */
  localService?: ModelProviderLocalServiceConfig;
  headers?: Record<string, SecretInput>;
  authHeader?: boolean;
  request?: ConfiguredModelProviderRequest;
  models: ModelDefinitionConfig[];
};
type BedrockDiscoveryConfig = {
  enabled?: boolean;
  region?: string;
  providerFilter?: string[];
  refreshInterval?: number;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
};
type DiscoveryToggleConfig = {
  enabled?: boolean;
};
type ModelPricingConfig = {
  enabled?: boolean;
};
type ModelsConfig = {
  mode?: "merge" | "replace";
  providers?: Record<string, ModelProviderConfig>;
  pricing?: ModelPricingConfig;
  /**
   * @deprecated Legacy compat alias. Kept so doctor/runtime fallbacks can read
   * older configs until migration completes.
   */
  bedrockDiscovery?: BedrockDiscoveryConfig;
  /**
   * @deprecated Legacy compat alias. Kept so doctor/runtime fallbacks can read
   * older configs until migration completes.
   */
  copilotDiscovery?: DiscoveryToggleConfig;
  /**
   * @deprecated Legacy compat alias. Kept so doctor/runtime fallbacks can read
   * older configs until migration completes.
   */
  huggingfaceDiscovery?: DiscoveryToggleConfig;
  /**
   * @deprecated Legacy compat alias. Kept so doctor/runtime fallbacks can read
   * older configs until migration completes.
   */
  ollamaDiscovery?: DiscoveryToggleConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.node-host.d.ts
type NodeHostBrowserProxyConfig = {
  /** Enable the browser proxy on the node host (default: true). */enabled?: boolean; /** Optional allowlist of profile names exposed via the proxy; when set, create/delete profile routes are blocked on the proxy surface. */
  allowProfiles?: string[];
};
type NodeHostConfig = {
  /** Browser proxy settings for node hosts. */browserProxy?: NodeHostBrowserProxyConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.plugins.d.ts
type PluginEntryConfig = {
  enabled?: boolean;
  hooks?: {
    /** Controls prompt mutation via before_prompt_build and prompt fields from legacy before_agent_start. */allowPromptInjection?: boolean;
    /**
     * Controls access to raw conversation content from conversation hooks including
     * before_agent_run, before_model_resolve, before_agent_reply, llm_input, llm_output,
     * before_agent_finalize, and agent_end.
     * Non-bundled plugins must opt in explicitly; bundled plugins stay allowed unless disabled.
     */
    allowConversationAccess?: boolean; /** Default timeout in milliseconds for this plugin's typed hooks. */
    timeoutMs?: number; /** Per typed-hook timeout overrides in milliseconds. */
    timeouts?: Record<string, number>;
  };
  subagent?: {
    /** Explicitly allow this plugin to request per-run provider/model overrides for subagent runs. */allowModelOverride?: boolean;
    /**
     * Allowed override targets as canonical provider/model refs.
     * Use "*" to explicitly allow any model for this plugin.
     */
    allowedModels?: string[];
  };
  llm?: {
    /** Explicitly allow this plugin to request a model override for api.runtime.llm.complete. */allowModelOverride?: boolean;
    /**
     * Allowed completion model override targets as canonical provider/model refs.
     * Use "*" to explicitly allow any model for this plugin.
     */
    allowedModels?: string[]; /** Explicitly allow this plugin to run completions against a non-default agent id. */
    allowAgentIdOverride?: boolean;
  };
  config?: Record<string, unknown>;
};
type PluginSlotsConfig = {
  /** Select which plugin owns the memory slot ("none" disables memory plugins). */memory?: string; /** Select which plugin owns the context-engine slot. */
  contextEngine?: string;
};
type PluginsLoadConfig = {
  /** Additional plugin/extension paths to load. */paths?: string[];
};
type PluginInstallRecord = Omit<InstallRecordBase, "source"> & {
  source: InstallRecordBase["source"] | "marketplace";
  marketplaceName?: string;
  marketplaceSource?: string;
  marketplacePlugin?: string;
};
type PluginsConfig = {
  /** Enable or disable plugin loading. */enabled?: boolean; /** Optional plugin allowlist (plugin ids). */
  allow?: string[]; /** Optional plugin denylist (plugin ids). */
  deny?: string[];
  /**
   * Controls how bundled plugins participate in runtime provider discovery when
   * `allow` is configured.
   *
   * - `"allowlist"` (default): bundled provider plugins are gated by `allow`
   *   and `entries.<id>.enabled` like third-party plugins.
   * - `"compat"`: legacy mode for migrated configs; bundled provider plugins
   *   can be force-loaded regardless of the allowlist.
   */
  bundledDiscovery?: "compat" | "allowlist";
  load?: PluginsLoadConfig;
  slots?: PluginSlotsConfig;
  entries?: Record<string, PluginEntryConfig>;
  /**
   * Internal transient carrier for plugin install records during command flows.
   * This is intentionally omitted from the config schema and must not be
   * persisted to openclaw.json.
   */
  installs?: Record<string, PluginInstallRecord>;
};
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema.d.cts
type _JSONSchema = boolean | JSONSchema;
type JSONSchema = {
  [k: string]: unknown;
  $schema?: "https://json-schema.org/draft/2020-12/schema" | "http://json-schema.org/draft-07/schema#" | "http://json-schema.org/draft-04/schema#";
  $id?: string;
  $anchor?: string;
  $ref?: string;
  $dynamicRef?: string;
  $dynamicAnchor?: string;
  $vocabulary?: Record<string, boolean>;
  $comment?: string;
  $defs?: Record<string, JSONSchema>;
  type?: "object" | "array" | "string" | "number" | "boolean" | "null" | "integer";
  additionalItems?: _JSONSchema;
  unevaluatedItems?: _JSONSchema;
  prefixItems?: _JSONSchema[];
  items?: _JSONSchema | _JSONSchema[];
  contains?: _JSONSchema;
  additionalProperties?: _JSONSchema;
  unevaluatedProperties?: _JSONSchema;
  properties?: Record<string, _JSONSchema>;
  patternProperties?: Record<string, _JSONSchema>;
  dependentSchemas?: Record<string, _JSONSchema>;
  propertyNames?: _JSONSchema;
  if?: _JSONSchema;
  then?: _JSONSchema;
  else?: _JSONSchema;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: _JSONSchema;
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number | boolean;
  minimum?: number;
  exclusiveMinimum?: number | boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  maxContains?: number;
  minContains?: number;
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  dependentRequired?: Record<string, string[]>;
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  id?: string;
  title?: string;
  description?: string;
  default?: unknown;
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  nullable?: boolean;
  examples?: unknown[];
  format?: string;
  contentMediaType?: string;
  contentEncoding?: string;
  contentSchema?: JSONSchema;
  _prefault?: unknown;
};
type BaseSchema = JSONSchema;
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/standard-schema.d.cts
/** The Standard interface. */
interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}
declare namespace StandardTypedV1 {
  /** The Standard properties interface. */
  interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
/** The Standard Schema interface. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    /** Validates unknown input values. */
    readonly validate: (value: unknown, options?: StandardSchemaV1.Options | undefined) => Result<Output> | Promise<Result<Output>>;
  }
  /** The result interface of the validate function. */
  type Result<Output> = SuccessResult<Output> | FailureResult;
  /** The result interface if validation succeeds. */
  interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** The absence of issues indicates success. */
    readonly issues?: undefined;
  }
  interface Options {
    /** Implicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  /** The result interface if validation fails. */
  interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }
  /** The issue interface of the failure output. */
  interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  /** The path segment interface of the issue. */
  interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<Input, Output> {}
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}
/** The Standard JSON Schema interface. */
interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  /** The Standard JSON Schema properties. */
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>;
}
declare namespace StandardJSONSchemaV1 {
  /** The Standard JSON Schema properties interface. */
  interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<Input, Output> {
    /** Methods for generating the input/output JSON Schema. */
    readonly jsonSchema: Converter;
  }
  /** The Standard JSON Schema converter interface. */
  interface Converter {
    /** Converts the input type to JSON Schema. May throw if conversion is not supported. */
    readonly input: (options: StandardJSONSchemaV1.Options) => Record<string, unknown>;
    /** Converts the output type to JSON Schema. May throw if conversion is not supported. */
    readonly output: (options: StandardJSONSchemaV1.Options) => Record<string, unknown>;
  }
  /** The target version of the generated JSON Schema.
   *
   * It is *strongly recommended* that implementers support `"draft-2020-12"` and `"draft-07"`, as they are both in wide use.
   *
   * The `"openapi-3.0"` target is intended as a standardized specifier for OpenAPI 3.0 which is a superset of JSON Schema `"draft-04"`.
   *
   * All other targets can be implemented on a best-effort basis. Libraries should throw if they don't support a specified target.
   */
  type Target = "draft-2020-12" | "draft-07" | "openapi-3.0" | ({} & string);
  /** The options for the input/output methods. */
  interface Options {
    /** Specifies the target version of the generated JSON Schema. Support for all versions is on a best-effort basis. If a given version is not supported, the library should throw. */
    readonly target: Target;
    /** Implicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
  /** The Standard types interface. */
  interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<Input, Output> {}
  /** Infers the input type of a Standard. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;
  /** Infers the output type of a Standard. */
  type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}
interface StandardSchemaWithJSONProps<Input = unknown, Output = Input> extends StandardSchemaV1.Props<Input, Output>, StandardJSONSchemaV1.Props<Input, Output> {}
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.d.cts
declare const $output: unique symbol;
type $output = typeof $output;
declare const $input: unique symbol;
type $input = typeof $input;
type $replace<Meta, S extends $ZodType> = Meta extends $output ? output<S> : Meta extends $input ? input<S> : Meta extends (infer M)[] ? $replace<M, S>[] : Meta extends ((...args: infer P) => infer R) ? (...args: { [K in keyof P]: $replace<P[K], S> }) => $replace<R, S> : Meta extends object ? { [K in keyof Meta]: $replace<Meta[K], S> } : Meta;
type MetadataType = object | undefined;
declare class $ZodRegistry<Meta extends MetadataType = MetadataType, Schema extends $ZodType = $ZodType> {
  _meta: Meta;
  _schema: Schema;
  _map: WeakMap<Schema, $replace<Meta, Schema>>;
  _idmap: Map<string, Schema>;
  add<S extends Schema>(schema: S, ..._meta: undefined extends Meta ? [$replace<Meta, S>?] : [$replace<Meta, S>]): this;
  clear(): this;
  remove(schema: Schema): this;
  get<S extends Schema>(schema: S): $replace<Meta, S> | undefined;
  has(schema: Schema): boolean;
}
interface JSONSchemaMeta {
  id?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  deprecated?: boolean | undefined;
  [k: string]: unknown;
}
interface GlobalMeta extends JSONSchemaMeta {}
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.d.cts
type Processor<T extends $ZodType = $ZodType> = (schema: T, ctx: ToJSONSchemaContext, json: BaseSchema, params: ProcessParams) => void;
interface JSONSchemaGeneratorParams {
  processors: Record<string, Processor>;
  /** A registry used to look up metadata for each schema. Any schema with an `id` property will be extracted as a $def.
   *  @default globalRegistry */
  metadata?: $ZodRegistry<Record<string, any>>;
  /** The JSON Schema version to target.
   * - `"draft-2020-12"` — Default. JSON Schema Draft 2020-12
   * - `"draft-07"` — JSON Schema Draft 7
   * - `"draft-04"` — JSON Schema Draft 4
   * - `"openapi-3.0"` — OpenAPI 3.0 Schema Object */
  target?: "draft-04" | "draft-07" | "draft-2020-12" | "openapi-3.0" | ({} & string) | undefined;
  /** How to handle unrepresentable types.
   * - `"throw"` — Default. Unrepresentable types throw an error
   * - `"any"` — Unrepresentable types become `{}` */
  unrepresentable?: "throw" | "any";
  /** Arbitrary custom logic that can be used to modify the generated JSON Schema. */
  override?: (ctx: {
    zodSchema: $ZodTypes;
    jsonSchema: BaseSchema;
    path: (string | number)[];
  }) => void;
  /** Whether to extract the `"input"` or `"output"` type. Relevant to transforms, defaults, coerced primitives, etc.
   * - `"output"` — Default. Convert the output schema.
   * - `"input"` — Convert the input schema. */
  io?: "input" | "output";
  cycles?: "ref" | "throw";
  reused?: "ref" | "inline";
  external?: {
    registry: $ZodRegistry<{
      id?: string | undefined;
    }>;
    uri?: ((id: string) => string) | undefined;
    defs: Record<string, BaseSchema>;
  } | undefined;
}
/**
 * Parameters for the toJSONSchema function.
 */
type ToJSONSchemaParams = Omit<JSONSchemaGeneratorParams, "processors" | "external">;
interface ProcessParams {
  schemaPath: $ZodType[];
  path: (string | number)[];
}
interface Seen {
  /** JSON Schema result for this Zod schema */
  schema: BaseSchema;
  /** A cached version of the schema that doesn't get overwritten during ref resolution */
  def?: BaseSchema;
  defId?: string | undefined;
  /** Number of times this schema was encountered during traversal */
  count: number;
  /** Cycle path */
  cycle?: (string | number)[] | undefined;
  isParent?: boolean | undefined;
  /** Schema to inherit JSON Schema properties from (set by processor for wrappers) */
  ref?: $ZodType | null;
  /** JSON Schema property path for this schema */
  path?: (string | number)[] | undefined;
}
interface ToJSONSchemaContext {
  processors: Record<string, Processor>;
  metadataRegistry: $ZodRegistry<Record<string, any>>;
  target: "draft-04" | "draft-07" | "draft-2020-12" | "openapi-3.0" | ({} & string);
  unrepresentable: "throw" | "any";
  override: (ctx: {
    zodSchema: $ZodType;
    jsonSchema: BaseSchema;
    path: (string | number)[];
  }) => void;
  io: "input" | "output";
  counter: number;
  seen: Map<$ZodType, Seen>;
  cycles: "ref" | "throw";
  reused: "ref" | "inline";
  external?: {
    registry: $ZodRegistry<{
      id?: string | undefined;
    }>;
    uri?: ((id: string) => string) | undefined;
    defs: Record<string, BaseSchema>;
  } | undefined;
}
type ZodStandardSchemaWithJSON$1<T> = StandardSchemaWithJSONProps<input<T>, output<T>>;
interface ZodStandardJSONSchemaPayload<T> extends BaseSchema {
  "~standard": ZodStandardSchemaWithJSON$1<T>;
}
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.d.cts
type JWTAlgorithm = "HS256" | "HS384" | "HS512" | "RS256" | "RS384" | "RS512" | "ES256" | "ES384" | "ES512" | "PS256" | "PS384" | "PS512" | "EdDSA" | (string & {});
type MimeTypes = "application/json" | "application/xml" | "application/x-www-form-urlencoded" | "application/javascript" | "application/pdf" | "application/zip" | "application/vnd.ms-excel" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/msword" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.ms-powerpoint" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "application/octet-stream" | "application/graphql" | "text/html" | "text/plain" | "text/css" | "text/javascript" | "text/csv" | "image/png" | "image/jpeg" | "image/gif" | "image/svg+xml" | "image/webp" | "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/webm" | "video/mp4" | "video/webm" | "video/ogg" | "font/woff" | "font/woff2" | "font/ttf" | "font/otf" | "multipart/form-data" | (string & {});
type IsAny<T> = 0 extends 1 & T ? true : false;
type Omit$1<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type MakePartial<T, K extends keyof T> = Omit$1<T, K> & InexactPartial<Pick<T, K>>;
type NoUndefined<T> = T extends undefined ? never : T;
type LoosePartial<T extends object> = InexactPartial<T> & {
  [k: string]: unknown;
};
type Mask<Keys extends PropertyKey> = { [K in Keys]?: true };
type Writeable<T> = { -readonly [P in keyof T]: T[P] } & {};
type InexactPartial<T> = { [P in keyof T]?: T[P] | undefined };
type BuiltIn = (((...args: any[]) => any) | (new (...args: any[]) => any)) | {
  readonly [Symbol.toStringTag]: string;
} | Date | Error | Generator | Promise<unknown> | RegExp;
type MakeReadonly<T> = T extends Map<infer K, infer V> ? ReadonlyMap<K, V> : T extends Set<infer V> ? ReadonlySet<V> : T extends [infer Head, ...infer Tail] ? readonly [Head, ...Tail] : T extends Array<infer V> ? ReadonlyArray<V> : T extends BuiltIn ? T : Readonly<T>;
type SomeObject = Record<PropertyKey, any>;
type Identity<T> = T;
type Flatten<T> = Identity<{ [k in keyof T]: T[k] }>;
type Prettify<T> = { [K in keyof T]: T[K] } & {};
type Extend<A extends SomeObject, B extends SomeObject> = Flatten<keyof A & keyof B extends never ? A & B : { [K in keyof A as K extends keyof B ? never : K]: A[K] } & { [K in keyof B]: B[K] }>;
type TupleItems = ReadonlyArray<SomeType>;
type AnyFunc = (...args: any[]) => any;
type MaybeAsync<T> = T | Promise<T>;
type EnumValue = string | number;
type EnumLike = Readonly<Record<string, EnumValue>>;
type ToEnum<T extends EnumValue> = Flatten<{ [k in T]: k }>;
type Literal = string | number | bigint | boolean | null | undefined;
type Primitive = string | number | symbol | bigint | boolean | null | undefined;
type HasLength = {
  length: number;
};
type PropValues = Record<string, Set<Primitive>>;
type PrimitiveSet = Set<Primitive>;
type EmptyToNever<T> = keyof T extends never ? never : T;
declare abstract class Class {
  constructor(..._args: any[]);
}
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.d.cts
declare const version: {
  readonly major: 4;
  readonly minor: 4;
  readonly patch: number;
};
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.d.cts
interface ParseContext<T extends $ZodIssueBase = never> {
  /** Customize error messages. */
  readonly error?: $ZodErrorMap<T>;
  /** Include the `input` field in issue objects. Default `false`. */
  readonly reportInput?: boolean;
  /** Skip eval-based fast path. Default `false`. */
  readonly jitless?: boolean;
}
/** @internal */
interface ParseContextInternal<T extends $ZodIssueBase = never> extends ParseContext<T> {
  readonly async?: boolean | undefined;
  readonly direction?: "forward" | "backward";
  readonly skipChecks?: boolean;
}
interface ParsePayload<T = unknown> {
  value: T;
  issues: $ZodRawIssue[];
  /** A way to mark a whole payload as aborted. Used in codecs/pipes. */
  aborted?: boolean;
  /** @internal Marks a value as a fallback that an outer wrapper (e.g.
   * $ZodOptional) may override with its own interpretation when input was
   * undefined. Set by $ZodCatch when catchValue substitutes and by every
   * $ZodTransform invocation. */
  fallback?: boolean | undefined;
}
type CheckFn<T> = (input: ParsePayload<T>) => MaybeAsync<void>;
interface $ZodTypeDef {
  type: "string" | "number" | "int" | "boolean" | "bigint" | "symbol" | "null" | "undefined" | "void" | "never" | "any" | "unknown" | "date" | "object" | "record" | "file" | "array" | "tuple" | "union" | "intersection" | "map" | "set" | "enum" | "literal" | "nullable" | "optional" | "nonoptional" | "success" | "transform" | "default" | "prefault" | "catch" | "nan" | "pipe" | "readonly" | "template_literal" | "promise" | "lazy" | "function" | "custom";
  error?: $ZodErrorMap<never> | undefined;
  checks?: $ZodCheck<never>[];
}
interface _$ZodTypeInternals {
  /** The `@zod/core` version of this schema */
  version: typeof version;
  /** Schema definition. */
  def: $ZodTypeDef;
  /** @internal Randomly generated ID for this schema. */
  /** @internal List of deferred initializers. */
  deferred: AnyFunc[] | undefined;
  /** @internal Parses input and runs all checks (refinements). */
  run(payload: ParsePayload<any>, ctx: ParseContextInternal): MaybeAsync<ParsePayload>;
  /** @internal Parses input, doesn't run checks. */
  parse(payload: ParsePayload<any>, ctx: ParseContextInternal): MaybeAsync<ParsePayload>;
  /** @internal  Stores identifiers for the set of traits implemented by this schema. */
  traits: Set<string>;
  /** @internal Indicates that a schema output type should be considered optional inside objects.
   * @default Required
   */
  /** @internal */
  optin?: "optional" | undefined;
  /** @internal */
  optout?: "optional" | undefined;
  /** @internal The set of literal values that will pass validation. Must be an exhaustive set. Used to determine optionality in z.record().
   *
   * Defined on: enum, const, literal, null, undefined
   * Passthrough: optional, nullable, branded, default, catch, pipe
   * Todo: unions?
   */
  values?: PrimitiveSet | undefined;
  /** Default value bubbled up from  */
  /** @internal A set of literal discriminators used for the fast path in discriminated unions. */
  propValues?: PropValues | undefined;
  /** @internal This flag indicates that a schema validation can be represented with a regular expression. Used to determine allowable schemas in z.templateLiteral(). */
  pattern: RegExp | undefined;
  /** @internal The constructor function of this schema. */
  constr: new (def: any) => $ZodType;
  /** @internal A catchall object for bag metadata related to this schema. Commonly modified by checks using `onattach`. */
  bag: Record<string, unknown>;
  /** @internal The set of issues this schema might throw during type checking. */
  isst: $ZodIssueBase;
  /** @internal Subject to change, not a public API. */
  processJSONSchema?: ((ctx: ToJSONSchemaContext, json: BaseSchema, params: ProcessParams) => void) | undefined;
  /** An optional method used to override `toJSONSchema` logic. */
  toJSONSchema?: () => unknown;
  /** @internal The parent of this schema. Only set during certain clone operations. */
  parent?: $ZodType | undefined;
}
/** @internal */
interface $ZodTypeInternals<out O = unknown, out I = unknown> extends _$ZodTypeInternals {
  /** @internal The inferred output type */
  output: O;
  /** @internal The inferred input type */
  input: I;
}
type $ZodStandardSchema<T> = StandardSchemaV1.Props<input<T>, output<T>>;
type SomeType = {
  _zod: _$ZodTypeInternals;
};
interface $ZodType<O = unknown, I = unknown, Internals extends $ZodTypeInternals<O, I> = $ZodTypeInternals<O, I>> {
  _zod: Internals;
  "~standard": $ZodStandardSchema<this>;
}
interface _$ZodType<T extends $ZodTypeInternals = $ZodTypeInternals> extends $ZodType<T["output"], T["input"], T> {}
declare const $ZodType: $constructor<$ZodType>;
interface $ZodStringDef extends $ZodTypeDef {
  type: "string";
  coerce?: boolean;
  checks?: $ZodCheck<string>[];
}
interface $ZodStringInternals<Input> extends $ZodTypeInternals<string, Input> {
  def: $ZodStringDef;
  /** @deprecated Internal API, use with caution (not deprecated) */
  pattern: RegExp;
  /** @deprecated Internal API, use with caution (not deprecated) */
  isst: $ZodIssueInvalidType;
  bag: LoosePartial<{
    minimum: number;
    maximum: number;
    patterns: Set<RegExp>;
    format: string;
    contentEncoding: string;
  }>;
}
interface $ZodString<Input = unknown> extends _$ZodType<$ZodStringInternals<Input>> {}
declare const $ZodString: $constructor<$ZodString>;
interface $ZodStringFormatDef<Format extends string = string> extends $ZodStringDef, $ZodCheckStringFormatDef<Format> {}
interface $ZodStringFormatInternals<Format extends string = string> extends $ZodStringInternals<string>, $ZodCheckStringFormatInternals {
  def: $ZodStringFormatDef<Format>;
}
interface $ZodStringFormat<Format extends string = string> extends $ZodType {
  _zod: $ZodStringFormatInternals<Format>;
}
declare const $ZodStringFormat: $constructor<$ZodStringFormat>;
interface $ZodGUIDInternals extends $ZodStringFormatInternals<"guid"> {}
interface $ZodGUID extends $ZodType {
  _zod: $ZodGUIDInternals;
}
declare const $ZodGUID: $constructor<$ZodGUID>;
interface $ZodUUIDDef extends $ZodStringFormatDef<"uuid"> {
  version?: "v1" | "v2" | "v3" | "v4" | "v5" | "v6" | "v7" | "v8";
}
interface $ZodUUIDInternals extends $ZodStringFormatInternals<"uuid"> {
  def: $ZodUUIDDef;
}
interface $ZodUUID extends $ZodType {
  _zod: $ZodUUIDInternals;
}
declare const $ZodUUID: $constructor<$ZodUUID>;
interface $ZodEmailInternals extends $ZodStringFormatInternals<"email"> {}
interface $ZodEmail extends $ZodType {
  _zod: $ZodEmailInternals;
}
declare const $ZodEmail: $constructor<$ZodEmail>;
interface $ZodURLDef extends $ZodStringFormatDef<"url"> {
  hostname?: RegExp | undefined;
  protocol?: RegExp | undefined;
  normalize?: boolean | undefined;
}
interface $ZodURLInternals extends $ZodStringFormatInternals<"url"> {
  def: $ZodURLDef;
}
interface $ZodURL extends $ZodType {
  _zod: $ZodURLInternals;
}
declare const $ZodURL: $constructor<$ZodURL>;
interface $ZodEmojiInternals extends $ZodStringFormatInternals<"emoji"> {}
interface $ZodEmoji extends $ZodType {
  _zod: $ZodEmojiInternals;
}
declare const $ZodEmoji: $constructor<$ZodEmoji>;
interface $ZodNanoIDInternals extends $ZodStringFormatInternals<"nanoid"> {}
interface $ZodNanoID extends $ZodType {
  _zod: $ZodNanoIDInternals;
}
declare const $ZodNanoID: $constructor<$ZodNanoID>;
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
interface $ZodCUIDInternals extends $ZodStringFormatInternals<"cuid"> {}
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
interface $ZodCUID extends $ZodType {
  _zod: $ZodCUIDInternals;
}
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
declare const $ZodCUID: $constructor<$ZodCUID>;
interface $ZodCUID2Internals extends $ZodStringFormatInternals<"cuid2"> {}
interface $ZodCUID2 extends $ZodType {
  _zod: $ZodCUID2Internals;
}
declare const $ZodCUID2: $constructor<$ZodCUID2>;
interface $ZodULIDInternals extends $ZodStringFormatInternals<"ulid"> {}
interface $ZodULID extends $ZodType {
  _zod: $ZodULIDInternals;
}
declare const $ZodULID: $constructor<$ZodULID>;
interface $ZodXIDInternals extends $ZodStringFormatInternals<"xid"> {}
interface $ZodXID extends $ZodType {
  _zod: $ZodXIDInternals;
}
declare const $ZodXID: $constructor<$ZodXID>;
interface $ZodKSUIDInternals extends $ZodStringFormatInternals<"ksuid"> {}
interface $ZodKSUID extends $ZodType {
  _zod: $ZodKSUIDInternals;
}
declare const $ZodKSUID: $constructor<$ZodKSUID>;
interface $ZodISODateTimeDef extends $ZodStringFormatDef<"datetime"> {
  precision: number | null;
  offset: boolean;
  local: boolean;
}
interface $ZodISODateTimeInternals extends $ZodStringFormatInternals {
  def: $ZodISODateTimeDef;
}
interface $ZodISODateTime extends $ZodType {
  _zod: $ZodISODateTimeInternals;
}
declare const $ZodISODateTime: $constructor<$ZodISODateTime>;
interface $ZodISODateInternals extends $ZodStringFormatInternals<"date"> {}
interface $ZodISODate extends $ZodType {
  _zod: $ZodISODateInternals;
}
declare const $ZodISODate: $constructor<$ZodISODate>;
interface $ZodISOTimeDef extends $ZodStringFormatDef<"time"> {
  precision?: number | null;
}
interface $ZodISOTimeInternals extends $ZodStringFormatInternals<"time"> {
  def: $ZodISOTimeDef;
}
interface $ZodISOTime extends $ZodType {
  _zod: $ZodISOTimeInternals;
}
declare const $ZodISOTime: $constructor<$ZodISOTime>;
interface $ZodISODurationInternals extends $ZodStringFormatInternals<"duration"> {}
interface $ZodISODuration extends $ZodType {
  _zod: $ZodISODurationInternals;
}
declare const $ZodISODuration: $constructor<$ZodISODuration>;
interface $ZodIPv4Def extends $ZodStringFormatDef<"ipv4"> {
  version?: "v4";
}
interface $ZodIPv4Internals extends $ZodStringFormatInternals<"ipv4"> {
  def: $ZodIPv4Def;
}
interface $ZodIPv4 extends $ZodType {
  _zod: $ZodIPv4Internals;
}
declare const $ZodIPv4: $constructor<$ZodIPv4>;
interface $ZodIPv6Def extends $ZodStringFormatDef<"ipv6"> {
  version?: "v6";
}
interface $ZodIPv6Internals extends $ZodStringFormatInternals<"ipv6"> {
  def: $ZodIPv6Def;
}
interface $ZodIPv6 extends $ZodType {
  _zod: $ZodIPv6Internals;
}
declare const $ZodIPv6: $constructor<$ZodIPv6>;
interface $ZodCIDRv4Def extends $ZodStringFormatDef<"cidrv4"> {
  version?: "v4";
}
interface $ZodCIDRv4Internals extends $ZodStringFormatInternals<"cidrv4"> {
  def: $ZodCIDRv4Def;
}
interface $ZodCIDRv4 extends $ZodType {
  _zod: $ZodCIDRv4Internals;
}
declare const $ZodCIDRv4: $constructor<$ZodCIDRv4>;
interface $ZodCIDRv6Def extends $ZodStringFormatDef<"cidrv6"> {
  version?: "v6";
}
interface $ZodCIDRv6Internals extends $ZodStringFormatInternals<"cidrv6"> {
  def: $ZodCIDRv6Def;
}
interface $ZodCIDRv6 extends $ZodType {
  _zod: $ZodCIDRv6Internals;
}
declare const $ZodCIDRv6: $constructor<$ZodCIDRv6>;
interface $ZodBase64Internals extends $ZodStringFormatInternals<"base64"> {}
interface $ZodBase64 extends $ZodType {
  _zod: $ZodBase64Internals;
}
declare const $ZodBase64: $constructor<$ZodBase64>;
interface $ZodBase64URLInternals extends $ZodStringFormatInternals<"base64url"> {}
interface $ZodBase64URL extends $ZodType {
  _zod: $ZodBase64URLInternals;
}
declare const $ZodBase64URL: $constructor<$ZodBase64URL>;
interface $ZodE164Internals extends $ZodStringFormatInternals<"e164"> {}
interface $ZodE164 extends $ZodType {
  _zod: $ZodE164Internals;
}
declare const $ZodE164: $constructor<$ZodE164>;
interface $ZodJWTDef extends $ZodStringFormatDef<"jwt"> {
  alg?: JWTAlgorithm | undefined;
}
interface $ZodJWTInternals extends $ZodStringFormatInternals<"jwt"> {
  def: $ZodJWTDef;
}
interface $ZodJWT extends $ZodType {
  _zod: $ZodJWTInternals;
}
declare const $ZodJWT: $constructor<$ZodJWT>;
interface $ZodNumberDef extends $ZodTypeDef {
  type: "number";
  coerce?: boolean;
}
interface $ZodNumberInternals<Input = unknown> extends $ZodTypeInternals<number, Input> {
  def: $ZodNumberDef;
  /** @deprecated Internal API, use with caution (not deprecated) */
  pattern: RegExp;
  /** @deprecated Internal API, use with caution (not deprecated) */
  isst: $ZodIssueInvalidType;
  bag: LoosePartial<{
    minimum: number;
    maximum: number;
    exclusiveMinimum: number;
    exclusiveMaximum: number;
    format: string;
    pattern: RegExp;
  }>;
}
interface $ZodNumber<Input = unknown> extends $ZodType {
  _zod: $ZodNumberInternals<Input>;
}
declare const $ZodNumber: $constructor<$ZodNumber>;
interface $ZodBooleanDef extends $ZodTypeDef {
  type: "boolean";
  coerce?: boolean;
  checks?: $ZodCheck<boolean>[];
}
interface $ZodBooleanInternals<T = unknown> extends $ZodTypeInternals<boolean, T> {
  pattern: RegExp;
  def: $ZodBooleanDef;
  isst: $ZodIssueInvalidType;
}
interface $ZodBoolean<T = unknown> extends $ZodType {
  _zod: $ZodBooleanInternals<T>;
}
declare const $ZodBoolean: $constructor<$ZodBoolean>;
interface $ZodBigIntDef extends $ZodTypeDef {
  type: "bigint";
  coerce?: boolean;
}
interface $ZodBigIntInternals<T = unknown> extends $ZodTypeInternals<bigint, T> {
  pattern: RegExp;
  /** @internal Internal API, use with caution */
  def: $ZodBigIntDef;
  isst: $ZodIssueInvalidType;
  bag: LoosePartial<{
    minimum: bigint;
    maximum: bigint;
    format: string;
  }>;
}
interface $ZodBigInt<T = unknown> extends $ZodType {
  _zod: $ZodBigIntInternals<T>;
}
declare const $ZodBigInt: $constructor<$ZodBigInt>;
interface $ZodSymbolDef extends $ZodTypeDef {
  type: "symbol";
}
interface $ZodSymbolInternals extends $ZodTypeInternals<symbol, symbol> {
  def: $ZodSymbolDef;
  isst: $ZodIssueInvalidType;
}
interface $ZodSymbol extends $ZodType {
  _zod: $ZodSymbolInternals;
}
declare const $ZodSymbol: $constructor<$ZodSymbol>;
interface $ZodUndefinedDef extends $ZodTypeDef {
  type: "undefined";
}
interface $ZodUndefinedInternals extends $ZodTypeInternals<undefined, undefined> {
  pattern: RegExp;
  def: $ZodUndefinedDef;
  values: PrimitiveSet;
  isst: $ZodIssueInvalidType;
}
interface $ZodUndefined extends $ZodType {
  _zod: $ZodUndefinedInternals;
}
declare const $ZodUndefined: $constructor<$ZodUndefined>;
interface $ZodNullDef extends $ZodTypeDef {
  type: "null";
}
interface $ZodNullInternals extends $ZodTypeInternals<null, null> {
  pattern: RegExp;
  def: $ZodNullDef;
  values: PrimitiveSet;
  isst: $ZodIssueInvalidType;
}
interface $ZodNull extends $ZodType {
  _zod: $ZodNullInternals;
}
declare const $ZodNull: $constructor<$ZodNull>;
interface $ZodAnyDef extends $ZodTypeDef {
  type: "any";
}
interface $ZodAnyInternals extends $ZodTypeInternals<any, any> {
  def: $ZodAnyDef;
  isst: never;
}
interface $ZodAny extends $ZodType {
  _zod: $ZodAnyInternals;
}
declare const $ZodAny: $constructor<$ZodAny>;
interface $ZodUnknownDef extends $ZodTypeDef {
  type: "unknown";
}
interface $ZodUnknownInternals extends $ZodTypeInternals<unknown, unknown> {
  def: $ZodUnknownDef;
  isst: never;
}
interface $ZodUnknown extends $ZodType {
  _zod: $ZodUnknownInternals;
}
declare const $ZodUnknown: $constructor<$ZodUnknown>;
interface $ZodNeverDef extends $ZodTypeDef {
  type: "never";
}
interface $ZodNeverInternals extends $ZodTypeInternals<never, never> {
  def: $ZodNeverDef;
  isst: $ZodIssueInvalidType;
}
interface $ZodNever extends $ZodType {
  _zod: $ZodNeverInternals;
}
declare const $ZodNever: $constructor<$ZodNever>;
interface $ZodVoidDef extends $ZodTypeDef {
  type: "void";
}
interface $ZodVoidInternals extends $ZodTypeInternals<void, void> {
  def: $ZodVoidDef;
  isst: $ZodIssueInvalidType;
}
interface $ZodVoid extends $ZodType {
  _zod: $ZodVoidInternals;
}
declare const $ZodVoid: $constructor<$ZodVoid>;
interface $ZodDateDef extends $ZodTypeDef {
  type: "date";
  coerce?: boolean;
}
interface $ZodDateInternals<T = unknown> extends $ZodTypeInternals<Date, T> {
  def: $ZodDateDef;
  isst: $ZodIssueInvalidType;
  bag: LoosePartial<{
    minimum: Date;
    maximum: Date;
    format: string;
  }>;
}
interface $ZodDate<T = unknown> extends $ZodType {
  _zod: $ZodDateInternals<T>;
}
declare const $ZodDate: $constructor<$ZodDate>;
interface $ZodArrayDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "array";
  element: T;
}
interface $ZodArrayInternals<T extends SomeType = $ZodType> extends _$ZodTypeInternals {
  def: $ZodArrayDef<T>;
  isst: $ZodIssueInvalidType;
  output: output<T>[];
  input: input<T>[];
}
interface $ZodArray<T extends SomeType = $ZodType> extends $ZodType<any, any, $ZodArrayInternals<T>> {}
declare const $ZodArray: $constructor<$ZodArray>;
type OptionalOutSchema = {
  _zod: {
    optout: "optional";
  };
};
type OptionalInSchema = {
  _zod: {
    optin: "optional";
  };
};
type $InferObjectOutput<T extends $ZodLooseShape, Extra extends Record<string, unknown>> = string extends keyof T ? IsAny<T[keyof T]> extends true ? Record<string, unknown> : Record<string, output<T[keyof T]>> : keyof (T & Extra) extends never ? Record<string, never> : Prettify<{ -readonly [k in keyof T as T[k] extends OptionalOutSchema ? never : k]: T[k]["_zod"]["output"] } & { -readonly [k in keyof T as T[k] extends OptionalOutSchema ? k : never]?: T[k]["_zod"]["output"] } & Extra>;
type $InferObjectInput<T extends $ZodLooseShape, Extra extends Record<string, unknown>> = string extends keyof T ? IsAny<T[keyof T]> extends true ? Record<string, unknown> : Record<string, input<T[keyof T]>> : keyof (T & Extra) extends never ? Record<string, never> : Prettify<{ -readonly [k in keyof T as T[k] extends OptionalInSchema ? never : k]: T[k]["_zod"]["input"] } & { -readonly [k in keyof T as T[k] extends OptionalInSchema ? k : never]?: T[k]["_zod"]["input"] } & Extra>;
type $ZodObjectConfig = {
  out: Record<string, unknown>;
  in: Record<string, unknown>;
};
type $loose = {
  out: Record<string, unknown>;
  in: Record<string, unknown>;
};
type $strict = {
  out: {};
  in: {};
};
type $strip = {
  out: {};
  in: {};
};
type $catchall<T extends SomeType> = {
  out: {
    [k: string]: output<T>;
  };
  in: {
    [k: string]: input<T>;
  };
};
type $ZodShape = Readonly<{
  [k: string]: $ZodType;
}>;
interface $ZodObjectDef<Shape extends $ZodShape = $ZodShape> extends $ZodTypeDef {
  type: "object";
  shape: Shape;
  catchall?: $ZodType | undefined;
}
interface $ZodObjectInternals< /** @ts-ignore Cast variance */out Shape extends $ZodShape = $ZodShape, out Config extends $ZodObjectConfig = $ZodObjectConfig> extends _$ZodTypeInternals {
  def: $ZodObjectDef<Shape>;
  config: Config;
  isst: $ZodIssueInvalidType | $ZodIssueUnrecognizedKeys;
  propValues: PropValues;
  output: $InferObjectOutput<Shape, Config["out"]>;
  input: $InferObjectInput<Shape, Config["in"]>;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
}
type $ZodLooseShape = Record<string, any>;
interface $ZodObject< /** @ts-ignore Cast variance */out Shape extends Readonly<$ZodShape> = Readonly<$ZodShape>, out Params extends $ZodObjectConfig = $ZodObjectConfig> extends $ZodType<any, any, $ZodObjectInternals<Shape, Params>> {}
declare const $ZodObject: $constructor<$ZodObject>;
type $InferUnionOutput<T extends SomeType> = T extends any ? output<T> : never;
type $InferUnionInput<T extends SomeType> = T extends any ? input<T> : never;
interface $ZodUnionDef<Options extends readonly SomeType[] = readonly $ZodType[]> extends $ZodTypeDef {
  type: "union";
  options: Options;
  inclusive?: boolean;
}
type IsOptionalIn<T extends SomeType> = T extends OptionalInSchema ? true : false;
type IsOptionalOut<T extends SomeType> = T extends OptionalOutSchema ? true : false;
interface $ZodUnionInternals<T extends readonly SomeType[] = readonly $ZodType[]> extends _$ZodTypeInternals {
  def: $ZodUnionDef<T>;
  isst: $ZodIssueInvalidUnion;
  pattern: T[number]["_zod"]["pattern"];
  values: T[number]["_zod"]["values"];
  output: $InferUnionOutput<T[number]>;
  input: $InferUnionInput<T[number]>;
  optin: IsOptionalIn<T[number]> extends false ? "optional" | undefined : "optional";
  optout: IsOptionalOut<T[number]> extends false ? "optional" | undefined : "optional";
}
interface $ZodUnion<T extends readonly SomeType[] = readonly $ZodType[]> extends $ZodType<any, any, $ZodUnionInternals<T>> {
  _zod: $ZodUnionInternals<T>;
}
declare const $ZodUnion: $constructor<$ZodUnion>;
interface $ZodIntersectionDef<Left extends SomeType = $ZodType, Right extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "intersection";
  left: Left;
  right: Right;
}
interface $ZodIntersectionInternals<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends _$ZodTypeInternals {
  def: $ZodIntersectionDef<A, B>;
  isst: never;
  optin: A["_zod"]["optin"] | B["_zod"]["optin"];
  optout: A["_zod"]["optout"] | B["_zod"]["optout"];
  output: output<A> & output<B>;
  input: input<A> & input<B>;
}
interface $ZodIntersection<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodIntersectionInternals<A, B>;
}
declare const $ZodIntersection: $constructor<$ZodIntersection>;
interface $ZodTupleDef<T extends TupleItems = readonly $ZodType[], Rest extends SomeType | null = $ZodType | null> extends $ZodTypeDef {
  type: "tuple";
  items: T;
  rest: Rest;
}
type $InferTupleInputType<T extends TupleItems, Rest extends SomeType | null> = [...TupleInputTypeWithOptionals<T>, ...(Rest extends SomeType ? input<Rest>[] : [])];
type TupleInputTypeNoOptionals<T extends TupleItems> = { [k in keyof T]: input<T[k]> };
type TupleInputTypeWithOptionals<T extends TupleItems> = T extends readonly [...infer Prefix extends SomeType[], infer Tail extends SomeType] ? Tail["_zod"]["optin"] extends "optional" ? [...TupleInputTypeWithOptionals<Prefix>, input<Tail>?] : TupleInputTypeNoOptionals<T> : [];
type $InferTupleOutputType<T extends TupleItems, Rest extends SomeType | null> = [...TupleOutputTypeWithOptionals<T>, ...(Rest extends SomeType ? output<Rest>[] : [])];
type TupleOutputTypeNoOptionals<T extends TupleItems> = { [k in keyof T]: output<T[k]> };
type TupleOutputTypeWithOptionals<T extends TupleItems> = T extends readonly [...infer Prefix extends SomeType[], infer Tail extends SomeType] ? Tail["_zod"]["optout"] extends "optional" ? [...TupleOutputTypeWithOptionals<Prefix>, output<Tail>?] : TupleOutputTypeNoOptionals<T> : [];
interface $ZodTupleInternals<T extends TupleItems = readonly $ZodType[], Rest extends SomeType | null = $ZodType | null> extends _$ZodTypeInternals {
  def: $ZodTupleDef<T, Rest>;
  isst: $ZodIssueInvalidType | $ZodIssueTooBig<unknown[]> | $ZodIssueTooSmall<unknown[]>;
  output: $InferTupleOutputType<T, Rest>;
  input: $InferTupleInputType<T, Rest>;
}
interface $ZodTuple<T extends TupleItems = readonly $ZodType[], Rest extends SomeType | null = $ZodType | null> extends $ZodType {
  _zod: $ZodTupleInternals<T, Rest>;
}
declare const $ZodTuple: $constructor<$ZodTuple>;
type $ZodRecordKey = $ZodType<string | number | symbol, unknown>;
interface $ZodRecordDef<Key extends $ZodRecordKey = $ZodRecordKey, Value extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "record";
  keyType: Key;
  valueType: Value;
  /** @default "strict" - errors on keys not matching keyType. "loose" passes through non-matching keys unchanged. */
  mode?: "strict" | "loose";
}
type $InferZodRecordOutput<Key extends $ZodRecordKey = $ZodRecordKey, Value extends SomeType = $ZodType> = Key extends $partial ? Partial<Record<output<Key>, output<Value>>> : Record<output<Key>, output<Value>>;
type $InferZodRecordInput<Key extends $ZodRecordKey = $ZodRecordKey, Value extends SomeType = $ZodType> = Key extends $partial ? Partial<Record<input<Key> & PropertyKey, input<Value>>> : Record<input<Key> & PropertyKey, input<Value>>;
interface $ZodRecordInternals<Key extends $ZodRecordKey = $ZodRecordKey, Value extends SomeType = $ZodType> extends $ZodTypeInternals<$InferZodRecordOutput<Key, Value>, $InferZodRecordInput<Key, Value>> {
  def: $ZodRecordDef<Key, Value>;
  isst: $ZodIssueInvalidType | $ZodIssueInvalidKey<Record<PropertyKey, unknown>>;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
}
type $partial = {
  "~~partial": true;
};
interface $ZodRecord<Key extends $ZodRecordKey = $ZodRecordKey, Value extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodRecordInternals<Key, Value>;
}
declare const $ZodRecord: $constructor<$ZodRecord>;
interface $ZodMapDef<Key extends SomeType = $ZodType, Value extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "map";
  keyType: Key;
  valueType: Value;
}
interface $ZodMapInternals<Key extends SomeType = $ZodType, Value extends SomeType = $ZodType> extends $ZodTypeInternals<Map<output<Key>, output<Value>>, Map<input<Key>, input<Value>>> {
  def: $ZodMapDef<Key, Value>;
  isst: $ZodIssueInvalidType | $ZodIssueInvalidKey | $ZodIssueInvalidElement<unknown>;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
}
interface $ZodMap<Key extends SomeType = $ZodType, Value extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodMapInternals<Key, Value>;
}
declare const $ZodMap: $constructor<$ZodMap>;
interface $ZodSetDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "set";
  valueType: T;
}
interface $ZodSetInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<Set<output<T>>, Set<input<T>>> {
  def: $ZodSetDef<T>;
  isst: $ZodIssueInvalidType;
  optin?: "optional" | undefined;
  optout?: "optional" | undefined;
}
interface $ZodSet<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodSetInternals<T>;
}
declare const $ZodSet: $constructor<$ZodSet>;
type $InferEnumOutput<T extends EnumLike> = T[keyof T] & {};
type $InferEnumInput<T extends EnumLike> = T[keyof T] & {};
interface $ZodEnumDef<T extends EnumLike = EnumLike> extends $ZodTypeDef {
  type: "enum";
  entries: T;
}
interface $ZodEnumInternals< /** @ts-ignore Cast variance */out T extends EnumLike = EnumLike> extends $ZodTypeInternals<$InferEnumOutput<T>, $InferEnumInput<T>> {
  def: $ZodEnumDef<T>;
  /** @deprecated Internal API, use with caution (not deprecated) */
  values: PrimitiveSet;
  /** @deprecated Internal API, use with caution (not deprecated) */
  pattern: RegExp;
  isst: $ZodIssueInvalidValue;
}
interface $ZodEnum<T extends EnumLike = EnumLike> extends $ZodType {
  _zod: $ZodEnumInternals<T>;
}
declare const $ZodEnum: $constructor<$ZodEnum>;
interface $ZodLiteralDef<T extends Literal> extends $ZodTypeDef {
  type: "literal";
  values: T[];
}
interface $ZodLiteralInternals<T extends Literal = Literal> extends $ZodTypeInternals<T, T> {
  def: $ZodLiteralDef<T>;
  values: Set<T>;
  pattern: RegExp;
  isst: $ZodIssueInvalidValue;
}
interface $ZodLiteral<T extends Literal = Literal> extends $ZodType {
  _zod: $ZodLiteralInternals<T>;
}
declare const $ZodLiteral: $constructor<$ZodLiteral>;
type _File = typeof globalThis extends {
  File: infer F extends new (...args: any[]) => any;
} ? InstanceType<F> : {};
/** Do not reference this directly. */
interface File$2 extends _File {
  readonly type: string;
  readonly size: number;
}
interface $ZodFileDef extends $ZodTypeDef {
  type: "file";
}
interface $ZodFileInternals extends $ZodTypeInternals<File$2, File$2> {
  def: $ZodFileDef;
  isst: $ZodIssueInvalidType;
  bag: LoosePartial<{
    minimum: number;
    maximum: number;
    mime: MimeTypes[];
  }>;
}
interface $ZodFile extends $ZodType {
  _zod: $ZodFileInternals;
}
declare const $ZodFile: $constructor<$ZodFile>;
interface $ZodTransformDef extends $ZodTypeDef {
  type: "transform";
  transform: (input: unknown, payload: ParsePayload<unknown>) => MaybeAsync<unknown>;
}
interface $ZodTransformInternals<O = unknown, I = unknown> extends $ZodTypeInternals<O, I> {
  def: $ZodTransformDef;
  isst: never;
}
interface $ZodTransform<O = unknown, I = unknown> extends $ZodType {
  _zod: $ZodTransformInternals<O, I>;
}
declare const $ZodTransform: $constructor<$ZodTransform>;
interface $ZodOptionalDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "optional";
  innerType: T;
}
interface $ZodOptionalInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<output<T> | undefined, input<T> | undefined> {
  def: $ZodOptionalDef<T>;
  optin: "optional";
  optout: "optional";
  isst: never;
  values: T["_zod"]["values"];
  pattern: T["_zod"]["pattern"];
}
interface $ZodOptional<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodOptionalInternals<T>;
}
declare const $ZodOptional: $constructor<$ZodOptional>;
interface $ZodExactOptionalDef<T extends SomeType = $ZodType> extends $ZodOptionalDef<T> {}
interface $ZodExactOptionalInternals<T extends SomeType = $ZodType> extends $ZodOptionalInternals<T> {
  def: $ZodExactOptionalDef<T>;
  output: output<T>;
  input: input<T>;
}
interface $ZodExactOptional<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodExactOptionalInternals<T>;
}
declare const $ZodExactOptional: $constructor<$ZodExactOptional>;
interface $ZodNullableDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "nullable";
  innerType: T;
}
interface $ZodNullableInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<output<T> | null, input<T> | null> {
  def: $ZodNullableDef<T>;
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  isst: never;
  values: T["_zod"]["values"];
  pattern: T["_zod"]["pattern"];
}
interface $ZodNullable<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodNullableInternals<T>;
}
declare const $ZodNullable: $constructor<$ZodNullable>;
interface $ZodDefaultDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "default";
  innerType: T;
  /** The default value. May be a getter. */
  defaultValue: NoUndefined<output<T>>;
}
interface $ZodDefaultInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<NoUndefined<output<T>>, input<T> | undefined> {
  def: $ZodDefaultDef<T>;
  optin: "optional";
  optout?: "optional" | undefined;
  isst: never;
  values: T["_zod"]["values"];
}
interface $ZodDefault<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodDefaultInternals<T>;
}
declare const $ZodDefault: $constructor<$ZodDefault>;
interface $ZodPrefaultDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "prefault";
  innerType: T;
  /** The default value. May be a getter. */
  defaultValue: input<T>;
}
interface $ZodPrefaultInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<NoUndefined<output<T>>, input<T> | undefined> {
  def: $ZodPrefaultDef<T>;
  optin: "optional";
  optout?: "optional" | undefined;
  isst: never;
  values: T["_zod"]["values"];
}
interface $ZodPrefault<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodPrefaultInternals<T>;
}
declare const $ZodPrefault: $constructor<$ZodPrefault>;
interface $ZodNonOptionalDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "nonoptional";
  innerType: T;
}
interface $ZodNonOptionalInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<NoUndefined<output<T>>, NoUndefined<input<T>>> {
  def: $ZodNonOptionalDef<T>;
  isst: $ZodIssueInvalidType;
  values: T["_zod"]["values"];
  optin: "optional" | undefined;
  optout: "optional" | undefined;
}
interface $ZodNonOptional<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodNonOptionalInternals<T>;
}
declare const $ZodNonOptional: $constructor<$ZodNonOptional>;
interface $ZodSuccessDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "success";
  innerType: T;
}
interface $ZodSuccessInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<boolean, input<T>> {
  def: $ZodSuccessDef<T>;
  isst: never;
  optin: T["_zod"]["optin"];
  optout: "optional" | undefined;
}
interface $ZodSuccess<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodSuccessInternals<T>;
}
declare const $ZodSuccess: $constructor<$ZodSuccess>;
interface $ZodCatchCtx extends ParsePayload {
  /** @deprecated Use `ctx.issues` */
  error: {
    issues: $ZodIssue[];
  };
  /** @deprecated Use `ctx.value` */
  input: unknown;
}
interface $ZodCatchDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "catch";
  innerType: T;
  catchValue: (ctx: $ZodCatchCtx) => unknown;
}
interface $ZodCatchInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<output<T>, input<T>> {
  def: $ZodCatchDef<T>;
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  isst: never;
  values: T["_zod"]["values"];
}
interface $ZodCatch<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodCatchInternals<T>;
}
declare const $ZodCatch: $constructor<$ZodCatch>;
interface $ZodNaNDef extends $ZodTypeDef {
  type: "nan";
}
interface $ZodNaNInternals extends $ZodTypeInternals<number, number> {
  def: $ZodNaNDef;
  isst: $ZodIssueInvalidType;
}
interface $ZodNaN extends $ZodType {
  _zod: $ZodNaNInternals;
}
declare const $ZodNaN: $constructor<$ZodNaN>;
interface $ZodPipeDef<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "pipe";
  in: A;
  out: B;
  /** Only defined inside $ZodCodec instances. */
  transform?: (value: output<A>, payload: ParsePayload<output<A>>) => MaybeAsync<input<B>>;
  /** Only defined inside $ZodCodec instances. */
  reverseTransform?: (value: input<B>, payload: ParsePayload<input<B>>) => MaybeAsync<output<A>>;
}
interface $ZodPipeInternals<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends $ZodTypeInternals<output<B>, input<A>> {
  def: $ZodPipeDef<A, B>;
  isst: never;
  values: A["_zod"]["values"];
  optin: A["_zod"]["optin"];
  optout: B["_zod"]["optout"];
  propValues: A["_zod"]["propValues"];
}
interface $ZodPipe<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodPipeInternals<A, B>;
}
declare const $ZodPipe: $constructor<$ZodPipe>;
interface $ZodReadonlyDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "readonly";
  innerType: T;
}
interface $ZodReadonlyInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<MakeReadonly<output<T>>, MakeReadonly<input<T>>> {
  def: $ZodReadonlyDef<T>;
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
  isst: never;
  propValues: T["_zod"]["propValues"];
  values: T["_zod"]["values"];
}
interface $ZodReadonly<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodReadonlyInternals<T>;
}
declare const $ZodReadonly: $constructor<$ZodReadonly>;
interface $ZodTemplateLiteralDef extends $ZodTypeDef {
  type: "template_literal";
  parts: $ZodTemplateLiteralPart[];
  format?: string | undefined;
}
interface $ZodTemplateLiteralInternals<Template extends string = string> extends $ZodTypeInternals<Template, Template> {
  pattern: RegExp;
  def: $ZodTemplateLiteralDef;
  isst: $ZodIssueInvalidType;
}
interface $ZodTemplateLiteral<Template extends string = string> extends $ZodType {
  _zod: $ZodTemplateLiteralInternals<Template>;
}
type LiteralPart = Exclude<Literal, symbol>;
interface SchemaPartInternals extends $ZodTypeInternals<LiteralPart, LiteralPart> {
  pattern: RegExp;
}
interface SchemaPart extends $ZodType {
  _zod: SchemaPartInternals;
}
type $ZodTemplateLiteralPart = LiteralPart | SchemaPart;
declare const $ZodTemplateLiteral: $constructor<$ZodTemplateLiteral>;
type $ZodFunctionArgs = $ZodType<unknown[], unknown[]>;
type $ZodFunctionIn = $ZodFunctionArgs;
type $ZodFunctionOut = $ZodType;
type $InferInnerFunctionType<Args extends $ZodFunctionIn, Returns extends $ZodFunctionOut> = (...args: $ZodFunctionIn extends Args ? never[] : output<Args>) => input<Returns>;
type $InferInnerFunctionTypeAsync<Args extends $ZodFunctionIn, Returns extends $ZodFunctionOut> = (...args: $ZodFunctionIn extends Args ? never[] : output<Args>) => MaybeAsync<input<Returns>>;
type $InferOuterFunctionType<Args extends $ZodFunctionIn, Returns extends $ZodFunctionOut> = (...args: $ZodFunctionIn extends Args ? never[] : input<Args>) => output<Returns>;
type $InferOuterFunctionTypeAsync<Args extends $ZodFunctionIn, Returns extends $ZodFunctionOut> = (...args: $ZodFunctionIn extends Args ? never[] : input<Args>) => Promise<output<Returns>>;
interface $ZodFunctionDef<In extends $ZodFunctionIn = $ZodFunctionIn, Out extends $ZodFunctionOut = $ZodFunctionOut> extends $ZodTypeDef {
  type: "function";
  input: In;
  output: Out;
}
interface $ZodFunctionInternals<Args extends $ZodFunctionIn, Returns extends $ZodFunctionOut> extends $ZodTypeInternals<$InferOuterFunctionType<Args, Returns>, $InferInnerFunctionType<Args, Returns>> {
  def: $ZodFunctionDef<Args, Returns>;
  isst: $ZodIssueInvalidType;
}
interface $ZodFunction<Args extends $ZodFunctionIn = $ZodFunctionIn, Returns extends $ZodFunctionOut = $ZodFunctionOut> extends $ZodType<any, any, $ZodFunctionInternals<Args, Returns>> {
  /** @deprecated */
  _def: $ZodFunctionDef<Args, Returns>;
  _input: $InferInnerFunctionType<Args, Returns>;
  _output: $InferOuterFunctionType<Args, Returns>;
  implement<F extends $InferInnerFunctionType<Args, Returns>>(func: F): (...args: Parameters<this["_output"]>) => ReturnType<F> extends ReturnType<this["_output"]> ? ReturnType<F> : ReturnType<this["_output"]>;
  implementAsync<F extends $InferInnerFunctionTypeAsync<Args, Returns>>(func: F): F extends $InferOuterFunctionTypeAsync<Args, Returns> ? F : $InferOuterFunctionTypeAsync<Args, Returns>;
  input<const Items extends TupleItems, const Rest extends $ZodFunctionOut = $ZodFunctionOut>(args: Items, rest?: Rest): $ZodFunction<$ZodTuple<Items, Rest>, Returns>;
  input<NewArgs extends $ZodFunctionIn>(args: NewArgs): $ZodFunction<NewArgs, Returns>;
  input(...args: any[]): $ZodFunction<any, Returns>;
  output<NewReturns extends $ZodType>(output: NewReturns): $ZodFunction<Args, NewReturns>;
}
declare const $ZodFunction: $constructor<$ZodFunction>;
interface $ZodPromiseDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "promise";
  innerType: T;
}
interface $ZodPromiseInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<Promise<output<T>>, MaybeAsync<input<T>>> {
  def: $ZodPromiseDef<T>;
  isst: never;
}
interface $ZodPromise<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodPromiseInternals<T>;
}
declare const $ZodPromise: $constructor<$ZodPromise>;
interface $ZodLazyDef<T extends SomeType = $ZodType> extends $ZodTypeDef {
  type: "lazy";
  getter: () => T;
}
interface $ZodLazyInternals<T extends SomeType = $ZodType> extends $ZodTypeInternals<output<T>, input<T>> {
  def: $ZodLazyDef<T>;
  isst: never;
  /** Auto-cached way to retrieve the inner schema */
  innerType: T;
  pattern: T["_zod"]["pattern"];
  propValues: T["_zod"]["propValues"];
  optin: T["_zod"]["optin"];
  optout: T["_zod"]["optout"];
}
interface $ZodLazy<T extends SomeType = $ZodType> extends $ZodType {
  _zod: $ZodLazyInternals<T>;
}
declare const $ZodLazy: $constructor<$ZodLazy>;
interface $ZodCustomDef<O = unknown> extends $ZodTypeDef, $ZodCheckDef {
  type: "custom";
  check: "custom";
  path?: PropertyKey[] | undefined;
  error?: $ZodErrorMap | undefined;
  params?: Record<string, any> | undefined;
  fn: (arg: O) => unknown;
}
interface $ZodCustomInternals<O = unknown, I = unknown> extends $ZodTypeInternals<O, I>, $ZodCheckInternals<O> {
  def: $ZodCustomDef;
  issc: $ZodIssue;
  isst: never;
  bag: LoosePartial<{
    Class: typeof Class;
  }>;
}
interface $ZodCustom<O = unknown, I = unknown> extends $ZodType {
  _zod: $ZodCustomInternals<O, I>;
}
declare const $ZodCustom: $constructor<$ZodCustom>;
type $ZodTypes = $ZodString | $ZodNumber | $ZodBigInt | $ZodBoolean | $ZodDate | $ZodSymbol | $ZodUndefined | $ZodNullable | $ZodNull | $ZodAny | $ZodUnknown | $ZodNever | $ZodVoid | $ZodArray | $ZodObject | $ZodUnion | $ZodIntersection | $ZodTuple | $ZodRecord | $ZodMap | $ZodSet | $ZodLiteral | $ZodEnum | $ZodFunction | $ZodPromise | $ZodLazy | $ZodOptional | $ZodDefault | $ZodPrefault | $ZodTemplateLiteral | $ZodCustom | $ZodTransform | $ZodNonOptional | $ZodReadonly | $ZodNaN | $ZodPipe | $ZodSuccess | $ZodCatch | $ZodFile;
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.d.cts
interface $ZodCheckDef {
  check: string;
  error?: $ZodErrorMap<never> | undefined;
  /** If true, no later checks will be executed if this check fails. Default `false`. */
  abort?: boolean | undefined;
  /** If provided, the check runs only when this returns `true`. By default, it is skipped if prior parsing produced aborting issues. */
  when?: ((payload: ParsePayload) => boolean) | undefined;
}
interface $ZodCheckInternals<T> {
  def: $ZodCheckDef;
  /** The set of issues this check might throw. */
  issc?: $ZodIssueBase;
  check(payload: ParsePayload<T>): MaybeAsync<void>;
  onattach: ((schema: $ZodType) => void)[];
}
interface $ZodCheck<in T = never> {
  _zod: $ZodCheckInternals<T>;
}
declare const $ZodCheck: $constructor<$ZodCheck<any>>;
interface $ZodCheckMaxLengthDef extends $ZodCheckDef {
  check: "max_length";
  maximum: number;
}
interface $ZodCheckMaxLengthInternals<T extends HasLength = HasLength> extends $ZodCheckInternals<T> {
  def: $ZodCheckMaxLengthDef;
  issc: $ZodIssueTooBig<T>;
}
interface $ZodCheckMaxLength<T extends HasLength = HasLength> extends $ZodCheck<T> {
  _zod: $ZodCheckMaxLengthInternals<T>;
}
declare const $ZodCheckMaxLength: $constructor<$ZodCheckMaxLength>;
interface $ZodCheckMinLengthDef extends $ZodCheckDef {
  check: "min_length";
  minimum: number;
}
interface $ZodCheckMinLengthInternals<T extends HasLength = HasLength> extends $ZodCheckInternals<T> {
  def: $ZodCheckMinLengthDef;
  issc: $ZodIssueTooSmall<T>;
}
interface $ZodCheckMinLength<T extends HasLength = HasLength> extends $ZodCheck<T> {
  _zod: $ZodCheckMinLengthInternals<T>;
}
declare const $ZodCheckMinLength: $constructor<$ZodCheckMinLength>;
interface $ZodCheckLengthEqualsDef extends $ZodCheckDef {
  check: "length_equals";
  length: number;
}
interface $ZodCheckLengthEqualsInternals<T extends HasLength = HasLength> extends $ZodCheckInternals<T> {
  def: $ZodCheckLengthEqualsDef;
  issc: $ZodIssueTooBig<T> | $ZodIssueTooSmall<T>;
}
interface $ZodCheckLengthEquals<T extends HasLength = HasLength> extends $ZodCheck<T> {
  _zod: $ZodCheckLengthEqualsInternals<T>;
}
declare const $ZodCheckLengthEquals: $constructor<$ZodCheckLengthEquals>;
type $ZodStringFormats = "email" | "url" | "emoji" | "uuid" | "guid" | "nanoid" | "cuid" | "cuid2" | "ulid" | "xid" | "ksuid" | "datetime" | "date" | "time" | "duration" | "ipv4" | "ipv6" | "cidrv4" | "cidrv6" | "base64" | "base64url" | "json_string" | "e164" | "lowercase" | "uppercase" | "regex" | "jwt" | "starts_with" | "ends_with" | "includes";
interface $ZodCheckStringFormatDef<Format extends string = string> extends $ZodCheckDef {
  check: "string_format";
  format: Format;
  pattern?: RegExp | undefined;
}
interface $ZodCheckStringFormatInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckStringFormatDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckRegexDef extends $ZodCheckStringFormatDef {
  format: "regex";
  pattern: RegExp;
}
interface $ZodCheckRegexInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckRegexDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckRegex extends $ZodCheck<string> {
  _zod: $ZodCheckRegexInternals;
}
declare const $ZodCheckRegex: $constructor<$ZodCheckRegex>;
interface $ZodCheckLowerCaseDef extends $ZodCheckStringFormatDef<"lowercase"> {}
interface $ZodCheckLowerCaseInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckLowerCaseDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckLowerCase extends $ZodCheck<string> {
  _zod: $ZodCheckLowerCaseInternals;
}
declare const $ZodCheckLowerCase: $constructor<$ZodCheckLowerCase>;
interface $ZodCheckUpperCaseDef extends $ZodCheckStringFormatDef<"uppercase"> {}
interface $ZodCheckUpperCaseInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckUpperCaseDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckUpperCase extends $ZodCheck<string> {
  _zod: $ZodCheckUpperCaseInternals;
}
declare const $ZodCheckUpperCase: $constructor<$ZodCheckUpperCase>;
interface $ZodCheckIncludesDef extends $ZodCheckStringFormatDef<"includes"> {
  includes: string;
  position?: number | undefined;
}
interface $ZodCheckIncludesInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckIncludesDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckIncludes extends $ZodCheck<string> {
  _zod: $ZodCheckIncludesInternals;
}
declare const $ZodCheckIncludes: $constructor<$ZodCheckIncludes>;
interface $ZodCheckStartsWithDef extends $ZodCheckStringFormatDef<"starts_with"> {
  prefix: string;
}
interface $ZodCheckStartsWithInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckStartsWithDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckStartsWith extends $ZodCheck<string> {
  _zod: $ZodCheckStartsWithInternals;
}
declare const $ZodCheckStartsWith: $constructor<$ZodCheckStartsWith>;
interface $ZodCheckEndsWithDef extends $ZodCheckStringFormatDef<"ends_with"> {
  suffix: string;
}
interface $ZodCheckEndsWithInternals extends $ZodCheckInternals<string> {
  def: $ZodCheckEndsWithDef;
  issc: $ZodIssueInvalidStringFormat;
}
interface $ZodCheckEndsWith extends $ZodCheckInternals<string> {
  _zod: $ZodCheckEndsWithInternals;
}
declare const $ZodCheckEndsWith: $constructor<$ZodCheckEndsWith>;
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.d.cts
interface $ZodIssueBase {
  readonly code?: string;
  readonly input?: unknown;
  readonly path: PropertyKey[];
  readonly message: string;
}
type $ZodInvalidTypeExpected = "string" | "number" | "int" | "boolean" | "bigint" | "symbol" | "undefined" | "null" | "never" | "void" | "date" | "array" | "object" | "tuple" | "record" | "map" | "set" | "file" | "nonoptional" | "nan" | "function" | (string & {});
interface $ZodIssueInvalidType<Input = unknown> extends $ZodIssueBase {
  readonly code: "invalid_type";
  readonly expected: $ZodInvalidTypeExpected;
  readonly input?: Input;
}
interface $ZodIssueTooBig<Input = unknown> extends $ZodIssueBase {
  readonly code: "too_big";
  readonly origin: "number" | "int" | "bigint" | "date" | "string" | "array" | "set" | "file" | (string & {});
  readonly maximum: number | bigint;
  readonly inclusive?: boolean;
  readonly exact?: boolean;
  readonly input?: Input;
}
interface $ZodIssueTooSmall<Input = unknown> extends $ZodIssueBase {
  readonly code: "too_small";
  readonly origin: "number" | "int" | "bigint" | "date" | "string" | "array" | "set" | "file" | (string & {});
  readonly minimum: number | bigint;
  /** True if the allowable range includes the minimum */
  readonly inclusive?: boolean;
  /** True if the allowed value is fixed (e.g.` z.length(5)`), not a range (`z.minLength(5)`) */
  readonly exact?: boolean;
  readonly input?: Input;
}
interface $ZodIssueInvalidStringFormat extends $ZodIssueBase {
  readonly code: "invalid_format";
  readonly format: $ZodStringFormats | (string & {});
  readonly pattern?: string;
  readonly input?: string;
}
interface $ZodIssueNotMultipleOf<Input extends number | bigint = number | bigint> extends $ZodIssueBase {
  readonly code: "not_multiple_of";
  readonly divisor: number;
  readonly input?: Input;
}
interface $ZodIssueUnrecognizedKeys extends $ZodIssueBase {
  readonly code: "unrecognized_keys";
  readonly keys: string[];
  readonly input?: Record<string, unknown>;
}
interface $ZodIssueInvalidUnionNoMatch extends $ZodIssueBase {
  readonly code: "invalid_union";
  readonly errors: $ZodIssue[][];
  readonly input?: unknown;
  readonly discriminator?: string | undefined;
  readonly options?: Primitive[];
  readonly inclusive?: true;
}
interface $ZodIssueInvalidUnionMultipleMatch extends $ZodIssueBase {
  readonly code: "invalid_union";
  readonly errors: [];
  readonly input?: unknown;
  readonly discriminator?: string | undefined;
  readonly inclusive: false;
}
type $ZodIssueInvalidUnion = $ZodIssueInvalidUnionNoMatch | $ZodIssueInvalidUnionMultipleMatch;
interface $ZodIssueInvalidKey<Input = unknown> extends $ZodIssueBase {
  readonly code: "invalid_key";
  readonly origin: "map" | "record";
  readonly issues: $ZodIssue[];
  readonly input?: Input;
}
interface $ZodIssueInvalidElement<Input = unknown> extends $ZodIssueBase {
  readonly code: "invalid_element";
  readonly origin: "map" | "set";
  readonly key: unknown;
  readonly issues: $ZodIssue[];
  readonly input?: Input;
}
interface $ZodIssueInvalidValue<Input = unknown> extends $ZodIssueBase {
  readonly code: "invalid_value";
  readonly values: Primitive[];
  readonly input?: Input;
}
interface $ZodIssueCustom extends $ZodIssueBase {
  readonly code: "custom";
  readonly params?: Record<string, any> | undefined;
  readonly input?: unknown;
}
type $ZodIssue = $ZodIssueInvalidType | $ZodIssueTooBig | $ZodIssueTooSmall | $ZodIssueInvalidStringFormat | $ZodIssueNotMultipleOf | $ZodIssueUnrecognizedKeys | $ZodIssueInvalidUnion | $ZodIssueInvalidKey | $ZodIssueInvalidElement | $ZodIssueInvalidValue | $ZodIssueCustom;
type $ZodInternalIssue<T extends $ZodIssueBase = $ZodIssue> = T extends any ? RawIssue$1<T> : never;
type RawIssue$1<T extends $ZodIssueBase> = T extends any ? Flatten<MakePartial<T, "message" | "path"> & {
  /** The input data */readonly input: unknown; /** The schema or check that originated this issue. */
  readonly inst?: $ZodType | $ZodCheck; /** If `true`, Zod will continue executing checks/refinements after this issue. */
  readonly continue?: boolean | undefined;
} & Record<string, unknown>> : never;
type $ZodRawIssue<T extends $ZodIssueBase = $ZodIssue> = $ZodInternalIssue<T>;
interface $ZodErrorMap<T extends $ZodIssueBase = $ZodIssue> {
  (issue: $ZodRawIssue<T>): {
    message: string;
  } | string | undefined | null;
}
interface $ZodError<T = unknown> extends Error {
  type: T;
  issues: $ZodIssue[];
  _zod: {
    output: T;
    def: $ZodIssue[];
  };
  stack?: string;
  name: string;
}
declare const $ZodError: $constructor<$ZodError>;
type $ZodFlattenedError<T, U = string> = _FlattenedError<T, U>;
type _FlattenedError<T, U = string> = {
  formErrors: U[];
  fieldErrors: { [P in keyof T]?: U[] };
};
type _ZodFormattedError<T, U = string> = T extends [any, ...any[]] ? { [K in keyof T]?: $ZodFormattedError<T[K], U> } : T extends any[] ? {
  [k: number]: $ZodFormattedError<T[number], U>;
} : T extends object ? Flatten<{ [K in keyof T]?: $ZodFormattedError<T[K], U> }> : any;
type $ZodFormattedError<T, U = string> = {
  _errors: U[];
} & Flatten<_ZodFormattedError<T, U>>;
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.d.cts
type ZodTrait = {
  _zod: {
    def: any;
    [k: string]: any;
  };
};
interface $constructor<T extends ZodTrait, D = T["_zod"]["def"]> {
  new (def: D): T;
  init(inst: T, def: D): asserts inst is T;
}
declare function $constructor<T extends ZodTrait, D = T["_zod"]["def"]>(name: string, initializer: (inst: T, def: D) => void, params?: {
  Parent?: typeof Class;
}): $constructor<T, D>;
declare const $brand: unique symbol;
type $brand<T extends string | number | symbol = string | number | symbol> = {
  [$brand]: { [k in T]: true };
};
type $ZodBranded<T extends SomeType, Brand extends string | number | symbol, Dir extends "in" | "out" | "inout" = "out"> = T & (Dir extends "inout" ? {
  _zod: {
    input: input<T> & $brand<Brand>;
    output: output<T> & $brand<Brand>;
  };
} : Dir extends "in" ? {
  _zod: {
    input: input<T> & $brand<Brand>;
  };
} : {
  _zod: {
    output: output<T> & $brand<Brand>;
  };
});
type input<T> = T extends {
  _zod: {
    input: any;
  };
} ? T["_zod"]["input"] : unknown;
type output<T> = T extends {
  _zod: {
    output: any;
  };
} ? T["_zod"]["output"] : unknown;
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.d.cts
type Params<T extends $ZodType | $ZodCheck, IssueTypes extends $ZodIssueBase, OmitKeys extends keyof T["_zod"]["def"] = never> = Flatten<Partial<EmptyToNever<Omit<T["_zod"]["def"], OmitKeys> & ([IssueTypes] extends [never] ? {} : {
  error?: string | $ZodErrorMap<IssueTypes> | undefined; /** @deprecated This parameter is deprecated. Use `error` instead. */
  message?: string | undefined;
})>>>;
type TypeParams<T extends $ZodType = $ZodType & {
  _isst: never;
}, AlsoOmit extends Exclude<keyof T["_zod"]["def"], "type" | "checks" | "error"> = never> = Params<T, NonNullable<T["_zod"]["isst"]>, "type" | "checks" | "error" | AlsoOmit>;
type CheckParams<T extends $ZodCheck = $ZodCheck, // & { _issc: never },
AlsoOmit extends Exclude<keyof T["_zod"]["def"], "check" | "error"> = never> = Params<T, NonNullable<T["_zod"]["issc"]>, "check" | "error" | AlsoOmit>;
type CheckStringFormatParams<T extends $ZodStringFormat = $ZodStringFormat, AlsoOmit extends Exclude<keyof T["_zod"]["def"], "type" | "coerce" | "checks" | "error" | "check" | "format"> = never> = Params<T, NonNullable<T["_zod"]["issc"]>, "type" | "coerce" | "checks" | "error" | "check" | "format" | AlsoOmit>;
type CheckTypeParams<T extends $ZodType & $ZodCheck = $ZodType & $ZodCheck, AlsoOmit extends Exclude<keyof T["_zod"]["def"], "type" | "checks" | "error" | "check"> = never> = Params<T, NonNullable<T["_zod"]["isst"] | T["_zod"]["issc"]>, "type" | "checks" | "error" | "check" | AlsoOmit>;
type $ZodCheckEmailParams = CheckStringFormatParams<$ZodEmail, "when">;
type $ZodCheckGUIDParams = CheckStringFormatParams<$ZodGUID, "pattern" | "when">;
type $ZodCheckUUIDParams = CheckStringFormatParams<$ZodUUID, "pattern" | "when">;
type $ZodCheckURLParams = CheckStringFormatParams<$ZodURL, "when">;
type $ZodCheckEmojiParams = CheckStringFormatParams<$ZodEmoji, "when">;
type $ZodCheckNanoIDParams = CheckStringFormatParams<$ZodNanoID, "when">;
/**
 * @deprecated CUID v1 is deprecated by its authors due to information leakage
 * (timestamps embedded in the id). Use {@link _cuid2} instead.
 * See https://github.com/paralleldrive/cuid.
 */
type $ZodCheckCUIDParams = CheckStringFormatParams<$ZodCUID, "when">;
type $ZodCheckCUID2Params = CheckStringFormatParams<$ZodCUID2, "when">;
type $ZodCheckULIDParams = CheckStringFormatParams<$ZodULID, "when">;
type $ZodCheckXIDParams = CheckStringFormatParams<$ZodXID, "when">;
type $ZodCheckKSUIDParams = CheckStringFormatParams<$ZodKSUID, "when">;
type $ZodCheckIPv4Params = CheckStringFormatParams<$ZodIPv4, "pattern" | "when" | "version">;
type $ZodCheckIPv6Params = CheckStringFormatParams<$ZodIPv6, "pattern" | "when" | "version">;
type $ZodCheckCIDRv4Params = CheckStringFormatParams<$ZodCIDRv4, "pattern" | "when">;
type $ZodCheckCIDRv6Params = CheckStringFormatParams<$ZodCIDRv6, "pattern" | "when">;
type $ZodCheckBase64Params = CheckStringFormatParams<$ZodBase64, "pattern" | "when">;
type $ZodCheckBase64URLParams = CheckStringFormatParams<$ZodBase64URL, "pattern" | "when">;
type $ZodCheckE164Params = CheckStringFormatParams<$ZodE164, "when">;
type $ZodCheckJWTParams = CheckStringFormatParams<$ZodJWT, "pattern" | "when">;
type $ZodCheckISODateTimeParams = CheckStringFormatParams<$ZodISODateTime, "pattern" | "when">;
type $ZodCheckISODateParams = CheckStringFormatParams<$ZodISODate, "pattern" | "when">;
type $ZodCheckISOTimeParams = CheckStringFormatParams<$ZodISOTime, "pattern" | "when">;
type $ZodCheckISODurationParams = CheckStringFormatParams<$ZodISODuration, "when">;
type $ZodCheckMaxLengthParams = CheckParams<$ZodCheckMaxLength, "maximum" | "when">;
type $ZodCheckMinLengthParams = CheckParams<$ZodCheckMinLength, "minimum" | "when">;
type $ZodCheckLengthEqualsParams = CheckParams<$ZodCheckLengthEquals, "length" | "when">;
type $ZodCheckRegexParams = CheckParams<$ZodCheckRegex, "format" | "pattern" | "when">;
type $ZodCheckLowerCaseParams = CheckParams<$ZodCheckLowerCase, "format" | "when">;
type $ZodCheckUpperCaseParams = CheckParams<$ZodCheckUpperCase, "format" | "when">;
type $ZodCheckIncludesParams = CheckParams<$ZodCheckIncludes, "includes" | "format" | "when" | "pattern">;
type $ZodCheckStartsWithParams = CheckParams<$ZodCheckStartsWith, "prefix" | "format" | "when" | "pattern">;
type $ZodCheckEndsWithParams = CheckParams<$ZodCheckEndsWith, "suffix" | "format" | "pattern" | "when">;
type $ZodEnumParams = TypeParams<$ZodEnum, "entries">;
type $ZodNonOptionalParams = TypeParams<$ZodNonOptional, "innerType">;
type $ZodCustomParams = CheckTypeParams<$ZodCustom, "fn">;
type $ZodSuperRefineIssue<T extends $ZodIssueBase = $ZodIssue> = T extends any ? RawIssue<T> : never;
type RawIssue<T extends $ZodIssueBase> = T extends any ? Flatten<MakePartial<T, "message" | "path"> & {
  /** The schema or check that originated this issue. */readonly inst?: $ZodType | $ZodCheck; /** If `true`, Zod will execute subsequent checks/refinements instead of immediately aborting */
  readonly continue?: boolean | undefined;
} & Record<string, unknown>> : never;
interface $RefinementCtx<T = unknown> extends ParsePayload<T> {
  addIssue(arg: string | $ZodSuperRefineIssue): void;
}
interface $ZodSuperRefineParams {
  /** If provided, the refinement runs only when this returns `true`. By default, it is skipped if prior parsing produced aborting issues. */
  when?: ((payload: ParsePayload) => boolean) | undefined;
}
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.d.cts
/** An Error-like class used to store Zod validation issues.  */
interface ZodError<T = unknown> extends $ZodError<T> {
  /** @deprecated Use the `z.treeifyError(err)` function instead. */
  format(): $ZodFormattedError<T>;
  format<U>(mapper: (issue: $ZodIssue) => U): $ZodFormattedError<T, U>;
  /** @deprecated Use the `z.treeifyError(err)` function instead. */
  flatten(): $ZodFlattenedError<T>;
  flatten<U>(mapper: (issue: $ZodIssue) => U): $ZodFlattenedError<T, U>;
  /** @deprecated Push directly to `.issues` instead. */
  addIssue(issue: $ZodIssue): void;
  /** @deprecated Push directly to `.issues` instead. */
  addIssues(issues: $ZodIssue[]): void;
  /** @deprecated Check `err.issues.length === 0` instead. */
  isEmpty: boolean;
}
declare const ZodError: $constructor<ZodError>;
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.d.cts
type ZodSafeParseResult<T> = ZodSafeParseSuccess<T> | ZodSafeParseError<T>;
type ZodSafeParseSuccess<T> = {
  success: true;
  data: T;
  error?: never;
};
type ZodSafeParseError<T> = {
  success: false;
  data?: never;
  error: ZodError<T>;
};
//#endregion
//#region ../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.d.cts
type ZodStandardSchemaWithJSON<T> = StandardSchemaWithJSONProps<input<T>, output<T>>;
interface ZodType<out Output = unknown, out Input = unknown, out Internals extends $ZodTypeInternals<Output, Input> = $ZodTypeInternals<Output, Input>> extends $ZodType<Output, Input, Internals> {
  def: Internals["def"];
  type: Internals["def"]["type"];
  /** @deprecated Use `.def` instead. */
  _def: Internals["def"];
  /** @deprecated Use `z.output<typeof schema>` instead. */
  _output: Internals["output"];
  /** @deprecated Use `z.input<typeof schema>` instead. */
  _input: Internals["input"];
  "~standard": ZodStandardSchemaWithJSON<this>;
  /** Converts this schema to a JSON Schema representation. */
  toJSONSchema(params?: ToJSONSchemaParams): ZodStandardJSONSchemaPayload<this>;
  check(...checks: (CheckFn<output<this>> | $ZodCheck<output<this>>)[]): this;
  with(...checks: (CheckFn<output<this>> | $ZodCheck<output<this>>)[]): this;
  clone(def?: Internals["def"], params?: {
    parent: boolean;
  }): this;
  register<R extends $ZodRegistry>(registry: R, ...meta: this extends R["_schema"] ? undefined extends R["_meta"] ? [$replace<R["_meta"], this>?] : [$replace<R["_meta"], this>] : ["Incompatible schema"]): this;
  brand<T extends PropertyKey = PropertyKey, Dir extends "in" | "out" | "inout" = "out">(value?: T): PropertyKey extends T ? this : $ZodBranded<this, T, Dir>;
  parse(data: unknown, params?: ParseContext<$ZodIssue>): output<this>;
  safeParse(data: unknown, params?: ParseContext<$ZodIssue>): ZodSafeParseResult<output<this>>;
  parseAsync(data: unknown, params?: ParseContext<$ZodIssue>): Promise<output<this>>;
  safeParseAsync(data: unknown, params?: ParseContext<$ZodIssue>): Promise<ZodSafeParseResult<output<this>>>;
  spa: (data: unknown, params?: ParseContext<$ZodIssue>) => Promise<ZodSafeParseResult<output<this>>>;
  encode(data: output<this>, params?: ParseContext<$ZodIssue>): input<this>;
  decode(data: input<this>, params?: ParseContext<$ZodIssue>): output<this>;
  encodeAsync(data: output<this>, params?: ParseContext<$ZodIssue>): Promise<input<this>>;
  decodeAsync(data: input<this>, params?: ParseContext<$ZodIssue>): Promise<output<this>>;
  safeEncode(data: output<this>, params?: ParseContext<$ZodIssue>): ZodSafeParseResult<input<this>>;
  safeDecode(data: input<this>, params?: ParseContext<$ZodIssue>): ZodSafeParseResult<output<this>>;
  safeEncodeAsync(data: output<this>, params?: ParseContext<$ZodIssue>): Promise<ZodSafeParseResult<input<this>>>;
  safeDecodeAsync(data: input<this>, params?: ParseContext<$ZodIssue>): Promise<ZodSafeParseResult<output<this>>>;
  refine<Ch extends (arg: output<this>) => unknown | Promise<unknown>>(check: Ch, params?: string | $ZodCustomParams): Ch extends ((arg: any) => arg is infer R) ? this & ZodType<R, input<this>> : this;
  superRefine(refinement: (arg: output<this>, ctx: $RefinementCtx<output<this>>) => void | Promise<void>, params?: $ZodSuperRefineParams): this;
  overwrite(fn: (x: output<this>) => output<this>): this;
  optional(): ZodOptional<this>;
  exactOptional(): ZodExactOptional<this>;
  nonoptional(params?: string | $ZodNonOptionalParams): ZodNonOptional<this>;
  nullable(): ZodNullable<this>;
  nullish(): ZodOptional<ZodNullable<this>>;
  default(def: NoUndefined<output<this>>): ZodDefault<this>;
  default(def: () => NoUndefined<output<this>>): ZodDefault<this>;
  prefault(def: () => input<this>): ZodPrefault<this>;
  prefault(def: input<this>): ZodPrefault<this>;
  array(): ZodArray<this>;
  or<T extends SomeType>(option: T): ZodUnion<[this, T]>;
  and<T extends SomeType>(incoming: T): ZodIntersection<this, T>;
  transform<NewOut>(transform: (arg: output<this>, ctx: $RefinementCtx<output<this>>) => NewOut | Promise<NewOut>): ZodPipe<this, ZodTransform<Awaited<NewOut>, output<this>>>;
  catch(def: output<this>): ZodCatch<this>;
  catch(def: (ctx: $ZodCatchCtx) => output<this>): ZodCatch<this>;
  pipe<T extends $ZodType<any, output<this>>>(target: T | $ZodType<any, output<this>>): ZodPipe<this, T>;
  readonly(): ZodReadonly<this>;
  /** Returns a new instance that has been registered in `z.globalRegistry` with the specified description */
  describe(description: string): this;
  description?: string;
  /** Returns the metadata associated with this instance in `z.globalRegistry` */
  meta(): $replace<GlobalMeta, this> | undefined;
  /** Returns a new instance that has been registered in `z.globalRegistry` with the specified metadata */
  meta(data: $replace<GlobalMeta, this>): this;
  /** @deprecated Try safe-parsing `undefined` (this is what `isOptional` does internally):
   *
   * ```ts
   * const schema = z.string().optional();
   * const isOptional = schema.safeParse(undefined).success; // true
   * ```
   */
  isOptional(): boolean;
  /**
   * @deprecated Try safe-parsing `null` (this is what `isNullable` does internally):
   *
   * ```ts
   * const schema = z.string().nullable();
   * const isNullable = schema.safeParse(null).success; // true
   * ```
   */
  isNullable(): boolean;
  apply<T>(fn: (schema: this) => T): T;
}
interface _ZodType<out Internals extends $ZodTypeInternals = $ZodTypeInternals> extends ZodType<any, any, Internals> {}
declare const ZodType: $constructor<ZodType>;
interface _ZodString<T extends $ZodStringInternals<unknown> = $ZodStringInternals<unknown>> extends _ZodType<T> {
  format: string | null;
  minLength: number | null;
  maxLength: number | null;
  regex(regex: RegExp, params?: string | $ZodCheckRegexParams): this;
  includes(value: string, params?: string | $ZodCheckIncludesParams): this;
  startsWith(value: string, params?: string | $ZodCheckStartsWithParams): this;
  endsWith(value: string, params?: string | $ZodCheckEndsWithParams): this;
  min(minLength: number, params?: string | $ZodCheckMinLengthParams): this;
  max(maxLength: number, params?: string | $ZodCheckMaxLengthParams): this;
  length(len: number, params?: string | $ZodCheckLengthEqualsParams): this;
  nonempty(params?: string | $ZodCheckMinLengthParams): this;
  lowercase(params?: string | $ZodCheckLowerCaseParams): this;
  uppercase(params?: string | $ZodCheckUpperCaseParams): this;
  trim(): this;
  normalize(form?: "NFC" | "NFD" | "NFKC" | "NFKD" | (string & {})): this;
  toLowerCase(): this;
  toUpperCase(): this;
  slugify(): this;
}
/** @internal */
declare const _ZodString: $constructor<_ZodString>;
interface ZodString extends _ZodString<$ZodStringInternals<string>> {
  /** @deprecated Use `z.email()` instead. */
  email(params?: string | $ZodCheckEmailParams): this;
  /** @deprecated Use `z.url()` instead. */
  url(params?: string | $ZodCheckURLParams): this;
  /** @deprecated Use `z.jwt()` instead. */
  jwt(params?: string | $ZodCheckJWTParams): this;
  /** @deprecated Use `z.emoji()` instead. */
  emoji(params?: string | $ZodCheckEmojiParams): this;
  /** @deprecated Use `z.guid()` instead. */
  guid(params?: string | $ZodCheckGUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuid(params?: string | $ZodCheckUUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuidv4(params?: string | $ZodCheckUUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuidv6(params?: string | $ZodCheckUUIDParams): this;
  /** @deprecated Use `z.uuid()` instead. */
  uuidv7(params?: string | $ZodCheckUUIDParams): this;
  /** @deprecated Use `z.nanoid()` instead. */
  nanoid(params?: string | $ZodCheckNanoIDParams): this;
  /** @deprecated Use `z.guid()` instead. */
  guid(params?: string | $ZodCheckGUIDParams): this;
  /**
   * @deprecated CUID v1 is deprecated by its authors due to information leakage
   * (timestamps embedded in the id). Use `z.cuid2()` instead.
   * See https://github.com/paralleldrive/cuid.
   */
  cuid(params?: string | $ZodCheckCUIDParams): this;
  /** @deprecated Use `z.cuid2()` instead. */
  cuid2(params?: string | $ZodCheckCUID2Params): this;
  /** @deprecated Use `z.ulid()` instead. */
  ulid(params?: string | $ZodCheckULIDParams): this;
  /** @deprecated Use `z.base64()` instead. */
  base64(params?: string | $ZodCheckBase64Params): this;
  /** @deprecated Use `z.base64url()` instead. */
  base64url(params?: string | $ZodCheckBase64URLParams): this;
  /** @deprecated Use `z.xid()` instead. */
  xid(params?: string | $ZodCheckXIDParams): this;
  /** @deprecated Use `z.ksuid()` instead. */
  ksuid(params?: string | $ZodCheckKSUIDParams): this;
  /** @deprecated Use `z.ipv4()` instead. */
  ipv4(params?: string | $ZodCheckIPv4Params): this;
  /** @deprecated Use `z.ipv6()` instead. */
  ipv6(params?: string | $ZodCheckIPv6Params): this;
  /** @deprecated Use `z.cidrv4()` instead. */
  cidrv4(params?: string | $ZodCheckCIDRv4Params): this;
  /** @deprecated Use `z.cidrv6()` instead. */
  cidrv6(params?: string | $ZodCheckCIDRv6Params): this;
  /** @deprecated Use `z.e164()` instead. */
  e164(params?: string | $ZodCheckE164Params): this;
  /** @deprecated Use `z.iso.datetime()` instead. */
  datetime(params?: string | $ZodCheckISODateTimeParams): this;
  /** @deprecated Use `z.iso.date()` instead. */
  date(params?: string | $ZodCheckISODateParams): this;
  /** @deprecated Use `z.iso.time()` instead. */
  time(params?: string | $ZodCheckISOTimeParams): this;
  /** @deprecated Use `z.iso.duration()` instead. */
  duration(params?: string | $ZodCheckISODurationParams): this;
}
declare const ZodString: $constructor<ZodString>;
interface ZodStringFormat<Format extends string = string> extends _ZodString<$ZodStringFormatInternals<Format>> {}
declare const ZodStringFormat: $constructor<ZodStringFormat>;
interface ZodURL extends ZodStringFormat<"url"> {
  _zod: $ZodURLInternals;
}
declare const ZodURL: $constructor<ZodURL>;
interface _ZodBoolean<T extends $ZodBooleanInternals = $ZodBooleanInternals> extends _ZodType<T> {}
interface ZodBoolean extends _ZodBoolean<$ZodBooleanInternals<boolean>> {}
declare const ZodBoolean: $constructor<ZodBoolean>;
interface ZodArray<T extends SomeType = $ZodType> extends _ZodType<$ZodArrayInternals<T>>, $ZodArray<T> {
  element: T;
  min(minLength: number, params?: string | $ZodCheckMinLengthParams): this;
  nonempty(params?: string | $ZodCheckMinLengthParams): this;
  max(maxLength: number, params?: string | $ZodCheckMaxLengthParams): this;
  length(len: number, params?: string | $ZodCheckLengthEqualsParams): this;
  unwrap(): T;
  "~standard": ZodStandardSchemaWithJSON<this>;
}
declare const ZodArray: $constructor<ZodArray>;
type SafeExtendShape<Base extends $ZodShape, Ext extends $ZodLooseShape> = { [K in keyof Ext]: K extends keyof Base ? output<Ext[K]> extends output<Base[K]> ? input<Ext[K]> extends input<Base[K]> ? Ext[K] : never : never : Ext[K] };
interface ZodObject< /** @ts-ignore Cast variance */out Shape extends $ZodShape = $ZodLooseShape, out Config extends $ZodObjectConfig = $strip> extends _ZodType<$ZodObjectInternals<Shape, Config>>, $ZodObject<Shape, Config> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  shape: Shape;
  keyof(): ZodEnum<ToEnum<keyof Shape & string>>;
  /** Define a schema to validate all unrecognized keys. This overrides the existing strict/loose behavior. */
  catchall<T extends SomeType>(schema: T): ZodObject<Shape, $catchall<T>>;
  /** @deprecated Use `z.looseObject()` or `.loose()` instead. */
  passthrough(): ZodObject<Shape, $loose>;
  /** Consider `z.looseObject(A.shape)` instead */
  loose(): ZodObject<Shape, $loose>;
  /** Consider `z.strictObject(A.shape)` instead */
  strict(): ZodObject<Shape, $strict>;
  /** This is the default behavior. This method call is likely unnecessary. */
  strip(): ZodObject<Shape, $strip>;
  extend<U extends $ZodLooseShape>(shape: U): ZodObject<Extend<Shape, Writeable<U>>, Config>;
  safeExtend<U extends $ZodLooseShape>(shape: SafeExtendShape<Shape, U> & Partial<Record<keyof Shape, SomeType>>): ZodObject<Extend<Shape, Writeable<U>>, Config>;
  /**
   * @deprecated Use [`A.extend(B.shape)`](https://zod.dev/api?id=extend) instead.
   */
  merge<U extends ZodObject>(other: U): ZodObject<Extend<Shape, U["shape"]>, U["_zod"]["config"]>;
  pick<M extends Mask<keyof Shape>>(mask: M & Record<Exclude<keyof M, keyof Shape>, never>): ZodObject<Flatten<Pick<Shape, Extract<keyof Shape, keyof M>>>, Config>;
  omit<M extends Mask<keyof Shape>>(mask: M & Record<Exclude<keyof M, keyof Shape>, never>): ZodObject<Flatten<Omit<Shape, Extract<keyof Shape, keyof M>>>, Config>;
  partial(): ZodObject<{ -readonly [k in keyof Shape]: ZodOptional<Shape[k]> }, Config>;
  partial<M extends Mask<keyof Shape>>(mask: M & Record<Exclude<keyof M, keyof Shape>, never>): ZodObject<{ -readonly [k in keyof Shape]: k extends keyof M ? ZodOptional<Shape[k]> : Shape[k] }, Config>;
  required(): ZodObject<{ -readonly [k in keyof Shape]: ZodNonOptional<Shape[k]> }, Config>;
  required<M extends Mask<keyof Shape>>(mask: M & Record<Exclude<keyof M, keyof Shape>, never>): ZodObject<{ -readonly [k in keyof Shape]: k extends keyof M ? ZodNonOptional<Shape[k]> : Shape[k] }, Config>;
}
declare const ZodObject: $constructor<ZodObject>;
interface ZodUnion<T extends readonly SomeType[] = readonly $ZodType[]> extends _ZodType<$ZodUnionInternals<T>>, $ZodUnion<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  options: T;
}
declare const ZodUnion: $constructor<ZodUnion>;
interface ZodIntersection<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends _ZodType<$ZodIntersectionInternals<A, B>>, $ZodIntersection<A, B> {
  "~standard": ZodStandardSchemaWithJSON<this>;
}
declare const ZodIntersection: $constructor<ZodIntersection>;
interface ZodEnum< /** @ts-ignore Cast variance */out T extends EnumLike = EnumLike> extends _ZodType<$ZodEnumInternals<T>>, $ZodEnum<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  enum: T;
  options: Array<T[keyof T]>;
  extract<const U extends readonly (keyof T)[]>(values: U, params?: string | $ZodEnumParams): ZodEnum<Flatten<Pick<T, U[number]>>>;
  exclude<const U extends readonly (keyof T)[]>(values: U, params?: string | $ZodEnumParams): ZodEnum<Flatten<Omit<T, U[number]>>>;
}
declare const ZodEnum: $constructor<ZodEnum>;
interface ZodTransform<O = unknown, I = unknown> extends _ZodType<$ZodTransformInternals<O, I>>, $ZodTransform<O, I> {
  "~standard": ZodStandardSchemaWithJSON<this>;
}
declare const ZodTransform: $constructor<ZodTransform>;
interface ZodOptional<T extends SomeType = $ZodType> extends _ZodType<$ZodOptionalInternals<T>>, $ZodOptional<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
declare const ZodOptional: $constructor<ZodOptional>;
interface ZodExactOptional<T extends SomeType = $ZodType> extends _ZodType<$ZodExactOptionalInternals<T>>, $ZodExactOptional<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
declare const ZodExactOptional: $constructor<ZodExactOptional>;
interface ZodNullable<T extends SomeType = $ZodType> extends _ZodType<$ZodNullableInternals<T>>, $ZodNullable<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
declare const ZodNullable: $constructor<ZodNullable>;
interface ZodDefault<T extends SomeType = $ZodType> extends _ZodType<$ZodDefaultInternals<T>>, $ZodDefault<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
  /** @deprecated Use `.unwrap()` instead. */
  removeDefault(): T;
}
declare const ZodDefault: $constructor<ZodDefault>;
interface ZodPrefault<T extends SomeType = $ZodType> extends _ZodType<$ZodPrefaultInternals<T>>, $ZodPrefault<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
declare const ZodPrefault: $constructor<ZodPrefault>;
interface ZodNonOptional<T extends SomeType = $ZodType> extends _ZodType<$ZodNonOptionalInternals<T>>, $ZodNonOptional<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
declare const ZodNonOptional: $constructor<ZodNonOptional>;
interface ZodCatch<T extends SomeType = $ZodType> extends _ZodType<$ZodCatchInternals<T>>, $ZodCatch<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
  /** @deprecated Use `.unwrap()` instead. */
  removeCatch(): T;
}
declare const ZodCatch: $constructor<ZodCatch>;
interface ZodPipe<A extends SomeType = $ZodType, B extends SomeType = $ZodType> extends _ZodType<$ZodPipeInternals<A, B>>, $ZodPipe<A, B> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  in: A;
  out: B;
}
declare const ZodPipe: $constructor<ZodPipe>;
interface ZodReadonly<T extends SomeType = $ZodType> extends _ZodType<$ZodReadonlyInternals<T>>, $ZodReadonly<T> {
  "~standard": ZodStandardSchemaWithJSON<this>;
  unwrap(): T;
}
declare const ZodReadonly: $constructor<ZodReadonly>;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/zod-schema.proxy.d.ts
declare const ProxyConfigSchema: ZodOptional<ZodObject<{
  enabled: ZodOptional<ZodBoolean>;
  proxyUrl: ZodOptional<ZodURL>;
  tls: ZodOptional<ZodObject<{
    caFile: ZodOptional<ZodString>;
  }, $strict>>;
  loopbackMode: ZodOptional<ZodEnum<{
    block: "block";
    "gateway-only": "gateway-only";
    proxy: "proxy";
  }>>;
}, $strict>>;
type ProxyConfig = output<typeof ProxyConfigSchema>;
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/config/types.openclaw.d.ts
type SecurityAuditSuppression = {
  /** Exact security audit check id to suppress. */checkId: string; /** Optional case-insensitive substring required in the finding title. */
  titleIncludes?: string; /** Optional case-insensitive substring required in the finding detail. */
  detailIncludes?: string; /** Operator rationale for accepting this standing finding. */
  reason?: string;
};
type SecurityConfig = {
  audit?: {
    /** Accepted security audit findings to omit from active summary/findings. */suppressions?: SecurityAuditSuppression[];
  };
};
type SurfaceConfigEntry = {
  silentReply?: SilentReplyPolicyShape;
};
type OpenClawConfig = {
  $schema?: string;
  meta?: {
    /** Last OpenClaw version that wrote this config. */lastTouchedVersion?: string; /** ISO timestamp when this config was last written. */
    lastTouchedAt?: string;
  };
  auth?: AuthConfig;
  accessGroups?: AccessGroupsConfig;
  acp?: AcpConfig;
  env?: {
    /** Opt-in: import missing secrets from a login shell environment (exec `$SHELL -l -c 'env -0'`). */shellEnv?: {
      enabled?: boolean; /** Timeout for the login shell exec (ms). Default: 15000. */
      timeoutMs?: number;
    }; /** Inline env vars to apply when not already present in the process env. */
    vars?: Record<string, string>; /** Sugar: allow env vars directly under env (string values only). */
    [key: string]: string | Record<string, string> | {
      enabled?: boolean;
      timeoutMs?: number;
    } | undefined;
  };
  wizard?: {
    lastRunAt?: string;
    lastRunVersion?: string;
    lastRunCommit?: string;
    lastRunCommand?: string;
    lastRunMode?: "local" | "remote";
  };
  diagnostics?: DiagnosticsConfig;
  logging?: LoggingConfig;
  security?: SecurityConfig;
  cli?: CliConfig;
  crestodian?: CrestodianConfig;
  update?: {
    /** Update channel for git + npm installs ("stable", "beta", or "dev"). */channel?: "stable" | "beta" | "dev"; /** Check for updates on gateway start (npm installs only). */
    checkOnStart?: boolean; /** Core auto-update policy for package installs. */
    auto?: {
      /** Enable background auto-update checks and apply logic. Default: false. */enabled?: boolean; /** Stable channel minimum delay before auto-apply. Default: 6. */
      stableDelayHours?: number; /** Additional stable-channel jitter window. Default: 12. */
      stableJitterHours?: number; /** Beta channel check cadence. Default: 1 hour. */
      betaCheckIntervalHours?: number;
    };
  };
  browser?: BrowserConfig;
  ui?: {
    /** Accent color for OpenClaw UI chrome (hex). */seamColor?: string;
    assistant?: {
      /** Assistant display name for UI surfaces. */name?: string; /** Assistant avatar (emoji, short text, or image URL/data URI). */
      avatar?: string;
    };
  };
  secrets?: SecretsConfig;
  skills?: SkillsConfig;
  plugins?: PluginsConfig;
  surfaces?: Record<string, SurfaceConfigEntry>;
  models?: ModelsConfig;
  nodeHost?: NodeHostConfig;
  agents?: AgentsConfig;
  tools?: ToolsConfig;
  bindings?: AgentBinding[];
  broadcast?: BroadcastConfig;
  audio?: AudioConfig;
  media?: {
    /** Preserve original uploaded filenames when storing inbound media. */preserveFilenames?: boolean; /** Optional retention window for persisted inbound media cleanup. */
    ttlHours?: number;
  };
  messages?: MessagesConfig;
  commands?: CommandsConfig;
  approvals?: ApprovalsConfig;
  session?: SessionConfig;
  web?: WebConfig;
  channels?: ChannelsConfig;
  cron?: CronConfig;
  commitments?: CommitmentsConfig;
  hooks?: HooksConfig;
  discovery?: DiscoveryConfig;
  talk?: TalkConfig;
  gateway?: GatewayConfig;
  memory?: MemoryConfig;
  mcp?: McpConfig; /** Network-level SSRF protection via an operator-managed forward proxy. */
  proxy?: ProxyConfig;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/runtime.d.ts
type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};
//#endregion
//#region ../node_modules/.pnpm/openclaw@2026.5.20_encoding@0.1.13/node_modules/openclaw/dist/plugin-sdk/src/flows/health-checks.d.ts
type HealthFindingSeverity = "info" | "warning" | "error";
interface HealthFinding {
  readonly checkId: string;
  readonly severity: HealthFindingSeverity;
  readonly message: string;
  readonly source?: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly ocPath?: string;
  readonly target?: string;
  readonly requirement?: string;
  readonly fixHint?: string;
}
type HealthCheckMode = "doctor" | "lint" | "fix";
interface HealthCheckContext {
  readonly mode: HealthCheckMode;
  readonly runtime: RuntimeEnv;
  readonly cfg: OpenClawConfig;
  readonly cwd?: string;
  readonly configPath?: string;
}
interface HealthRepairContext extends Omit<HealthCheckContext, "mode"> {
  readonly mode: "fix";
  readonly dryRun?: boolean;
  readonly diff?: boolean;
}
interface HealthRepairDiff {
  readonly kind: "config" | "file";
  readonly path: string;
  readonly before?: string;
  readonly after?: string;
  readonly unifiedDiff?: string;
}
interface HealthRepairEffect {
  readonly kind: "config" | "file" | "service" | "process" | "package" | "state" | "other";
  readonly action: string;
  readonly target?: string;
  readonly dryRunSafe?: boolean;
}
interface HealthRepairResult {
  readonly status?: "repaired" | "skipped" | "failed";
  readonly reason?: string;
  readonly config?: OpenClawConfig;
  readonly changes: readonly string[];
  readonly warnings?: readonly string[];
  readonly diffs?: readonly HealthRepairDiff[];
  readonly effects?: readonly HealthRepairEffect[];
}
interface HealthCheckScope {
  readonly findings?: readonly HealthFinding[];
  readonly paths?: readonly string[];
  readonly ocPaths?: readonly string[];
}
interface HealthCheck {
  readonly id: string;
  readonly kind: "core" | "plugin";
  readonly description: string;
  readonly source?: string;
  detect(ctx: HealthCheckContext, scope?: HealthCheckScope): Promise<readonly HealthFinding[]>;
  repair?(ctx: HealthRepairContext, findings: readonly HealthFinding[]): Promise<HealthRepairResult>;
}
//#endregion
//#region extensions/policy/src/doctor/register.d.ts
type PolicyDoctorRegistrationHost = {
  readonly registerHealthCheck: (check: HealthCheck) => void;
};
declare function registerPolicyDoctorChecks(host?: PolicyDoctorRegistrationHost): void;
//#endregion
export { registerPolicyDoctorChecks };