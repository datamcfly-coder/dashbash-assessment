import { cn } from "@/lib/utils";

// A tiny inline-SVG sparkline for a series of daily counts. Pure SVG on purpose:
// no charting dependency, renders on the server, and stays crisp at 375px.
// Shows the shape of the last N days — is the line climbing or falling?

type SparklineProps = {
  /** Daily values, oldest first. */
  values: number[];
  className?: string;
  width?: number;
  height?: number;
};

export function Sparkline({ values, className, width = 96, height = 28 }: SparklineProps) {
  if (values.length === 0) {
    return <div className={cn("text-xs text-muted", className)}>—</div>;
  }

  const max = Math.max(...values, 1); // avoid divide-by-zero; a flat-zero line sits at the bottom
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - (v / max) * height;

  const points = values.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = (values.length - 1) * stepX;
  const lastY = y(values[values.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Trend of the last ${values.length} days`}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Mark today's value so the eye lands on the most recent point. */}
      <circle cx={lastX} cy={lastY} r={2} fill="currentColor" />
    </svg>
  );
}
