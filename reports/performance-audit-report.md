# Verse Claw (ClawX) 性能处理与优化策略审计报告

> 用途：交给审计 agent 复核当前性能处理现状与优化方案。
> 范围：Electron 运行时性能 + 多 agent（本地模型）优化。
> 视角：本地优先（GPU 推理在本地 LM Studio / Ollama）。云端 API 路径不在本报告重点内，仅在对比处提及。
> 标注约定：`[已核实]` = 本报告中已通过代码/配置查证；`[推断]` = 基于架构的合理推断，需审计方确认。

---

## 0. 速览结论

- **当前系统已经是"单 Gateway 汇聚所有推理到单一本地 GPU 后端"的架构**，这是做 GPU 共享调度的良好基础，但**客户端没有任何并发限流**，多 agent 同时推理会直接撞上本地模型服务的并发上限而排队。
- **Electron 层面最关键的发现：硬件加速被全局禁用**（`app.disableHardwareAcceleration()`，index.ts:92）。这在单窗口、纯文本 UI 下没问题，但一旦进入多窗口 + WebGL 重可视化（AgentTraceGraph / ClawGraph / Dashboard），软件渲染会成瓶颈。
- 渲染层目前**没有任何 Web Worker / OffscreenCanvas / WebGPU 卸载**，所有密集计算都在主线程。
- 推荐落地顺序（ROI 高 → 低）：
  1. 多 agent 并发信号量（编排层）— 解决排队本质
  2. Prompt-cache 跨 agent 复用
  3. 模型服务并发调参 + 多模型并行 + 量化
  4. 结果 / embedding 缓存
  5. Electron 硬件加速条件启用 + Vite 构建分块
  6. 渲染计算卸载 / 多窗口资源管理

---

## 1. 当前系统架构（已核实）

| 层 | 实现 | 证据 |
|----|------|------|
| 主进程 | 单个 Electron Main 进程，拉起并托管 OpenClaw Gateway 子进程 | `electron/gateway/*`（manager / supervisor / process-launcher / lifecycle-controller / restart-governor / startup-orchestrator）；`electron/main/index.ts` 创建 `BrowserWindow` |
| Gateway | **单进程**，监听 18789，含重连 / 健康检查 / 能力监测 / 重启治理 | `electron/gateway/manager.ts`、`supervisor.ts`、`process-launcher.ts` |
| 本地模型 | `openclaw_runtime/extensions/lmstudio` 将 chat completion 转发到本地 LM Studio / Ollama HTTP 服务；**GPU 推理发生在模型服务进程内**，Gateway 不碰 GPU | `openclaw_runtime/extensions/lmstudio/src/*`（stream / setup / runtime / embedding-provider） |
| 多 agent 编排 | `SubagentRunnerPanel` 用预设 `explorer / reviewer / tester / compare` 经 `buildPresetWorkers` 生成 worker，触发**一次** spawn RPC，由 Gateway 扇出为 N 个 worker run | `src/components/agents/SubagentRunnerPanel.tsx` |
| 渲染层 | React 19 + Vite；已有 WebGL 使用（`use-webgl-fire`）；`src` 中无 Web Worker / OffscreenCanvas / WebGPU | grep 结果：仅 `node_modules` / `dist` 命中，源码无 |
| 窗口 | **当前为单窗口**；`window.ts` 仅做窗口状态持久化，`window-api.ts` 只操作 `mainWindow` | `electron/main/window.ts`、`electron/services/window-api.ts` |

推理路径（本地）：

```
Orchestrator (SubagentRunner)
  └─ spawn RPC ─▶ OpenClaw Gateway（单进程, :18789）
                    └─▶ 本地模型服务（LM Studio / Ollama, 本机）
                          └─▶ GPU（推理）
```

**瓶颈点**：所有 agent 汇聚到**同一个本地模型服务的并发上限** → 多 agent 排队。客户端 GPU（Chromium 合成层）与此无关。

---

## 2. 当前性能处理现状（含已核实的开关）

