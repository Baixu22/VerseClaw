# 发送按钮状态设计规范

## 📸 基于图片的五种状态分析

根据你提供的图片，五种状态从左到右依次是：

### 状态 1：无消息状态（Empty State）
- **图标**：向上箭头 ↑
- **颜色**：灰色（禁用状态）
- **背景**：灰色圆形背景
- **语义**：没有内容可发送

### 状态 2：有消息待发（Ready to Send）
- **图标**：向上箭头 ↑
- **颜色**：白色/深色（激活状态）
- **背景**：白色/浅色圆形背景（高对比）
- **语义**：有内容待发送

### 状态 3：消息刚发出/系统热启动（Sending/Loading）
- **图标**：刷新/加载图标（旋转圆圈）
- **颜色**：灰色
- **背景**：灰色圆形背景
- **动画**：旋转动画
- **语义**：正在处理/热启动中

### 状态 4：会话正在运行（Session Running）
- **图标**：播放三角 ▶
- **颜色**：黑色/深色（激活状态）
- **背景**：白色/浅色圆形背景
- **语义**：AI 正在思考/执行

### 状态 5：会话临时暂停（Session Paused）
- **图标**：向上箭头 ↑
- **颜色**：灰色
- **背景**：灰色圆形背景
- **语义**：会话已暂停，可恢复

---

## 🎨 图标映射方案

### Lucide Icons 选择

```typescript
import {
  ArrowUp,        // 向上箭头（发送）
  Play,           // 播放三角（运行中）
  Loader2,        // 加载图标（处理中，带旋转动画）
  Pause,          // 暂停图标（备选）
  Circle,         // 圆形（备选）
} from 'lucide-react';
```

### 状态到图标的映射

```typescript
type ComposerButtonState = 
  | 'empty'              // 无消息
  | 'ready'              // 有消息待发
  | 'sending'            // 消息刚发出
  | 'running'            // 会话运行中
  | 'running-with-input' // 会话运行中且有新输入（可排队）
  | 'paused';            // 会话暂停

const BUTTON_ICON_MAP = {
  empty: ArrowUp,              // 灰色向上箭头
  ready: ArrowUp,              // 白色向上箭头
  sending: Loader2,            // 旋转加载
  running: Play,               // 播放三角
  'running-with-input': ArrowUp, // 白色向上箭头（表示可排队）
  paused: ArrowUp,             // 灰色向上箭头
};
```

---

## 🎨 样式规范

### 颜色系统

```typescript
const BUTTON_STYLE_MAP = {
  // 状态 1: 无消息（禁用）
  empty: {
    icon: 'text-muted-foreground/40',
    background: 'bg-muted/30',
    hover: 'hover:bg-muted/40',
    cursor: 'cursor-not-allowed',
    opacity: 'opacity-50',
  },
  
  // 状态 2: 有消息待发（激活）
  ready: {
    icon: 'text-foreground dark:text-white',
    background: 'bg-black/5 dark:bg-white/10',
    hover: 'hover:bg-black/10 dark:hover:bg-white/20',
    cursor: 'cursor-pointer',
    opacity: 'opacity-100',
    transition: 'transition-all duration-200',
  },
  
  // 状态 3: 消息刚发出（加载）
  sending: {
    icon: 'text-muted-foreground',
    background: 'bg-muted/40',
    hover: '', // 无 hover 效果
    cursor: 'cursor-default',
    opacity: 'opacity-80',
    animation: 'animate-spin', // 旋转动画
  },
  
  // 状态 4: 会话运行中（激活，可停止）
  running: {
    icon: 'text-foreground dark:text-white',
    background: 'bg-black/8 dark:bg-white/15',
    hover: 'hover:bg-black/12 dark:hover:bg-white/25',
    cursor: 'cursor-pointer',
    opacity: 'opacity-100',
    // 可选：添加脉冲动画表示运行中
    pulse: 'animate-pulse-subtle',
  },
  
  // 状态 5: 运行中且有新输入（可排队）
  'running-with-input': {
    icon: 'text-primary dark:text-primary-light',
    background: 'bg-primary/10 dark:bg-primary/20',
    hover: 'hover:bg-primary/15 dark:hover:bg-primary/30',
    cursor: 'cursor-pointer',
    opacity: 'opacity-100',
    border: 'ring-1 ring-primary/20', // 强调可操作
  },
  
  // 状态 6: 会话暂停（次要）
  paused: {
    icon: 'text-muted-foreground/60',
    background: 'bg-muted/30',
    hover: 'hover:bg-muted/40',
    cursor: 'cursor-pointer',
    opacity: 'opacity-70',
  },
};
```

