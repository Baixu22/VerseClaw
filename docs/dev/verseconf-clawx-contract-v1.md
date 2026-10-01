# 研究比较表消费者契约 v1（TF-0244）

日期：2026-10-01

`driven_by: agent` · `actor: claude/tf0244-contract`

**状态：契约与离线夹具，不是产品实现。** 本文锁定下一步试验的可判断条件，不授权修改 VerseConf 冻结源码、不改变产品锁、不批准付费实验。TF-0245 的有限实施决定仍是后续独立步骤。

## 1. 交付物与可复现入口

| 产物 | 内容 |
|---|---|
| [机器可读契约](../../artifacts/verseconf-contract-v1/contract.json) | 格式、变更、身份、结果和建议资源上限 |
| [业务源 schema](../../artifacts/verseconf-contract-v1/schemas/research-source.schema.json) | Draft 2020-12、研究表字段及引用关联约束 |
| [修订请求 schema](../../artifacts/verseconf-contract-v1/schemas/revise-request.schema.json) | 仅模型可提交的参数，不含宿主权威 |
| [三记录基线](../../artifacts/verseconf-contract-v1/fixtures/research-before.json) | 合成中文、emoji、伪字段文本与公式样式文本 |
| [两字段请求](../../artifacts/verseconf-contract-v1/fixtures/revise-two-fields.json) | 一次修改同一条记录的引用状态与引用列表 |
| [独立预期源](../../artifacts/verseconf-contract-v1/fixtures/research-after.expected.json) | 单独编写的完整预期候选，不由编辑引擎生成 |
| [独立判据](../../artifacts/verseconf-contract-v1/fixtures/independent-oracle.json) | 具体目标路径、前后值、记录顺序和非目标字节规则 |
| [运行时试验设计](../../artifacts/verseconf-contract-v1/runtime-trials.json) | 正向流程和五类负向试验；全部 `not-run` |
| [owner 与 Harness 映射](../../artifacts/verseconf-contract-v1/owner-map.json) | 已有源码职责、调用位置、可复用部分与缺口 |
| [离线校验器](../../artifacts/verseconf-contract-v1/verify.py) | 校验 schema、夹具、判据反例与源码引用，不执行产品 |

本次使用已有 Python 3.10 环境中的 `jsonschema 4.23.0`、`referencing 0.36.2`，没有安装依赖。版本声明见 [requirements.txt](../../artifacts/verseconf-contract-v1/requirements.txt)，仅供研究校验器使用，不加到 Electron/runtime 依赖图。

从仓库根目录复跑，给每次运行使用新的报告文件名：

```bash
PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 python artifacts/verseconf-contract-v1/verify.py --report artifacts/verseconf-contract-v1/verification/local-repeat.json
```

校验器拒绝覆盖已有报告，拒绝把报告写到该证据目录外。它读取真实 owner 源码并记录 hash／符号行号，但**符号存在检查不是运行时行为证明**。

## 2. 首个试验的范围

### 包含

- 严格 JSON、UTF-8、单 workspace、已有业务记录。
- 按稳定记录 ID 选择，不按模型提供的数组下标选择。
- `setField` 修改既有、可变字段；所有目标和 expect 从同一基线解析。
- 批次的最终完整候选一次校验，不以中间状态逐步落盘。
- 已提交源和输出分别记状态，显式请求 Markdown／XLSX 导出。
- 版本冲突、取消、拒绝、渲染失败和重启对账有独立试验条件。

### 不包含

- 本轮不实现 create/inspect/revise/render 产品工具或受管提交 SDK。
- 不修改源码包、真实配置、数据库、用户文件或默认开关。
- v1 不支持插入／删除字段或记录，不支持记录重排；这些另有后续工作包。
- 不支持 JSONC、完整 JSON5、TOML、YAML 或任意 Office 文件往返。
- 不创建新审批／记忆／任务权威，不让模型提交任意路径、schema 或命令。

这是首个试验的窄契约，不是冻结最终产品 API。后续若改变操作集或判据，另行版本化并说明原因，不能为了通过旧试验而悄悄放宽。

## 3. 主夹具为什么用两个关联字段

