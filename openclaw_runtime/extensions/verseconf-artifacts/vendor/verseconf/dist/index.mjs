/**
 * VerseConf JavaScript 包。
 *
 * 这个包不重新实现任何能力：它加载的是与本机二进制 `verseconf-mcp`
 * 完全相同的 Rust 实现编译出的 WebAssembly 模块，因此同一份输入在
 * 「本机原生二进制」与「wasm 模块」上返回完全相同的 JSON。
 *
 * 宿主只需要一个 JS 运行时（Agent 宿主本来就带），不需要 Rust 工具链，
 * 也不需要安装任何本机二进制。注意：本包**未发布到 npm**，用之前要先从源码构建。
 *
 * ## 两个消费面（不要混用）
 *
 * - **旧消费面**：MCP 工具信封。`validate`／`audit`／`applyEdit`／`editRange`／
 *   `checkWrite` 返回 `{ content, structuredContent, isError }`，与本机
 *   `verseconf-mcp` 逐字节一致；按配置文本（`.vcf`／TOML／JSON）工作。
 * - **新消费面**：业务结果（B05）。`inspectDocument`／`inspectRecord`／`applyBatch`／
 *   `validateTrustedCandidate`／`capability` 返回判别联合
 *   `{ apiVersion, ok, op, result }` 或 `{ apiVersion, ok:false, code, stage, message }`。
 *   只接受**严格 JSON**，且所有范围都是 UTF-8 字节区间 `[startByte, endByte)`。
 *
 * 两种形状结构上不重叠：业务结果里没有 `content`／`structuredContent`／`isError`，
 * 宿主不会把「MCP 信封里的 structuredContent」和「业务结果」看成一回事。
 *
 * ```js
 * const { validate, applyBatch, sliceUtf8Bytes, isBusinessOk } = require('verseconf');
 * validate('port = 8080\n');            // 旧：{ isError: false, structuredContent: { valid: true, ... } }
 * const outcome = applyBatch({          // 新：按 ok / code / stage 分支
 *   source: '{"records":[{"recordId":"rec-a","finding":"旧"}]}',
 *   format: 'json',
 *   changes: [{ recordId: 'rec-a', fieldPath: ['finding'], op: 'setValue', value: '新' }],
 * });
 * if (!isBusinessOk(outcome)) throw new Error(`${outcome.stage}/${outcome.code}`);
 * sliceUtf8Bytes(outcome.result.candidate, ...outcome.result.setRanges[0]);
 * ```
 */
import glue from '../pkg/verseconf_wasm.js';
/** 校验配置：解析 + 结构/schema 校验 */
export const TOOL_VALIDATE = 'verseconf_validate';
/** 安全审计：敏感数据与不安全配置检查 */
export const TOOL_AUDIT = 'verseconf_audit';
/** 意图应用：按编辑计划做确定性最小改动 */
export const TOOL_APPLY_EDIT = 'verseconf_apply_edit';
/** 区间编辑：对指定字节区间做替换，走同一套写入前校验 */
export const TOOL_EDIT_RANGE = 'verseconf_edit_range';
export const TOOL_CHECK_WRITE = 'verseconf_check_write';
function callTool(name, args) {
    return JSON.parse(glue.call_tool_json(name, JSON.stringify(args ?? {})));
}
/** 校验配置文本，返回与原生命令行/工具协议一致的结构化诊断 */
export function validate(source, options = {}) {
    return callTool(TOOL_VALIDATE, {
        source,
        strict: options.strict === true,
    });
}
/** 安全审计配置文本 */
export function audit(source) {
    return callTool(TOOL_AUDIT, { source });
}
/** 按编辑意图契约做确定性最小改动（不写文件，只返回改动后的文本） */
export function applyEdit(source, plan) {
    return callTool(TOOL_APPLY_EDIT, { source, plan });
}
/** 区间编辑原语：把 [start, end) 替换为 replacement */
export function editRange(source, start, end, replacement) {
    return callTool(TOOL_EDIT_RANGE, { source, start, end, replacement });
}
/**
 * `verseconf_check_write` 在工具契约里**声明过的全部参数名**。
 *
 * 转发逐条按声明名做，不做任何名字转换：契约里叫 `schema_format`，JS 就必须传
 * `schema_format`。调研 §4.7 实测到的缺陷正是这里——旧绑定只转发了 `schema` 与
 * `format`，`schema_format`／`schema_draft` 被丢掉，一份合法的标准 JSON Schema
 * 请求被当成 `#@schema` 语言解释，于是「合法请求被拒」而调用方看不出原因。
 */
export const CHECK_WRITE_ARGUMENTS = [
    'schema',
    'schema_format',
    'schema_draft',
    'schema_from_config',
    'base_dir',
    'allow_unresolved_schema',
    'schema_url_map',
    'format',
];
/**
 * 没声明的选项**直接抛**，不静默丢掉。
 *
 * 静默丢掉是最糟的一种：调用方把 `schema_format` 拼成 `schemaFormat`，工具收不到
 * 参数、按默认值跑了一遍，结果看起来是「检查过了」。宁可这里立刻失败。
 */
