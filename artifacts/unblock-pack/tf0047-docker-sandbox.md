# TF-0047 证据包（GitHub #22 Docker sandbox 基础镜像入口）

生成于 2026-09-09。本包只记录本机实测，不把节点标 done。

## AC 对照

| AC | 要求 | 本机结果 | 证据 |
|---|---|---|---|
| 0 | `scripts/docker/sandbox/Dockerfile` 存在且两个 setup 入口都能解析到它 | **PASS** | 实际路径 `openclaw_runtime/scripts/docker/sandbox/Dockerfile`。`openclaw_runtime/scripts/sandbox-setup.sh` 与 `openclaw_runtime/scripts/docker/setup.sh` 均引用 `scripts/docker/sandbox/Dockerfile`。`tests/unit/sandbox-dockerfile-contract.test.ts` 1/1 绿 |
| 1 | 基础镜像固定 digest，含 python3、ripgrep、非 root sandbox 用户 | **PASS** | Dockerfile `FROM debian:bookworm-slim@sha256:f9c6a2fd2ddbc23e336b6257a5245e31f996953ef06cd13a59fa0a1df2d5c252`；`apt-get install ... python3 ripgrep`；`useradd ... sandbox` + `USER sandbox` + `WORKDIR /home/sandbox` |
| 2 | 在 Docker daemon 可用环境运行 `scripts/sandbox-setup.sh` 构建成功 | **FAIL（环境硬缺）** | `docker` 不在 PATH；PowerShell 报「无法将 docker 项识别为 cmdlet」。`bash -n` 对两个 setup 脚本语法 **PASS**，但不能代替构建 |

## 结论

静态契约 2/3 已绿。AC2 被本机无 Docker daemon 卡住。解锁动作：安装 Docker Desktop / 引擎后跑：

```bash
bash openclaw_runtime/scripts/sandbox-setup.sh
```

期望输出 `Built openclaw-sandbox:bookworm-slim`。不要用静态测试冒充构建成功。
