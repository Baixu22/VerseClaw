# Aider Runtime Contracts

## RepoMap Contract

证据源：`C:\Users\27933\Desktop\verseshell\aider-main\aider\repomap.py`。

`RepoMap` 面向 runtime 的 contract 可以抽象为：

```text
Input:
  chat_files: 当前已经进入对话正文的文件
  other_files: 仓库候选文件
  mentioned_fnames: 用户消息中命中的文件名
  mentioned_idents: 用户消息中命中的代码标识符
  max_map_tokens: repo map token 预算
  force_refresh: 是否忽略缓存

Output:
  repo map string | None

Error:
  cache/parse 失败时尽量降级；没有可用内容或预算关闭时返回 None
```

## ClawX Contract 借鉴

ClawX 的 `AgentMap` 不应暴露为“随便读仓库”的能力，而应暴露成预算化、可解释的上下文 provider：

```text
AgentMapProvider.getContext({
  activeFiles,
  candidateFiles,
  mentionedFiles,
  mentionedSymbols,
  tokenBudget,
  refreshPolicy
}) -> {
  content,
  includedFiles,
  includedSymbols,
  tokenEstimate,
  evidence
}
```

关键是把 `includedFiles/includedSymbols/tokenEstimate` 作为审计证据返回，方便 verifier 判断上下文是否足够，而不是只把文本塞进 prompt。

## 不应照搬

- 不直接照搬 Aider CLI 交互层。
- 不把模型 token counter 绑定到单一模型封装；ClawX 应由 runtime budget service 提供 token 估算。
- 不把最终输出限定为 Markdown；内部结构应保留文件、符号、行号，最后一层再渲染成 prompt 文本。
