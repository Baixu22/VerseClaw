// Orchestration plan visualization: renders the plan as a layered card flow
// (Lead → Workers → Verifier) instead of a flat text list, making the
// orchestration structure scannable at a glance.
//
// Each worker card carries the role's tone dot + effort badge + task text.
// The plan's mode is shown as a header badge; reasons[] (previously discarded)
// render as a collapsible muted list.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Ban, CheckCircle2, ChevronDown, CircleDot, Diamond, Edit3, RefreshCw, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { effortTone, roleTone, toneClasses } from '@/lib/role-visuals';

export type PlanWorker = {
  roleName: string;
  task: string;
  effort?: string;
  taskNodeId?: string;
  phase?: string;
  isVerifier?: boolean;
};

export type PlanView = {
  mode: string;
  leadRole: string;
  verifierRole?: string;
  workers: PlanWorker[];
  reasons: string[];
  taskGraph?: {
    graphRunId?: string;
    nodes?: PlanWorker[];
  };
};

type PlanEditControl = {
  editing: boolean;
  order: string[];
  disabledNodeIds: string[];
  notesByNodeId: Record<string, string>;
  onToggleEditing: () => void;
  onDisableNode: (nodeId: string) => void;
  onEnableNode: (nodeId: string) => void;
  onNoteNode: (nodeId: string, note: string) => void;
  onMoveNode: (nodeId: string, beforeNodeId: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
};

type OrchestrationPlanViewProps = {
  plan: PlanView;
  tt: (key: string, defaultValue: string, vars?: Record<string, unknown>) => string;
  editControl?: PlanEditControl;
};

function planWorkerId(worker: PlanWorker, index: number): string {
  return worker.taskNodeId ?? `${worker.roleName}-${index + 1}`;
}

function WorkerCard({
  label,
  worker,
  isVerifier,
  nodeId,
  editControl,
  tt,
  previousNodeId,
  nextBeforeNodeId,
}: {
  label: string;
  worker: PlanWorker;
  isVerifier: boolean;
  nodeId: string;
  editControl?: PlanEditControl;
  tt: (key: string, defaultValue: string, vars?: Record<string, unknown>) => string;
  previousNodeId?: string | null;
  nextBeforeNodeId?: string | null;
}) {
  const dotTone = roleTone(worker.roleName);
  const effTone = effortTone(worker.effort);
  const dot = toneClasses(dotTone);
  const disabled = Boolean(editControl?.disabledNodeIds.includes(nodeId));
  return (
    <div className={cn(
      'rounded-xl bg-surface-modal border border-black/5 dark:border-white/5 p-3',
      disabled && 'opacity-60',
    )}>
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
      {editControl?.editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={!previousNodeId}
            onClick={() => previousNodeId && editControl.onMoveNode(nodeId, previousNodeId)}
            title={tt('roles.planEdit.moveUp', 'Move up')}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={nextBeforeNodeId === undefined}
            onClick={() => editControl.onMoveNode(nodeId, nextBeforeNodeId ?? null)}
            title={tt('roles.planEdit.moveDown', 'Move down')}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            data-testid={`orchestration-plan-disable-${nodeId}`}
            className="h-8 w-8"
            onClick={() => (
              disabled ? editControl.onEnableNode(nodeId) : editControl.onDisableNode(nodeId)
            )}
            title={disabled ? tt('roles.planEdit.enableNode', 'Enable node') : tt('roles.planEdit.disableNode', 'Disable node')}
          >
            {disabled ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          </Button>
          <Input
            data-testid={`orchestration-plan-note-${nodeId}`}
            value={editControl.notesByNodeId[nodeId] ?? ''}
            onChange={(event) => editControl.onNoteNode(nodeId, event.target.value)}
            placeholder={tt('roles.planEdit.notePlaceholder', 'Add a note')}
            className="h-8 min-w-40 flex-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}

export function OrchestrationPlanView({ plan, tt, editControl }: OrchestrationPlanViewProps) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const hasReasons = plan.reasons && plan.reasons.length > 0;

  // Split workers into lead (first) and the rest, so we can show the flow.
  const graphWorkers = plan.taskGraph?.nodes?.filter((node) => node.roleName && node.task) ?? [];
  const displayWorkers = graphWorkers.length > 0 ? graphWorkers : plan.workers;
  const orderedWorkers = editControl
    ? displayWorkers
      .map((worker, index) => ({
        worker,
        index,
        nodeId: planWorkerId(worker, index),
      }))
      .sort((left, right) => {
        const leftIndex = editControl.order.indexOf(left.nodeId);
        const rightIndex = editControl.order.indexOf(right.nodeId);
        const leftOrder = leftIndex >= 0 ? leftIndex : editControl.order.length + left.index;
        const rightOrder = rightIndex >= 0 ? rightIndex : editControl.order.length + right.index;
        return leftOrder - rightOrder;
      })
      .map((entry) => entry.worker)
    : displayWorkers;
  const verifierWorker = orderedWorkers.find((worker) => worker.isVerifier || worker.phase === 'verifier' || worker.roleName === plan.verifierRole);
  const nonVerifierWorkers = orderedWorkers.filter((worker) => worker !== verifierWorker);
  const leadWorker = nonVerifierWorkers[0];
  const restWorkers = nonVerifierWorkers.slice(1);
  const orderedNodeIds = orderedWorkers.map((worker, index) => planWorkerId(worker, index));
  const nodeIdForWorker = (worker: PlanWorker): string => {
    const index = orderedWorkers.indexOf(worker);
    return planWorkerId(worker, index >= 0 ? index : 0);
  };
  const moveContext = (nodeId: string) => {
    const index = orderedNodeIds.indexOf(nodeId);
    const previousNodeId = index > 0 ? orderedNodeIds[index - 1] : null;
    const nextBeforeNodeId = index < orderedNodeIds.length - 2 ? orderedNodeIds[index + 2] : index === orderedNodeIds.length - 2 ? null : undefined;
    return { previousNodeId, nextBeforeNodeId };
  };

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
              {tt('roles.reasons', 'Reasoning')}
              <ChevronDown className={cn('h-3 w-3 transition-transform', reasonsOpen && 'rotate-180')} />
            </button>
          )}
        </div>
        {plan.verifierRole && (
          <span className="text-2xs text-muted-foreground">
            {tt('roles.verifier', 'Verifier')}: {plan.verifierRole}
          </span>
        )}
        {editControl && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              data-testid="orchestration-plan-edit-toggle"
              className="h-8 w-8"
              onClick={editControl.onToggleEditing}
              title={tt('roles.planEdit.edit', 'Edit plan')}
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            {editControl.editing && (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  data-testid="orchestration-plan-save-edits"
                  className="h-8 w-8"
                  onClick={editControl.onSave}
                  title={tt('roles.planEdit.save', 'Save plan edits')}
                >
                  <Save className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={editControl.onCancel}
                  title={tt('roles.planEdit.cancel', 'Cancel plan edits')}
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={editControl.onRegenerate}
                  title={tt('roles.planEdit.regenerate', 'Regenerate plan')}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
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
          label={tt('roles.lead', 'Lead')}
          worker={{ ...leadWorker }}
          isVerifier={false}
          nodeId={nodeIdForWorker(leadWorker)}
          editControl={editControl}
          tt={tt}
          {...moveContext(nodeIdForWorker(leadWorker))}
        />
      )}

      {/* Remaining workers with connector */}
      {restWorkers.length > 0 && (
        <div className="ml-3 border-l-2 border-black/10 dark:border-white/10 pl-3 space-y-2">
          {restWorkers.map((worker) => (
            <WorkerCard
              key={nodeIdForWorker(worker)}
              label={tt('roles.worker', 'Worker')}
              worker={worker}
              isVerifier={false}
              nodeId={nodeIdForWorker(worker)}
              editControl={editControl}
              tt={tt}
              {...moveContext(nodeIdForWorker(worker))}
            />
          ))}
        </div>
      )}

      {/* Verifier (separate from workers list) */}
      {plan.verifierRole && (
        <div className={cn(restWorkers.length === 0 && 'ml-3 border-l-2 border-black/10 dark:border-white/10 pl-3')}>
          <WorkerCard
            label={tt('roles.verifier', 'Verifier')}
            worker={verifierWorker ?? { roleName: plan.verifierRole, task: tt('roles.verifierTask', 'Verify completion and quality'), effort: undefined }}
            isVerifier
            nodeId={verifierWorker ? nodeIdForWorker(verifierWorker) : 'verifier'}
            editControl={verifierWorker ? editControl : undefined}
            tt={tt}
            {...(verifierWorker ? moveContext(nodeIdForWorker(verifierWorker)) : {})}
          />
        </div>
      )}
    </div>
  );
}

export default OrchestrationPlanView;
