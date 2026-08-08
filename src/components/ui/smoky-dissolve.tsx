import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import html2canvas from 'html2canvas';

/**
 * SmokyDissolve — ported from manba pro/smoky-dissolve (initPro6).
 *
 * When triggered, the wrapped element is snapshotted to an offscreen canvas
 * and dissolved: an organic noise displacement field tears the pixels apart,
 * a separable box blur turns them into smoke, gravity pulls them down with
 * sway/spin/spread, and the whole thing fades out. After the animation the
 * `onDissolved` callback fires (the consumer removes the element). A brief
 * respawn fade-in replays if the element stays mounted.
 *
 * Canvas 2D pipeline (GPU-backed drawImage work):
 *  - prepare(): snapshot the element (rounded-corner clipped) at devicePixelRatio
 *  - per frame: remap via 64×64 value-noise lattice → box blur at half res →
 *    draw with transform (fall/sway/spin/scale) + opacity fade
 *  - every other frame skips the pixel pass (half the compute)
 *  - prefers-reduced-motion skips the dissolve entirely
 */

type SmokyDissolveProps = {
  children: ReactNode;
  /** Dissolve duration in ms. */
  durationMs?: number;
  /** Gravity px/s². */
  gravity?: number;
  /** Noise displacement strength (tear amplitude). */
  warp?: number;
  /** Displacement-field ramp duration in ms (0 = same as durationMs). */
  warpDurationMs?: number;
  /** Max blur radius px. */
  maxBlur?: number;
  /** Sideways sway amplitude. */
  sway?: number;
  /** Whole-element rotation deg. */
  spin?: number;
  /** Smoke churn px/s. */
  churn?: number;
  /** Spread % (scale up). */
  spread?: number;
  /**
   * True when the child is a plain <img> (no cross-origin/font/SVG content).
   * Skips the html2canvas DOM clone — the image draws straight to the
   * snapshot canvas, so the dissolve starts immediately and can't be
   * delayed by layout/DOM work.
   */
  isImage?: boolean;
  /** Called when the dissolve animation finishes. */
  onDissolved?: () => void;
  className?: string;
};

const NOISE_N = 64;

/**
 * Paint the host into the snapshot canvas. Two paths:
 *
 *  - `isImage`: the host is (essentially) a single <img>. Drawing the image
 *    straight onto the canvas is synchronous and cannot taint — no DOM clone,
 *    no layout pass, no delay. The dissolve starts on the same frame as the
 *    click, matching the manba reference card.
 *
 *  - otherwise: html2canvas re-renders the node's DOM tree into a fresh
 *    canvas (cross-origin <img> blobs taint canvases in Chrome, so a naive
 *    foreignObject snapshot would make getImageData throw).
 */
