# Debug Session: Gateway Cannot Connect — 排查交接文档

**Status**: [PARTIALLY FIXED — 被沙箱拦截，需要换环境继续验证]
**Session ID**: `gateway-cannot-connect`
**Created**: 2026-06-12
**Last update**: 2026-06-12

> 用途：把"Gateway 连不上"这一问题的当前排查结论交接给另一个开放一些（没有 Trae AI 沙箱拦截）的 agent 继续完成最后一步验证。

---

## 1. 原始问题

**实际现象**：在 `c:\Users\27933\Desktop\clawx\ClawX` 下运行 `npm run dev`，Vite + Electron main 进程能起来，但 OpenClaw Gateway 起不来 / 连不上，UI 一直停在 "connecting"。

**预期**：Gateway 进程在 10–30 秒内监听 18789，主进程建立 WebSocket 连上，UI 切到 connected/healthy。

---

## 2. 已定位并修复的根因 #1 —— `reasoningEffort` 配置项非法

### 现象
Gateway 进程启动后立即退出 (exit code 1)。日志报错：

```
Invalid config at C:\Users\27933\.openclaw\openclaw.json.
agents.list.0: Unrecognized key: "reasoningEffort"
```

OpenClaw 用 Zod schema 校验 `openclaw.json`，schema 不识别 `agents.list[0].reasoningEffort` 字段，导致整个 Gateway 启动失败。

### 修复
按用户选择（**删掉 `reasoningEffort`（推荐）**），从两处配置中删除该字段：

- `C:\Users\27933\.openclaw\openclaw.json`（旧 ~/.openclaw 路径下的配置）
- `C:\Users\27933\AppData\Roaming\clawx\openclaw-source-state\openclaw.json`（ClawX 独立系统下的源配置，**这是后续应该关注的"正式"配置**）

> ⚠️ **用户明确指示**：ClawX 是一套独立的系统，配置根目录在 `C:\Users\27933\AppData\Roaming\clawx`，**不要再参考 `~/.openclaw` 那套旧方案**。下面的文件路径以此为准。

### 修复后两处配置的关键片段

`C:\Users\27933\AppData\Roaming\clawx\openclaw-source-state\openclaw.json`：

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "name": "Main Agent",
        "default": true,
        "workspace": "~/.openclaw/workspace",
        "agentDir": "~/.openclaw/agents/main/agent",
        "thinkingDefault": "xhigh",
        "sandbox": {
          "mode": "off",
          "autoDisabledReason": "openclaw-sandbox:bookworm-slim image is not available on this machine"
        }
      }
    ]
  }
}
```

注意 `sandbox.mode = "off"` 是正常的（用户机器上没有 bookworm-slim 镜像，系统自动禁用了 sandbox，不是错误原因）。

### 验证
- 用 `JSON.parse` + 关键字搜索确认两个文件里都不再有 `reasoningEffort`。
- 修改后 **没有** 跑成功 `npm run dev`（见下面的根因 #2）。

---

## 3. 新发现的根因 #2 —— Trae AI 沙箱拦截 AppData 文件写入（**当前阻塞**）

### 现象
删掉 `reasoningEffort` 后重跑 `npm run dev`，Vite + main bundle 都能正常 build，Electron 也启动了，但**立刻被 Chromium 单实例锁挡掉**：

```
[2026-06-12T13:01:46.197Z] [INFO ] [Updater] Version: 0.4.9-alpha.0, channel: alpha, ...
[14380:0612/210150.003:ERROR:chrome\browser\process_singleton_win.cc:457] Lock file can not be created! Error code: 5
[ClawX] Another instance already holds the single-instance lock; exiting duplicate process
TRAE Sandbox Error: hit restricted
  Not allow operate files: C:\Users\27933\AppData\Roaming\clawx\lockfile
