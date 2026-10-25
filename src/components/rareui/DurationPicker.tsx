/** Adapted from Rare UI Duration Picker. Copyright (c) 2026 Swami Malode.
 * MIT + Commons Clause + Attribution; see LICENSE in this directory. */
import { useEffect, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type DurationValue = { hours: number; minutes: number };

export function DurationPicker({ value, onConfirm, disabled = false }: {
  value: DurationValue;
  onConfirm: (value: DurationValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('common');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ hours: String(value.hours), minutes: String(value.minutes) });
  const hoursRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) hoursRef.current?.select(); }, [editing]);
  const confirm = () => {
    const hours = Number(draft.hours);
    const minutes = Number(draft.minutes);
    if (!draft.hours || !draft.minutes || !Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return;
    onConfirm({ hours, minutes });
    setEditing(false);
  };
  return (
    <div data-slot="duration-picker" data-testid="cron-duration-picker" data-editing={editing}
      className="rare-duration-picker" onKeyDown={(event) => {
        if (event.key === 'Enter' && editing) { event.preventDefault(); confirm(); }
        if (event.key === 'Escape' && editing) { event.preventDefault(); event.stopPropagation(); setEditing(false); }
      }}>
      {(['hours', 'minutes'] as const).map((field) => (
        <label key={field} className={cn('rare-duration-picker__segment', editing && 'rare-duration-picker__segment--editing')}>
          <input ref={field === 'hours' ? hoursRef : undefined} type="number" min={0} max={field === 'hours' ? 23 : 59}
            aria-label={t(`rareui.${field}`)} data-testid={`duration-picker-${field}`}
            value={editing ? draft[field] : String(value[field]).padStart(2, '0')}
            onChange={(event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }))}
            readOnly={!editing} tabIndex={editing ? 0 : -1} disabled={disabled} />
          <span>{t(`rareui.${field}Short`)}</span>
        </label>
      ))}
      <button type="button" data-testid="duration-picker-edit" disabled={disabled}
        aria-label={t(editing ? 'rareui.confirmTime' : 'rareui.editTime')}
        onClick={() => {
          if (editing) confirm();
          else { setDraft({ hours: String(value.hours), minutes: String(value.minutes) }); setEditing(true); }
        }}>
        {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
