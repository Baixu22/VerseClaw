import { useTranslation } from 'react-i18next';
import { AssistantMarkdown } from '@/components/assistant-render/AssistantMarkdown';
import { UserMessageBubble } from '@/components/assistant-render/UserMessageBubble';

export default function AppearanceConversationPreview() {
  const { t } = useTranslation('settings');
  return (
    <>
      <div className="max-w-[85%] self-end"><UserMessageBubble text={t('appearance.sampleQuestion')} /></div>
      <div data-slot="appearance-reply"><AssistantMarkdown text={t('appearance.sample')} isStreaming={false} /></div>
    </>
  );
}
