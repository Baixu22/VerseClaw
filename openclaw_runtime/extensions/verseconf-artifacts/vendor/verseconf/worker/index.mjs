/**
 * 计算 worker 的宿主端（B06 / `TF-0136`）。
 *
 * ## 它保证什么
 *
 * - **懒加载**：`createComputeWorker()` 不会启动线程、也不会碰 wasm；第一次 `call()` 才起线程，
 *   wasm 在那个线程里第一次真正要用时才被读进内存。
 * - **一次只跑一个**：宿主侧排队，worker 里永远只有一个在飞的计算。同步计算没有中断点，
 *   并发只会让「取消」变得无法精确——排队的调用取消时根本不需要动 worker。
 * - **取消／超时后迟到结果不可提交**：取消或超时**终止整个 worker**（这是唯一能真正停下同步
 *   wasm 计算的手段），并把「代」（generation）加一。任何来自上一代 worker 的消息都被丢弃，
 *   调用方的 promise 已经以 `cancelled`／`compute_timeout` 拒绝——**不存在「先拒绝、后又被
 *   结果覆盖」这种窗口**，因为结果根本不会进入这条通道。
 * - **超限即拒绝并回收**：输出字节数、wasm 线性内存、宿主 JS 堆三条超限时，结果不返回给调用方，
 *   worker 被终止以释放内存，下一次调用会懒加载一个干净的 worker。
 * - **不持有提交句柄**：这个 API 没有落盘／提交方法，`call()` 只返回值。落盘归 ClawX 受管提交 owner。
 *
 * ## 它不保证什么
 *
 * **这不是对恶意插件的安全沙箱**：worker 与宿主同进程、同权限模型，只做资源隔离与结果丢弃。
 * 它拦不住有意写盘的代码，也不要被当成权限边界使用。
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { checkDistribution } from './availability.mjs';
import {
  COMPUTE_LIMITS,
  DEFAULT_PROFILE,
  LIMIT_ENFORCEMENT,
  LIMIT_PROFILES,
  LIMIT_PROVENANCE,
  PROFILE_NAMES,
  projectLimits,
} from './limits.mjs';

export { COMPUTE_LIMITS, LIMIT_ENFORCEMENT, LIMIT_PROVENANCE, projectLimits };
export {
  DEFAULT_PROFILE,
  LIMIT_PROFILES,
  PROFILE_NAMES,
} from './limits.mjs';
export { checkDistribution, MINIMUM_NODE_MAJOR, REQUIRED_DISTRIBUTION_FILES } from './availability.mjs';

/** 工人 API 的版本；与业务 API 各自独立计版本。 */
export const WORKER_API_VERSION = 1;

/** 默认的 worker 入口（与这个文件同目录）。 */
export const DEFAULT_WORKER_PATH = fileURLToPath(new URL('./compute-worker.mjs', import.meta.url));

/** worker 层的稳定错误码。业务拒绝不走这里——它们在 `outcome.ok === false` 里。 */
export const WORKER_ERROR_CODES = Object.freeze([
  'invalid_request',
  'worker_unavailable',
  'worker_crashed',
  'compute_timeout',
  'cancelled',
  'output_bytes_exceeded',
  'wasm_memory_exceeded',
  'host_heap_exceeded',
  'worker_disposed',
]);

export class WorkerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 一个惰性启动的计算 worker。
 *
 * ```js
 * const worker = createComputeWorker();
 * const { outcome, metrics } = await worker.call('apply_batch', request);
 * if (!outcome.ok) throw new Error(`${outcome.stage}/${outcome.code}`);
 * await worker.dispose();
 * ```
 */
