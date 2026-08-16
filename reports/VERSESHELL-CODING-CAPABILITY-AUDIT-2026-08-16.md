# VerseShell 编码能力真实审计与主流 Agent 对比（2026-08-16）

> 结论先行：**当前 ClawX/OpenClaw 的 VerseShell 编码能力是一条“治理设计明显更严格、但集成深度与产品成熟度显著落后”的 default-off 工程 canary。它不能超过 Claude Code / Codex CLI / Gemini CLI / Cursor / Devin 等主流编码 Agent。**
>
> 它目前可复现、真实可用的能力只有：受治理的 `exec.run` + 进程生命周期 + 有界结果工件 + 3 个只读工具（`read_file` / `search_content` / `result_query`）。二进制里的 31 个 typed operations 中，**21 个未桥接到模型工具面**；声明的 4 个 facade operation 中 `run_command` 未作为工具物化；transaction 对 `file.write` 不生效。因此“拥有 capability”与“可用 capability”之间存在明显假阳性。

---

## 1. 审计范围与方法

### 1.1 对象
- 随包 runtime：`resources/bin/win32-x64/ae.exe`（v1.0.0，sha256 `ac6a7a15…7478`，14,879,232 bytes）
- OpenClaw 接入：`openclaw_runtime/src/agents/verseshell/**`、`bash-tools.exec*.ts`、`agent-tools.ts`
- 共享契约：`shared/verseshell/**`
- 兼容层：`resources/verseshell-mcp/**`
- 工程证据：`docs/dev/verseshell-foundation/**`、`harness/specs/**`、`artifacts/**`
- 外围编码工具面：`read/ls/edit/write/apply_patch/exec/process/auto-verify/write-journal/undo_write` 等

### 1.2 方法
1. 静态桥接审计：从模型工具面反向查找 VerseShell operation 的调用点。
2. 黑盒实测：直接驱动 `ae.exe --serve` typed JSONL；并临时通过 OpenClaw `createOpenClawCodingTools()` 做真实工具调用（不走 mock）。
3. 新鲜测试：`pnpm verseshell:test`、真实 binary E2E、`governed-exec.real`、只读 facade、编码工具与 apply_patch 测试。
4. 外部对比：使用本机 AnySearch（`api.anysearch.com/mcp`）检索 2026-08 的 Claude Code、Codex CLI、Gemini CLI、Cursor、Devin 的公开能力与基准数据。外部数据为搜索快照，未逐一访问原始页面复核。

---

## 2. 新鲜本地实测结果（本次审计重新执行）

| 检查 | 命令 / 路径 | 结果 |
|---|---|---|
| bundled runtime 版本 | `ae.exe --version` | `ae 1.0.0` |
| bundle/source identity | `node scripts/verseshell-bundle.mjs validate --platform win32 --arch x64 --mode package` | PASS，sha256 与 manifest 一致 |
| 全量 VerseShell 门禁 | `pnpm verseshell:test` | PASS：bundle 13/13，runtime-bundle 11/11，OpenClaw 15 files/141 tests，MCP 11/11 |
| 真实 governed exec | `governed-exec.real.test.ts` | PASS：审批拒绝 `E_NEEDS_APPROVAL`、token 单次重试、大输出工件化、`result.query` 恢复 |
| 真实 legacy E2E | `verseshell-runtime.e2e.test.ts`（`VERSESHELL_AE_PATH` 指向随包 exe） | 35/35 PASS |
| typed handshake | 黑盒 `runtime.handshake` | 返回 v1.0.0 / `verseshell.jsonl/v1` / catalog 31 / 期望 digest |
| 真实 typed 读/搜索/执行 | `createOpenClawCodingTools()` + 5 个 VS flags + verified env | `read_file`、`search_content`、`exec`、`verseshell_result` 全链路真实可用 |
| workspace jail | typed `file.read_range`/`file.write` 访问 `..` 与绝对路径 | `E_OUTSIDE_WORKSPACE`，PASS |
| 只读 facade 默认关闭 | `resolveVerseShellFoundationRollout({})` | 10 个 flag 全部 `source=default`、`enabled=false` |
| OpenClaw 编码工具 | read/write/edit/edit-diff 75 tests；apply_patch 31 tests；auto-verify 4 tests | 全 PASS |
| 编码工程控制面自审计 | `pnpm agent-dev:audit` | **FAIL：69/100，grade D；Workbench/deep-test/quality 证据过期 38h；deep-test decision=blocked** |

