# ClawX / Verse Claw 源码安全健康审计（证据快照版）

| 字段 | 值 |
|---|---|
| 文档身份 | **源码证据快照 / 安全健康审计**；不是“唯一权威”或生产认证 |
| 仓库 | `C:\Users\27933\Desktop\clawx\ClawX` |
| package | `verse-claw@0.4.9-alpha.0` |
| HEAD | `60061e33554311ac3c9871195210df59fe1b5bf2` |
| dirty | 快照时 169 条（tracked 27 / untracked 142） |
| dirty patch | `sha256:bf430bf565518462e04a84392e547ffe02656569a1a3be1c227073cc13d68e42`（833074 bytes） |
| 审计日 | 2026-07-16 |
| 方法 | 目录盘点 / 行级实读 / 模式扫描 / 二次复核；执行了定向单测与 3 项临时 L4 动态验证 |
| 偏见声明 | 不护短；默认关闭 ≠ 生产可用；存在代码 ≠ 生效；静态缺口 ≠ 已利用漏洞 |
| 覆盖声明 | 已读、片段、扫描、未验证严格分层 |
| 冲突规则 | 后节可修正前节；以本报告整合版 + manifest + findings JSON 为准 |

> 本报告绑定 `HEAD + dirtyPatchSha256`。行号可能随工作树变化漂移，以 manifest 中的文件 SHA256 和证据片段为准。

配套文件：[manifest](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.manifest.json) · [dirty patch](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.dirty.patch) · [findings JSON](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.findings.json) · [攻击链](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.attack-chains.md) · [待补审计清单](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.gap-checklist.md)

---

## 0. 读者导航

> B1–B8 重新审计已经回填。本文末尾的“重新审计补充与更正”及 findings.json 优先于前文旧的 Unverified 表述。

### 0.1 一句话结论

ClawX 是一个可运行的 alpha 级 Electron Agent 产品壳，控制面和高级 runtime 脚手架真实存在；但当前快照在 **secret、Renderer/Main broker、Files 读取边界、运行时硬授权、Windows 发布链与测试门禁** 上仍有发布阻断级缺口，综合健康区间 **5.0–5.8/10**，不能描述为 production-hardened。

### 0.2 可声称 / 不可声称

**可声称**

- Main/preload/host-api 分层真实存在，contextIsolation=true、nodeIntegration=false。
- Browser credential vault 使用 Electron safeStorage。
- Role tool allow/deny、Gateway auth、dangerous HTTP tool deny 等正面控制有源码证据。
- SEKB、Memory、部分 Coding/权威能力默认关闭或诊断级，状态可被静态识别。
- Agent Dev 控制面有结构化 evidence/audit/deep-test 产物。

**不可声称**

- Provider/Channel/Gateway secrets 已 OS 级保护或无明文副本。
- Renderer 无法获取明文 Provider key，或无法读取 workspace 外本地文件。
- WebView/Renderer compromise、IPC sender、Files Windows 完整 path escape 矩阵已全部动态通过。
- CVK/Spine/Verifier 已形成硬阻断权威。
- SEKB/DCS/Memory 已安全生产闭环。
- Agent Dev A 级代表全系统 release-ready。
- 当前 dirty tree 可直接构建可复现、签名、可信的 Windows 发布物。

### 0.3 决策摘要

| 决策 | 当前意见 |
|---|---|
| 是否可继续 alpha 内测 | **可以，需明确非生产 hardened，且不得接入高价值真实密钥/高敏 workspace 作为默认场景** |
| 是否可公开 SEKB/Memory 为生产能力 | **不可以**；默认关闭且数据权威边界未闭环 |
| 是否可接真实 Provider/Channel/Gateway secrets | **仅限受控内测**；P0 secret broker 完成前不建议高价值账户 |
| 是否可做 Windows 正式发布/自动更新 | **不可以**；alpha/beta unsigned、feed 注入与供应链完整性仍是 publish blockers（F-SUPPLY-001/002） |
| 是否可把 Agent Dev A 外推为系统安全等级 | **不可以** |

### 0.4 相对旧版的变化

- 删除“唯一权威”绝对化表述，绑定 HEAD + dirty patch hash。
- 将原 §10/§11 的补丁和修正回填到统一 Finding，不再让后节纠正前节。
- 将 P0/P1/P2 散点迁移并复审为 35 个统一 Finding；新增 8 条实质 Finding。
- 新增威胁模型、16 条攻击链、15 个子系统画像、B1–B8 重新审计清单。
- 将 UX/能力 default-off 与安全漏洞分开，避免混类。

### 0.5 如何阅读

- `F-SEC/AUTH/ISO/DATA/REL/SUPPLY/GOV/UX` 是 Finding 类别。
- L0–L4 是证据覆盖，不是严重度；只有 L4 才能声称动态可达性。
- 先看 §4 Finding，再用 §5 子系统画像理解影响面，用 §6 攻击链理解组合风险。

---

## 1. 资格与覆盖地图

### 1.1 规模现实

| 区域 | ts/tsx 数 | 说明 |
|---|---|---|
| openclaw_runtime/src | 4819 | 含大型 agents/gateway/channels/context-engine/cron |
| tests | 850 | 测试与 E2E |
| src | 330 | Renderer |
| electron | 221 | Main/Services |
| shared | 137 | 契约与共享类型 |
| electron/services 顶层 .ts | 77 | 77/77 做过 L1 模式扫描 |

一次审计不能对 5000+ 生产文件逐行证明。本报告的资格来自可复核覆盖地图、行级证据、哈希 manifest 和明确的未验证清单，而不是“已读完整仓库”的口头声明。

### 1.2 覆盖分层

| 层级 | 定义 | 允许结论 |
|---|---|---|
| L0 | 仅知存在 | 不得写通过 |
| L1 | 结构/文件名/行数/模式命中扫描 | 不得写通过；可提出待审计面 |
| L2 | 关键片段与行级证据 | 可写局部静态事实 |
| L3 | 全文或接近全文逻辑闭环 | 可写模块级静态结论 |
| L4 | 运行、故障注入、攻击或回归 | 可写动态可达性结论 |

### 1.3 已读索引

#### L3 全文 / 接近全文

| 文件 | SHA256 | 覆盖 |
|---|---|---|
| `electron/main/ipc/host-invoke.ts` | `03908a9c54ff97bf2be631450c3def04eb047f205479a5e27063694bd31d5726` | L3 |
| `electron/main/ipc/host-contract.ts` | `e443be4d73a1bbfd991bf40016f841df3f7fd356449c5b1ceaa4271a51e51192` | L3 |
| `electron/main/ipc/request-helpers.ts` | `28d85fa1143cd9a917a1be86c3e0b97465489313012c4963f88c3de01c8679e1` | L3 |
| `electron/preload/index.ts` | `8a79276e3ed6d6e55f4f2ab4660deefd7efe777bc464bdc2f876584e60710121` | L3 |
| `electron/services/shell-api.ts` | `712d2fc104309c862b681641cc981375b99a24526b9a523a3216d9991ebbb626` | L3 |
| `electron/services/secrets/secret-store.ts` | `2e512095603e856b9e2b04d462b683cc20bba4abdb1e4663d9423fa22520a787` | L3 |
| `electron/services/providers/store-instance.ts` | `c27dd53798e9c2ae2ec159ac7ce81a5daac9dd21df145fb802d43e2efd606fd6` | L3 |
| `electron/services/agent-browser-vault.ts` | `587c18428d9e48d5d90bb9b7fea9dac7c2b154f2e63a4f7968f91da20acce8e6` | L3 |
| `electron/utils/secure-storage.ts` | `50c5664b45de8de002e05c9c574683d9f5770c245c50c04ff517072d02e93ba6` | L3 |
| `electron/utils/sandbox-policy-resolver.ts` | `4d37d5128f0fb886dac0b07c4803be41cc8cfcb2ceeecf59e02d76ded07aa310` | L3 |
| `electron/services/workspace-permissions.ts` | `6848e649461188f8bb157050ce02a18eeeed1bc3abab0f7fbffc30efbc9173a8` | L3 |
| `src/lib/host-api-client.ts` | `a86bd313a290e843b0bf7704a1f7a205f876628b6e0f62b1ecd712c2982b57f7` | L3 |
| `shared/sensitive-content-boundary.ts` | `e5649e9144fe9e32ad6de7cedb6540bc3bf35ccfc8481f720cdf9eae609bf18a` | L3 |
| `shared/agent-browser/tool-authorization.ts` | `635853859df317e6604733efe27df6e5c9dafd453cc979c90dc53ca908393a5a` | L3 |
| `openclaw_runtime/src/knowledge/sekb/feature-flags.ts` | `b41baa455a34fcc06d5dafd1147dd4ff6834da962fb02a2822887849768b9a62` | L3 |
| `openclaw_runtime/src/knowledge/sekb/trajectory-capture.ts` | `ffa02d57bb5ece010a63d5f39587a00e0e64a056793ba8cd29ae7197c6fc2858` | L3 |
| `openclaw_runtime/src/agents/role-permissions-policy.ts` | `799cf8c2827a479c7f17334b8cd74c94664cae136e28b6be898c223adc36bb9c` | L3 |
| `openclaw_runtime/src/context-engine/coding-runtime-flags.ts` | `76cc7a2bcedc8ef2177b56d26e7918d1c8603fe03aec3d2492b15097b324f10b` | L3 |
| `openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts` | `1e133d636864c5eeb964a79f991eb76eb9ac8854f12bd280eb02de9b25c3a4b0` | L3 |
| `openclaw_runtime/src/runtime-spine/gate-engine.ts` | `0949296b95aef717c971b769cfd6cd8281c29c4f0cba373ba6eab038904edfc9` | L3 |
| `openclaw_runtime/src/gateway/server-methods/agent-browser.ts` | `6dda23728856a5fa72bb2bcac4dd4cfdc782d5fbdc1005c6625b95693295e046` | L3 |
| `openclaw_runtime/src/runtime-core/memory-runtime-config.ts` | `e74e172e510b7dcd8e0782ed5031e3644b63b85e29c36d1a7f3e0231a68dd1b8` | L3 |
| `openclaw_runtime/test/vitest/vitest.cron.config.ts` | `77a06bd1913ee4e44b12a7793ed233d5ab2c3a95df04a61571219804e3466749` | L3 |

