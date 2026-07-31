#!/usr/bin/env bash
# 能力4 对抗实测:本地同款 env(execBinary 注入)是否真的禁用仓库 hooks。
# 对照组:默认 env 提交 → hook 触发;实验组:本地注入 env → hook 不触发。
set -u
REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT
cd "$REPO" || exit 1

git init -q .
git config user.email parity@test
git config user.name parity
echo "v0" > f.txt
git add f.txt
git commit -q -m init

# 构造 post-commit hook:触发即写标记文件
mkdir -p .git/hooks
cat > .git/hooks/post-commit <<'EOF'
#!/usr/bin/env bash
echo "HOOK_TRIGGERED $(date +%s%N)" >> "$(git rev-parse --git-dir)/hook-marker"
EOF
chmod +x .git/hooks/post-commit

# ---- 对照组:默认 env ----
echo "v1" > f.txt
git add f.txt
git commit -q -m "control" 2>/dev/null
if [ -f .git/hook-marker ]; then
  echo "CONTROL: hook TRIGGERED (防护缺失时行为)"
else
  echo "CONTROL: hook NOT triggered"
fi
rm -f .git/hook-marker

# ---- 实验组:本地 execBinary 同款 env ----
echo "v2" > f.txt
git add f.txt
GIT_OPTIONAL_LOCKS=0 \
GIT_TERMINAL_PROMPT=0 \
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=core.hooksPath \
GIT_CONFIG_VALUE_0=NUL \
git commit -q -m "hardened" 2>/dev/null
if [ -f .git/hook-marker ]; then
  echo "HARDENED: hook TRIGGERED (防护失效!)"
else
  echo "HARDENED: hook NOT triggered (防护生效)"
fi

# ---- 实验组2:/dev/null 风格(GIT_HOOKS_NULL 在 win 是 NUL;再验证 hooksPath 指向存在的空目录也无效) ----
mkdir -p .empty-hooks
echo "v3" > f.txt
git add f.txt
GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$REPO/.empty-hooks" \
git commit -q -m "hardened2" 2>/dev/null
if [ -f .git/hook-marker ]; then
  echo "HARDENED2: hook TRIGGERED (防护失效!)"
else
  echo "HARDENED2: hook NOT triggered (防护生效)"
fi
