# G3 原生别名清理开发验收

源码候选 `2250a2e8cccba3272042c868bf5287cdcf537190`，基准 `a92310ec5e320a0c79710ff2c4d4ef48d924deef`。

清理原生插件别名时先检查目标归属，无关条目保留原数组；匹配条目仍删除目标根、保留剩余顺序并清除空项。
该判断增加3行生产代码，避免复制和写回其他owner的别名数组。

回归由36通过/3失败到 **39/39**；六个已提交Git blob的独立目录回放同为 **39/39**，使用Node内置模块。
五组对照的条目和CJS/ESM解析相同：128个无关别名复制/写回 **128→0**；8个目标条目复制 **128→8**。
空根和全归属控制保持原处理，重复清理不改动剩余条目。
定向Oxfmt/Oxlint、两份真实diff Harness validate、严格生产函数类型探针通过，DeepSeek复核 **0发现**。
类型探针检查实际NativeAliasEntry、注册与清理函数，使用ES2024类型；三语README现有tiny检查条目覆盖本次行为。

所有步骤串行，CPU10%、BelowNormal、Node堆64MiB/Job128MiB。复核单Tokio工作线程，私有内存峰值117.07MiB；源码Git分片峰值43.96MiB，原暂存区字节保留。
`report.json` 和 `verification.json` 记录绑定，`raw-evidence.json.gz` 保留 149 份原始输入输出，可逐份base64解码并核对SHA256。
文本校验归一化CRLF→LF，gzip和SHA256SUMS遵守Git原始字节。所有证据为agent驱动，realHumanEvidence为false。

G3 GA **NO_GO**。同候选完整项目类型、构建、冻结恢复/live-provider/legacy及包验收待后续资源窗口执行。