#### L2 关键片段

| 文件 | SHA256 | 覆盖 |
|---|---|---|
| `electron/main/index.ts` | `ce2766b31cfcde5c4c0d1bcbd5166e061c7c502c2bc43b5008d2015b1be0db6a` | L2 |
| `electron/main/ipc-handlers.ts` | `8740dab1b2ac0223004e1fda5b8f6dfb6f723a1e606430cf8b7b8c92e4e5bd15` | L2 |
| `electron/utils/channel-config.ts` | `0720c11fef898876800116d11b879de7cba75831014bb028e29e26be399dd6cb` | L2 |
| `electron/services/cron-api.ts` | `88500e1b696b9a58be0d6948a4f3c5848188f7680076e0cb8df57089bd9bbf23` | L2 |
| `electron/services/knowledge-api.ts` | `78d23be40d97f252cd8f00ce996ee53f8ab0c945f180a0ae7fab2590bb645e26` | L2 |
| `electron/services/providers-api.ts` | `9828ca17a4dc59ef3ba45bbc54664cca86499728b8d168f7a0d433c341557f82` | L2 |
| `electron/services/providers/provider-service.ts` | `a561acbc25a73db8936d736d655168bac6580c6cdaf3c81b6b8823140a46f4b0` | L2 |
| `electron/services/files-api.ts` | `02a0d337057b73957897a0ed7ba52233886f7f16fcda6174573a6c91e3e4b836` | L2 |
| `electron/services/workspaces-api.ts` | `0030a36be1611d9e2c92892e820a56be74b7c42167c622f5b1ea5d9e8a3bbbde` | L2 |
| `electron/services/sessions-api.ts` | `1fd9608da12f976af0ad4c39023b6cc010357c158b7f46b2b47c99135d512060` | L2 |
| `electron/services/roles-api.ts` | `0a4e30f6fea7d12563f1cf7ef05889ad5429ffe3f8191fb6e7146c280c7b62b7` | L2 |
| `electron/services/channels-api.ts` | `b1e5307db37b91754d883bd227dc380bf23a79958f5408dd18c28745401ba993` | L2 |
| `electron/services/observability-redaction.ts` | `25f5b7ba3d8922eabdb2b8d8e93ebabfd04c0025f993a5eec697d5e53fc80530` | L2 |
| `electron/services/terminal-api.ts` | `0d1dfaa562f04b6827ba02844252633ff381285faeec983755b121060dc8e340` | L2 |
| `electron/services/permissions-api.ts` | `765c7735cfd0dcb8f6f56b530351aaf71239890b7f4e30a08018e316288a5220` | L2 |
| `electron/services/git-api.ts` | `87aee9d8d932d8631847119d0bc5816a2e377fd924f5eb63767c92391b7b1e8f` | L2 |
| `electron/services/office-tools-api.ts` | `9c09e741bdcba7b64f3922d3ece88274ebb1fb8e742049172857867bbac0a290` | L2 |
| `electron/services/terminal-session-manager.ts` | `166d62d0f4456be9455fa7313afa6aebefa7d87d9ec8418d483565d27c8db170` | L2 |
| `electron/services/agent-browser-service.ts` | `11531e7fa606e0c12e9d847d27c7c6d27033422c7c4cb24a578d0d7d730cf8f0` | L2 |
| `electron/services/updates-api.ts` | `c215f9f377d2fc6b9b6b78de374799f765d237b306b812f6996bd6dadeafc876` | L2 |
| `electron/utils/store.ts` | `31c4060648fc7976642dad13dc2bed3220ffb2a386406c17140153ef2c0d71ec` | L2 |
| `electron/gateway/manager.ts` | `34ee52930bda08e46294295b5c6e5d08b30417de2f972231f3b4f32b086d8d31` | L2 |
| `src/lib/host-api.ts` | `96ac6898986b6f8ee0fb94b36f234ea6965877d102a46613fb4cc0b063efedd5` | L2 |
| `src/App.tsx` | `696a7359c6234bc3d2847c21cb8080c3d7643d094a7da12ed85152c09a35883f` | L2 |
| `src/pages/Chat/index.tsx` | `2c5390d68607a46ae4c159cae033a78f2d719cbfa5bb8a0873c9d52c428594ad` | L2 |
| `src/stores/chat.ts` | `ea8aaa8119ec4663e649fe20630d79754af72a493454b3a91977b00a0d85eca9` | L2 |
| `shared/host-api/contract.ts` | `d804a8e72810cfaeee0195312097b2f687857468a0605e64276e72cb39a2c16d` | L2 |
| `shared/cron-browser-automation.ts` | `e28e7bd62a728799c0e2a1ee6edf81d6a4dd2a9dcddd1789d2ee207ae19d2db8` | L2 |
| `shared/dcs/prod-flags-catalog.ts` | `986098c6583282fad14fa774b0565698b8ba1f614ad8bba3eaab7101064ff77b` | L2 |
| `openclaw_runtime/src/knowledge/sekb/harness-integration.ts` | `c62a4cd146eeb6e9bead85d57d826965ba44d672c4beebb622008268d3c79bee` | L2 |
| `openclaw_runtime/src/knowledge/sekb/knowledge-store.ts` | `e09272aa48f9ca8a527c1abfab5e159cb13db2ff797ca00b6bb22681ae1446b6` | L2 |
| `openclaw_runtime/src/knowledge/sekb/distillation-tool.ts` | `8f922fb32bc727c6faee56124fa71a0c604869c5e07b21d202ec53ec8151fdae` | L2 |
| `openclaw_runtime/src/agents/role-contract.ts` | `15cb4579e78ee70cd6486c355109437ccfcb78032bb400ea6a6b5ad78d484c77` | L2 |
| `openclaw_runtime/src/agents/role-spawn.ts` | `33c3395b10ff4b6e1a107a1dc1f533048dc577a52afebb20051daf436724e3e7` | L2 |
| `openclaw_runtime/src/agents/subagent-registry.ts` | `3e997bf168f0120f2023e4148d5c214d7e844213b9d4ee529448191e5e6ad021` | L2 |
| `openclaw_runtime/src/agents/agent-steering-queue.ts` | `607c6f47c4e3f48154b63cd67accbb3509fc5f2cb448607fb746a9468340c6c2` | L2 |
| `openclaw_runtime/src/agents/transcript-redact.ts` | `a1a61dc8b2de91ada84cfa62626d4da21380df01aafe78c01777366277e27576` | L2 |
| `openclaw_runtime/src/context-engine/assembler.ts` | `701a93631e49326e1071d79c0a52821880ad34a8343a19a6842f07708c2be59d` | L2 |
| `openclaw_runtime/src/memory/gatekeeper.ts` | `9952e900f59033f82c78dbdee0f3dbd2f046748b4c53cb4d2f610884da10ae09` | L2 |
| `openclaw_runtime/src/secrets/audit.ts` | `2dcbc4345b513ef2cacecea89f2aa518b1c50ebf5ee754adb777109936e84de6` | L2 |
| `openclaw_runtime/src/secrets/channel-secret-basic-runtime.ts` | `c017cdb2db98a6c7d6c9e470e192c9b27ba6da8a4cdb6ff40ea853747059db08` | L2 |
| `openclaw_runtime/src/cron/store.ts` | `2eb848011d1e4e53a5103c0eacc49db81ea1c2b9f292091182d286a1494bab3f` | L2 |
| `openclaw_runtime/src/gateway/auth.ts` | `022917179ce1795c161f858de0abac73515ee1c4986d90821180f630d8992ca7` | L2 |
| `openclaw_runtime/src/agents/sandbox/backend.ts` | `fdc20e4d25a33afd83d4fdbb85400e271d7a10729fa3f1b18b273dfad039cc9f` | L2 |
| `openclaw_runtime/src/security/dangerous-tools.ts` | `cd39e41ea2724af00a4f6d5521ecf9c22a209a0b85ec7e0b2eeb6524a2b8126f` | L2 |
| `openclaw_runtime/test/vitest/vitest.scoped-config.ts` | `fd0673ddbdc637bcc00d4eca9cdeed7b341f5d64926ad76989c5affaca63536a` | L2 |
| `openclaw_runtime/src/agents/mcp-http-fetch.ts` | `b842b9d01ba1db52c30c0a81c51746d11b1fc306e4efc84b7a197c856379ff7c` | L2 |
| `electron-builder.yml` | `0e63899a1a8672f60734821e5198dda6d2d076fbffbe79d3983af756eb1b460b` | L2 |
| `package.json` | `8a533daaacc552777a679036d6133f8716b3b49f7dbe2a690a0c61c3cc9293cd` | L2 |
| `artifacts/agent-dev-audit/report.json` | `d5fab27eeea329fe292a489462a449a49697e4cdbe6ff700670bf66e286494bd` | L2 |
| `artifacts/agent-dev-deep-test/report.json` | `5c86b453cea3ec4c7ccfd11f6691633d19d9819f73cb352bf880f1e76ea9a5b7` | L2 |

