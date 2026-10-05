# Local module 0.3.0-local.08ee33835a9d

Not published to npm. Built from local source version 0.3.0. All existing Node, Web, MCP and worker interfaces are preserved. Development source, build tools, tests and research files are excluded.

Keep this directory intact; declarations are also used by the availability check. ClawX owns authorization and writes. Build commands in the source documentation below apply to the development repository, not this ready-to-use module.

---

# verseconf（JavaScript / WebAssembly 分发）

## 本地完整模块交付（2026-10-03）

`npm run deliver:module -- --out <交付目录>` 从**本地工作树**重新构建并输出完整模块目录和 `receipt.json`。
交付保留现有 Node ESM/CJS、Web、MCP、业务 API、worker 与资源限制，不因模块化删除功能。
只排除开发源码树、构建工具、开发依赖、测试、缓存和研究过程文件；无需把整个仓库放进宿主。

内部包身份为 `0.3.0-local.<源码摘要前缀>`，核心版本仍为 `0.3.0`；公共 npm 的旧包不是本地交付输入。
完整文件摘要、实际工作树摘要和工具链写在 `delivery-manifest.json`，消费者还必须锁定该清单的外部 SHA-256。
此命令不发布、不提交、不推送；交付目录按内容标识保存，不覆盖已有版本。

消费者只同步生成的模块目录，运行时从模块自身位置解析文件。必须保留完整清单，包括类型文件：
现有 `checkDistribution` 会检查部分声明文件。ClawX 的同步工具负责更新静态资源清单和宿主锁定值；
禁止手改 vendor 的实现或把开发机源码路径作为运行时 fallback。

验收命令：`node test/delivery.test.mjs <模块目录> <清单SHA256>`。它复用既有 Node/Web/MCP 加载测试，
检查导出和实现文件没有减少或重写，并在新目录验证 worker、版本/摘要拒绝和缺失 WASM 时不回退。
类型编译、真实消费者和包内运行仍需在各自环境核验，不以本地模块测试替代完整产品验收。

> **冻结说明（2026-09-28）**：已停止独立产品开发，不承诺后续发布或持续维护。以下仅为历史源码参考；安全边界与最终决定见 [CLOSEOUT.md](../../../docs/CLOSEOUT.md)。
>
> **有限适配补充（2026-10-01）**：在 ClawX 适配的授权范围内为 Node 绑定补了新业务 API
> （见下面的「业务 API」一节）。这不改变上面的冻结结论——不发布到 npm、不恢复
> web／native／LSP 等其它分发形态，只维护这条被实际消费的绑定。

VerseConf 的 JavaScript 包。它加载的是与本机二进制 `verseconf-mcp` **完全相同**的
Rust 实现编译出的 WebAssembly 模块，因此：

- 宿主不需要 Rust 工具链，也不需要预编译的本机二进制；
- 同一份输入在「wasm 分发」与「本机二进制 / 命令行」上返回**完全相同的 JSON**。

## 安装

**这个包没有发布到 npm，也不会再发布**：发布账号已不可用，这条分发路径已放弃
（见仓库根 README 的安装状态表）。要用它请从本仓库构建：

```bash
cd integrations/verseconf-wasm/js-api
npm install
npm run build      # 产物：dist/（CJS + ESM + 类型声明）、pkg/ 与 pkg-web/（wasm）
```

Node.js 18 及以上。包内自带 wasm，没有运行时依赖，构建过程只编译 wasm 与 TypeScript。

## 两种引入方式都可用

```js
// CommonJS
const { validate, audit, applyEdit, editRange } = require('verseconf');
```

```js
// ESM
import { validate, audit, applyEdit, editRange } from 'verseconf';
```

## 五个能力

所有函数返回同一个信封形状：`{ content, structuredContent, isError }`。
失败不是异常，而是 `isError: true` 加稳定的结构化原因。

