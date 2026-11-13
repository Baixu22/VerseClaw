---
id: session-lifecycle-worktree-and-node-development
title: Worktree and task-forest node development guide
type: guide
appliesTo:
  - gateway-backend-communication
---

# Worktree and task-forest node development

Reusable operating procedure for turning a governance plan into Task Forest nodes,
developing them one leaf at a time in a dedicated worktree, and closing them on
evidence read back from disk. Written from the session-lifecycle governance run
(TF-0640..TF-0647) so the next agent does not repeat its dead ends.

> 用途：在 ClawX 仓库里为一条治理规划开工作树、登记 Task Forest 节点、逐叶实现并收口。
> 全部产出为 agent 驱动（`driven_by: agent`）；禁止声称真人证据。

## 0. 先决条件（先读，再动手）

1. 读 `AGENTS.md` 全文，特别是 Human-in-the-loop policy、Task Forest closure policy、Disk & temp policy、Shell Strategy。
2. 读 `docs/dev/Sustained-Development-Playbook.md`；如存在，读 `docs/dev/handoffs/LATEST.md`。
3. 确认临时目录已指向 D 盘：

```powershell
$env:TEMP='D:\tmp'; $env:TMP='D:\tmp'; New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
```

4. 不要在 `C:` 上跑 install / build / e2e / vitest / typecheck。临时产物一律 `D:	mp`。

## 1. 建工作树（不要在主检出上开发）

```powershell
cd D:\ClawX
git status --porcelain          # 必须干净；有他人脏文件就不要动
git rev-parse --short HEAD      # 记下基点，写进每个 spec 的 diffBase
git worktree add -b codex/<topic> D:\ClawX-work\<topic> <base-sha>
cd D:\ClawX-work\<topic>
pnpm install --offline --prefer-offline
```

规则：

- 一个工作树只做一条规划线；不要在主检出里并行改同一批文件。
- 分支名 `codex/<topic>`，目录 `D:\ClawX-work\<topic>`。
- 依赖装好之前不要跑门禁；装好后先跑一次基线（见 §3）确认环境本身是绿的。

## 2. 登记节点（Task Forest）

脚本：`python $env:USERPROFILE\.codex\skills\task-forest\scripts\task_forest.py`（`--workspace <repo-root>`，路径是**仓库根**，不是 forest 目录）。

先设 UTF-8，否则中文会炸：

```powershell
$env:PYTHONUTF8='1'; $env:PYTHONIOENCODING='utf-8'; $env:COMPASS_AGENT_NAME='<你的归属名>'
```

流程：`list --json` → `todo --json` → 写 proposal → `proposal-save` → `proposal-apply <id> --yes` → `validate` → `export`。

节点规范：

- 一个 `global_task` 伞 + N 个叶子；叶子用 `child_of` 挂到伞下，用 `depends_on` 表达串行。
- 每个节点必须有：`purpose`（为什么存在）、`acceptance_criteria`（可机械核对的判据）、`non_goals`、`estimated_total_minutes`。
- 标题写自然语言，不要写内部代号；但 spec 文件名用 kebab-case 且唯一。
- 状态默认 `proposed`；只有真正开始实现的那一叶才 `in_progress`。

三个易踩的坑（实测）：

1. **`display_order` 是全组要么都有、要么都没有。** 根节点组里已有 49 个未设置的，所以新根节点不能单独设；建议整条线都不设，靠节点编号排序。
2. **`update_node` / `set_status` 的字段名是 `id`，不是 `node_id`**；`set_status` 还需要显式 `status`。
3. **列表字段是整体替换**（`evidence`、`acceptance_criteria`、`execution_hints`…）。追加证据必须先读全量再整组写回，否则会静默丢掉其余条目。

## 3. 每个叶子的开发节奏

1. **先写 spec**：`harness/specs/tasks/<slug>.md`，frontmatter 必填 `lifecycleStatus`、`id`、`title`、`scenario`、`taskType`、`diffBase`、`touchedAreas`、`requiredProfiles`、`requiredRules`、`requiredTests`、`acceptance`、`docs`。
   - 触及 renderer/Main/host-api/Gateway 时必须 `scenario: gateway-backend-communication` 且 `taskType: runtime-bridge`，并且 `requiredProfiles` 要含 `comms`。
   - `diffBase` 写**这一叶开始前的 HEAD**（多叶串行时逐叶前进），否则 validate 会把上一叶的改动算进本叶。
   - `docs.readmeTranslations` 显式写 `not-required` 或 `required`，这是 docs-sync 规则的硬要求。
2. **跑上下文**：`pnpm harness context --spec <spec>`，按返回的规则清单自查。
3. **写实现**：优先纯函数 + 只读适配器，再接线；不要一上来就改决策路径。
4. **写测试**：正向 + 负例。**负例必须真的会失败**，不能只断言 happy path。
5. **跑门禁**：
   ```powershell
   npx vitest run tests/unit/<your>.test.ts --maxWorkers=1
   pnpm harness validate --spec harness/specs/tasks/<slug>.md
   node scripts/typecheck-agent-dev.mjs    # 看 exitCode / errorCount，三段都要 0
   ```
   openclaw_runtime 内部的测试要在 `openclaw_runtime/` 下跑 `npx vitest run src/...`（根目录 vitest 只收 `tests/**`）。
6. **提交**：一个叶子一个 commit，消息写 `type(scope): TF-xxxx 一句话`，正文列出改动文件与 spec 路径。

## 4. 收口（Auto-close）

前置：每个 acceptance 都能**读磁盘产物**核对（文件存在 + 测试真的跑过 + validate 真的通过），而不是只信命令打印。

