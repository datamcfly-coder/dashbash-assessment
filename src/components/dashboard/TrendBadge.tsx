import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { pp } from "@/lib/format";

// A colored chip showing a week-over-week rate change. Green up, amber down,
// muted flat. `neutralBelow` treats tiny moves as flat so we don't cry wolf
// over statistical noise.

export function TrendBadge({
  delta,
  neutralBelow = 0.005,
  className,
}: {
  /** Rate delta in 0–1 units (e.g. +0.037 = +3.7pp). */
  delta: number;
  neutralBelow?: number;
  className?: string;
}) {
  const flat = Math.abs(delta) < neutralBelow;
  const up = delta > 0;

  const tone = flat
    ? "text-muted bg-white/5"
    : up
      ? "text-success bg-success/10"
      : "text-warning bg-warning/10";

  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        tone,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {flat ? "flat" : pp(delta)}
    </span>
  );
}