| 项目 | 现状 | 证据 | 评价 |
|------|------|------|------|
| 硬件加速 | **全局禁用** | `electron/main/index.ts:92` `app.disableHardwareAcceleration()` | 单窗口文本 UI 可接受；多窗口/WebGL 下为瓶颈 |
| 重启用钩子 | 预留 `--enable-gpu` 与未来配置项 | index.ts:90-91 注释 | 已留口子，可直接利用 |
| webPreferences（主窗口） | `nodeIntegration:false`、`contextIsolation:true`、`sandbox:false`、`backgroundThrottling` 未设（默认 true）、`webviewTag:true` | `electron/main/index.ts:826-832` | 安全基线 OK；sandbox=false 为权衡项；webview 会额外吃进程/GPU |
| webPreferences（agent-browser） | 第二个 BrowserWindow，独立 webPreferences | `electron/services/agent-browser-service.ts:503` | 需与主窗口保持一致的性能姿态 |
| Vite 构建 | 无 `manualChunks`；已设 `dedupe`（react 等）；无 worker 配置 | `vite.config.ts` | 主包未分块，缓存粒度粗 |
| Gateway 生命周期 | 单进程 + 重启治理、重连、能力监测 | `electron/gateway/*` | 稳定，但与推理排队无关 |
| 子 agent 并发限制 | **无客户端限流**；渲染层只发一次 spawn | `SubagentRunnerPanel.tsx` | 扇出在运行时侧，需到 `openclaw_runtime` 编排层查/加 |
| 渲染计算卸载 | 无 Web Worker / OffscreenCanvas / WebGPU | grep 源码 | 密集计算在主线程，未利用多核/GPU 计算 |
| 上下文管理 | 存在 `electron/utils/context-window.ts` | 文件存在 | 本地模型窗口小，需依赖此机制防溢出 |

> 说明：多 agent 的实际扇出逻辑位于 `openclaw_runtime`（随仓库 vendored / workspace 内）。本报告判定"客户端无限流"是基于渲染层只触发单次 spawn RPC；**编排层内部是否已有并发控制需审计方在 `openclaw_runtime` 内确认**（见第 6 节待确认项）。

---

## 3. Electron 优化方案（按优先级）

### E1 — 硬件加速条件启用  【高 / 已核实】
- **现状**：`index.ts:92` 无条件 `app.disableHardwareAcceleration()`。原注释给出理由（VS Code 哲学：软件渲染跨硬件确定性更好，规避 GPU 驱动 bug）。
- **问题**：多窗口 + WebGL 重图（AgentTraceGraph / ClawGraph / Dashboard）在软件渲染下帧率与 CPU 占用会恶化。
- **改动**：
  - 解析 `--enable-gpu` CLI 标志；或读取配置项 `disable-hardwareAcceleration`（注释已预留）。
  - 让"是否启用 HW 加速"可配置，默认保持现状（稳定优先），在检测到 WebGL 重视图活跃或用户显式开启时启用 GPU 合成。
  - 位置：`electron/main/index.ts`（早于 `app.whenReady()`，当前已满足）。
- **预期收益**：多窗口重可视化帧率提升、主线程 CPU 释放。
- **风险**：重开 GPU 可能复现原禁用的驱动 bug → 必须保留"出问题时回退软件渲染"的开关与崩溃自恢复。
- **验收**：开启 `--enable-gpu` 后，AgentTraceGraph 在多窗口下帧率 ≥ 50fps，且无渲染回归（E2E + 人工）。

### E2 — webPreferences 与 webview 进程治理  【中】
- **现状**：`sandbox:false`、`webviewTag:true`（`index.ts`）；第二个窗口在 `agent-browser-service.ts:503`。
- **改动**：
  - 评估能否在保持 native 模块可用的前提下重新启用 `sandbox`（安全 + 轻微隔离开销改善）；若不能，记录理由。
  - 明确 `<webview>`（OpenClaw Control UI 嵌入）的进程预算：避免每个会话开一个 webview，考虑复用 / 限制并发 webview 数量，因其各自占用渲染进程与 GPU 上下文。
  - 多窗口场景下按需设置 `backgroundThrottling`（默认 true 即节流，符合节能；若某后台窗口需持续工作再关闭）。
- **验收**：无新增 webview 资源泄漏；后台窗口计时器被正确节流。

