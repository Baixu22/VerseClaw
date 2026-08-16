# VerseShell 真实能力与短板审计报告

审计日期：2026-08-13  
审计对象：ClawX 仓库内 VerseShell runtime、随包 `ae.exe`、OpenClaw governed execution 接入、MCP 兼容层及现有 UAS-06 证据。

## 1. 执行结论

**结论：NO-GO。当前不具备默认启用、替代 PowerShell/Git Bash 或宣称产品 GA 的条件。**

VerseShell 的设计已经形成一套有价值的 governed execution 基础：结构化表达式、显式 argv 进程执行、输出边界、工件句柄、审批和 fail-closed 路径都已存在，部分独立 runtime/MCP 能力也能完成真实操作。但当前随包服务 runtime 在合法请求到达后可稳定崩溃，真实 governed-exec 验收失败；同时 manifest、源码和协议存在版本漂移，MCP 兼容层默认权限过宽且开箱无法启动。

因此，当前最准确的定位是：**default-off 的工程 canary 基础设施，尚未达到可依赖的产品执行平面。**

## 2. 审计范围与证据等级

本次审计结合了四类证据：

1. 静态审计：runtime、server、MCP bridge、manifest、OpenClaw facade/governed-exec、状态和能力审计文档。
2. 黑盒实测：直接启动 `resources/bin/win32-x64/ae.exe`，发送 JSONL 请求；并对独立 VerseShell/MCP 工具执行表达式、管道、系统查询、进程和大输出测试。
3. 可重建性复核：从 `verseshell-runtime` 本地源码编译 release binary，并复现服务崩溃。
4. 自动化验收：运行 `pnpm verseshell:test`、manifest 校验和 UAS-06 边界测试。

证据限制也必须明确：当前没有 provider-backed 的真实用户任务、没有真实 paired A/B、没有长时间 soak、没有真实 operator rollback drill，也没有 macOS/Linux 的可运行包。因此工程单测通过不能等同于产品可用。

## 3. 已确认的真实能力

| 能力 | 实测结论 | 备注 |
|---|---|---|
| 表达式求值 | 可用 | typed lambda、`try/catch`、pattern match 可执行 |
| 数据管道 | 可用 | `where`、`sort`、`map` 等组合正常；示例 `[5,2,4,1,3]` 可得到 `[40,50,60]` |
| 系统信息 | 可用（独立工具路径） | hostname、CPU、内存、磁盘等查询成功 |
| 显式进程执行 | 可用（受限场景） | argv 形式和显式 `cmd.exe` 调用可完成 |
| 输出控制 | 可用 | 大输出会被截断，返回 `omitted_bytes` 和有限文本 |
| 结果工件化 | 可用 | 可生成 `result://sha256/...` 句柄 |
| bounded observation | 可用 | 能保留有限、可审计的观察结果 |
| governed execution | **不可验收** | 真实二进制在审批场景先崩溃，见第 4 节 |
| JSONL server | **不可用** | 合法请求触发进程退出，见第 4 节 |
| MCP 兼容包 | **开箱不可用** | 缺少 `@modelcontextprotocol/sdk` 安装，见第 5 节 |

这些能力说明 VerseShell 不是“完全没有价值”：它在结构化执行、输出压缩和工件化方面比直接拼接 shell 字符串更适合作为 agent 工具层。但上述能力不能覆盖服务崩溃、治理和发布一致性问题。

## 4. P0 阻断项

### P0-1：随包 server 模式可稳定崩溃

实测命令：

```powershell
@'
{"id":"audit2","agent":"audit","cmd":"sys.hostname()"}
'@ | & resources\bin\win32-x64\ae.exe --serve --agent --workspace . --policy strict --cap shell.exec --format json
```

结果为 Rust panic：

```text
thread 'main' panicked at ... std::time.rs:445:33:
overflow when subtracting duration from instant
EXIT=101
```

不带 `--agent` 也可复现；从本地源码编译的 `target/release/ae.exe` 同样复现。源码根因位于 [cache.rs](/C:/Users/27933/Desktop/clawx/ClawX/verseshell-runtime/src/cache.rs:88)：

```rust
taken_at: Instant::now() - Duration::from_secs(3600),
```

