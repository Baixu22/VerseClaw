/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronLeft, Clipboard, Copy, HelpCircle, ListChecks, SlidersHorizontal, Table as TableIcon, CloudSun, Info, AlertTriangle, BookOpen, Loader2, LayoutGrid, KeyRound, BarChart3, Image as ImageIcon, Code2, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ToolUiPlanView, type ToolUiPlanTodoStatus } from './plan-view';
import { TestResults, type TestResultSuite, type TestStatus } from '@/components/ai-elements/test-results';
import { StackTrace, type StackTraceProps } from '@/components/ai-elements/stack-trace';
import { ChainOfThought, type ChainOfThoughtStep } from '@/components/ai-elements/chain-of-thought';
import { Task as AiTask, type TaskItem } from '@/components/ai-elements/task';
import { Reasoning } from '@/components/ai-elements/reasoning';
import { ApprovalCard } from './approval-card';
import { CodeDiff } from './code-diff';
import { ProgressTracker } from './progress-tracker';
import { Terminal } from './terminal';

type PlanTodoStatus = ToolUiPlanTodoStatus;

type PlanInteraction = {
  type: 'plan';
  id: string;
  title: string;
  description?: string;
  todos: Array<{
    id: string;
    label: string;
    status: PlanTodoStatus;
    description?: string;
  }>;
  maxVisibleTodos?: number;
};

type OptionListSelection = string | string[] | null;

type OptionListInteraction = {
  type: 'option-list';
  id: string;
  title?: string;
  description?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  selectionMode?: 'single' | 'multi';
  minSelections?: number;
  maxSelections?: number;
  defaultValue?: OptionListSelection;
  choice?: OptionListSelection;
};

type QuestionFlowStep = {
  id: string;
  title: string;
  description?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  selectionMode?: 'single' | 'multi';
};

type QuestionFlowInteraction = {
  type: 'question-flow';
  id: string;
  step?: number;
  title?: string;
  description?: string;
  options?: QuestionFlowStep['options'];
  selectionMode?: 'single' | 'multi';
  steps?: QuestionFlowStep[];
  choice?: {
    title: string;
    summary: Array<{ label: string; value: string }>;
  };
};

type PreferenceItem =
  | {
      id: string;
      type: 'switch';
      label: string;
      description?: string;
      defaultChecked?: boolean;
    }
  | {
      id: string;
      type: 'toggle';
      label: string;
      description?: string;
      options: Array<{ value: string; label: string }>;
      defaultValue?: string;
    }
  | {
      id: string;
      type: 'select';
      label: string;
      description?: string;
      selectOptions: Array<{ value: string; label: string }>;
      defaultSelected?: string;
    };

type PreferencesValue = Record<string, string | boolean>;

type PreferencesPanelInteraction = {
  type: 'preferences-panel';
  id: string;
  title?: string;
  sections: Array<{
    heading?: string;
    items: PreferenceItem[];
  }>;
  choice?: PreferencesValue;
  error?: Record<string, string>;
};

type TableInteraction = {
  type: 'table';
  id: string;
  title?: string;
  description?: string;
  columns: Array<{ key: string; label?: string; align?: 'left' | 'right' | 'center' }>;
  rows: Array<Record<string, unknown>>;
};

type WeatherInteraction = {
  type: 'weather';
  id: string;
  location: string;
  temperature?: number;
  unit?: 'c' | 'f';
  condition?: string;
  icon?: string;
  humidity?: number;
  windSpeed?: number;
  forecast?: Array<{ day: string; condition: string; high: number; low: number }>;
};

type DirectiveTextInteraction = {
  type: 'directive-text';
  id: string;
  variant: 'info' | 'warning' | 'success' | 'danger' | 'neutral';
  title?: string;
  text: string;
  icon?: string;
};

type SourceInteraction = {
  type: 'source';
  id: string;
  sources: Array<{
    id: string;
    title: string;
    url?: string;
    snippet?: string;
    author?: string;
    publishedAt?: string;
  }>;
};

type ProgressInteraction = {
  type: 'progress';
  id: string;
  label?: string;
  value: number;
  max?: number;
  unit?: string;
  status?: 'active' | 'completed' | 'error' | 'paused';
};

type StatusGridInteraction = {
  type: 'status-grid';
  id: string;
  title?: string;
  items: Array<{
    id: string;
    label: string;
    value: string | number;
    status?: 'ok' | 'warning' | 'error' | 'idle';
    icon?: string;
  }>;
};

type AlertInteraction = {
  type: 'alert';
  id: string;
  variant: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  message: string;
  dismissible?: boolean;
};

type KeyValueInteraction = {
  type: 'key-value';
  id: string;
  title?: string;
  entries: Array<{ key: string; value: string; mono?: boolean }>;
};

type ChartInteraction = {
  type: 'chart';
  id: string;
  title?: string;
  chartType: 'bar' | 'line' | 'pie' | 'area';
  labels: string[];
  series: Array<{ name?: string; data: number[] }>;
};

type ImageGalleryInteraction = {
  type: 'image-gallery';
  id: string;
  title?: string;
  images: Array<{ url: string; alt?: string; caption?: string }>;
};

type CodeBlockInteraction = {
  type: 'code-block';
  id: string;
  language?: string;
  filename?: string;
  code: string;
  runnable?: boolean;
};

type TestResultsInteraction = {
  type: 'test-results';
  id: string;
  title?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    running?: number;
    durationMs?: number;
  };
  suites: TestResultSuite[];
};

type StackTraceInteraction = {
  type: 'stack-trace';
  id: string;
  title?: string;
  errorType?: string;
  message?: string;
  stack: string;
  source?: StackTraceProps['source'];
};

type ChainOfThoughtInteraction = {
  type: 'chain-of-thought';
  id: string;
  title?: string;
  defaultOpen?: boolean;
  steps: ChainOfThoughtStep[];
};

type TaskInteraction = {
  type: 'task';
  id: string;
  title: string;
  defaultOpen?: boolean;
  items: TaskItem[];
};

type ReasoningInteraction = {
  type: 'reasoning';
  id: string;
  title?: string;
  summary?: string;
  text?: string;
  defaultOpen?: boolean;
  loading?: boolean;
};

type ApprovalCardInteraction = {
  type: 'approval-card';
  id: string;
  title: string;
  description?: string;
  icon?: string;
  metadata?: Array<{ key: string; value: string }>;
  variant?: 'default' | 'destructive';
  confirmLabel?: string;
  cancelLabel?: string;
  choice?: 'approved' | 'denied';
};

type TerminalInteraction = {
  type: 'terminal';
  id: string;
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  cwd?: string;
  truncated?: boolean;
};

type CodeDiffInteraction = {
  type: 'code-diff';
  id: string;
  oldCode?: string;
  newCode?: string;
  patch?: string;
  language: string;
  filename?: string;
};

type ProgressTrackerInteraction = {
  type: 'progress-tracker';
  id: string;
  steps: Array<{
    id: string;
    label: string;
    description?: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
  }>;
  elapsedTime?: number;
  choice?: {
    outcome: 'success' | 'partial' | 'failed' | 'cancelled';
    summary: string;
    identifiers?: Record<string, string>;
    at: string;
  };
};

export type ToolUiInteraction =
  | PlanInteraction
  | OptionListInteraction
  | QuestionFlowInteraction
  | PreferencesPanelInteraction
  | TableInteraction
  | WeatherInteraction
  | DirectiveTextInteraction
  | SourceInteraction
  | ProgressInteraction
  | StatusGridInteraction
  | AlertInteraction
  | KeyValueInteraction
  | ChartInteraction
  | ImageGalleryInteraction
  | CodeBlockInteraction
  | TestResultsInteraction
  | StackTraceInteraction
  | ChainOfThoughtInteraction
  | TaskInteraction
  | ReasoningInteraction
  | ApprovalCardInteraction
  | TerminalInteraction
  | CodeDiffInteraction
  | ProgressTrackerInteraction;

type ToolUseLike = {
  id?: string;
  name: string;
  input: unknown;
};

type AgentInteractionRendererProps = {
  interactions: ToolUiInteraction[];
  canSubmit?: boolean;
  onSubmitResponse?: (text: string) => void;
  onDraftResponse?: (text: string) => void;
  onOpenFilePath?: (path: string) => void;
};

type ActionFooterProps = {
  canSubmit?: boolean;
  disabled?: boolean;
  responseText: string;
  onSubmitResponse?: (text: string) => void;
  onDraftResponse?: (text: string) => void;
};

type ParsedToolUiContent = {
  displayText: string;
  interactions: ToolUiInteraction[];
};

const TOOL_UI_FENCE_RE = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
const TOOL_UI_WRAPPER_KEYS = [
  'toolUi',
  'tool_ui',
  'toolUI',
  'componentProps',
  'props',
  'args',
  'arguments',
  'parameters',
  'input',
  'result',
  'payload',
  'data',
] as const;
const TOOL_UI_COLLECTION_KEYS = [
  'interactions',
  'interaction',
  'components',
  'component',
  'cards',
  'items',
  'tools',
  'tool_calls',
  'toolCalls',
  'results',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@tool-ui\//, '')
    .replace(/^tool-ui[.:/]/, '')
    .replace(/^tool_ui[.:/]/, '')
    .replace(/_/g, '-');
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_()[\]{}"']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeInteractionType(value: unknown, payload: Record<string, unknown>): ToolUiInteraction['type'] | null {
  const normalized = normalizeType(value);
  if (normalized === 'plan' || normalized === 'show-plan' || normalized === 'task-plan' || normalized === 'todo-list') return 'plan';
  if (normalized === 'option-list' || normalized === 'options' || normalized === 'option-list-tool' || normalized === 'choice-list') return 'option-list';
  if (normalized === 'question-flow' || normalized === 'question' || normalized === 'question-flow-tool' || normalized === 'questionnaire') return 'question-flow';
  if (normalized === 'preferences-panel' || normalized === 'preferences' || normalized === 'preference-panel' || normalized === 'settings-panel') return 'preferences-panel';
  if (normalized === 'table' || normalized === 'data-table' || normalized === 'grid-table') return 'table';
  if (normalized === 'weather' || normalized === 'weather-card' || normalized === 'weather-info') return 'weather';
  if (normalized === 'directive-text' || normalized === 'directive' || normalized === 'callout' || normalized === 'notice') return 'directive-text';
  if (normalized === 'source' || normalized === 'sources' || normalized === 'citations' || normalized === 'references') return 'source';
  if (normalized === 'progress' || normalized === 'progress-bar' || normalized === 'progress-indicator') return 'progress';
  if (normalized === 'status-grid' || normalized === 'status-cards' || normalized === 'metrics-grid' || normalized === 'stats-grid') return 'status-grid';
  if (normalized === 'alert' || normalized === 'alert-banner' || normalized === 'notification') return 'alert';
  if (normalized === 'key-value' || normalized === 'keyvalue' || normalized === 'definition-list' || normalized === 'details-list') return 'key-value';
  if (normalized === 'chart' || normalized === 'chart-card' || normalized === 'graph') return 'chart';
  if (normalized === 'image-gallery' || normalized === 'gallery' || normalized === 'image-grid') return 'image-gallery';
  if (normalized === 'code-block' || normalized === 'code-snippet' || normalized === 'code') return 'code-block';
  if (normalized === 'test-results' || normalized === 'test-result' || normalized === 'tests' || normalized === 'test-report') return 'test-results';
  if (normalized === 'stack-trace' || normalized === 'stacktrace' || normalized === 'error-stack' || normalized === 'exception') return 'stack-trace';
  if (normalized === 'chain-of-thought' || normalized === 'cot' || normalized === 'reasoning-steps' || normalized === 'thought-chain') return 'chain-of-thought';
  if (normalized === 'task' || normalized === 'task-card' || normalized === 'task-report') return 'task';
  if (normalized === 'reasoning' || normalized === 'thinking' || normalized === 'thought') return 'reasoning';
  if (normalized === 'approval-card' || normalized === 'approval') return 'approval-card';
  if (normalized === 'terminal' || normalized === 'terminal-output') return 'terminal';
  if (normalized === 'code-diff' || normalized === 'diff') return 'code-diff';
  if (normalized === 'progress-tracker' || normalized === 'run-progress') return 'progress-tracker';
  // Shape-based fallbacks
  if (Array.isArray(payload.suites) || (isRecord(payload.summary) && Array.isArray(payload.tests))) return 'test-results';
  if (typeof payload.stack === 'string' || typeof payload.trace === 'string') return 'stack-trace';
  if (Array.isArray(payload.todos) || Array.isArray(payload.tasks)) return 'plan';
  if (Array.isArray(payload.sections) || Array.isArray(payload.preferences)) return 'preferences-panel';
  if (Array.isArray(payload.steps) || (Array.isArray(payload.options) && payload.step !== undefined)) return 'question-flow';
  if (Array.isArray(payload.options)) return 'option-list';
  if (Array.isArray(payload.columns) && Array.isArray(payload.rows)) return 'table';
  if (typeof payload.temperature === 'number' || (typeof payload.location === 'string' && typeof payload.condition === 'string')) return 'weather';
  if (Array.isArray(payload.sources) || Array.isArray(payload.citations)) return 'source';
  if (typeof payload.value === 'number' && (typeof payload.max === 'number' || typeof payload.label === 'string')) return 'progress';
  if (Array.isArray(payload.entries) && payload.entries.length > 0) return 'key-value';
  if (Array.isArray(payload.images)) return 'image-gallery';
  if (typeof payload.code === 'string') return 'code-block';
  if (Array.isArray(payload.labels) && Array.isArray(payload.series)) return 'chart';
  if (Array.isArray(payload.items) && payload.items.length > 0 && typeof payload.items[0] === 'object') return 'status-grid';
  if (typeof payload.message === 'string' && typeof payload.variant === 'string') return 'alert';
  return null;
}