### E3 — Vite 构建分块  【中 / 已核实】
- **现状**：`vite.config.ts` 无 `build.rollupOptions.output.manualChunks`。
- **改动**：为体积大且变更频率低的依赖单独分块，提升缓存命中与首屏：
  - `react` / `react-dom` / `react-i18next` → `vendor-react`
  - 图表/可视化库（如 d3 / echarts / 自研 graph）→ `vendor-viz`
  - 编辑器（monaco 等，若使用）→ `vendor-editor`
  - 其余 `node_modules` 大件按需归入 `vendor`。
- **预期收益**：主包体积下降、二次加载走缓存、构建产物更可控。
- **验收**：`dist/assets` 出现独立 vendor 分块；首屏主包 gzipped 体积下降（设基线对比）。

### E4 — 渲染计算卸载（Web Worker / OffscreenCanvas）  【中】
- **现状**：源码无 Worker / OffscreenCanvas / WebGPU。
- **改动**：
  - 重可视化（图布局、力导算）移到 Web Worker，主线程只负责绘制。
  - 大图（AgentTraceGraph 级）使用 `OffscreenCanvas` 离屏绘制后合成。
  - 若客户端做向量相似度 / embedding（多数应在 Gateway 侧），可用 WebGPU 加速；否则保持服务端。
- **验收**：主线程长任务（>50ms）数量下降；Timeline 中密集计算移出主线程。

### E5 — 多窗口资源管理（未来）  【低 / 待建】
- **现状**：多窗口尚未实现。
- **改动**（落地多窗口时一并考虑）：
  - 所有窗口共享**同一条** Gateway WebSocket（host-api 已有 `gateway:httpProxy`），不每窗口各连。
  - 非聚焦窗口 `blur`/`hide` 时主动停 `requestAnimationFrame` 重绘制。
  - 多窗口共享同一份 `electron-store` agent 状态，避免重复拉取。
  - 列表（聊天记录、agent 列表）虚拟化；按需在内存中保留/释放窗口。
- **验收**：N 个窗口的 Gateway 连接数 = 1；后台窗口 CPU/GPU 占用趋近于 0。

### E6 — 内存与稳定性  【低】
- **现状**：`electron-store`（JSON）+ 会话 transcript 落盘（`.jsonl`）。
- **改动**：多窗口 + 本地模型同时跑时 RAM 压力大；对历史 transcript 懒加载、对大文件分块读取，避免整文件进内存。
- **验收**：长会话 / 多窗口下内存不单调增长（无泄漏）。

---

## 4. 多 agent（本地）优化策略

> 前提：本地模型（LM Studio / Ollama）通过 HTTP 被 Gateway 调用；GPU 推理在模型服务进程内。**以下改动多在 `openclaw_runtime` 编排层 + 模型服务端配置**，而非渲染层。

### M1 — 并发信号量（编排层）  【高 / 核心】
- **问题**：`SubagentRunnerPanel` 一次 spawn 扇出 N 个 worker，全部打到同一本地模型服务；无并发上限即排队。
- **改动**：在编排层加信号量，并发数 = `min(模型服务 max_concurrency, GPU 显存可容纳的并发序列数)`。
- **预期收益**：消除排队尖峰，首 token 延迟稳定，GPU 利用率平稳。
- **验收**：同时派发 4 个 worker，GPU 利用率曲线无"全部空等→瞬间打满"的锯齿；端到端耗时 ≤ 串行但有界。

### M2 — Prompt-cache 跨 agent 复用  【高】
- **改动**：对共享同一仓库/上下文的 agent，复用缓存前缀（OpenClaw `cache_control` / 模型服务 prompt cache），削减 prefill 成本。
- **验收**：同上下文多 agent 的 prefill token 数显著下降（对比未缓存基线）。

### M3 — 结果 / embedding 缓存  【中】
- **现状**：`embedding-provider.ts` 已存在（可做 embedding 缓存）。
- **改动**：跨 agent 缓存 embedding、文件读取、grep 等工具结果，按内容哈希键；避免 explorer/reviewer/tester 重复读取同一文件。
- **验收**：多 agent 任务的重复工具调用次数下降（可加计数埋点）。

