**TF-0681 的终端与进程资源所有权闭环已在干净源码候选 `2dc73c19e8c8aab605a5e992f7d1c1ad5be0d315` 验证。**

终端 PTY 和 VerseShell governed process 共用现有容量 owner 的持久预留，多工作区和独立 runtime 进程不能重复占用已声明预算。已知服务端口启动前原子预留，外部占用拒绝；原生退出后端口仍占用则保留资源。TTY 输入、尺寸、打断、关闭与复用核对 workspace/session/generation。WebPreview 从 Gateway 取得代次，并在生命周期屏障中启动；后续代理启动失败先回收所属 terminal，清理失败保存恢复记录。

原生终态先记录再释放。崩溃遗留 terminal、未派发 reserved 可自动核对；未知派发继续保留并暴露诊断，不按 PID 或 TTL 杀进程或伪造释放。实际未知效果的裁定继续属于既有 RecoveryAuthority。

| 验证 | 结果 |
|---|---|
| 核心、跨进程预留、PTY 真进程树与失败恢复 | 77/77 |
| VerseShell 真进程 deadline/restart/Job/输出及 manager 回归 | 45/45 |
| 既有同目录/路径资源锁 | 11/11 |
| Electron 终端界面与控制归属（typed host mocks） | 2/2 |
| Node/Web/Test 类型、lint、contract、comms、Harness、桌面构建 | 全部退出 0 |

所有产物 driven_by: agent。77/45 两组包含单测替身与实际 native 测试，单项名称与结果保留在JSON中；不把全部样本写成真实模型或真实产品并发。native DLL/executor使用现有正式依赖；独立路径的 ae.exe/Electron exe 与原安装路径哈希一致。原路径启动失败保留在failure-index；依赖与VerseBrowser dist复用，不宣称fresh install或全Runtime构建。

源码、命令和二进制摘要在report.json；产物摘要在manifest.json。执行 `python harness/specs/fixtures/autonomous-project-system/r3/20261109/verify.py` 可回读源码和当前证据。