function normalizeSelectionMode(value: unknown): 'single' | 'multi' | undefined {
  const normalized = normalizeType(value);
  if (normalized === 'single') return 'single';
  if (normalized === 'multi' || normalized === 'multiple') return 'multi';
  return undefined;
}

function normalizePlanStatus(value: unknown): PlanTodoStatus {
  const normalized = normalizeType(value);
  if (normalized === 'in-progress' || normalized === 'running') return 'in_progress';
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') return 'completed';
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'error') return 'cancelled';
  return 'pending';
}

function normalizeSelection(value: unknown): OptionListSelection | undefined {
  if (value == null) return value === null ? null : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length > 0 ? items : null;
  }
  return undefined;
}

function parseOptions(value: unknown): QuestionFlowStep['options'] {
  const entries = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([id, entry]) => isRecord(entry) ? { id, ...entry } : { id, label: entry })
      : [];
  return entries
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        return label ? { id: normalizeId(label) || `option-${index + 1}`, label } : null;
      }
      if (!isRecord(entry)) return null;
      const id = asString(entry.id) ?? asString(entry.value) ?? asString(entry.key) ?? `option-${index + 1}`;
      const label = asString(entry.label) ?? asString(entry.title) ?? asString(entry.text) ?? asString(entry.name) ?? id;
      return {
        id,
        label,
        description: asString(entry.description),
        disabled: asBoolean(entry.disabled),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
}

function parsePlan(payload: Record<string, unknown>, fallbackId: string): PlanInteraction | null {
  const todoSource = payload.todos ?? payload.tasks ?? payload.items ?? (payload.type || payload.component ? payload.steps : undefined);
  const todos = Array.isArray(todoSource)
    ? todoSource
      .map((entry, index) => {
        if (typeof entry === 'string') {
          const label = entry.trim();
          return label ? {
            id: `todo-${index + 1}`,
            label,
            status: 'pending' as PlanTodoStatus,
          } : null;
        }
        if (!isRecord(entry)) return null;
        const label = asString(entry.label) ?? asString(entry.title) ?? asString(entry.text) ?? asString(entry.task) ?? asString(entry.content);
        if (!label) return null;
        return {
          id: asString(entry.id) ?? `todo-${index + 1}`,
          label,
          status: normalizePlanStatus(entry.status),
          description: asString(entry.description),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    : [];
  const title = asString(payload.title) ?? asString(payload.name) ?? asString(payload.heading);
  if (!title || todos.length === 0) return null;
  return {
    type: 'plan',
    id: asString(payload.id) ?? fallbackId,
    title,
    description: asString(payload.description),
    todos,
    maxVisibleTodos: asNumber(payload.maxVisibleTodos),
  };
}

function parseOptionList(payload: Record<string, unknown>, fallbackId: string): OptionListInteraction | null {
  const options = parseOptions(payload.options);
  if (options.length === 0) return null;
  return {
    type: 'option-list',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title) ?? asString(payload.prompt),
    description: asString(payload.description),
    options,
    selectionMode: normalizeSelectionMode(payload.selectionMode) ?? normalizeSelectionMode(payload.mode),
    minSelections: asNumber(payload.minSelections),
    maxSelections: asNumber(payload.maxSelections),
    defaultValue: normalizeSelection(payload.defaultValue),
    choice: normalizeSelection(payload.choice),
  };
}

function parseQuestionFlow(payload: Record<string, unknown>, fallbackId: string): QuestionFlowInteraction | null {
  if (isRecord(payload.choice)) {
    const summary = Array.isArray(payload.choice.summary)
      ? payload.choice.summary
        .map((entry) => {
          if (!isRecord(entry)) return null;
          const label = asString(entry.label);
          const value = asString(entry.value);
          return label && value ? { label, value } : null;
        })
        .filter((entry): entry is { label: string; value: string } => entry != null)
      : [];
    const title = asString(payload.choice.title);
    if (title && summary.length > 0) {
      return {
        type: 'question-flow',
        id: asString(payload.id) ?? fallbackId,
        choice: { title, summary },
      };
    }
  }

  if (Array.isArray(payload.steps)) {
    const steps = payload.steps
      .map((entry, index) => {
        if (!isRecord(entry)) return null;
        const title = asString(entry.title);
        const options = parseOptions(entry.options);
        if (!title || options.length === 0) return null;
        return {
          id: asString(entry.id) ?? `step-${index + 1}`,
          title,
          description: asString(entry.description),
          options,
          selectionMode: normalizeSelectionMode(entry.selectionMode) ?? normalizeSelectionMode(entry.mode),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
    if (steps.length > 0) {
      return {
        type: 'question-flow',
        id: asString(payload.id) ?? fallbackId,
        steps,
      };
    }
  }

  const options = parseOptions(payload.options);
  const title = asString(payload.title) ?? asString(payload.prompt);
  if (!title || options.length === 0) return null;
  return {
    type: 'question-flow',
    id: asString(payload.id) ?? fallbackId,
    step: asNumber(payload.step),
    title,
    description: asString(payload.description),
    options,
    selectionMode: normalizeSelectionMode(payload.selectionMode) ?? normalizeSelectionMode(payload.mode),
  };
}

function parsePreferenceItem(entry: unknown, index: number): PreferenceItem | null {
  if (!isRecord(entry)) return null;
  const id = asString(entry.id) ?? `preference-${index + 1}`;
  const label = asString(entry.label) ?? asString(entry.title);
  if (!label) return null;
  const type = normalizeType(entry.type);
  if (type === 'switch' || type === 'boolean') {
    return {
      id,
      type: 'switch',
      label,
      description: asString(entry.description),
      defaultChecked: asBoolean(entry.defaultChecked) ?? asBoolean(entry.defaultValue),
    };
  }
  if (type === 'toggle') {
    const options = parseValueOptions(entry.options);
    if (options.length < 2) return null;
    return {
      id,
      type: 'toggle',
      label,
      description: asString(entry.description),
      options,
      defaultValue: asString(entry.defaultValue),
    };
  }
  if (type === 'select') {
    const selectOptions = parseValueOptions(entry.selectOptions ?? entry.options);
    if (selectOptions.length === 0) return null;
    return {
      id,
      type: 'select',
      label,
      description: asString(entry.description),
      selectOptions,
      defaultSelected: asString(entry.defaultSelected) ?? asString(entry.defaultValue),
    };
  }
  return null;
}

function parseValueOptions(value: unknown): Array<{ value: string; label: string }> {
  const entries = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([entryValue, entry]) => isRecord(entry) ? { value: entryValue, ...entry } : { value: entryValue, label: entry })
      : [];
  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        return label ? { value: normalizeId(label) || label, label } : null;
      }
      if (!isRecord(entry)) return null;
      const optionValue = asString(entry.value) ?? asString(entry.id);
      const label = asString(entry.label) ?? optionValue;
      return optionValue && label ? { value: optionValue, label } : null;
    })
    .filter((entry): entry is { value: string; label: string } => entry != null);
}

function parsePreferencesPanel(payload: Record<string, unknown>, fallbackId: string): PreferencesPanelInteraction | null {
  const sectionSource = Array.isArray(payload.sections)
    ? payload.sections
    : Array.isArray(payload.preferences) || Array.isArray(payload.items)
      ? [{ heading: payload.title, items: payload.preferences ?? payload.items }]
      : [];
  if (!Array.isArray(sectionSource)) return null;
  const sections = sectionSource
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const items = Array.isArray(entry.items)
        ? entry.items
          .map(parsePreferenceItem)
          .filter((item): item is PreferenceItem => item != null)
        : [];
      return items.length > 0 ? { heading: asString(entry.heading), items } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  if (sections.length === 0) return null;
  return {
    type: 'preferences-panel',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title),
    sections,
    choice: isRecord(payload.choice) ? normalizePreferencesValue(payload.choice) : undefined,
    error: isRecord(payload.error) ? normalizeStringRecord(payload.error) : undefined,
  };
}

function normalizePreferencesValue(value: Record<string, unknown>): PreferencesValue {
  const output: PreferencesValue = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'boolean') {
      output[key] = entry;
    }
  }
  return output;
}

function normalizeStringRecord(value: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') output[key] = entry;
  }
  return output;
}

function unwrapCandidate(candidate: unknown): Record<string, unknown> | null {
  if (!isRecord(candidate)) return null;
  const inheritedType = candidate.type ?? candidate.kind ?? candidate.component ?? candidate.name ?? candidate.tool ?? candidate.tool_name ?? candidate.toolName;
  const inheritedId = candidate.id ?? candidate.toolCallId ?? candidate.tool_call_id;
  for (const key of TOOL_UI_WRAPPER_KEYS) {
    const nested = candidate[key];
    if (isRecord(nested)) {
      return unwrapCandidate({
        ...nested,
        type: nested.type ?? inheritedType,
        id: nested.id ?? inheritedId,
      });
    }
  }
  return candidate;
}

function parseTable(payload: Record<string, unknown>, fallbackId: string): TableInteraction | null {
  const rawColumns = Array.isArray(payload.columns) ? payload.columns : [];
  const columns: TableInteraction['columns'] = rawColumns
    .map((col, i): TableInteraction['columns'][number] | null => {
      if (typeof col === 'string') return { key: col, label: col };
      if (isRecord(col)) {
        const key = asString(col.key) ?? asString(col.field) ?? asString(col.name) ?? `col-${i + 1}`;
        if (!key) return null;
        const align = (() => {
          const a = normalizeType(col.align);
          if (a === 'right' || a === 'center') return a;
          return 'left';
        })();
        return { key, label: asString(col.label) ?? asString(col.title) ?? key, align };
      }
      return null;
    })
    .filter((c): c is TableInteraction['columns'][number] => c != null);
  if (columns.length === 0) return null;
  const rows: Array<Record<string, unknown>> = (Array.isArray(payload.rows) ? payload.rows : [])
    .filter(isRecord)
    .map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) out[col.key] = row[col.key] ?? row[`col_${col.key}`] ?? '';
      return out;
    });
  return {
    type: 'table',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title),
    description: asString(payload.description),
    columns,
    rows,
  };
}

function parseWeather(payload: Record<string, unknown>, fallbackId: string): WeatherInteraction | null {
  const location = asString(payload.location) ?? asString(payload.city) ?? asString(payload.place);
  if (!location) return null;
  const unit = normalizeType(payload.unit) === 'f' ? 'f' : 'c';
  const forecast = Array.isArray(payload.forecast)
    ? payload.forecast
      .filter(isRecord)
      .map((f) => ({
        day: asString(f.day) ?? '',
        condition: asString(f.condition) ?? asString(f.text) ?? '',
        high: asNumber(f.high) ?? asNumber(f.tempMax) ?? 0,
        low: asNumber(f.low) ?? asNumber(f.tempMin) ?? 0,
      }))
    : undefined;
  return {
    type: 'weather',
    id: asString(payload.id) ?? fallbackId,
    location,
    temperature: asNumber(payload.temperature) ?? asNumber(payload.temp),
    unit,
    condition: asString(payload.condition) ?? asString(payload.summary),
    icon: asString(payload.icon) ?? asString(payload.weatherIcon),
    humidity: asNumber(payload.humidity),
    windSpeed: asNumber(payload.windSpeed) ?? asNumber(payload.wind_speed),
    forecast,
  };
}

function parseDirectiveText(payload: Record<string, unknown>, fallbackId: string): DirectiveTextInteraction | null {
  const text = asString(payload.text) ?? asString(payload.message) ?? asString(payload.content);
  if (!text) return null;
  const variantRaw = normalizeType(payload.variant);
  const variant: DirectiveTextInteraction['variant'] =
    variantRaw === 'warning' ? 'warning'
    : variantRaw === 'success' ? 'success'
    : variantRaw === 'danger' || variantRaw === 'error' ? 'danger'
    : variantRaw === 'neutral' ? 'neutral'
    : 'info';
  return {
    type: 'directive-text',
    id: asString(payload.id) ?? fallbackId,
    variant,
    title: asString(payload.title),
    text,
    icon: asString(payload.icon),
  };
}

