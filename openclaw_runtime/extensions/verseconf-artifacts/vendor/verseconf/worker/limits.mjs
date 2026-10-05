/**
 * 计算 worker 的资源上限（B06 / `TF-0136`）。
 *
 * 这些值不是拍出来的：前五项由 A07 冻结并由 Rust 侧实现强制（B01／B03 已逐条落地），
 * 时间与输出大小由 A07 冻结、由 worker 宿主强制；**最后两项**（wasm 线性内存、宿主 JS 堆）
 * 在 A07 里是 `null`（未校准），本节点用真实 Node wasm 绑定逐步加压实测后才写入，
 * 原始样本在 `worker-calibration.json`，校验脚本会核对「代码里的值来自那次测量」。
 *
 * ## 谁在强制哪一条
 *
 * 分清强制层很重要：同一个超限，`stage` 与 `code` 会不同，调用方该做的事也不同。
 *
 * | 上限 | 强制层 | 超限时的稳定码 |
 * | --- | --- | --- |
 * | `sourceBytesMax` | Rust（`strict_gate`） | `size_exceeded` |
 * | `schemaBytesMax` | Rust（`strict_gate`） | `size_exceeded` |
 * | `depthMax` | Rust（`audit_value`） | `depth_exceeded` |
 * | `opsPerBatchMax` | Rust（`apply_batch`） | `limit_exceeded` |
 * | `diagnosticsMax` | Rust（截断并标记） | 结果里 `diagnosticsTruncated: true` |
 * | `computeMillisMax` | worker 宿主（超时即终止 worker） | `compute_timeout` |
 * | `outputBytesMax` | worker 宿主（结果字节数） | `output_bytes_exceeded` |
 * | `wasmLinearMemoryMax` | worker 宿主（实测 wasm 线性内存） | `wasm_memory_exceeded` |
 * | `hostJsHeapMax` | worker 宿主（实测 heap 增长） | `host_heap_exceeded` |
 *
 * **不得把 worker 的 `resourceLimits` 当成 wasm 线性内存的硬上限**（A07 的明文要求）：
 * `resourceLimits` 管的是 V8 堆与老生代，管不到 wasm 线性内存——它由 wasm 自己按页增长。
 * 所以这里测的是**真实内存**：`process.memoryUsage().arrayBuffers`（wasm 线性内存所在的
 * ArrayBuffer 会算进去）与 `heapUsed`（JS 堆），两者分别定义、分别测试。
 */

/** 上限的强制层标记。 */
export const LIMIT_LAYER = Object.freeze({
  RUST: 'rust',
  HOST: 'host',
});

/** A07 冻结的九条上限。`Object.freeze` 之后由 {@link projectLimits} 生成每次调用的预算。 */
export const COMPUTE_LIMITS = Object.freeze({
  /** 源文本上限：1 MiB（A07 冻结；Rust `strict_gate` 强制） */
  sourceBytesMax: 1_048_576,
  /** schema 文本上限：256 KiB（A07 冻结；Rust `strict_gate` 强制） */
  schemaBytesMax: 262_144,
  /** 嵌套容器层数上限，不含根（A07 按 63 显式冻结，含定义；Rust 强制） */
  depthMax: 63,
  /** 单批操作上限（A07 冻结；Rust 强制，超限整批拒绝不截断） */
  opsPerBatchMax: 128,
  /** 诊断上限（A07 冻结；Rust 达到上限即停止收集并标记截断） */
  diagnosticsMax: 100,
  /** 单次计算时间上限（A07 冻结的安全阀，≈48× 余量，不是性能承诺） */
  computeMillisMax: 5_000,
  /** 输出大小上限：2 MiB（A07 冻结） */
  outputBytesMax: 2_097_152,
  /** wasm 线性内存上限：20 MiB（B06 实测校准：1 MiB 源 + 128 操作峰值 9.44 MiB，取 2× 余量后向上取整） */
  wasmLinearMemoryMax: 20_971_520,
  /** 宿主 JS 堆单次调用增长上限：4 MiB（B06 实测校准：峰值 1.47 MiB，取 2× 余量后向上取整） */
  hostJsHeapMax: 4_194_304,
});

/**
 * 计算配置（profiles）。
 *
 * - `default`：就是 B06 冻结的那一套，按 `inspect_record`／`apply_batch` 实测校准。
 * - `schema-validation`：给**可信 schema 校验**用。JSON schema 编译会分配一张明显更大的
 *   临时 Rust/wasm 图——默认 20 MiB **连第一消费者那个 6.5 KB 的 schema 都跑不过**（实测峰值
 *   30.13 MiB），实测 255 KiB 的合法 schema 峰值 49.19 MiB。
 *
 * 两个值都来自实测，来源见 `LIMIT_PROVENANCE`；原始样本在
 * `research/clawx-consumer-support-2026-10-01/schema-profile-calibration.json`。
 * 选 profile 只影响 wasm 线性内存这一项，其余上限（含 5000 ms 与 4 MiB 堆）完全一致。
 */
export const LIMIT_PROFILES = Object.freeze({
  default: COMPUTE_LIMITS,
  'schema-validation': Object.freeze({ ...COMPUTE_LIMITS, wasmLinearMemoryMax: 103_809_024 }),
});

/** 可用配置名。 */
export const PROFILE_NAMES = Object.freeze(Object.keys(LIMIT_PROFILES));

/** 不指定时用哪个配置。 */
export const DEFAULT_PROFILE = 'default';

