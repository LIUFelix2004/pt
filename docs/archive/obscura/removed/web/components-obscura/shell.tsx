import { cn } from "@/lib/utils";

/** Page container. Single source of the max width and gutters. */
export function Shell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-5xl px-4 sm:px-6", className)}>{children}</div>
  );
}