function parseSource(payload: Record<string, unknown>, fallbackId: string): SourceInteraction | null {
  const rawSources = Array.isArray(payload.sources) ? payload.sources : Array.isArray(payload.citations) ? payload.citations : Array.isArray(payload.references) ? payload.references : [];
  const sources: SourceInteraction['sources'] = rawSources
    .filter(isRecord)
    .map((s, i) => ({
      id: asString(s.id) ?? `source-${i + 1}`,
      title: asString(s.title) ?? asString(s.name) ?? asString(s.label) ?? `Source ${i + 1}`,
      url: asString(s.url) ?? asString(s.link) ?? asString(s.href),
      snippet: asString(s.snippet) ?? asString(s.description) ?? asString(s.summary),
      author: asString(s.author) ?? asString(s.publisher),
      publishedAt: asString(s.publishedAt) ?? asString(s.published_at) ?? asString(s.date),
    }));
  if (sources.length === 0) return null;
  return { type: 'source', id: asString(payload.id) ?? fallbackId, sources };
}

function parseProgress(payload: Record<string, unknown>, fallbackId: string): ProgressInteraction | null {
  const value = asNumber(payload.value) ?? asNumber(payload.current) ?? asNumber(payload.progress);
  if (value == null) return null;
  const statusRaw = normalizeType(payload.status);
  const status: ProgressInteraction['status'] =
    statusRaw === 'completed' || statusRaw === 'done' ? 'completed'
    : statusRaw === 'error' || statusRaw === 'failed' ? 'error'
    : statusRaw === 'paused' ? 'paused'
    : 'active';
  return {
    type: 'progress',
    id: asString(payload.id) ?? fallbackId,
    label: asString(payload.label) ?? asString(payload.title),
    value,
    max: asNumber(payload.max) ?? asNumber(payload.total) ?? 100,
    unit: asString(payload.unit),
    status,
  };
}

function parseStatusGrid(payload: Record<string, unknown>, fallbackId: string): StatusGridInteraction | null {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items: StatusGridInteraction['items'] = rawItems
    .filter(isRecord)
    .map((it, i): StatusGridInteraction['items'][number] | null => {
      const label = asString(it.label) ?? asString(it.name) ?? asString(it.title);
      if (!label) return null;
      const statusRaw = normalizeType(it.status);
      const status: StatusGridInteraction['items'][number]['status'] =
        statusRaw === 'ok' || statusRaw === 'success' || statusRaw === 'healthy' ? 'ok'
        : statusRaw === 'warning' || statusRaw === 'warn' ? 'warning'
        : statusRaw === 'error' || statusRaw === 'fail' || statusRaw === 'critical' ? 'error'
        : 'idle';
      return {
        id: asString(it.id) ?? `item-${i + 1}`,
        label,
        value: typeof it.value === 'string' ? it.value : (typeof it.value === 'number' ? it.value : String(it.value ?? '')),
        status,
        icon: asString(it.icon),
      };
    })
    .filter((it): it is StatusGridInteraction['items'][number] => it != null);
  if (items.length === 0) return null;
  return { type: 'status-grid', id: asString(payload.id) ?? fallbackId, title: asString(payload.title), items };
}

function parseAlert(payload: Record<string, unknown>, fallbackId: string): AlertInteraction | null {
  const message = asString(payload.message) ?? asString(payload.text);
  if (!message) return null;
  const variantRaw = normalizeType(payload.variant);
  const variant: AlertInteraction['variant'] =
    variantRaw === 'warning' ? 'warning'
    : variantRaw === 'error' || variantRaw === 'danger' ? 'error'
    : variantRaw === 'success' ? 'success'
    : 'info';
  return {
    type: 'alert',
    id: asString(payload.id) ?? fallbackId,
    variant,
    title: asString(payload.title),
    message,
    dismissible: asBoolean(payload.dismissible) ?? true,
  };
}

function parseKeyValue(payload: Record<string, unknown>, fallbackId: string): KeyValueInteraction | null {
  const rawEntries = Array.isArray(payload.entries) ? payload.entries : [];
  const entries: KeyValueInteraction['entries'] = rawEntries
    .filter(isRecord)
    .map((e): KeyValueInteraction['entries'][number] | null => {
      const key = asString(e.key) ?? asString(e.label) ?? asString(e.name);
      const value = asString(e.value) ?? (e.value != null ? String(e.value) : '');
      if (!key) return null;
      return { key, value, mono: asBoolean(e.mono) ?? false };
    })
    .filter((e): e is KeyValueInteraction['entries'][number] => e != null);
  if (entries.length === 0) return null;
  return { type: 'key-value', id: asString(payload.id) ?? fallbackId, title: asString(payload.title), entries };
}

function parseChart(payload: Record<string, unknown>, fallbackId: string): ChartInteraction | null {
  const labels = Array.isArray(payload.labels) ? payload.labels.filter((l): l is string => typeof l === 'string') : [];
  const seriesRaw = Array.isArray(payload.series) ? payload.series : [];
  const series: ChartInteraction['series'] = seriesRaw
    .filter(isRecord)
    .map((s) => ({
      name: asString(s.name) ?? asString(s.label),
      data: Array.isArray(s.data) ? s.data.filter((d): d is number => typeof d === 'number') : [],
    }));
  if (labels.length === 0 || series.length === 0) return null;
  const chartTypeRaw = normalizeType(payload.chartType) ?? normalizeType(payload.chart_type) ?? normalizeType(payload.type);
  const chartType: ChartInteraction['chartType'] =
    chartTypeRaw === 'line' ? 'line'
    : chartTypeRaw === 'pie' ? 'pie'
    : chartTypeRaw === 'area' ? 'area'
    : 'bar';
  return { type: 'chart', id: asString(payload.id) ?? fallbackId, title: asString(payload.title), chartType, labels, series };
}

function parseImageGallery(payload: Record<string, unknown>, fallbackId: string): ImageGalleryInteraction | null {
  const rawImages = Array.isArray(payload.images) ? payload.images : [];
  const images: ImageGalleryInteraction['images'] = rawImages
    .filter(isRecord)
    .map((img): ImageGalleryInteraction['images'][number] | null => {
      const url = asString(img.url) ?? asString(img.src);
      if (!url) return null;
      return { url, alt: asString(img.alt), caption: asString(img.caption) };
    })
    .filter((img): img is ImageGalleryInteraction['images'][number] => img != null);
  if (images.length === 0) return null;
  return { type: 'image-gallery', id: asString(payload.id) ?? fallbackId, title: asString(payload.title), images };
}

function parseCodeBlock(payload: Record<string, unknown>, fallbackId: string): CodeBlockInteraction | null {
  const code = asString(payload.code) ?? asString(payload.content) ?? asString(payload.source);
  if (!code) return null;
  return {
    type: 'code-block',
    id: asString(payload.id) ?? fallbackId,
    language: asString(payload.language) ?? asString(payload.lang),
    filename: asString(payload.filename) ?? asString(payload.file),
    code,
    runnable: asBoolean(payload.runnable) ?? false,
  };
}

function normalizeTestStatus(value: unknown): TestStatus {
  const normalized = normalizeType(value);
  if (normalized === 'passed' || normalized === 'pass' || normalized === 'ok' || normalized === 'success') return 'passed';
  if (normalized === 'failed' || normalized === 'fail' || normalized === 'error') return 'failed';
  if (normalized === 'skipped' || normalized === 'skip' || normalized === 'todo') return 'skipped';
  if (normalized === 'running' || normalized === 'active' || normalized === 'in-progress') return 'running';
  return 'passed';
}

function parseDurationMs(payload: Record<string, unknown>): number | undefined {
  return asNumber(payload.durationMs)
    ?? asNumber(payload.duration_ms)
    ?? asNumber(payload.duration)
    ?? asNumber(payload.timeMs)
    ?? asNumber(payload.time_ms);
}

function parseTestCase(entry: unknown, index: number): TestResultSuite['tests'][number] | null {
  if (typeof entry === 'string') {
    const name = entry.trim();
    return name ? { name, status: 'passed' } : null;
  }
  if (!isRecord(entry)) return null;
  const name = asString(entry.name) ?? asString(entry.title) ?? asString(entry.label) ?? `Test ${index + 1}`;
  const rawError = entry.error ?? entry.failure;
  const error = typeof rawError === 'string'
    ? { message: rawError }
    : isRecord(rawError)
      ? {
        message: asString(rawError.message) ?? asString(rawError.text) ?? asString(entry.message) ?? '',
        stack: asString(rawError.stack) ?? asString(rawError.trace),
      }
      : asString(entry.message)
        ? { message: asString(entry.message) ?? '' }
        : undefined;
  const status = error ? 'failed' : normalizeTestStatus(entry.status ?? entry.state ?? entry.outcome);
  return {
    name,
    status,
    durationMs: parseDurationMs(entry),
    error: error?.message ? error : undefined,
  };
}

function suiteStatusFromTests(tests: TestResultSuite['tests'], fallback: unknown): TestStatus {
  const explicit = normalizeType(fallback);
  if (explicit) return normalizeTestStatus(explicit);
  if (tests.some((test) => test.status === 'failed')) return 'failed';
  if (tests.some((test) => test.status === 'running')) return 'running';
  if (tests.length > 0 && tests.every((test) => test.status === 'skipped')) return 'skipped';
  return 'passed';
}

function parseTestResults(payload: Record<string, unknown>, fallbackId: string): TestResultsInteraction | null {
  const rawSuites = Array.isArray(payload.suites)
    ? payload.suites
    : Array.isArray(payload.tests)
      ? [{ name: asString(payload.title) ?? 'Tests', tests: payload.tests }]
      : [];
  const suites: TestResultSuite[] = rawSuites
    .map((entry, index): TestResultSuite | null => {
      if (!isRecord(entry)) return null;
      const tests = (Array.isArray(entry.tests) ? entry.tests : Array.isArray(entry.cases) ? entry.cases : [])
        .map(parseTestCase)
        .filter((test): test is TestResultSuite['tests'][number] => test != null);
      const name = asString(entry.name) ?? asString(entry.title) ?? `Suite ${index + 1}`;
      return {
        id: asString(entry.id),
        name,
        status: suiteStatusFromTests(tests, entry.status ?? entry.state),
        tests,
      };
    })
    .filter((entry): entry is TestResultSuite => entry != null);

  const computed = suites.flatMap((suite) => suite.tests).reduce((acc, test) => {
    acc.total += 1;
    acc[test.status] += 1;
    return acc;
  }, { total: 0, passed: 0, failed: 0, skipped: 0, running: 0 } as Record<TestStatus | 'total', number>);

  const summary = isRecord(payload.summary) ? payload.summary : {};
  const total = asNumber(summary.total) ?? computed.total;
  if (total === 0 && suites.length === 0) return null;

  return {
    type: 'test-results',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title),
    summary: {
      total,
      passed: asNumber(summary.passed) ?? computed.passed,
      failed: asNumber(summary.failed) ?? computed.failed,
      skipped: asNumber(summary.skipped) ?? computed.skipped,
      running: (asNumber(summary.running) ?? computed.running) || undefined,
      durationMs: parseDurationMs(summary),
    },
    suites,
  };
}

function parseStackTrace(payload: Record<string, unknown>, fallbackId: string): StackTraceInteraction | null {
  const stack = asString(payload.stack) ?? asString(payload.trace) ?? asString(payload.stderr);
  if (!stack) return null;
  const sourceRaw = normalizeType(payload.source);
  const source: StackTraceInteraction['source'] =
    sourceRaw === 'web-preview' ? 'web-preview'
    : sourceRaw === 'tool' ? 'tool'
    : sourceRaw === 'app' ? 'app'
    : undefined;
  return {
    type: 'stack-trace',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title),
    errorType: asString(payload.errorType) ?? asString(payload.error_type) ?? asString(payload.name),
    message: asString(payload.message) ?? asString(payload.errorMessage) ?? asString(payload.error_message),
    stack,
    source,
  };
}

function normalizeCotStatus(value: unknown): ChainOfThoughtStep['status'] {
  const normalized = normalizeType(value);
  if (normalized === 'complete' || normalized === 'completed' || normalized === 'done' || normalized === 'success') return 'complete';
  if (normalized === 'active' || normalized === 'running' || normalized === 'in-progress') return 'active';
  return 'pending';
}

function parseResultLinks(value: unknown): ChainOfThoughtStep['results'] {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry): NonNullable<ChainOfThoughtStep['results']>[number] | null => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        return label ? { label } : null;
      }
      if (!isRecord(entry)) return null;
      const label = asString(entry.label) ?? asString(entry.title) ?? asString(entry.name) ?? asString(entry.url);
      if (!label) return null;
      return { label, url: asString(entry.url) ?? asString(entry.href) };
    })
    .filter((entry): entry is NonNullable<ChainOfThoughtStep['results']>[number] => entry != null);
}

