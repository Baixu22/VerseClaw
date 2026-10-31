/** Side-panel audio/video preview. Opening a file here is an explicit request, so size is not gated. */
import { ConversationMediaCard } from '@/components/assistant-render/resources/ConversationMediaCard';

export function MediaPreview({
  filePath,
  fileName,
  mimeType,
  size,
}: {
  filePath: string;
  fileName: string;
  mimeType: string;
  size?: number;
}) {
  return (
    <div className="flex h-full justify-center overflow-auto p-4" data-testid="file-preview-media">
      <ConversationMediaCard
        file={{ fileName, mimeType, fileSize: size ?? 0, preview: null, filePath }}
        autoLoad
        className="h-fit w-full max-w-3xl"
      />
    </div>
  );
}

export default MediaPreview;
