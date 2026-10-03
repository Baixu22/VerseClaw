# 离线核对说明（VERIFY.md）

本页的每一步都只需要本仓库，**不需要网络、不需要 provider key、不需要 Electron、不需要任何凭证**。任何一步不符，就照实记录差异；不要把差异解释成通过。

## 1. 一条命令核对全部（推荐）

在仓库根目录执行：

```powershell
node scripts/build-showcase-package.mjs --verify
```

期望输出（数字随包内文件数变化）：

```text
verify OK: <N> files match manifest.json; journey counts asserted; <M> scanned; 0 credential hits
```

这一条命令做四件事：重算 `manifest.json` 里每个文件的 sha256 与字节数、检查包内没有多余或缺失文件、重跑凭证扫描、重读并断言下面第 3 节的每个计数。任一不符即 exit 1 并逐条打印原因。

## 2. 不用本仓脚本，手工重算哈希

PowerShell：

```powershell
$root = 'artifacts/showcase-20260922'
$m = Get-Content "$root/manifest.json" -Raw | ConvertFrom-Json
$bad = $m.files.PSObject.Properties | Where-Object {
  (Get-FileHash -Algorithm SHA256 (Join-Path $root $_.Name)).Hash.ToLower() -ne $_.Value.sha256
}
if ($bad) { "MISMATCH: " + ($bad.Name -join ', ') } else { "manifest OK: $($m.fileCount) files" }
```

Python 3：

```python
import hashlib, json, os
root = 'artifacts/showcase-20260922'
m = json.load(open(os.path.join(root, 'manifest.json'), encoding='utf-8'))
bad = [p for p, v in m['files'].items()
       if hashlib.sha256(open(os.path.join(root, p), 'rb').read()).hexdigest() != v['sha256']]
print('manifest OK: %d files' % m['fileCount'] if not bad else 'MISMATCH: %s' % bad)
```

## 3. 计数核对（直读 JSON，不采信任何命令打印）

| 文件 | 路径 | 期望值 |
| --- | --- | --- |
| `journeys/J-02/journey.json` | `workspace.before.tests.exitCode` / `workspace.after.tests.exitCode` | 1 / 0 |
| `journeys/J-02/journey.json` | `receipts.runtime_receipts` | 0（J-02 未开收据开关） |
| `journeys/J-02/journey.json` | `candidate.dirty` | true（J-02 记录的是当时的候选状态，不是洁净候选） |
| `journeys/J-02/calc.js.after` | 文件 sha256 | 等于 `workspace.after.files["calc.js"].sha256` |
| `journeys/J-03/journey.json` | `receipts.runtime_receipts` | 28 |
| `journeys/J-03/journey.json` | `receipts.byKind` 中 kind=context version=1 / kind=wire version=1 | 各 7 |
| `journeys/J-03/journey.json` | `candidate.commit` / `candidate.dirty` | `b6c73619189f729c9e87b27210bb6abc21c1cda7` / false |
| `journeys/J-03/receipt-join.json` | `v1ContextWirePairs` | 7 |
| `journeys/J-04/journey.json` | `stopReason` / `boundaryProven` / `finished` | `approval-boundary-observed` / true / false |
| `journeys/J-04/journey.json` | `approvalBoundary.permissionMode` | `readOnly` |
| `journeys/J-04/journey.json` | `approvalBoundary.hostGate.response.data.blocked` / `.error` | true / `Read-only mode does not allow Gateway mutations` |
| `journeys/J-04/journey.json` | `approvalBoundary.continued`；`approvalBoundary.continuation.timestamp` 晚于 `approvalBoundary.runtimeResolve.at` | true；决定后才继续 |
| `journeys/J-04/gateway-events.jsonl` | 帧数 / `exec.approval.requested` / `exec.approval.resolved` | 32 / 2 / 1 |
| `journeys/J-04/journey.json` | `candidate.dirty` | false |

`finished=false` 是 J-04 的**预期**结果：readOnly 工作区不允许写入，编码任务本来就不该完成；J-04 的判据是审批边界发生一次。

## 4. 凭证扫描

结果记录在 `credential-scan.json`（模式、覆盖文件数、命中数）。要重新扫描：

```powershell
node scripts/build-showcase-package.mjs --verify
```

命中数必须为 0。扫描覆盖包内除 `manifest.json` 与 `credential-scan.json` 之外的全部文件（含 PNG 的原始字节）。

## 5. 本包**不**验证的事

- provider（senseaudio）当前是否可用——需要网络与 key，不在离线范围。
- Electron / 构建产物能否再跑一遍旅程——需要 `build:vite`、`build:runtime` 与 Electron。
- 任何真人证据：三条旅程都是 agent-driven，不是具名真人操作。

## 6. 失败分支

任一哈希不符、任一计数不符、扫描非 0 命中：记录实际值并停在 `docs/dev/qa-synthesis-roadmap-20260922.md` 的「更新记录」里，不要用口头说明替代。
