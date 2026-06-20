/**
 * TopicManager — Dialog for creating, editing, deleting topics
 * Uses @lobehub/ui Tooltip for action hints.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, RefreshCw, X, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopicEntry } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';

interface TopicManagerProps {
  open: boolean;
  agentId: string;
  workspacePath?: string;
  onChanged?: () => void;
  onClose: () => void;
}

export function TopicManager({ open, agentId, workspacePath, onChanged, onClose }: TopicManagerProps) {
  const { t } = useTranslation('chat');
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editContext, setEditContext] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.topics.list({ agentId, workspacePath });
      setTopics(result.topics ?? []);
    } catch (e) {
      console.warn('[TopicManager] Failed to fetch topics:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId, workspacePath]);

  useEffect(() => {
    if (open) void fetchTopics();
  }, [open, fetchTopics]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await hostApi.topics.create({ name: createName.trim(), description: createDesc.trim(), agentId, workspacePath });
      setCreateName('');
      setCreateDesc('');
      setShowCreate(false);
      await fetchTopics();
      onChanged?.();
    } catch (e) {
      console.warn('[TopicManager] Failed to create topic:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await hostApi.topics.delete({ id, agentId, workspacePath });
      await fetchTopics();
      onChanged?.();
    } catch (e) {
      console.warn('[TopicManager] Failed to delete topic:', e);
    }
  };

  const openEdit = async (topic: TopicEntry) => {
    setEditingTopic(topic.id);
    setEditName(topic.name);
    setEditDesc(topic.description || '');
    try {
      const result = await hostApi.topics.getContext({ id: topic.id, agentId, workspacePath });
      setEditContext(result.content ?? '');
    } catch {
      setEditContext('');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingTopic || !editName.trim()) return;
    setSavingEdit(true);
    try {
      await hostApi.topics.update({
        id: editingTopic,
        name: editName.trim(),
        description: editDesc.trim(),
        contextMd: editContext,
        agentId,
        workspacePath,
      });
      setEditingTopic(null);
      await fetchTopics();
      onChanged?.();
    } catch (e) {
      console.warn('[TopicManager] Failed to update topic:', e);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent asChild className="w-[calc(100%-2rem)] max-w-xl max-h-[85vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
            <div>
              <DialogTitle asChild>
                <CardTitle className="text-2xl font-serif font-normal tracking-tight">{t('topics.manager.title')}</CardTitle>
              </DialogTitle>
              <DialogDescription asChild>
                <p className="text-sm mt-1 text-foreground/70">
                  {t('topics.manager.description')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="inline h-3.5 w-3.5 ml-1 text-muted-foreground cursor-help -mt-0.5" />
                    </TooltipTrigger>
                    <TooltipContent>{t('topics.manager.infoTooltip')}</TooltipContent>
                  </Tooltip>
                </p>
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 -mr-2 -mt-2">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 overflow-y-auto flex-1 p-6">
            {loading ? (
              <div className="flex justify-center py-8"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {topics.map((topic) => (
                  <div
                    key={topic.id}
                    className="flex items-center justify-between rounded-xl bg-black/5 dark:bg-white/5 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{topic.name}</p>
                      {topic.description && (
                        <p className="text-xs text-muted-foreground truncate">{topic.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(topic)} className="rounded-lg h-7 px-2 text-xs">{t('common:actions.edit')}</Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('topics.manager.editTooltip')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => { if (confirm(t('topics.manager.deleteConfirm', { name: topic.name }))) void handleDelete(topic.id); }} className="rounded-lg h-7 px-2 text-xs text-red-500 hover:text-red-600">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('topics.manager.deleteTooltip', { name: topic.name })}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}

                {!showCreate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" onClick={() => setShowCreate(true)} className="w-full rounded-xl h-10 mt-2 border-dashed">
                        <Plus className="h-4 w-4 mr-2" />{t('topics.manager.create')}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('topics.manager.createTooltip')}</TooltipContent>
                  </Tooltip>
                )}

                {showCreate && (
                  <div className="space-y-3 rounded-xl bg-black/5 dark:bg-white/5 p-4">
                    <div className="space-y-2">
                      <Label className="text-xs">{t('topics.manager.name')}</Label>
                      <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder={t('topics.manager.namePlaceholder')} className="h-9 rounded-xl bg-white dark:bg-black/20 border-transparent" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{t('topics.manager.descriptionOptional')}</Label>
                      <Input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder={t('topics.manager.descriptionPlaceholder')} className="h-9 rounded-xl bg-white dark:bg-black/20 border-transparent" />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCreate} disabled={creating || !createName.trim()} className="rounded-xl h-9">
                        {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('topics.manager.createAction')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreateName(''); setCreateDesc(''); }} className="rounded-xl h-9">{t('common:actions.cancel')}</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Edit Modal */}
            {editingTopic && (
              <div className="space-y-3 rounded-xl border border-black/10 dark:border-white/10 p-4">
                <p className="text-sm font-semibold">{t('topics.manager.editing', { id: editingTopic })}</p>
                <div className="space-y-2">
                  <Label className="text-xs">{t('topics.manager.name')}</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">{t('topics.manager.descriptionLabel')}</Label>
                  <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="h-9 rounded-xl bg-black/5 dark:bg-white/5 border-transparent" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">{t('topics.manager.contextLabel')}</Label>
                  <Textarea value={editContext} onChange={(e) => setEditContext(e.target.value)} rows={8} className="rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-xs" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit} className="rounded-xl h-9">
                    {savingEdit ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingTopic(null)} className="rounded-xl h-9">{t('common:actions.cancel')}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
