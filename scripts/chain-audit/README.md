# Chain Audit — 全链路集成测试审计系统

> 沉淀自 2026-08-11 真实链路验证三轮（JForum 载体，发现 13 个 issue #9-#21）。
> 目标：可无限复用、配置驱动、量化分级的全链路测试系统，用于持续监控各组件协作。

## 为什么存在

真实链路验证证明：**单元测试全绿 ≠ 链路通**。三轮测试发现 13 个真实问题（auth env 缺失、apply_patch 沙盒不一致、memory 禁用、contextWindow 1M 等），全部是单测覆盖不到的跨组件协作问题。本系统把这些验证沉淀为可重复执行的审计。

## 架构

```
scripts/chain-audit/
├── run-chain-audit.mjs      # 主入口（一键全矩阵）
├── config/matrix.json       # 测试矩阵（链路分类 + 任务模板 + 预期，可增删）
├── lib/
│   ├── gateway.js           # gateway 生命周期（启动/健康/停止/日志）
│   ├── rpc-client.js        # WS RPC 客户端（协议 v4 + token + scopes）
│   ├── monitor.js           # 证据采集（transcript/token/工具序列/压缩事件）
│   ├── grade.js             # 量化分级（A/B/C/D/F + 0-100 分）
│   └── report.js            # 报告生成（JSON + Markdown）
└── evidence/<ts>/           # 每次运行证据（报告 + gateway 日志）
```

## 用法

```bash
# 前置：openclaw_runtime 已构建（dist/entry.js 存在），gateway 端口空闲

# 全矩阵
DEEPSEEK_API_KEY="sk-..." node scripts/chain-audit/run-chain-audit.mjs

# 只跑指定链路
DEEPSEEK_API_KEY="sk-..." node scripts/chain-audit/run-chain-audit.mjs --chain coding

# 复用已运行的 gateway（省去重启）
node scripts/chain-audit/run-chain-audit.mjs --skip-start

# 跑完不关 gateway（连续多轮调试）
DEEPSEEK_API_KEY="sk-..." node scripts/chain-audit/run-chain-audit.mjs --keep-gateway
```

## 量化分级标准

每个任务产出 0-100 分 + A/B/C/D/F 分级：

| 分级 | 分数 | 含义 |
|------|------|------|
| A 健康 | ≥90 | 链路完全打通，指标达标 |
| B 可用 | ≥75 | 链路打通，轻微缺陷 |
| C 部分 | ≥60 | 部分可用，有阻断项 |
| D 受损 | ≥40 | 严重受损 |
| F 断裂 | <40 | 完全断裂 |

计分 = 检查项通过率 × 70% + 数值指标达标率 × 30%

### 检查项（布尔）

- `accepted` — agent 任务被接受
- `tools.<name>` — 期望工具被调用
- `hasAnswer` — 有模型回复
- 链路特定项（如 `memory.available`）

### 数值指标（线性映射 good/bad）

- `elapsedMs` — 任务耗时
- `cacheHitRate` — 上下文缓存命中率（good≥80%, bad<50%）
- `modelRounds` / `totalCost` — 成本观测

## 已实现能力

- ✅ 真实 gateway 生命周期管理（启动/健康/停止/日志）
- ✅ 协议 v4 WS RPC 客户端（token + scopes + 枚举 client）
- ✅ **双测试面**：Agent 任务链路（11 条，真实模型走工具）+ RPC 直测（15 组 31 方法，不经模型秒级完成）
- ✅ 任务级隔离（每任务独立 sessionKey → 独立 transcript，无历史串扰）
- ✅ 量化分级 A/B/C/D/F + 0-100 分（检查项 70% + 指标 30%）
- ✅ 关键检查语义（链路可用性类失败直接判 F，不被指标稀释）
- ✅ 证据留存（report.json + report.md + gateway 日志）
- ✅ 趋势追踪（history.json，最近 5 次分数对比看退化）
- ✅ 配置驱动矩阵（新增链路/任务只需改 matrix.json 或 rpc-checks.json）

## 覆盖面

