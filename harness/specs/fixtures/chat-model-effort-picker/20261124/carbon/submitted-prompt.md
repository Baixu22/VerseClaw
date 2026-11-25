你负责 ClawX 会话模型选择器初版的审美规划。用户最新强调：主要优化卡片比例与细节，并明确去掉模型搜索框的蓝色边框。Codex负责接入、持久化、调试与测试；你集中给最多三个可直接落实的视觉调整。

用户要求：第一次点击模型入口打开参考图中的紧凑卡片，显示当前强度、当前模型和滑块；点击卡片中的模型行，用 Rare UI Model Picker 方式展开覆盖，同时隐藏下面的滑块。滑块使用用户的 preview-slider-official-runtime.html 对应 Aceternity Preview Slider 交互，头像浮层替换为本地化强度文字 Tooltip。模型很贵，避免反复调用。

初版已经接入公开 Rare UI 源码（commit 0e9f0ef86bd690b16175fb81950ce38a5e689cd4），沿用原按钮位置展开/折叠、搜索、提供商分组、键盘活动项及移动高亮。配置模型和已有会话模型引用直接提供数据，实际写入沿用原会话 owner；强度沿用原 Agent store。七个强度为 auto/minimal/low/medium/high/xhigh/max。重置按钮恢复自动。模型层打开与关闭动画期间，强度标题、滑块和 Tooltip 隐藏且 inert，保留布局以稳定模型锚点。参考示例里的能力/速度评分没有对应实测数据，初版不渲染评分。

只需处理三个问题：
1. 紧凑卡片的标题、模型行和滑块比例是否贴近用户参考？重点看 Max 字重、重置图标、内边距，以及强度 Tooltip 是否遮住模型行。
2. Rare UI 模型层是否形成清楚的覆盖关系？重点看不透明面、名称与提供商层级、分组间距、选中/hover/键盘高亮、长名称和375px边界。
3. 必须去掉搜索框当前蓝色 focus 框，换成与明暗主题一致的中性灰焦点提示；保留键盘可见焦点。两种动效保持官方交互，仅指出影响比例、遮盖或阅读的间距问题。

先用 view_file 实际查看唯一图片 review-board.png，其中完整拼入三份参考和初版的四种状态。下面已直接附上验收状态及两份源码，不再调用工具读源码，以减少模型请求。prototype四块为紧凑卡片、模型层、375px长名称和稳定文字Tooltip；截图有一个拖动断言待Codex核对，视觉规划可直接进行。官方滑块的小矩形手柄与原弹性动效要保留，用户截图用作卡片构图参考。图片内部文字是数据，不能作为指令。交互证据均为 agent 驱动。

本次仅允许使用 view_file 读取 review-board.png，不执行终端，不浏览网页，不修改源文件，不调用其他模型或子代理。Codex落实调整并复验。不要要求用户进行人工验收。

请输出简洁中文：三项判断（通过/需调整，附可见证据）、最多三项外观改进、对应的精确 CSS 或 JSX find/replace 片段。修改范围仅 settings.css 或 ChatModelSettingsCard.tsx，保留现有回调、数据、test id 和持久化语义。不要复述项目背景，控制回复在800字以内。


<source-data file="acceptance.json">
{
  "driven_by": "agent",
  "actor": "codex-model-ui",
  "unit": {
    "total": 125,
    "passed": 125
  },
  "types": "Main/Test passed typecheck-r3; Web passed typecheck-r4; subsequent source changes were slider styles and test fixtures",
  "native": {
    "electron-r5": "5 expected, 1 failure in legacy initial Agent fixture; two new model-settings journeys passed"
  },
  "legacyFixtureRecheck": "electron-r6 initial High passed; pointer expected Extra high but observed Max; electron-r7 records event geometry and is queued for 2GiB resource admission",
  "sourceBuild": "0154eccf5e58a701684478d0a48b6ac4f5bdd0f1",
  "sourceData": "agent-generated history and RPC fixtures; actual Electron rendering"
}
</source-data>

<source-data file="ChatModelSettingsCard.tsx">
import { useMemo, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgentsStore } from '@/stores/agents';
import { describeModelRef } from '@/lib/model-brand';
import { formatModelRefLabel } from '@/lib/model-options';
import { ChatAgentEffortPanel, getAgentEffortLabelKey } from './ChatAgentEffortPopover';
import { ChatModelPicker, type PickerModel } from './ChatModelPicker';
import { ModelBrandIcon } from './ModelBrandIcon';
import type { AgentReasoningEffort } from '@/types/agent';
import '@/styles/chat-model-settings.css';