三条记录分别使用 `rec-baseline`、`rec-managed`、`rec-kernel`。它们是合成数据，不是对现有产品能力的真实性评估。

主请求仅修改 `rec-managed`：

| 字段 | 原值 | 最终值 |
|---|---|---|
| evidenceState | `unlinked` | `linked` |
| evidenceRefs | `[]` | `["src-synthetic-check"]` |

Schema 约束：

- `unlinked` 必须有空引用列表。
- `linked` 必须有至少一个引用。
- 引用必须指向源中唯一存在的 source ID，此项由领域校验执行。

因此只修改任意一个字段都不合法，但两字段联合候选合法。这个例子用于区分“最终候选一次校验”与“循环调用单字段编辑并每次 finalize”。它不证明当前 VerseConf 或 runtime 已经实现了前一种语义。

`linked` 只表示引用关系成立，**不表示研究结论已证实**。`fixture://` 不是需要访问的真实服务。

另两条记录刻意包含：

- 字符串中的 `"evidenceRefs": []`，不能把它当实际字段定位。
- 中文和 emoji，避免把 UTF-16／字符位置当 UTF-8 字节范围。
- 公式样式文本；将来 XLSX mapper 必须将其作为文本，不能自动执行。
- `limitations: null`、缺失的 `notes`、`notes: ""` 三种状态，不能混为一谈。

## 4. 模型请求与宿主权威

模型请求只含：

- `artifactId`：inspect 返回的稳定业务身份。
- `baseRevision`：inspect 返回的源版本身份。
- `changes[]`：`op/recordId/fieldPath/expected/value`。

宿主独占：workspace、session、run、toolCall、signal、actor、provenance、源路径、可信 schema digest、审批状态与 operationId。请求顶层或操作中出现未知字段直接拒绝；尤其不能接收 `force`、`schema`、`sourcePath`、`runId` 或 `disableSafety`。

本夹具中的 artifact/revision ID 是符号值，不是真实运行证据。将来驱动必须从产品入口创建／导入并 inspect，再使用实际返回的身份，不能照抄夹具 ID 冒充运行记录。

### 4.1 操作与 expect

- v1 唯一操作为 `setField`，`fieldPath` 恰好一段，允许 finding/evidenceState/evidenceRefs/limitations/notes。
- 目标记录必须唯一，目标字段必须已经存在；缺字段返回 `target_missing`，不隐式 upsert。
- `{ "kind": "absent" }` 与 `{ "kind": "value", "value": null }` 是不同状态。前者可表达读取中的缺失，但不能让 v1 的 setField 插入字段。
- 先判目标存在性，再比较 expect；存在字段遇到 expected absent 是 `expectation_mismatch`。
- JSON number 使用数值比较；bool 不是 number。对象／数组递归比较，不靠显示文本比较。
- 重复目标拒绝；深路径与父子重叠在 v1 不支持，不能以执行顺序自行消歧。
- id、记录顺序、title、sources、schemaVersion 均不能通过本修订请求变更。
- 候选与基线无变化则 `unchanged`，不生成新版本或虚构效果。

### 4.2 Schema 分工

请求 schema 校验信封，不承担所有领域约束。例如一个数值可在 JSON value 信封层合法，但给 evidenceState 设置数值会在业务源最终 schema 中被拒绝。

Schema 由宿主登记并固定 draft/id/version/digest；模型不提供完整 schema。只允许包内 fragment `$ref`，禁用网络与本地文件取 schema。校验器显式使用拒绝取回资源的 registry；`$schema` URI 只是所选内置标准标识，不是网络请求授权。

重复 JSON 键须在构造普通 dict/map 前拒绝；ID 唯一性与引用关系在领域层检查。普通 `JSON.parse` 后再看 map 无法恢复已经覆盖的重复键。

### 4.3 文本与数字 profile

- 严格 UTF-8；本 v1 明确拒绝 BOM、注释、尾逗号、单引号和未配对 surrogate。
- 支持 LF／CRLF，但不能顺手重排全文件或归一化非目标换行。
- 有限 binary64 数值，整数限定 JS 安全范围；精确金额不要使用浮点暗示无损十进制。
- 空字符串、空数组、空对象、null 可在 JSON 值信封中表达，最终是否有效由字段 schema 决定。
- 字节范围统一为 UTF-8 `[startByte,endByte)`。

