# VS-P3-01 修复方案报告（TF-0067 交回后）— 2026-09-02

- 作者：lane-1（复核员）
- 前置：`docs/dev/verseshell-foundation/P3-PATCH-PREVIEW-REVIEW-2026-09-01.md` §9
- 节点：TF-0067，现 `in_progress` / 60
- 性质：**修复方案与判据，非修复实现**。§4 的 R-4 需要契约级裁定，未经裁定不应动手。

本报告的全部运行时事实由复核员用仓库内 pinned 的 `resources/bin/win32-x64/ae.exe`
实测取得（`ops.list` 返回 `count: 31`，与 `governed-exec.real.test.ts` 的 catalog digest
同源）。探针跑完即删，未提交。

---

## 1. 实测确立的运行时契约（修复的事实基础）

### 1.1 `file.read_range`

```json
{"content_hash":"sha256:…","end_line":3,"start_line":1,"total_lines":3,"truncated":false,
 "lines":[{"line":1,"text":"alpha"},{"line":2,"text":"bravo"},{"line":3,"text":"charlie"}],
 "path":"…"}
```

- `lines` 是 `{line, text}` **对象数组**；`line` 是**绝对行号**
  （实测第二窗口首项为 `{"line":501,"text":"row-500"}`）。
- `total_lines` 是**整份文件**的内容行数（Rust `.lines()` 语义，不计尾随空行），
  每个窗口都返回同一个值。
- `content_hash` 是**整份文件**的哈希，与 `file.hash` 逐字符一致（5 个用例全部吻合）。
- `truncated` 由运行时自报。请求 1..3000 时实测返回 `n=500, end_line=500, truncated=true, ok=true`
  —— **超额请求不报错，静默截断并置旗**。

### 1.2 `file.hash`

`content_hash` = 整份文件**原始字节**的 sha256（实测与本地计算一致）。唯一一个现实现读对的 op。

### 1.3 `file.diff`

```json
{"content_hash":"sha256:…","diff":[" alpha","-bravo","+BRAVO"," charlie"],"path":"…","truncated":false}
```

- `diff` 是**字符串数组**（每项一行，带 ` ` / `-` / `+` 前缀）。
- 大 diff 实测（3000 行、1500 处改动）：`diff` 数组**被截到 200 项**，`truncated: true`，
  **且没有 `artifacts`、没有 `handle`**。
- **结论：`file.diff` 在任何规模下都不产 artifact handle。**

### 1.4 行尾与尾随换行（本轮最出乎意料的一条）

| 文件 | 内容 | `total_lines` | `lines[].text` | 能否重建 |
|---|---|---|---|---|
| `trailing.txt` | `alpha\nbravo\ncharlie\n` | 3 | `["alpha","bravo","charlie"]` | ✅ `join("\n") + "\n"` |
| `notrailing.txt` | `alpha\nbravo\ncharlie` | 3 | **完全相同** | ✅ `join("\n")` |
| `blankmid.txt` | `alpha\n\ncharlie\n` | 3 | `["alpha","","charlie"]` | ✅ `join("\n") + "\n"` |
| `empty.txt` | `` | 0 | `[]` | ✅ `""` |
| **`crlf.txt`** | `alpha\r\nbravo\r\ncharlie\r\n` | 3 | `["alpha","bravo","charlie"]` —— **`\r` 被剥掉** | ❌ LF 两式均不匹配 |

两条硬事实：

1. **`lines` 对"有无尾随换行"是有歧义的**——两个不同的文件给出完全相同的 `lines` 与
   `total_lines`。单靠 `lines` 无法还原字节。
2. **CRLF 文件的行尾信息在 `lines` 里丢失**。ClawX 是 Windows 主力仓库，这不是边角情形。

---

## 2. 缺陷 → 修复的对应表

| ID | 缺陷 | 坐标 | 修复方向 |
|---|---|---|---|
| R-1 | 正文字段读 `text`/`content`，运行时给 `lines` 数组 ⇒ 恒 `undefined` ⇒ update/delete preview 全废 | `patch-preview-baseline.ts:55` | 解析 `lines[]`，并以 `content_hash` **证明**重建结果 |
| R-2 | 拼接模型与真实行尾语义不符 ⇒ 即便修好 R-1 也恒 `torn-stitch` | `patch-preview-contract.ts:207` `stitchBaselinePages` | 候选式重建（§3.2） |
| R-3 | `diff` 按字符串读，运行时给字符串数组 ⇒ `unified` 恒空 | `patch-preview.ts:139` | 接受 `string[]`，join 后走 `boundedDiff` |
| R-4 | AC-3 依赖 `file.diff` 的 `handle`，**该字段不存在** ⇒ artifact 链恒空 | `patch-preview.ts:140` | **契约级裁定，见 §4** |
| R-5 | 运行时自报的 `read_range.truncated` / `diff.truncated` 被完全忽略 | `patch-preview-baseline.ts:47`、`patch-preview.ts:131` | 读取并纳入诚实性判定 |
| R-6 | 全部 op 解码只有 fake responder 背书，无真实二进制用例 —— 本轮失效根因 | 测试面 | 新增 `patch-preview.real.test.ts` |