function paintHostToCanvas(
  host: HTMLDivElement,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  isImage: boolean,
): Promise<void> | void {
  if (isImage) {
    const img = host.querySelector('img');
    if (img?.complete && img.naturalWidth > 0) {
      // Cover-fit draw, mirroring the chip's object-cover layout.
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

      // The reference snapshots the whole card, including its remove control.
      // Keep the synchronous image path, but paint that control explicitly so
      // it dissolves with the thumbnail instead of vanishing before the smoke.
      const buttonRadius = 12;
      const buttonX = w - 6 - buttonRadius;
      const buttonY = 6 + buttonRadius;
      ctx.beginPath();
      ctx.arc(buttonX, buttonY, buttonRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fill();
      ctx.strokeStyle = '#17181c';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(buttonX - 3.5, buttonY - 3.5);
      ctx.lineTo(buttonX + 3.5, buttonY + 3.5);
      ctx.moveTo(buttonX + 3.5, buttonY - 3.5);
      ctx.lineTo(buttonX - 3.5, buttonY + 3.5);
      ctx.stroke();
      return;
    }
  }
  return html2canvas(host, {
    width: w,
    height: h,
    scale: 1,
    backgroundColor: null,
    logging: false,
  }).then((snapshot) => {
    ctx.drawImage(snapshot, 0, 0, w, h);
  });
}

function makeEaseSampler(raw: string): (t: number) => number {
  const keywords: Record<string, number[]> = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  const c = keywords[raw.trim()];
  const m = raw.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!c && m) return (t: number) => {
    const [x1, y1, x2, y2] = [+m[1], +m[2], +m[3], +m[4]];
    // Newton–Raphson solve for x, then cubic y
    let x = t;
    for (let i = 0; i < 8; i++) {
      const cx = 3 * (1 - x) * (1 - x) * x1 + 3 * (1 - x) * x * x2 + x * x * x;
      const dx = 3 * (1 - x) * (1 - x) * x1 + 6 * (1 - x) * x * (x2 - x1) + 3 * x * x * (1 - x2);
      if (Math.abs(dx) < 1e-6) break;
      x -= (cx - t) / dx;
    }
    return 3 * (1 - x) * (1 - x) * y1 + 3 * (1 - x) * x * y2 + x * x * x;
  };
  return c ? (t: number) => {
    const [x1, y1, x2, y2] = c;
    const tt = Math.max(0, Math.min(1, t));
    let x = tt;
    for (let i = 0; i < 8; i++) {
      const cx = 3 * (1 - x) * (1 - x) * x1 + 3 * (1 - x) * x * x2 + x * x * x;
      const dx = 3 * (1 - x) * (1 - x) * x1 + 6 * (1 - x) * x * (x2 - x1) + 3 * x * x * (1 - x2);
      if (Math.abs(dx) < 1e-6) break;
      x -= (cx - tt) / dx;
    }
    const y = 3 * (1 - x) * (1 - x) * y1 + 3 * (1 - x) * x * y2 + x * x * x;
    return Math.max(0, Math.min(1, y));
  } : (t) => Math.max(0, Math.min(1, t));
}