```js
import { validate, audit, applyEdit, editRange } from 'verseconf';

validate('port = 8080\n');
// { isError: false, structuredContent: { valid: true, diagnostics: [] }, content: [...] }

audit('db_password = "secret"\nhost = "0.0.0.0"\n');
// structuredContent.findings -> [{ rule_id: 'SEC-SENS-001', ... }, { rule_id: 'SEC-004', ... }]

applyEdit('server {\n  port = 8080 #@ range(1..65535)\n}\n', {
  version: '1.0',
  edits: [{ op: 'set', path: ['server', 'port'], value: 9090, expect: { value: 8080 } }],
});
// structuredContent.source -> 只有 port 那一行变了，注释与 #@ 元数据原样保留

editRange('port = 8080\n', 7, 11, '9090');
// structuredContent.source -> 'port = 9090\n'
```

编辑工具**只返回改动后的文本，不写文件**，落盘由宿主决定。

工具清单与输入契约可以运行时读取：

```js
import { tools, serverInfo } from 'verseconf';

tools();        // 五个工具的名称、描述与 inputSchema
serverInfo();   // { name: 'verseconf', version: '0.3.0', protocolVersion: '2024-11-05' }
```

## 业务 API（B05）

上面五个函数是**旧消费面**（MCP 工具信封）；下面这组是**新消费面**：面向结构化 JSON 文档的
确定性读取与候选构造，返回**判别联合**而不是工具信封。

```js
import { applyBatch, inspectRecord, isBusinessOk, sliceUtf8Bytes } from 'verseconf';

const outcome = applyBatch({
  source: '{"records":[{"recordId":"rec-a","finding":"旧结论"}]}',
  format: 'json',                       // 新消费面只接受严格 JSON
  changes: [
    { recordId: 'rec-a', fieldPath: ['finding'], op: 'setValue', value: '修订后的结论' },
  ],
});

if (!isBusinessOk(outcome)) {
  // 按 stage 分支，不去解析中文 message
  throw new Error(`${outcome.stage}/${outcome.code}: ${outcome.message}`);
}

// 范围是 UTF-8 字节区间；不要用 String.slice（JS 下标是 UTF-16 码元）
const [range] = outcome.result.setRanges;
sliceUtf8Bytes(outcome.result.candidate, range.startByte, range.endByte); // '"修订后的结论"'
```

| 函数 | 做什么 |
| --- | --- |
| `capability()` | 这一层提供什么、不提供什么，以及大小／深度／操作数／诊断数四个上限 |
| `inspectDocument({source, format, selectors})` | 按路径读值，命中带 `startByte`／`endByte` |
| `inspectRecord({source, format, spec?, selectors})` | 按**稳定记录 ID** 读取与字段定位；重复 ID 拒绝，数组重排不改变记录身份 |
| `applyBatch({source, format, spec?, changes})` | 同一基线多字段候选；失败整批拒绝，拿不到半成品 |
| `validateTrustedCandidate({baseline, candidate, format, schemaText, identity, bundle})` | 用**带身份**（`schemaId`／`version`／`digest`／`draft`）的可信 schema 裁决候选 |
| `businessCall(op, request)` | 按操作名调用；未知操作返回 `invalid_request` |
| `businessApiVersion()` / `BUSINESS_API_VERSION` | 版本号；请与自己的期望比对 |
| `sliceUtf8Bytes(source, startByte, endByte)` | 按 UTF-8 字节切原文；越界抛 `RangeError` |

**两种形状不重叠**：业务结果里没有 `content`／`structuredContent`／`isError`，
宿主不会把两者混看。拒绝时 `stage` 是四层之一：

| `stage` | 含义 | `code` 示例 |
| --- | --- | --- |
| `tool` | 请求本身不成立（绑定没能构造出一次调用） | `invalid_request` |
| `input` | 输入／选择层 | `format_unsupported`、`target_ambiguous`、`unsupported_operation` |
| `candidate` | 候选层 | `expectation_mismatch`、`schema_invalid` |
| `schema` | 可信 schema 资产层 | `schema_identity_mismatch`、`unsupported_schema`、`schema_unavailable` |

几条**声明过的**性质（都有测试钉住）：

- 只接受严格 JSON；`jsonc`／`json5`／`toml` 明确拒绝（`format_unsupported`），不猜格式。
- `$ref` 只认文档内指针与 `bundle` 里**与引用字面量一致**的 URI；不读盘、不抓网络。
- 配置安全启发式的命中项只出现在 `validateTrustedCandidate` 的 `advisories` 里，**不影响** `accepted`。
- 请求里**对象值**的键序按字典序规范化（`serde_json` 的默认 Map）；标量与数组不受影响。

