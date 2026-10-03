/**
 * 计算 worker 的类型声明（B06 / `TF-0136`）。
 *
 * 运行时实现在 `worker/index.mjs`。这个入口是 **ESM-only**：worker 线程本身按 ESM 加载
 * （`new Worker(path, { type: 'module' })`），所以 `require('verseconf/worker')` 不提供。
 */

export declare const WORKER_API_VERSION: 1;
export declare const DEFAULT_WORKER_PATH: string;

export interface ComputeLimits {
  sourceBytesMax: number;
  schemaBytesMax: number;
  depthMax: number;
  opsPerBatchMax: number;
  diagnosticsMax: number;
  computeMillisMax: number;
  outputBytesMax: number;
  wasmLinearMemoryMax: number;
  hostJsHeapMax: number;
}

export type LimitLayer = 'rust' | 'host';
export type WorkerErrorCode =
  | 'invalid_request'
  | 'worker_unavailable'
  | 'worker_crashed'
  | 'compute_timeout'
  | 'cancelled'
  | 'output_bytes_exceeded'
  | 'wasm_memory_exceeded'
  | 'host_heap_exceeded'
  | 'worker_disposed';

export declare const COMPUTE_LIMITS: Readonly<ComputeLimits>;
export declare const LIMIT_ENFORCEMENT: Readonly<Record<keyof ComputeLimits, LimitLayer>>;
export declare const LIMIT_PROVENANCE: Readonly<{
  frozenBy: string;
  calibratedBy: string;
  calibratedAt: string;
  calibratedOn: string;
  method: string;
  measuredPeaks: Readonly<Record<string, number>>;
  derivation: string;
  rejectedMethod: string;
  wasmLinearMemoryMargin: number;
  hostJsHeapMargin: number;
  mustNot: string;
}>;
export declare const WORKER_ERROR_CODES: readonly WorkerErrorCode[];

/** 一次计算的实测资源指标。`wasmMemory*` 由模块自己报数；`processArrayBuffers` 只是进程级对照。 */
export interface ComputeMetrics {
  durationMs: number;
  heapUsedBefore: number;
  heapUsedAfter: number;
  heapUsedDelta: number;
  wasmMemoryBefore: number | null;
  wasmMemoryAfter: number | null;
  wasmMemoryDelta: number | null;
  processArrayBuffers: number;
  rssAfter: number;
  resultBytes: number;
  glueLoads: number;
}

/** 业务结果的最小形状（判别联合；完整类型见 `verseconf` 主入口的 `BusinessOutcome`）。 */
export interface BusinessOutcomeLike {
  apiVersion: number;
  ok: boolean;
  op: string;
  result?: unknown;
  code?: string;
  stage?: 'tool' | 'input' | 'candidate' | 'schema';
  message?: string;
  path?: string;
}

export interface ComputeResult<T = BusinessOutcomeLike> {
  outcome: T;
  metrics: ComputeMetrics;
}

export interface CallOptions {
  /** 取消信号；取消会终止 worker（同步 wasm 计算没有中断点） */
  signal?: AbortSignal;
  /** 计算时间上限；从派发开始计，排队等待不算。默认取 `COMPUTE_LIMITS.computeMillisMax` */
  timeoutMs?: number;
}

export interface ComputeWorkerOptions {
  workerPath?: string;
  /** 测试用注入点：接管 worker 的创建，便于模拟崩溃 */
  workerFactory?: (workerPath: string) => import('node:worker_threads').Worker;
  /** 只能比 `COMPUTE_LIMITS` 更紧 */
  limits?: Partial<ComputeLimits>;
  defaultTimeoutMs?: number;
}

export interface ComputeWorkerStats {
  calls: number;
  ok: number;
  failed: number;
  cancelled: number;
  timeouts: number;
  crashes: number;
  spawns: number;
  restarts: number;
  terminated: number;
  state: 'cold' | 'queued' | 'busy' | 'probing' | 'idle' | 'disposed';
  generation: number;
  queued: number;
  inFlight: number | null;
  spawned: boolean;
}

export declare class WorkerError extends Error {
  readonly name: 'WorkerError';
  readonly code: WorkerErrorCode;
  readonly details: { metrics?: ComputeMetrics } & Record<string, unknown>;
}

/**
 * 惰性启动的计算 worker。
 *
 * 它不是安全沙箱：只做资源隔离与「迟到结果丢弃」，与宿主同进程同权限。
 */
export declare class ComputeWorker {
  constructor(options?: ComputeWorkerOptions);
  readonly limits: Readonly<ComputeLimits>;
  readonly state: ComputeWorkerStats['state'];
  readonly stats: ComputeWorkerStats;
  call<T = BusinessOutcomeLike>(
    op: string,
    request?: unknown,
    options?: CallOptions
  ): Promise<ComputeResult<T>>;
  probe(): Promise<{ metrics: ComputeMetrics }>;
  cancel(reason?: string): boolean;
  dispose(): Promise<ComputeWorkerStats & { alreadyDisposed: boolean }>;
}

export declare function createComputeWorker(options?: ComputeWorkerOptions): ComputeWorker;
export declare function projectLimits(overrides?: Partial<ComputeLimits>): Readonly<ComputeLimits>;
export declare function formatBytes(bytes: number): string;