#### L1 扫描

- `electron/services/*.ts`：77/77 顶层服务文件被安全模式扫描触及；不是通过证明。
- Renderer/Main/OpenClaw runtime 进行了 openExternal、WebView、IPC sender/schema、CSP/sanitize、updater/signing 等模式扫描。

#### 明确未做

- 完整 runtime/gateway/channels/plugins/MCP 方法鉴权矩阵。
- 新鲜 full typecheck、lint、unit、Electron E2E、release build。
- Renderer compromise、Windows path escape、openExternal scheme、更新包篡改等 L4 测试。
- SBOM/CVE、Electron fuses/ASAR integrity、Windows userData ACL、构建 provenance。

### 1.4 审计 Manifest

Manifest 为机器可复核入口：`reports/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.manifest.json`。本轮重新核对结果：74 个 L2/L3 文件哈希全部匹配，dirty patch SHA256 匹配。

---

## 2. 基线事实

| 项目 | 事实 | 裁决 |
|---|---|---|
| Git / dirty | HEAD `60061e33554311ac3c9871195210df59fe1b5bf2`；快照 dirty 169 条 | 无干净发布基线；已用 patch/hash 固定审计输入 |
| 审计环境 | Windows Microsoft Windows NT 10.0.26200.0 / Node v24.15.0 / pnpm 11.2.2 | 环境可记录；未证明其他平台行为 |
| TLS 环境 | `NODE_TLS_REJECT_UNAUTHORIZED=0` | 外部 TLS 验证证据降级；代码库未发现全局硬编码该值 |
| Agent Dev evidence | 2026-07-03 audit=A；deep-test=needs-full-gate、releaseReady=false | 仅控制面证据，且陈旧；不能外推 |
| Windows build/update | builder 无 Win sign/publish；autoUpdater API 存在 | 发布阻断，见 F-SUPPLY-001 |
| 测试默认 | scoped Vitest 默认 passWithNoTests=true | 架构级门禁稀释，见 F-GOV-001 |

---

## 3. 威胁模型与信任边界

### 3.1 资产

- Provider / Channel / Gateway / OAuth secrets。
- 本地文件：workspace、用户目录、SSH、浏览器数据、OpenClaw 配置。
- Agent sessions、trajectory、SEKB、Memory、DCS。
- Browser profiles/cookies/vault 与 Gateway 网络面。
- 更新渠道、安装包、构建产物与签名身份。

### 3.2 信任边界

```text
Untrusted:
  Web content / MCP / tool output / user & channel messages / untrusted workspace

Semi-trusted:
  Renderer UI / local config / workspace files / extensions

Trusted decision boundary (target, not fully achieved):
  Main-process brokers / Reference Monitor / Secret Broker / Sandbox boundary
```

### 3.3 攻击者与前置条件

| ID | 身份 | 例子 | 默认可达 |
|---|---|---|---|
| A1 | 本地恶意进程 | 读取 userData/openclaw 配置 | 取决于 OS ACL；本轮未审 |
| A2 | Renderer compromise | XSS/WebView/恶意扩展 | 未 L4 验证 |
| A3 | 不可信 Workspace | 恶意仓库、配置、脚本 | 常见 |
| A4 | Prompt Injection | 网页、MCP、工具、channel 内容 | 常见 |
| A5 | 供应链攻击者 | 依赖、构建、更新 feed/包 | 发布相关 |
| A6 | 多窗口/多 profile 竞态 | Browser first-response | 条件可达 |

### 3.4 本轮不在范围

物理攻击、完整社会工程、所有 channel/plugin 的逐一对抗、第三方云提供商内部控制与法律合规认证。

---

## 4. Finding 目录

### 4.1 总表