### 关键黑盒事实
- typed ACI server 短 uptime 崩溃（旧 P0-1）**已修复**：随包二进制可完成 handshake、typed 读、exec、artifact 全链路。
- governed exec 的审批、单次 token、工件回收已不是 mock，本轮真实 Windows binary 通过。
- 真实 `exec.run` 的观察结果中 `capabilities_used=["shell.exec"]`、`result.query` 恢复成功。

---

## 3. 假阳性 / 未桥接 / 明显漏洞清单（真实审计结论）

### F1（高）31 个 typed operations，只有 10 个真正接入运行路径
`ops.list` 返回 31 operations，但静态调用点显示实际可达的只有：

**已桥接（10）**
`runtime.handshake`、`exec.run`、`result.query`、`file.view`、`repo.search`、
`process.start`、`process.poll`、`process.write`、`process.kill`、`process.list`

**存在但未桥接（21）**
`file.write`、`file.apply_patch`、`file.edit_range`、`file.read_range`、`file.hash`、
`file.diff`、`file.replace_exact`、`file.remove`、
`repo.summary`、`repo.changed_files`、
`test.discover`、`test.run_target`、`test.summarize_last`、
`tx.begin`、`tx.commit`、`tx.rollback`、`tx.restore`、`tx.status`、
`ops.list`、`ops.observation_recent`、`ops.observation_open_errors`

其中 `test.*`、`tx.*`、`file.write/apply_patch/edit_range` 等正是“编码能力”最相关的部分。**模型今天不能通过任何默认或显式配置调用它们**（MCP 兼容层也把 file write 等列为 deferred）。代码存在 ≠ 编码能力可用。

### F2（高）`shared/verseshell/facade.ts` 声明 `run_command`，但工具工厂不物化它
- `CLAWX_VERSESHELL_FACADE` 定义 4 个模型面：`read_file`、`search_content`、`run_command`、`result_query`。
- `createVerseShellReadonlyFacadeTools()` 实际只返回 3 个：`read_file`、`search_content`、`result_query`。
- `run_command` 只能经原生 `exec` 工具在 operator 显式设置 `tools.exec.host=verseshell` 后可达；没有独立 VS 工具，也不是默认路径。它同时要求 5 个 foundation flag 全开，缺一 fail-closed。

### F3（高）transaction 对 `file.write` 是假覆盖
黑盒复现（`--agent --workspace <tmp> --cap file.read,file.write`）：
1. `tx.begin()` → active, depth=1
2. `file.write(path="new.txt")` → ok=true
3. `tx.status()` → `ops=0`
4. `tx.rollback()` → `restored_paths=0`
5. 文件仍存在。

对已有文件 `file.write` 同样 `ops=0`，回滚后内容仍被覆盖。`file.edit_range` 会被记录并可回滚，但 **“transaction 覆盖 typed file 写入”这一能力声明目前对 `file.write` 不成立**。

### F4（中高）`file.apply_patch` 参数无 schema 校验，错写 key 会静默变成“删除”
- 正确 key 是 `patches[].replace`。
- 黑盒传 `patches[].replacement`（常见命名）时，runtime 返回 `ok=true, applied=true`，但把匹配文本替换为空字符串，产生静默数据丢失。
- `ops.list` 不返回 input_schema，仓库内也没有针对 typed op 的入参 schema 文档；模型/适配器一旦拼错 key 不会得到 `E_ARG`，而会得到“成功删除”。