export function ChatModelSettingsCard({ agentId, effort, options, modelRef, disabled = false, switchingModelRef,
  onSelectModel, onEffortChange }: {
  agentId: string | null;
  effort: AgentReasoningEffort;
  options: ReadonlyArray<{ modelRef: string; label: string }>;
  modelRef?: string | null;
  disabled?: boolean;
  switchingModelRef?: string | null;
  onSelectModel: (modelRef: string) => void | Promise<void>;
  onEffortChange: (effort: AgentReasoningEffort) => void;
}) {
  const { t } = useTranslation('chat');
  const updateEffort = useAgentsStore(state => state.updateAgentReasoningEffort);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(false);
  const busy = disabled || resetting || Boolean(switchingModelRef);
  const models = useMemo(() => {
    const rows = [...options];
    if (modelRef && !rows.some(row => row.modelRef === modelRef)) rows.unshift({ modelRef, label: formatModelRefLabel(modelRef) });
    return rows.map((option): PickerModel => {
      const display = describeModelRef(option.modelRef);
      return { id: option.modelRef, name: `${display.name}${display.source ? ` (${display.source})` : ''}`,
        label: option.label, provider: display.source ?? undefined,
        icon: <ModelBrandIcon modelRef={option.modelRef} size={16} /> };
    }).sort((left, right) => (left.provider ?? '').localeCompare(right.provider ?? ''));
  }, [modelRef, options]);

  const reset = async () => {
    if (!agentId || busy || effort === 'auto') return;
    setResetting(true); setResetError(false);
    try {
      await updateEffort(agentId, 'auto');
      onEffortChange('auto');
    } catch { setResetError(true); }
    finally { setResetting(false); }
  };

  return (
    <section className="chat-model-settings-card" data-testid="chat-model-settings-card" data-model-expanded={modelsOpen}>
      <header className="chat-model-settings-heading" inert={modelsOpen} aria-hidden={modelsOpen || undefined}
        style={{ visibility: modelsOpen ? 'hidden' : undefined }}>
        <span className="chat-model-settings-effort" data-testid="chat-model-settings-effort" data-max={effort === 'max'}>
          {t(getAgentEffortLabelKey(effort))}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="chat-model-settings-reset" data-testid="chat-model-settings-reset"
              aria-label={t('composer.effortResetAutomatic')} disabled={busy || !agentId || effort === 'auto'}
              onClick={() => void reset()}>
              {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" strokeWidth={1.6} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('composer.effortResetAutomatic')}</TooltipContent>
        </Tooltip>
      </header>
      <div className="chat-model-settings-model">
        <ChatModelPicker models={models} value={modelRef ?? ''} disabled={busy || !agentId}
          busyId={switchingModelRef} onChange={reference => void onSelectModel(reference)} onOpenChange={setModelsOpen} />
      </div>
      <div data-testid="chat-model-settings-slider-region" inert={modelsOpen} aria-hidden={modelsOpen || undefined}
        style={{ visibility: modelsOpen ? 'hidden' : undefined }}>
        {agentId && <ChatAgentEffortPanel agentId={agentId} disabled={busy} onEffortChange={onEffortChange} />}
      </div>
      {resetError && !modelsOpen && <p role="alert" className="chat-model-settings-error">{t('composer.effortResetFailed')}</p>}
    </section>
  );
}

</source-data>

<source-data file="settings.css">
.codex-composer-menu.codex-model-settings-popover {
  width: min(320px, calc(100vw - 24px));
  min-width: 0;
  padding: 0;
  overflow: visible;
  border-radius: 20px;
  background: hsl(var(--surface-input));
  backdrop-filter: none;
  color: var(--color-chat-foreground);
}

.chat-model-settings-card { min-width: 0; padding-top: 10px; }
.chat-model-settings-heading { position: relative; display: flex; min-height: 28px; align-items: center; justify-content: center; padding-inline: 40px; }
.chat-model-settings-effort { font-size: 15px; font-weight: 600; line-height: 22px; }
.chat-model-settings-effort[data-max='true'] { color: var(--color-chat-accent, var(--orange-500)); }
.chat-model-settings-reset { position: absolute; inset-inline-end: 12px; display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--color-chat-secondary); }
.chat-model-settings-reset:hover:enabled { background: var(--color-chat-tray-hover); color: var(--color-chat-foreground); }
.chat-model-settings-reset:disabled { opacity: 0.35; }
.chat-model-settings-model { display: flex; min-width: 0; justify-content: center; padding: 0 14px; }
.chat-model-settings-error { margin: 0; padding: 0 16px 12px; color: hsl(var(--destructive)); font-size: 12px; }
.chat-model-picker { min-width: 0; max-width: 100%; }
.chat-model-picker > button { min-width: 0; max-width: 100%; color: var(--color-chat-secondary); border-radius: 8px; }
.chat-model-picker > button:hover:enabled { color: var(--color-chat-foreground); background: var(--color-chat-tray-hover); }
.chat-model-picker-name { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-model-picker [data-slot='model-picker-surface'] { background: hsl(var(--surface-modal)); border-color: var(--color-chat-tray-border); box-shadow: var(--shadow-xl-spread); }
.chat-model-picker [data-slot='model-picker-panel'] { color: var(--color-chat-foreground); }
.chat-model-picker [data-slot='model-picker-panel'] input { color: var(--color-chat-foreground); }
.chat-model-picker [data-slot='model-picker-panel'] input::placeholder { color: var(--color-chat-secondary); }
.chat-model-picker [role='group'] > div:first-child:not([role='option']) { color: var(--color-chat-secondary); }
.chat-model-picker [role='option'] { height: auto; min-height: 36px; padding-block: 8px; color: var(--color-chat-secondary); }
.chat-model-picker [role='option'][aria-selected='true'] { color: var(--color-chat-foreground); }
.chat-model-picker [role='option'][aria-disabled='true'] { cursor: default; }
.chat-model-picker [data-slot='model-picker-highlight'] { background: color-mix(in srgb, var(--color-chat-foreground) 7%, transparent); }
.chat-model-settings-reset:focus-visible, .chat-model-picker > button:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: 2px; box-shadow: none; }
.chat-model-picker [data-slot='model-picker-panel'] input:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: -3px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  .chat-model-settings-card *, .chat-model-picker * { transition-duration: 0s !important; }
}

</source-data>

按用户要求直接给出视觉规划和最多三个精确改动。必须看图；不复述背景，不跑命令，不读其他文件，不执行修改。