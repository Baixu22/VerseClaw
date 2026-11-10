# 项目检索 embedding 生命周期

设置 > 模型与服务的“项目检索向量模型”选择只作用于当前项目检索。选择保存在 memory-wiki 的共享 SQLite keyed store，绑定 workspace、逻辑 session 和物理 generation。配置、取消、重试、禁用通过 typed Host API 进入 Wiki Gateway；普通 Chat 不会因此建立整库向量。

本地模式安装固定 revision 的 EmbeddingGemma GGUF，先核对长度与 SHA256，再移动到模型加载路径。下载在独立 staging 中进行；取消或失败清理该 staging。已有完整模型先在本地校验，可以直接重开。安装检查磁盘余量，加载与 warmup 检查 RAM 预算。native 推理放在已有子进程 worker 中，关闭与取消释放 native context、model 和运行时。

本地空间使用实际加载的 768 维 capability；tokenizer 绑定 GGUF 摘要及 native `calculateInputLength` 算法。query 输入为 `task: search result | query: {text}`，document 输入为 `title: {title} | text: {text}`。完整格式化输入一次计数，包含 native BOS/EOS。

远端模式通过已有 embedding provider registry 解析配置 alias、SecretRef 和兼容 HTTP 服务。所有者指定的默认服务为 SiliconFlow，模型 `Qwen/Qwen3-VL-Embedding-8B`，完整请求为 `POST https://api.siliconflow.cn/v1/embeddings`。本地凭据读取 `SILICONFLOW_API_KEY`，文档和状态接口不保存密钥。现有模型 provider 配置优先于环境变量路径。

Qwen VL 的 tokenizer.json、tokenizer_config.json 按固定上游 revision 和摘要安装；客户端计数包含官方文本 chat wrapper。query 与 document 使用版本化的独立格式。服务端不暴露不可变权重 revision 时，空间记录 `provider-unversioned` 及实测 capability fingerprint；它记录已观察到的服务输出身份，无法提供服务商未公开的权重 revision。重新配置或刷新凭据会生成新的 credential generation 并重新 warmup。

`EmbeddingSpace/v1` 的身份同时包含 provider、模型、revision/fingerprint、维度、最大输入、tokenizer 摘要、query/document 格式和 normalization。任何一项变化均产生不同 space。返回条数、索引、维度、有限坐标及非零模长全部检查后才能进入缓存。凭据不进入 space；每个 session 的 256 项易失缓存由 workspace 和 credential generation 隔离。

`EmbeddingJob/v1` 记录当前进程中的有界任务状态；持久化选择支持重启恢复。前台发送只处理已选择且已准入的有限来源。文档调用带 SourceRef pin，缓存命中前和推理返回后都重新执行 owner 读取、权限、版本及 egress 检查。撤销、版本变化、取消和空间变化会丢弃结果。查询调用与文档调用保留独立 input kind。

一次前台检索的 query 和 document 共享 `KNOWLEDGE_EMBEDDING_DEADLINE_MS` 总期限，默认 120 秒；后续调用只使用剩余预算。较慢的推理返回后由 owner 刷新短期读取 context，保留相同 workspace、principal、物理 session 和 policy 身份，再复核来源，避免把授权过期和模型预算混用。

取消状态持久保存在 SQLite；重启保持取消，显式重试才恢复。禁用删除选择并释放 provider。源 owner、memory slot 和 DCS 上下文最终准入继续由各自现有入口持有。