## 计算 worker（B06）

wasm 的 glue 在 import 时会**同步**读 `.wasm` 并构造实例。把它放进 worker 线程之后，这段加载发生在
工作线程里，宿主线程不会因为「第一次用」而卡住。worker 是**独立的 ESM 子入口**（`require` 不提供：
worker 线程本身按 ESM 加载）：

```js
import { createComputeWorker, COMPUTE_LIMITS } from 'verseconf/worker';

const worker = createComputeWorker();           // 懒：不起线程、不碰 wasm
const { outcome, metrics } = await worker.call('apply_batch', {
  source, format: 'json',
  changes: [{ recordId: 'rec-a', fieldPath: ['finding'], op: 'setValue', value: '新结论' }],
});
if (!outcome.ok) throw new Error(`${outcome.stage}/${outcome.code}`);   // 业务拒绝不抛异常
console.log(metrics.wasmMemoryAfter, metrics.durationMs);
await worker.dispose();
```

| 保证 | 做法 |
| --- | --- |
| **懒加载** | 导入不读 wasm；第一次 `call()` 才起线程，wasm 在那时加载（有测试钉住：导入阶段零次读 `.wasm`、零次 spawn） |
| **一次只跑一个** | 宿主侧排队；同步计算没有中断点，并发只会让「取消」无法精确 |
| **取消** | `{ signal }`。排队中的取消不动 worker；正在算的取消**终止 worker**（唯一能停下同步 wasm 的手段） |
| **超时** | `{ timeoutMs }`（默认 5000 ms）。超时同样终止 worker |
| **迟到结果不可提交** | 终止时把「代」推进，旧代消息一律丢弃；被取消／超时的 promise 已经拒绝，不存在「先拒绝后被结果覆盖」的窗口 |
| **超限** | 输出字节／wasm 线性内存／宿主堆三条由宿主判定：结果不返回、worker 被终止，下一次调用懒加载干净实例 |
| **不持有提交句柄** | 没有写盘／提交方法；`call()` 只返回值。落盘归 ClawX 受管提交 owner |

### 上限（`COMPUTE_LIMITS`，可用 `limits` 收紧、不能放宽）

| 上限 | 值 | 强制层 |
| --- | ---: | --- |
| `sourceBytesMax` | 1 MiB | Rust |
| `schemaBytesMax` | 256 KiB | Rust |
| `depthMax` | 63（不含根） | Rust |
| `opsPerBatchMax` | 128 | Rust |
| `diagnosticsMax` | 100（截断并标记） | Rust |
| `computeMillisMax` | 5000 ms（安全阀） | 宿主 |
| `outputBytesMax` | 2 MiB | 宿主 |
| `wasmLinearMemoryMax` | 20 MiB | 宿主（B06 实测：峰值 9.44 MiB × 2 余量） |
| `hostJsHeapMax` | 4 MiB | 宿主（B06 实测：峰值 1.47 MiB × 2 余量） |

`npm run calibrate` 会用**真实绑定**逐级加压（64 KiB／256 KiB／1 MiB × inspect／128 操作批次），
把实测的 wasm 线性内存与宿主堆写进 `worker-calibration.json`——`worker/limits.mjs` 里的两个实测值
来自那次测量。两个纪律：**不得把 worker `resourceLimits` 当成 wasm 线性内存的硬上限**（它管的是 V8 堆），
以及**不得用 `process.memoryUsage().arrayBuffers` 当 wasm 内存判据**（它是进程级读数：第一版校准正是
这样测的，同一批样本里它报 4.21 MiB 和 0.00 MiB 两个都对不上真值 9.44 MiB）。wasm 线性内存由模块自己
报数（`wasm_memory_bytes()`）。

### 计算配置（`profile`）

```js
const compute = createComputeWorker();                                  // 默认：inspect／apply
const schema  = createComputeWorker({ profile: 'schema-validation' });  // 可信 schema 校验
```