**Agent 任务链路（26 条）**：只读 / 写入 / 命令执行 / 网络 / 多智能体 / 编码能力 / 记忆 / 会话管理 / 上下文累积 / 配置 / 错误恢复 / 上下文压缩 / 沙盒隔离 / 知识库 / 技能 / 定时任务 / 任务循环 / 审批 / 浏览器 / Git / 审批流 / 会话Fork / 接力Handoff / 工作空间 / 任务循环详情 / 记忆写入

**RPC 服务面（31 组）**：core / sessions / tools / skills / roles / memory / observability / security / config / usage / verification / doctor / control-plane / runtime / clawgraph / agents / artifacts / capabilities / channels / cron / device / gateway-mgmt / node / plugins / tasks / media / secrets / fork / workspace / taskloop / memory-write

## 测试矩阵扩展

`config/matrix.json` 中按 `chains[].tasks[]` 结构添加：

```json
{
  "id": "my-chain",
  "name": "我的链路",
  "tasks": [
    {
      "id": "my-task",
      "message": "给 agent 的任务指令",
      "expectTools": ["read", "exec"],
      "checks": ["hasAnswer"],
      "metrics": { "elapsedMs": { "good": 60000, "bad": 180000 } }
    }
  ]
}
```

## RPC 检查面扩展

`config/rpc-checks.json` 中按 `groups[].checks[]` 结构添加。单次调用有**三条通过路径**，判定规则集中在 `lib/rpc-check.js`（纯函数，由 `tests/unit/chain-audit-rpc-check.test.ts` 覆盖）：

| 路径 | 条件 | 用途 |
|------|------|------|
| 成功 | `res.ok === true` | 常规可用性检查 |
| admin gate | 方法在 `group.adminOnly` 中，且错误匹配 `missing scope` | 验证权限边界确实拦住了越权调用 |
| **预期错误** | 检查项声明 `expectError`，且错误文本匹配该字面量 | 验证错误处理路径生效（见下） |

`expectError` 是 issue #35 引入的语义。此前「验证错误处理」的探测无法表达意图——评分器把任何 error 都判失败，导致 `taskloop` 组无论 runtime 好坏恒为 0/1：

```json
{
  "method": "task_loop.status",
  "params": { "loopRunId": "nonexistent-probe" },
  "note": "验证错误处理而非真实循环",
  "expectError": "unknown task loop"
}
```

约定：

- 值是**字面量**而非正则，特殊字符会被转义（写 `a.b` 只匹配 `a.b`，不匹配 `axb`），匹配时忽略大小写。
- 错误不匹配期望文本时**仍然判失败**——这样探测才保留了发现真实退化的能力。
- `expectError` 不会把「调用成功」也算通过；成功与命中预期错误在报告里通过 `expectErrorMatched` 区分。

**探测会话不要用共享主会话。** `fork` 组曾直接 fork `agent:main:main`，而主会话随使用持续增长，超过 `contextWindow` 后 fork 必然失败——结果与 fork 功能是否健康无关（#27 修复后的正确行为被误判为故障）。现在的做法是先用 `sessions.create` 建一个专用探测会话（`sessions.create` 对同一 key 幂等），再 fork 它：

```json
{
  "id": "fork",
  "checks": [
    { "method": "sessions.create", "params": { "key": "agent:main:chain-audit-fork-probe" } },
    { "method": "sessions.fork",   "params": { "key": "agent:main:chain-audit-fork-probe" } }
  ]
}
```

配置在审计启动前会经 `validateRpcChecksConfig` 校验，非法配置直接抛错退出，不会跑完 31 组才暴露问题。

## 与现有验证设施的关系

| 设施 | 定位 | 本系统补充 |
|------|------|-----------|
| 单元测试（vitest） | 单组件正确性 | 跨组件链路 |
| comms:replay/compare | 传输层指标 | 全链路行为 |
| E2E（Playwright） | GUI 交互 | headless runtime 链路 |
| 本系统 | 真实 gateway + 真实模型 | 可重复、量化、分级 |

## 已知待办（后续迭代）

- [ ] 沙盒链路（sandbox mode=on 时验证 SSH 后端）
- [ ] 自动触发压缩实验（配 contextWindow 后验证 #15/#18/#20 修复）
- [ ] 错误分类（把 errors[] 映射到已知 issue 模式，自动关联）
- [ ] 多 provider 矩阵（切换不同模型跑同一链路）
- [ ] 跨运行 diff 报告（对比两次运行的检查项差异，精确定位退化点）
