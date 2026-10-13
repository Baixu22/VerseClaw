# L06：热点文件只有一个可验证的写入归属

日期：2026-10-13（Asia/Shanghai）。包码：L06（TF-0288）。真实 provider 调用：无。

## 链路

`agents/hot-file-write-owner.ts` 在既有 `withFileMutationQueue`（per-file，委托 workspace `fileMutation` lease 内核）之上加一层 CAS 式写归属：

- `claimWriteOwner(filePath, owner)`：首 owner 成功；**不同 owner** → 显式 `owned-by-another-owner`（带 holder），并计一次 conflict；**同 owner** 重入幂等（reentrant）。
- `releaseWriteOwner(filePath, token)`：仅匹配 token 才释放；释放后其它 owner 可认领（冲突可恢复）。
- `withVerifiedWriteOwner(filePath, owner, fn)`：经 mutation queue 串行化 + 认领 + `finally` 释放；写抛错也不泄漏归属。

## 实测

| 断言 | 结果 |
|---|---|
| 首 owner 成功；第二 owner 显式 conflict（holder=owner-a） | ✅ |
| 同 owner 重入幂等（reentrant），conflict 计数 0 | ✅ |
| 错 token 不释放；匹配 token 释放；释放后可换 owner | ✅ |
| 并发同文件写串行（start,end,start,end，不交错）；完成后无 active owner | ✅ |
| 写抛错 → claim 回滚，无泄漏 | ✅ |

## 残余（residual）

- claim 是**进程内**协调提示（同 #167 lease 内核）；跨进程/跨 runtime 写入不在本内核范围。
- 本包提供归属内核；把它接到具体热点文件写入点属集成层。
- 不新建第二个调度器/平台；不改默认值/产品锁/approval；非真人证据。
