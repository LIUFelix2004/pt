import { cn } from "@/lib/utils";

export type Phase =
  | "PENDING"
  | "COMMIT"
  | "REVEAL"
  | "SETTLING"
  | "SETTLED"
  | "CANCELLED";

/**
 * Colour is never the only signal here — the phase name is always rendered
 * alongside it, so the badge stays readable for colour-blind users and in
 * grayscale. Amber is deliberately absent from this scale: it belongs to
 * untrusted content and forfeiture warnings only.
 */
const TONE: Record<Phase, string> = {
  PENDING: "border-line text-fg-muted bg-surface-2",
  COMMIT: "border-cyan/45 text-cyan bg-cyan/10",
  REVEAL: "border-magenta/45 text-magenta bg-magenta/10",
  SETTLING: "border-lime/40 text-lime bg-lime/10",
  SETTLED: "border-line-bright text-fg bg-surface-2",
  CANCELLED: "border-rose/40 text-rose bg-rose/10",
};

export function PhaseBadge({
  phase,
  count,
  live = false,
  className,
}: {
  phase: Phase;
  count?: number;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "font-mono text-[11px] tracking-[0.08em] whitespace-nowrap",
        TONE[phase],
        className,
      )}
    >
      {live ? <span className="pulse-live size-1.5 rounded-full bg-current" /> : null}
      {phase}
      {count === undefined ? null : <span className="opacity-70">{count}</span>}
    </span>
  );
}
