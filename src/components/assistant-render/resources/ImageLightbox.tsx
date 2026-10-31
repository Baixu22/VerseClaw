/**
 * Shared full-screen image view: chat attachments, Markdown images and galleries
 * all open here, so a resolved image behaves the same wherever it came from.
 */
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApi } from '@/lib/host-api';

export function ImageLightbox({
  src,
  fileName,
  filePath,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('chat');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      void hostApi.shell.showItemInFolder(filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      data-testid="chat-image-lightbox"
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Tooltip>
              <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('filePreview.actions.openInFinder')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('filePreview.actions.close')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>,
    document.body,
  );
}
