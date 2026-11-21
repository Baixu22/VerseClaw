# VerseGit 原生验收输入重冻结

当前资源清单采用已批准的 A 产物 `20a7ce8062e2f65489aad806d28e3e751977bbe013cba5872c77629aafdba7ef`，大小 41,011,712 bytes，版本 `vg 0.1.0`。

两份独立构建使用源码 `89af0c36216e64bb0f7430fc3fe21c39c485be7c`、固定 Cargo.lock、rustc/cargo 1.98.1 和原 remap/Brepro 配方。A/B 每根 6,749 个文件均与固定源码归档一致。

B 产物摘要为 `21a7c9f45ab3b53fee5d15ba4da76edb21192feeabb89d9bbf27e1d78a2e62f5`。两份产物的版本与能力相同，PE 摘要不同；清单记录实际构建摘要并选择 A 作为交付输入。

当前包、历史清单拒绝新字节及五项负向检查共 7 项通过。授权、源码复验、构建来源、包清单和验证结果均保存在本目录，由 SHA256SUMS 覆盖。原 25 门禁与四条 requiredTests 继续使用原命令、断言、时限和跳过预算。
