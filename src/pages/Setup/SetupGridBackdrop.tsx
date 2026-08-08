/**
 * SetupGridBackdrop — the first-run wizard's cursor-lit grid.
 *
 * Ported from the rogierdeboeve reference's screen mouse simulation, which is
 * a ping-pong FBO trail: decay the previous frame, stamp a soft circle at a
 * lagged cursor position, composite. Same algorithm here, no WebGL.
 *
 * WHY CANVAS 2D AND NOT A SHADER
 * electron/main/index.ts calls app.disableHardwareAcceleration()
 * unconditionally, so every user renders through SwiftShader on the CPU. A
 * full-screen per-frame fragment shader is not affordable there. The
 * reference has the same problem for different reasons and solves it the same
 * way — it renders its mouse sim at 1/10 scale (SCREEN_MOUSE_SIM_SCALE).
 *
 * THE PER-FRAME BUDGET
 * Three canvases, and only two viewport-sized blits per frame:
 *
 *   heat    (CSS/8, ~200x125)  decay by alpha, stamp one radial gradient
 *   sprite  (CSS/2)            the lit grid, rebuilt only on resize
 *   visible (CSS/2)            drawImage(sprite) then destination-in
 *                              drawImage(heat) stretched to full size
 *
 * At 1600x1000 that is ~800k pixels touched per frame, about 190 MB/s at
 * 60fps. The same effect on a devicePixelRatio-sized canvas would be roughly
 * eight times that and would not hold frame rate under SwiftShader.
 *
 * The upscale of `heat` is doing real work, not just saving pixels: bilinear
 * interpolation of a 200x125 buffer to full size is what produces the soft
 * radial falloff, for free, in the blit we already had to make.
 */
import { useEffect, useRef } from 'react';

/** Backing store scale for the visible canvas and the grid sprite. */
const RENDER_SCALE = 0.5;
/** Backing store divisor for the heat buffer, relative to CSS pixels. */
const HEAT_DIVISOR = 8;
/** Grid pitch in CSS pixels. Must match .setup-backdrop__grid's 64px. */
const GRID_PITCH = 64;

/**
 * Fraction of accumulated heat still present one second later. The reference
 * uses 0.75 per 100ms (Math.pow(persistance, delta * 10)), i.e. ~0.056/s;
 * this is the same order and lands the trail at ~5% after 0.9s.
 */
const HEAT_RETAIN_PER_SEC = 0.034;

/**
 * Pointer follow rate. Lifted from the reference's
 * `newPos.lerp(targetPos, delta * 7.5)`. The lag is not incidental — it is
 * what gives the trail weight. A cursor-locked stamp reads as a hard dot.
 */
const POINTER_FOLLOW = 7.5;

/** Stamp radius in CSS pixels at rest, and its speed-driven ceiling. */
const STAMP_RADIUS = 190;
const STAMP_RADIUS_SPEED_GAIN = 0.55;
/** Pointer speed (CSS px/frame-ish) that saturates the radius gain. */
const STAMP_SPEED_SATURATION = 55;

/**
 * Alpha below which the trail is no longer perceptible. Once the heat buffer
 * is this faint AND the pointer has settled, the rAF loop stops entirely —
 * users sit on the provider step typing an API key for minutes, and a
 * backdrop that keeps a core warm the whole time is a real cost, not a
 * theoretical one.
 */
const IDLE_ALPHA_EPSILON = 0.012;
/** Distance under which the follower is considered settled, CSS px. */
const IDLE_DISTANCE_EPSILON = 0.4;

type Ctx2D = CanvasRenderingContext2D;

function readGridInk(isDark: boolean) {
  // Roughly 5x the base grid's alpha (.035 light / .025 dark in
  // codex-setup-motion.css). Bright enough to read as illumination, far too
  // dim to compete with the wizard content sitting on top of it.
  return isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.16)';
}

/**
 * Paint the lit grid once. Called on mount, on resize, and on theme change —
 * never per frame.
 */
function paintGridSprite(ctx: Ctx2D, cssWidth: number, cssHeight: number, isDark: boolean) {
  const w = Math.max(1, Math.round(cssWidth * RENDER_SCALE));
  const h = Math.max(1, Math.round(cssHeight * RENDER_SCALE));
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = readGridInk(isDark);
  ctx.lineWidth = 1;

  const pitch = GRID_PITCH * RENDER_SCALE;
  ctx.beginPath();
  // +0.5 puts the stroke on a device pixel centre so it stays one pixel wide
  // instead of smearing across two at half opacity.
  for (let x = 0; x <= w; x += pitch) {
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  for (let y = 0; y <= h; y += pitch) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
  }
  ctx.stroke();
}