---

## 3. 建议的修复设计

### 3.1 R-1：`lines[]` → 正文（替换 `readTextField`）

```ts
/** One ranged-read window, decoded from the runtime's own line records. */
type Window = { texts: string[]; totalLines?: number; contentHash: string | null; truncated: boolean };

function readWindow(data: Record<string, unknown>): Window | null {
  const raw = data.lines;
  if (!Array.isArray(raw)) return null;          // fail closed, never a silent ""
  const texts: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string") return null;
    texts.push(text);
  }
  return { texts, /* total_lines, content_hash, truncated */ };
}
```

要点：任何形状不符**一律返回 null 走 fail-closed**，不得降级成空串——否则又会退回
"看起来正常的错误 baseline"。

### 3.2 R-2：候选式重建，用 `content_hash` 裁决（本方案的核心）

`lines` 不足以还原字节，但**可以还原到"有限个候选之一"**，再用文件自己的哈希裁决。
这不是新假设——它正是提交闸门与现有分页校验已经依赖的那条同一性关系，只是把它
从"事后校验"提升为"重建手段"：

```ts
const NEWLINES = ["\n", "\r\n"] as const;

/** Rebuild the exact bytes, or refuse. Bounded: 4 candidates, 4 hashes. */
function reconstruct(texts: readonly string[], contentHash: string | null): string | null {
  if (contentHash === null) return null;
  if (texts.length === 0) return contentHash === contentHash_of("") ? "" : null;
  for (const nl of NEWLINES) {
    const joined = texts.join(nl);
    for (const candidate of [joined, joined + nl]) {   // no-trailing, trailing
      if (contentHash_of(candidate) === contentHash) return candidate;
    }
  }
  return null;                                          // mixed endings, BOM, etc.
}
```

性质：

- **有界**：最多 4 次 sha256，与文件大小同阶，无搜索。
- **可证**：命中即字节级等价于磁盘内容，不是"大概对"。
- **诚实**：混合行尾、BOM、非 UTF-8 等一律 `null` ⇒ 报 `baselineTruncated`
  加具名 reason，不产 diff、不可提交。CRLF 由第二个 `nl` 覆盖，**不再整类失效**。
- 单窗口与分页**共用同一函数**：单窗口传该窗口的 texts，分页传全部窗口 texts 拼接后的数组。
  于是 `stitchBaselinePages` 的 `join("\n")` 可以直接删除——它是这套模型下的错误抽象。

**额外收益（建议一并采纳）**：`read_range` 每个窗口都返回整份文件的 `content_hash`。
若窗口 N 的 `content_hash` 与窗口 1 不同，说明两次读之间**落了一次写**——
这比现在"拼完再校验"更早、且能把 `torn-stitch` 与"重建方式不对"区分开。
建议窗口间即时比对，不一致立刻 `torn-stitch` 并停止后续读取。

### 3.3 R-3：`diff` 字符串数组

```ts
const raw = data.diff;
const unified = Array.isArray(raw)
  ? raw.filter((l): l is string => typeof l === "string").join("\n")
  : (readString(data, "diff", "text", "unified") ?? "");
```

保留字符串分支只为向后兼容；主路径是数组。随后仍走 `boundedDiff`。

### 3.4 R-5：诚实性旗标

- `read_range.truncated === true` ⇒ 该窗口不完整 ⇒ `baselineTruncated` + `unreadable`。
  这是运行时给的直接信号，比任何本地推断都可靠，且能兜住"请求区间被静默裁剪"。
- `file.diff.truncated === true` ⇒ `PatchPreviewDiff.truncated` 必须为 `true`，
  不得只看本地 `MAX_DIFF_CHARS`。实测大 diff 被截到 200 行仍 `ok: true`，
  当前实现会把它当成完整 diff 呈现。

### 3.5 R-6：真实二进制测试面