## 5. 独立语义与字节判据

本轮的“独立”指**判据实现不依赖被测编辑器**，不是另一个审阅者签核。夹具、预期和校验器由同一 agent 编写，报告如实标注 `independentReviewer: false`。

判据分两层：

1. 完整候选解析值必须等于单独编写的 expected 文件；不能只检查目标字段而漏掉其他记录误改。
2. 使用校验器自己的 stdlib JSON 定位器，在基线和候选中定位 oracle 指定的两个值范围，比较它们前、中、后的三个未改字节段。

不用生产引擎返回的 span 自证选对目标；不从修改请求自动生成 expected 文件。只允许目标值区间内部出现语义等价的 JSON 编码差异，如转义形式；区间外全部字节必须一致。

必须用反例证明判据能拒绝：

- 返回未修改的基线。
- 只修改一个关联字段。
- 修改另一条记录或非目标内容。
- 在 title 附近额外改空白。
- 全文 Unicode 重新转义造成非目标字节改变。

正向检查包括 golden 候选、完整 CRLF 对、目标内部等价转义、反序请求的同基线 expect。反序 expect 检查不声称已经执行了一个编辑引擎。

## 6. 当前 owner 复用与缺口

[owner-map.json](../../artifacts/verseconf-contract-v1/owner-map.json) 是机器可读源映射。实际 hash／符号行号在每次验证报告中重新采集，避免沿用先前报告中已漂移的行号。

| 层 | 当前源码职责 | 下一步需要验证 |
|---|---|---|
| host-api | Renderer 的单一后端 facade | 新产物查询／意图投影仍经过此边界 |
| plugin factory | workspace/session/fsPolicy 的可信描述 | 不能把工厂缓存变成过期 run 的可写句柄 |
| plugin callback | 保留插件 scope、传递 signal | 插件 scope 不等于 Node fs 沙箱 |
| agent-tools write-kit | 按 coding 工具装配 journal、provenance 等 | 新工具继承最终策略，不能重建更宽工具集 |
| real run lifecycle | runToolLifecycle、abort、子调用投影 | 仅公开窄候选能力，不公开 executeAnyTool |
| edit/write queue | 进程内真实路径排队 | 与 patch 另一锁 Map 的共同协调语义 |
| patch preflight | 预计算、preview binding、批次提交与恢复 | 非现成公共候选 SDK，不承诺所有写入强事务 |
| journal | pre-image 和恢复元数据，失败返回 null | 新承诺必须检查证据准备，不能自动改变旧 fail-open 默认 |
| effect receipt | 记录真实效果与幂等冲突关联 | 收据不授权重放，未知效果不能再次写入 |
| tools.invoke | 有 hook／策略，但 execute 参数有限 | 无完整当前 run 句柄时拒绝受管 mutation |
| source runtime isolation | 独立 config/state/home 与选定键同步 | 真正加载的是哪份配置、如何显式禁用／撤销 |
| Office Main writer | 真实生成算法与直接写盘 | 以后抽纯生成函数，不增加 runtime→Main 私有后门 |
| Chat artifact projection | 文件展示与现有面板位置 | 稳定身份、source/output 引用和验证结果需另补 |

源码参考：

- [工厂上下文](../../openclaw_runtime/src/plugins/tool-types.ts:15)、[装配调用方](../../openclaw_runtime/src/agents/openclaw-plugin-tools.ts:81)、[回调包装](../../openclaw_runtime/src/plugins/tools.ts:128)。
- [write-kit](../../openclaw_runtime/src/agents/agent-tools.ts:846)、[edit/write 排队](../../openclaw_runtime/src/agents/sessions/tools/file-mutation-queue.ts:24)、[patch 批次锁](../../openclaw_runtime/src/agents/apply-patch-batch-lock.ts:11)。
- [预检／提交](../../openclaw_runtime/src/agents/apply-patch-preflight.ts:279)、[快照实际错误返回](../../openclaw_runtime/src/agents/tools/write-journal.ts:353)、[收据边界](../../openclaw_runtime/src/agents/effect-receipt.ts:1)。
- [Gateway invoke](../../openclaw_runtime/src/gateway/tools-invoke-shared.ts:448)、[生效配置同步](../../electron/gateway/config-sync.ts:803)。