export function SetupGridBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Three bail conditions, one branch. Without a pointer there is nothing to
    // give feedback about; under reduced motion the trail is exactly the kind
    // of ambient movement the setting exists to remove. Either way the static
    // grid and grain siblings still render, so the surface does not go blank.
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    if (reducedMotion || coarsePointer) return;

    const visibleCtx = canvas.getContext('2d');
    if (!visibleCtx) return;

    const sprite = document.createElement('canvas');
    const spriteCtx = sprite.getContext('2d');
    const heat = document.createElement('canvas');
    const heatCtx = heat.getContext('2d');
    if (!spriteCtx || !heatCtx) return;

    let cssWidth = 0;
    let cssHeight = 0;
    let rafId = 0;
    let running = false;
    let lastTime = 0;

    // Follower and target are both in CSS pixels. `hasPointer` keeps the very
    // first stamp from being drawn as a streak from the origin.
    let hasPointer = false;
    let followX = 0;
    let followY = 0;
    let targetX = 0;
    let targetY = 0;
    /** Upper bound on heat-buffer alpha, tracked so idling can be detected
     *  without reading pixels back (getImageData would stall the pipeline). */
    let heatCeiling = 0;

    const isDark = () => document.documentElement.classList.contains('dark');

    const resize = () => {
      const nextW = Math.max(1, Math.floor(window.innerWidth));
      const nextH = Math.max(1, Math.floor(window.innerHeight));
      if (nextW === cssWidth && nextH === cssHeight) return;
      cssWidth = nextW;
      cssHeight = nextH;

      canvas.width = Math.max(1, Math.round(cssWidth * RENDER_SCALE));
      canvas.height = Math.max(1, Math.round(cssHeight * RENDER_SCALE));
      heat.width = Math.max(1, Math.round(cssWidth / HEAT_DIVISOR));
      heat.height = Math.max(1, Math.round(cssHeight / HEAT_DIVISOR));
      // Resizing a canvas clears it, so accumulated heat is gone; say so.
      heatCeiling = 0;
      paintGridSprite(spriteCtx, cssWidth, cssHeight, isDark());
    };

    const frame = (time: number) => {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0.016;
      lastTime = time;

      // ── heat buffer ────────────────────────────────────────────────────
      // Decay is computed from dt rather than applied as a fixed per-frame
      // alpha. A constant would make the trail last half as long on a 120Hz
      // display as on a 60Hz one.
      const retain = Math.pow(HEAT_RETAIN_PER_SEC, dt);
      heatCtx.globalCompositeOperation = 'destination-out';
      heatCtx.fillStyle = `rgba(0, 0, 0, ${1 - retain})`;
      heatCtx.fillRect(0, 0, heat.width, heat.height);
      heatCeiling *= retain;

      const prevX = followX;
      const prevY = followY;
      followX += (targetX - followX) * Math.min(1, dt * POINTER_FOLLOW);
      followY += (targetY - followY) * Math.min(1, dt * POINTER_FOLLOW);
      const travelled = Math.hypot(followX - prevX, followY - prevY);

      if (hasPointer) {
        // Radius grows with speed, mirroring the reference's
        // clamp(uThickness + uSpeed * 0.3, ...) — a fast sweep paints a
        // broader band than a slow drift.
        const speedGain = Math.min(travelled / STAMP_SPEED_SATURATION, 1) * STAMP_RADIUS_SPEED_GAIN;
        const radius = (STAMP_RADIUS * (1 + speedGain)) / HEAT_DIVISOR;
        const hx = followX / HEAT_DIVISOR;
        const hy = followY / HEAT_DIVISOR;

        const gradient = heatCtx.createRadialGradient(hx, hy, 0, hx, hy, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
        gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.13)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        heatCtx.globalCompositeOperation = 'source-over';
        heatCtx.fillStyle = gradient;
        heatCtx.beginPath();
        heatCtx.arc(hx, hy, radius, 0, Math.PI * 2);
        heatCtx.fill();
        // source-over stacking cannot exceed 1; track the ceiling the same way.
        heatCeiling = Math.min(1, heatCeiling + 0.34);
      }

      // ── composite ──────────────────────────────────────────────────────
      visibleCtx.globalCompositeOperation = 'source-over';
      visibleCtx.clearRect(0, 0, canvas.width, canvas.height);
      visibleCtx.drawImage(sprite, 0, 0);
      // Keep only the grid that falls inside the heat field. The stretch from
      // the small buffer is what softens the edge.
      visibleCtx.globalCompositeOperation = 'destination-in';
      visibleCtx.drawImage(heat, 0, 0, canvas.width, canvas.height);

      // ── idle stop ──────────────────────────────────────────────────────
      const settled = Math.hypot(targetX - followX, targetY - followY) < IDLE_DISTANCE_EPSILON;
      if (settled && heatCeiling < IDLE_ALPHA_EPSILON) {
        // One last clear so the final faint frame does not linger on screen.
        visibleCtx.globalCompositeOperation = 'source-over';
        visibleCtx.clearRect(0, 0, canvas.width, canvas.height);
        heatCtx.clearRect(0, 0, heat.width, heat.height);
        heatCeiling = 0;
        running = false;
        rafId = 0;
        return;
      }

      rafId = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || document.hidden) return;
      running = true;
      lastTime = 0;
      rafId = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      running = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      if (!hasPointer) {
        // Seed the follower on the first sample, otherwise the opening frames
        // draw a stripe from (0,0) to wherever the cursor actually is.
        hasPointer = true;
        followX = targetX;
        followY = targetY;
      }
      start();
    };

    const onPointerLeave = () => {
      // Stop feeding new heat; the loop keeps running until the existing
      // trail has decayed, then stops itself.
      hasPointer = false;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (heatCeiling > IDLE_ALPHA_EPSILON) start();
    };

    const onBlur = () => stop();

    resize();

    const themeObserver = new MutationObserver(() => {
      paintGridSprite(spriteCtx, cssWidth, cssHeight, isDark());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      themeObserver.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="setup-backdrop" aria-hidden="true" data-testid="setup-backdrop">
      <div className="setup-backdrop__grid" />
      <canvas ref={canvasRef} className="setup-backdrop__canvas" />
      <div className="setup-backdrop__noise" />
    </div>
  );
}
