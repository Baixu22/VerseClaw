# Handoff — Chain-Audit 真实项目验收 + Reasonix 对齐（2026-08-12 晚，进行中）

> 状态：**未完成、工作树未提交、`openclaw_runtime/dist/` 已被清空（构建中途终止）**。
> 下个 agent 接手前必须先重建 dist，否则 runtime/gateway 无法启动。

---

## 0. ⚠️ 立即要做（阻塞项）

1. **重建 `openclaw_runtime/dist`**（当前为空目录，被终止的构建清空了产物）：
   ```bash
   cd openclaw_runtime && CI=true node scripts/tsdown-build.mjs   # ~3-5 分钟
   ```
2. 重建后先跑 `pnpm chain-audit -- --chain readonly` 确认 gateway 能起来、链路恢复正常（此前 100/健康）。

## 1. 本次会话做了什么（已完成且有证据）

### 1.1 Chain-audit 框架修复（已提交 `ca9db4de5`）
- **transcript 跨会话串扰**：`run-chain-audit.mjs` waitForSessionComplete 原来取全局最新文件，导致 sandbox/skills/readonly 全假降级。改为「任务前快照 sessions 目录 + 按任务 user 消息匹配归属」。
- **sessionKey 复用旧会话**：加时间戳唯一化。
- **RPC expectError 语义**（对应 issue #35）：rpc-checks.json 支持 `expectError` 字段，taskloop 组加 `"expectError":"unknown task loop"` → taskloop RPC 组从恒断裂变为健康。
- **monitor.js args `[object Object]`**：改 `JSON.stringify`。
- **analyzeGatewayLog 接入报告**：report.json 新增 `gatewayEvents`（compactionEvents/errorLines）。
- **新脚本**（已入库）：`analyze-jforum-fix.mjs`（修复正确性+短路/循环诊断）、`score-coding-dimensions.mjs`（7 维 coding 打分）、`verify-compaction.mjs`（压缩实测）。
- **效果**：RPC 服务面 31/31 组历史首次全绿（94→100）；jforum-fix 6/6 健康。

### 1.2 真实项目验收（JForum-master 载体）
- `scripts/chain-audit/config/matrix.json` 新增 `jforum-fix` 链：6 个真实 bug 修复任务（文件+现象粒度提示）。
- 验收结果：**6/6 修复正确、零短路**，diff 核验零夹带；7 维打分 coding index 88/94，短板=效率（冗余 git/grep）+ 验证深度 grep-only。
- 基线备份：`artifacts/chain-audit/jforum-baseline/2026-08-12T20-27-28/`（可还原 JForum 改动）。
- JForum 工作区当前含 6 处修复（TopicController/ForumRepository/TopicWatchExtension/UserController×2/JForumConfig），**未提交**（JForum 本身是空 git 仓库）。

### 1.3 B7：main 会话 contextTokens 遗留 1M（已修，未提交）
- 根因：`session-utils.ts` buildGatewaySessionRow 用持久化快照优先（main 会话存 1M），live catalog（131072）被跳过 → 旧会话永不自动压缩。
- 修复：读侧校验，live catalog 优先。**验证通过**：main contextTokens 1000000→131072。
- 注：这是 `openclaw_runtime/src/gateway/session-utils.ts` 的改动（未提交，见 §2）。

### 1.4 压缩实测（verify-compaction.mjs）
- 对超限 main 会话（218014 tokens）调 `sessions.compact` → **218014→1652，回收 99.2%，22s**。
- 发现：`sessions.compact` 需 `operator.admin` scope（服务端故意设计，勿改）；参数名是 `key` 非 `sessionKey`。
- transcript `b8e370c7*.jsonl` 尾部有真实 `{"type":"compaction"}` 事件。

## 2. ⚠️ 未提交的工作树改动（6 个文件，Reasonix 对齐进行中）