1. 回读证据：`Test-Path` 关键文件 + 重跑关键测试 + 确认接线行号（`Select-String` 定位）。
2. 写 closeout proposal：`update_node` 设 `status: done`、`progress: 100`、`evidence: [...]`（整组写入）、`next_action`。
3. `proposal-apply --yes` → `validate` → `export`。
4. 若证据不全、陈旧或自相矛盾：**保持节点 open 并把缺口写进 `next_action`**，不要为了收口放宽判据。

仍然需要停下来问仓库所有者的只有：发布/公开、凭据轮换或首次暴露、不可逆操作、改冻结默认值或产品锁、声称真人证据、改项目范围。

## 5. 本线（会话生命周期治理）现状

| 节点 | 状态 | 内容 |
|---|---|---|
| TF-0640 | done | 伞：注入单一装配 + 衍生可回读 |
| TF-0641 | done | A1 只读 SessionStage 投影 |
| TF-0642 | done | A2b 起始注入接线 + flag-off parity（A2a 见 TF-0648） |
| TF-0643 | done | A3 只读衍生血缘投影 |
| TF-0644 | done | A4 丢弃归因落盘 + 轮次身份 |
| TF-0645 | done | A5 checkpoint-first 新上下文（默认关） |
| TF-0646 | done | A6 缓存边界修剪 shadow + GO/NO-GO |
| TF-0647 | done | B1 立项决策：两项均 NO-GO |

分支：`codex/session-lifecycle-derivation`，工作树 `D:\ClawX-work\session-lifecycle-derivation`。

本线（TF-0640..TF-0648）已全部收口。后续若继续，只能从 B1 决策的重开条件或新的独立规划线开始。


## 6. 从这一轮学到的（2026-11-01 补充）

**6.1 会改 prompt 的叶子必须先拆。**
A2 原本写成一个节点，实际要动 `get-reply-run` 的装配路径。正确拆法是
A2a = 计划（纯函数，不接线）+ A2b = 接线与 flag-off parity 门禁，A2a 的产物就是 A2b 的字节基线。
判断标准：**这一叶会不会改变任何一轮真实发送的内容？** 会，就拆。

**6.2 "已落地未接线"必须显式声明。**
仓库有 `landed-unwired-closeout` 纪律：未接线的产物可以收口，但必须写进 spec 的
wiring status 与节点证据，不能让它看起来像已生效。配套要求是一条**会真的失败**的负例
（源码扫描 prompt owner 是否引用了该模块）。收口前请临时注入一行验证它会红，再撤回——
空断言比没有断言更糟。

**6.3 测试失败先修实现，别改断言。**
本轮两个失败都是真实缺陷：`applied` 分支丢了 owner detail；pack 字符数应当优先用
owner 自报的 `budget.usedChars` 而不是自行累加 item。两个都改了实现。

**6.4 flat 分支上 diffBase 要逐叶前进。**
每叶 spec 的 `diffBase` = 该叶开始前的 HEAD。整分支跑 validate 必然报"未覆盖的改动"，
这是设计而非缺陷；按叶用 `--since <该叶 diffBase>` 复验。

**6.5 累计提交要能干净重排。**
若发现某叶的 spec 改动落进了后一叶的区间，用 tag 保住两个提交再 reset + cherry-pick 重排，
比 amend 到一半更安全。本轮就是靠 `git tag tmp-a3/tmp-docs` 重排成功的。

**6.6 文件写入的相对路径用的是进程 CWD，不是 PowerShell 的 location。**
在本工作树里 `Set-Location` 之后再用相对路径调用 .NET 文件 API，写入会落到**主检出**
（本机 C:\...\ClawX 是指向 D:\ClawX 的 junction，而 D:\ClawX 正好有另一条线在跑）。
发现后立刻在主检出 `git checkout -- <那个文件>` 还原，再确认主检出 `git status` 没有多出别的改动。
规则：脚本里一律绝对路径；写文件后同时在**两个**检出里 `git status --porcelain` 自查。

**6.7 写文件要保住原有换行。**
WriteAllLines 用 CRLF，会把整个 LF 文件变成 600 多行的伪改动。先读原文判断换行
（看是否含 CR LF），再用 WriteAllText 把行数组按原换行 join 回去。
改完看 `git diff --stat`：行数应当等于你真正改的行数，多了就是换行被改写。

**6.8 新增 runtime 配置叶子会同时触发四条硬门禁。**
type（types.openclaw.ts）、zod（zod-schema.ts，contextBlock 是 strict，漏了整段会被 strip）、
runtime-feature-leaves.ts 的 RUNTIME_FEATURE_EXHAUSTIVE（DeepRequired 会编译失败），
以及 ComponentDispositionManifest 的覆盖。前三条一次改齐即可；disposition 用已有条目的
runtimeLeafPatterns 加一条 glob（如 contextBlock.sessionStartInjection.*）最省，比新增条目少写 owner/node 字段。
labels/help 可选（injectionBudget 就没有），但加上更利于运维。

**6.9 新增注入通道要改两处类型。**
TURN_INJECTION_PRECEDENCE / TURN_INJECTION_CHANNEL_POLICY 是 turn ledger 的；
injection-budget.ts 的 InjectionChannel 是 DCS 旧预算的类型孪生，漏改会在 assembler.ts 报 TS2345。

**6.10 “照着 compassContext 加一行”不能批量替换。**
compassContext 同时出现在 embedded runner 与 CLI runner 的参数对象里，而 RunCliAgentParams 没有新字段；
按行号与上下文精确匹配，改完再跑一次 typecheck:node。
