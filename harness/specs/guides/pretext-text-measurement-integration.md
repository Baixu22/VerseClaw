---
id: pretext-text-measurement-integration
title: Pretext Text Measurement Integration
type: guide
appliesTo:
  - all
---

# Pretext 文本测量集成

## 概述

在 ClawX Chat 中引入 [@chenglou/pretext](https://github.com/chenglou/pretext) 的两阶段文本测量引擎，
以类 canvas 的免 DOM reflow 方式替代当前依赖 scrollHeight / contentVisibility 固定估算的自动高度和气泡高度方案。

## 目标

1. **ChatInput textarea 自动高度**：用 prepare(text, font) + layout(prepared, width, lineHeight) 替代
   	extareaRef.current.scrollHeight，避免每次输入变化时触发同步 reflow。
2. **消息行高估算**：为 contentVisibility: 'auto' 的 containIntrinsicSize 提供精确高度代替固定 200px 估算，
   减少浏览器在滚动虚拟化时的大幅度布局回卷。

## 架构

### 重复准备的消除

- 在 useMemo 内调用 prepare(text, font)，font 字符串从 CSS 变量或 Tailwind class 解析（如 '14px Inter'）。
- 同一个 text + font 组合只 prepare 一次；resize 事件只重新 layout()。
- 用户切换字体偏好时通过 clearCache() 释放旧缓存。
- 准备一个 usePretextMeasure(font) hook，返回 (text, width) => height 闭包。

### ChatInput 改造

当前代码（简化）：

`	s
useEffect(() => {
  if (textareaRef.current) {
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = ${Math.min(textareaRef.current.scrollHeight, 240)}px;
  }
}, [text]);
`

目标：

`	s
const measureHeight = usePretextMeasure('14px Inter', { whiteSpace: 'pre-wrap' });
useEffect(() => {
  const containerWidth = textareaRef.current?.clientWidth ?? 400;
  const { height } = measureHeight(text, containerWidth - 32, 20);
  textareaRef.current.style.height = ${Math.min(height + 16 /* padding */, 240)}px;
}, [text, measureHeight]);
`

### 消息气泡行高估算

当前：

`	sx
<div style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }} />
`

目标：用 pretext 预计算每段气泡的精确高度，动态填入 containIntrinsicSize：

`	sx
const containerWidth = messageContainerRef.current?.clientWidth ?? 640;
const font = '14px Inter';
const prepared = useMemo(() => prepare(text, font), [text]);
// 写在 useLayoutEffect 里而不是 render 中
const intrinsicSize = useMemo(() => {
  const { height, lineCount } = layout(prepared, containerWidth, 22);
  return uto px;
}, [prepared, containerWidth]);
<div style={{ contentVisibility: 'auto', containIntrinsicSize: intrinsicSize }} />
`

## 风险

- 需要浏览器 canvas 2D + Intl.Segmenter，但 ClawX 本身就是 Electron Chromium 环境，不缺。
- system-ui 字体在 macOS 上不准确；我们的 ChatMessage 使用 Tailwind prose prose-sm，实际是 Inter, ui-sans-serif 等已命名字体，不会有问题。

## 检查清单

- [ ] 安装 @chenglou/pretext 到 deps
- [ ] 实现 usePretextMeasure hook
- [ ] ChatInput 自动高度改用该 hook
- [ ] 消息列表 containIntrinsicSize 动态计算
- [ ] typecheck + 单测覆盖 textarea 高度变化
