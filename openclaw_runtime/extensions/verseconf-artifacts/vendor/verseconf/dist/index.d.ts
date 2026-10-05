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
export declare const TOOL_VALIDATE = "verseconf_validate";
/** 安全审计：敏感数据与不安全配置检查 */
export declare const TOOL_AUDIT = "verseconf_audit";
/** 意图应用：按编辑计划做确定性最小改动 */
export declare const TOOL_APPLY_EDIT = "verseconf_apply_edit";
/** 区间编辑：对指定字节区间做替换，走同一套写入前校验 */
export declare const TOOL_EDIT_RANGE = "verseconf_edit_range";
export declare const TOOL_CHECK_WRITE = "verseconf_check_write";
/** 工具返回的文本内容块 */
export interface ToolContent {
    type: 'text';
    text: string;
}
/** 工具失败时的结构化原因 */
export interface ToolError {
    code: string;
    message: string;
    details: unknown;
}
/** `tools/call` 的结果信封，与原生 stdio 服务端逐字节一致 */
export interface ToolResult<T> {
    content: ToolContent[];
    structuredContent: T | ToolError;
    isError: boolean;
}
/** 宿主可发现的一个工具 */
export interface ToolDescriptor {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
/** 服务端自述信息 */
export interface ServerInfo {
    name: string;
    version: string;
    protocolVersion: string;
}
export interface Diagnostic {
    code: string;
    message: string;
    line: number;
    column: number;
}
export interface ValidateResult {
    valid: boolean;
    diagnostics: Diagnostic[];
}
export interface AuditFinding {
    rule_id: string;
    severity: string;
    category: string;
    title: string;
    description: string;
    location: string;
    recommendation: string;
}
export interface AuditSummary {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
}
export interface AuditResult {
    findings: AuditFinding[];
    summary: AuditSummary;
}
export interface AppliedEdit {
    op: string;
    path: string;
    before: string | null;
    after: string | null;
    reason: string | null;
}
export interface ApplyEditResult {
    source: string;
    applied: AppliedEdit[];
}
export interface ReplacedRange {
    start: number;
    end: number;
    before: string;
    after: string;
}
export interface EditRangeResult {
    source: string;
    replaced: ReplacedRange;
}
export interface CheckWriteResult {
    allowed: true;
    format: 'vcf' | 'toml' | 'json' | 'jsonc';
    baseline_bytes: number;
    candidate_bytes: number;
}
/**
 * 编辑计划（意图契约）。完整定义见
 * `crates/verseconf-core/schemas/edit-plan.schema.json`。
 *
 * 列表按名称而不是下标定位，且只替换目标值的字节区间。
 */
export interface EditPlan {
    version: string;
    edits: Array<Record<string, unknown>>;
}
/** 校验配置文本，返回与原生命令行/工具协议一致的结构化诊断 */
export declare function validate(source: string, options?: {
    strict?: boolean;
}): ToolResult<ValidateResult>;
/** 安全审计配置文本 */
export declare function audit(source: string): ToolResult<AuditResult>;
/** 按编辑意图契约做确定性最小改动（不写文件，只返回改动后的文本） */
export declare function applyEdit(source: string, plan: EditPlan | string): ToolResult<ApplyEditResult>;
/** 区间编辑原语：把 [start, end) 替换为 replacement */
export declare function editRange(source: string, start: number, end: number, replacement: string): ToolResult<EditRangeResult>;
/**
 * `verseconf_check_write` 在工具契约里**声明过的全部参数名**。
 *
 * 转发逐条按声明名做，不做任何名字转换：契约里叫 `schema_format`，JS 就必须传
 * `schema_format`。调研 §4.7 实测到的缺陷正是这里——旧绑定只转发了 `schema` 与
 * `format`，`schema_format`／`schema_draft` 被丢掉，一份合法的标准 JSON Schema
 * 请求被当成 `#@schema` 语言解释，于是「合法请求被拒」而调用方看不出原因。
 */
export declare const CHECK_WRITE_ARGUMENTS: readonly ["schema", "schema_format", "schema_draft", "schema_from_config", "base_dir", "allow_unresolved_schema", "schema_url_map", "format"];
export interface CheckWriteOptions {
    /** 旁挂 schema 文本 */
    schema?: string;
    /** 旁挂 schema 用的是哪种语言；默认 vcf（自建 `#@schema` 语言） */
    schema_format?: 'vcf' | 'json-schema';
    /** 标准 JSON Schema 的方言；默认 auto */
    schema_draft?: 'auto' | 'draft-07' | '2020-12';
    /** 按配置自己的顶层 `$schema` 去取 schema（默认 false） */
    schema_from_config?: boolean;
    /** `$schema` 是相对路径时的基准目录 */
    base_dir?: string;
    /** 取不到 schema 时是否降级为「只做结构与安全校验」（默认 false = 拒绝） */
    allow_unresolved_schema?: boolean;
    /** `$schema` URL → 本地 schema 文件路径；本绑定自己不抓网络 */
    schema_url_map?: Record<string, string>;
    /** 候选文本的格式；默认 vcf */
    format?: 'vcf' | 'toml' | 'json' | 'jsonc';
}
/** 写前检查：给定原文与候选文本，判断这次改动是否允许落盘（不产生改动） */
export declare function checkWrite(baseline: string, candidate: string, options?: CheckWriteOptions): ToolResult<CheckWriteResult>;
/** `tools/list` 的五个工具描述 */
export declare function tools(): ToolDescriptor[];
/** 服务端名称、版本与协议版本 */
export declare function serverInfo(): ServerInfo;
/** wasm 模块自身的版本号 */
export declare function getVersion(): string;
/**
 * 逐行 JSON-RPC 会话，行为与原生 `verseconf-mcp` 的 stdio 会话一致。
 *
 * 宿主可以用它把 MCP 协议桥到任何自己的传输层上。
 */
export declare class McpSession {
    private server;
    constructor();
    /** 处理一行输入；通知（无 `id`）与空行返回 undefined */
    handleLine(line: string): string | undefined;
    /** 宿主是否已经完成 `initialize` 握手 */
    isInitialized(): boolean;
}
/** 值访问：解析一次，然后按路径取值 */
export declare class VerseConf {
    private wasm;
    constructor(source: string);
    getString(path: string): string | undefined;
    getNumber(path: string): number | undefined;
    getBoolean(path: string): boolean | undefined;
    hasKey(path: string): boolean;
    toJson(): string;
    validate(): boolean;
}
/** 解析配置文本，解析失败时抛出 */
export declare function parseConfig(source: string): VerseConf;
/** 解析配置文本并直接返回 JSON 对象 */
export declare function parseJson(source: string): unknown;
/** 业务 API 版本；宿主应当与自己的期望比对，而不是靠字段猜 */
export declare const BUSINESS_API_VERSION = 1;
/**
 * 结果所在的层（调研 §6.3）。
 *
 * - `tool`：请求本身不成立（绑定没能构造出一次调用），`code` 恒为 `invalid_request`
 * - `input`：输入／选择层——格式、大小、深度、重复键、定位缺失或歧义、未知操作
 * - `candidate`：候选层——期望不符、候选不满足可信 schema
 * - `schema`：可信 schema 资产层——身份不符、方言／关键字不受支持、引用取不到
 */
export type BusinessStage = 'tool' | 'input' | 'candidate' | 'schema';
export interface BusinessOk<T> {
    apiVersion: number;
    ok: true;
    op: string;
    result: T;
}
export interface BusinessErr {
    apiVersion: number;
    ok: false;
    op: string;
    code: string;
    stage: BusinessStage;
    message: string;
    path?: string;
}
export type BusinessOutcome<T> = BusinessOk<T> | BusinessErr;
export declare function isBusinessOk<T>(outcome: BusinessOutcome<T>): outcome is BusinessOk<T>;
/**
 * UTF-8 字节区间 `[startByte, endByte)`。
 *
 * 名字里带 `Byte` 是刻意的：JS 字符串下标是 **UTF-16 码元**，中文、emoji、组合字符下
 * 与字节位置不同。要取原文片段请用 {@link sliceUtf8Bytes}，不要用 `source.slice`。
 */
export interface ByteRange {
    startByte: number;
    endByte: number;
}
export declare const BYTE_RANGE_CONVENTION = "\u6240\u6709\u8303\u56F4\u90FD\u662F UTF-8 \u534A\u5F00\u5B57\u8282\u533A\u95F4 [startByte, endByte)\uFF1B\u8BF7\u7528 sliceUtf8Bytes \u53D6\u539F\u6587\uFF0C\u4E0D\u8981\u7528 String.slice";
/** 按 UTF-8 字节区间取原文片段；越界或非整数直接抛，不静默截断 */
export declare function sliceUtf8Bytes(source: string, startByte: number, endByte: number): string;
export interface BusinessDiagnostic {
    label?: string;
    code: string;
    message: string;
    path?: string;
}
export interface InspectMatch extends ByteRange {
    label: string;
    path: string[];
    kind: string;
}
export interface InspectDocumentResult {
    contractVersion: number;
    rootKind: string;
    matches: InspectMatch[];
    diagnostics: BusinessDiagnostic[];
    diagnosticsTruncated: boolean;
}
export interface RecordField {
    presence: 'present' | 'null' | 'missing';
    kind?: string;
    startByte?: number;
    endByte?: number;
}
export interface RecordMatch {
    recordId: string;
    /** 仅作诊断：定位不依赖下标，数组重排后它会变而记录身份不变 */
    recordIndex: number;
    recordStartByte: number;
    recordEndByte: number;
    field: RecordField;
}
export interface InspectRecordResult {
    contractVersion: number;
    recordsScanned: number;
    matches: RecordMatch[];
    diagnostics: BusinessDiagnostic[];
    diagnosticsTruncated: boolean;
}
export interface ApplyBatchResult {
    contractVersion: number;
    candidate: string;
    applied: number;
    deleted: number;
    /** 每个 set 目标在**候选**里的字节区间 */
    setRanges: ByteRange[];
}
export interface TrustedSchemaDiagnostic {
    code: string;
    path: string;
    message: string;
}
export interface TrustedSchemaAdvisory {
    origin: string;
    code: string;
    message: string;
}
export interface TrustedSchemaCheckResult {
    contractVersion: number;
    checker: string;
    accepted: boolean;
    schemaId: string;
    schemaVersion: string;
    schemaDigest: string;
    schemaDraft: string;
    schemaBytes: number;
    baselineDigest: string;
    candidateDigest: string;
    changedSinceBaseline: boolean;
    diagnostics: TrustedSchemaDiagnostic[];
    diagnosticsTruncated: boolean;
    /** 配置安全启发式的命中项：**只是建议**，不影响 `accepted` */
    advisories: TrustedSchemaAdvisory[];
    bundledUris: string[];
}
export interface CapabilityResult {
    contractVersion: number;
    businessApiVersion: number;
    resultShape: string;
    operations: string[];
    ops: string[];
    acceptedFormats: string[];
    rejectedFormats: string[];
    sourceBytesMax: number;
    schemaBytesMax: number;
    depthMax: number;
    opsPerBatchMax: number;
    diagnosticsMax: number;
    schemaIdentityFields: string[];
    schemaDrafts: string[];
    schemaDigestAlgorithm: string;
    schemaRefSources: string[];
    fetchesExternalSchema: boolean;
    configHeuristicsBlocking: boolean;
    readsFiles: boolean;
    fetchesUrls: boolean;
    accessesSession: boolean;
    writesDisk: boolean;
    notSupported: string[];
}
export interface InspectSelector {
    label: string;
    path: string[];
}
export interface InspectDocumentRequest {
    source: string;
    /** 新消费面只接受严格 JSON */
    format: 'json';
    selectors?: InspectSelector[];
}
export interface RecordsSpec {
    recordsPath: string[];
    idField: string;
}
export interface RecordSelector {
    recordId: string;
    fieldPath?: string[];
}
export interface InspectRecordRequest {
    source: string;
    format: 'json';
    /** 不传就用研究比较表的默认声明（`records[].recordId`） */
    spec?: RecordsSpec;
    selectors?: RecordSelector[];
}
export type JsonValueInput = null | boolean | number | string | JsonValueInput[] | {
    [key: string]: JsonValueInput;
};
/** `absent` 是「必须不存在」；`value` 里的 `null` 是「必须是显式 null」——两者不是一回事 */
export type ExpectInput = {
    kind: 'absent';
} | {
    kind: 'value';
    value: JsonValueInput;
};
export interface BatchChangeInput {
    recordId: string;
    fieldPath: string[];
    expect?: ExpectInput;
    /** 未知操作名会被契约层稳定拒绝（`unsupported_operation`），不会被静默忽略 */
    op: 'setValue' | 'deleteField' | (string & Record<never, never>);
    /** 仅 `setValue` 需要 */
    value?: JsonValueInput;
}
export interface ApplyBatchRequest {
    source: string;
    format: 'json';
    spec?: RecordsSpec;
    changes: BatchChangeInput[];
}
export interface TrustedSchemaIdentity {
    schemaId: string;
    version: string;
    /** `sha256:<64 位小写十六进制>`；必须等于 schema 原文的 SHA-256 */
    digest: string;
    /** 必须显式固定；`auto` 会被拒绝（见 `validateTrustedCandidate` 的说明） */
    draft: 'draft-07' | '2020-12' | 'auto';
}
export interface TrustedSchemaBundleEntry {
    uri: string;
    text: string;
}
export interface ValidateTrustedCandidateRequest {
    baseline: string;
    candidate: string;
    format: 'json';
    schemaText: string;
    identity: TrustedSchemaIdentity;
    /** 宿主受控导入的打包 schema：`$ref` 只认文档内指针与这里的 URI */
    bundle?: TrustedSchemaBundleEntry[];
}
/** 业务 API 版本号 */
export declare function businessApiVersion(): number;
/**
 * 按操作名调用（`capability`／`inspect_document`／`inspect_record`／`apply_batch`／
 * `validate_trusted_candidate`）。未知操作返回 `invalid_request`／`stage: "tool"`。
 */
export declare function businessCall<T = unknown>(op: string, request?: unknown): BusinessOutcome<T>;
/** 能力声明：这一层到底提供什么、不提供什么，以及四个上限 */
export declare function capability(): BusinessOutcome<CapabilityResult>;
/** 按路径做纯内存读取；命中带 UTF-8 字节区间 */
export declare function inspectDocument(request: InspectDocumentRequest): BusinessOutcome<InspectDocumentResult>;
/** 按**稳定记录 ID** 做有界读取与字段定位（不按数组下标，重排不影响身份） */
export declare function inspectRecord(request: InspectRecordRequest): BusinessOutcome<InspectRecordResult>;
/** 同基线多字段批次候选：失败整批拒绝，调用方拿不到半成品 */
export declare function applyBatch(request: ApplyBatchRequest): BusinessOutcome<ApplyBatchResult>;
/**
 * 用**可信 schema** 裁决候选。
 *
 * 与 `checkWrite` 的区别不是「多一个参数」：这里 schema 必须带身份
 * （`schemaId`／`version`／`digest`／`draft`），`digest` 会被实算比对，`draft` 必须
 * 显式固定；没打包进来的 `$ref` 一律拒绝。配置安全启发式只出现在 `advisories` 里，
 * **不影响** `accepted`。
 */
export declare function validateTrustedCandidate(request: ValidateTrustedCandidateRequest): BusinessOutcome<TrustedSchemaCheckResult>;
export declare const VerseConfWasm: typeof glue.VerseConf;
export declare const wasmParse: (source: string) => string;
export declare const wasmVersion: typeof glue.version;