新增 `openclaw_runtime/src/agents/verseshell/patch-preview.real.test.ts`，
沿用 `governed-exec.real.test.ts:25` 的 `describe.runIf(win32 && existsSync(binary))` 门，
并登记进 `vitest.verseshell.config.ts` 的 include。至少覆盖：

1. >500 行、LF、尾随换行的 update ⇒ `baselineTruncated === false`、`commitEligible === true`、
   `diffs[0].unified` 非空。
2. **CRLF** 文件的 update ⇒ 同上（这条是 §1.4 的回归锁）。
3. 无尾随换行的文件 ⇒ 同上。
4. 二进制/混合行尾文件 ⇒ `baselineTruncated === true` 且具名 reason，**不产 diff**。
5. 大 diff ⇒ `diffs[0].truncated === true`。

> 这一条是六条里**最重要**的。R-1..R-5 都是这条缺席的症状，不是病因。

---

## 4. R-4：AC-3 需要一次裁定（本报告不代为决定）

**事实**：`file.diff` 在任何规模下都不返回 `handle` 或 `artifacts`；大 diff 只是把
数组截断并置 `truncated: true`。因此 AC-3 现行措辞
（"runtime 的 diff handles 存进 preview 记录 → 闸门读回 → journal evidence → `artifact_ref`"）
**在当前 pinned catalog 下不可能被满足**。这不是实现 bug，是契约与运行时能力不符。

三条出路：

| 方案 | 做法 | 代价 | 复核员意见 |
|---|---|---|---|
| **A. 改写 AC-3** | 去掉 artifact handle，关联仅由 `previewId` + `changeSummaryDigest` 承担；`artifact_ref` 留空 | 需改节点 AC 与边界规则正文 | **推荐。** digest 已经承诺了 pre/post 身份，"复核者看到的 diff"可由 digest + preview 记录重放，handle 并非必需 |
| B. host 侧归档 diff | ClawX 自己把 diff 文本存进 artifact 存储并引用 | 新表面；preview 需要写权限，与"只读桥"直接冲突 | 不建议——会动摇本片"只读"的立身之本 |
| C. 等运行时支持 | 要求 `file.diff` 产 `result://` handle | 跨仓依赖，工期不可控 | 可作为长期项，不应阻塞本节点 |

**若选 A**，AC-3 的判据应改为可机械核对的形式，例如：
"一次经 preview 的提交，其 effect receipt 的 `approval_id` 等于 previewId、
`proposal_digest` 覆盖 `previewDigest`，且 `artifact_ref` 为 null 而非空串——
'无归档'与'空归档'仍可区分。"

现有代码里 `normalizeDiffArtifacts` / `joinArtifactRefs` / `diffArtifacts` 全套机制
**结构上是正确的**（复核员探针 B 已证其守卫为真），选 A 时建议**保留不删**：
它是 C 落地时的现成接线，且当前恒空不会造成错误断言。

---

## 5. 建议的落地顺序

1. **先裁定 R-4**（§4 三选一）。它决定 AC-3 判据，也决定 R-3 是否要顺带处理 artifact。
2. **先建 R-6 的真实测试面**，让其余修复一开始就有真实背书——
   否则又会重演"照着实现写替身"。建议第一条真实用例**先写成失败态**再修 R-1。
3. R-1 → R-2 → R-3 → R-5，每条各带一条真实用例。
4. 全套 fake responder 必须按 §1 的真实响应形状重写
   （`pagedRepo` 现在返回 `{text,…}`，是错误契约的固化）。这一步不做，
   单元测试会继续与真实用例互相矛盾。
5. 重跑 TF-0067 的全部 requiredTests + `harness validate --since 50541567d`。

## 6. 半径预估

R-1/R-2 触 `patch-preview-baseline.ts`、`patch-preview-contract.ts`；
R-3/R-5 触 `patch-preview.ts`；R-6 新增 1 个测试文件 + `vitest.verseshell.config.ts` 一行；
替身重写触 3 个既有测试文件；R-4 选 A 则触节点 AC 与边界规则各一处。
合计约 **9–10 个文件**，均已在 touchedAreas 内（新测试文件需补一行）。远低于 brb-L 40。

## 7. 不在本报告范围

- F-3（effect receipt sink 粘性 null）已另立 **TF-0148**，与本修复无耦合。
- 人工确认 UI 仍不在本节点范围（挂 M6/round-2），本报告不改变该结论。
- `tx.*` 维持永久拒绝；本修复不触碰任何旗标默认值、不新增审批通道。

---

# 修复执行记录 — 2026-09-02