| 配置 | `wasmLinearMemoryMax` | 用途 |
| --- | ---: | --- |
| `default` | 20 MiB | `inspect_record`／`apply_batch`（B06 实测峰值 9.44 MiB ×2） |
| `schema-validation` | **99 MiB** | `validate_trusted_candidate`：JSON schema 编译要一张更大的临时图 |

**为什么需要两个配置**：schema 编译路径**连第一消费者那个 6.5 KB 的 schema 都要 30.13 MiB**——
默认 20 MiB 会直接拒掉它；实测合法上限附近（255 KiB）的 schema 峰值 **49.19 MiB**，按 ×2 取整得到 99 MiB。
两个值都来自实测，样本见 `research/clawx-consumer-support-2026-10-01/schema-profile-calibration.json`
（`npm run calibrate:schema-profile`）。除 `wasmLinearMemoryMax` 外两个配置完全一致。

`profile` 名字写错会**抛错**，不静默退回默认——否则调用方以为自己在用大预算，实际用着 20 MiB 然后被拒。
`limits` 只能比所选配置更紧（`RangeError`）。

### 类型前置（TypeScript 消费者）

包内自带的类型是干净的，但有两条**消费环境**的前置，装之前最好知道（都是实测出来的）：

| 前置 | 原因 | 不满足时 |
| --- | --- | --- |
| `@types/node` | `worker/index.d.ts` 引用 `node:worker_threads`；而且它**自己也声明了 `[Symbol.dispose]`**（glue 类型用到） | `error TS2307: Cannot find module 'node:worker_threads'` |
| 若项目不引 `@types/node`（或 `types: []`）：`lib` 含 `esnext`，**或**开 `skipLibCheck` | wasm-bindgen 生成的 `pkg/verseconf_wasm.d.ts` 用了 `Symbol.dispose` | `error TS2550: Property 'dispose' does not exist on type 'SymbolConstructor'` |

一条实测结论：**只装了 `@types/node` 的普通 Node 消费者（`moduleResolution: nodenext`、且关掉
`skipLibCheck`）可以完全通过**——`@types/node` 自己就提供了 `[Symbol.dispose]`，所以并不强制要求 `lib: esnext`。
`test/types.test.mjs` 用真实 `tsc` 钉住这个组合：裸消费者（不引 node 类型、不覆盖 `lib`、关掉
`skipLibCheck`）**必须**失败，带 `@types/node` 的**必须**通过，且 README 必须写明这两条。

### 分发可用性检查（干净安装的前置）

A08 的 fallback 规则是：**wasm／glue 缺失（要报缺失的文件名）、版本与宿主声明不匹配、运行时不支持 ——
三种都必须明确 unavailable，不得借用本机包、开发机链接或另一个 workspace 的副本。** 这条规则的可执行版本在
`verseconf/worker` 里：

```js
import { checkDistribution, createComputeWorker } from 'verseconf/worker';

const distribution = checkDistribution();            // 只查本包目录下声明过的文件
if (!distribution.available) {
  // 按 unavailable 处理；distribution.code / reasons / missing 告诉你是哪一种
  throw new Error(`${distribution.code}: ${distribution.reasons.join('; ')}`);
}

// 按锁定版本 + 摘要引用（A08）：给了就必须对得上，对不上直接 unavailable 且**不 spawn worker**
const worker = createComputeWorker({
  expectedVersion: '0.3.0',
  wasmExpectedSha256: distribution.wasm.sha256,
});
```

| 结果 | `code` | 含义 |
| --- | --- | --- |
| 可用 | `available` | 声明文件齐备、版本与摘要都对得上 |
| 缺文件 | `missing_files` | `missing[]` 逐条列出缺哪个（含 `pkg/verseconf_wasm_bg.wasm`） |
| 版本不符 | `version_mismatch` | 包版本 ≠ 宿主声明的版本 |
| 摘要不符 | `wasm_digest_mismatch` | wasm 实算 SHA-256 ≠ 宿主锁定的摘要 |
| 运行时不支持 | `unsupported_runtime` | Node 主版本低于 `MINIMUM_NODE_MAJOR`（18） |

