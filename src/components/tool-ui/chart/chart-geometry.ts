/** Pure chart geometry, kept apart from the components so it can be tested on its own. */

const BAR_RADIUS = 4;

/** Clean tick values spanning at least [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const low = Math.min(min, max);
  let high = Math.max(min, max);
  if (low === high) high = low === 0 ? 1 : low + Math.abs(low);
  const rawStep = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** A column with a rounded data end and a square foot on the baseline. */
export function barPath(x: number, width: number, baseline: number, valueY: number): string {
  const up = valueY < baseline;
  const height = Math.abs(baseline - valueY);
  const radius = Math.min(BAR_RADIUS, width / 2, height);
  const end = up ? valueY + radius : valueY - radius;
  const sweep = up ? 1 : 0;
  return [
    `M${x},${baseline}`,
    `L${x},${end}`,
    `A${radius},${radius} 0 0 ${sweep} ${x + radius},${valueY}`,
    `L${x + width - radius},${valueY}`,
    `A${radius},${radius} 0 0 ${sweep} ${x + width},${end}`,
    `L${x + width},${baseline}`,
    'Z',
  ].join(' ');
}

/** One pie slice, or a full disc when a single value is the whole. */
export function sliceGeometry(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  if (sweep >= Math.PI * 2 - 1e-6) {
    return `M${cx - radius},${cy} A${radius},${radius} 0 1 1 ${cx + radius},${cy} A${radius},${radius} 0 1 1 ${cx - radius},${cy} Z`;
  }
  const point = (angle: number) => `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
  return `M${cx},${cy} L${point(startAngle)} A${radius},${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(endAngle)} Z`;
}

export type PieSlice = { index: number; value: number; share: number; start: number; end: number };

/** Slices clockwise from twelve o'clock. A missing value takes no angle but keeps its index. */
export function pieSlices(data: Array<number | null>): PieSlice[] {
  const total = data.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const slices: PieSlice[] = [];
  let angle = -Math.PI / 2;
  data.forEach((value, index) => {
    const share = (value ?? 0) / total;
    const start = angle;
    angle += share * Math.PI * 2;
    slices.push({ index, value: value ?? 0, share, start, end: angle });
  });
  return slices;
}
