/* tslint:disable */
/* eslint-disable */

export class VerseConf {
    free(): void;
    [Symbol.dispose](): void;
    get_boolean(path: string): boolean | undefined;
    get_number(path: string): number | undefined;
    get_string(path: string): string | undefined;
    has_key(path: string): boolean;
    constructor(source: string);
    to_json(): string;
    /**
     * 校验这份配置。
     *
     * 之前这里是 `true` 硬编码桩：任何输入都返回"合法"，包括完全无法解析的
     * 文本。它虽然不在这条分发路径的主干上（宿主走 `call_tool_json` 调用
     * 共享工具层），但它是**公开导出**的，直接调用会得到假阳性结论。
     * 现在改为复用 MCP 工具层的同一份校验实现，与 CLI / wasm / 原生服务端一致。
     */
    validate(): boolean;
}

/**
 * wasm 版的 MCP 会话：与原生 stdio 服务端逐行处理完全一致。
 */
export class WasmMcpServer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * 处理一行 JSON-RPC 输入。
     *
     * 通知（没有 `id`）与空行返回 `undefined`，调用方不需要回写任何内容。
     */
    handle_line(line: string): string | undefined;
    /**
     * 宿主是否已经完成 `initialize` 握手
     */
    is_initialized(): boolean;
    constructor();
}

export function business_api_version(): number;

export function business_apply_batch_json(request_json: string): string;

/**
 * 按操作名调用。未知操作返回 `invalid_request`（`stage: "tool"`），不猜。
 *
 * 有了它，「从新源码构建出的 wasm」可以重放任意一条业务请求——跨目标一致性校验
 * 用的就是这条通道，而不是逐个操作的包装函数。
 */
export function business_call_json(op: string, request_json: string): string;

export function business_capability_json(): string;

export function business_inspect_document_json(request_json: string): string;

export function business_inspect_record_json(request_json: string): string;

export function business_validate_trusted_candidate_json(request_json: string): string;

/**
 * 直接调用一个工具，返回与 `tools/call` 完全相同的结果信封。
 *
 * 参数是 JSON 文本（对象）。`arguments_json` 不是合法 JSON 时返回 `Err`，
 * 因为那是调用方的序列化错误，不是工具的执行失败——与协议层把 JSON 解析
 * 失败当作 JSON-RPC error 的处理保持一致。
 */
export function call_tool_json(name: string, arguments_json: string): string;

export function parse_config(source: string): any;

/**
 * 服务端自述信息，宿主可用它做版本核对。
 */
export function server_info_json(): string;

export function start(): void;

/**
 * `tools/list` 的结果，与原生命令行/stdio 服务端逐字节一致。
 */
export function tools_json(): string;

export function version(): string;

/**
 * 当前 wasm 线性内存大小（字节）。
 *
 * 为什么必须有这个访问器（A07 的明文要求）：wasm 线性内存由模块自己按 64 KiB 页增长，
 * **worker 的 `resourceLimits` 管不到它**（那只管 V8 堆与老生代），而宿主能读到的
 * `process.memoryUsage().arrayBuffers` 是**进程级**的——多个 worker 并存时它既包含别人的内存，
 * 也会因为别人退出而突然变小，无法用来判这一个实例。实测里这一点很直白：同一批样本里它
 * 一会儿报 4.2 MiB、一会儿报 0.0 MiB，两个数都不是这个 worker 的真实线性内存。
 *
 * 所以内存上限必须由模块自己报数：`memory_size(0)` 是当前页数，乘 64 KiB 就是真实字节数。
 * 原生目标没有线性内存可言，返回 0.0（宿主只在 wasm 里用它）。
 */
export function wasm_memory_bytes(): number;
