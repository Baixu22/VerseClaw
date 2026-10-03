# 五条演示尾项裁定表（TF-0234，2026-09-22）

复核源码 HEAD：`b6c73619189f729c9e87b27210bb6abc21c1cda7`。裁定列只用「仍在 / 已消失 / 不修」；「不修」表示本次收尾保留限制，不表示问题消失。**权威原文与逐项代码坐标在 [journeys/J-03/README.md](journeys/J-03/README.md) 的「五条演示尾项裁定」一节**，本表是给演示用的速查副本。

| 观察 | 裁定 | 一句话依据 |
| --- | --- | --- |
| ① `sessions.history` 与隔离 Runtime 的转写目录不一致 | 不修 | Main 读 `OPENCLAW_CONFIG_DIR` 或 `~/.openclaw`，Runtime 用 `<userData>/openclaw-source-state`；演示用已留档的 `session-history.json` |
| ② 非 fullAccess 执行挂起，无应用内 Runtime 审批入口 | 仍在 | J-04 的 readOnly host `exec.approval.list` 被拦，驱动直连 Gateway 才批准一次；编码任务未完成 |
| ③ 首次配置后 reload 可能被 8 秒保护跳过 | 不修 | `<8000ms` 的 early return 与 Windows 全重启分支仍在；驱动保留显式重启步骤 |
| ④ 创建/启动工作区会写入引导文件并可能 `git init` | 仍在 | J-03 after 清单含 `.git/**`、7 个根目录引导文档与 16 个 Harness 文件；纠正了「git init 已无」的原预判 |
| ⑤ host 切换后界面仍显示默认工作区 / Read only | 不修 | 驱动直接 `hostInvoke`，绕过 renderer store 更新；现有权限绑定存在，单改标签不能修复整份陈旧状态 |

本轮产品源码改动为 **0**。②④进对外说明的限制栏，①③⑤写成限制不修。