function rejectUnknownOptions(options, allowed, what) {
    const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new TypeError(`${what} 收到没声明的选项：${unknown.join(', ')}（声明过的选项是 ${allowed.join(', ')}）`);
    }
}
/** 写前检查：给定原文与候选文本，判断这次改动是否允许落盘（不产生改动） */
export function checkWrite(baseline, candidate, options = {}) {
    rejectUnknownOptions(options, CHECK_WRITE_ARGUMENTS, 'checkWrite');
    const forwarded = {};
    for (const name of CHECK_WRITE_ARGUMENTS) {
        const value = options[name];
        if (value !== undefined) {
            forwarded[name] = value;
        }
    }
    return callTool(TOOL_CHECK_WRITE, { baseline, candidate, ...forwarded });
}
/** `tools/list` 的五个工具描述 */
export function tools() {
    return JSON.parse(glue.tools_json()).tools;
}
/** 服务端名称、版本与协议版本 */
export function serverInfo() {
    return JSON.parse(glue.server_info_json());
}
/** wasm 模块自身的版本号 */
export function getVersion() {
    return glue.version();
}
/**
 * 逐行 JSON-RPC 会话，行为与原生 `verseconf-mcp` 的 stdio 会话一致。
 *
 * 宿主可以用它把 MCP 协议桥到任何自己的传输层上。
 */
export class McpSession {
    constructor() {
        this.server = new glue.WasmMcpServer();
    }
    /** 处理一行输入；通知（无 `id`）与空行返回 undefined */
    handleLine(line) {
        return this.server.handle_line(line);
    }
    /** 宿主是否已经完成 `initialize` 握手 */
    isInitialized() {
        return this.server.is_initialized();
    }
}
/** 值访问：解析一次，然后按路径取值 */
export class VerseConf {
    constructor(source) {
        this.wasm = new glue.VerseConf(source);
    }
    getString(path) {
        return this.wasm.get_string(path);
    }
    getNumber(path) {
        return this.wasm.get_number(path);
    }
    getBoolean(path) {
        return this.wasm.get_boolean(path);
    }
    hasKey(path) {
        return this.wasm.has_key(path);
    }
    toJson() {
        return this.wasm.to_json();
    }
    validate() {
        return this.wasm.validate();
    }
}
/** 解析配置文本，解析失败时抛出 */
export function parseConfig(source) {
    return new VerseConf(source);
}
/** 解析配置文本并直接返回 JSON 对象 */
export function parseJson(source) {
    return JSON.parse(glue.parse_config(source));
}
/* ================================================================== *
 * 业务 API（B05 / TF-0135）
 *
 * 上面那些函数是**旧消费面**：返回 MCP 工具信封 `{ content, structuredContent, isError }`。
 * 下面是**新消费面**：返回判别联合，按 `ok` / `code` / `stage` 分支，不去解析中文 message。
 * 两种形状结构上不重叠——业务结果里没有 `content`／`structuredContent`／`isError`。
 * ================================================================== */
/** 业务 API 版本；宿主应当与自己的期望比对，而不是靠字段猜 */
export const BUSINESS_API_VERSION = 1;
export function isBusinessOk(outcome) {
    return outcome.ok === true;
}
export const BYTE_RANGE_CONVENTION = '所有范围都是 UTF-8 半开字节区间 [startByte, endByte)；请用 sliceUtf8Bytes 取原文，不要用 String.slice';
/** 按 UTF-8 字节区间取原文片段；越界或非整数直接抛，不静默截断 */
export function sliceUtf8Bytes(source, startByte, endByte) {
    const bytes = Buffer.from(source, 'utf8');
    if (!Number.isInteger(startByte) ||
        !Number.isInteger(endByte) ||
        startByte < 0 ||
        endByte < startByte ||
        endByte > bytes.length) {
        throw new RangeError(`字节区间 [${startByte}, ${endByte}) 越界：原文共 ${bytes.length} 字节`);
    }
    return bytes.subarray(startByte, endByte).toString('utf8');
}
/** 业务 API 版本号 */
export function businessApiVersion() {
    return glue.business_api_version();
}
/**
 * 按操作名调用（`capability`／`inspect_document`／`inspect_record`／`apply_batch`／
 * `validate_trusted_candidate`）。未知操作返回 `invalid_request`／`stage: "tool"`。
 */
export function businessCall(op, request = {}) {
    return JSON.parse(glue.business_call_json(op, JSON.stringify(request ?? {})));
}
/** 能力声明：这一层到底提供什么、不提供什么，以及四个上限 */
export function capability() {
    return JSON.parse(glue.business_capability_json());
}
/** 按路径做纯内存读取；命中带 UTF-8 字节区间 */
export function inspectDocument(request) {
    return JSON.parse(glue.business_inspect_document_json(JSON.stringify(request)));
}
/** 按**稳定记录 ID** 做有界读取与字段定位（不按数组下标，重排不影响身份） */
export function inspectRecord(request) {
    return JSON.parse(glue.business_inspect_record_json(JSON.stringify(request)));
}
/** 同基线多字段批次候选：失败整批拒绝，调用方拿不到半成品 */
export function applyBatch(request) {
    return JSON.parse(glue.business_apply_batch_json(JSON.stringify(request)));
}
/**
 * 用**可信 schema** 裁决候选。
 *
 * 与 `checkWrite` 的区别不是「多一个参数」：这里 schema 必须带身份
 * （`schemaId`／`version`／`digest`／`draft`），`digest` 会被实算比对，`draft` 必须
 * 显式固定；没打包进来的 `$ref` 一律拒绝。配置安全启发式只出现在 `advisories` 里，
 * **不影响** `accepted`。
 */
export function validateTrustedCandidate(request) {
    return JSON.parse(glue.business_validate_trusted_candidate_json(JSON.stringify(request)));
}
// 兼容旧版入口：原样再导出 wasm 层符号。
export const VerseConfWasm = glue.VerseConf;
export const wasmParse = glue.parse_config;
export const wasmVersion = glue.version;