本轮没有验证这些 owner 对新候选的运行行为。尤其不能把 `snapshotPreparedWrite` 的存在或旧 patch 的通过结果当作新插件已继承恢复保证。

## 7. 正向和五类负向 runtime 试验

完整输入、步骤、faultAt、预期效果和证据要求见 [runtime-trials.json](../../artifacts/verseconf-contract-v1/runtime-trials.json)。**R0 和 F1..F5 全部 `not-run`**；离线检查只确认设计齐备、不伪造执行状态。

| 场景 | 输入／注入点 | 必须观察的真实结果 |
|---|---|---|
| R0 正向 | 实际 create/import + inspect 后，以真实 ID 提交主请求 | 一次源修订、显式两类导出、内容读回、重启身份保留 |
| F1 只读／拒绝 | 相同合法请求，在 readonly、tool deny、approval deny 下运行 | 拒绝，源 digest 不变，无新提交／输出；不能插件已安装就扩权 |
| F2 版本冲突 | inspect 后由另一写入方改变 rec-baseline.finding | 旧请求冲突；最终文件保留竞争者的新内容，不 force 重试 |
| F3 提交前取消 | 审批等待、文件锁等待、计算后提交前的确定性 barrier | 取消后零源效果、无晚到写入，队列释放 |
| F4 渲染失败 | 新源已提交，纯 renderer 在发布输出前抛错 | 新源保留；旧有效输出保留并标旧；新版本不能显示已导出 |
| F5 重启对账 | prepared 后、写后记账前、写后又出现第三种内容 | 分清未发生／已发生待对账／未知；不重复写，不覆盖第三内容 |

将来使用新建可丢弃 workspace 和隔离测试 profile，只终止驱动创建的 Gateway 进程。使用命名 barrier，不靠随意 sleep 碰撞崩溃窗口。确切 hook 由 W1 在实际 owner 里选择；本任务没有提供已存在的 fault injection API。

取证必须读盘：源 pre/post/current bytes 与 digest、操作 journal、revision、snapshotRef、实际 run/toolCall、必要审批事件、输出和内容读回。不能只用 console 输出或 UI 缓存判成功。

模型响应可脚本化，但必须标为 scripted-provider；这只能证明真实工具链被驱动，不能称为实际模型泛化实验。真实模型、UI、权限、数据库和 wasm 运行均不在本轮证据里。

## 8. 建议资源上限与工作量

以下是**下一试验的建议约束，不是生产默认值、性能保证或获批预算**。

| 资源 | 建议上限／档位 | 验证方式 |
|---|---|---|
| 源／候选 | 各 256 KiB | 超限在解析／计算前拒绝 |
| schema／请求 | 各 64 KiB | 只消费受信任 schema；拒绝超限输入 |
| 记录／引用来源 | 各 128 项 | 主夹具 3 项，上界单独测 |
| 变更批次 | 16 项 | 主夹具 2 项，重复目标仍拒绝 |
| JSON 深度 | 32 层 | 超深反例；不能靠语言递归崩溃作正常拒绝 |
| 诊断 | 20 条 | 总数／截断信息明确，不把被省略错误当合法 |
| worker 冷／热截止 | 5 s／2 s | W1/W3 量测后确认，取消不得产生晚到提交 |
| 单 workspace mutation | 1 个受管临界区 | 不在锁内等待模型／审批／渲染 |
| 输入性能档位 | 4／64／256 KiB | 分别记录冷/热耗时、RSS、失败及包体增量 |

worker 资源限制不天然限制所有 wasm 线性内存；必须核对实际 memory 配置与进程 RSS。不能把“在 worker 里执行”当安全隔离证据。

粗估只为 TF-0245 决策输入，不安排日历或消耗预算：