### F5（中）capability 解析对未知 token 静默清零，而非拒绝启动
`--cap file.read,bogus`、`--cap file.read,repo.search`（把 operation 名当 capability 传）：
- 进程正常启动，handshake `granted=[]`；
- 后续请求全部 `E_CAPABILITY_DENY`。
这是 fail-closed，安全性没问题，但**配置错误被静默吞掉**，诊断面与“capability 对齐”声明不一致；MCP 层的 policy.js 会拒绝未知 capability，而 runtime CLI 不会。

### F6（中）仓库内 `verseshell-runtime/` 源码与随包二进制版本漂移
- `verseshell-runtime/Cargo.toml` 仍是 `verseshell 0.3.0`（README 描述 v3 kernel/650+ builtins 的旧面）。
- 随包二进制是 `1.0.0`，manifest 的可重建来源是外部 pinned commit + 4 个 patch，不在该目录。
- `pnpm verseshell:test` 不运行 `cargo test`；文档中残留的 `cargo test --manifest-path verseshell-runtime/Cargo.toml` 会测错版本。若任何 CI/人把该目录当作 shipped source，会得到假证据。

### F7（中）编码工程控制面当前不是绿的
- `pnpm agent-dev:audit` 当前 69/100（D，hard veto）：Workbench/deep-test/quality evidence 过期 38h，最新 deep-test `decision=blocked`（playwright-agent-dev fail）。
- 这与 VerseShell 141 tests 全绿不矛盾：**局部工程证据通过不能外推为整套 coding 控制面可用**。

### F8（低-中）跨平台与真实 cohort 仍是空白
- 随包 VS 只有 `win32-x64/ae.exe`；darwin/linux 在 manifest 中为 `not_packaged`。
- `artifacts/uas-06-single-local-exec-canary/real-cohort-report.json`：`no-live-observations`，live=0，paired real tasks=0，provider usage=0。
- `agent-dev:audit` 与 UAS-06 共同说明：**没有 provider 收据、没有 paired A/B、没有 soak、没有 reviewed operator drill**。

---

## 4. 广度 × 深度能力矩阵

深度刻度：
- **S0**：不存在或仅占位
- **S1**：代码存在但未桥接 / 默认关闭 / 仅开发 profile
- **S2**：工程 canary，本地测试绿，非产品默认
- **S3**：产品路径可用，但深度/生态/证据不足
- **S4**：生产成熟或行业基准证明

外部列基于 AnySearch 2026-08 检索快照，标 `*` 表示媒体/聚合数据，未经官方原页逐项复核。

