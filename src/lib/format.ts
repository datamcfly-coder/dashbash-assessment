// Small, dependency-free formatters shared by the dashboard UI.

/** Whole number with thousands separators: 1234 -> "1,234". */
export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** A 0–1 rate as a whole-percent string: 0.313 -> "31%". */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** A rate delta as signed percentage points: 0.037 -> "+3.7pp", -0.012 -> "-1.2pp". */
export function pp(delta: number): string {
  const points = delta * 100;
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(1)}pp`;
}

/** A signed integer delta: 147 -> "+147", -20 -> "-20". */
export function signedInt(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${num(Math.abs(n))}`;
}