function parseChainOfThought(payload: Record<string, unknown>, fallbackId: string): ChainOfThoughtInteraction | null {
  const rawSteps = Array.isArray(payload.steps) ? payload.steps : [];
  const steps = rawSteps
    .map((entry, index): ChainOfThoughtStep | null => {
      if (typeof entry === 'string') {
        const title = entry.trim();
        return title ? { title, status: index === rawSteps.length - 1 ? 'active' : 'complete' } : null;
      }
      if (!isRecord(entry)) return null;
      const title = asString(entry.title) ?? asString(entry.label) ?? asString(entry.name);
      if (!title) return null;
      return {
        title,
        description: asString(entry.description) ?? asString(entry.detail) ?? asString(entry.text),
        status: normalizeCotStatus(entry.status ?? entry.state),
        icon: asString(entry.icon),
        results: parseResultLinks(entry.results ?? entry.sources),
      };
    })
    .filter((entry): entry is ChainOfThoughtStep => entry != null);
  if (steps.length === 0) return null;
  return {
    type: 'chain-of-thought',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title),
    defaultOpen: asBoolean(payload.defaultOpen),
    steps,
  };
}

function parseTaskFiles(value: unknown): TaskItem['files'] {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry): NonNullable<TaskItem['files']>[number] | null => {
      if (typeof entry === 'string') {
        const path = entry.trim();
        return path ? { path } : null;
      }
      if (!isRecord(entry)) return null;
      const path = asString(entry.path) ?? asString(entry.file) ?? asString(entry.name);
      if (!path) return null;
      return { path, status: asString(entry.status) ?? asString(entry.state) };
    })
    .filter((entry): entry is NonNullable<TaskItem['files']>[number] => entry != null);
}

function parseTask(payload: Record<string, unknown>, fallbackId: string): TaskInteraction | null {
  const title = asString(payload.title) ?? asString(payload.name);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .map((entry, index): TaskItem | null => {
      if (typeof entry === 'string') {
        const label = entry.trim();
        return label ? { label } : null;
      }
      if (!isRecord(entry)) return null;
      const label = asString(entry.label) ?? asString(entry.title) ?? asString(entry.name) ?? `Item ${index + 1}`;
      return {
        label,
        detail: asString(entry.detail) ?? asString(entry.description) ?? asString(entry.text),
        files: parseTaskFiles(entry.files),
      };
    })
    .filter((entry): entry is TaskItem => entry != null);
  if (!title || items.length === 0) return null;
  return {
    type: 'task',
    id: asString(payload.id) ?? fallbackId,
    title,
    defaultOpen: asBoolean(payload.defaultOpen),
    items,
  };
}

function parseReasoning(payload: Record<string, unknown>, fallbackId: string): ReasoningInteraction | null {
  const summary = asString(payload.summary) ?? asString(payload.description);
  const text = asString(payload.text) ?? asString(payload.content) ?? asString(payload.body);
  if (!summary && !text && !asBoolean(payload.loading)) return null;
  return {
    type: 'reasoning',
    id: asString(payload.id) ?? fallbackId,
    title: asString(payload.title),
    summary,
    text,
    defaultOpen: asBoolean(payload.defaultOpen),
    loading: asBoolean(payload.loading),
  };
}

function parseApprovalCard(
  payload: Record<string, unknown>,
  fallbackId: string,
): ApprovalCardInteraction | null {
  const title = asString(payload.title);
  if (!title) return null;
  const metadata = Array.isArray(payload.metadata)
    ? payload.metadata.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const key = asString(entry.key);
      const value = asString(entry.value);
      return key && value != null ? [{ key, value }] : [];
    })
    : undefined;
  const variant = payload.variant === 'destructive' ? 'destructive' : undefined;
  const choice = payload.choice === 'approved' || payload.choice === 'denied'
    ? payload.choice
    : undefined;
  return {
    type: 'approval-card',
    id: asString(payload.id) ?? fallbackId,
    title,
    description: asString(payload.description),
    icon: asString(payload.icon),
    metadata,
    variant,
    confirmLabel: asString(payload.confirmLabel),
    cancelLabel: asString(payload.cancelLabel),
    choice,
  };
}

function parseTerminal(payload: Record<string, unknown>, fallbackId: string): TerminalInteraction | null {
  const command = asString(payload.command);
  if (!command) return null;
  return {
    type: 'terminal',
    id: asString(payload.id) ?? fallbackId,
    command,
    stdout: asString(payload.stdout) ?? asString(payload.output),
    stderr: asString(payload.stderr),
    exitCode: asNumber(payload.exitCode),
    durationMs: asNumber(payload.durationMs),
    cwd: asString(payload.cwd),
    truncated: asBoolean(payload.truncated),
  };
}

function parseCodeDiff(payload: Record<string, unknown>, fallbackId: string): CodeDiffInteraction | null {
  const patch = asString(payload.patch);
  const oldCode = asString(payload.oldCode) ?? asString(payload.original);
  const newCode = asString(payload.newCode) ?? asString(payload.modified);
  if (!patch && oldCode == null && newCode == null) return null;
  return {
    type: 'code-diff',
    id: asString(payload.id) ?? fallbackId,
    patch,
    oldCode,
    newCode,
    language: asString(payload.language) ?? 'text',
    filename: asString(payload.filename) ?? asString(payload.filePath),
  };
}

function parseProgressTracker(
  payload: Record<string, unknown>,
  fallbackId: string,
): ProgressTrackerInteraction | null {
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) return null;
  const steps = payload.steps.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const label = asString(entry.label) ?? asString(entry.title);
    if (!label) return [];
    const rawStatus = normalizeType(entry.status);
    const status = rawStatus === 'running' || rawStatus === 'in-progress'
      ? 'in-progress'
      : rawStatus === 'completed' || rawStatus === 'complete' || rawStatus === 'success'
        ? 'completed'
        : rawStatus === 'failed' || rawStatus === 'error'
          ? 'failed'
          : 'pending';
    return [{
      id: asString(entry.id) ?? `step-${index + 1}`,
      label,
      description: asString(entry.description),
      status,
    }] satisfies ProgressTrackerInteraction['steps'];
  });
  if (steps.length === 0) return null;
  const rawChoice = isRecord(payload.choice) ? payload.choice : undefined;
  const rawOutcome = rawChoice ? normalizeType(rawChoice.outcome) : '';
  const choice = rawChoice
    && ['success', 'partial', 'failed', 'cancelled'].includes(rawOutcome)
    && asString(rawChoice.summary)
    && asString(rawChoice.at)
    ? {
        outcome: rawOutcome as NonNullable<ProgressTrackerInteraction['choice']>['outcome'],
        summary: asString(rawChoice.summary)!,
        identifiers: isRecord(rawChoice.identifiers)
          ? Object.fromEntries(
              Object.entries(rawChoice.identifiers)
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
            )
          : undefined,
        at: asString(rawChoice.at)!,
      }
    : undefined;
  return {
    type: 'progress-tracker',
    id: asString(payload.id) ?? fallbackId,
    steps,
    elapsedTime: asNumber(payload.elapsedTime) ?? asNumber(payload.durationMs),
    choice,
  };
}

export function parseToolUiInteraction(candidate: unknown, fallbackId = 'tool-ui'): ToolUiInteraction | null {
  const payload = unwrapCandidate(candidate);
  if (!payload) return null;
  const type = normalizeInteractionType(payload.type ?? payload.kind ?? payload.component ?? payload.name ?? payload.tool ?? payload.tool_name ?? payload.toolName, payload);
  if (type === 'plan') return parsePlan(payload, fallbackId);
  if (type === 'option-list') return parseOptionList(payload, fallbackId);
  if (type === 'question-flow') return parseQuestionFlow(payload, fallbackId);
  if (type === 'preferences-panel') return parsePreferencesPanel(payload, fallbackId);
  if (type === 'table') return parseTable(payload, fallbackId);
  if (type === 'weather') return parseWeather(payload, fallbackId);
  if (type === 'directive-text') return parseDirectiveText(payload, fallbackId);
  if (type === 'source') return parseSource(payload, fallbackId);
  if (type === 'progress') return parseProgress(payload, fallbackId);
  if (type === 'status-grid') return parseStatusGrid(payload, fallbackId);
  if (type === 'alert') return parseAlert(payload, fallbackId);
  if (type === 'key-value') return parseKeyValue(payload, fallbackId);
  if (type === 'chart') return parseChart(payload, fallbackId);
  if (type === 'image-gallery') return parseImageGallery(payload, fallbackId);
  if (type === 'code-block') return parseCodeBlock(payload, fallbackId);
  if (type === 'test-results') return parseTestResults(payload, fallbackId);
  if (type === 'stack-trace') return parseStackTrace(payload, fallbackId);
  if (type === 'chain-of-thought') return parseChainOfThought(payload, fallbackId);
  if (type === 'task') return parseTask(payload, fallbackId);
  if (type === 'reasoning') return parseReasoning(payload, fallbackId);
  if (type === 'approval-card') return parseApprovalCard(payload, fallbackId);
  if (type === 'terminal') return parseTerminal(payload, fallbackId);
  if (type === 'code-diff') return parseCodeDiff(payload, fallbackId);
  if (type === 'progress-tracker') return parseProgressTracker(payload, fallbackId);
  return null;
}

function parseToolUiInteractionList(candidate: unknown, fallbackId = 'tool-ui', depth = 0): ToolUiInteraction[] {
  if (depth > 4) return [];
  if (Array.isArray(candidate)) {
    return candidate.flatMap((entry, index) => parseToolUiInteractionList(entry, `${fallbackId}-${index + 1}`, depth + 1));
  }

  const direct = parseToolUiInteraction(candidate, fallbackId);
  if (direct) return [direct];
  if (!isRecord(candidate)) return [];

  for (const key of TOOL_UI_COLLECTION_KEYS) {
    const nested = candidate[key];
    if (Array.isArray(nested)) {
      const parsed = parseToolUiInteractionList(nested, fallbackId, depth + 1);
      if (parsed.length > 0) return parsed;
    }
    if (isRecord(nested)) {
      const parsed = parseToolUiInteractionList({
        ...nested,
        type: nested.type ?? candidate.type ?? candidate.kind ?? candidate.component ?? candidate.name,
      }, fallbackId, depth + 1);
      if (parsed.length > 0) return parsed;
    }
  }

  for (const key of TOOL_UI_WRAPPER_KEYS) {
    const nested = candidate[key];
    if (nested == null) continue;
    const parsed = parseToolUiInteractionList({
      ...(isRecord(nested) ? nested : { value: nested }),
      type: isRecord(nested) ? nested.type ?? candidate.type ?? candidate.kind ?? candidate.component ?? candidate.name ?? candidate.tool : candidate.type,
      id: isRecord(nested) ? nested.id ?? candidate.id : candidate.id,
    }, fallbackId, depth + 1);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

function jsonLikeVariants(raw: string): string[] {
  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  if (!trimmed) return [];
  const variants = [trimmed];
  let repaired = trimmed
    .replace(/^\s*json\s*/i, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b|\bNull\b/g, 'null');

  repaired = quoteUnquotedJsonKeys(convertSingleQuotedStrings(repaired));
  if (repaired !== trimmed) variants.push(repaired);
  return Array.from(new Set(variants));
}

function convertSingleQuotedStrings(input: string): string {
  let output = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      output += char;
      continue;
    }
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
      output += '"';
      continue;
    }
    if (char === '"' && inSingle) {
      output += '\\"';
      continue;
    }
    output += char;
  }

  return output;
}

function quoteUnquotedJsonKeys(input: string): string {
  return input.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, (_match, prefix: string, key: string, suffix: string) => {
    return `${prefix}${JSON.stringify(key)}${suffix}`;
  });
}

function extractJsonLikeBody(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) return null;
  const endChar = trimmed[start] === '[' ? ']' : '}';
  const end = trimmed.lastIndexOf(endChar);
  return end > start ? trimmed.slice(start, end + 1) : null;
}

function parseJsonLike(body: string): unknown | null {
  const jsonBody = extractJsonLikeBody(body);
  if (!jsonBody) return null;
  for (const candidate of jsonLikeVariants(jsonBody)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next increasingly relaxed representation.
    }
  }
  return null;
}

function interactionTypeFromFenceInfo(info: string): { allow: boolean; type?: ToolUiInteraction['type'] } {
  const tokens = info
    .trim()
    .split(/[\s,]+/)
    .map((token) => normalizeType(token))
    .filter(Boolean);
  if (tokens.length === 0) return { allow: false };

  const allow = tokens.some((token) => token === 'json' || token === 'tool-ui' || token === 'toolui' || token === 'tool-ui-json')
    || tokens.some((token) => normalizeInteractionType(token, {}) != null);
  const type = tokens
    .map((token) => normalizeInteractionType(token, {}))
    .find((entry): entry is ToolUiInteraction['type'] => entry != null);
  return { allow, type };
}