| 能力维度（广度） | ClawX + VerseShell（本次实测） | Claude Code | OpenAI Codex CLI | Gemini CLI | Cursor | Devin |
|---|---|---|---|---|---|---|
| 1. 自主编码循环（plan→edit→run→verify） | S3 产品路径可用，但整体产品仍 0.4.9-alpha；VS 执行面 S2 | S4 | S4 | S4 | S4 | S4 |
| 2. 代码探索（read/grep/glob/语义） | S2–S3：`read/ls/exec rg`；语义 DCS 工具默认 off；codegraph 已 RETIRED；VS `read_file/search_content` S2 | S4（Read/Grep/Glob+subagent/MCP LSP） | S4 | S4 | S4（IDE codebase index） | S4 |
| 3. 多文件精确编辑 | S3：`edit/write/apply_patch` 测试绿；VS typed 编辑操作存在但未桥接（S1） | S4 | S4 | S3–S4 | S4 | S4 |
| 4. 写入安全/撤销/冲突 | S3：write-journal/undo_write/stale-write guard；VS transaction **对 file.write 无效（F3）** | S3（git/hooks，应用层） | S3–S4（OS 沙箱+git） | S3 | S3 | S3–S4 |
| 5. shell/进程执行 | S3 原生 exec/process；VS governed exec S2（真实通过，默认 off） | S4 | S4 | S4 | S4 | S4 |
| 6. 后台/长任务 | S3（process/wait/code mode；UAS-06 工程 9 场景） | S4 | S4（cloud fire-and-forget） | S4 | S4（Background Agents） | S4 |
| 7. 测试/自动验证 | S3（write autoVerify 实测 PASS）；VS `test.*` 未桥接 S1 | S4 | S4 | S3–S4 | S4 | S4 |
| 8. 浏览器/Web | S2–S3（agent_browser、web_search/fetch；未做真实验收） | S3（WebSearch/WebFetch，MCP 扩展） | S4（browser use） | S4（browser agent） | S3–S4 | S4 |
| 9. Subagent/多智能体 | S3（sessions_spawn/team_orchestrate/subagents）；无公开规模证据 | S4（Task/Agent Teams） | S4 | S4 | S4 | S4（agent fleets） |
| 10. 规划/任务分解 | S2–S3（update_plan/task_loop/mission_loop；缺公开效果证据） | S4 | S4 | S4 | S4 | S4 |
| 11. 长期记忆/项目上下文 | S2（DCS/context 工具多数 default-off；memory 工具在 coding profile） | S4（CLAUDE.md/memory/compaction） | S3–S4 | S4 | S4 | S4（session trajectories） |
| 12. MCP/插件/扩展 | S3（bundle-MCP 可物化；VS MCP 为外部兼容层，非内部路径） | S4 | S4 | S4 | S4 | S3–S4（自有集成） |
| 13. 安全沙箱 | 原生 sandbox 模式 S3；VS workspace jail S2，**非 OS 级沙箱**；fail-closed 设计是本项目长板 | S3（hooks/应用层） | S4（Seatbelt/Landlock/seccomp 默认） | S4（sandbox-exec/Docker/Podman） | S3–S4 | S4（托管沙箱） |
| 14. 结果有界化/可恢复工件 | VS S2：真实通过（`result://` + owner lineage + 过期/截断）——**本项目最接近差异化的能力** | S3（普通输出截断） | S3 | S3 | S3 | S4（会话回放） |
| 15. 公共基准证据 | **S0**：ClawX/VS 无任何 SWE-bench/Terminal-Bench 等公开成绩 | S4：TB2.1 Opus 5 约 89.1%*；SWE-bench Verified 88.6–97%* | S4：TB2.1 GPT-5.6 Sol 约 89.5%*；TB2.0 约 77.3%* | S3：SWE-bench Verified 约 76%* | S3：Composer 2.5 TB2.0 约 69.3%* | S4：SWE-1.7 TB2.0 约 81.5%* |
| 16. 跨平台 | App 多平台；**VS 仅 Windows x64**（S1） | S4 | S4 | S4 | S4 | S4（云端，无本地平台限制） |
| 17. 可观测/审计/治理 | S3：审批、policy、trace、写日志；VS fail-closed 设计强 | S3–S4（hooks/权限） | S3–S4 | S3 | S3 | S4 |
| 18. 成熟度/发布状态 | **0.4.9-alpha.0**；VS default-off canary；agent-dev 自审计 69/D | GA | GA（开源 Rust，67k+ stars*） | GA（2026-06 免费层收缩，生态迁移） | GA | GA |

### 矩阵速读
- **广度**：ClawX 的“工具种类”已经覆盖主流 agent 的大部分能力（18 项里大部分 S2/S3），尤其治理/工件/事务设想是齐全的。
- **深度**：ClawX 几乎没有 S4 项；而 Claude Code 与 Codex CLI 在 18 项中大多数为 S4，并且有公开基准背书。
- **真正的差异化候选**：VS 的 fail-closed typed ACI、action-bound approval token、有界 artifact 恢复、直接 argv 命令计划。这是主流工具没有完全同构的能力，但目前只证明到 S2，且存在 F3/F4/F5 的契约漏洞。
- **最明显的非对称**：主流 agent 的竞争维度是模型质量 + 产品成熟度 + 生态；ClawX 当前的优势维度是治理严谨性，而基准和真实 cohort 均为 0。

---

## 5. 外部检索要点（AnySearch，2026-08 snapshot）

