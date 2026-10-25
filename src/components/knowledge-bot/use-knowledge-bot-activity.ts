import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeBotState } from './KnowledgeBot';

/** Call boundaries own activity; the timer only settles the completion gesture. */
export function useKnowledgeBotActivity() {
  const [activity, setActivity] = useState<KnowledgeBotState>('idle');
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    if (activity !== 'finished') return;
    const timer = window.setTimeout(() => setActivity('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [activity]);
  const reset = useCallback(() => setActivity('idle'), []);
  return { state: activity === 'idle' && composing ? 'listening' as const : activity, setActivity, setComposing, reset };
}
