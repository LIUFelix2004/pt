import { cn } from "@/lib/utils";

/** Label/value pair used across the dashboard and detail readouts. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[15px] text-fg">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-fg-muted">{hint}</div> : null}
    </div>
  );
}
