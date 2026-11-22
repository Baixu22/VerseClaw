# G3 插件加载配置开发验收

源码候选 `eb63f45e9207459460b5ab49418739e134308881`，基准 `3b8339c9164031e50bc003fba93023c24b4eb540`。

加载器直接使用调用方的别名表，缺省 native 模式仍使用原策略；未提供别名表继续复用默认 SDK 配置。
内容键、文件名与 scope 优先级、source loader 身份及缓存命中重装别名保持。生产代码净减3行。

定向回归及六个已提交 Git blob 的独立目录回放均为 **35/35**，依赖为 Node 内置模块。
11组确定性配置和缓存键对照相同；8组显式别名默认准备与默认别名构建 **1→0**，3组控制 **1→1**。
ESM投影使用生产 SDK import 段与实际导出函数；缺失导出和缺失导入两种控制分别由链接与调用拒绝。
定向Oxfmt/Oxlint、两份真实diff Harness validate、严格生产函数类型探针通过，DeepSeek复核 **0发现**。
函数类型探针使用当前 loader、默认配置、native策略、内容键及Windows导入路径函数、窄依赖声明和ES2024库。

验证与提交串行，CPU10%、BelowNormal、Node堆64MiB/Job128MiB。
Git提交使用独立临时索引、逐项生成树及带旧值校验的分支更新，真实暂存区字节保留。
资源不足的准入回执、被压力停止的复核、首轮复核建议及后续修复输入都在原件中保留。

`report.json` 记录候选与验证，`verification.json` 记录绑定，`raw-evidence.json.gz` 保存 249 份原件，逐份base64解码后可核对SHA256。
`SHA256SUMS` 的文本按CRLF→LF归一化，gzip按精确字节；清单自身保留Git原始字节。
证据为 `driven_by: agent`、`actor: codex/g3-low-cost-r18`、`realHumanEvidence: false`。

G3 GA **NO_GO**；此候选完整项目类型、运行时/桌面构建、冻结恢复矩阵、live-provider及包验收待完成。
