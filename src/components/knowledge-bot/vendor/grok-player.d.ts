export type GrokBot = {
  ready: Promise<void>;
  readonly error: unknown;
  readonly state: string;
  readonly el: SVGSVGElement | null;
  setState(state: string): void;
  setExpression(expression: string): void;
  blink(): void;
  destroy(): void;
};
export function createGrokBot(container: HTMLElement, options: {
  size: number;
  state: string;
  seed: string;
  data: unknown;
  silhouette: unknown;
  theme: { ink: number[]; spot: number[]; cutout: boolean };
  follow: boolean;
  staticMode: boolean;
  reducedMotion: boolean;
  maxFps: number;
}): GrokBot;