export class ComputeWorker {
  #options;
  #worker = null;
  #generation = 0;
  #queue = [];
  #active = null;
  #nextId = 0;
  #disposed = false;
  #distribution = null;
  #stats = {
    calls: 0,
    ok: 0,
    failed: 0,
    cancelled: 0,
    timeouts: 0,
    crashes: 0,
    spawns: 0,
    restarts: 0,
    terminated: 0,
  };

  constructor(options = {}) {
    this.#options = {
      workerPath: options.workerPath ?? DEFAULT_WORKER_PATH,
      workerFactory: typeof options.workerFactory === 'function' ? options.workerFactory : null,
      // 未知 profile 会在 projectLimits 里抛错（构造期失败，不静默退回默认预算）
      profile: options.profile ?? DEFAULT_PROFILE,
      limits: projectLimits(options.limits ?? {}, options.profile ?? DEFAULT_PROFILE),
      defaultTimeoutMs:
        typeof options.defaultTimeoutMs === 'number' && options.defaultTimeoutMs > 0
          ? options.defaultTimeoutMs
          : COMPUTE_LIMITS.computeMillisMax,
      // 宿主按锁定版本 + 摘要引用（A08）：给了就必须对得上，对不上按 unavailable 拒绝
      expectedVersion: typeof options.expectedVersion === 'string' ? options.expectedVersion : null,
      wasmExpectedSha256:
        typeof options.wasmExpectedSha256 === 'string' ? options.wasmExpectedSha256 : null,
    };
  }

  /** 分发可用性预检（只查声明过的路径，不做任何回退）。结果会缓存。 */
  checkAvailability(options = {}) {
    return checkDistribution({
      packageRoot: options.packageRoot,
      nodeVersion: options.nodeVersion,
      expectedVersion: options.expectedVersion ?? this.#options.expectedVersion,
      wasmExpectedSha256: options.wasmExpectedSha256 ?? this.#options.wasmExpectedSha256,
    });
  }

  #availability() {
    if (this.#distribution) return this.#distribution;
    this.#distribution = this.checkAvailability();
    return this.#distribution;
  }

  /** 本次实例实际使用的上限（含调用方收紧后的值）。 */
  get limits() {
    return { ...this.#options.limits };
  }

  /** 本次实例使用的计算配置名（`default`／`schema-validation`）。 */
  get profile() {
    return this.#options.profile;
  }

  /** `cold`（没起线程）/`queued`/`busy`/`idle`/`disposed` */
  get state() {
    if (this.#disposed) return 'disposed';
    if (this.#active) return this.#active.kind === 'probe' ? 'probing' : 'busy';
    if (this.#queue.length > 0) return 'queued';
    if (this.#worker) return 'idle';
    return 'cold';
  }

  get stats() {
    return {
      ...this.#stats,
      state: this.state,
      profile: this.#options.profile,
      generation: this.#generation,
      queued: this.#queue.length,
      inFlight: this.#active ? this.#active.id : null,
      spawned: this.#worker !== null,
    };
  }

  /**
   * 调用一个业务操作。
   *
   * 解析为 `{ outcome, metrics }`：
   * - `outcome` 就是业务结果（判别联合，`ok`／`code`／`stage`）——**业务拒绝不抛异常**；
   * - `metrics` 是这次计算的实测资源指标（耗时、heap 与 arrayBuffers 前后值、结果字节数）。
   *
   * 只有 worker 层的问题才抛 {@link WorkerError}：取消、超时、崩溃、资源超限、已 dispose。
   *
   * `timeoutMs` 从**派发**开始计（排队等待不算），因为它量的是计算，不是排队。
   */
  call(op, request, options = {}) {
    if (this.#disposed) {
      return Promise.reject(new WorkerError('worker_disposed', '这个 worker 已经 dispose'));
    }
    if (typeof op !== 'string' || op.trim() === '') {
      return Promise.reject(new WorkerError('invalid_request', 'op 必须是非空字符串'));
    }
    // 分发预检：缺文件／版本不符／摘要不符时**不 spawn worker**，直接按 unavailable 拒绝
    const distribution = this.#availability();
    if (!distribution.available) {
      return Promise.reject(
        new WorkerError(
          'worker_unavailable',
          `分发不可用（${distribution.code}）：${distribution.reasons.join('；')}`,
          { distribution }
        )
      );
    }
    const requestText = typeof request === 'string' ? request : JSON.stringify(request ?? {});
    const timeoutMs = options.timeoutMs ?? this.#options.defaultTimeoutMs;

    const job = {
      kind: 'call',
      id: ++this.#nextId,
      op,
      requestText,
      budget: this.#options.limits,
      timeoutMs,
      signal: options.signal,
      settled: false,
      resolve: null,
      reject: null,
      timer: null,
      abort: null,
    };
    this.#stats.calls += 1;

    return new Promise((resolve, reject) => {
      job.resolve = (value) => {
        if (job.settled) return;
        job.settled = true;
        this.#cleanup(job);
        this.#stats.ok += 1;
        resolve(value);
      };
      job.reject = (error) => {
        if (job.settled) return;
        job.settled = true;
        this.#cleanup(job);
        this.#stats.failed += 1;
        reject(error);
      };
      if (job.signal?.aborted) {
        job.reject(new WorkerError('cancelled', '调用在开始前就被取消'));
        return;
      }
      // 取消监听在**入队时**就挂上：排队中的调用取消时根本不用动 worker，
      // 只有正在算的那一个才需要终止（见 #cancel）。
      if (job.signal) {
        job.abort = () => this.#cancel(job, 'cancelled', '调用被 AbortSignal 取消');
        job.signal.addEventListener('abort', job.abort, { once: true });
      }
      this.#queue.push(job);
      this.#pump();
    });
  }

  /** 只取资源快照、不做计算。校准与容量自查用它。 */
  probe() {
    if (this.#disposed) {
      return Promise.reject(new WorkerError('worker_disposed', '这个 worker 已经 dispose'));
    }
    const distribution = this.#availability();
    if (!distribution.available) {
      return Promise.reject(
        new WorkerError(
          'worker_unavailable',
          `分发不可用（${distribution.code}）：${distribution.reasons.join('；')}`,
          { distribution }
        )
      );
    }
    const job = {
      kind: 'probe',
      id: ++this.#nextId,
      op: null,
      requestText: null,
      budget: this.#options.limits,
      timeoutMs: this.#options.defaultTimeoutMs,
      signal: null,
      settled: false,
      resolve: null,
      reject: null,
      timer: null,
      abort: null,
    };
    return new Promise((resolve, reject) => {
      job.resolve = (value) => {
        if (job.settled) return;
        job.settled = true;
        this.#cleanup(job);
        resolve(value);
      };
      job.reject = (error) => {
        if (job.settled) return;
        job.settled = true;
        this.#cleanup(job);
        reject(error);
      };
      this.#queue.push(job);
      this.#pump();
    });
  }

  /** 主动取消：排队中的直接摘掉，正在算的终止 worker。 */
  cancel(reason = '调用被宿主取消') {
    const target = this.#active ?? this.#queue[0];
    if (!target) return false;
    this.#cancel(target, 'cancelled', reason);
    return true;
  }

  /** 终止 worker 并让所有排队／在飞的调用以 `worker_disposed` 失败。可重复调用。 */
  async dispose() {
    const wasDisposed = this.#disposed;
    this.#disposed = true;
    const queued = this.#queue;
    this.#queue = [];
    const active = this.#active;
    this.#active = null;
    const error = new WorkerError('worker_disposed', 'worker 已被 dispose');
    for (const job of queued) job.reject(error);
    if (active) active.reject(error);
    await this.#terminate();
    return { ...this.stats, alreadyDisposed: wasDisposed };
  }

  /* ---------------- 内部 ---------------- */

  #cleanup(job) {
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.signal && job.abort) {
      job.signal.removeEventListener('abort', job.abort);
      job.abort = null;
    }
  }

  #cancel(job, code, message) {
    if (job.settled) return;
    if (this.#active === job) {
      this.#active = null;
      if (code === 'compute_timeout') this.#stats.timeouts += 1;
      else this.#stats.cancelled += 1;
      // 同步计算没有中断点：只有终止 worker 才能真正停下它，也顺带保证结果不会回来。
      void this.#terminate();
      job.reject(new WorkerError(code, message));
      this.#pump();
      return;
    }
    const index = this.#queue.indexOf(job);
    if (index >= 0) this.#queue.splice(index, 1);
    if (code === 'compute_timeout') this.#stats.timeouts += 1;
    else this.#stats.cancelled += 1;
    job.reject(new WorkerError(code, message));
  }

  #ensureWorker() {
    if (this.#worker) return this.#worker;
    const generation = ++this.#generation;
    const worker = this.#options.workerFactory
      ? this.#options.workerFactory(this.#options.workerPath)
      : new Worker(this.#options.workerPath, { type: 'module' });
    this.#stats.spawns += 1;
    if (this.#stats.spawns > 1) this.#stats.restarts += 1;
    worker.on('message', (message) => this.#onMessage(message, generation));
    worker.on('error', (error) => this.#onError(error, generation));
    worker.on('exit', (code) => this.#onExit(code, generation));
    worker.unref?.();
    this.#worker = worker;
    return worker;
  }

  async #terminate() {
    const worker = this.#worker;
    this.#worker = null;
    // 先把「代」推进：任何还没处理的消息都属于旧代，一律丢弃。
    this.#generation += 1;
    if (!worker) return;
    this.#stats.terminated += 1;
    worker.removeAllListeners();
    try {
      await worker.terminate();
    } catch {
      // 已经退出的 worker 再 terminate 会抛，这不是错误
    }
  }

  #pump() {
    if (this.#disposed || this.#active) return;
    let job = this.#queue.shift();
    while (job && job.settled) job = this.#queue.shift();
    if (!job) {
      this.#worker?.unref?.();
      return;
    }

    this.#active = job;
    const worker = this.#ensureWorker();
    worker.ref?.();

    if (job.timeoutMs > 0) {
      job.timer = setTimeout(() => {
        this.#cancel(
          job,
          'compute_timeout',
          `计算超过 ${job.timeoutMs} ms 未返回，已终止 worker（同步 wasm 计算没有中断点）`
        );
      }, job.timeoutMs);
    }

    worker.postMessage(
      job.kind === 'probe'
        ? { type: 'probe', id: job.id, generation: this.#generation }
        : {
            type: 'call',
            id: job.id,
            generation: this.#generation,
            op: job.op,
            requestText: job.requestText,
            budget: job.budget,
          }
    );
  }

  #onMessage(message, generation) {
    // 上一代 worker 的迟到消息：直接丢弃（这是「迟到结果不可提交」的最后一道闸）
    if (generation !== this.#generation) return;
    const job = this.#active;
    if (!job || message.id !== job.id) return;

    const metrics = message.metrics ?? {};
    this.#active = null;

    if (job.kind === 'probe') {
      if (message.type === 'probe') job.resolve({ metrics });
      else job.reject(new WorkerError('worker_unavailable', `probe 收到意外消息 ${message.type}`));
      this.#pump();
      return;
    }

    if (message.type === 'failure') {
      if (message.code === 'wasm_memory_exceeded' || message.code === 'host_heap_exceeded') {
        void this.#terminate();
      }
      job.reject(new WorkerError(message.code ?? 'worker_unavailable', message.message ?? 'worker 拒绝', { metrics }));
      this.#pump();
      return;
    }

    // 上限判定由宿主做（它才有权终止 worker）。
    if (metrics.resultBytes > job.budget.outputBytesMax) {
      void this.#terminate();
      job.reject(
        new WorkerError(
          'output_bytes_exceeded',
          `结果 ${metrics.resultBytes} 字节超过上限 ${job.budget.outputBytesMax}：结果不返回，worker 已终止`,
          { metrics }
        )
      );
      this.#pump();
      return;
    }
    // 上限判定由宿主做（它才有权终止 worker），判据必须是**精确**的 wasm 线性内存：
    // 读不到就不声称它在预算内——fail-closed，而不是「大概没事」。
    if (typeof metrics.wasmMemoryAfter !== 'number') {
      void this.#terminate();
      job.reject(
        new WorkerError(
          'worker_unavailable',
          'worker 没有回报 wasm 线性内存大小（wasm_memory_bytes 不可用）：无法证明它在预算内，按拒绝处理',
          { metrics }
        )
      );
      this.#pump();
      return;
    }
    if (metrics.wasmMemoryAfter > job.budget.wasmLinearMemoryMax) {
      void this.#terminate();
      job.reject(
        new WorkerError(
          'wasm_memory_exceeded',
          `wasm 线性内存 ${metrics.wasmMemoryAfter} 字节超过上限 ${job.budget.wasmLinearMemoryMax}：结果不返回，worker 已终止`,
          { metrics }
        )
      );
      this.#pump();
      return;
    }
    if (metrics.heapUsedDelta > job.budget.hostJsHeapMax) {
      void this.#terminate();
      job.reject(
        new WorkerError(
          'host_heap_exceeded',
          `宿主 JS 堆增长 ${metrics.heapUsedDelta} 字节超过上限 ${job.budget.hostJsHeapMax}：结果不返回，worker 已终止`,
          { metrics }
        )
      );
      this.#pump();
      return;
    }

    let outcome;
    try {
      outcome = JSON.parse(message.text);
    } catch (error) {
      job.reject(
        new WorkerError('worker_unavailable', `worker 返回的不是合法 JSON：${error.message}`, { metrics })
      );
      this.#pump();
      return;
    }
    job.resolve({ outcome, metrics });
    this.#pump();
  }

  #onError(error, generation) {
    if (generation !== this.#generation) return;
    this.#stats.crashes += 1;
    const job = this.#active;
    this.#active = null;
    this.#worker = null;
    this.#generation += 1; // 旧代作废；下一次调用会懒加载新 worker
    if (job) job.reject(new WorkerError('worker_crashed', `worker 抛错：${error.message}`));
    this.#pump();
  }

  #onExit(code, generation) {
    if (generation !== this.#generation) return;
    this.#stats.crashes += 1;
    const job = this.#active;
    this.#active = null;
    this.#worker = null;
    this.#generation += 1;
    if (job) {
      job.reject(
        new WorkerError(
          'worker_crashed',
          code === 0 ? 'worker 在调用进行中正常退出（结果不可信）' : `worker 以退出码 ${code} 结束`
        )
      );
    }
    this.#pump();
  }
}

export function createComputeWorker(options = {}) {
  return new ComputeWorker(options);
}