### M4 — 模型服务调参 + 多模型并行 + 量化  【中】
- **改动**：
  - 并发序列数调至匹配典型 fan-out（如预设一次派 4 worker）。
  - 显存允许时并行加载两档模型：小快模型（explorer）＋ 大模型（reviewer/compare），均由同一服务调度。
  - 使用量化权重（如 q4_K_M）以容纳更多并发且降显存。
- **验收**：在目标显存下两模型共存且并发不 OOM；tokens/s 达标。

### M5 — 错峰派发 + 流式早退  【中】
- **改动**：worker 不都在 t=0 同时发起；编排器按信号量错峰；结果结构化后尽早触发下游，不等整段完成再流转。
- **验收**：首 token 时间降低；总耗时因流水线重叠而缩短。

### M6 — 分层委派（小模型编排 / 大模型攻坚）  【中】
- **改动**：Orchestrator 用小模型做路由/汇总，仅把困难子任务委派大模型，减少 GPU token 消耗。
- **验收**：同等任务 GPU token 总量下降。

### M7 — 上下文纪律  【低】
- **现状**：`electron/utils/context-window.ts` 存在。
- **改动**：配合本地模型小窗口，做摘要/裁剪；用现有 token-usage 图表监控异常膨胀。
- **验收**：无单 agent 因超窗而失败；token 用量平稳。

---

## 5. 风险与验证

### 度量指标（建议新增埋点）
- 推理侧：tokens/s、TTFT（首 token 延迟）、本地模型服务排队深度、GPU 利用率、显存占用。
- 渲染侧：WebGL 帧率、主线程长任务数、主包体积、内存占用。
- 编排侧：并发 worker 数、平均/尾延迟、失败重试率。

### 回归与护栏
- 改动通信/编排路径后跑 `pnpm run comms:replay` 与 `pnpm run comms:compare`。
- 多窗口/UI 改动补 Electron E2E（Playwright），遵循 AGENTS.md 的 UI 变更校验规则。
- 遵循 `harness/specs`：涉及 renderer/Main/host-api/Gateway/运行时 的改动，从 task spec 起，`pnpm harness validate --spec <spec>` 后再实现。

### 已知风险
- **E1**：重开 GPU 合成可能复现原禁用的驱动 bug → 必须保留回退开关与崩溃自恢复。
- **E2**：`sandbox` 变更有安全影响，需安全评审，不可为性能单方面放开。
- **M1/M4**：本地模型 VRAM 争用，错误并发参数会导致 OOM 或上下文换页（反而更慢）→ 参数需按目标硬件标定。
- **多窗口**：每个 `BrowserWindow` / `<webview>` 都吃 GPU 上下文，需总量预算。

---

## 6. 给审计方的待确认问题

1. `openclaw_runtime` 编排层（fan-out）的确切代码位置？其内部**是否已经存在**并发/队列控制？若有，本报告 M1 应改为"调参"而非"新增"。
2. 本地模型服务（LM Studio / Ollama）实际 `max_concurrency` 与是否支持 prompt cache？决定 M1/M2 的可行上限。
3. 目标部署硬件：GPU 型号与显存？决定 M4 的模型档位与并发数。
4. `agent-browser-service.ts:503` 的 webPreferences 是否应与主窗口统一性能姿态？其 webview 进程预算上限？
5. 是否有现成的 token/延迟埋点可复用，还是需新增（第 5 节指标）？

---

## 7. 附：关键文件索引

| 文件 | 相关结论 |
|------|----------|
| `electron/main/index.ts:92` | 硬件加速全局禁用（E1） |
| `electron/main/index.ts:826-832` | 主窗口 webPreferences（E2） |
| `electron/services/agent-browser-service.ts:503` | 第二窗口 webPreferences（E2） |
| `vite.config.ts` | 无 manualChunks（E3） |
| `electron/gateway/*` | 单 Gateway 进程 + 生命周期治理 |
| `openclaw_runtime/extensions/lmstudio/src/*` | 本地模型转发（GPU 在模型服务内） |
| `src/components/agents/SubagentRunnerPanel.tsx` | 多 agent 预设与单次 spawn（M1） |
| `electron/utils/context-window.ts` | 上下文管理（M7） |
| `electron/main/window.ts`, `electron/services/window-api.ts` | 多窗口未真正落地（E5） |