```bash
 M openclaw_runtime/extensions/deepseek/openclaw.plugin.json   # B3: 4 模型加 compat.supportsPromptCacheKey
 M openclaw_runtime/src/auto-reply/reply/session-fork.ts       # B5: fork 上限 100K 硬编码 → min(100K, 0.8×contextWindow)
 M openclaw_runtime/src/gateway/server-methods/agent.ts        # B1: 已改又已回退 → 当前=基线（无 diff 语义残留）
 M openclaw_runtime/src/gateway/session-utils.ts               # B7: contextTokens 读侧 live-catalog 优先（验证通过）
 M openclaw_runtime/src/plugin-sdk/provider-stream-shared.ts   # B2: reasoning_effort 粒度 low/medium→high; B4: max_tokens 32K/64K
 M openclaw_runtime/src/plugins/provider-thinking.ts           # B6: resolveThinkingProfile 加 runtime plugin 回退（deepseek 不在 gateway 插件列表）
```

**B1 已回退**：gateway `agent.ts` 里加的 thinkingDefault 解析已移除（它把默认值变成显式 override，触发 "Thinking level medium not supported... Use one of: off" 抛错）。当前 agent.ts = 基线。

**已改未重建验证**：B2/B3/B4/B5/B6 源码改动在，但 **dist 被清空**，尚未重建验证。

## 3. 🔴 核心未解问题：DeepSeek reasoning 无法开启（下一 agent 的主任务）

### 现象
- 所有 chain-audit 运行 transcript 都是 `thinkingLevel:"off"`（例如 `257e44b3*.jsonl`、`316d578c*.jsonl`）。
- gateway 日志（`artifacts/chain-audit/evidence/gateway.log`）：
  ```
  [gateway] agent model: deepseek/deepseek-v4-flash (thinking=medium, fast=off)
  [ws] res ✗ agent errorCode=UNAVAILABLE errorMessage=Error: Thinking level "medium" is not supported for deepseek/deepseek-v4-flash. Use one of: off.
  ```
  → gateway 能解析到 `thinkingDefault="medium"`（配置在 `~/.openclaw/openclaw.json` agents.list[0].thinkingDefault=medium），但 **agent-command 内的 `resolveThinkingProfile` 对 deepseek 返回 off-only**，导致传 medium 报错。

### 已定位根因
- `resolveThinkingProfile`（`src/auto-reply/thinking.ts:178`）→ `resolveProviderThinkingProfile`（`src/plugins/provider-thinking.ts:80`）**只查 activeRegistry**（gateway 侧插件注册表）+ bundled surface。
- gateway 启动日志显示仅加载 9 个插件（acpx/browser/canvas/device-pair/file-transfer/memory-core/phone-control/reach-readers/talk-voice）——**deepseek 不在其中**（deepseek 是按需加载的 provider 插件）。
- 因此 deepseek 的 thinking profile（`extensions/deepseek/thinking.ts`：off/minimal/low/medium/high/xhigh/max，default high）**解析不到** → `buildOffOnlyThinkingProfile`。
- **源码级验证**（`node_modules/.bin/tsx`）：
  - `formatThinkingLevels('deepseek','deepseek-v4-flash')` → `off, minimal, low, medium, high, xhigh, max` ✅（源码正确）
  - catalog `reasoning:false` → `off`（off-only 分支触发条件）
  - 运行时报 off-only → gateway 场景下 catalog entry 的 `reasoning` 被解析成了 **false**（或 profile 没解析到）。

### 已做尝试（供参考，勿重复）
- B1（gateway 传 thinkingDefault）→ 报错，已回退。
- B6（provider-thinking.ts 加 `resolveProviderRuntimePlugin` 回退）→ **已改未验证**（dist 被清空前未重建验证）。下一步应从重建 dist 后重跑 jforum-fix 验证 B6 是否解决 off-only；若仍 off-only，需查 `loadManifestModelCatalog`/`buildConfiguredModelCatalog` 对 deepseek 条目的 `reasoning` 值为何是 false（`src/agents/model-catalog.ts:278` `reasoning = typeof entry?.reasoning === "boolean" ? entry.reasoning : false`）。

### 目标
让 deepseek-v4-flash 真正以 `thinking=medium/high`（reasoning_effort）运行，chain-audit transcript 出现 `thinkingLevel:"medium"` 且 `reasoning_content` 参与（usage 含 reasoning tokens）。