function parseToolUiFenceBody(body: string, fallbackId: string, typeHint?: ToolUiInteraction['type']): ToolUiInteraction[] {
  const parsed = parseJsonLike(body);
  const candidate = typeHint && isRecord(parsed) && parsed.type == null && parsed.component == null
    ? { ...parsed, type: typeHint }
    : parsed;
  const interactions = parseToolUiInteractionList(candidate, fallbackId);
  if (interactions.length > 0) return interactions;
  if (typeHint) {
    return parseMarkdownInteractions(body, fallbackId, typeHint).interactions;
  }
  return [];
}

export function parseToolUiToolUses(tools: ToolUseLike[]): ToolUiInteraction[] {
  return tools
    .map((tool, index) => {
      const normalizedName = normalizeType(tool.name);
      const knownType = normalizeInteractionType(normalizedName, {});
      if (!knownType) {
        return null;
      }
      const input = typeof tool.input === 'string'
        ? parseJsonLike(tool.input) ?? tool.input
        : tool.input;
      const payload = isRecord(input)
        ? { ...input, type: input.type ?? normalizedName, id: input.id ?? tool.id }
        : { type: normalizedName, id: tool.id };
      return parseToolUiInteraction(payload, tool.id || `tool-ui-tool-${index + 1}`);
    })
    .filter((entry): entry is ToolUiInteraction => entry != null);
}

type MarkdownLine = {
  text: string;
  start: number;
  end: number;
  inFence: boolean;
};

type MarkdownInteractionBlock = {
  start: number;
  end: number;
  interaction: ToolUiInteraction;
};

function parseMarkdownInteractions(
  text: string,
  fallbackId: string,
  forcedType?: ToolUiInteraction['type'],
): ParsedToolUiContent {
  const lines = getMarkdownLines(text);
  const blocks: MarkdownInteractionBlock[] = [];

  if (forcedType) {
    const block = parseForcedMarkdownBlock(lines, forcedType, fallbackId);
    return block ? {
      displayText: removeMarkdownRanges(text, [block]),
      interactions: [block.interaction],
    } : { displayText: text, interactions: [] };
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line || line.inFence || !line.text.trim()) continue;
    const heading = getMarkdownHeading(line.text);
    const questionLine = parseQuestionLine(line.text);
    let block: MarkdownInteractionBlock | null = null;

    if (heading && isPlanHeading(heading)) {
      const endIndex = findMarkdownSectionEnd(lines, index + 1);
      block = parseMarkdownPlanBlock(lines, index, endIndex, `${fallbackId}-plan-${blocks.length + 1}`);
    } else if (heading && isPreferencesHeading(heading)) {
      const endIndex = findMarkdownSectionEnd(lines, index + 1);
      block = parseMarkdownPreferencesBlock(lines, index, endIndex, `${fallbackId}-prefs-${blocks.length + 1}`);
    } else if ((heading && (isQuestionHeading(heading) || isOptionsHeading(heading))) || questionLine) {
      const endIndex = questionLine && !heading
        ? findMarkdownQuestionSectionEnd(lines, index + 1)
        : findMarkdownSectionEnd(lines, index + 1);
      block = parseMarkdownQuestionOrOptionsBlock(lines, index, endIndex, `${fallbackId}-question-${blocks.length + 1}`);
    }

    if (block) {
      blocks.push(block);
      index = lineIndexBeforeOffset(lines, block.end);
    }
  }

  const dedupedBlocks = dedupeMarkdownBlocks(blocks);
  return {
    displayText: removeMarkdownRanges(text, dedupedBlocks),
    interactions: dedupedBlocks.map((block) => block.interaction),
  };
}

function getMarkdownLines(text: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  const parts = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  let offset = 0;
  let inFence = false;

  for (const part of parts) {
    if (part === '') continue;
    const lineText = part.replace(/\r?\n$/, '');
    const isFenceLine = /^\s*(```|~~~)/.test(lineText);
    const lineInFence = inFence || isFenceLine;
    lines.push({
      text: lineText,
      start: offset,
      end: offset + part.length,
      inFence: lineInFence,
    });
    if (isFenceLine) inFence = !inFence;
    offset += part.length;
  }

  return lines;
}

function getMarkdownHeading(line: string): string | null {
  const trimmed = line.trim();
  const atx = trimmed.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/);
  if (atx?.[1]) return cleanMarkdownLabel(atx[1]);
  const bold = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/);
  if (bold?.[1]) return cleanMarkdownLabel(bold[1]);
  const known = trimmed.match(/^([A-Za-z][A-Za-z0-9 /_-]{2,64}|[\u4e00-\u9fffA-Za-z0-9 /_-]{2,64})[:：]\s*$/u);
  if (known?.[1]) return cleanMarkdownLabel(known[1]);
  return null;
}

function cleanMarkdownLabel(value: string): string {
  return value
    .replace(/^[*_`#\s]+|[*_`#\s]+$/g, '')
    .replace(/[:：]\s*$/u, '')
    .trim();
}

function isPlanHeading(value: string): boolean {
  return /\b(plan|task plan|implementation plan|next steps|todo|checklist|steps)\b|计划|步骤|待办|清单|方案/iu.test(value);
}

function isQuestionHeading(value: string): boolean {
  return /\b(question|question flow|clarification|need input|confirm|confirmation)\b|问题|提问|询问|确认|请确认/iu.test(value);
}

function isOptionsHeading(value: string): boolean {
  return /\b(options|choices|choose|select|pick|decision)\b|选项|选择|候选|方案/iu.test(value);
}

function isPreferencesHeading(value: string): boolean {
  return /\b(preferences|preference panel|settings|configuration|prefs)\b|偏好|设置|配置/iu.test(value);
}

function findMarkdownSectionEnd(lines: MarkdownLine[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    if (!lines[index].inFence && getMarkdownHeading(lines[index].text)) {
      return index;
    }
  }
  return lines.length;
}

function findMarkdownQuestionSectionEnd(lines: MarkdownLine[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index++) {
    if (lines[index].inFence) continue;
    const heading = getMarkdownHeading(lines[index].text);
    if (heading && !isOptionsHeading(heading)) return index;
  }
  return lines.length;
}

function lineIndexBeforeOffset(lines: MarkdownLine[], offset: number): number {
  const index = lines.findIndex((line) => line.start >= offset);
  return index === -1 ? lines.length - 1 : Math.max(0, index - 1);
}

function parseForcedMarkdownBlock(
  lines: MarkdownLine[],
  forcedType: ToolUiInteraction['type'],
  fallbackId: string,
): MarkdownInteractionBlock | null {
  const firstContentIndex = lines.findIndex((line) => !line.inFence && line.text.trim());
  if (firstContentIndex === -1) return null;
  const endIndex = lines.length;
  if (forcedType === 'plan') return parseMarkdownPlanBlock(lines, firstContentIndex, endIndex, fallbackId, true);
  if (forcedType === 'preferences-panel') return parseMarkdownPreferencesBlock(lines, firstContentIndex, endIndex, fallbackId, true);
  if (forcedType === 'question-flow' || forcedType === 'option-list') {
    return parseMarkdownQuestionOrOptionsBlock(lines, firstContentIndex, endIndex, fallbackId, forcedType);
  }
  return null;
}

function parseMarkdownPlanBlock(
  lines: MarkdownLine[],
  startIndex: number,
  endIndex: number,
  fallbackId: string,
  forced = false,
): MarkdownInteractionBlock | null {
  const heading = getMarkdownHeading(lines[startIndex].text);
  const todos: PlanInteraction['todos'] = [];
  const descriptionLines: string[] = [];
  let firstTodoIndex = -1;
  let lastTodoIndex = -1;

  for (let index = heading ? startIndex + 1 : startIndex; index < endIndex; index++) {
    const line = lines[index];
    if (!line || line.inFence) continue;
    const todo = parseMarkdownTodoLine(line.text, todos.length);
    if (todo) {
      if (firstTodoIndex === -1) firstTodoIndex = index;
      lastTodoIndex = index;
      todos.push(todo);
      continue;
    }
    if (firstTodoIndex === -1 && line.text.trim()) {
      descriptionLines.push(cleanMarkdownLabel(line.text));
    }
  }

  if (todos.length < (forced ? 1 : 2)) return null;
  const title = heading || descriptionLines.shift() || 'Plan';
  const description = descriptionLines.join(' ').trim() || undefined;
  return {
    start: lines[startIndex].start,
    end: lines[Math.max(startIndex, lastTodoIndex)].end,
    interaction: {
      type: 'plan',
      id: fallbackId,
      title,
      description,
      todos,
    },
  };
}

function parseMarkdownTodoLine(line: string, index: number): PlanInteraction['todos'][number] | null {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX~/>!-])\]\s+(.+?)\s*$/);
  if (!match?.[2]) return null;
  const marker = match[1];
  let label = cleanMarkdownLabel(match[2]);
  let status: PlanTodoStatus = marker.toLowerCase() === 'x'
    ? 'completed'
    : marker === '~' || marker === '/' || marker === '>'
      ? 'in_progress'
      : marker === '!' || marker === '-'
        ? 'cancelled'
        : 'pending';
  const statusPrefix = label.match(/^(?:\((done|completed|complete|in progress|running|cancelled|canceled|blocked)\)|(?:done|completed|complete|in progress|running|cancelled|canceled|blocked)\s*[:：-])\s*/i);
  if (statusPrefix?.[1]) {
    status = normalizePlanStatus(statusPrefix[1]);
    label = label.slice(statusPrefix[0].length).trim();
  }
  return label ? {
    id: `todo-${index + 1}`,
    label,
    status,
  } : null;
}

function parseMarkdownQuestionOrOptionsBlock(
  lines: MarkdownLine[],
  startIndex: number,
  endIndex: number,
  fallbackId: string,
  forcedType?: 'question-flow' | 'option-list',
): MarkdownInteractionBlock | null {
  const heading = getMarkdownHeading(lines[startIndex].text);
  let title = heading && !/^(question|options|choices|问题|选项|选择)$/iu.test(heading) ? heading : '';
  const descriptionLines: string[] = [];
  const options: QuestionFlowStep['options'] = [];
  let explicitQuestion = parseQuestionLine(lines[startIndex].text);
  let reachedOptions = false;
  let lastOptionIndex = -1;

  for (let index = heading ? startIndex + 1 : startIndex; index < endIndex; index++) {
    const line = lines[index];
    if (!line || line.inFence) continue;
    const trimmed = line.text.trim();
    if (!trimmed) continue;
    const nextQuestion = parseQuestionLine(trimmed);
    if (nextQuestion) {
      explicitQuestion = nextQuestion;
      continue;
    }
    if (/^(options|choices|选项|选择|候选)[:：]?\s*$/iu.test(trimmed)) {
      reachedOptions = true;
      continue;
    }
    const option = parseMarkdownOptionLine(trimmed, options.length);
    if (option) {
      reachedOptions = true;
      lastOptionIndex = index;
      options.push(option);
      continue;
    }
    if (!reachedOptions) descriptionLines.push(cleanMarkdownLabel(trimmed));
  }

  title = explicitQuestion || title || descriptionLines.shift() || '';
  if (!title || options.length < 2) return null;
  const description = descriptionLines.join(' ').trim() || undefined;
  const type = forcedType ?? (explicitQuestion || (heading && isQuestionHeading(heading)) || /[?？]\s*$/.test(title) ? 'question-flow' : 'option-list');

  return {
    start: lines[startIndex].start,
    end: lines[Math.max(startIndex, lastOptionIndex)].end,
    interaction: type === 'question-flow'
      ? {
        type: 'question-flow',
        id: fallbackId,
        title,
        description,
        options,
      }
      : {
        type: 'option-list',
        id: fallbackId,
        title,
        description,
        options,
        selectionMode: 'single',
      },
  };
}

function parseQuestionLine(line: string): string | null {
  const match = line.trim().match(/^(?:question|问题|提问|询问)[:：]\s*(.+)$/iu);
  return match?.[1] ? cleanMarkdownLabel(match[1]) : null;
}

function parseMarkdownOptionLine(line: string, index: number): QuestionFlowStep['options'][number] | null {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
  if (!match?.[1]) return null;
  const body = cleanMarkdownLabel(match[1]);
  if (!body) return null;
  const [labelPart, descriptionPart] = body.split(/\s+(?:--|—)\s+/, 2);
  const colonSplit = labelPart.match(/^([^:：]{1,80})[:：]\s+(.+)$/u);
  const label = cleanMarkdownLabel(colonSplit?.[1] ?? labelPart);
  const description = cleanMarkdownLabel(descriptionPart ?? colonSplit?.[2] ?? '');
  return label ? {
    id: normalizeId(label) || `option-${index + 1}`,
    label,
    description: description || undefined,
  } : null;
}

