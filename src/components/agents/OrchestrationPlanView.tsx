// Orchestration plan visualization: renders the plan as a layered card flow
// (Lead → Workers → Verifier) instead of a flat text list, making the
// orchestration structure scannable at a glance.
//
// Each worker card carries the role's tone dot + effort badge + task text.
// The plan's mode is shown as a header badge; reasons[] (previously discarded)
// render as a collapsible muted list.
import { useState } from 'react';
import { ChevronDown, CircleDot, Diamond } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { effortTone, roleTone, toneClasses } from '@/lib/role-visuals';

export type PlanWorker = {
  roleName: string;
  task: string;
  effort?: string;
};

export type PlanView = {
  mode: string;
  leadRole: string;
  verifierRole?: string;
  workers: PlanWorker[];
  reasons: string[];
};

type OrchestrationPlanViewProps = {
  plan: PlanView;
  tt: (key: string, defaultValue: string, vars?: Record<string, unknown>) => string;
};

function WorkerCard({
  label,
  worker,
  isVerifier,
}: {
  label: string;
  worker: PlanWorker;
  isVerifier: boolean;
}) {
  const dotTone = roleTone(worker.roleName);
  const effTone = effortTone(worker.effort);
  const dot = toneClasses(dotTone);
  return (
    <div className="rounded-xl bg-surface-modal border border-black/5 dark:border-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isVerifier ? (
            <Diamond className={cn('h-3 w-3 shrink-0', dot.text)} />
          ) : (
            <CircleDot className={cn('h-3 w-3 shrink-0', dot.text)} />
          )}
          <span className="text-sm font-medium truncate">{worker.roleName}</span>
          <span className="text-2xs text-muted-foreground shrink-0">{label}</span>
        </div>
        {worker.effort && (
          <Badge variant="secondary" className={cn('text-2xs rounded-full border', toneClasses(effTone).tint)}>
            {worker.effort}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{worker.task}</p>
    </div>
  );
}

export function OrchestrationPlanView({ plan, tt }: OrchestrationPlanViewProps) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const hasReasons = plan.reasons && plan.reasons.length > 0;

  // Split workers into lead (first) and the rest, so we can show the flow.
  const leadWorker = plan.workers[0];
  const restWorkers = plan.workers.slice(1);

  return (
    <div className="rounded-2xl bg-surface-input p-4 space-y-2">
      {/* Header: mode + reasons toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="rounded-full">{plan.mode}</Badge>
          {hasReasons && (
            <button
              type="button"
              onClick={() => setReasonsOpen((prev) => !prev)}
              className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {tt('roles.reasons', '推理依据')}
              <ChevronDown className={cn('h-3 w-3 transition-transform', reasonsOpen && 'rotate-180')} />
            </button>
          )}
        </div>
        {plan.verifierRole && (
          <span className="text-2xs text-muted-foreground">
            {tt('roles.verifier', '验证')}: {plan.verifierRole}
          </span>
        )}
      </div>

      {reasonsOpen && hasReasons && (
        <ul className="text-2xs text-muted-foreground space-y-0.5 pl-1">
          {plan.reasons.map((reason, i) => (
            <li key={i} className="font-mono break-all">{reason}</li>
          ))}
        </ul>
      )}

      {/* Lead worker */}
      {leadWorker && (
        <WorkerCard
          label={tt('roles.lead', '主导')}
          worker={{ ...leadWorker }}
          isVerifier={false}
        />
      )}

      {/* Remaining workers with connector */}
      {restWorkers.length > 0 && (
        <div className="ml-3 border-l-2 border-black/10 dark:border-white/10 pl-3 space-y-2">
          {restWorkers.map((worker, i) => (
            <WorkerCard
              key={`${worker.roleName}-${i}`}
              label={tt('roles.worker', '执行')}
              worker={worker}
              isVerifier={false}
            />
          ))}
        </div>
      )}

      {/* Verifier (separate from workers list) */}
      {plan.verifierRole && (
        <div className={cn(restWorkers.length === 0 && 'ml-3 border-l-2 border-black/10 dark:border-white/10 pl-3')}>
          <WorkerCard
            label={tt('roles.verifier', '验证')}
            worker={{ roleName: plan.verifierRole, task: tt('roles.verifierTask', '验证完成度与质量'), effort: undefined }}
            isVerifier
          />
        </div>
      )}
    </div>
  );
}

export default OrchestrationPlanView;