### 尺寸规范

```typescript
const BUTTON_SIZE = {
  container: 'h-9 w-9',        // 按钮容器尺寸
  icon: {
    arrowUp: 'h-4 w-4',        // 向上箭头
    play: 'h-3.5 w-3.5',       // 播放三角
    loader: 'h-4 w-4',         // 加载图标
  },
  borderRadius: 'rounded-lg',  // 圆角
  padding: 'p-0',              // 内边距（icon button）
};
```

---

## 💻 实现代码

### 步骤 1: 定义状态类型和辅助函数

```typescript
// src/pages/Chat/ChatInput.tsx

import { ArrowUp, Play, Loader2 } from 'lucide-react';

type ComposerButtonState = 
  | 'empty'
  | 'ready'
  | 'sending'
  | 'running'
  | 'running-with-input'
  | 'paused';

const getComposerButtonState = (
  sending: boolean,
  canSend: boolean,
  canIntervene: boolean,
  hasInput: boolean,
  inputDisabled: boolean,
): ComposerButtonState => {
  // 禁用状态
  if (inputDisabled) return 'empty';
  
  // 发送中（消息刚发出）
  if (sending && !canIntervene && !hasInput) {
    return 'sending';
  }
  
  // 运行中且有新输入（可排队）
  if (sending && canIntervene && hasInput) {
    return 'running-with-input';
  }
  
  // 运行中但无新输入
  if (sending && !hasInput) {
    return 'running';
  }
  
  // 准备发送
  if (canSend && hasInput) {
    return 'ready';
  }
  
  // 无消息
  return 'empty';
};

const getButtonIcon = (state: ComposerButtonState) => {
  switch (state) {
    case 'empty':
    case 'ready':
    case 'running-with-input':
    case 'paused':
      return ArrowUp;
    case 'running':
      return Play;
    case 'sending':
      return Loader2;
    default:
      return ArrowUp;
  }
};

const getButtonIconClass = (state: ComposerButtonState): string => {
  switch (state) {
    case 'empty':
      return 'h-4 w-4 text-muted-foreground/40';
    case 'ready':
      return 'h-4 w-4 text-foreground dark:text-white';
    case 'sending':
      return 'h-4 w-4 text-muted-foreground animate-spin';
    case 'running':
      return 'h-3.5 w-3.5 text-foreground dark:text-white';
    case 'running-with-input':
      return 'h-4 w-4 text-primary dark:text-primary-light';
    case 'paused':
      return 'h-4 w-4 text-muted-foreground/60';
    default:
      return 'h-4 w-4';
  }
};

const getButtonContainerClass = (state: ComposerButtonState): string => {
  const baseClass = 'shrink-0 h-9 w-9 rounded-lg transition-all duration-200';
  
  switch (state) {
    case 'empty':
      return cn(
        baseClass,
        'bg-muted/30 hover:bg-muted/40 opacity-50 cursor-not-allowed',
        'text-muted-foreground/40'
      );
    case 'ready':
      return cn(
        baseClass,
        'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20',
        'text-foreground dark:text-white cursor-pointer'
      );
    case 'sending':
      return cn(
        baseClass,
        'bg-muted/40 cursor-default opacity-80',
        'text-muted-foreground'
      );
    case 'running':
      return cn(
        baseClass,
        'bg-black/8 dark:bg-white/15 hover:bg-black/12 dark:hover:bg-white/25',
        'text-foreground dark:text-white cursor-pointer'
      );
    case 'running-with-input':
      return cn(
        baseClass,
        'bg-primary/10 dark:bg-primary/20 hover:bg-primary/15 dark:hover:bg-primary/30',
        'ring-1 ring-primary/20 text-primary dark:text-primary-light cursor-pointer'
      );
    case 'paused':
      return cn(
        baseClass,
        'bg-muted/30 hover:bg-muted/40 opacity-70',
        'text-muted-foreground/60 cursor-pointer'
      );
    default:
      return baseClass;
  }
};
```

