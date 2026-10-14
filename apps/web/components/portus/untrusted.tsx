import { cn } from "@/lib/utils";

/**
 * The untrusted fence.
 *
 * Launch descriptions are written by the launch creator and shown to every
 * subscriber, so they are adversarial input. This
 * block is the visual counterpart of that fence and must remain the loudest
 * element on any page it appears on. Amber is reserved for it across the whole
 * theme; if a redesign makes it blend in, the redesign is wrong.
 */
export function UntrustedFence({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("fence-untrusted rounded-lg p-4 sm:p-5", className)}>
      <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-warn">
        <span aria-hidden>⚠</span>
        <span>{label}</span>
      </div>
      <div className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-[#e8d9b4]">
        {children}
      </div>
    </div>
  );
}
