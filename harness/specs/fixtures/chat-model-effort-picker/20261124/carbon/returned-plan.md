### 一、三项视觉判断

1. **紧凑卡片比例与细节：需调整**
   - **可见证据**：对比右上用户参考图（[review-board.png](file:///D:/tmp/clawx-model-effort-picker-20261124/carbon/review-board.png)），初版紧凑卡片（左上、中下）模型行与下方滑块之间留白过大，卡片纵向偏高、不够紧凑；顶部内边距偏紧，`Max` 字号（15px）略小于参考图视觉分量；中下浅色图的强度文字 Tooltip 停在滑块右上方空白处，因滑块偏低未遮住居中模型行，收紧间距后仍需保证滑块区顶部留出浮层安全距离，同时隐藏初版冗余的滑块底部静态强度文字（参考图无底部重复文字）。重置图标位置与 `1.6` 线宽贴近参考。
2. **Rare UI 模型层覆盖与层级：需调整**
   - **可见证据**：中上与左下 375px 截图中，模型层不透明面（`--surface-modal`）、阴影与左右边界安全无溢出，选中对勾与高亮胶囊清晰；但因 `ChatModelSettingsCard.tsx` 将模型名拼入了 `(${display.source})`，导致分组标题已显示 `custom-beta5678 · provider` 的情况下，列表项重复显示长后缀并折成两行，破坏了右下 Rare UI 参考图干净的单行层级与紧凑行距。
3. **搜索框焦点框与动效间距：需调整**
   - **可见证据**：中上与左下截图中，搜索框 `input:focus-visible` 呈现刺眼的 2px 蓝色内缩描边（`--color-border-focus`），破坏了 Rare UI 搜索栏无框一体感；须改为无蓝色描边、以底部分隔线或搜索栏微弱中性灰提亮表达键盘可见焦点。

---

### 二、三项外观改进与精确片段

#### 1. 去掉模型名称冗余提供商后缀，恢复单行清晰层级（`ChatModelSettingsCard.tsx`）
分组头已有 provider，去掉 `name` 里的括号后缀，避免紧凑触发器过长及 375px 列表项双行折行。

```tsx
// File: ChatModelSettingsCard.tsx
// Find:
      return { id: option.modelRef, name: `${display.name}${display.source ? ` (${display.source})` : ''}`,
        label: option.label, provider: display.source ?? undefined,
        icon: <ModelBrandIcon modelRef={option.modelRef} size={16} /> };

// Replace:
      return { id: option.modelRef, name: display.name,
        label: option.label, provider: display.source ?? undefined,
        icon: <ModelBrandIcon modelRef={option.modelRef} size={16} /> };
```

#### 2. 收紧紧凑卡片纵向比例、校准标题与重置图标细节（`settings.css`）
微增顶部内边距与 `Max` 字号，紧贴标题排布模型行，压缩滑块区上下冗余留白（保留上方浮层防遮挡间距），让三层紧凑聚拢贴合参考图。

```css
/* File: settings.css */
/* Find: */
.chat-model-settings-card { min-width: 0; padding-top: 10px; }
.chat-model-settings-heading { position: relative; display: flex; min-height: 28px; align-items: center; justify-content: center; padding-inline: 40px; }
.chat-model-settings-effort { font-size: 15px; font-weight: 600; line-height: 22px; }
.chat-model-settings-effort[data-max='true'] { color: var(--color-chat-accent, var(--orange-500)); }
.chat-model-settings-reset { position: absolute; inset-inline-end: 12px; display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--color-chat-secondary); }
.chat-model-settings-reset:hover:enabled { background: var(--color-chat-tray-hover); color: var(--color-chat-foreground); }
.chat-model-settings-reset:disabled { opacity: 0.35; }
.chat-model-settings-model { display: flex; min-width: 0; justify-content: center; padding: 0 14px; }

/* Replace: */
.chat-model-settings-card { min-width: 0; padding: 12px 0 10px; }
.chat-model-settings-heading { position: relative; display: flex; min-height: 26px; align-items: center; justify-content: center; padding-inline: 40px; }
.chat-model-settings-effort { font-size: 16px; font-weight: 600; line-height: 22px; letter-spacing: -0.01em; }
.chat-model-settings-effort[data-max='true'] { color: var(--color-chat-accent, var(--orange-500)); }
.chat-model-settings-reset { position: absolute; inset-inline-end: 12px; display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--color-chat-secondary); }
.chat-model-settings-reset:hover:enabled { background: var(--color-chat-tray-hover); color: var(--color-chat-foreground); }
.chat-model-settings-reset:disabled { opacity: 0.35; }
.chat-model-settings-model { display: flex; min-width: 0; justify-content: center; margin-top: 2px; padding: 0 14px; }
.chat-model-settings-card [data-testid='chat-model-settings-slider-region'] { margin-top: -6px; }
```

#### 3. 移除搜索框蓝色边框，统一明暗主题中性灰键盘焦点与列表间距（`settings.css`）
去掉 `input` 蓝色 `outline`，改用内嵌中性灰细焦点环保留键盘可见性，并收紧选项行高贴合 Rare UI 密度。

```css
/* File: settings.css */
/* Find: */
.chat-model-picker [role='option'] { height: auto; min-height: 36px; padding-block: 8px; color: var(--color-chat-secondary); }
.chat-model-picker [role='option'][aria-selected='true'] { color: var(--color-chat-foreground); }
.chat-model-picker [role='option'][aria-disabled='true'] { cursor: default; }
.chat-model-picker [data-slot='model-picker-highlight'] { background: color-mix(in srgb, var(--color-chat-foreground) 7%, transparent); }
.chat-model-settings-reset:focus-visible, .chat-model-picker > button:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: 2px; box-shadow: none; }
.chat-model-picker [data-slot='model-picker-panel'] input:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: -3px; border-radius: 6px; }

/* Replace: */
.chat-model-picker [role='option'] { height: auto; min-height: 34px; padding-block: 6px; color: var(--color-chat-secondary); }
.chat-model-picker [role='option'][aria-selected='true'] { color: var(--color-chat-foreground); font-weight: 500; }
.chat-model-picker [role='option'][aria-disabled='true'] { cursor: default; }
.chat-model-picker [data-slot='model-picker-highlight'] { background: color-mix(in srgb, var(--color-chat-foreground) 8%, transparent); }
.chat-model-settings-reset:focus-visible, .chat-model-picker > button:focus-visible { outline: 1.5px solid color-mix(in srgb, var(--color-chat-foreground) 28%, transparent); outline-offset: 2px; box-shadow: none; }
.chat-model-picker [data-slot='model-picker-panel'] input:focus,
.chat-model-picker [data-slot='model-picker-panel'] input:focus-visible { outline: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-chat-foreground) 22%, transparent); border-radius: 7px; }
```