### 步骤 2: 生成 Tooltip 文案

```typescript
const getButtonTooltip = (
  state: ComposerButtonState,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  switch (state) {
    case 'empty':
      return ''; // 无提示
    case 'ready':
      return t('composer.send'); // "发送"
    case 'sending':
      return t('composer.sending'); // "发送中..."
    case 'running':
      return t('composer.sessionRunning'); // "会话运行中"
    case 'running-with-input':
      return t('composer.queueWithShortcut'); // "排队发送 • Ctrl+Enter 引导"
    case 'paused':
      return t('composer.sessionPaused'); // "会话已暂停"
    default:
      return '';
  }
};
```

### 步骤 3: 更新按钮渲染

```tsx
// 在组件中使用
const hasInput = Boolean(input.trim() || attachments.length > 0 || selectedKnowledgeRefs.length > 0);

const buttonState = getComposerButtonState(
  sending,
  canSend,
  canIntervene,
  hasInput,
  inputDisabled
);

const ButtonIcon = getButtonIcon(buttonState);
const buttonIconClass = getButtonIconClass(buttonState);
const buttonContainerClass = getButtonContainerClass(buttonState);
const buttonTooltip = getButtonTooltip(buttonState, t);
const buttonDisabled = buttonState === 'empty' || buttonState === 'sending';

// 渲染
<Tooltip>
  <TooltipTrigger asChild>
    <span className="inline-flex">
      <Button
        onClick={handlePrimaryComposerAction}
        disabled={buttonDisabled}
        size="icon"
        data-testid="chat-composer-send"
        data-button-state={buttonState}
        className={buttonContainerClass}
        variant="ghost"
        aria-label={buttonTooltip}
      >
        <ButtonIcon className={buttonIconClass} strokeWidth={2} />
      </Button>
    </span>
  </TooltipTrigger>
  {buttonTooltip && (
    <TooltipContent side="top" collisionPadding={8}>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{buttonTooltip}</span>
        {buttonState === 'running-with-input' && (
          <span className="text-xs text-muted-foreground">
            Ctrl+Enter {t('composer.guideShortcut')}
          </span>
        )}
      </div>
    </TooltipContent>
  )}
</Tooltip>
```

---

## 🌈 动画效果

### 状态切换动画

```css
/* 添加到全局 CSS 或 Tailwind 配置 */
@keyframes pulse-subtle {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.85;
  }
}

.animate-pulse-subtle {
  animation: pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

### 图标切换过渡

```typescript
// 使用 framer-motion 实现平滑切换（可选）
import { motion, AnimatePresence } from 'framer-motion';

<AnimatePresence mode="wait">
  <motion.div
    key={buttonState}
    initial={{ scale: 0.8, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    exit={{ scale: 0.8, opacity: 0 }}
    transition={{ duration: 0.15 }}
  >
    <ButtonIcon className={buttonIconClass} strokeWidth={2} />
  </motion.div>
</AnimatePresence>
```

---

## 📝 国际化文案

需要在 `locales/zh-CN.json` 和 `locales/en.json` 中添加：

```json
{
  "composer": {
    "send": "发送",
    "sending": "发送中...",
    "sessionRunning": "会话运行中",
    "sessionPaused": "会话已暂停",
    "queueWithShortcut": "排队发送 • Ctrl+Enter 引导",
    "guideShortcut": "引导"
  }
}
```

---

## ✅ 验收清单

- [ ] 五种状态图标正确显示
- [ ] 颜色符合设计规范（浅色/深色模式）
- [ ] Hover 效果符合预期
- [ ] 禁用状态无法点击
- [ ] Tooltip 正确显示（含快捷键提示）
- [ ] 状态切换动画流畅
- [ ] 加载图标正确旋转
- [ ] 运行中状态有视觉反馈（脉冲或其他）
- [ ] 辅助功能（aria-label）完整
- [ ] 深色模式适配正确

---

## 🎯 下一步

1. **实现代码**：修改 `src/pages/Chat/ChatInput.tsx` 第 4050-4077 行
2. **添加样式**：确保 Tailwind 配置支持自定义动画
3. **测试交互**：验证五种状态的点击行为
4. **截图对比**：与原始设计图对比视觉效果

需要我继续实现具体的代码修改吗？