实施者：lane-1（即本报告作者，亦即复核员）。**本节的全部代码由我自实现，无独立复核**——
见文末「留痕」。

## 8. 逐条落地结果

| ID | 状态 | 落点 |
|---|---|---|
| R-1 `lines[]` 解码 | ✅ | `patch-preview-baseline.ts` 新增 `decodeWindowLines`，形状不符一律 fail-closed，不降级为空串 |
| R-2 候选式重建 | ✅ | `patch-preview-contract.ts` 新增 `reconstructBaseline`，删除 `stitchBaselinePages` 与 `baselineMatchesHash` |
| R-3 `diff` 数组 | ✅ | `patch-preview-contract.ts` 新增 `readDiffText`，保留字符串分支向后兼容 |
| R-4 AC-3 裁定 | ✅ 按方案 A | 改写 spec 的 AC-3 与边界规则；artifact 接线保留为 capability |
| R-5 诚实性旗标 | ✅ | `read_range.truncated` → `clipped` 参与拒绝；`diff.truncated` 并入 `PatchPreviewDiff.truncated` |
| R-6 真实二进制测试面 | ✅ | 新增 `patch-preview.real.test.ts`（10 例），已登记进 `vitest.verseshell.config.ts` |
| **R-7（新发现）** | ✅ | 见 §9 |

超出原报告的两处改进（均由实测催生）：

- **窗口间 `content_hash` 比对**：`file.read_range` 每个窗口都返回整份文件的哈希。
  与 `file.hash` 不一致 ⇒ 两次读之间目标已变；窗口之间不一致 ⇒ 读取期间落了写。
  两者都在**造成撕裂的那个窗口**就停止，而不是读完整份文件再失败。
- **单窗口也必须证明**。原实现认为"一次读是原子观测所以可直接使用"。它是原子的，
  但**不是自描述的**——`lines` 说不出文件是否以换行结尾。现在两条路径都经同一次证明。

## 9. R-7：真实测试面立刻抓出的第二个缺陷

`file.diff` 被加进 preview profile，却从未加进 transport 的只读幂等集合
`READ_ONLY_IDEMPOTENT_OPS`（`process-manager.ts:174`）。adapter 以 `retryable: true`
发出请求，于是 `process-manager.ts:456` 一律以 `E_ACI_RETRY_FORBIDDEN` 拒绝——
**preview 在生产中根本产不出任何 diff**，与解码缺陷相互独立。

fake client 直接实现 `AciTransport`，完全绕过 process manager，所以没有任何替身能看见它。
修复：把 `file.diff` 加入该集合（catalog 声明它为 `file.read` 能力、`fs.read` 效果，
确属只读幂等）。这条已写进边界规则，作为"profile 允许而 transport 不允许"这一类
静默失效的通则。

## 10. 门禁读数（修复后，本人重跑）

| 门 | 读数 |
|---|---|
| `harness validate --since 50541567d` | **`Spec is valid`** |
| verseshell config | **177 passed / 2 failed(既有)** （179），修复前为 165 passed |
| └ 其中 `patch-preview.real.test.ts` | **10 passed**，独立连跑 3 次稳定 |
| unit-fast | **503 passed (503)** |
| agents-core（指定 4 文件） | **50 passed (50)** |
| agents-tools `write-journal.test.ts` | **19 passed (19)** |
| `process-manager.test.ts` | **24 passed (24)** |
| 根 unit（4 文件） | **147 passed (147)** |
| `tsgo:core` / `typecheck:node` / `typecheck:test` | 均 0 error |
| `check:loc` | 本任务文件**无一超限**（`patch-preview.test.ts` 一度被我改到 506 行，已回落至 499） |
| `git diff --check` | clean |

既有失败仍为 `governed-exec-runtime.test.ts` 的 2 项 `SessionAdmissionIdentityError`。

**一处如实记录的异常**：全量 verseshell 曾有**一次**报 3 failed（多出 1 项）。此后
全量连跑 2 次、real 测试单独连跑 3 次均为 2 failed 且集合稳定，未能复现，
当时也未留下失败项名称。不排除真实二进制在整包运行下的进程竞争。
记录在此而不是抹掉：它可能是一个尚未定位的 flake。

## 11. 变异探针（证明新守卫不是空守卫）

按字节备份 → 变异 → 确认变红 → 还原 → `sha256sum -c`。

- **探针 D — 重建的证明**：`reconstructBaseline` 改为无条件返回 `join("\n") + "\n"`
  （即"猜一种拼法"）。**5 项变红**，其中 **3 项是真实运行时用例**
  （无尾随换行 / CRLF / 混合行尾的拒绝）。还原 sha256 OK。
