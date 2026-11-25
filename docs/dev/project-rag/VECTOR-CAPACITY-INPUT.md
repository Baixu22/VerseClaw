# 真实模型容量输入

`pnpm exec tsx scripts/knowledge-rag-vector-capacity.ts <new-output> <portable|ann> <capacity-input.json>` 接受已封存的真实模型向量。省略最后一个参数仍运行明确标注 synthetic 的旧工程探针。正式容量矩阵分别运行本地768维和指定远端4096维的 portable20k / ANN100k；不把向量索引召回等同于语义质量。

输入 schema 为 `ProjectRagCapacityInput/v1`：driven_by=agent、provenance=real-model-output、当前 candidate、corpusDigest、namespaceId、完整 EmbeddingSpace/v1、count、vectors 的 path/digest，以及31个 query 向量。vectors 使用逐行 JSON；每行有 id、source SourceRef/v2、chunkDigest、vector、sourceFile path/digest 和 receipt path/digest/index。查询使用相同结构和独立 query 类型回执。

原 embedding 回执为 `ProjectRagEmbeddingCapture/v1`，保留 completed、candidate、spaceId、providerRef、model、responseId、corpusDigest、kind=query/document 和 outputs；每项 output 绑定 index、sourceDigest、chunkDigest 与实际 vector。这里的 responseId 可用本地实际模型调用的 capture id；来源和输出均须来自对应调用。生成回执本身不运行模型。

读取器流式解析，每行最多1MiB，来源/响应单文件最多4MiB，最多缓存8份；核对完整文件摘要、source范围、模型输出及space，任何替换或截断都会失败。每批最多256行写入索引，31个查询按原阈值比较精确搜索，保持0.98 Recall@20、portable900ms / ANN2500ms P95与重启读回。报告绑定input manifest digest、corpus及完整space，旧synthetic报告保留原标签。

2026-11-26 开发回归使用少量显式agent fixture校验读入器，实际20k/100k和安装包运行按所有者决定暂缓。