## 4. 环境与凭据（勿泄露）

- **DEEPSEEK_API_KEY** 在 `C:\Users\27933\Desktop\新建 文本文档.txt`（`sk-` 开头 35 字符）。只读文件注入到运行时环境变量，**绝不写入仓库/磁盘**。
- 运行命令模板：`DEEPSEEK_API_KEY=$(node -e "const fs=require('fs');const m=fs.readFileSync('C:/Users/27933/Desktop/新建 文本文档.txt','utf8').match(/(sk-[A-Za-z0-9]+)/);process.stdout.write(m[1]);") pnpm chain-audit -- --chain <chain>`
- gateway 端口 18799（CHAIN_AUDIT_PORT 可覆盖）；token `chain-audit-token`。

## 5. 遗留事项（A 组收尾未完成）

- **A2 memory 索引**：`openclaw memory index --force` 无对应 CLI（entry.js 只有 doctor 命令，memory 子命令不存在）。已创建 `~/.openclaw/agents/main/MEMORY.md`（记忆源文件）。**未建索引**：`~/.openclaw/memory/main.sqlite` 的 meta/files/chunks 全 0 行。memory 链路当前 10 分（断裂）——需确认 embedding provider 配置（memorySearch 需要 provider）才能建索引。
- **A3 自动压缩实验**：临时设 `agents.defaults.contextTokens=30000` 已**恢复删除**（配置已还原）。压缩已通过 verify-compaction 实测（§1.4），自动阈值压缩端到端未触发（单任务量级不足）。
- **issue #36 API key 泄露**：3 个已提交 fixture（`tests/unit/runtime-memory-*.test.ts`，commit bdcbf85b1）含真实可用的 sk-key，与用户文本文件一致。**用户已知悉、暂不处理**（仓库私有）；已在 issue #36 记录。不建议主动轮换（用户没要求）。
- **issue #35**：RPC expectError 已实现，issue 可关闭（未关）。
- **JForum 修复成果**：保留在 JForum 工作区（可 `artifacts/chain-audit/jforum-baseline/2026-08-12T20-27-28/` 还原）。

## 6. 全新开发前的建议顺序

1. 重建 dist（§0）→ `--chain readonly` 冒烟。
2. 验证 B6 是否解决 off-only（§3）→ 跑 `--chain jforum-fix`，看 transcript `thinkingLevel`。
3. 若 off-only 仍在：查 manifest catalog reasoning 值链路。
4. B1 是否重新启用：**建议不复用 B1 方案**（会变显式 override 抛错），改让 agent-command 的默认解析路径在 deepseek 上走通即可（thinkingDefault 在 agent-command:1530 已解析，问题只在 profile off-only）。
5. 全部验证通过后：提交 §2 的 6 个文件（runtime 修复）+ 更新 `docs/dev/handoffs/CHAIN-AUDIT.md` 已知限制。
6. 可选：关 #35；建 memory 索引（需先配 embedding provider）。

## 7. 关键文件索引

| 文件 | 作用 |
|---|---|
| `scripts/chain-audit/run-chain-audit.mjs` | 审计主入口（含本次修复）|
| `scripts/chain-audit/analyze-jforum-fix.mjs` | JForum 修复验收分析 |
| `scripts/chain-audit/score-coding-dimensions.mjs` | 7 维 coding 打分 |
| `scripts/chain-audit/verify-compaction.mjs` | 压缩实测 |
| `openclaw_runtime/src/auto-reply/thinking.ts` | thinking profile 解析（off-only 根因）|
| `openclaw_runtime/src/plugins/provider-thinking.ts` | **B6 改动**（runtime 回退）|
| `openclaw_runtime/extensions/deepseek/thinking.ts` | deepseek profile（off..max, default high）|
| `openclaw_runtime/src/gateway/session-utils.ts` | **B7 改动**（contextTokens live 优先）|
| `artifacts/chain-audit/evidence/history.json` | 15+ 次运行趋势（最近 agent 94/100 附近）|
| `artifacts/chain-audit/jforum-baseline/` | JForum 修复基线备份 |
