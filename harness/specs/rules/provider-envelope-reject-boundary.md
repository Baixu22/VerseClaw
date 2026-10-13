---
id: provider-envelope-reject-boundary
title: Provider 请求信封可拒绝边界（opt-in / 拒绝前不发送）
---

# Provider 请求信封可拒绝边界

- **默认观察，opt-in 才拒绝**：信封守卫默认只观察、不改变字节；只有显式开启（`rejectInvalidEnvelope` 或 `OPENCLAW_RC02_REJECT_INVALID_ENVELOPE`）才拒绝。
- **拒绝先于 wire**：非法/未知信封的拒绝必须发生在任何 provider 字节发送之前；拒绝时该请求的 fetch 调用数必须为 0。
- **digest-only**：拒绝依据与记录只允许 digest/ref/相关性摘要，绝不落原始 prompt/正文/认证头。
- **不接管网络策略**：SSRF、超时、代理、重定向与出站预算规则独立，本边界不得放松或替代它们。
- **可逆**：关闭开关即恢复原观察语义；不得改变产品默认值、产品锁或 approval 语义。
- **可验证**：必须有测试证明「开启+非法→0 字节发送且 typed 拒绝」与「关闭→请求仍然发出」。
