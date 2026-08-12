# Chain Audit — 全链路测试审计系统（会话交接）

> 位置：`scripts/chain-audit/`（git 追踪，新会话可直接调用）
> 证据：`artifacts/chain-audit/evidence/`（每次运行报告 + history.json 趋势）

## 是什么

真实 Gateway + 真实模型的全链路集成测试系统。覆盖 **26 条 Agent 行为链路 + 31 组 RPC 直测**，量化分级（A/B/C/D/F + 0-100），可重复执行、可扩展、趋势追踪。

## 新会话快速开始

```bash
# 1. 环境准备：runtime 需已构建（dist/entry.js 存在）
#    若缺失：cd openclaw_runtime && CI=true node scripts/tsdown-build.mjs

# 2. 跑全量审计（26 链路 + 31 RPC 组，约 10 分钟）
DEEPSEEK_API_KEY="sk-..." pnpm chain-audit

# 3. 定向跑某链路（验证修复）
DEEPSEEK_API_KEY="sk-..." pnpm chain-audit -- --chain memory          # 验证 #19 修复
DEEPSEEK_API_KEY="sk-..." pnpm chain-audit -- --chain sandbox         # 验证 #22 修复
DEEPSEEK_API_KEY="sk-..." pnpm chain-audit -- --chain fork --chain handoff

# 4. 复用已运行 gateway（省重启）
pnpm chain-audit -- --skip-start
```

## 输出解读

| 项 | 位置 | 内容 |
|---|---|---|
| 最新报告 | `artifacts/chain-audit/evidence/<最新ts>/report.md` | 每链路分级 + 工具序列 + 错误 |
| 机器可读 | 同目录 `report.json` | 完整结构化数据 |
| 趋势 | `artifacts/chain-audit/evidence/history.json` | 跨运行分数对比（看退化）|

## 配置扩展（无需改代码）

| 文件 | 作用 |
|---|---|
| `scripts/chain-audit/config/matrix.json` | Agent 行为链路（26 条，增删任务）|
| `scripts/chain-audit/config/rpc-checks.json` | RPC 直测组（31 组，增删方法）|

## 关键前置

- **DEEPSEEK_API_KEY** 必须（agent 会话需要真实模型 key，运行时注入不落盘）
- **gateway 端口** 18799（可 CHAIN_AUDIT_PORT 覆盖）
- **沙盒链路** 需沙盒镜像（见 issue #22，当前受阻）
- **记忆链路** 当前 10 分（断裂，issue #19）

## 历史发现（issue 索引）

18 个真实链路问题（#9-#26）：auth env 缺失 / read EISDIR / exec 默认 deny / apply_patch 沙盒不一致 / plugin-tools 16s / contextWindow 1M / memory 禁用 / 压缩空会话死循环 / gateway 工具 action 白名单（fork/handoff/memory 写不可达）等。修复 agent 可用定向 `--chain` 验证。

## 已知限制

- Windows 下 gateway 需 `dist/entry.js`（runtime 构建产物）
- 沙盒镜像构建脚本有 CRLF 问题（已在工作树修复，未提交）
- 每链路独立 session 初始化 ~15s（plugin-tools 注册，issue #13）
