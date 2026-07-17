# ClawX / Verse Claw B1–B8 重新审计清单

勾选表示“已审计并有明确结论”，不表示安全通过。

## B0 证据基础设施
- [x] HEAD、dirty patch、L2/L3 文件 hash
- [x] 动态命令/退出码/结论写回 manifest

## B1 P0 安全边界
- [x] CSP/Markdown/HTML：主 Renderer 无 CSP；HtmlPreview 危险 sandbox；Markdown 未见 raw HTML
- [x] WebView：未见 will-attach/permission handlers；frame policy 被放宽
- [x] IPC：无 sender/session binding；payload 仅外壳校验；错误 message 原样返回
- [x] Files：任意读与双实现已核对；junction 写逃逸 L4 已证
- [x] Secrets：Provider/Channel/Gateway/OAuth/MCP env 明文与 Browser vault 双轨已核对
- [x] openExternal 调用点与协议双真相已核对
- [x] Browser javascript/data L4 已证
- [ ] Renderer compromise→Host end-to-end 未运行

## B2 权限与隔离
- [x] acceptEdits、Role path、Terminal session authorization、sandbox downgrade 已核对
- [x] Approval 顺序消费回归通过；并发 replay L4 已证
- [ ] Docker/SSH backend 故障注入与 high-risk fail-closed 未运行

## B3 SEKB/Memory/DCS
- [x] flags、raw steps/details、redaction 缺口、confirm→DCS 脱节已核对
- [x] session delete 不级联 SEKB/Memory/DCS
- [ ] canary 落库/检索/删除 L4 未运行

## B4 Gateway/Browser/MCP/Channels
- [x] Gateway token/device challenge 与 workspace approval gate
- [x] Origin/CORS/RPC rate limit/first-response 的具体缺口已记录
- [x] Browser 主 session allowlist 与 multi-tab blacklist 双实现
- [x] MCP env 明文返回 Renderer；安全 policy 未投影 runtime
- [x] Feishu/WeCom 默认 open/*
- [ ] MCP Prompt Injection、webhook signature、multi-window race 未运行

## B5 Supply chain
- [x] stable SignPath 与 alpha/beta skip signing
- [x] updater 调用存在但 feed 注入未证明
- [x] 仅 asar；未见 fuses/ASAR integrity/SBOM/provenance
- [x] bundled downloads 与 CI installer 无内容固定
- [ ] pnpm audit --prod --json：工具审批后端 404，未运行，不能记为通过
- [ ] update tamper/签名产物 L4 未运行

## B6 Reliability/DoS
- [x] 日志无轮转且失败静默
- [x] config mutex 仅同进程；部分关键写仍非原子
- [x] Cron active Set 仅进程级，跨进程 claim 未证明
- [ ] disk-full、cron multi-process、config crash recovery 未运行

## B7 Privacy
- [x] 未见常见分析 SDK；不等于无第三方模型/OAuth/MCP/更新数据流
- [x] deletion residue 已核对
- [ ] clipboard/screenshot/desktop automation permission/retention/audit 未完成

## B8 L4
- [x] existing targeted suite：8 files / 82 tests，exit 0
- [x] Browser javascript/data：exit 0
- [x] junction write escape：exit 0
- [x] approval concurrent replay：exit 0
- [ ] Renderer compromise、Prompt Injection、SEKB canary、sandbox fail-closed、Cron corruption、update tamper、multi-window race：未运行；不得声称通过