function parseMarkdownPreferencesBlock(
  lines: MarkdownLine[],
  startIndex: number,
  endIndex: number,
  fallbackId: string,
  forced = false,
): MarkdownInteractionBlock | null {
  const heading = getMarkdownHeading(lines[startIndex].text);
  const tableItems = parseMarkdownPreferenceTable(lines, heading ? startIndex + 1 : startIndex, endIndex);
  const bulletItems = tableItems.length > 0 ? [] : parseMarkdownPreferenceBullets(lines, heading ? startIndex + 1 : startIndex, endIndex);
  const items = tableItems.length > 0 ? tableItems : bulletItems;
  if (items.length < (forced ? 1 : 2)) return null;

  return {
    start: lines[startIndex].start,
    end: lines[Math.max(startIndex, endIndex - 1)].end,
    interaction: {
      type: 'preferences-panel',
      id: fallbackId,
      title: heading || 'Preferences',
      sections: [{ items }],
    },
  };
}

function parseMarkdownPreferenceTable(lines: MarkdownLine[], startIndex: number, endIndex: number): PreferenceItem[] {
  for (let index = startIndex; index < endIndex - 1; index++) {
    const header = splitMarkdownTableRow(lines[index].text);
    const separator = splitMarkdownTableRow(lines[index + 1].text);
    if (header.length === 0 || separator.length === 0 || !separator.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) continue;

    const rows: PreferenceItem[] = [];
    for (let rowIndex = index + 2; rowIndex < endIndex; rowIndex++) {
      const cells = splitMarkdownTableRow(lines[rowIndex].text);
      if (cells.length === 0) break;
      const item = preferenceItemFromTableRow(header, cells, rows.length);
      if (item) rows.push(item);
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => cleanMarkdownLabel(cell));
}

function preferenceItemFromTableRow(headers: string[], cells: string[], index: number): PreferenceItem | null {
  const valueFor = (names: string[]) => {
    const headerIndex = headers.findIndex((header) => names.some((name) => normalizeType(header).includes(name)));
    return headerIndex >= 0 ? cells[headerIndex] : '';
  };
  const label = valueFor(['setting', 'preference', 'name', 'label', 'item']) || cells[0];
  if (!label) return null;
  const type = normalizeType(valueFor(['type', 'control']));
  const defaultValue = valueFor(['default', 'value', 'current', 'enabled']);
  const description = valueFor(['description', 'desc', 'hint']) || undefined;
  const options = splitPreferenceOptions(valueFor(['options', 'choices', 'values']));
  return buildPreferenceItem(label, type, defaultValue, options, index, description);
}

function parseMarkdownPreferenceBullets(lines: MarkdownLine[], startIndex: number, endIndex: number): PreferenceItem[] {
  const items: PreferenceItem[] = [];
  for (let index = startIndex; index < endIndex; index++) {
    const line = lines[index];
    if (!line || line.inFence) continue;
    const match = line.text.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/);
    if (!match?.[1]) continue;
    const body = cleanMarkdownLabel(match[1]);
    const parts = body.match(/^([^:：-]{1,80})\s*[:：-]\s*(.+)$/u);
    if (!parts?.[1] || !parts[2]) continue;
    const rawValue = cleanMarkdownLabel(parts[2]);
    const item = buildPreferenceItem(
      parts[1],
      '',
      rawValue.replace(/\((?:default|默认)[:：]\s*.+?\)/iu, '').trim(),
      splitPreferenceOptions(rawValue),
      items.length,
    );
    if (item) items.push(item);
  }
  return items;
}

function splitPreferenceOptions(value: string): string[] {
  const withoutDefault = value.replace(/\((?:default|默认)[:：]\s*.+?\)/iu, '');
  return withoutDefault
    .split(/\s*(?:[,，、/]|\bor\b|\|)\s*/iu)
    .map((entry) => cleanMarkdownLabel(entry))
    .filter(Boolean);
}

function buildPreferenceItem(
  label: string,
  type: string,
  defaultValue: string,
  options: string[],
  index: number,
  description?: string,
): PreferenceItem | null {
  const id = normalizeId(label) || `preference-${index + 1}`;
  const boolValue = parseBooleanish(defaultValue);
  if (type === 'switch' || type === 'boolean' || boolValue !== undefined) {
    return {
      id,
      type: 'switch',
      label,
      description,
      defaultChecked: boolValue ?? false,
    };
  }

  const uniqueOptions = Array.from(new Set(options.length > 1 ? options : defaultValue ? [defaultValue] : []));
  if (uniqueOptions.length < 2) return null;
  const valueOptions = uniqueOptions.map((option, optionIndex) => ({
    value: normalizeId(option) || `value-${optionIndex + 1}`,
    label: option,
  }));
  const defaultSelected = valueOptions.find((option) => option.label === defaultValue || option.value === normalizeId(defaultValue))?.value
    ?? valueOptions[0]?.value;

  if (type === 'toggle' || uniqueOptions.length <= 3) {
    return {
      id,
      type: 'toggle',
      label,
      description,
      options: valueOptions,
      defaultValue: defaultSelected,
    };
  }

  return {
    id,
    type: 'select',
    label,
    description,
    selectOptions: valueOptions,
    defaultSelected,
  };
}

function parseBooleanish(value: string): boolean | undefined {
  const normalized = normalizeType(value).replace(/\s+/g, '-');
  if (['true', 'yes', 'on', 'enabled', 'enable', '1', 'open', '开启', '启用', '是'].includes(normalized)) return true;
  if (['false', 'no', 'off', 'disabled', 'disable', '0', 'closed', '关闭', '禁用', '否'].includes(normalized)) return false;
  return undefined;
}

function dedupeMarkdownBlocks(blocks: MarkdownInteractionBlock[]): MarkdownInteractionBlock[] {
  const output: MarkdownInteractionBlock[] = [];
  for (const block of [...blocks].sort((left, right) => left.start - right.start)) {
    if (output.some((entry) => block.start < entry.end && block.end > entry.start)) continue;
    output.push(block);
  }
  return output;
}

function removeMarkdownRanges(text: string, blocks: MarkdownInteractionBlock[]): string {
  if (blocks.length === 0) return text;
  let output = '';
  let lastIndex = 0;
  for (const block of blocks.sort((left, right) => left.start - right.start)) {
    output += text.slice(lastIndex, block.start);
    lastIndex = block.end;
  }
  output += text.slice(lastIndex);
  return output;
}

export function parseToolUiContent(text: string): ParsedToolUiContent {
  const interactions: ToolUiInteraction[] = [];
  let output = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOOL_UI_FENCE_RE.lastIndex = 0;
  while ((match = TOOL_UI_FENCE_RE.exec(text)) !== null) {
    const fenceInfo = interactionTypeFromFenceInfo(match[1] ?? '');
    const body = match[2]?.trim() ?? '';
    const parsedInteractions = fenceInfo.allow
      ? parseToolUiFenceBody(body, `tool-ui-block-${interactions.length + 1}`, fenceInfo.type)
      : [];

    if (parsedInteractions.length > 0) {
      output += text.slice(lastIndex, match.index);
      lastIndex = match.index + match[0].length;
      interactions.push(...parsedInteractions);
    }
  }
  output += text.slice(lastIndex);
  const markdownFallback = parseMarkdownInteractions(output, `tool-ui-markdown-${interactions.length + 1}`);

  return {
    displayText: markdownFallback.displayText.replace(/\n{3,}/g, '\n\n').trim(),
    interactions: [...interactions, ...markdownFallback.interactions],
  };
}

function selectedIdsFromValue(value: OptionListSelection | undefined): Set<string> {
  if (value == null) return new Set();
  if (typeof value === 'string') return new Set([value]);
  return new Set(value);
}

function setToSelection(selected: Set<string>, mode: 'single' | 'multi'): OptionListSelection {
  if (mode === 'single') return Array.from(selected)[0] ?? null;
  return Array.from(selected);
}

function createInteractionResponse(type: ToolUiInteraction['type'], id: string, action: string, value: unknown): string {
  return [
    'Tool UI response:',
    JSON.stringify({ type, id, action, value }, null, 2),
  ].join('\n');
}

function ActionFooter({
  canSubmit,
  disabled,
  responseText,
  onSubmitResponse,
  onDraftResponse,
}: ActionFooterProps) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const canSend = canSubmit && !!onSubmitResponse;
  const canDraft = !!onDraftResponse;

  const copyResponse = useCallback(async () => {
    await navigator.clipboard.writeText(responseText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [responseText]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void copyResponse()}
        disabled={disabled}
        className="gap-2"
        data-testid="chat-tool-ui-action-copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('toolUi.actions.copied') : t('toolUi.actions.copyResponse')}
      </Button>
      {canDraft && !canSend && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDraftResponse(responseText)}
          disabled={disabled}
          className="gap-2"
          data-testid="chat-tool-ui-action-insert"
        >
          <Clipboard className="h-3.5 w-3.5" />
          {t('toolUi.actions.insertResponse')}
        </Button>
      )}
      {canSend && (
        <Button
          type="button"
          size="sm"
          onClick={() => onSubmitResponse(responseText)}
          disabled={disabled}
          className="gap-2"
          data-testid="chat-tool-ui-action-send"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('toolUi.actions.sendResponse')}
        </Button>
      )}
    </div>
  );
}

function ToolUiShell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="w-full rounded-lg border border-black/10 bg-surface-modal/80 px-4 py-3 shadow-sm dark:border-white/10"
      data-testid="chat-tool-ui-card"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </section>
  );
}

function PlanCard({ interaction }: { interaction: PlanInteraction }) {
  const { t } = useTranslation('chat');

  return (
    <ToolUiShell icon={<ListChecks className="h-3.5 w-3.5" />} label={t('toolUi.plan.label')}>
      <ToolUiPlanView
        title={interaction.title}
        description={interaction.description}
        todos={interaction.todos}
        maxVisibleTodos={interaction.maxVisibleTodos}
      />
    </ToolUiShell>
  );
}