/** 每条上限由哪一层强制。 */
export const LIMIT_ENFORCEMENT = Object.freeze({
  sourceBytesMax: LIMIT_LAYER.RUST,
  schemaBytesMax: LIMIT_LAYER.RUST,
  depthMax: LIMIT_LAYER.RUST,
  opsPerBatchMax: LIMIT_LAYER.RUST,
  diagnosticsMax: LIMIT_LAYER.RUST,
  computeMillisMax: LIMIT_LAYER.HOST,
  outputBytesMax: LIMIT_LAYER.HOST,
  wasmLinearMemoryMax: LIMIT_LAYER.HOST,
  hostJsHeapMax: LIMIT_LAYER.HOST,
});

/**
 * 上限的来源与实测口径。校验脚本用它核对代码里的值确实来自那次测量，
 * 而不是把「已校准」写成一句自述。
 */
export const LIMIT_PROVENANCE = Object.freeze({
  frozenBy: 'research/clawx-a07-limits-2026-09-30/A07-plan.json',
  calibratedBy: 'research/clawx-b06-compute-worker-2026-10-01/worker-calibration.json',
  calibratedAt: '2026-10-01',
  calibratedOn: '真实 Node wasm 绑定（js-api/pkg，wasm-bindgen 0.2.118 / wasm-pack 0.14.0 构建）',
  method:
    '同一批压缩 JSON 源按 64 KiB／256 KiB／1 MiB 分级，逐级跑 inspect_record 与 apply_batch' +
    '（后者用满 128 操作上限）；wasm 线性内存由模块自己报数（wasm_memory_bytes），' +
    '宿主堆取 memoryUsage().heapUsed 增量；每档 3 轮独立 worker + 1 轮同 worker 连续调用。',
  measuredPeaks: Object.freeze({
    wasmMemoryBytes: 9_899_008, // 9.44 MiB
    hostJsHeapDeltaBytes: 1_540_096, // 1.47 MiB
    durationMs: 16.1,
    resultBytes: 772_768,
  }),
  derivation:
    'wasm 9.44 MiB × 2 = 18.9 MiB → 冻结 20 MiB；堆 1.47 MiB × 2 = 2.9 MiB → 冻结 4 MiB。' +
    '两个值都是**安全阀**：实测耗时峰值 16 ms，相对 5000 ms 上限有 ≈310× 余量，不构成性能承诺。',
  rejectedMethod:
    'process.memoryUsage().arrayBuffers 曾被当作 wasm 线性内存判据——它是进程级读数，' +
    '同一批样本里一会儿报 4.21 MiB、一会儿报 0.00 MiB，与模块自报的 9.44 MiB 都对不上；' +
    '已改为由模块报数，进程级读数只留作对照。',
  wasmLinearMemoryMargin: 2,
  hostJsHeapMargin: 2,
  schemaValidationProfile:
    'schema-validation 配置**只调大** wasm 线性内存这一项（99 MiB = 103809024 B）：可信 schema 编译路径实测峰值 ' +
    '49.19 MiB（合法 schema 上限附近 255 KiB 档，261132 B）→ ×2 后取整到 MiB。默认配置（inspect／apply）仍是 20 MiB，未改动。',
  schemaValidationCalibratedBy:
    'research/clawx-consumer-support-2026-10-01/schema-profile-calibration.json',
  schemaValidationPeaks: Object.freeze({
    firstConsumerSchemaBytes: 6_506,
    firstConsumerWasmPeakBytes: 31_588_352, // 30.125 MiB：默认 20 MiB 会拒掉它
    worstLegalSchemaBytes: 261_132,
    worstLegalWasmPeakBytes: 51_576_832, // 49.188 MiB
    worstLegalDurationMs: 107.8,
  }),
  schemaValidationConsumerNote:
    '消费侧（ClawX）曾自行 fork worker/limits.mjs 并把该值定为固定 96 MiB（100663296 B）——' +
    '与我们独立推导的 99 MiB 相差约 3%，略低于 ×2 余量口径；此处如实并列，不假装一致。',
  mustNot:
    '不得把 worker resourceLimits 当成 wasm 线性内存的硬上限；两者分别定义、分别测试（A07 明文要求）。',
});

const NUMERIC_KEYS = Object.keys(COMPUTE_LIMITS);

/**
 * 生成本次调用的预算：默认用所选配置的值，可被调用方收紧（**只能收紧，不能放宽**）。
 *
 * 放宽是刻意不支持的：上限由 A07 冻结，调用方绕过它等于把「有上限」这句话作废。
 * `profile` 决定**基准**是哪一套（默认 `default`）；未知配置名会抛错，**不静默退回默认**——
 * 静默退回会让调用方以为自己在用更大预算，实际用着 20 MiB 然后被拒。
 */
export function projectLimits(overrides = {}, profile = DEFAULT_PROFILE) {
  const base = LIMIT_PROFILES[profile];
  if (!base) {
    throw new TypeError(
      `未知的计算配置 ${profile}（可用：${PROFILE_NAMES.join(', ')}）——不静默退回默认配置`
    );
  }
  const budget = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!NUMERIC_KEYS.includes(key)) {
      throw new TypeError(`未知的上限名 ${key}（可用：${NUMERIC_KEYS.join(', ')}）`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new TypeError(`上限 ${key} 必须是正数，收到 ${value}`);
    }
    if (value > base[key]) {
      throw new RangeError(
        `上限 ${key} 只能收紧不能放宽：配置 ${profile} 的值 ${base[key]}，请求 ${value}`
      );
    }
    budget[key] = value;
  }
  return budget;
}

/** 把字节数说成人能读的形式（只用于消息，不参与判断）。 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
