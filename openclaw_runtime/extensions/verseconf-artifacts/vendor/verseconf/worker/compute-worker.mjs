/**
 * 计算 worker（B06 / `TF-0136`）。
 *
 * ## 它是什么
 *
 * 一个把 wasm 计算搬进 worker 线程的**薄壳**：收到请求 → 懒加载 wasm → 调用业务 API →
 * 把结果文本与实测资源指标回给宿主。它不重新实现任何能力，也不解析业务结果。
 *
 * ## 三条明确的边界
 *
 * 1. **懒加载**：模块顶层**不** import wasm。现存 glue 在 import 时就同步读 `.wasm` 并构造
 *    `WebAssembly.Module/Instance`；放进 worker 之后，这段同步加载发生在工作线程里，宿主线程
 *    不会因为「第一次用」而卡住。
 * 2. **不持有提交句柄或写盘 owner**：这里没有 `fs`、没有网络、没有子进程；它只返回文本与指标。
 *    落盘是 ClawX 受管提交 owner 的事（ADR-001 §2）。
 * 3. **这不是对恶意插件的安全沙箱**：worker 只做资源隔离与「迟到结果丢弃」。同一进程、
 *    同一权限模型，能执行的计算它都能执行；不要把它当成权限边界。
 *
 * ## 为什么取消要靠终止 worker
 *
 * wasm 计算是**同步**的：一旦进入调用就没有可以让出的中断点，worker 在处理消息期间也读不到
 * 新消息。所以「取消／超时」只能由宿主 `terminate()` 这个 worker 实现——这正是「迟到结果不可
 * 提交」的机制：worker 已经死了，结果不可能再回来。worker 侧不假装支持协作式取消。
 *
 * ## 指标（都给的是宿主可以独立复核的原始值）
 *
 * - `arrayBuffers`：wasm 线性内存所在的 ArrayBuffer 会算进这一项，所以它随输入增长；
 * - `heapUsed`：执行计算的这个 isolate 的 JS 堆；
 * - `durationMs`：这次同步调用自己的耗时。
 *
 * 超限判定由**宿主**做（它才有权终止 worker）；worker 侧只做一次预检：如果当前 wasm 内存
 * 已经超过预算，就不做这次计算，直接回拒绝——省掉一次注定要被丢掉的计算。
 */

import { parentPort } from 'node:worker_threads';

import { formatBytes } from './limits.mjs';

/** 懒加载的 glue；只在这一个 worker 线程里存在。 */
let glueModule = null;
let glueFailure = null;
let loadCount = 0;

async function loadGlue() {
  if (glueModule) return glueModule;
  if (glueFailure) throw glueFailure;
  try {
    // 动态 import：模块被加载时不会碰 wasm，第一次真正要用才读。
    const module = await import('../pkg/verseconf_wasm.js');
    glueModule = module.default ?? module;
    loadCount += 1;
    return glueModule;
  } catch (error) {
    glueFailure = error;
    throw error;
  }
}

function snapshot() {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    // 进程级读数：仅供对照，**不作为**这个实例的 wasm 内存判据（多个 worker 并存时它不成立）
    processArrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
  };
}

/** wasm 线性内存的真实大小；glue 还没加载时返回 null（不可测，不猜）。 */
function wasmMemoryBytes() {
  if (!glueModule || typeof glueModule.wasm_memory_bytes !== 'function') return null;
  try {
    return glueModule.wasm_memory_bytes();
  } catch {
    return null;
  }
}

function metricsOf(before, after, durationMs, resultBytes, wasmBefore, wasmAfter) {
  return {
    durationMs,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    heapUsedDelta: Math.max(0, after.heapUsed - before.heapUsed),
    wasmMemoryBefore: wasmBefore,
    wasmMemoryAfter: wasmAfter,
    wasmMemoryDelta:
      wasmBefore === null || wasmAfter === null ? null : Math.max(0, wasmAfter - wasmBefore),
    processArrayBuffers: after.processArrayBuffers,
    rssAfter: after.rss,
    resultBytes: resultBytes ?? 0,
    glueLoads: loadCount,
  };
}

function post(message) {
  parentPort.postMessage(message);
}

async function handleCall(message) {
  const { id, generation, op, requestText, budget } = message;

  // 先加载（这就是「懒加载」真实发生的时刻），再预检：只有加载之后才谈得上
  // 「这个实例的线性内存现在是多少」——进程级读数不成立（见模块文档）。
  let glue;
  try {
    glue = await loadGlue();
  } catch (error) {
    const current = snapshot();
    post({
      type: 'failure',
      id,
      generation,
      code: 'worker_unavailable',
      message: `wasm 未就绪：${error && error.message ? error.message : String(error)}`,
      metrics: metricsOf(current, current, 0, 0, null, null),
    });
    return;
  }

  const preflightWasm = wasmMemoryBytes();
  if (preflightWasm !== null && preflightWasm > budget.wasmLinearMemoryMax) {
    // 这个 worker 的线性内存已经超过预算：不做这次计算，让宿主换一个干净的 worker。
    const current = snapshot();
    post({
      type: 'failure',
      id,
      generation,
      code: 'wasm_memory_exceeded',
      message:
        `worker 当前 wasm 线性内存 ${formatBytes(preflightWasm)} 已超过预算 ` +
        `${formatBytes(budget.wasmLinearMemoryMax)}（预检，未执行计算）`,
      metrics: metricsOf(current, current, 0, 0, preflightWasm, preflightWasm),
    });
    return;
  }

  const before = snapshot();
  const wasmBefore = wasmMemoryBytes();
  const startedAt = process.hrtime.bigint();
  let text;
  try {
    text = glue.business_call_json(op, requestText);
  } catch (error) {
    const current = snapshot();
    post({
      type: 'failure',
      id,
      generation,
      code: 'worker_unavailable',
      message: `wasm 调用失败：${error && error.message ? error.message : String(error)}`,
      metrics: metricsOf(before, current, 0, 0, wasmBefore, wasmMemoryBytes()),
    });
    return;
  }
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const after = snapshot();
  const wasmAfter = wasmMemoryBytes();

  post({
    type: 'result',
    id,
    generation,
    text,
    metrics: metricsOf(before, after, durationMs, Buffer.byteLength(text, 'utf8'), wasmBefore, wasmAfter),
  });
}

parentPort.on('message', (message) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'probe') {
    // 只回报当前资源快照：校准脚本用它取空闲基线（glue 没加载时 wasm 内存为 null，不猜）。
    const current = snapshot();
    post({
      type: 'probe',
      id: message.id,
      generation: message.generation,
      metrics: metricsOf(current, current, 0, 0, wasmMemoryBytes(), wasmMemoryBytes()),
    });
    return;
  }

  if (message.type === 'call') {
    void handleCall(message);
  }
});
