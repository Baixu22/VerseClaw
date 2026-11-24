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
