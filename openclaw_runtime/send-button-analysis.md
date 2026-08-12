# 发送按钮状态分析与设计方案对比

## 当前实现分析（基于 ChatInput.tsx）

### 当前状态定义

根据代码 `src/pages/Chat/ChatInput.tsx` 第 2057-2062 行：

```typescript
const canSend = (input.trim() || attachments.length > 0 || selectedKnowledgeRefs.length > 0) 
  && allReady && !inputDisabled && !sending && !capabilityExecuting;

const canStop = sending && !inputDisabled && !!onStop;

const canIntervene = sending && hasComposerDraft && allReady && !inputDisabled 
  && !hasFailedAttachments && !capabilityExecuting && longTaskAvailable;
```

### 当前按钮行为（第 2775-2785 行）

```typescript
const handlePrimaryComposerAction = useCallback(() => {
  if (sending) {
    if (canIntervene) {
      void handleInterventionSend('queue');  // 默认排队
      return;
    }
    handleStop();  // 强制停止
    return;
  }
  void handleSend();  // 发送
}, [canIntervene, handleInterventionSend, handleSend, handleStop, sending]);
```

### 当前快捷键（第 2787-2798 行）

```typescript
if (sending && e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
  e.preventDefault();
  if (!canIntervene) return;
  void handleInterventionSend(e.shiftKey ? 'interrupt' : 'guide');
  // Shift+Enter = interrupt（强制截停）
  // Ctrl+Enter / Cmd+Enter = guide（引导）
  return;
}
```

### 当前按钮视觉（第 4066-4070 行）

```typescript
{sending && !canIntervene ? (
  <Square className="h-3.5 w-3.5" fill="currentColor" />  // 停止按钮
) : (
  <SendHorizontal className="h-4 w-4" strokeWidth={2} />  // 发送按钮
)}
```

### 当前 Tooltip（第 4064, 4075 行）

```typescript
aria-label={sending && canIntervene ? t('composer.intervention.queue') 
  : sending ? t('composer.stop') 
  : t('composer.send')}
```

---

## 你提出的新设计方案

### 改进目标

1. **简化交互**：去掉三种发送状态（强制截停、引导、queue）的复杂性
2. **默认行为更安全**：默认改为 queue（排队），避免意外中断
3. **快捷键优化**：Ctrl+Enter 触发引导（interruption/guidance）
4. **状态反馈优化**：会话运行时输入内容后，按钮变为发送按钮，悬停显示 tooltip 提示快捷键

### 新状态映射

#### 五种会话状态（基于你提供的图片）

1. **无消息状态**（针对性无消息）- 灰色圆形向上箭头
2. **有消息状态**（有消息待发）- 白色圆形向上箭头
3. **消息刚发出**（系统整体热启动）- 灰色圆形刷新图标
4. **会话正在运行** - 黑色圆形播放三角
5. **会话临时暂停**（保存状态后可恢复）- 灰色圆形向上箭头

#### 新的发送行为

| 状态 | 按钮图标 | 默认点击行为 | Ctrl+Enter 行为 | Tooltip |
|------|---------|-------------|----------------|---------|
| 无消息 | ↑ (灰色) | 禁用 | - | - |
| 有消息 | ↑ (白色) | 发送 | - | "发送" |
| 正在运行（无输入） | ▶ (黑色) | 禁用或继续 | - | "会话运行中" |
| 正在运行（有输入） | ↑ (白色) | **排队（queue）** | **引导（guide）** | "排队发送 / Ctrl+Enter 引导" |
| 已暂停 | ↑ (灰色) | 恢复/发送 | - | "恢复会话" |

---

## 关键变更对比

### 1. 移除强制截停（interrupt）

**当前**：Shift+Enter = interrupt（强制中断）  
**新方案**：移除此功能，避免意外强制中断

**理由**：强制中断风险高，容易误操作丢失工作进度

### 2. 默认行为从 queue 变为主要操作

**当前**：  
- 点击按钮（运行时有输入） → queue  
- Ctrl+Enter → guide  
- Shift+Enter → interrupt  