| ID | 标题 | 严重度 | 决策 | 可达性 | 证据 | 状态 |
|---|---|---|---|---|---|---|
| F-SEC-001 | Provider / Channel / Gateway secrets 明文与 Provider 双写 | Critical | Act-now | 是 | L3 | Open |
| F-SEC-002 | Renderer host API 可返回 Provider 明文 API key | Critical | Act-now | 条件可达 | L3 | Open |
| F-SEC-003 | openExternal 多入口且 IPC/Host 路径无协议白名单 | High | Act-now | 条件可达 | L3 | Open |
| F-SEC-004 | Files Host API 读模式允许任意本地路径 | High | Act-now | 是 | L3 | Open |
| F-SEC-005 | Host IPC 仅校验请求外壳，缺每动作 payload schema 与 sender/session 绑定 | High | Act-now | 条件可达 | L3 | Open |
| F-SUPPLY-002 | Build-time executables and CI installer are not integrity-pinned | High | Publish-blocker | 发布时可达 | L3 | Open |
| F-REL-005 | Electron logs have no rotation/retention limit and swallow write failures | Medium | Act-now | 是 | L3 | Open |
| F-DATA-005 | Session hard delete does not cascade to SEKB/Memory/DCS derivatives | High | Act-now | 是 | L3 | Open |
| F-AUTH-009 | MCP permission/sandbox/network policy fields are not proven runtime-enforced | High | Act-now | 条件可达 | L3 | Open |
| F-AUTH-008 | Feishu/WeCom channel configuration broadens inbound access to open/* | High | Act-now | 是 | L3 | Open |
| F-AUTH-006 | Approval consumption is not atomic and can be replayed concurrently | High | Act-now | 是 | L4 | Open |
| F-SEC-007 | Agent Browser multi-tab URL policy accepts javascript/data schemes | High | Act-now | 是 | L4 | Open |
| F-SEC-006 | Workspace junction/reparse canonicalization permits external writes | High | Act-now | 是 | L4 | Open |
| F-SEC-010 | Renderer XSS / Markdown / HTML 实际可达性未完成动态证明 | High | Attend | 未验证 | L1-L2 | Unverified |
| F-ISO-001 | Strong sandbox 不可用时降级到 policy-light，强制可见性与高危阻断未验证 | Medium | Track | 条件可达 | L3 | Partial |
| F-ISO-002 | WebView 启用但缺少专用 attach/permission/navigation 管控证据 | High | Attend | 条件可达 | L1-L2 | Unverified |
| F-AUTH-001 | Workspace 默认 permission mode 为 acceptEdits | High | Act-now | 是 | L3 | Open |
| F-AUTH-002 | Role path 权限未硬执行且 Electron/Runtime built-in role 名漂移 | High | Act-now | 是 | L3 | Open |
| F-AUTH-003 | CVK 只有 report_only 类型，无 enforce 模式 | High | Track | 是 | L3 | Open |
| F-AUTH-004 | Runtime Spine diagnostic_only 下失败仍 approved | High | Track | 是 | L3 | Open |
| F-AUTH-005 | Verifier 依赖 fail/refuted 等文本启发式 | Medium | Track | 是 | L2 | Open |
| F-DATA-001 | SEKB 启用后 raw steps/details 可落库且未复用 redaction | High | Act-now | 条件可达 | L3 | Open |
| F-DATA-002 | sekbConfirmPrinciple 未向 DCS experience sink 传递上下文 | Medium | Track | 是 | L3 | Open |
| F-DATA-003 | Memory/COMPASS 高级路径默认全关，写入与使用 gate 边界未闭环验证 | Medium | Attend | 否 | L3 | Partial |
| F-DATA-004 | 敏感内容边界矩阵承认 raw/no-redaction 与 modelEcho 不保证 | High | Track | 条件可达 | L3 | Open |
| F-REL-001 | Cron 存在 SQLite 与 cron.json fallback 双真相，list 可触发 repair 写 | High | Act-now | 条件可达 | L2-L3 | Open |
| F-REL-002 | openclaw.json 等配置采用直接 writeFile，缺原子提交 | Medium | Act-now | 是 | L3 | Open |
| F-REL-003 | Agent Browser Gateway bridge 使用 broadcast first-response | Medium | Attend | 条件可达 | L3 | Unverified |
| F-REL-004 | 同一安全能力存在多套实现与不同强度 | High | Act-now | 是 | L2-L3 | Open |
| F-SUPPLY-001 | Windows 无代码签名配置，autoUpdater 有调用链但无 publish/feed 证据 | High | Publish-blocker | 条件可达 | L2 | Open |
| F-GOV-001 | passWithNoTests 是 Vitest scoped 配置的系统性默认 | High | Act-now | 是 | L3 | Open |
| F-GOV-002 | Agent Dev A 级与 releaseReady=false/证据陈旧不能外推全系统 | Medium | Track | 是 | L2 | Open |
| F-GOV-003 | Dirty tree 无干净、可复现的发布基线 | High | Publish-blocker | 是 | L1-L3 | Open |
| F-UX-001 | 前端巨型模块与伪虚拟化增加维护和 OOM 风险 | Medium | Track | 是 | L2 | Open |
| F-UX-002 | ErrorBoundary 向 UI 渲染 stack | Low | Track | 是 | L2 | Open |

### 4.2 Finding 卡片

### F-SEC-001 Provider / Channel / Gateway secrets 明文与 Provider 双写

| 字段 | 值 |
|---|---|
| ID | F-SEC-001 |
| 类别 | SEC |
| 严重度 | Critical |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A1, A2 |
| 前置条件 | 攻击者可读 userData/openclaw 配置，或先取得 Renderer 能力 |
| 爆炸半径 | Provider keys、channel tokens、gateway token；可扩展到账户接管 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/services/secrets/secret-store.ts:32-52
- electron/utils/secure-storage.ts:35-52
- electron/utils/channel-config.ts:493
- electron/utils/store.ts:51,102

**攻击链**：AC-01, AC-02

**影响**：同一 Provider key 写入 providerSecrets 与 legacy apiKeys；Channel/Gateway 仍有明文路径。

**修复验收**

- [ ] T-SEC-001：canary secret 磁盘扫描无命中
- [ ] 删除 legacy apiKeys 回写与读取
- [ ] Channel/Gateway secret 使用 OS 保护或 SecretRef

**相关**：F-SEC-002

---

### F-SEC-002 Renderer host API 可返回 Provider 明文 API key

| 字段 | 值 |
|---|---|
| ID | F-SEC-002 |
| 类别 | SEC |
| 严重度 | Critical |
| 当前决策 | Act-now |
| 默认可达 | 条件可达 |
| 攻击者 | A2, A4 |
| 前置条件 | Renderer compromise、恶意扩展贡献或可调用 host API 的注入路径 |
| 爆炸半径 | 全部 Provider keys |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- src/lib/host-api.ts:1180-1181
- shared/host-api/contract.ts（providers.getApiKey 返回 string|null）
- electron/services/providers-api.ts / provider-service.ts

**攻击链**：AC-01

**影响**：Renderer 与 Main 的密钥边界失效；XSS 前提尚未 L4 证实。

**修复验收**

- [ ] T-SEC-002：host API 不再存在 getApiKey
- [ ] Renderer 仅能得到 hasKey/credential handle
- [ ] 回归覆盖 Provider 编辑、验证与 OAuth

**相关**：F-SEC-001, F-SEC-005, F-SEC-010

---

### F-SEC-003 openExternal 多入口且 IPC/Host 路径无协议白名单

| 字段 | 值 |
|---|---|
| ID | F-SEC-003 |
| 类别 | SEC |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 条件可达 |
| 攻击者 | A2, A3, A4 |
| 前置条件 | 攻击者控制 URL 参数；Windows 存在可利用协议或本地处理器 |
| 爆炸半径 | 当前用户上下文中的外部协议处理器 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/main/ipc-handlers.ts:1107-1108
- electron/services/shell-api.ts:21-31
- electron/main/index.ts:862-872（窗口路径有 http/https 白名单，对照证据）
- src/electron openExternal 调用点静态枚举：22 处

**攻击链**：AC-03

**影响**：同一能力存在不同强度实现；窗口路径安全策略未覆盖 IPC/Host/服务旁路。

**修复验收**

- [ ] T-SEC-003：scheme 矩阵仅 http/https 允许
- [ ] 所有 Renderer 调用收口到单一 broker
- [ ] 拒绝必须记录来源与协议

**相关**：F-REL-004

---

### F-SEC-004 Files Host API 读模式允许任意本地路径

| 字段 | 值 |
|---|---|
| ID | F-SEC-004 |
| 类别 | SEC |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A2, A3, A4 |
| 前置条件 | 能够调用 files.read/list/stat；写权限不影响读路径 |
| 爆炸半径 | 用户可读文件、SSH/config/browser data、工作区外 secrets |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/services/files-api.ts:168-191
- electron/services/files-api.ts:307,332,441,461,491

**攻击链**：AC-02

**影响**：写入有 roots/审批，但读取不是 workspace 沙箱。Windows reparse/UNC/ADS 尚未 L4 验证。

**修复验收**

- [ ] T-SEC-004：Windows path escape 矩阵
- [ ] 读取限制到 workspace + 显式 allowlist roots
- [ ] 大文件、设备文件、UNC/reparse 拒绝或限流

**相关**：F-AUTH-002

---

### F-SEC-005 Host IPC 仅校验请求外壳，缺每动作 payload schema 与 sender/session 绑定

| 字段 | 值 |
|---|---|
| ID | F-SEC-005 |
| 类别 | SEC |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 条件可达 |
| 攻击者 | A2, A6 |
| 前置条件 | 攻击者控制已加载 Renderer/WebContents 或多窗口消息源 |
| 爆炸半径 | 全部 HostServiceRegistry 动作，取决于具体 action |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/main/ipc/host-invoke.ts:78-139
- electron/main/ipc/host-contract.ts（isHostRequest 仅验证请求形状）
- electron/main/ipc/host-invoke.ts:133（_event 未使用）

**攻击链**：AC-01, AC-02

**影响**：存在基础 request shape 校验，但 payload 直接交给 action，且未绑定 senderFrame/webContents/session。

**修复验收**

- [ ] T-SEC-005：每 action schema 正反例
- [ ] 拒绝非主窗口/非授权 session sender
- [ ] payload size、prototype、path fuzz

**相关**：F-SEC-002, F-ISO-002

---

### F-SEC-010 Renderer XSS / Markdown / HTML 实际可达性未完成动态证明

| 字段 | 值 |
|---|---|
| ID | F-SEC-010 |
| 类别 | SEC |
| 严重度 | High |
| 当前决策 | Attend |
| 默认可达 | 未验证 |
| 攻击者 | A2, A4 |
| 前置条件 | 需要找到脚本注入或危险 HTML 渲染原语 |
| 爆炸半径 | 若成立，可联动 F-SEC-002/003/004/005 |
| 证据等级 | L1-L2 |
| 状态 | Unverified |

**证据**

- src/pages/Chat/ChatMessage.tsx（MarkdownTextPrimitive）
- src/components/file-preview/MarkdownPreview.tsx（ReactMarkdown，无 rehypeRaw）
- electron/main/index.ts:839-840（sandbox:false + webviewTag:true）

**攻击链**：AC-01, AC-02, AC-03

**影响**：静态证据显示 Markdown 路径未显式启用 raw HTML；这不是 XSS 通过证明，也不是漏洞证明。

**修复验收**

- [ ] T-SEC-010：恶意 Markdown/Tool UI/HTML corpus
- [ ] 模拟 Renderer compromise 后验证 broker 边界
- [ ] CSP 与 Trusted Types/等价控制审计

**相关**：F-ISO-002

---

### F-ISO-001 Strong sandbox 不可用时降级到 policy-light，强制可见性与高危阻断未验证

| 字段 | 值 |
|---|---|
| ID | F-ISO-001 |
| 类别 | ISO |
| 严重度 | Medium |
| 当前决策 | Track |
| 默认可达 | 条件可达 |
| 攻击者 | A3, A4 |
| 前置条件 | Docker/SSH strong backend 不可用或未选择 |
| 爆炸半径 | workspace、terminal、browser、cron 的本地用户权限面 |
| 证据等级 | L3 |
| 状态 | Partial |

**证据**

- electron/utils/sandbox-policy-resolver.ts:64-68,107-120
- electron/utils/workspace-runtime-permissions.ts
- openclaw_runtime/src/agents/sandbox/backend.ts

**攻击链**：AC-09

**影响**：降级信号、reason、warnings 存在；UI 是否强制展示以及是否阻断高危动作尚未验证。

**修复验收**

- [ ] T-ISO-001：backend 不可用故障注入
- [ ] degraded 状态在执行前强制可见
- [ ] 高危动作 fail-closed 或逐次审批

**相关**：无

---

### F-ISO-002 WebView 启用但缺少专用 attach/permission/navigation 管控证据

| 字段 | 值 |
|---|---|
| ID | F-ISO-002 |
| 类别 | ISO |
| 严重度 | High |
| 当前决策 | Attend |
| 默认可达 | 条件可达 |
| 攻击者 | A2, A6 |
| 前置条件 | OpenClaw Control UI 或嵌入内容可被控制/替换 |
| 爆炸半径 | WebView partition、权限、导航、preload 边界 |
| 证据等级 | L1-L2 |
| 状态 | Unverified |

**证据**

- electron/main/index.ts:839-840
- 全仓未命中 will-attach-webview / setPermissionRequestHandler / setPermissionCheckHandler
- electron/main/index.ts:1013-1029（Gateway Control UI frame 限制被放宽）

**攻击链**：AC-01, AC-07

**影响**：不能据此断言 WebView 可利用；但缺少专用控制钩子是必须补审的边界。

**修复验收**

- [ ] T-ISO-002：WebView preload/partition/permission/navigation 矩阵
- [ ] 禁止非预期 src 与新窗口
- [ ] 权限默认拒绝并记录

**相关**：F-SEC-010, F-SEC-005

---

### F-AUTH-001 Workspace 默认 permission mode 为 acceptEdits

| 字段 | 值 |
|---|---|
| ID | F-AUTH-001 |
| 类别 | AUTH |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A3, A4 |
| 前置条件 | 打开不可信 workspace 或接受模型驱动修改 |
| 爆炸半径 | 当前 workspace 内文件与相关命令链 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/services/workspaces-api.ts:77
- electron/services/workspace-permissions.ts

**攻击链**：AC-09

**影响**：规则/审批存在，但默认不是只读或受限模式。

**修复验收**

- [ ] T-AUTH-001：新 workspace 默认 restricted/ask
- [ ] 高风险编辑与命令必须显式批准
- [ ] 迁移现有配置不静默放宽

**相关**：无

---

### F-AUTH-002 Role path 权限未硬执行且 Electron/Runtime built-in role 名漂移

| 字段 | 值 |
|---|---|
| ID | F-AUTH-002 |
| 类别 | AUTH |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A3, A4 |
| 前置条件 | 选择角色或派生子 Agent |
| 爆炸半径 | 角色声明之外的文件路径；角色语义不一致 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- openclaw_runtime/src/agents/role-permissions-policy.ts
- openclaw_runtime/src/agents/role-contract.ts
- openclaw_runtime/src/agents/role-spawn.ts
- electron/services/roles-api.ts:59-68

**攻击链**：AC-02, AC-09

**影响**：Tool allow/deny 有硬执行；readPaths/writePaths 未进入同等硬约束，角色名双向各漂移 3 个。

**修复验收**

- [ ] T-AUTH-002：role × path × tool conformance
- [ ] built-in role 单一注册表
- [ ] 子 Agent 权限不得超过父 Agent

**相关**：F-REL-004

---

### F-AUTH-003 CVK 只有 report_only 类型，无 enforce 模式

| 字段 | 值 |
|---|---|
| ID | F-AUTH-003 |
| 类别 | AUTH |
| 严重度 | High |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A4 |
| 前置条件 | 危险 tool call 到达 CVK |
| 爆炸半径 | 所有依赖 CVK 阻断的操作 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts:17

**攻击链**：AC-04

**影响**：不是默认配置问题，而是类型/实现层尚无 enforce 分支。

**修复验收**

- [ ] T-AUTH-003：deny/ask/allow 行为测试
- [ ] 引入 enforce 模式与回滚开关
- [ ] 报告与阻断结果可审计

**相关**：F-AUTH-004, F-AUTH-005

---

### F-AUTH-004 Runtime Spine diagnostic_only 下失败仍 approved

| 字段 | 值 |
|---|---|
| ID | F-AUTH-004 |
| 类别 | AUTH |
| 严重度 | High |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A4 |
| 前置条件 | 危险动作依赖 Spine gate |
| 爆炸半径 | 运行时动作授权链 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- openclaw_runtime/src/runtime-spine/gate-engine.ts:27,125

**攻击链**：AC-04

**影响**：诊断结果不会形成硬阻断。

**修复验收**

- [ ] T-AUTH-004：blocking 模式失败即拒绝
- [ ] 诊断/阻断模式清晰可见
- [ ] 关键动作先试点再扩大

**相关**：F-AUTH-003

---

### F-AUTH-005 Verifier 依赖 fail/refuted 等文本启发式

| 字段 | 值 |
|---|---|
| ID | F-AUTH-005 |
| 类别 | AUTH |
| 严重度 | Medium |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A4 |
| 前置条件 | 模型或工具输出可影响 verifier 文本 |
| 爆炸半径 | 编排正确性与错误放行 |
| 证据等级 | L2 |
| 状态 | Open |

**证据**

- openclaw_runtime/src/agents/subagent-registry.ts
- openclaw_runtime/src/agents/agent-steering-queue.ts

**攻击链**：AC-04

**影响**：存在 deferred verifier 是正面事实，但裁决不是结构化证明。

**修复验收**

- [ ] T-AUTH-005：结构化 verdict schema
- [ ] 文本不直接决定授权
- [ ] 对抗性措辞 corpus

**相关**：F-AUTH-003, F-AUTH-004

---

### F-DATA-001 SEKB 启用后 raw steps/details 可落库且未复用 redaction

| 字段 | 值 |
|---|---|
| ID | F-DATA-001 |
| 类别 | DATA |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 条件可达 |
| 攻击者 | A3, A4 |
| 前置条件 | 开启 SEKB 并处理含 secret/path/env/tool args 的 trajectory |
| 爆炸半径 | SEKB 数据库、检索上下文、后续模型回显 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- openclaw_runtime/src/knowledge/sekb/trajectory-capture.ts
- openclaw_runtime/src/knowledge/sekb/harness-integration.ts
- openclaw_runtime/src/knowledge/sekb/knowledge-store.ts
- electron/services/observability-redaction.ts（未接入对照）

**攻击链**：AC-05

**影响**：功能默认关闭降低默认可达性；一旦开启，raw 数据边界仍高风险。

**修复验收**

- [ ] T-DATA-001：canary secret 不落库/不可检索
- [ ] 写入前统一 redaction + provenance
- [ ] 存量数据迁移或清理

**相关**：F-DATA-004

---

### F-DATA-002 sekbConfirmPrinciple 未向 DCS experience sink 传递上下文

| 字段 | 值 |
|---|---|
| ID | F-DATA-002 |
| 类别 | DATA |
| 严重度 | Medium |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A3 |
| 前置条件 | 用户在 UI 确认原则 |
| 爆炸半径 | 用户期望的学习/经验闭环 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/services/knowledge-api.ts:3935
- openclaw_runtime/src/knowledge/sekb/distillation-tool.ts

**攻击链**：未单列

**影响**：UI 文案与真实持久化路径可能不一致。

**修复验收**

- [ ] T-DATA-002：确认后 DCS 可观测记录
- [ ] 若不写 DCS，UI 明确仅保存原则
- [ ] 失败不得显示已学习

**相关**：F-GOV-002

---

### F-DATA-003 Memory/COMPASS 高级路径默认全关，写入与使用 gate 边界未闭环验证

| 字段 | 值 |
|---|---|
| ID | F-DATA-003 |
| 类别 | DATA |
| 严重度 | Medium |
| 当前决策 | Attend |
| 默认可达 | 否 |
| 攻击者 | A4 |
| 前置条件 | 显式开启相关 flags |
| 爆炸半径 | Memory 注入、污染传播与撤销 |
| 证据等级 | L3 |
| 状态 | Partial |

**证据**

- openclaw_runtime/src/runtime-core/memory-runtime-config.ts
- openclaw_runtime/src/memory/gatekeeper.ts

**攻击链**：未单列

**影响**：默认关闭不是漏洞，也不能宣传为已生产生效；gatekeeper 对 secret-like 有正面拒绝。

**修复验收**

- [ ] T-DATA-003：write/use 双 gate
- [ ] 污染撤销与 TTL
- [ ] UI/文档与 flag 状态一致

**相关**：F-DATA-004

---

### F-DATA-004 敏感内容边界矩阵承认 raw/no-redaction 与 modelEcho 不保证

| 字段 | 值 |
|---|---|
| ID | F-DATA-004 |
| 类别 | DATA |
| 严重度 | High |
| 当前决策 | Track |
| 默认可达 | 条件可达 |
| 攻击者 | A3, A4 |
| 前置条件 | 敏感内容进入 files/trajectory/SEKB/memory/model context |
| 爆炸半径 | 跨存储与跨模型传播 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- shared/sensitive-content-boundary.ts

**攻击链**：AC-02, AC-05

**影响**：项目已有边界自知，但缺统一 provenance/IFC enforcement。

**修复验收**

- [ ] T-DATA-004：source→sink policy matrix
- [ ] 每个 sink 有 redaction/provenance/TTL
- [ ] 删除操作覆盖衍生数据

**相关**：F-DATA-001, F-DATA-003

---

### F-REL-001 Cron 存在 SQLite 与 cron.json fallback 双真相，list 可触发 repair 写

| 字段 | 值 |
|---|---|
| ID | F-REL-001 |
| 类别 | REL |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 条件可达 |
| 攻击者 | A3, A4 |
| 前置条件 | Runtime list 失败或状态不一致 |
| 爆炸半径 | 计划任务定义与执行 |
| 证据等级 | L2-L3 |
| 状态 | Open |

**证据**

- electron/services/cron-api.ts
- openclaw_runtime/src/cron/store.ts

**攻击链**：AC-06

**影响**：读失败路径带写副作用，可能把 fallback 状态回写成权威。

**修复验收**

- [ ] T-REL-001：失败注入下 list 只读
- [ ] SQLite 单一权威或显式迁移事务
- [ ] 并发/lease/磁盘满测试

**相关**：F-GOV-001

---

### F-REL-002 openclaw.json 等配置采用直接 writeFile，缺原子提交

| 字段 | 值 |
|---|---|
| ID | F-REL-002 |
| 类别 | REL |
| 严重度 | Medium |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A1, A3 |
| 前置条件 | 并发写、进程崩溃、磁盘满 |
| 爆炸半径 | Channel 与 OpenClaw 配置完整性 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- electron/utils/channel-config.ts:234,493

**攻击链**：AC-06

**影响**：部分写入或竞态可能破坏配置。

**修复验收**

- [ ] T-REL-002：tmp+fsync+rename
- [ ] 并发写串行化/版本检查
- [ ] 故障注入后旧配置可恢复

**相关**：无

---

### F-REL-003 Agent Browser Gateway bridge 使用 broadcast first-response

| 字段 | 值 |
|---|---|
| ID | F-REL-003 |
| 类别 | REL |
| 严重度 | Medium |
| 当前决策 | Attend |
| 默认可达 | 条件可达 |
| 攻击者 | A6 |
| 前置条件 | 多窗口/多 profile 同时响应同一请求 |
| 爆炸半径 | 浏览器动作路由、session 绑定 |
| 证据等级 | L3 |
| 状态 | Unverified |

**证据**

- openclaw_runtime/src/gateway/server-methods/agent-browser.ts

**攻击链**：AC-07

**影响**：静态存在 first-response 设计；实际抢答/串 session 尚未 L4 证明。

**修复验收**

- [ ] T-REL-003：多窗口并发 race
- [ ] requestId+session+webContents 绑定
- [ ] 重复/迟到响应拒绝

**相关**：F-ISO-002

---

### F-REL-004 同一安全能力存在多套实现与不同强度

| 字段 | 值 |
|---|---|
| ID | F-REL-004 |
| 类别 | REL |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A2, A3 |
| 前置条件 | 调用方选择或遗留路径绕过更强实现 |
| 爆炸半径 | openExternal、Role、Secrets、Cron、Provider metadata |
| 证据等级 | L2-L3 |
| 状态 | Open |

**证据**

- electron/main/index.ts vs ipc-handlers.ts/shell-api.ts
- electron/services/roles-api.ts vs role-contract.ts
- secret-store.ts legacy 双写

**攻击链**：AC-03, AC-06

**影响**：迁移中间态缺 exit criteria，旧路径会永久保留。

**修复验收**

- [ ] T-REL-004：能力单源 conformance
- [ ] 每次迁移定义旧路径删除条件
- [ ] 禁止新增旁路调用

**相关**：F-SEC-003, F-AUTH-002

---

### F-SUPPLY-001 Windows 无代码签名配置，autoUpdater 有调用链但无 publish/feed 证据

| 字段 | 值 |
|---|---|
| ID | F-SUPPLY-001 |
| 类别 | SUPPLY |
| 严重度 | High |
| 当前决策 | Publish-blocker |
| 默认可达 | 条件可达 |
| 攻击者 | A5 |
| 前置条件 | 发布 Windows 安装包或启用更新 |
| 爆炸半径 | 安装包、更新包、最终用户主机 |
| 证据等级 | L2 |
| 状态 | Open |

**证据**

- electron-builder.yml
- electron/services/updates-api.ts:12,30,41

**攻击链**：AC-08

**影响**：可能表现为 Win 更新不可用，或更新来源/签名验证未被本审计证明。

**修复验收**

- [ ] T-SUPPLY-001：签名构建验证
- [ ] update feed dry-run + 篡改包拒绝
- [ ] SBOM/provenance/clean tag

**相关**：无

---

### F-GOV-001 passWithNoTests 是 Vitest scoped 配置的系统性默认

| 字段 | 值 |
|---|---|
| ID | F-GOV-001 |
| 类别 | GOV |
| 严重度 | High |
| 当前决策 | Act-now |
| 默认可达 | 是 |
| 攻击者 | A3, A5 |
| 前置条件 | 测试 glob 错误、测试移动或误删 |
| 爆炸半径 | 所有依赖相关 shard 的回归门禁 |
| 证据等级 | L3 |
| 状态 | Open |

**证据**

- openclaw_runtime/test/vitest/vitest.scoped-config.ts:269-272
- openclaw_runtime/test/vitest 下约 70 个显式 true 配置

**攻击链**：AC-06

**影响**：门禁可在零测试时静默变绿，是其他修复的元风险。

**修复验收**

- [ ] T-GOV-001：默认 false
- [ ] 仅白名单 shard 可空跑并记录原因
- [ ] CI 对 executedTests=0 fail

**相关**：F-REL-001

---

### F-GOV-002 Agent Dev A 级与 releaseReady=false/证据陈旧不能外推全系统

| 字段 | 值 |
|---|---|
| ID | F-GOV-002 |
| 类别 | GOV |
| 严重度 | Medium |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A5 |
| 前置条件 | 使用旧 evidence 作为发布或安全证明 |
| 爆炸半径 | 发布决策与对外声明 |
| 证据等级 | L2 |
| 状态 | Open |

**证据**

- artifacts/agent-dev-audit/report.json
- artifacts/agent-dev-deep-test/report.json

**攻击链**：未单列

**影响**：A 级只覆盖控制面；deep-test 为 2026-07-03 且 needs-full-gate。

**修复验收**

- [ ] T-GOV-002：stale evidence 阻断外推
- [ ] 报告显示 requiredFullGates
- [ ] 对外文案绑定覆盖范围

**相关**：无

---

### F-GOV-003 Dirty tree 无干净、可复现的发布基线

| 字段 | 值 |
|---|---|
| ID | F-GOV-003 |
| 类别 | GOV |
| 严重度 | High |
| 当前决策 | Publish-blocker |
| 默认可达 | 是 |
| 攻击者 | A5 |
| 前置条件 | 从当前工作树打包或依据行号复核 |
| 爆炸半径 | 可复现性、审计证据、供应链 |
| 证据等级 | L1-L3 |
| 状态 | Open |

**证据**

- HEAD 60061e33554311ac3c9871195210df59fe1b5bf2
- snapshot dirty entries 169
- dirty patch sha256:bf430bf565518462e04a84392e547ffe02656569a1a3be1c227073cc13d68e42

**攻击链**：AC-08

**影响**：报告已用 patch/hash 绑定证据，但当前树不应直接声明 release-ready。

**修复验收**

- [ ] T-GOV-003：clean tag 构建
- [ ] 构建 provenance 绑定 commit
- [ ] 审计输出不混入产品 patch

**相关**：F-SUPPLY-001

---

### F-UX-001 前端巨型模块与伪虚拟化增加维护和 OOM 风险

| 字段 | 值 |
|---|---|
| ID | F-UX-001 |
| 类别 | UX |
| 严重度 | Medium |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A3 |
| 前置条件 | 长会话、大消息量、频繁渲染 |
| 爆炸半径 | Chat/Knowledge/Store 可维护性与内存 |
| 证据等级 | L2 |
| 状态 | Open |

**证据**

- src/stores/chat.ts
- src/pages/Chat/index.tsx
- ChatInput/Knowledge 大文件扫描

**攻击链**：未单列

**影响**：属于工程债，不应污染安全 P0；但会放大 DoS 与回归成本。

**修复验收**

- [ ] T-UX-001：长会话性能预算
- [ ] 真实虚拟化
- [ ] 拆分高耦合模块

**相关**：无

---

### F-UX-002 ErrorBoundary 向 UI 渲染 stack

| 字段 | 值 |
|---|---|
| ID | F-UX-002 |
| 类别 | UX |
| 严重度 | Low |
| 当前决策 | Track |
| 默认可达 | 是 |
| 攻击者 | A3 |
| 前置条件 | 触发 Renderer 异常 |
| 爆炸半径 | 本地路径、实现细节、诊断信息 |
| 证据等级 | L2 |
| 状态 | Open |

**证据**

- src/App.tsx

**攻击链**：未单列

**影响**：主要是信息泄露与用户体验问题。

**修复验收**

- [ ] T-UX-002：生产模式错误页脱敏
- [ ] 详细 stack 仅写受控日志
- [ ] E2E 覆盖异常页

**相关**：无


---

## 5. 分系统健康画像

| 子系统 | 架构事实 | 正面控制 | 缺口/Finding | 默认行为 | 可达性 | 健康区间 |
|---|---|---|---|---|---|---|
| Electron 进程边界 / IPC | Main + preload + host:invoke；contextIsolation=true | nodeIntegration=false；窗口 open handler 有 http(s) 白名单 | F-SEC-003/005/010、F-ISO-002 | sandbox=false；webviewTag=true | 条件可达 | 3.0–4.0 |
| Secrets / Config | Provider/Channel/Gateway/Browser vault 多路径 | Browser vault 使用 safeStorage | F-SEC-001/002、F-REL-002/004 | Provider/Channel/Gateway 明文；Provider 双写 | 是 | 2.0–3.0 |
| Files / Workspace / Terminal | Host files + workspace policy + terminal decision | 写入有 roots/审批；terminal 接决策层 | F-SEC-004、F-AUTH-001/002 | 读几乎全盘；acceptEdits | 是 | 3.5–4.5 |
| Sandbox / Isolation | policy resolver + docker/ssh backends | 降级 reason/warnings 存在 | F-ISO-001/002 | strong 不保证；Renderer sandbox=false | 条件可达 | 3.5–5.0 |
| Permissions / Roles / Approvals | tool allow/deny + approval queue | Tool deny 有硬代码 | F-AUTH-001/002 | path 权限与角色单源未闭环 | 是 | 4.0–5.0 |
| Runtime Spine / CVK / Verifier | 三层控制脚手架存在 | 可观测诊断与 deferred verifier | F-AUTH-003/004/005 | report_only / diagnostic_only / 文本启发式 | 是 | 3.5–4.5 |
| SEKB / DCS / Knowledge | trajectory capture、store、distill、UI confirm | 默认关闭限制默认暴露 | F-DATA-001/002/004 | raw 落库；confirm 不接 DCS | 条件可达 | 3.0–4.5 |
| Memory / COMPASS | runtime config + gatekeeper | secret-like reject | F-DATA-003/004 | 高级 flags 默认全关 | 否（默认） | 3.5–5.0 |
| Cron | UI API + fallback + Runtime SQLite | Runtime 有 SQLite store | F-REL-001/002、F-GOV-001 | 双真相；repair 写；空测试默认 | 条件可达 | 3.0–4.0 |
| Agent Browser / Gateway | mode/grant/vault + Gateway bridge | Gateway auth fail-closed 基线；vault 安全 | F-REL-003、F-ISO-002 | broadcast first-response 未验 | 条件可达 | 5.0–6.5 |
| Channels / MCP | 多 channel 服务 + MCP HTTP fetch | Runtime 支持 SecretRef；TLS 关闭是显式 opt-in | F-SEC-001、F-DATA-004 | 全 channel/webhook/tool schema 未审 | 未验证 | 3.5–5.5 |
| Frontend | React/Vite/host-api 分层 | Markdown 默认未启 raw HTML 的静态证据 | F-SEC-010、F-UX-001/002 | 巨型模块；stack；外链入口多 | 是/未验证混合 | 4.0–5.5 |
| Agent Dev 控制面 | Workbench/evidence/deep-test/audit | 控制面成熟、证据结构化 | F-GOV-002 | 证据陈旧；不能外推 | 是 | 7.0–8.0 |
| Build / Update / Supply chain | electron-builder + autoUpdater | mac hardenedRuntime/notarize；postinstall 干净 | F-SUPPLY-001、F-GOV-003 | Win 签名/feed/provenance 未闭环 | 发布时可达 | 2.0–3.0 |
| Test / Gate governance | Vitest shards + Agent Dev gates | 有 focused/full gate 分层 | F-GOV-001/002/003 | passWithNoTests；dirty；cached/smoke 边界 | 是 | 3.0–4.5 |

### 5.1 保留的正面或中性证据（不升级为 Finding）

- Sessions hard delete 会清理 transcript 与 trajectory，并拒绝越界删除；SEKB/Memory/DCS 衍生残留仍在待补审计清单。
- Gateway token/device auth 有缺配置 fail-closed 与常量时间比较；Runtime HTTP 工具面有默认高危 deny。
- Runtime Channel secret 路径支持 SecretRef 演进，但 Electron channel-config 仍存在明文配置路径。
- Transcript redaction 实现真实存在，但可关闭；因此只记为局部控制，不声称全局 plaintext-free。
- Coding flags 中 factViews/parseOnTouch/writeJournal 默认开启，其余多项保守关闭；这是能力状态，不是安全 Finding。
- macOS 构建配置含 hardenedRuntime/notarize；postinstall 静态链未发现可疑网络拉取。

---

## 6. 攻击链目录

| 链 ID | 名称 | 状态 | 关联 Finding |
|---|---|---|---|
| AC-01 | Renderer compromise → getApiKey → Provider key 外传 | 部分证实 | F-SEC-002, F-SEC-005, F-SEC-010 |
| AC-02 | 不可信内容 → Files 全盘读 → 本地 token/文件外传 | 部分证实 | F-SEC-004, F-SEC-005, F-DATA-004 |
| AC-03 | 攻击者控制 URL → openExternal 非 http(s) 协议处理 | 旁路已证，利用未验 | F-SEC-003, F-REL-004 |
| AC-04 | Prompt Injection → 启发式 verifier/CVK/Spine 不阻断 → 危险动作放行 | 静态控制缺口已证 | F-AUTH-003, F-AUTH-004, F-AUTH-005 |
| AC-05 | SEKB 开启 → raw 敏感步骤落库 → 检索/模型回显 | 条件可达 | F-DATA-001, F-DATA-004 |
| AC-06 | Cron list 失败 → fallback/repair 写 → 错误任务成为权威 | 逻辑已证，破坏未验 | F-REL-001, F-REL-002, F-GOV-001 |
| AC-07 | 多窗口 Browser 请求 → broadcast first-response 抢答/串 session | 未验证 | F-REL-003, F-ISO-002 |
| AC-08 | 未签名 Windows 更新链 → 篡改包/不可验证安装 | 发布场景未验证 | F-SUPPLY-001, F-GOV-003 |
| AC-09 | 不可信 Workspace → 默认 acceptEdits/policy-light → 静默修改 | 默认策略已证 | F-AUTH-001, F-ISO-001, F-AUTH-002 |
| AC-10 | MCP sslVerify=false → 中间人/恶意端点 → Prompt Injection | opt-in 静态证实 | F-DATA-004, F-AUTH-005 |

完整步骤与前提见 [攻击链附件](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.attack-chains.md)。所有未完成 L4 的链都不得被表述为“已成功利用”。

---

## 7. 综合评分与可声称边界

### 7.1 评分

| 维度 | 区间 | 评分口径 |
|---|---|---|
| 产品壳可运行性 | 6.0–7.0 | 分层和入口真实，但本轮未 fresh-run |
| 安全 / 密钥 / IPC | 2.5–4.0 | 按当前静态可达面；无 L4 不上调 |
| 权限 / Workspace | 4.0–5.5 | 规则层存在，默认 acceptEdits 与硬隔离偏弱 |
| 运行时权威 | 4.0–5.5 | report/diagnostic/heuristic |
| 知识 / SEKB / DCS | 3.5–5.0 | 默认关；开启后 raw 数据债 |
| Memory | 3.5–5.0 | 默认关；gatekeeper 局部正面 |
| Agent Dev 控制面 | 7.0–8.0 | 仅控制面，证据陈旧 |
| 前端工程 | 4.0–5.5 | 可维护性与长会话风险 |
| 发布供应链 | 2.0–3.0 | Win 签名/update/provenance 未闭环 |
| 综合 | 5.0–5.8 | 安全、门禁、发布债压低上限 |

### 7.2 可声称 / 不可声称

边界以 §0.2 为准。任何 L4 未执行项统一使用：

> 源码表明相关入口或控制缺口存在；默认配置下是否可被实际利用，本轮未动态证实。

### 7.3 旧审计裁决

| 旧倾向 | 裁决 |
|---|---|
| 综合约 6.6 | 偏高，修订为 5.0–5.8 |
| Agent Dev release-grade = 全系统健康 | 错误外推 |
| 没有 verifier / Role 纯纸面 | 过度否定；存在 verifier 与 tool deny，但权威不足 |
| Files 已沙箱 | 半真：写有限，读几乎不限 |
| Sandbox 静默降级 | 修正：degraded 信号存在；强制可见与阻断未验证 |
| Cron 严格测试门 | 不属实；passWithNoTests 为系统性默认 |

---

## 8. 目标架构原则

```text
Untrusted inputs
  -> Typed IPC / Request schema / Sender-session binding
  -> Reference Monitor
       -> Secret Broker (handle-only, no getApiKey)
       -> File Broker (workspace roots + Windows canonicalization)
       -> Exec/Network Broker (deny/ask/allow)
       -> Sandbox Broker (fail-closed for high risk)
  -> Provenance + redaction + TTL for SEKB/Memory
  -> Auditable result
```

原则：Model proposes, Monitor decides；能力单源；迁移必须有旧路径删除条件；默认关闭能力不得被宣传为已生效。

---

## 9. 修复路线图与验收

| 批次 | 目标 | 内容 | 退出条件 |
|---|---|---|---|
| Batch 0 | 堵直接泄露 | F-SEC-001/002/003/004/005；删除 legacy secret 双写 | 对应 canary/scheme/path/schema 测试全绿；旧入口删除 |
| Batch 1 | 门禁与一致性 | F-GOV-001；Role/Cron 单源；原子写；degraded 强制可见 | 零测试 fail；双真相清零；故障注入通过 |
| Batch 2 | 权限内核 | ActionRequest + deny/ask/allow；role path 硬执行；sender/session binding | 权限 conformance 与 replay/race 测试通过 |
| Batch 3 | 隔离内核 | private clone / Docker/WSL/Hyper-V / credential proxy | 高危动作在无 strong backend 时 fail-closed |
| Batch 4 | 数据权威 | SEKB quarantine/redaction/provenance；Memory 双 gate；CVK/Spine enforce | canary 不落库；blocking 模式真实拒绝 |
| Batch 5 | 发布闭环 | Win sign/update feed/SBOM/provenance/clean tag/full gates | 篡改包拒绝；签名可验证；clean release |

每个修复 PR 必须关联 Finding、加入回归测试 ID，并删除旧路径或写明可执行的删除条件。

---

## 10. 验证计划

| 类型 | 命令/动作 | 本轮状态 | 结果写入 Manifest |
|---|---|---|---|
| 静态 | typecheck / lint / secret scan | 未运行全量门禁 | 已记录为未运行，不作通过断言 |
| 单元/集成 | Host/HTML/Browser/Files/Approval/Channel 定向回归 | 已运行：8 files / 82 tests，exit 0 | 是 |
| 对抗 | Browser scheme、junction write、approval replay | 已运行：3 tests，exit 0；三项均复现缺口 | 是 |
| Agent 红队 | Prompt Injection / tool abuse / canary exfil | 未运行 | 后续应写入 |
| 可靠性 | Cron/配置并发、崩溃、磁盘满 | 未运行 | 后续应写入 |
| 发布 | signed build / update tamper dry-run / SBOM | 未运行 | 后续应写入 |

本轮执行了定向安全回归与三项临时 L4，但没有执行全量 typecheck/lint/E2E、发布篡改、SEKB canary 或多窗口红队；不得把局部测试通过外推为产品验证通过。

---

## 11. 残缺、双真相与未验证

### 11.1 看起来有但默认不起作用

SEKB、Memory/COMPASS、CVK blocking、Spine blocking、strong sandbox、部分 Coding flags。它们应标为 capability/default-off 或 control/report-only，不应混入“安全已通过”。

### 11.2 双真相

Cron、Role built-ins、Provider secret legacy 双写、openExternal 多实现、Provider metadata。修复标准不是“再加同步”，而是单源 + 删除旧路径。

### 11.3 门禁稀释

passWithNoTests、cached typecheck、smoke E2E、陈旧 Agent Dev A 与 releaseReady=false 并存。日报证据与发布证据必须分层。

### 11.4 待补审计

完整清单见 [gap checklist](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.gap-checklist.md)。所有未做 L4 项都直接限制可声称边界。

---

## 12. 最终意见

1. 产品壳与高级子系统脚手架真实，但安全边界成熟度落后于能力表面积。
2. 立即风险集中在明文 secret、Renderer 明文 key、Files 全盘读、openExternal 旁路与 Host broker 缺口。
3. 元风险集中在 passWithNoTests、双真相和 dirty 发布基线；它们会让修复不可验证、不可复现。
4. CVK/Spine 的硬权威不是拨 flag：当前需要实现 enforce/blocking 能力，再逐步放量。
5. Windows 正式发布前必须完成签名、更新链、clean tag、SBOM/provenance 与 full gates；否则仅可作为受控 alpha。

本意见绑定 HEAD `60061e33554311ac3c9871195210df59fe1b5bf2`、dirty patch `sha256:bf430bf565518462e04a84392e547ffe02656569a1a3be1c227073cc13d68e42` 与 manifest 文件哈希。未列入 L2/L3 或未执行 L4 的区域，不作通过断言。

---

## 附录

| 附录 | 内容 |
|---|---|
| A | 本报告 §1.3 全量 L2/L3 已读索引 |
| B | manifest 中的扫描与命令摘要 |
| C | [Finding 全表 JSON](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.findings.json) |
| D | [攻击链细节](./CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.attack-chains.md) |
| E | §8 目标架构与各 Finding 验收条件 |
| F | 外部产品/论文对照：本轮未执行，保持 Unverified |
| G | 变更日志：旧版 §10/§11 已整合；原稿备份在 `tmp/CLAWX-UNIFIED-SYSTEM-HEALTH-AUDIT-2026-07-16.pre-restructure.md` |

---

## 13. B1–B8 重新审计补充与更正（2026-07-16）

本节是实质复核回填。勾选/已证表示有具体静态或动态结论，不表示全系统安全通过。

### 新增或升级 Findings

#### F-SEC-006 Workspace junction/reparse canonicalization permits external writes

- 严重度 / 决策 / 状态：High / Act-now / Open
- 证据等级 / 可达性：L4 / 是
- 证据：electron/services/workspace-permissions.ts:198-214；electron/services/files-api.ts:228-236,355-430；temporary L4 test: audit-b1b8-permission-path.test.ts
- 结论：词法 workspace 判断先于 realpath；动态测试证明 workspace 内 junction 能修改 workspace 外文件。
- 攻击链：AC-09、AC-11

#### F-SEC-007 Agent Browser multi-tab URL policy accepts javascript/data schemes

- 严重度 / 决策 / 状态：High / Act-now / Open
- 证据等级 / 可达性：L4 / 是
- 证据：shared/agent-browser/browser-control.ts:145-153；electron/services/agent-browser/browser-control/tab-manager.ts:170-175,281-293；electron/services/agent-browser-service.ts:1086-1097；temporary L4 test: audit-b1b8-browser-url.test.ts
- 结论：主 session 使用 http/https allowlist，但多标签页只走黑名单；动态测试确认 javascript/data 未被限制。
- 攻击链：AC-01、AC-11

#### F-AUTH-006 Approval consumption is not atomic and can be replayed concurrently

- 严重度 / 决策 / 状态：High / Act-now / Open
- 证据等级 / 可达性：L4 / 是
- 证据：electron/services/permissions-api.ts:237-267；temporary L4 test: audit-b1b8-permission-path.test.ts
- 结论：consume 是无互斥的 read-modify-write；Promise.all 两个 consumer 均成功。
- 攻击链：AC-10

#### F-AUTH-008 Feishu/WeCom channel configuration broadens inbound access to open/*

- 严重度 / 决策 / 状态：High / Act-now / Open
- 证据等级 / 可达性：L3 / 是
- 证据：electron/utils/channel-config.ts:686-704；tests/unit/channel-config.test.ts
- 结论：pairing 被转换为 open；默认 dmPolicy=open、allowFrom=[*]，任意入站用户可触发 Agent。
- 攻击链：AC-12

#### F-AUTH-009 MCP permission/sandbox/network policy fields are not proven runtime-enforced

- 严重度 / 决策 / 状态：High / Act-now / Open
- 证据等级 / 可达性：L3 / 条件可达
- 证据：electron/services/mcp-api.ts:505-523,642-653,737-771,1153-1179,1470-1490
- 结论：MCP env 明文存储并返回 Renderer；permissionMode/sandboxProfileId/networkPolicy 未投影 runtime，reload 还是 best-effort。
- 攻击链：AC-13

#### F-DATA-005 Session hard delete does not cascade to SEKB/Memory/DCS derivatives

- 严重度 / 决策 / 状态：High / Act-now / Open
- 证据等级 / 可达性：L3 / 是
- 证据：electron/services/sessions-api.ts；openclaw_runtime/src/knowledge/sekb；openclaw_runtime/src/context-engine；openclaw_runtime/src/memory
- 结论：hard delete 会清 transcript/trajectory/context archive，但未发现 SEKB、Memory、DCS 衍生数据的 lineage 级联删除。
- 攻击链：AC-05、AC-14

#### F-REL-005 Electron logs have no rotation/retention limit and swallow write failures

- 严重度 / 决策 / 状态：Medium / Act-now / Open
- 证据等级 / 可达性：L3 / 是
- 证据：electron/utils/logger.ts
- 结论：每日 append 日志无容量/保留/轮转上限，写失败静默，存在磁盘耗尽与不可观测故障。
- 攻击链：AC-15

#### F-SUPPLY-002 Build-time executables and CI installer are not integrity-pinned

- 严重度 / 决策 / 状态：High / Publish-blocker / Open
- 证据等级 / 可达性：L3 / 发布时可达
- 证据：scripts/download-bundled-uv.mjs；scripts/download-bundled-agent-browser.mjs；.github/workflows/release.yml
- 结论：外部 archive/裸二进制无 checksum/signature；CI 有 curl|sudo bash 与浮动 Action tag；未见 SBOM/SLSA provenance。
- 攻击链：AC-08、AC-16

### 旧 Finding 更正

- F-SEC-010：主 Renderer 无 CSP；HtmlPreview 允许脚本、下载与 popup escape。Markdown 路径未发现 raw HTML 原语，XSS-to-Host 仍未做 end-to-end。
- F-ISO-002：专用 WebView attach/permission 管控缺失由 L1-L2/Unverified 升级为 L3/Open；未声称已完成利用。
- F-SUPPLY-001：stable 有 SignPath，alpha/beta 明确跳过签名；当前 0.4.9-alpha.0 不能声称 Windows 签名闭环。

### 动态验证

| 验证 | 结果 | 结论 |
|---|---|---|
| 既有安全单测 | exit 0；8 files / 82 tests | 回归通过，不等于安全通过 |
| Browser javascript/data | exit 0；1/1 | 黑名单接受两种 scheme；F-SEC-007 已证 |
| Windows junction write | exit 0；1/1 | 修改工作区外文件；F-SEC-006 已证 |
| Approval Promise.all replay | exit 0；1/1 | 两个 consumer 均成功；F-AUTH-006 已证 |
| 其余 B8 | 未运行 | 具体阻断见 gap checklist / manifest |

### 供应链、可靠性与隐私更正

- stable Windows 签名链是正面证据；prerelease unsigned、feed 注入、下载完整性、SBOM/provenance 仍阻断发布。
- 日志无轮转且写失败静默；Cron 跨进程 lease 和关键配置故障注入未证明。
- session delete 不级联 SEKB/Memory/DCS；未发现常见分析 SDK 不等于无模型/OAuth/MCP/更新第三方数据流。
