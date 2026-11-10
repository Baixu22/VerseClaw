# Project RAG 来源与结构切块合同

`openclaw/plugin-sdk/knowledge-retrieval` 提供 owner 来源标准化、结构切块及引用核对。Wiki 通过公开的 `runtime-api.ts` 暴露 `readMemoryWikiRetrievalChunks` 和 `readMemoryWikiChunkCitation`，读取时沿用既有身份、权限、版本和当前文件复核。

## 来源与字节

`NormalizedSourceDocument/v1` 只接受已准入的 `OwnerReadSnapshot/v1`。正文保持原始 CRLF、BOM 及 UTF-8 字节；行表记录正文字符范围到原始文件字节与行号的映射。frontmatter 不作为可引用正文，原始行号仍从整个文件起算。无正文、无效编码、NUL、超出 owner 的 2 MiB 输入或篡改的映射均报错。

来源记录 owner revision、source digest、policy epoch，以及 file、directory、GitHub 或 Wiki provenance。文件、目录同步和 GitHub blob 入口使用严格 UTF-8 解码；解码失败保持游标，避免把替换字符当作真实来源。新材料沿用 Inbox → Draft → Review → Proposal → explicit apply 的治理路径。

## 切块与检索文本

`KnowledgeChunk/v2` 复用 Markdown 解析包的源码行图，区分标题、段落、列表项、有序步骤、代码围栏、表格与引用块。片段包含父文档、section、顺序、owner SourceRef、raw locator 和正文摘要。chunk ID 绑定 source namespace/subject/version/digest/policy、原始范围及 chunker/tokenizer profile。同输入可以重建相同结果，版本或 tokenizer 变化生成不同身份。

`ChunkerProfile/v1` 目标最多 384 tokens，硬上限 768 tokens / 2400 字符，overlap=0。调用方必须提供绑定 id/digest 的 tokenizer；单测使用明确标注的 agent fixture，实际模型 tokenizer 由 embedding provider 生命周期提供。计数包含标题检索前缀，进入 provider 前仍需按其模型输入上限和实际前缀复核。

超长结构在单元内部按原始行或 Unicode 码点继续切分，保留全部来源字节并避开代理对及 CRLF 中间位置。不能容纳一个码点或标题前缀时明确失败。

`retrievalText` 的标题链、NFKC 和 case folding 与原始 `quote` 分开。search tokens 保留完整 identifier、camelCase 与分隔符拆词，复用 CJK bigram 并覆盖假名和俄文。生成的检索前缀不能进入引用正文。

## 引用复读

`CitationLocator/v2` 绑定 chunkId、chunkDigest、chunker 与完整 owner SourceRef。Wiki owner 按精确 raw byte range 重新读取；revision、source digest、policy、namespace、范围或权限变化均拒绝。校验成功仅返回该 owner 范围的原始正文。撤销、删除和取消不通过旧索引恢复内容。
