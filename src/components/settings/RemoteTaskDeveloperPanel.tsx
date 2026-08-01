import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hostApi } from '@/lib/host-api';
import { useInboxStore } from '@/stores/inbox';
import type { RemoteTaskCommand, RemoteTaskKind } from '@shared/types/remote-tasks';

const DEFAULT_PATCH = JSON.stringify({ theme: 'system' }, null, 2);

export function RemoteTaskDeveloperPanel() {
  const { t } = useTranslation(['settings', 'remoteTasks']);
  const navigate = useNavigate();
  const [kind, setKind] = useState<RemoteTaskKind>('message');
  const [title, setTitle] = useState(t('remoteTasks:form.defaultTitle'));
  const [body, setBody] = useState(t('remoteTasks:form.defaultBody'));
  const [doctorMode, setDoctorMode] = useState<'diagnose' | 'fix'>('diagnose');
  const [patchText, setPatchText] = useState(DEFAULT_PATCH);
  const [creating, setCreating] = useState(false);
  const [lastCreatedTitle, setLastCreatedTitle] = useState<string | null>(null);

  const createTask = async () => {
    let command: RemoteTaskCommand;
    if (kind === 'message') {
      command = { kind, title: title.trim(), body: body.trim() };
    } else if (kind === 'doctor') {
      command = { kind, mode: doctorMode };
    } else {
      try {
        command = { kind, patch: JSON.parse(patchText) as Record<string, unknown> };
      } catch {
        toast.error(t('remoteTasks:toast.invalidJson'));
        return;
      }
    }

    setCreating(true);
    try {
      const result = await hostApi.remoteTasks.create({
        source: 'local',
        reason: t('remoteTasks:form.localReason'),
        command,
      });
      setLastCreatedTitle(result.task.command.kind === 'message'
        ? result.task.command.title
        : result.task.command.kind === 'doctor'
          ? `doctor:${result.task.command.mode}`
          : Object.keys(result.task.command.patch).join(', '));
      await useInboxStore.getState().refresh();
      toast.success(t('remoteTasks:toast.created'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="border-y border-border py-4" data-testid="settings-remote-task-developer">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t('settings:developer.remoteTasks.title')}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{t('settings:developer.remoteTasks.description')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate('/inbox?source=remote-task')}
        >
          {t('settings:developer.remoteTasks.openInbox')}
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label htmlFor="developer-remote-task-kind">{t('remoteTasks:form.kind')}</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as RemoteTaskKind)}>
            <SelectTrigger id="developer-remote-task-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="message">{t('remoteTasks:kind.message')}</SelectItem>
              <SelectItem value="doctor">{t('remoteTasks:kind.doctor')}</SelectItem>
              <SelectItem value="settingsPatch">{t('remoteTasks:kind.settingsPatch')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-3">
          {kind === 'message' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="developer-remote-task-title">{t('remoteTasks:form.messageTitle')}</Label>
                <Input id="developer-remote-task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="developer-remote-task-body">{t('remoteTasks:form.messageBody')}</Label>
                <Textarea id="developer-remote-task-body" value={body} onChange={(event) => setBody(event.target.value)} className="min-h-24" />
              </div>
            </>
          ) : null}

          {kind === 'doctor' ? (
            <div className="space-y-2">
              <Label htmlFor="developer-remote-task-doctor">{t('remoteTasks:form.doctorMode')}</Label>
              <Select value={doctorMode} onValueChange={(value) => setDoctorMode(value as 'diagnose' | 'fix')}>
                <SelectTrigger id="developer-remote-task-doctor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="diagnose">{t('remoteTasks:doctor.diagnose')}</SelectItem>
                  <SelectItem value="fix">{t('remoteTasks:doctor.fix')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {kind === 'settingsPatch' ? (
            <div className="space-y-2">
              <Label htmlFor="developer-remote-task-patch">{t('remoteTasks:form.patch')}</Label>
              <Textarea
                id="developer-remote-task-patch"
                value={patchText}
                onChange={(event) => setPatchText(event.target.value)}
                className="min-h-28 font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{t('remoteTasks:form.patchHint')}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="min-w-0 truncate text-xs text-muted-foreground" data-testid="settings-remote-task-created">
              {lastCreatedTitle ? t('settings:developer.remoteTasks.created', { title: lastCreatedTitle }) : t('settings:developer.remoteTasks.localOnly')}
            </p>
            <Button type="button" size="sm" onClick={() => void createTask()} disabled={creating} data-testid="remote-task-create">
              <Send className="mr-1.5 h-4 w-4" />
              {t('remoteTasks:actions.create')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
