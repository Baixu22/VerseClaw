# agent-reach-ts-shadow

TypeScript shadow of [Agent Reach](../agent_reach)'s **read** components, shaped for eventual [ClawX](../../clawx/ClawX) tool registration.

## 目的

把 Agent Reach（Python）里**真正值得迁移的读取逻辑**重构为 Node/TS，对齐 ClawX 的 agent 工具形状（`{ label, name, description, parameters, execute }`），但**不**集成进 ClawX，也**不**依赖 ClawX 运行时。这是一个独立的"组件库"，等 ClawX 环境支持时再整体迁入 `openclaw_runtime/extensions/reach-readers/`。

## 设计原则

1. **零依赖** — 纯 Node 标准库 + 自实现极简 schema builder。迁移到 ClawX 时把 `src/common/schema.ts` 换成 `typebox`，`src/common/plugin-entry.ts` 换成 `openclaw/plugin-sdk/plugin-entry`。
2. **形状对齐** — 工具形状严格对齐 ClawX 的 `AnyAgentTool`（见 `src/common/tool-shape.ts`）。迁移时 `api.registerTool(tool, { names: [...] })` 直接可用。
3. **只做读** — 不做浏览器自动化（ClawX 的 `agent_browser` 已更强）、不做 install/doctor/config 子命令（ClawX 有自己的体系）。
4. **真实重构，不是包装** — Python 的 `probe_command` / `can_handle` / `_clean_note` / `transcribe` 都逐逻辑对译为 TS，不是 spawn Python。

## 迁移自 Agent Reach 的内容

| Agent Reach (Python) | → 本项目 (TS) | 备注 |
|---|---|---|
| `probe.py: probe_command` | `src/core/probe.ts: probeCommand` | `execFile` 替代 `subprocess.run`，分类语义一致 |
| `channels/base.py: Channel` | `src/core/router.ts` | `canHandle` + `orderedBackends` 抽出为独立函数 |
| `channels/xiaohongshu.py: _clean_note` | `src/tools/xiaohongshu.ts` 内 `cleanNote` | 逐行对译，纯数据处理 |
| `transcribe.py: transcribe` | `src/tools/youtube.ts` 内 `transcribe` | yt-dlp + ffmpeg + Whisper 链 |
| `channels/*.py` 各 `check()` | 每个工具 `execute` 开头的 probe | 按需探活，不做全局 doctor |
| `config.py: Config` | `src/core/config.ts` | YAML → JSON（ClawX 生态更偏好 JSON） |

## 目录结构

```
ts-shadow/
├── src/
│   ├── common/            # ClawX 形状对齐层（迁移时部分替换）
│   │   ├── schema.ts      # 极简 typebox 替身
│   │   ├── tool-shape.ts  # AnyAgentTool 类型 + jsonResult/readStringParam
│   │   └── plugin-entry.ts# definePluginEntry stub
│   ├── core/              # 基座
│   │   ├── probe.ts       # probeCommand + httpJson
│   │   ├── router.ts      # canHandle + orderedBackends
│   │   └── config.ts      # JSON Config
│   ├── tools/             # 平台读取工具
│   │   ├── web.ts         # Jina Reader（零配置）
│   │   ├── youtube.ts     # yt-dlp + 可选 Whisper（零配置）
│   │   ├── rss.ts         # 零依赖 XML 解析（零配置）
│   │   ├── v2ex.ts        # HTTP（零配置）
│   │   ├── xueqiu.ts      # HTTP + cookie（零配置基础）
│   │   ├── bilibili.ts    # bili-cli + 搜索 API（零配置兜底）
│   │   ├── github.ts      # gh CLI
│   │   ├── twitter.ts     # twitter-cli ▸ opencli（登录态）
│   │   └── xiaohongshu.ts # opencli ▸ xhs-cli + cleaners（登录态）
│   └── index.ts           # 汇总导出
└── demo/
    └── runner.ts          # 验证可跑（仅 probe/canHandle，不触网读取）
```

## 运行

```bash
# 不需要 npm install —— 零依赖
npx tsx demo/runner.ts              # 跑全部工具的 probe + canHandle 自检
npx tsx demo/runner.ts --probe      # 只跑后端探活
```

## 不在本项目范围

- 浏览器自动化（click/type/screenshot）— ClawX `agent_browser` 已覆盖
- install/doctor/configure CLI — ClawX 有 clawhub/skill 安装体系
- run-artifact/manifest 落盘 — 读取工具只返回结构化 JSON
- facebook/instagram/linkedin/xiaoyuzhou — Phase 3 再补，结构同 twitter/xiaohongshu