当 Windows 系统 uptime 小于一小时，`Instant` 不能安全地向过去减去一小时，runtime 初始化直接 panic。该问题发生在请求处理前，影响 server、typed ACI、facade 和 governed gateway 的所有依赖路径。

**验收标准：**在 uptime 小于一小时、重启后、无 `--agent`/有 `--agent`、JSON/compact 两种格式下，合法 handshake 和最小请求均返回协议错误或成功响应，进程不得退出；增加回归测试覆盖短 uptime。

### P0-2：真实 governed-exec 审批验收失败

新鲜运行 `pnpm verseshell:test` 时，bundle 和 runtime 单测通过，但 OpenClaw VerseShell suite 为 **56/57**；失败用例为 `governed-exec.real.test.ts`，期望 `E_NEEDS_APPROVAL`，实际收到 `E_ACI_PROCESS_EXITED`。这证明真实二进制在应当 fail-closed 地返回审批拒绝之前已经崩溃，当前不能把 governed execution 标记为可用。

仓库内生成的 UAS-06 报告曾记录 57/57 通过，说明该报告与当前新鲜运行结果不一致，属于证据新鲜度/发布门禁问题，不能用旧报告覆盖现场失败。

### P0-3：发布物、源码和协议不一致

[manifest.json](/C:/Users/27933/Desktop/clawx/ClawX/resources/verseshell/manifest.json:11) 声明 crate/server 为 **1.0.0**、协议为 `verseshell.jsonl/v1`、catalog 为 31 项；但当前 [Cargo.toml](/C:/Users/27933/Desktop/clawx/ClawX/verseshell-runtime/Cargo.toml:6) 是 **0.3.0**，`server.rs`/`runtime.rs` 仍使用旧的 `id/agent/cmd` 请求模型，没有 typed `op/args`。

manifest checksum 通过只说明当前 exe 与 manifest 中的字节一致，不能证明仓库源码能重建该 exe，也不能证明协议实现与 manifest 相符。manifest 还明确记录了 dirty build input，进一步降低可复现性。

**验收标准：**冻结单一 source snapshot；从干净 checkout、固定 patch、固定 lockfile 可重建相同版本、digest 和协议；CI 必须比较 crate version、handshake、catalog digest、binary digest，任何漂移直接阻断发布。

## 5. P1 明显短板

### P1-1：MCP 兼容层默认权限过宽，且不是 governed 安全边界

[resources/verseshell-mcp/src/index.js](/C:/Users/27933/Desktop/clawx/ClawX/resources/verseshell-mcp/src/index.js:55) 默认 `CAPS = "all"`，默认关闭 `AGENT_MODE`，同时暴露 `verseshell_eval`（任意 VerseShell 表达式）和 `verseshell_shell_exec`（Windows 默认 `cmd /C`）。子进程异常后还会自动一秒重启。该路径没有 OpenClaw governed typed ACI 的同等审批/策略边界，不能宣传为等价安全通道。

建议默认 deny；按工具和操作 allowlist 授权；移除任意 eval，或仅在明确的开发 profile 可用；将 MCP 标记为兼容层并在 telemetry 中区分，禁止它绕过 governed owner。

### P1-2：MCP 包开箱无法运行且存在版本混淆

直接运行 `node resources/verseshell-mcp/src/index.js` 报 `ERR_MODULE_NOT_FOUND: @modelcontextprotocol/sdk`。目录声明了依赖但未安装，根项目也不能直接解析。实际运行环境中出现的 `verseshell-mcp 0.6.0` 与仓库兼容包 `0.3.1` 不是同一实现，不能互相充当验收证据。

### P1-3：仅提供 Windows x64 预构建包

manifest 只有 `win32-x64/ae.exe`；darwin-x64、darwin-arm64、linux-x64、linux-arm64 均为空，`mcp_binary` 也是 `not_packaged`。跨平台能力目前是声明层面的预留，不是可交付能力。

### P1-4：workspace jail 不是 OS 级沙箱

workspace jail 主要限制 VerseShell 自身 typed file path；通过 `exec.run` 启动的外部进程仍可能访问 workspace 之外资源。它不能替代 OS/container/filesystem sandbox，最终安全责任仍在 OpenClaw policy、approval 和 sandbox owner。产品文案和 threat model 必须明确这一边界。