function useSmokyDissolve(options: SmokyDissolveProps) {
  const {
    durationMs = 550,
    gravity = 150,
    warp = 30,
    warpDurationMs = 0,
    maxBlur = 12,
    sway = 0,
    spin = 3,
    churn = 30,
    spread = 0,
    isImage = false,
    onDissolved,
  } = options;

  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  const onDissolvedRef = useRef(onDissolved);
  onDissolvedRef.current = onDissolved;

  const dissolve = useCallback(async () => {
    const host = hostRef.current;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!host || !root || !canvas || runningRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDissolvedRef.current?.();
      return;
    }

    runningRef.current = true;
    // Generation guard: React StrictMode double-invokes effects in dev, so a
    // second dissolve() can start while the first is still awaiting its
    // snapshot. Each run bumps the generation; stale runs see their id
    // superseded and exit instead of fighting over the same canvas.
    const runId = ++runIdRef.current;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      runningRef.current = false;
      onDissolvedRef.current?.();
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const hostRect = host.getBoundingClientRect();
    const cardW = hostRect.width;
    const cardH = hostRect.height;

    // Snapshot the host content (rounded clip) to an offscreen canvas.
    const snap = document.createElement('canvas');
    snap.width = Math.max(1, Math.round(cardW * dpr));
    snap.height = Math.max(1, Math.round(cardH * dpr));
    const sc = snap.getContext('2d')!;
    sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    sc.clearRect(0, 0, cardW, cardH);
    const r = 16;
    sc.beginPath();
    sc.moveTo(r, 0);
    sc.arcTo(cardW, 0, cardW, cardH, r);
    sc.arcTo(cardW, cardH, 0, cardH, r);
    sc.arcTo(0, cardH, 0, 0, r);
    sc.arcTo(0, 0, cardW, 0, r);
    sc.closePath();
    sc.clip();

    // Remove the flex footprint immediately, while keeping the host visible
    // at its old slot until an async DOM snapshot is ready.
    const parentRect = root.parentElement?.getBoundingClientRect();
    root.dataset.smokyState = 'dissolving';
    root.style.position = 'absolute';
    root.style.left = `${hostRect.left - (parentRect?.left ?? hostRect.left)}px`;
    root.style.top = `${hostRect.top - (parentRect?.top ?? hostRect.top)}px`;
    root.style.width = `${cardW}px`;
    root.style.height = `${cardH}px`;
    root.style.margin = '0';
    root.style.pointerEvents = 'none';
    try {
      const painted = paintHostToCanvas(host, sc, cardW, cardH, isImage);
      if (painted && typeof (painted as Promise<void>).then === 'function') {
        await painted;
      }
    } catch {
      // If a newer dissolve superseded us while we were painting, exit quietly.
      if (runId !== runIdRef.current) {
        runningRef.current = false;
        return;
      }
      const fallback = host.animate(
        [
          { opacity: 1, filter: 'blur(0)', transform: 'translateY(0) scale(1)' },
          { opacity: 0, filter: `blur(${Math.min(maxBlur, 12)}px)`, transform: 'translateY(18px) scale(1.06)' },
        ],
        { duration: durationMs, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' },
      );
      await fallback.finished.catch(() => undefined);
      runningRef.current = false;
      onDissolvedRef.current?.();
      return;
    }
    // A newer dissolve started while we were awaiting the snapshot — it owns
    // the canvas now. Bail out and let it finish.
    if (runId !== runIdRef.current) {
      runningRef.current = false;
      return;
    }
    const snapData = sc.getImageData(0, 0, snap.width, snap.height).data;
    const snapPre = new Uint8ClampedArray(snapData.length);
    for (let i = 0; i < snapData.length; i += 4) {
      const a = snapData[i + 3];
      snapPre[i] = snapData[i] * a / 255;
      snapPre[i + 1] = snapData[i + 1] * a / 255;
      snapPre[i + 2] = snapData[i + 2] * a / 255;
      snapPre[i + 3] = a;
    }

    // The snapshot is ready. Swap the retained host for the fixed canvas.
    host.style.visibility = 'hidden';
    root.style.width = '0';
    root.style.height = '0';

    // Canvas overlay sized with padding for the displacement/blur.
    const pad = Math.min(Math.ceil(warp / 2 + maxBlur * 2) + 6, 80);
    const padDev = Math.round(pad * dpr);
    const workW = snap.width + padDev * 2;
    const workH = snap.height + padDev * 2;
    canvas.width = workW;
    canvas.height = workH;
    canvas.style.width = `${cardW + pad * 2}px`;
    canvas.style.height = `${cardH + pad * 2}px`;
    canvas.style.left = `${hostRect.left - pad}px`;
    canvas.style.top = `${hostRect.top - pad}px`;
    canvas.style.visibility = 'visible';

    const workHalf = document.createElement('canvas');
    workHalf.width = Math.ceil(workW / 2);
    workHalf.height = Math.ceil(workH / 2);
    const whctx = workHalf.getContext('2d')!;
    const workData = ctx.createImageData(workW, workH);
    const halfData = whctx.createImageData(workHalf.width, workHalf.height);
    const blurTmp = new Uint8ClampedArray(halfData.data.length);

    // Noise lattice.
    const latW = Math.ceil(workW / 4) + 2;
    const latH = Math.ceil(workH / 4) + 2;
    const latDX = new Float32Array(latW * latH);
    const latDY = new Float32Array(latW * latH);
    const noiseR = new Float32Array(NOISE_N * NOISE_N);
    const noiseG = new Float32Array(NOISE_N * NOISE_N);
    let s = 4;
    for (let i = 0; i < NOISE_N * NOISE_N; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      noiseR[i] = s / 2147483648 - 1;
      s = (s * 1664525 + 1013904223) >>> 0;
      noiseG[i] = s / 2147483648 - 1;
    }
    const gridAt = (gArr: Float32Array, x: number, y: number) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      let fx = x - xi;
      let fy = y - yi;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % NOISE_N) + NOISE_N) % NOISE_N;
      const x1 = (x0 + 1) % NOISE_N;
      const y0 = ((yi % NOISE_N) + NOISE_N) % NOISE_N;
      const y1 = (y0 + 1) % NOISE_N;
      const top = gArr[y0 * NOISE_N + x0] + (gArr[y0 * NOISE_N + x1] - gArr[y0 * NOISE_N + x0]) * fx;
      const bot = gArr[y1 * NOISE_N + x0] + (gArr[y1 * NOISE_N + x1] - gArr[y1 * NOISE_N + x0]) * fx;
      return top + (bot - top) * fy;
    };
    const noise2 = (gArr: Float32Array, px: number, py: number) =>
      (gridAt(gArr, px / 28, py / 28) + 0.5 * gridAt(gArr, px / 14 + 37.7, py / 14 + 11.3)) / 1.5;

    const boxH = (srcA: Uint8ClampedArray, dstA: Uint8ClampedArray, w: number, h: number, r: number) => {
      const inv = 1 / (2 * r + 1);
      for (let y = 0; y < h; y++) {
        const base = y * w * 4;
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let x = 0; x <= r && x < w; x++) {
          const i = base + x * 4;
          sr += srcA[i]; sg += srcA[i + 1]; sb += srcA[i + 2]; sa += srcA[i + 3];
        }
        for (let x = 0; x < w; x++) {
          const o = base + x * 4;
          dstA[o] = sr * inv; dstA[o + 1] = sg * inv; dstA[o + 2] = sb * inv; dstA[o + 3] = sa * inv;
          const xa = x + r + 1;
          if (xa < w) {
            const ia = base + xa * 4;
            sr += srcA[ia]; sg += srcA[ia + 1]; sb += srcA[ia + 2]; sa += srcA[ia + 3];
          }
          const xs = x - r;
          if (xs >= 0) {
            const is = base + xs * 4;
            sr -= srcA[is]; sg -= srcA[is + 1]; sb -= srcA[is + 2]; sa -= srcA[is + 3];
          }
        }
      }
    };

    const boxV = (srcA: Uint8ClampedArray, dstA: Uint8ClampedArray, w: number, h: number, r: number, straight: boolean) => {
      const stride = w * 4;
      const inv = 1 / (2 * r + 1);
      for (let x = 0; x < w; x++) {
        const base = x * 4;
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let y = 0; y <= r && y < h; y++) {
          const i = base + y * stride;
          sr += srcA[i]; sg += srcA[i + 1]; sb += srcA[i + 2]; sa += srcA[i + 3];
        }
        for (let y = 0; y < h; y++) {
          const o = base + y * stride;
          const aOut = sa * inv;
          if (straight && aOut > 0.5 && aOut < 254.6) {
            const k = 255 / aOut;
            dstA[o] = sr * inv * k;
            dstA[o + 1] = sg * inv * k;
            dstA[o + 2] = sb * inv * k;
          } else {
            dstA[o] = sr * inv;
            dstA[o + 1] = sg * inv;
            dstA[o + 2] = sb * inv;
          }
          dstA[o + 3] = aOut;
          const ya = y + r + 1;
          if (ya < h) {
            const ia = base + ya * stride;
            sr += srcA[ia]; sg += srcA[ia + 1]; sb += srcA[ia + 2]; sa += srcA[ia + 3];
          }
          const ys = y - r;
          if (ys >= 0) {
            const is = base + ys * stride;
            sr -= srcA[is]; sg -= srcA[is + 1]; sb -= srcA[is + 2]; sa -= srcA[is + 3];
          }
        }
      }
    };

    const remap = (dstArr: Uint8ClampedArray, dw: number, dh: number, scaleFactor: number, straight: boolean) => {
      const invLat = 1 / 4;
      let di = 0;
      for (let yD = 0; yD < dh; yD++) {
        const yF = yD * scaleFactor;
        const gy = yF * invLat;
        const gy0 = gy | 0;
        const fy = gy - gy0;
        const row0 = gy0 * latW;
        const row1 = row0 + latW;
        for (let xD = 0; xD < dw; xD++, di += 4) {
          const xF = xD * scaleFactor;
          const gx = xF * invLat;
          const gx0 = gx | 0;
          const fx = gx - gx0;
          const a = row0 + gx0;
          const b = row1 + gx0;
          const dxv = (latDX[a] + (latDX[a + 1] - latDX[a]) * fx) * (1 - fy) + (latDX[b] + (latDX[b + 1] - latDX[b]) * fx) * fy;
          const dyv = (latDY[a] + (latDY[a + 1] - latDY[a]) * fx) * (1 - fy) + (latDY[b] + (latDY[b + 1] - latDY[b]) * fx) * fy;
          const sxf = xF - padDev + dxv;
          const syf = yF - padDev + dyv;
          const sx0 = Math.floor(sxf);
          const sy0 = Math.floor(syf);
          if (sx0 >= 0 && sx0 < snap.width - 1 && sy0 >= 0 && sy0 < snap.height - 1) {
            const u = sxf - sx0;
            const v = syf - sy0;
            const w00 = (1 - u) * (1 - v);
            const w10 = u * (1 - v);
            const w01 = (1 - u) * v;
            const w11 = u * v;
            const i00 = (sy0 * snap.width + sx0) * 4;
            const i10 = i00 + 4;
            const i01 = i00 + snap.width * 4;
            const i11 = i01 + 4;
            let rC = snapPre[i00] * w00 + snapPre[i10] * w10 + snapPre[i01] * w01 + snapPre[i11] * w11;
            let gC = snapPre[i00 + 1] * w00 + snapPre[i10 + 1] * w10 + snapPre[i01 + 1] * w01 + snapPre[i11 + 1] * w11;
            let bC = snapPre[i00 + 2] * w00 + snapPre[i10 + 2] * w10 + snapPre[i01 + 2] * w01 + snapPre[i11 + 2] * w11;
            const aC = snapPre[i00 + 3] * w00 + snapPre[i10 + 3] * w10 + snapPre[i01 + 3] * w01 + snapPre[i11 + 3] * w11;
            if (straight && aC > 0.5 && aC < 254.6) {
              const k = 255 / aC;
              rC *= k; gC *= k; bC *= k;
            }
            dstArr[di] = rC;
            dstArr[di + 1] = gC;
            dstArr[di + 2] = bC;
            dstArr[di + 3] = aC;
          } else {
            dstArr[di] = 0;
            dstArr[di + 1] = 0;
            dstArr[di + 2] = 0;
            dstArr[di + 3] = 0;
          }
        }
      }
    };

    // Hide the host and run the animation over the canvas overlay.
    host.style.visibility = 'hidden';
    // t0 AFTER the async snapshot — the animation clock must start when the
    // first frame renders, not when the snapshot began.
    const t0 = performance.now();
    const warpDurMs = warpDurationMs > 0 ? warpDurationMs : durationMs;
    let frame = 0;
    const warpEase = makeEaseSampler('cubic-bezier(0.22,1,0.36,1)');
    const blurEase = makeEaseSampler('ease-in');
    const gravityEase = makeEaseSampler('ease-in');
    const dissolveEase = makeEaseSampler('ease-out');

    const tick = (now: number) => {
      if (!runningRef.current) return;
      // Stale run: superseded by a newer dissolve — stop drawing immediately.
      if (runId !== runIdRef.current) return;
      const t = (now - t0) / 1000;
      const rawP = Math.min((now - t0) / durationMs, 1);
      const p = dissolveEase(rawP);
      const teff = gravityEase(p) * (durationMs / 1000);
      const fallY = 0.5 * gravity * teff * teff;
      const swayX = Math.sin(t * 5) * sway * p;
      const pw = Math.min((now - t0) / warpDurMs, 1);
      const dispScale = warp * warpEase(pw);
      const blur = maxBlur * blurEase(p);
      const alpha = 1 - Math.pow(p, 1.6);
      const driftY = churn * t;
      const driftX = Math.sin(t * 3.2) * churn * 0.3;

      if (frame % 2 === 0 || rawP >= 1) {
        const halfDev = (dispScale / 2) * dpr;
        for (let ly = 0; ly < latH; ly++) {
          const py = (ly * 4 - padDev) / dpr;
          for (let lx = 0; lx < latW; lx++) {
            const px = (lx * 4 - padDev) / dpr;
            const li = ly * latW + lx;
            latDX[li] = halfDev * noise2(noiseR, px - driftX, py - driftY);
            latDY[li] = halfDev * noise2(noiseG, px - driftX, py - driftY);
          }
        }
        const rBox = blur > 0.3 ? Math.round(blur * dpr * 1.22) : 0;
        if (rBox >= 2) {
          remap(halfData.data, workHalf.width, workHalf.height, 2, false);
          const rHalf = Math.max(1, Math.round(rBox / 2));
          boxH(halfData.data, blurTmp, workHalf.width, workHalf.height, rHalf);
          boxH(blurTmp, halfData.data, workHalf.width, workHalf.height, rHalf);
          boxV(halfData.data, blurTmp, workHalf.width, workHalf.height, rHalf, false);
          boxV(blurTmp, halfData.data, workHalf.width, workHalf.height, rHalf, true);
          whctx.putImageData(halfData, 0, 0);
          ctx.clearRect(0, 0, workW, workH);
          ctx.drawImage(workHalf, 0, 0, workHalf.width, workHalf.height, 0, 0, workW, workH);
        } else {
          remap(workData.data, workW, workH, 1, true);
          ctx.putImageData(workData, 0, 0);
        }
      }
      frame++;
      canvas.style.transform =
        `translate(${swayX.toFixed(1)}px, ${fallY.toFixed(1)}px) ` +
        `rotate(${(spin * p).toFixed(2)}deg) ` +
        `scale(${(1 + (spread / 100) * p).toFixed(3)})`;
      canvas.style.opacity = alpha.toFixed(3);

      if (rawP < 1) {
        requestAnimationFrame(tick);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.transform = '';
      canvas.style.opacity = '';
      canvas.style.visibility = 'hidden';
      runningRef.current = false;
      onDissolvedRef.current?.();
    };
    requestAnimationFrame(tick);
  }, [churn, durationMs, gravity, isImage, maxBlur, spin, spread, sway, warp, warpDurationMs]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  return {
    rootRef,
    hostRef,
    canvasRef,
    trigger: dissolve,
  };
}

