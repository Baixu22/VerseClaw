# TF-0672 原关闭候选的 owner 边界反例

对提交 80c0fd41f 的原始 API/service/utils 字节做隔离回放。只重定向 config root 到临时目录，没有修改生产函数；不创建任何 runtime、verifier、effect 或 artifact。调用者自填一致摘要和不存在的 generation，API 仍返回 accepted=true 且任务为 done。期待拒绝的断言因此真实失败（exit 1，0 passed / 1 failed）。

这推翻原 A3 的可信来源与缺 artifact 负例验收。它不否认已存在的类型、投影或单元测试；保留原关闭候选与全部历史证据。reproduction.json 保留实际准备脚本、测试、命令和原始报告定位；source-manifest.json 保留准确源码哈希。所有操作 driven_by: agent，无真人证据。
