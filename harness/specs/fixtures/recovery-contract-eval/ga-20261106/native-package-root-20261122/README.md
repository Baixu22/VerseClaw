# G3 原生包根扫描开发验收

源码候选 `190fa88c4c77fb9506809fd6a88fc909da162eea`，基准 `970e9ca32bc1c1d28ff0bb2cbb17a4c3122542c0`。

原生 loader 在最多十二层的扫描中保存最近已观察到的包清单目录。
可信 OpenClaw 名称或可执行项优先；扫描结束直接使用已有最近根或模块目录。
普通包、畸形和不可读清单、后续调用的新清单，以及 bundled/外部父目录边界均有回归覆盖。

定向回归与三个已提交 Git blob 的独立目录回放均为 **23/23**，只需 Node 内置模块。
五个内存文件系统 fixture 的根和清单读取结果相同；无清单路径探测 **24→12**，
普通包和畸形清单回退 **13→12**，可信父包 **3→3**。
Oxfmt、定向 Oxlint、两份 Harness validate 通过；DeepSeek 首轮建议补祖先普通包用例，补齐后复核 **0 发现**。

所有步骤串行运行，CPU 上限 10%。Node 检查堆 64 MiB，Job 私有提交上限 128 MiB。
Git 写提交单独限为一个进程、192 MiB，三次空闲采样至少 2 GiB，运行低于 1.5 GiB 即停止。
首轮限额、准入及提交失败回执均保留；本轮失败产生的 index.lock 已核对原进程退出并原样归档。

`report.json` 记录命令、候选与资源，`verification.json` 记录绑定，
`raw-evidence.json.gz` 保存 165 份原始输入输出，每份可解码后按 SHA256 核对。
较大的锁文件在原 D: 目录保留，压缩包内记录它的路径、字节数和 SHA256。
`SHA256SUMS` 的文本按 CRLF→LF 归一化，gzip 按精确二进制字节校验。
证据标注 `driven_by: agent`、`actor: codex/g3-low-cost-r16`、`realHumanEvidence: false`。

G3 GA 为 **NO_GO**；此候选完整类型、构建、冻结恢复矩阵及包验收待完成。