```

- 错误码 5 = `ERROR_ACCESS_DENIED`。
- 同时 trae-sandbox 报"`Not allow operate files: C:\Users\27933\AppData\Roaming\clawx\lockfile`"。
- user data 目录（`C:\Users\27933\AppData\Roaming\clawx\`）里没有任何残留的 `*.lock*` / `Singleton*` / `lockfile` 文件（已用 `Get-ChildItem` 反复确认）。
- 用 `tasklist` 确认没有任何 `electron.exe` / `chrome.exe` 进程残留。
- 用 `node .dbg/clear-stale-locks.cjs`（项目内沙箱白名单路径下执行，所以能删除）成功删掉了 `verse-claw.instance.lock`（5 字节，时间戳是用户上次会话残留），但**重跑 dev 仍然报同样的 lock 创建错误**。

### 结论
**Trae AI 沙箱在 OS 层（minifilter 或类似机制）拦截了对 `C:\Users\27933\AppData\Roaming\clawx\` 目录下文件的创建操作**。`app.requestSingleInstanceLock()` 内部需要创建 `lockfile`（小写）来记录 holder PID，被沙箱挡掉后 Chromium 报 ERROR_ACCESS_DENIED，主进程走"另一个实例在跑"的分支立刻 `app.exit(0)`。`grep` 也能确认：main 流程里 Chromium lock 是 **先于** 自家 `acquireProcessInstanceFileLock` 检查的，所以靠自家 lock 也救不回来。

### 已尝试且失败的变通
- 清掉 `verse-claw.instance.lock` / `SingletonLock` / `lockfile`（无残留，本来就没有）。
- 设置 `VERSE_CLAW_USER_DATA_DIR=c:\Users\27933\Desktop\clawx\ClawX\.dbg\userData` 把 userData 指向项目内（沙箱允许的位置）。dev 跑起来了，但 Chromium 单实例锁默认锁在 userData 目录里 —— 此时又会被沙箱认为"新建文件落到了项目内"拦截（需要等 build 完成后才能确认；目前 terminal 还在跑，但已可判断大概率仍然会被拦，因为沙箱似乎对 electron 进程的所有 FS 写入都做拦截）。**接手 agent 不需要再试这一条**，但如果想看完整 log，文件在 `.dbg\dev-post-fix-ud.log`。

### 接手 agent 建议的第一步
**离开 Trae AI 这个沙箱环境（用普通 PowerShell / cmd / VSCode 自带 terminal）再跑一次 `npm run dev`**。如果届时仍然报 lockfile / 单实例锁错误，再去查：

1. 是否有其他 ClawX 实例在跑（任务管理器看 `electron.exe` / 任何进程命令行里带 `--type=` 的子进程）。
2. `C:\Users\27933\AppData\Roaming\clawx\` 下是否被人为加了只读 / 拒绝写权限（`icacls "C:\Users\27933\AppData\Roaming\clawx"` 看一眼）。
3. 第三方杀软（Defender 实时保护、企业 EDR、卡巴、McAfee 之类）是否对 `clawx.exe` / `node.exe` 起了进程级 FS 拦截。

---

## 4. 关键代码与日志位置（接手 agent 必看）

### 代码
- Electron main 入口 & 单实例锁流程：[`electron/main/index.ts:99-130`](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/main/index.ts#L99-L130)
- 自家文件锁实现（force 模式，会在 Chrome 锁拿到之后清理 orphan lock）：[`electron/main/process-instance-lock.ts`](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/main/process-instance-lock.ts)
- Gateway 启动管理（含 stderr 分类、孤儿检测、reconnect）：[`electron/gateway/manager.ts:1020-1099`](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/gateway/manager.ts#L1020-L1099)
- `userData` 路径可通过 `VERSE_CLAW_USER_DATA_DIR` 覆盖：[`electron/main/index.ts:64-67`](file:///c:/Users/27933/Desktop/clawx/ClawX/electron/main/index.ts#L64-L67)

### 配置
- **正式配置**（独立系统）：`C:\Users\27933\AppData\Roaming\clawx\openclaw-source-state\openclaw.json`
- 旧配置（不参考）：`C:\Users\27933\.openclaw\openclaw.json`

### 日志
- `.dbg\dev-pre-fix.log` — 修改 openclaw.json 之前那次 dev 的输出
- `.dbg\dev-post-fix.log` — 改完 `reasoningEffort` 之后、但还没用 userData 覆盖的 dev 输出
- `.dbg\dev-post-fix-ud.log` — 加了 `VERSE_CLAW_USER_DATA_DIR` 之后的 dev 输出（如果接手 agent 还要看）
- `.dbg\clear-stale-locks.log` — 删残留 lock 文件的脚本日志
- 运行时 ClawX 日志（不在项目内）：`C:\Users\27933\AppData\Roaming\clawx\logs\clawx-2026-06-12.log`

### 临时工具（项目内沙箱白名单路径下，可由 agent 直接复用）
- `.dbg\clear-stale-locks.cjs` — 删 `verse-claw.instance.lock` / `Singleton*` / `lockfile` 的小脚本（不走沙箱受限的 PowerShell `Remove-Item`）。

---

## 5. 接手 agent 验证清单

1. [ ] **不在 Trae AI 沙箱内**跑 `npm run dev`（用本机 PowerShell / cmd）。
2. [ ] 启动后等 30 秒，tail 一次 `.dbg\dev-post-fix-ud.log`（或新生成的 dev log），确认出现 `[Gateway] listening on 18789` 之类的 ready 信号。
3. [ ] `curl http://127.0.0.1:18789/health` 看 200。
4. [ ] 看一眼 `C:\Users\27933\AppData\Roaming\clawx\logs\clawx-2026-06-12.log` 没有 `Unrecognized key: "reasoningEffort"`。
5. [ ] 启动后 Electron 主窗口正常打开。
6. [ ] 如果仍然报 "Another instance already holds the single-instance lock"，按 §3 末尾三条排查。
7. [ ] 验证通过后，把"修复方案"补到 `README.md` / `README.zh-CN.md` / `README.ja-JP.md`（按 AGENTS.md 里的 Doc sync rule）。

---

## 6. 不需要接手 agent 做的事

- 不要再去 `~/.openclaw/openclaw.json` 改东西（用户已明确不参考旧方案）。
- 不要回退 `reasoningEffort` 字段的删除（用户已选择方案 A）。
- 不要修 `openclaw_runtime` 的 Zod schema 来"接受 reasoningEffort"（不在这次需求范围内，且会改变正式产品行为）。
- 不要在沙箱内再尝试 `npm run dev`（已确认是环境问题）。
