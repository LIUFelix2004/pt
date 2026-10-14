import { cn } from "@/lib/utils";

/** Section heading with a hairline neon rule beneath it. */
export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-10", className)}>
      <h2 className="text-[11px] font-semibold tracking-[0.18em] text-fg-muted uppercase">
        {title}
      </h2>
      <div className="rule-neon mt-2 mb-4 h-px w-full opacity-70" />
      {children}
    </section>
  );
}