- **探针 E — 窗口间哈希比对**：该判断短路为 false。
  `refuses a window whose whole-file digest disagrees with the others` **变红**。
  还原 sha256 OK。

探针 D 的意义在于：它同时打红了替身用例和真实用例。这正是 §9.5 所缺的那一层——
守卫现在守的是"实现是否对得上运行时"，而不只是"实现是否自洽"。

## 12. 替身重写

`patch-preview.test.ts`、`patch-preview-baseline.test.ts`、`patch-preview-artifacts.test.ts`
的 responder 全部按实测形状重写（`lines` 记录、内容行 `total_lines`、`diff` 数组、
`truncated`、以及**与正文一致的真实哈希**——旧替身用的是与文本无关的合成哈希，
在新的证明式重建下会直接被拒）。

`patch-preview-artifacts.test.ts` 保留注入 `handle` 的用例，但在文件头写明：
pinned 运行时任何规模都不返回 handle，这些用例覆盖的是**关联机制本身**（能力测试），
不是对当前 catalog 行为的断言——后者由 `patch-preview.real.test.ts` 负责。

## 13. 半径

改动文件 13 个（不含 Task Forest 生成物）：4 个实现、5 个测试、1 个 vitest config、
spec、边界规则、本报告。判定读数 **13**，brb-L 上限 40，未越档。

## 14. 留痕

> **§8–§13 的全部代码由 lane-1 自实现，无独立复核。**
> 我先是这个节点的复核员，写了审计报告与修复方案；现在我又是这段代码的实现者。
> §R1.0.1 挡的正是实现者自审，所以**我不将节点置为 done**——置为 `review_needed`，
> 交由 lane-2 独立复核。这与我在 §7（审计报告）中对 F-1 / F-2 采取的处置一致：
> 取舍写在明处，不默默发生。
>
> 建议复核者优先核对：
> 1. 独立复现探针 D 与 E（判据见 §11）。
> 2. 用真实二进制**自行重跑** `patch-preview.real.test.ts`，不要采信本表读数。
> 3. R-4 方案 A 是我按自己的推荐执行的契约改写——这是本轮唯一一处
>    **由实现者单方面改动 AC 正文**的地方，值得一次独立判断。
> 4. §10 那次未能复现的 3-failed 异常。

## 15. 第二轮修复：端到端链首次在真实运行时下闭合（2026-09-02 续）

§8–§14 留下的最大缺口：`preview → 带 previewId 提交 → journal → receipt` 这条链
在所有测试里用的都是手工构造的 preview 记录。本回合补上，全部落在
`patch-preview.real.test.ts`（新增 3 例，共 13 例）：

1. **真提交（AC-3 端到端）**：用真实运行时产生 preview（previewId + digest 均为
   运行时产物，无任何手工构造）→ 直接以该 previewId 调 `applyPatch` → 断言
   `batchState === "committed"`、journal evidence 带同一 previewId/digest、
   磁盘内容正确、**且 receipt 行真的落库**（`outcome: "applied"`、
   `approval_decision: null`、`domain_executor: "clawx-write-journal"`）。
   这是本节点第一次证明**适配器算出的 digest 与写入路径重算的 digest 在真实文件上一致**——
   它们各自独立实现，此前二者一致纯属巧合未经检验。
2. **真实漂移拒绝**：preview 后写入一条不影响 hunk 匹配的头部行（patch 仍可应用，
   preflight 必然成功）→ 断言提交以 stale 拒绝且磁盘逐字节不变。
   注意这里有一个故意选择的细节：若漂移使 patch 无法应用，preflight 会先抛
   "Failed to find expected lines"——那是另一种拒绝，但**不是**闸门在工作。
   选"仍可应用但内容已变"的漂移，才真正命中闸门。
3. **CRLF 完整 preview**：CRLF 文件的 update 走完整 adapter（非仅 readBaseline），
   断言 baseline 不截断、可提交、diff 含改动。

门禁回执（本人重跑）：verseshell **180 passed / 2 既有失败**；real 13/13；
unit-fast 503；agents-core 50；write-journal 19；根 unit 147；
`tsgo:core`/`typecheck:node`/`typecheck:test` 均 0 error；`check:loc` 无超限
（real 测试 310 行）；`git diff --check` clean；`harness validate` = Spec is valid。

同前：本节代码由 lane-1 自实现，无独立复核。节点维持 `review_needed` 不变，
建议复核者把"独立重放真提交用例"作为首要核对项。
