import { cn } from "@/lib/utils";
import type { SalePhase } from "@/lib/api";

export type Phase = SalePhase;

/**
 * Colour is never the only signal — the phase label is always rendered with
 * it, so the badge reads in grayscale and for colour-blind users. Amber is
 * deliberately absent: it belongs to untrusted content and fund-risk warnings.
 */
const TONE: Record<Phase, string> = {
  PENDING: "border-line text-fg-muted bg-surface-2",
  OPEN: "border-cyan/45 text-cyan bg-cyan/10",
  AWAITING_FINALIZE: "border-magenta/45 text-magenta bg-magenta/10",
  SUCCEEDED: "border-lime/40 text-lime bg-lime/10",
  REFUNDING: "border-rose/40 text-rose bg-rose/10",
};

export function PhaseBadge({
  phase,
  label,
  count,
  live = false,
  className,
}: {
  phase: Phase;
  /** Localised phase name; falls back to the enum value. */
  label?: string;
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
      {label ?? phase}
      {count === undefined ? null : <span className="opacity-70">{count}</span>}
    </span>
  );
}