### P1-5：外部 shell 写入不在统一事务内

VerseShell transaction 覆盖 typed file/builtin 写入，但 shell、脚本、编译器和 git 的外部写入不进入同一 transaction。ClawX 另有 write journal、stale-write guard、mutation queue、undo，两套 authority 尚未统一，导致 rollback、审计、并发冲突和“可恢复操作”承诺不一致。

## 6. P2 工程与证据缺口

- 没有 provider-backed 真实任务和真实内部 cohort 观察；UAS-06 报告为 `status=needs-real-canary`、`productGraduationAuthorized=false`、`live=0`。
- 没有 paired baseline/VerseShell A/B、长时间 soak、资源/延迟基线、artifact recovery 和人工恢复时长证据。
- operator kill-switch 和显式 rollback drill 尚未形成 reviewed live record。
- Rust `cargo test --no-run` 仍有测试编译问题（例如 `CapabilityResult` 缺少 `PartialEq`），说明底层单测门禁并不完整。
- 需要统一错误码、协议握手、重启后的 session/工件恢复语义；当前工程矩阵中的 `restart` 观察为 `recoveryState=lost`，不应解读为业务恢复成功。

## 7. 安全与治理判断

已有设计优点包括：OpenClaw 默认 `default-off`；模型不能按单次调用选择 `host=verseshell`；operator 才能在 global/agent/session scope 选择；能力 profile 固定为 `shell.exec`；verified runtime、typed ACI、facade、governed exec 多重 flag 缺一即 fail-closed；不自动回退 native shell。这些是正确的治理方向。

但治理设计不能抵消运行时崩溃和兼容层旁路风险。特别是“结构化表达式”不等于“安全执行”，“workspace jail”不等于“OS 沙箱”，“工程矩阵通过”不等于“真实用户可用”。

## 8. 整改顺序与放行门槛

1. **立即修 P0 runtime crash。** 使用 `checked_sub` 或显式 empty 状态初始化 cache；加入短 uptime 回归测试；重新跑真实 server、handshake、approval、timeout、restart。
2. **统一 1.0 typed ACI source/build/protocol。** 清理 0.3.0 旧 `cmd` 模型，锁定 source snapshot、patch、Cargo.lock 和 catalog；CI 做 digest/version/handshake 一致性校验。
3. **修复 governed-exec real suite。** 审批拒绝必须稳定返回 `E_NEEDS_APPROVAL`，runtime 退出必须转换为明确、可观测、可恢复的错误，不能泄漏为未分类 process exit。
4. **收紧并隔离 MCP。** 默认 deny、最小权限、依赖安装验收、版本单一化；任意 eval 仅开发 profile；MCP 不得绕过 governed owner。
5. **明确写入 authority。** 设计外部进程写入的 journal/rollback/冲突协议，或明确禁止其参与可恢复事务。
6. **补真实证据后再考虑 canary。** provider-backed paired A/B、内部 cohort、soak、资源/延迟、artifact recovery、operator kill-switch/rollback，全部形成可审阅记录。
7. **最后补齐平台包。** macOS Intel/Apple Silicon、Linux x64/arm64 的构建、签名、启动和最小协议验收。

建议的放行条件是：P0 全部关闭；新鲜 `pnpm verseshell:test` 全绿；manifest/source/protocol 可重建且无 dirty drift；MCP 依赖和权限验收通过；真实 canary 报告的 `liveReady=true`、`productApproved=true`，并经过人工 rollback 演练。否则保持 default-off。

## 9. 最终 Go/No-Go

| 场景 | 决策 |
|---|---|
| 默认启用 VerseShell | **NO-GO** |
| 宣称替代 PowerShell/Git Bash | **NO-GO** |
| 对真实用户开放 governed canary | **NO-GO，待 P0 修复和真实证据** |
| 继续进行隔离的工程开发/离线测试 | **GO，保持 default-off 和 fail-closed** |
| 将当前 MCP 兼容层作为等价安全执行通道 | **NO-GO** |

本报告的核心判断不是 VerseShell 没有能力，而是：**已有能力集中在“结构化执行内核”，关键的服务稳定性、发布一致性、安全边界和真实产品证据尚未闭环。**