三条性质：**只查声明过的路径**（`checkedPaths` 全部在包根之下，没有 `NODE_PATH`／全局搜索）、
**不做回退**（不可用就是不可用，换副本不在本包的行为里）、**主入口不做惰性改造**
（`dist/index.*` 在加载时同步 import glue，所以宿主应当先用上面的预检，再去用它或 worker；
这条限制写在 `worker/availability.mjs` 的模块文档里）。

**它不是对恶意插件的安全沙箱**：与宿主同进程、同权限模型，只做资源隔离与「迟到结果丢弃」，
拦不住有意写盘的代码，也不能当作权限边界使用。

## 工具协议服务端（stdio）

包内提供一个 stdio 服务端，用法与本机 `verseconf-mcp` 一致。**它没有发布到 npm**，
所以先按上面的「安装」一节从源码构建，再直接跑构建产物：

```bash
node bin/verseconf-mcp-wasm.mjs --list-tools
node bin/verseconf-mcp-wasm.mjs --call verseconf_validate '{"source":"port = 8080\n"}'
node bin/verseconf-mcp-wasm.mjs            # 逐行 JSON-RPC over stdio
```

宿主接入配置（先完成本地构建，运行时只需 Node；将示意绝对路径替换为自己的构建目录）：

```json
{
  "mcpServers": {
    "verseconf": {
      "command": "node",
      "args": ["/absolute/path/to/verse-conf/integrations/verseconf-wasm/js-api/bin/verseconf-mcp-wasm.mjs"]
    }
  }
}
```

也可以在自己的进程里直接驱动这套会话：

```js
import { McpSession } from 'verseconf';

const session = new McpSession();
session.handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
session.handleLine('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}');
```

## 浏览器 / 打包器

`pkg-web/` 是 wasm-bindgen 的 web 目标产物，供 `<script type="module">` 或打包器使用：

```js
import init, { call_tool_json, tools_json } from 'verseconf/web';

await init();
JSON.parse(call_tool_json('verseconf_validate', JSON.stringify({ source: 'port = 8080\n' })));
```

## 值访问 API

```js
import { VerseConf, parseConfig, parseJson } from 'verseconf';

const conf = new VerseConf('app {\n  name = "demo"\n  port = 8080\n}\n');
conf.getString('app.name');   // 'demo'
conf.getNumber('app.port');   // 8080
conf.hasKey('app');           // true
conf.toJson();                // '{"app": {"name": "demo", "port": 8080}}'

parseJson('port = 8080\n');   // { port: 8080 }
```

## 版本号说明

- `package.json` 的版本号（本分发层）与 `serverInfo().version` / `getVersion()`
  （内嵌的 Rust 核心）是两个独立版本。0.1.0 的包在真实消费者环境里两条入口都不可用，
  因此本分发层与核心各自独立计版本；核心现已是 0.3.0。
- 该修复版曾在仓库里构建并通过打包验收（`test/package.test.mjs`，12/12，历史 CI 阻塞项），
  冻结后不再自动运行，且**不会发布到 registry**——发布账号已不可用。

## 从源码构建

```bash
npm install
npm run build      # wasm-pack（nodejs + web，均传 --locked）→ tsc（ESM + CJS）
npm test           # 加载冒烟 + 发布包安装 + 业务 API + 计算 worker（生命周期／取消／上限／崩溃）
npm run calibrate  # 用真实绑定实测 wasm 线性内存与宿主堆，产出 worker-calibration.json
npm run test:parity  # 与命令行 / 本机二进制逐项比对（需要先构建 Rust 侧）
```

构建结束会写一份 `build-manifest.json`（也在发布清单里）：wasm-pack／cargo／rustc 的
实际版本、`Cargo.lock` 里锁定的 wasm-bindgen 版本、参与构建的源码指纹与产物 sha256。
A08 采用的是「固定版本内部 tarball」，所以交付时应当随包带上这份清单——
**声明值不算，锁定值加上能对得上的摘要才算**。清单路径可用 `VERSECONF_BUILD_MANIFEST` 覆盖。

`--target nodejs`（`pkg/`）是选定的交付目标；`pkg-web/` 仍在仓库内构建（旧加载路径的
冒烟测试用它），但不在交付清单里，也不作为消费入口推荐。

## 许可证

MIT OR Apache-2.0