- Claude Code：TB2.1 默认 Opus 5 约 89.1%（max effort），SWE-bench Verified 高位；subagents/Agent Teams、hooks、MCP、plan mode、background tasks、SDK/headless 已成产品能力。来源：morphllm.com/best-ai-coding-agents-2026、kimi.com agent-teams guide 等。
- Codex CLI：Rust 开源，OS 内核级 sandbox 为默认卖点，cloud execution、subagents、browser use、plugins、Goals；GPT-5.6 Sol 默认后 TB2.1 约 89.5%。来源：nxcode.io、openai/codex changelog、arcbjorn.com。
- Gemini CLI：开源，subagents/browser/sandbox 齐全，SWE-bench Verified 约 76%；2026-06 免费层收缩、生态转向 Antigravity。来源：codegen.com、github.com/google-gemini/gemini-cli。
- Cursor：IDE agent mode、Background Agents（云沙箱）、BugBot、MCP；其 Composer 2.5 在 TB2.0 约 69.3%。来源：petronellatech.com、benchlm.ai。
- Devin：托管式 shell/editor/browser 沙箱、plan、agent fleets、企业集成；模型 SWE-1.7 在 TB2.0 约 81.5%。来源：devin.ai、benchlm.ai。
- 基准注意：SWE-bench Verified 已接近饱和，SWE-bench Pro 与 Terminal-Bench 2.x 是当前更有效的区分度；本仓库没有任何对应成绩。

---

## 6. 最终结论

1. **能否超过主流 Agent？不能。** 当前差距不是“模型差一点”，而是：
   - VerseShell 编码能力主要仍是 S1/S2（未桥接/default-off/工程 canary）；
   - 全产品是 alpha（0.4.9-alpha.0），编码工程自审计 fail（69/D）；
   - 公开基准为 0，真实 cohort 为 0；
   - 而 Claude Code 和 Codex CLI 在 2026-08 已是 GA 产品，公开 TB/SWE-bench 高位成绩，并持续发布 subagents/sandbox/cloud 等能力。

2. **有没有真实能力？有，且比上一轮审计明显改善。** P0 崩溃与 governed-exec 验收失败已修复；真实 Windows binary 的 `exec.run`、审批、单次 token、工件回收、只读 facade、workspace jail、argv command profiles 都通过新鲜实测。这不是“空壳”。

3. **有没有假阳性？有，且集中在“存在但未桥接”和“声明但契约不成立”。**
   - 31 ops 中 21 个未桥接（F1）；
   - facade 的 `run_command` 未物化（F2）；
   - transaction 不覆盖 `file.write`（F3）；
   - apply_patch 错 key 静默删除（F4）；
   - capability 配置错误静默清零（F5）；
   - 仓库内 Rust 源码与 shipped binary 版本漂移（F6）。

4. **战略定位建议。** 不要试图在“通用编码 agent 总分”上追平 Claude Code/Codex；把 VerseShell 收口为 **ClawX 独有 governance/execution plane**：
   - 先关闭 F3/F4/F5/F6 这类契约假阳性；
   - 补齐 typed 写入操作的 schema 校验、transaction 真实覆盖和 OpenClaw 侧桥接；
   - 用真实内部 cohort 和公开可复现 benchmark 证明 ROI；
   - 在获得 provider 收据与 paired A/B 前，继续维持 default-off，不宣称“超过主流 agent”。

## 7. 放行口径

| 场景 | 本次审计裁决 |
|---|---|
| VerseShell 作为默认本地执行平面 | NO-GO |
| 宣称超过 Claude Code / Codex / Gemini CLI / Cursor / Devin | NO-GO |
| 继续隔离工程开发与 canary 验证 | GO（修复 F3–F6 优先） |
| 将 MCP 兼容层作为内部执行路径 | NO-GO（维持外部兼容边界） |
| 对外发布基准/能力宣传 | NO-GO，除非附真实 provider-backed cohort 或公开 benchmark |
