import { useLayoutEffect, useMemo, useRef } from 'react';
import { prepare, layout, clearCache, type PrepareOptions } from '@chenglou/pretext';

type PretextMeasure = {
  (text: string, maxWidth: number, lineHeight: number): { height: number; lineCount: number };
  clear: () => void;
  /**
   * True when Canvas 2D context is available. In test environments (jsdom)
   * this is false and the caller should fall back to DOM-based measurement.
   */
  available: boolean;
};

function canUsePretext(): boolean {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      new OffscreenCanvas(1, 1).getContext('2d');
      return true;
    }
    if (typeof HTMLCanvasElement !== 'undefined') {
      const canvas = document.createElement('canvas');
      return canvas.getContext('2d') !== null;
    }
    return false;
  } catch {
    return false;
  }
}

const _available = canUsePretext();

/**
 * Returns a stable measure function that uses Pretext (canvas-measureText based)
 * to compute multiline text height without triggering DOM reflow.
 *
 * When Canvas 2D is unavailable (jsdom test environments), measure.available
 * is false and the returned function always returns { height: 0, lineCount: 0 }.
 * The caller should fall back to scrollHeight in that case.
 *
 * @param font - CSS font string (e.g. '14px Inter')
 * @param options - optional PrepareOptions (whiteSpace, wordBreak, letterSpacing)
 * @returns (text, maxWidth, lineHeight) => { height, lineCount }
 */
export function usePretextMeasure(
  font: string,
  options?: PrepareOptions,
): PretextMeasure {
  const fontRef = useRef(font);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    fontRef.current = font;
    optionsRef.current = options;
  }, [font, options]);

  const measure = useMemo<PretextMeasure>(() => {
    const fn = (text: string, maxWidth: number, lineHeight: number) => {
      if (!_available) {
        return { height: 0, lineCount: 0 };
      }
      const prepared = prepare(text, fontRef.current, optionsRef.current);
      return layout(prepared, maxWidth, lineHeight);
    };
    fn.clear = () => {
      if (_available) clearCache();
    };
    fn.available = _available;
    return fn;
  }, []);

  return measure;
}