export function SmokyDissolve({ dissolving, ...rest }: SmokyDissolveProps & { dissolving?: boolean }) {
  const { rootRef, hostRef, canvasRef, trigger } = useSmokyDissolve(rest);

  // Trigger the dissolve when the consumer flips `dissolving` to true.
  const triggeredRef = useRef(false);
  useEffect(() => {
    if (dissolving && !triggeredRef.current) {
      triggeredRef.current = true;
      void trigger();
    }
    if (!dissolving) triggeredRef.current = false;
  }, [dissolving, trigger]);

  // The canvas must be fully imperative after mount: React re-renders (gateway
  // polls, typing, any parent state) would replay a `style` prop and clobber
  // the per-frame transform/opacity/visibility written by the dissolve loop —
  // leaving the animation flickering and unsmooth. Keep only static geometry
  // in the style prop and drive everything else imperatively.
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.visibility = 'hidden';
    }
  }, [canvasRef]);

  return (
    <div ref={rootRef} className={`smoky-dissolve-root relative w-fit ${rest.className ?? ''}`}>
      <div ref={hostRef} className={rest.className} data-smoky-dissolve="host">
        {rest.children}
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-smoky-dissolve="canvas"
        style={{
          position: 'fixed',
          zIndex: 40,
          pointerEvents: 'none',
          willChange: 'transform, opacity',
        }}
      />
    </div>
  );
}
