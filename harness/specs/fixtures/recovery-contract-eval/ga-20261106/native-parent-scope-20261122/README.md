# G3 原生父目录扫描开发验收

源码候选 `70ad6cd609e68cfd8ff5c7455cd7dfb24b60de82`，基准 `46a96b8d0e69e39c692511cf50e061469170919b`。

原生包根遍历同时保留可信 OpenClaw 根与最近已观察到的包根。
父目录归属使用同一次扫描的结果：bundled 插件使用规范化的插件目录，外部插件保留自己的最近包根。
模块路径规范化顺序、十二层上限、name/bin 优先、畸形/不可读清单和后续调用刷新均保持。
重复最近包扫描及其包装函数已删除，生产代码净减13行。

定向回归及三个已提交 Git blob 的独立目录回放均为 **28/28**，Node 内置模块。
五组内存FS对照中根、读取和规范化相同；探测 **24→12、15→12、9→6、9→6**，bundled 控制 **4→4**。
定向 Oxfmt/Oxlint、两份 Harness validate 通过，DeepSeek 复核 **0 发现**。
严格 tsgo 类型探针通过：检查提取的生产根函数和父目录选择函数，使用窄 Node API 声明与 ES2024 库。
三语 README 的现有检查条目已经覆盖包根与父目录边界。

所有验证串行，CPU上限10%。Node 堆64MiB/Job128MiB。
Git 写提交拆为临时索引、生成树、写提交和带旧值校验的分支更新；逐一执行，Job128MiB，三次空闲至少1GiB，运行低于768MiB停止。
生成的树仅包含本批五个路径，真实暂存区字节保留，写提交峰值43.93MiB。
类型探针峰值56.40MiB，Node回归约42MiB，复核121.48MiB。

`report.json` 记录候选、命令和资源，`verification.json` 记录绑定，
`raw-evidence.json.gz` 保存 118 份原始输入输出，每份可解码后逐 SHA256 核对。
`SHA256SUMS` 列出的文本按 CRLF→LF 归一化，gzip 按精确字节；清单本身遵守仓库 -text，保留 Git 原始字节。
证据为 `driven_by: agent`、`actor: codex/g3-low-cost-r17`、`realHumanEvidence: false`。

G3 GA 为 **NO_GO**，此候选完整项目类型、构建、冻结恢复矩阵及包验收待完成。
