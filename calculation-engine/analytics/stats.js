/** Small numeric helpers shared by the analytics, scorecards and recommendation logic. */

export const isNum = (x) => typeof x === "number" && Number.isFinite(x);

export const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Sample standard deviation (n − 1), as Excel STDEV.S; null for fewer than two values. */
export function sampleStd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