**新方案**：  
- 点击按钮 → queue（排队）  
- Ctrl+Enter → guide（引导）  
- 移除 interrupt  

### 3. Tooltip 增强

**当前**：只显示当前操作（"排队" / "停止" / "发送"）  
**新方案**：显示主操作 + 快捷键提示（"排队发送 / Ctrl+Enter 引导"）

### 4. 视觉状态更丰富

**当前**：只有两种图标（SendHorizontal / Square）  
**新方案**：五种状态图标，更清晰地传达当前状态

---

## 实现建议

### 需要修改的代码位置

1. **状态定义**（第 2057-2062 行）
   - 保持 `canSend`, `canStop`, `canIntervene` 逻辑
   - 添加新的状态判断函数

2. **主按钮行为**（第 2775-2785 行）
   - 修改 `handlePrimaryComposerAction`
   - 移除 interrupt 路径

3. **快捷键处理**（第 2787-2798 行）
   - 移除 `e.shiftKey` 的 interrupt 分支
   - 保留 Ctrl/Cmd+Enter 的 guide 行为

4. **按钮视觉**（第 4050-4077 行）
   - 根据五种状态选择不同图标
   - 调整颜色和样式

5. **Tooltip 内容**（第 4074-4076 行）
   - 增强提示文案，包含快捷键说明

### 伪代码示例

```typescript
// 新的状态判断
const composerState = useMemo(() => {
  if (!input.trim() && attachments.length === 0) return 'empty';
  if (sending && !canIntervene) return 'running-no-input';
  if (sending && canIntervene) return 'running-with-input';
  if (canSend) return 'ready';
  return 'disabled';
}, [input, attachments, sending, canIntervene, canSend]);

// 新的按钮行为
const handlePrimaryComposerAction = useCallback(() => {
  if (composerState === 'running-with-input') {
    void handleInterventionSend('queue');  // 默认排队
    return;
  }
  if (composerState === 'ready') {
    void handleSend();
    return;
  }
  // 其他状态禁用或无操作
}, [composerState, handleInterventionSend, handleSend]);

// 新的快捷键（移除 Shift+Enter interrupt）
if (sending && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
  e.preventDefault();
  if (!canIntervene) return;
  void handleInterventionSend('guide');  // 只保留 guide
  return;
}

// 新的图标选择
const getButtonIcon = (state: ComposerState) => {
  switch (state) {
    case 'empty': return <ArrowUp className="text-muted" />;
    case 'ready': return <ArrowUp className="text-primary" />;
    case 'running-no-input': return <Play className="text-foreground" />;
    case 'running-with-input': return <ArrowUp className="text-primary" />;
    default: return <ArrowUp className="text-muted" />;
  }
};

// 新的 Tooltip
const getButtonTooltip = (state: ComposerState) => {
  switch (state) {
    case 'ready': return t('composer.send');
    case 'running-with-input': 
      return t('composer.queueWithShortcut', { shortcut: 'Ctrl+Enter' });
    case 'running-no-input': 
      return t('composer.sessionRunning');
    default: return '';
  }
};
```

---

## 用户体验改进点

1. ✅ **更安全**：移除强制截停，避免误操作
2. ✅ **更直观**：五种状态图标清晰传达当前状态
3. ✅ **更易学**：默认点击=最常用操作（queue），高级操作用快捷键
4. ✅ **更透明**：Tooltip 主动展示快捷键，降低学习成本
5. ✅ **状态持久化**：会话暂停后可恢复，不丢失上下文

---

## 下一步行动

1. **等待项目构建完成**，启动开发服务器
2. **使用浏览器截图工具**对比当前实现的视觉效果
3. **验证当前快捷键行为**（Shift+Enter / Ctrl+Enter）
4. **实现新设计方案**的代码修改
5. **测试新交互流程**的完整性

---

## 注意事项

- 需要确保 i18n 翻译文件包含新的提示文案
- 需要更新单元测试（`tests/unit/chat-input.test.tsx`）
- 需要在用户文档中说明快捷键变更
- 考虑添加动画过渡，提升状态切换的视觉反馈