function OptionListCard(props: {
  interaction: OptionListInteraction;
  canSubmit?: boolean;
  onSubmitResponse?: (text: string) => void;
  onDraftResponse?: (text: string) => void;
}) {
  const { interaction, canSubmit, onSubmitResponse, onDraftResponse } = props;
  const { t } = useTranslation('chat');
  const mode = interaction.selectionMode ?? 'multi';
  const [selected, setSelected] = useState(() => selectedIdsFromValue(interaction.choice ?? interaction.defaultValue));
  const minSelections = interaction.minSelections ?? 1;
  const maxSelections = mode === 'single' ? 1 : interaction.maxSelections;
  const receiptSelection = selectedIdsFromValue(interaction.choice);
  const isReceipt = interaction.choice !== undefined;
  const activeSelected = isReceipt ? receiptSelection : selected;
  const disabled = activeSelected.size < minSelections;
  const responseText = createInteractionResponse(interaction.type, interaction.id, 'confirm', setToSelection(activeSelected, mode));

  const toggle = (optionId: string) => {
    if (isReceipt) return;
    setSelected((current) => {
      const next = new Set(current);
      const has = next.has(optionId);
      if (mode === 'single') {
        next.clear();
        if (!has) next.add(optionId);
        return next;
      }
      if (has) {
        next.delete(optionId);
      } else if (!maxSelections || next.size < maxSelections) {
        next.add(optionId);
      }
      return next;
    });
  };

  return (
    <ToolUiShell icon={<HelpCircle className="h-3.5 w-3.5" />} label={t('toolUi.optionList.label')}>
      <div className="space-y-3" data-testid="chat-tool-ui-option-list">
        {(interaction.title || interaction.description) && (
          <div className="space-y-1">
            {interaction.title && <h3 className="text-sm font-semibold text-foreground">{interaction.title}</h3>}
            {interaction.description && <p className="text-sm text-muted-foreground">{interaction.description}</p>}
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-black/10 bg-surface-input/70 dark:border-white/10">
          {interaction.options.map((option, index) => {
            const selectedNow = activeSelected.has(option.id);
            return (
              <div key={option.id}>
                {index > 0 && <Separator />}
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedNow}
                  disabled={option.disabled || isReceipt}
                  onClick={() => toggle(option.id)}
                  data-testid={`chat-tool-ui-option-${option.id}`}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/5 disabled:cursor-default disabled:opacity-70 dark:hover:bg-white/10"
                >
                  <SelectionMark mode={mode} selected={selectedNow} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{option.label}</span>
                    {option.description && <span className="block text-xs leading-5 text-muted-foreground">{option.description}</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        {!isReceipt && (
          <ActionFooter
            canSubmit={canSubmit}
            disabled={disabled}
            responseText={responseText}
            onSubmitResponse={onSubmitResponse}
            onDraftResponse={onDraftResponse}
          />
        )}
        {isReceipt && <p className="text-xs text-muted-foreground">{t('toolUi.receipt.saved')}</p>}
      </div>
    </ToolUiShell>
  );
}

function SelectionMark({ mode, selected }: { mode: 'single' | 'multi'; selected: boolean }) {
  return (
    <span
      className={cn(
        'mt-1 flex h-4 w-4 shrink-0 items-center justify-center border-2',
        mode === 'single' ? 'rounded-full' : 'rounded',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
      )}
    >
      {selected && mode === 'multi' && <Check className="h-3 w-3" />}
      {selected && mode === 'single' && <span className="h-2 w-2 rounded-full bg-current" />}
    </span>
  );
}

function QuestionFlowCard(props: {
  interaction: QuestionFlowInteraction;
  canSubmit?: boolean;
  onSubmitResponse?: (text: string) => void;
  onDraftResponse?: (text: string) => void;
}) {
  const { interaction, canSubmit, onSubmitResponse, onDraftResponse } = props;
  const { t } = useTranslation('chat');
  const steps = interaction.steps ?? (interaction.title && interaction.options ? [{
    id: 'current',
    title: interaction.title,
    description: interaction.description,
    options: interaction.options,
    selectionMode: interaction.selectionMode,
  }] : []);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const currentStep = steps[stepIndex];
  const selected = new Set(currentStep ? answers[currentStep.id] ?? [] : []);
  const isLastStep = stepIndex === steps.length - 1;
  const disabled = selected.size === 0;
  const summary = steps.flatMap((step) => {
    const selectedIds = step.id === currentStep?.id
      ? Array.from(selected)
      : [...(answers[step.id] ?? [])];
    const labels = selectedIds
      .map((id) => step.options.find((option) => option.id === id)?.label)
      .filter((label): label is string => !!label);
    return labels.length ? [{ label: step.title, value: labels.join(', ') }] : [];
  });
  const responseText = createInteractionResponse(interaction.type, interaction.id, 'complete', answers);

  const toggle = (optionId: string) => {
    if (!currentStep) return;
    const mode = currentStep.selectionMode ?? 'single';
    setAnswers((current) => {
      const existing = new Set(current[currentStep.id] ?? []);
      if (mode === 'single') {
        const has = existing.has(optionId);
        existing.clear();
        if (!has) existing.add(optionId);
      } else if (existing.has(optionId)) {
        existing.delete(optionId);
      } else {
        existing.add(optionId);
      }
      return { ...current, [currentStep.id]: Array.from(existing) };
    });
  };

  if (interaction.choice) {
    return (
      <ToolUiShell icon={<HelpCircle className="h-3.5 w-3.5" />} label={t('toolUi.questionFlow.label')}>
        <div className="space-y-3" data-testid="chat-tool-ui-question-flow">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">{interaction.choice.title}</h3>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" />
              {t('toolUi.receipt.complete')}
            </span>
          </div>
          <div className="rounded-lg bg-surface-input/70 p-3">
            {interaction.choice.summary.map((item, index) => (
              <div key={`${item.label}-${index}`} className="py-1">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium text-foreground">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </ToolUiShell>
    );
  }

  if (!currentStep) return null;

  return (
    <ToolUiShell icon={<HelpCircle className="h-3.5 w-3.5" />} label={t('toolUi.questionFlow.label')}>
      <div className="space-y-3" data-testid="chat-tool-ui-question-flow">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium uppercase text-muted-foreground">
            <span>{t('toolUi.questionFlow.step', { current: stepIndex + 1, total: steps.length })}</span>
          </div>
          <div className="flex gap-1">
            {steps.map((step, index) => (
              <span key={step.id} className={cn('h-1.5 flex-1 rounded-full', index <= stepIndex ? 'bg-primary' : 'bg-black/10 dark:bg-white/10')} />
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{currentStep.title}</h3>
          {currentStep.description && <p className="text-sm text-muted-foreground">{currentStep.description}</p>}
        </div>
        <div className="overflow-hidden rounded-lg border border-black/10 bg-surface-input/70 dark:border-white/10">
          {currentStep.options.map((option, index) => (
            <div key={option.id}>
              {index > 0 && <Separator />}
              <button
                type="button"
                disabled={option.disabled}
                onClick={() => toggle(option.id)}
                data-testid={`chat-tool-ui-question-option-${option.id}`}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
              >
                <SelectionMark mode={currentStep.selectionMode ?? 'single'} selected={selected.has(option.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  {option.description && <span className="block text-xs leading-5 text-muted-foreground">{option.description}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            className="gap-1"
            data-testid="chat-tool-ui-question-back"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('toolUi.actions.back')}
          </Button>
          {!isLastStep ? (
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
              data-testid="chat-tool-ui-question-next"
            >
              {t('toolUi.actions.next')}
            </Button>
          ) : (
            <ActionFooter
              canSubmit={canSubmit}
              disabled={disabled || summary.length === 0}
              responseText={responseText}
              onSubmitResponse={onSubmitResponse}
              onDraftResponse={onDraftResponse}
            />
          )}
        </div>
      </div>
    </ToolUiShell>
  );
}

function PreferencesPanelCard(props: {
  interaction: PreferencesPanelInteraction;
  canSubmit?: boolean;
  onSubmitResponse?: (text: string) => void;
  onDraftResponse?: (text: string) => void;
}) {
  const { interaction, canSubmit, onSubmitResponse, onDraftResponse } = props;
  const { t } = useTranslation('chat');
  const initialValue = useMemo(() => buildPreferencesInitialValue(interaction), [interaction]);
  const isReceipt = !!interaction.choice;
  const [value, setValue] = useState<PreferencesValue>(() => interaction.choice ?? initialValue);
  const responseText = createInteractionResponse(interaction.type, interaction.id, 'save', value);

  const setItemValue = (itemId: string, nextValue: string | boolean) => {
    if (isReceipt) return;
    setValue((current) => ({ ...current, [itemId]: nextValue }));
  };

  return (
    <ToolUiShell icon={<SlidersHorizontal className="h-3.5 w-3.5" />} label={t('toolUi.preferencesPanel.label')}>
      <div className="space-y-3" data-testid="chat-tool-ui-preferences-panel">
        {interaction.title && <h3 className="text-sm font-semibold text-foreground">{interaction.title}</h3>}
        <div className="overflow-hidden rounded-lg border border-black/10 bg-surface-input/70 dark:border-white/10">
          {interaction.sections.map((section, sectionIndex) => (
            <div key={`${section.heading ?? 'section'}-${sectionIndex}`} className="p-3">
              {section.heading && <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{section.heading}</p>}
              <div className="space-y-3">
                {section.items.map((item) => (
                  <PreferenceRow
                    key={item.id}
                    item={item}
                    value={value[item.id]}
                    error={interaction.error?.[item.id]}
                    readOnly={isReceipt}
                    onChange={(nextValue) => setItemValue(item.id, nextValue)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {isReceipt ? (
          <p className="text-xs text-muted-foreground">{t(interaction.error ? 'toolUi.receipt.error' : 'toolUi.receipt.saved')}</p>
        ) : (
          <ActionFooter
            canSubmit={canSubmit}
            responseText={responseText}
            onSubmitResponse={onSubmitResponse}
            onDraftResponse={onDraftResponse}
          />
        )}
      </div>
    </ToolUiShell>
  );
}

function buildPreferencesInitialValue(interaction: PreferencesPanelInteraction): PreferencesValue {
  const output: PreferencesValue = {};
  for (const section of interaction.sections) {
    for (const item of section.items) {
      if (item.type === 'switch') output[item.id] = item.defaultChecked ?? false;
      if (item.type === 'toggle') output[item.id] = item.defaultValue ?? item.options[0]?.value ?? '';
      if (item.type === 'select') output[item.id] = item.defaultSelected ?? item.selectOptions[0]?.value ?? '';
    }
  }
  return output;
}

function PreferenceRow({
  item,
  value,
  error,
  readOnly,
  onChange,
}: {
  item: PreferenceItem;
  value: string | boolean | undefined;
  error?: string;
  readOnly: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const { t } = useTranslation('chat');
  const display = displayPreferenceValue(item, value, t);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Label className="text-sm leading-5">{item.label}</Label>
        {error ? <p className="text-xs text-destructive">{error}</p> : item.description && <p className="text-xs leading-5 text-muted-foreground">{item.description}</p>}
      </div>
      {readOnly ? (
        <span className="shrink-0 text-sm font-medium text-muted-foreground">{display}</span>
      ) : (
        <PreferenceControl item={item} value={value} onChange={onChange} />
      )}
    </div>
  );
}

function PreferenceControl({
  item,
  value,
  onChange,
}: {
  item: PreferenceItem;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  if (item.type === 'switch') {
    return (
      <Switch
        checked={typeof value === 'boolean' ? value : false}
        onCheckedChange={onChange}
        aria-label={item.label}
      />
    );
  }

  if (item.type === 'toggle') {
    return (
      <div className="flex flex-wrap gap-1">
        {item.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={value === option.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <Select value={typeof value === 'string' ? value : undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[180px]" aria-label={item.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {item.selectOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function displayPreferenceValue(
  item: PreferenceItem,
  value: string | boolean | undefined,
  t: (key: string) => string,
): string {
  if (item.type === 'switch') return value === true ? t('toolUi.preferencesPanel.on') : t('toolUi.preferencesPanel.off');
  const options = item.type === 'toggle' ? item.options : item.selectOptions;
  const stringValue = typeof value === 'string' ? value : '';
  return options.find((option) => option.value === stringValue)?.label ?? stringValue;
}

/* ---------- New Tool UI card renderers ---------- */

function TableCard({ interaction }: { interaction: TableInteraction }) {
  const { t } = useTranslation('chat');
  return (
    <ToolUiShell icon={<TableIcon className="h-3.5 w-3.5" />} label={interaction.title ?? t('toolUi.table.label', 'Table')}>
      <div data-testid="chat-tool-ui-table">
        {interaction.description && <p className="mb-2 text-xs text-muted-foreground">{interaction.description}</p>}
        <div className="overflow-x-auto rounded-md border border-black/5 dark:border-white/5">
        <table className="w-full text-xs">
          <thead className="bg-black/[0.03] dark:bg-white/[0.04]">
            <tr>
              {interaction.columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2 font-medium text-foreground/80 whitespace-nowrap',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.align !== 'right' && col.align !== 'center' && 'text-left',
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {interaction.rows.map((row, i) => (
              <tr key={i} className="border-t border-black/5 dark:border-white/5">
                {interaction.columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2 text-muted-foreground',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                    )}
                  >
                    {String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </ToolUiShell>
  );
}

function WeatherCard({ interaction }: { interaction: WeatherInteraction }) {
  const { t } = useTranslation('chat');
  const tempDisplay = interaction.temperature != null
    ? `${Math.round(interaction.temperature)}°${interaction.unit === 'f' ? 'F' : 'C'}`
    : '--';
  return (
    <ToolUiShell icon={<CloudSun className="h-3.5 w-3.5" />} label={t('toolUi.weather.label', 'Weather')}>
      <div className="flex items-center gap-4">
        <div className="text-3xl font-light text-foreground tabular-nums">{tempDisplay}</div>
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{interaction.location}</p>
          {interaction.condition && <p className="text-xs text-muted-foreground">{interaction.condition}</p>}
          <div className="flex gap-3 text-meta text-muted-foreground/70">
            {interaction.humidity != null && <span>{t('toolUi.weather.humidity', 'Humidity')}: {interaction.humidity}%</span>}
            {interaction.windSpeed != null && <span>{t('toolUi.weather.wind', 'Wind')}: {interaction.windSpeed} km/h</span>}
          </div>
        </div>
      </div>
      {interaction.forecast && interaction.forecast.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {interaction.forecast.map((f, i) => (
            <div key={i} className="rounded-md bg-black/[0.03] p-2 text-center dark:bg-white/[0.04]">
              <p className="text-meta font-medium text-foreground/70">{f.day}</p>
              <p className="text-xs text-muted-foreground">{f.condition}</p>
              <p className="text-xs text-foreground tabular-nums">{Math.round(f.high)}° / {Math.round(f.low)}°</p>
            </div>
          ))}
        </div>
      )}
    </ToolUiShell>
  );
}

const DIRECTIVE_VARIANT_STYLES: Record<DirectiveTextInteraction['variant'], { icon: React.ReactNode; className: string }> = {
  info: { icon: <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />, className: 'border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20' },
  warning: { icon: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />, className: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20' },
  success: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, className: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20' },
  danger: { icon: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />, className: 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20' },
  neutral: { icon: <Info className="h-4 w-4 text-muted-foreground" />, className: 'border-border bg-black/[0.02] dark:bg-white/[0.03]' },
};

function DirectiveTextCard({ interaction }: { interaction: DirectiveTextInteraction }) {
  const { t } = useTranslation('chat');
  const style = DIRECTIVE_VARIANT_STYLES[interaction.variant];
  return (
    <ToolUiShell icon={style.icon} label={t('toolUi.directiveText.label', 'Notice')}>
      <div className={cn('rounded-md border p-3', style.className)}>
        {interaction.title && <p className="mb-1 text-sm font-semibold text-foreground">{interaction.title}</p>}
        <p className="text-sm text-foreground/80 whitespace-pre-wrap">{interaction.text}</p>
      </div>
    </ToolUiShell>
  );
}

function SourceCard({ interaction }: { interaction: SourceInteraction }) {
  const { t } = useTranslation('chat');
  return (
    <ToolUiShell icon={<BookOpen className="h-3.5 w-3.5" />} label={t('toolUi.source.label', 'Sources')}>
      <ol className="space-y-2">
        {interaction.sources.map((src, i) => (
          <li key={src.id} className="rounded-md border border-black/5 p-2 dark:border-white/5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-meta font-medium text-muted-foreground tabular-nums">[{i + 1}]</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-foreground">{src.title}</p>
                  {src.url && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground"
                      aria-label={t('toolUi.source.open', 'Open source')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {src.snippet && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{src.snippet}</p>}
                {(src.author || src.publishedAt) && (
                  <p className="mt-0.5 text-meta text-muted-foreground/60">
                    {src.author}
                    {src.author && src.publishedAt && ' · '}
                    {src.publishedAt}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </ToolUiShell>
  );
}

const PROGRESS_STATUS_STYLES: Record<NonNullable<ProgressInteraction['status']>, string> = {
  active: 'bg-blue-500',
  completed: 'bg-emerald-500',
  error: 'bg-red-500',
  paused: 'bg-amber-500',
};

function ProgressCard({ interaction }: { interaction: ProgressInteraction }) {
  const { t } = useTranslation('chat');
  const max = interaction.max ?? 100;
  const pct = Math.min(100, Math.max(0, Math.round((interaction.value / max) * 100)));
  return (
    <ToolUiShell icon={<Loader2 className="h-3.5 w-3.5" />} label={interaction.label ?? t('toolUi.progress.label', 'Progress')}>
      <div data-testid="chat-tool-ui-progress" className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{interaction.status === 'completed' ? t('toolUi.progress.done', 'Done') : t('toolUi.progress.inProgress', 'In progress')}</span>
          <span className="font-medium text-foreground tabular-nums">{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className={cn('h-full rounded-full transition-all duration-500', PROGRESS_STATUS_STYLES[interaction.status ?? 'active'])}
            style={{ width: `${pct}%` }}
          />
        </div>
        {interaction.unit && (
          <p className="text-meta text-muted-foreground/60 tabular-nums">
            {interaction.value} / {max} {interaction.unit}
          </p>
        )}
      </div>
    </ToolUiShell>
  );
}

const STATUS_GRID_DOT_STYLES: Record<NonNullable<StatusGridInteraction['items'][number]['status']>, string> = {
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  idle: 'bg-muted-foreground/30',
};

function StatusGridCard({ interaction }: { interaction: StatusGridInteraction }) {
  const { t } = useTranslation('chat');
  return (
    <ToolUiShell icon={<LayoutGrid className="h-3.5 w-3.5" />} label={interaction.title ?? t('toolUi.statusGrid.label', 'Status')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {interaction.items.map((item) => (
          <div key={item.id} className="rounded-md border border-black/5 p-2 dark:border-white/5">
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_GRID_DOT_STYLES[item.status ?? 'idle'])} />
              <p className="truncate text-meta text-muted-foreground">{item.label}</p>
            </div>
            <p className="mt-0.5 text-sm font-medium text-foreground tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>
    </ToolUiShell>
  );
}

const ALERT_VARIANT_STYLES: Record<AlertInteraction['variant'], { icon: React.ReactNode; className: string }> = {
  info: { icon: <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />, className: 'border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20' },
  warning: { icon: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />, className: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20' },
  error: { icon: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />, className: 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20' },
  success: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, className: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20' },
};

function AlertCard({ interaction }: { interaction: AlertInteraction }) {
  const { t } = useTranslation('chat');
  const [dismissed, setDismissed] = useState(false);
  const style = ALERT_VARIANT_STYLES[interaction.variant];
  if (dismissed) return null;
  return (
    <ToolUiShell icon={style.icon} label={t('toolUi.alert.label', 'Alert')}>
      <div data-testid="chat-tool-ui-alert" className={cn('flex items-start justify-between gap-2 rounded-md border p-3', style.className)}>
        <div className="min-w-0">
          {interaction.title && <p className="mb-0.5 text-sm font-semibold text-foreground">{interaction.title}</p>}
          <p className="text-sm text-foreground/80">{interaction.message}</p>
        </div>
        {interaction.dismissible && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t('toolUi.alert.dismiss', 'Dismiss')}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </ToolUiShell>
  );
}

function KeyValueCard({ interaction }: { interaction: KeyValueInteraction }) {
  const { t } = useTranslation('chat');
  return (
    <ToolUiShell icon={<KeyRound className="h-3.5 w-3.5" />} label={interaction.title ?? t('toolUi.keyValue.label', 'Details')}>
      <div data-testid="chat-tool-ui-key-value">
        <dl className="divide-y divide-black/5 dark:divide-white/5">
        {interaction.entries.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-xs text-muted-foreground">{entry.key}</dt>
            <dd className={cn('text-xs text-foreground', entry.mono && 'font-mono')}>{entry.value}</dd>
          </div>
        ))}
        </dl>
      </div>
    </ToolUiShell>
  );
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function ChartCard({ interaction }: { interaction: ChartInteraction }) {
  const { t } = useTranslation('chat');
  const maxVal = Math.max(1, ...interaction.series.flatMap((s) => s.data));
  return (
    <ToolUiShell icon={<BarChart3 className="h-3.5 w-3.5" />} label={interaction.title ?? t('toolUi.chart.label', 'Chart')}>
      {interaction.chartType === 'pie' ? (
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              {(() => {
                const total = interaction.series[0]?.data.reduce((a, b) => a + b, 0) ?? 1;
                let offset = 0;
                return interaction.series[0]?.data.map((val, i) => {
                  const pct = val / total;
                  const dash = `${pct * 100} ${100 - pct * 100}`;
                  const circle = (
                    <circle
                      key={i}
                      cx="18"
                      cy="18"
                      r="15.915"
                      fill="none"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth="3.5"
                      strokeDasharray={dash}
                      strokeDashoffset={-offset}
                    />
                  );
                  offset += pct * 100;
                  return circle;
                });
              })()}
            </svg>
          </div>
          <ul className="space-y-1 text-xs">
            {interaction.labels.map((label, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="text-muted-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-end gap-2 h-32">
            {interaction.labels.map((label, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end justify-center gap-0.5 h-full">
                  {interaction.series.map((s, si) => {
                    const val = s.data[i] ?? 0;
                    const h = Math.max(2, (val / maxVal) * 100);
                    return (
                      <div
                        key={si}
                        className="w-full max-w-[20px] rounded-t-sm transition-all"
                        style={{ height: `${h}%`, backgroundColor: CHART_COLORS[si % CHART_COLORS.length] }}
                        title={`${s.name ?? ''}: ${val}`}
                      />
                    );
                  })}
                </div>
                <span className="text-meta text-muted-foreground/60 truncate" title={label}>{label}</span>
              </div>
            ))}
          </div>
          {interaction.series.length > 1 && (
            <ul className="flex flex-wrap gap-3 text-meta">
              {interaction.series.map((s, i) => (
                <li key={i} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-muted-foreground">{s.name ?? `Series ${i + 1}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ToolUiShell>
  );
}

function ImageGalleryCard({ interaction }: { interaction: ImageGalleryInteraction }) {
  const { t } = useTranslation('chat');
  return (
    <ToolUiShell icon={<ImageIcon className="h-3.5 w-3.5" />} label={interaction.title ?? t('toolUi.imageGallery.label', 'Images')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {interaction.images.map((img, i) => (
          <figure key={i} className="overflow-hidden rounded-md border border-black/5 dark:border-white/5">
            <img src={img.url} alt={img.alt ?? ''} className="h-24 w-full object-cover" loading="lazy" />
            {img.caption && <figcaption className="px-2 py-1 text-meta text-muted-foreground truncate">{img.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </ToolUiShell>
  );
}

function CodeBlockCard({ interaction }: { interaction: CodeBlockInteraction }) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(interaction.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [interaction.code]);
  return (
    <ToolUiShell icon={<Code2 className="h-3.5 w-3.5" />} label={interaction.filename ?? t('toolUi.codeBlock.label', 'Code')}>
      <div className="relative">
        <div className="flex items-center justify-between rounded-t-md border border-b-0 border-black/10 bg-black/[0.03] px-3 py-1 dark:border-white/10 dark:bg-white/[0.04]">
          <span className="text-meta font-mono text-muted-foreground">{interaction.language ?? 'text'}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground"
            aria-label={t('toolUi.codeBlock.copy', 'Copy code')}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t('toolUi.codeBlock.copied', 'Copied') : t('toolUi.codeBlock.copy', 'Copy')}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-b-md border border-black/10 bg-surface-input p-3 text-xs font-mono dark:border-white/10">
          <code>{interaction.code}</code>
        </pre>
      </div>
    </ToolUiShell>
  );
}

export function AgentInteractionRenderer({
  interactions,
  canSubmit,
  onSubmitResponse,
  onDraftResponse,
  onOpenFilePath,
}: AgentInteractionRendererProps) {
  if (interactions.length === 0) return null;

  return (
    <div className="w-full space-y-3" data-testid="chat-tool-ui-interactions">
      {interactions.map((interaction, index) => {
        const key = `${interaction.type}-${interaction.id}-${index}`;
        switch (interaction.type) {
          case 'plan':
            return <PlanCard key={key} interaction={interaction} />;
          case 'option-list':
            return (
              <OptionListCard
                key={key}
                interaction={interaction}
                canSubmit={canSubmit}
                onSubmitResponse={onSubmitResponse}
                onDraftResponse={onDraftResponse}
              />
            );
          case 'question-flow':
            return (
              <QuestionFlowCard
                key={key}
                interaction={interaction}
                canSubmit={canSubmit}
                onSubmitResponse={onSubmitResponse}
                onDraftResponse={onDraftResponse}
              />
            );
          case 'preferences-panel':
            return (
              <PreferencesPanelCard
                key={key}
                interaction={interaction}
                canSubmit={canSubmit}
                onSubmitResponse={onSubmitResponse}
                onDraftResponse={onDraftResponse}
              />
            );
          case 'table':
            return <TableCard key={key} interaction={interaction} />;
          case 'weather':
            return <WeatherCard key={key} interaction={interaction} />;
          case 'directive-text':
            return <DirectiveTextCard key={key} interaction={interaction} />;
          case 'source':
            return <SourceCard key={key} interaction={interaction} />;
          case 'progress':
            return <ProgressCard key={key} interaction={interaction} />;
          case 'status-grid':
            return <StatusGridCard key={key} interaction={interaction} />;
          case 'alert':
            return <AlertCard key={key} interaction={interaction} />;
          case 'key-value':
            return <KeyValueCard key={key} interaction={interaction} />;
          case 'chart':
            return <ChartCard key={key} interaction={interaction} />;
          case 'image-gallery':
            return <ImageGalleryCard key={key} interaction={interaction} />;
          case 'code-block':
            return <CodeBlockCard key={key} interaction={interaction} />;
          case 'test-results':
            return <TestResults key={key} title={interaction.title} summary={interaction.summary} suites={interaction.suites} />;
          case 'stack-trace':
            return (
              <StackTrace
                key={key}
                title={interaction.title}
                errorType={interaction.errorType}
                message={interaction.message}
                stack={interaction.stack}
                source={interaction.source}
                onOpenFile={onOpenFilePath}
              />
            );
          case 'chain-of-thought':
            return (
              <ChainOfThought
                key={key}
                title={interaction.title}
                defaultOpen={interaction.defaultOpen}
                steps={interaction.steps}
              />
            );
          case 'task':
            return (
              <AiTask
                key={key}
                title={interaction.title}
                defaultOpen={interaction.defaultOpen}
                items={interaction.items}
                onOpenFile={onOpenFilePath}
              />
            );
          case 'reasoning':
            return (
              <Reasoning
                key={key}
                title={interaction.title}
                summary={interaction.summary}
                loading={interaction.loading}
                defaultOpen={interaction.defaultOpen}
              >
                {interaction.text}
              </Reasoning>
            );
          case 'approval-card':
            return (
              <div key={key} data-testid="chat-tool-ui-approval">
                <ApprovalCard
                  {...interaction}
                  onConfirm={() => onSubmitResponse?.(JSON.stringify({
                    type: 'approval-card',
                    id: interaction.id,
                    action: 'approved',
                  }, null, 2))}
                  onCancel={() => onSubmitResponse?.(JSON.stringify({
                    type: 'approval-card',
                    id: interaction.id,
                    action: 'denied',
                  }, null, 2))}
                />
              </div>
            );
          case 'terminal':
            return (
              <div key={key} data-testid="chat-tool-ui-terminal">
                <Terminal {...interaction} />
              </div>
            );
          case 'code-diff':
            return (
              <div key={key} data-testid="chat-tool-ui-code-diff">
                <CodeDiff
                  {...interaction}
                  lineNumbers="visible"
                  diffStyle="unified"
                />
              </div>
            );
          case 'progress-tracker':
            return (
              <div key={key} data-testid="chat-tool-ui-progress-tracker">
                <ProgressTracker {...interaction} />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
