# VerseGit 接入：验证层的条件触发扩展

> **状态：探索期基础已就位，产品接入未开始。** 本文记录**为什么**要接、**边界**在哪、
> 以及**已经为接入做了什么**。读完本文再决定是否继续；本文不授权任何默认开启。

## 定位（一句话）

VerseGit（VG）作为**并行开发场景下的辅助验证层**：在多工作树或多并发 Agent 时
被**条件触发**，产出符号级冲突与证据事实，辅助定位并行改动的语义风险。

它**不是** harness 基座，**不是** git 基座，**不是**门禁判定者。

## 为什么不是基座

ClawX harness 的信任模型是「显式声明 + 可复查」：500+ task spec 各自列出
`requiredTests`、ownedPaths、acceptance。VG 的信任模型是「派生跟踪 + 自动准入」
（CAS + 自动落地）。把 VG 抬成基座等于用自动准入替换显式契约——这是
`versegit-validation-layer-extension-boundary` 明令禁止的。

## 为什么仍然值得接

ClawX 现有的边界门（`renderer-main-boundary`、`backend-communication-boundary`）
是**路径级 / grep 级**的。VG 提供**符号级**精度：

```
现有门：src/lib/host-api.ts 出现直接 ipcRenderer.invoke → 拦住
VG 门：  host-api.ts 的 integrationStatus() 签名变了，
        而 electron/gateway/x.ts 正在读它 → ssi/api-drift（符号级）
```

对 11786 个 `.ts` 文件的多Agent 并行改动，这是现有门禁抓不到的那一类。

## 已完成的基础工作（VG 侧，2026-10-15）

在 ClawX 真实树上实测发现：补丁前 VG 对目标仓库近乎失效。已在 VG 侧修复并锁定：

| 目标 | 补丁前 | 补丁后 |
| --- | --- | --- |
| `.tsx` 抽样 15 个 | `parse_ok` **0/15** | **15/15** |
| `shared/host-api/contract.ts` | **0 defs / 0 refs** | **870 type_alias** |
| `.ts` 抽样 120 个 | 120/120 | 120/120（无回归） |

修复内容与裁定见 VG 仓 `docs/adr/0004-typescript-grammar-dispatch-and-type-symbols.md`。
守护测试：`crates/vg-battery-index/tests/index.rs` 的 5 个锁定测试。

**这不是清理候选。** 删除 TSX 分支、interface/type 捕获或那 5 个测试，
都是对 ADR 0004 的未授权撤销。

## 触发条件（opt-in，当前全部为 FALSE）

```text
触发 = (git worktree list 计数 > 1)  OR  (活跃 VG session 计数 > 1)
```

ClawX 当前：worktree = 1 → **触发 FALSE**。所以现在引入 = 零行为变更。

## 明确的未覆盖边界（不得粉饰）

| 边界 | 状态 |
| --- | --- |
| `.mjs` / `.jsx` / `.sh`（harness 自身是 `.mjs` 598 个） | ❌ 无覆盖，诚实报 `unsupported language` |
| 读集覆盖 | ⚠️ 部分。依赖读集的 `ssi/rw-cycle` / `dangling-ref` 会漏触发 |
| 写×写规则（api-drift / silent-co-modification / duplicate-def） | ✅ 可靠，不依赖读集 |
| ClawX 侧真阳性 | ❌ **完全未测**。没有任何端到端 VG 检测跑过 |
| `.tsx` 上的 `syntactic/interleave` | 漏报。tree-sitter JSX 错误恢复很宽松：`<div>hello</span>` 在 TSX 下解析成功，只有 `</span`（缺 `>`）才报错。不要在 TSX 上靠该规则做准入依赖 |
| 净收益 | ❌ **未证明**。VG 自身声明 basis repair 无净收益 |

## 接入点与形态（设计，尚未实现）

- **接入点**：`harness/src/profiles.mjs` 的 `PROFILES` 显式白名单。新增 opt-in
  profile，538 个 task spec 一个都不用改。**绝不能加进 `fast`**。
- **判定权**：留在 ClawX。VG 六维事实
  （candidate/execution/evidence/freshness/risk/trial）只进报告的 residual 区。
- **失败姿态**：fail-open。VG 不可用 → 记一行原因 → pass/fail 不变。

## 生态联动

| 生态 | 接缝 | 性质 |
| --- | --- | --- |
| VerseShell | `resources/verseshell-mcp/`（pnpm workspace 成员，deny-by-default） | ✅ 可注册只读 capability |
| harness | `harness/src/profiles.mjs` | ✅ 最佳插入点 |
| MCP | `.mcp.json`（已存在） | ✅ `vg mcp` 是现成 stdio server |
| `.claude` hook | `install.rs` 显示 Codex 注册属 P2 未移植 | ⚠️ 需主动 `vg check --hook` 绕开 |

VG 只能作为**外部只读能力**接入，不得成为内部执行路径（受
`verseshell-mcp-compatibility-boundary` 与
`verseshell-external-write-policy-boundary` 约束）。

## 停止条件（建议）

接入前先做一次**纯只读测量**：对 2-3 个已知的真实并行改动跑 `rw-extract`，
只看三件事——写集是否准确、R1/R3/R4 有无真阳性、漏触发率。

**若真阳性为零，就到此为止，不接 harness。** 在辅助定位这个定位下，
唯一的失败模式就是「它一直不报警」，那它就是纯成本。

## 相关文档

- 规则：`harness/specs/rules/versegit-validation-layer-extension-boundary.md`（硬边界）
- VG 侧裁定：VG 仓 `docs/adr/0004-typescript-grammar-dispatch-and-type-symbols.md`
- 现有 verseshell 边界：`verseshell-foundation-p0-boundary` /
  `verseshell-mcp-compatibility-boundary` /
  `verseshell-external-write-policy-boundary`
