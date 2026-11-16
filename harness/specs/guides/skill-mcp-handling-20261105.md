---
id: skill-mcp-handling-20261105
title: ClawX Skill and MCP handling against current upstream standards
type: guide
---

# ClawX 的 Skill 与 MCP 处理机制

调研基线：2026-11-05；最终复核：2026-11-06，Asia/Shanghai。driven_by: agent；actor: codex-skill-mcp-audit。
对象是 ClawX 应用。上一轮偏离范围的个人 skill / 开发 MCP 配置已按备份撤回，凭据保持原样。

## 判断

现有实现是“本地 Skill 渐进加载 + MCP v1 会话客户端 + 统一能力发布投影”。已有真实安装校验、
权限过滤、连接与工具调用，应复用这些 owner。2026-07-28 的发现、订阅与 Skills 扩展尚未接线。
比单纯升级版本更紧迫的是证明 Skill 的安装/开关最终到达 runtime，而不只在 Settings 显示成功。

## 已核对的应用路径

| 阶段 | Skill | MCP |
| --- | --- | --- |
| 入口 | Settings → skills store → hostApi.skills | MCP 管理 → mcp store → hostApi.mcp |
| 安装/保存 | skills-api、skill-installer；Git/zip、来源和内容 digest | mcp-api；mcp-servers Electron store、env SecretRef |
| 作用域 | 本地 enabled、agent skills 选择、runtime skills.entries | global/agent/workspace、exposure、工具 allow/deny |
| 发布 | capability-publications 派生可见性 | 同一 publication 层派生 configured/warm/tool-visible |
| 执行 | workspace loader → skill-index → 元信息 prompt → 按需读正文 | session runtime → SDK transport → tools/list → materialize → callTool |
| 生命周期 | 来源优先级、内容版本标记、加载预算 | config fingerprint、idle TTL、断线/通知失效、reload |

publication 是读模型，不是执行器。Renderer 仍经 Host API 访问 Main；Skill 指令不授予 MCP 权限。

### Skill 已有能力与限制

- `openclaw_runtime/src/skills/loading/workspace.ts:1186`：extra < bundled < managed < 个人 `.agents/skills` < 项目 `.agents/skills` < workspace/skills，后者覆盖前者。
- loader 有文件体积、目录数量、遍历预算、路径边界和 symlink 约束。
- `skills/loading/skill-contract.ts`：prompt 放 name/description/location/content-version；匹配后读取正文。`skill-index.ts` 区分 promptVisible、runtimeVisible 和 userInvocable。
- `electron/gateway/skill-installer.ts`：安装记录保存 requestedVersionStatus、trackedRef、resolvedRevision、SHA256。Main 在落盘完整性验证后才启用。
- `electron/services/skills-api.ts:204`：市场搜索实际使用内置六项 Work Mode catalog；`:246` 的卸载当前是返回成功的 no-op。接口名不能证明完整在线市场生命周期。
- 指定版本无法解析为 ref 时，安装器可退回默认分支并记录 unresolved；不能据此宣称已安装指定最新版。
- `electron/services/skills/local-skill-service.ts:190` 读取顶层 version/author，没有映射标准 `metadata.version/author`。这是元数据显示兼容缺口，不等于正文无法加载。

### Skill 生效链需要优先确认

`src/stores/skills.ts` 的开关调用 `hostApi.skills.updateConfigs`；`skills-api.ts:142` 委托
`electron/utils/skill-config.ts:192`，写入 userData 的 `verse-claw-skills` store。
运行时 `skills/loading/config.ts:45` 则读取 `OpenClawConfig.skills.entries`。
安装目录是 userData/verse-claw-skills（`electron/utils/paths.ts:91`），主 loader 的 managed
默认目录是 CONFIG_DIR/skills（`workspace.ts:1119`）。

本轮在这些 owner/callers 中未找到统一投影到 runtime entries/extraDirs 的完整链路。
隔离目录调用真实 updateSkillConfigs 后，返回 success=true，本地 enabled=false，而原 runtime
配置仍为 enabled=true；该探针确认此函数不完成同步，不代表完整 Electron 路径验收。
归档合同 decouple-skills-page-from-gateway.md:72 明确要求写入 openclaw.json，当前路径与其不符。下一项修复先构造
安装→启用→模型可见→禁用→不可见→重启的自动场景，在现有配置 owner 修复一次；不增加第二个 store。

### MCP 已有能力与限制

