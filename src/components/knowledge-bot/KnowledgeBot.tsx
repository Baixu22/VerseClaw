import { useEffect, useRef, useState } from 'react';
import { createGrokBot, type GrokBot } from './vendor/grok-player.js';
import { GINGER } from './vendor/bot-shape.js';
import recipes from './vendor/grok-recipes.json';
import './knowledge-bot.css';

export type KnowledgeBotState = 'idle' | 'listening' | 'searching' | 'reading' | 'thinking' | 'waiting' | 'writing' | 'working' | 'finished' | 'confused' | 'failed' | 'curious' | 'dragging';

const INK = [200 / 255, 71 / 255, 24 / 255];
const fallbackOutline = GINGER.r.map((r, i) => {
  const a = i / GINGER.r.length * Math.PI * 2;
  return `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(4)},${(Math.sin(a) * r).toFixed(4)}`;
}).join(' ') + 'Z';

/** The approved solid is computed live; historical replies settle one pose. */
export function KnowledgeBot({ state = 'idle', size = 80, animated = true, follow = false }: {
  state?: KnowledgeBotState;
  size?: number;
  animated?: boolean;
  follow?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const botRef = useRef<GrokBot | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false);
  const instanceKey = `${size}:${animated}:${reduced}:${follow}`;
  const loaded = loadedKey === instanceKey;

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    const bot = createGrokBot(hostRef.current, {
      size, state: 'idle', seed: 'knowledge-ginger', data: recipes, silhouette: GINGER,
      theme: { ink: INK, spot: [1, 1, 1], cutout: true },
      follow, staticMode: !animated, reducedMotion: reduced, maxFps: 30,
    });
    botRef.current = bot;
    void bot.ready.then(() => { if (!disposed) setLoadedKey(bot.error ? null : instanceKey); });
    return () => { disposed = true; bot.destroy(); botRef.current = null; };
  }, [size, animated, reduced, follow, instanceKey]);

  useEffect(() => {
    const bot = botRef.current;
    if (!bot) return;
    bot.setState(state);
    // Failed has a short native clip, but the error stays visible until retry.
    if (state === 'failed' || state === 'confused') bot.setExpression(state === 'failed' ? 'squinted' : 'inspecting');
  }, [state, size, animated, reduced, follow]);

  return (
    <span className="knowledge-bot" style={{ width: size, height: size }} aria-hidden="true"
      data-testid="knowledge-bot" data-state={state} data-motion={reduced || !animated ? 'reduced' : 'animated'} data-ready={loaded}>
      <span ref={hostRef} className="knowledge-bot__engine" />
      {!loaded && <svg viewBox="-1.3 -1.3 2.6 2.6" className="knowledge-bot__fallback">
        <path d={fallbackOutline} fill="#c84718" />
        <ellipse cx="-.3" cy=".24" rx=".09" ry=".13" fill="white" />
        <ellipse cx=".3" cy=".24" rx=".09" ry=".13" fill="white" />
      </svg>}
    </span>
  );
}
