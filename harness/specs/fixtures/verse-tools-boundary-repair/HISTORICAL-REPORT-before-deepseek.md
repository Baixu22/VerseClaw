# VB / VG / VS 修复与当前验收

日期：2026-11-05，Asia/Shanghai。全部交互和证据由 agent 驱动。

代码修复及本轮 Windows 运行验收已通过；最终独立源码审查因配置的模型代理返回 HTTP 405 未完成。本报告不宣称完整收口、发布或产品默认值毕业。

## 修复内容

- VB Gateway 只允许当前可用的模型动作；拒绝模型自报批准和模式升级，强制会话 owner，匿名状态不泄露会话。
- 空或未知 capability 集合保持仅发现能力；所有受管页面、重定向和子资源执行 Host 私网约束及固定 DNS 目的地址策略。
- IPv4-translatable IPv6 保留嵌入 IPv4 的私网分类；代理/窗口创建失败撤销已登记 owner 和批准；系统关闭活动附加 tab 后恢复存活页面。
- N8/N9 隔离 home、配置、临时目录和 Playwright 产物；使用自动调试端口；失败时仍记录并回收；只终止本次观察到的所属进程，保留 SIGKILL 回执。
- VB 使用固定上游提交验证补丁；当前证据检查 HEAD、暂存区、工作区和新增文件。VG 文档校验遵循当前模块声明并要求完整命令结果。

## 读盘确认的结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 宿主定向单测 | 156 passed，0 failed，0 skipped | focused-unit-current.json |
| 浏览器模块单测 | 44 passed，0 failed，0 skipped | browser-unit-current.json |
| Runtime provenance | 24 passed，0 failed，0 skipped | runtime-provenance-current.json |
| 真实 Electron E2E | 1 passed，0 skipped；含 IPv6 拒绝、私网 fetch/image/iframe/redirect、WebSocket 与 native tab close | vb-e2e.json / host-invocation.json |
| 全量 typecheck | node/web/test 全部通过，cache disabled | typecheck.json |
| 定向 lint / Harness / comms | 通过；未代替全仓库综合门禁 | 原始日志及 VG commands |
| N8 安装包 | 10/10 检查通过，进程与目录回收确认 | ../versebrowser-invocation-maturity/current-20261104/n8-result.json |
| N9 安装包 | 46/46 轮通过：10 冷启动、30 闭环、3 中断 + 3 恢复；零残留，46/46 目录回收 | ../versebrowser-invocation-maturity/current-20261104/n9-result.json |
| VG strict | 9 criteria / 15 groups / 66 files，P0=0/P1=0/P2=6 | ../versegit-product-integration/f5-current-20261104/ |

## 候选与限制

- 运行候选：38e0d720970fdc26c5c594161c5f776532fd9423；安装包来源：24d42fc98e790ede0fbfddadd64ff3e81b4b2e34。后续差异只有控制脚本，产品输入未变；N8/N9 在运行前后读取实际包 digest。
- N9 闭环 p50=7589ms，p95=7759ms；这些是本机含启动/回收的本批次观测，不是通用性能承诺。
- VG M4 仍未授权，VS default-off 未改变；未发布、未推送。macOS/Linux、真实外部模型质量不在本轮已测范围。
- 全仓库 harness:ci 仍有无关 Agent Dev 证据超过 24 小时窗口的问题；不宣称全仓库全绿。
- 外部 VerseShell MCP 连接器未获本轮通过声明；项目内 VS binary/manifest 与 VG→VS 路径的证据单独保留。
- 最终独立源码审查未完成，见 source-review-status.json。原审查的已知发现已修复和定向验证，不等于获得新的独立审查通过。
- 主工作区存在其他会话的未提交变更，修复留在 codex/verse-tools-boundaries-20261104。合并预案保留主线更完整的 scripts/rsi-sekb-arms.d.mts 声明，补丁对当时主工作区的 git apply --check 已通过；预案尚未应用，见 merge-plan.json。

历史失败单独留存，不与本次 pass 混算。manifest 覆盖本目录的全部留存文件。