- stdio、Streamable HTTP、兼容 SSE；保存时拒绝不受 SDK 支持的 WebSocket。
- `electron/services/mcp-api.ts:898/988/1418`：配置投影、同步到 `mcp.servers`、reload acknowledgement；权限、网络策略、TLS、env/headers、toolFilter 随配置进入 runtime。
- `agent-bundle-mcp-runtime.ts:686`：真实 Client 连接和 tools/list，失败不伪报 connected。
- 缓存响应 tools/list_changed 和 transport close/error；一个服务掉线不会清除其他服务工具。
- `agent-bundle-mcp-materialize.ts` 支持 structuredContent、resource/link 和 prompt 辅助操作；audio 仅为文本说明，不是完整媒体通道。
- runtime 有 OAuth provider，但 shared McpServerConfig/管理 API 未完整暴露 auth/oauth 生命周期。runtime 支持不等于用户侧完整授权体验。

## 官方最新基线与实际更新

| 上游 | 2026-11-05 核对结果 | 项目含义 |
| --- | --- | --- |
| Agent Skills | SKILL.md、YAML 元数据与渐进披露 | 本地 loader 方向正确，需补元数据与生效闭环 |
| MCP 协议 | 2026-07-28 | 去 initialize 握手，逐请求 metadata、server/discover、subscriptions/listen |
| TypeScript v1 | SDK 1.32.2，2026-10-23 发布 | 最高协议仍是 2025-11-25，不等于 v2 |
| TypeScript v2 | client/server/core 2.4.0，2026-10-23 发布 | 稳定分包；连接和生命周期不能只改版本号 |
| Skills over MCP | SEP-2640，v2.4.0 新增 ext/skills | SkillsClient 可 list/read/verify；服务端 attach 仍 experimental |

发布说明确认 Skills 扩展可用于 2025-11-25 和 2026-07-28；规范示例使用后者。
应分别检查协议与扩展声明，不能只凭版本号推断支持。

本轮把主 runtime、内嵌 VerseBrowser、VerseShell adapter 的直接 SDK 声明对齐到 1.32.2，
更新两个 pnpm lockfile。runtime 的 `extensions/browser`、`extensions/codex-supervisor`、`extensions/qa-lab`
和旧包传递依赖仍可能保留 1.29.0。实际安装与回归结果见本轮 evidence report；不宣称全图只有一个版本。

## 处理顺序

1. **Skill 管理到 runtime 闭环**：复用 config mutation/discovery owner，覆盖安装、启停、更新、回退、重启；版本 unresolved 不应呈现为指定版本升级成功。
2. **v1 维护更新验证**：三处包声明、锁文件、安装身份一致，覆盖旧服务器、stdio/HTTP、授权、取消、目录变化和受限工具。
3. **MCP v2 正式迁移**：使用官方 client/server/server-legacy，复用现有 session runtime owner；验证新旧服务矩阵、discover、版本不支持、鉴权失败、订阅缓存失效。新协议健康以 discover 和对应操作为证据，旧协议继续真实 initialize。
4. **远程 Skill 来源**：先检查扩展声明再 list/get；保留来源 server、URI、scope、manifest；按需 resources/read，连接时不下载全部正文。校验每文件原始字节 size/digest 和 frontmatter；批准绑定完整 URI/digest 集合，内容变更撤销批准。缓存置于本地 Skill 扫描路径外，重启仍保留 MCP 来源；动态资源不能继承任意未来内容的批准。
5. **UI 状态对齐**：沿 Host API 展示 discovered、enabled、runtime-visible、authorized、verified 和 update-available，不从 Renderer 直连外部服务。

v2、远程 Skill、授权 UI 是应用行为迁移，需各自的合同、自动化验收和回滚边界。
不修改产品锁；验收由 agent 完成，不要求真人数据或 verdict。

## 验证边界

源码已检查 UI store、Main 服务、来源安装、配置、loader、publication、transport、目录与 materialization。
最终五文件 35 测试、runtime 两文件 15 测试、浏览器 37 测试、VerseShell 11 测试通过，共 98 项。
浏览器取消场景在补齐二进制并重放仓库既有 patch-upstream 后通过；浏览器类型检查和 comms 两项也通过。
两次工作区安装遇到 Electron EPERM，后以 pnpm 11.2.2 和从同一锁文件提取的局部依赖完成；
虚拟依赖目录位于已忽略的 .local/skill-mcp-deps-20261105。未改新补丁或依赖策略。完整命令、安装问题、
后续回归与正常 Harness diff ownership 结果见 `../fixtures/skill-mcp-handling-20261105/report.json`。
不宣称完成新协议、Skills 扩展、真实模型使用或完整 Electron E2E。
共享工作树其他任务修改导致正常 Harness ownership 拒绝混合候选；不扩大 ownedPaths 或用 --no-diff 掩盖。

## 官方来源

- https://agentskills.io/specification
- https://agentskills.io/integrate-skills
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/extensions/skills
- https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.2
- https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0
- https://registry.npmjs.org/@modelcontextprotocol%2Fsdk
- https://registry.npmjs.org/@modelcontextprotocol%2Fclient