- W1 最小提交 seam、真实调用与五类失败窗口：约 **12–24 个有效工程小时**，不含全面 UI/跨平台构建。
- W2 相关写入口协调、SQLite 版本与恢复：约 **16–32 小时**，物理快照方案选定后重估。
- W3 JSON 绑定和 worker/可复现消费包：约 **16–32 小时**，以冻结源码差距和构建恢复结果为准。
- W4 研究表/导出/UI/history：约 **16–32 小时**，在宿主和绑定契约稳定后重估。
- W5–W7 不在本轮给总工期；第一消费者是否成立会显著改变范围。

建议 W1 完成一次 owner/权限探针即做检查点；若两轮有界尝试仍需要新通用平台、私有反向桥或权限放宽，则停下写出证据，不用不断扩大范围掩盖失败。付费模型调用当前为 0；未来端点与费用预算单独明确。

## 9. 成功与停止条件

### TF-0244 的成功

- 契约、主夹具、单独 expected 和非目标字节判据齐全。
- 正向夹具合法；关联字段的两个中间态均不合法。
- 判据反测能识别漏改、误改与非目标字节变化。
- 五类未来试验均有输入、注入时机、预期效果、取证方法，且都标注未运行。
- owner 映射有当前源码 hash，后续触点／Harness 路线、资源和工作量建议清楚。

### 后续 W1 的否决项

越权、绕过真实 run、未知效果自动重放、无恢复依据却声称可撤销、私自修改默认值、依赖任意开发机路径、只能靠新通用平台才能跑第一例，任一出现即停止扩张。

### 引擎采用的两种比较

1. 现有 read/edit/write 工作流 vs 新业务闭环：评估宿主能力收益。
2. 同一宿主契约下 TS vs VerseConf：评估 wasm 内核增量收益。

失败／拒绝／超时保留在分母；误改和虚假完成是硬否决，不用平均速度抵消。小样本不宣称显著性。若 TS 更简单且满足同样承诺，允许停止 VerseConf 特定投入；由 TF-0245/后续采用节点据证据裁决，不在本契约中预设结论。

## 10. 后续触点与 Harness 路线

本轮只写 docs 与 artifacts 下的研究契约／校验器，没有 backend 调用或产品代码修改，因此没有把产品单测、comms、Electron、打包门伪报为本轮执行。

后续 W1 建立窄的任务 spec，关联 [gateway-backend-communication](../../harness/specs/scenarios/gateway-backend-communication.md)，先运行 harness context，再实施；不要机械复用退役 Work Mode 的验收。

- W1/W2：plugin context/callback、agent-tools、run lifecycle、file coordination、patch preflight、journal、SQLite 公共能力；修改前重新核对并发代码与 scoped AGENTS。
- W3：选定 VerseConf 内存 API/Node 绑定、内部包和真实 runtime 插件依赖图；仅在有限维护决定允许的范围。
- W4：shared artifact/host contract、Main 薄代理、host-api、history/event 投影、Artifact Panel、纯 Office mapper/render。
- 对应门：定向逻辑测试、真实 runtime 集成、`contract:check`、未缓存类型检查、comms replay/compare；UI 变更加 Electron E2E／四语 i18n，绑定或打包改动加真实包内验证。
- 不为 TF-0244 启动全量 RC 或 Agent Dev deep-test；它们不能证明尚不存在的集成。

已复核 README 同步要求：本任务没有改变产品功能／公开接口，不需新增三语 README 改动；工作树已有的 README 修改全部保留。

## 11. 证据和收口口径

每次自检报告写入 verification 子目录，包含源码 HEAD/dirty、输入文件 hash、owner hash/符号行号、依赖版本、逐项结果、actor 与明确局限。报告不会自行覆盖上次失败记录。

离线自检通过只代表本文契约与夹具在所列研究校验器下自洽。**它不证明权限、提交、恢复、Office 输出或 UI 已工作。**

TF-0244 已完成独立干净候选复验：候选 `dee2391c179610d71f33e8fc5273f05a62feaa90`、`dirty=false`，离线校验 88/88 通过；最终报告为 `artifacts/verseconf-contract-v1/verification/20261001/contract-check-final.json`，产品集成和五类 runtime 试验仍明确 `not-run`。收口提案只把 TF-0244 标为 done/100，不改变 TF-0245 的 proposed 状态、不启动产品实现、不改变产品锁或 VerseConf 冻结源码。
