# FP-P1-06 evidence — 脱敏 support bundle 导出

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| E2E | `tests/e2e/support-bundle-fp-p1-06.spec.ts` **1 passed (20.8s)**（真 Electron + 真 gateway child + 真 UI 按钮） |
| 单测 | `tests/unit/support-bundle-redaction.test.ts` **7 passed** |
| git diff --check（本任务文件） | 干净 |

## E2E 原始输出

```
[fp-p1-06-ui]     Saved to ...\support-bundles\verse-claw-support-2026-07-27T07-24-20-026Z.json
                  · redaction hits: 5
[fp-p1-06-export] {"success":true,
                   "path":"...\support-bundles\verse-claw-support-2026-07-27T07-24-20-177Z.json",
                   "redaction":{"findings":[{"type":"windows-user-path","hits":5}],
                                "totalHits":5,"verified":true}}
1 passed (20.8s)
```

## 「自己写断言证明 bundle 里搜不到 secret」（任务书明确要求）

E2E 种了**两个**真实泄漏向量再导出，然后对导出文件的**原始文本**做否定断言：

| 向量 | 种法 | 断言 |
|---|---|---|
| 安全存储里的 provider API key | `providers.createAccount` 带 `apiKey: 'sk-realfakekey0987654321abcdef'` | `expect(raw).not.toContain(PLANTED_STORED_KEY)` |
| 用户可控字段里的 key 形状串 | 账号 label = `Leaky label sk-plantedfakekey1234567890abcd` | `expect(raw).not.toContain(PLANTED_LABEL_KEY)` |
| gateway token | —（不应出现） | `expect(raw).not.toContain('gatewayToken')` |

两条 key 断言的性质不同，都必要：
- **存储 key**：`hasKey:true` 但值从未进 bundle（`buildSupportBundle` 只写 `vendorId/authMode/enabled/hasKey/validation`，
  从不取 key 材料）—— 这是**结构性不泄漏**
- **label 里的 key 形状串**：值确实进了 bundle，靠 redaction 正则抹掉 —— 这是**脱敏真生效**

第二条是真正在考验 redaction 的那条。

## Provider 类型与验证状态在、key 不在（AC）

```
expect(planted?.hasKey).toBe(true);                                  // 类型/持有状态可见
expect((planted?.validation as {status?:string})?.status).toBe('valid');  // 验证状态可见
expect(raw).not.toContain(PLANTED_STORED_KEY);                       // key 不可见
```

## redaction 检查结果本身是 bundle 的一部分（AC）

```
expect(report.verified).toBe(true);
expect(report.totalHits ?? 0).toBeGreaterThan(0);
for (const finding of report.findings ?? []) {
  expect(Object.keys(finding).sort()).toEqual(['hits','type']);   // 只有类型与计数，绝无命中值
}
```

本轮实测 `totalHits:5`，全部为 `windows-user-path`（用户名打码）。

**硬锁实现**：`support-bundle.ts:264-271` —— `verifyRedaction` 在脱敏后重扫，
任一模式仍命中即 `success:false` 整体导出失败，不存在「尽力脱敏」的中间态。

## child counters 镜像进 bundle（AC，非主进程视角）

```
expect(mirror.available).toBe(true);
expect(typeof mirror.childPid).toBe('number');       // 真 child pid
expect(mirror.injectionBudget?.counters).toBeDefined();
expect(mirror.effectiveFlags).toBeDefined();
```

`collectRuntimeMirror`（`support-bundle.ts:116-137`）走 `gatewayManager.rpc('runtime.flags.ack')`，
取的是**子进程自报**的 effectiveFlags / configSource / injectionBudget，不是主进程存的控制面值。
bundle 里同时保留 `settings.dcsFlags`（保存值），两者可对账。

## 反向注入证明守卫非空转

把 `openai-style-key` 正则改为永不匹配 → **3 failed**：

```
× a planted fake API key CANNOT be found in the sanitized output
× reports per-pattern hit counts without the hit values
× verifyRedaction flags text that still contains secrets (export must fail)
```

已复原，复原后 7 passed。

## 不自动上传（硬锁）

`exportSupportBundle` 只写本地 `userData/support-bundles/` 并返回路径，全文无网络调用。

## 门禁判定

- G1 dev：导出需用户显式点击；脱敏失败即导出失败（无中间态）；无自动上传；diff --check 干净。
- G2 test：7 单测 + 1 条真 Electron E2E；**假密钥不外泄用例存在且经反向注入证明非空转**。
- G3 runtime：bundle 内 `runtimeMirror.childPid` 为真 child pid，counters/flags 均为子进程自报。
- G4 human：n/a（诊断产物导出，无真人观感要求）。
- G5 accept：self-accept；AC 逐条有指针；残留转出。
