"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUiLang } from "@/components/portus/use-ui-lang";
import { cn } from "@/lib/utils";

const ZH = {
  taxed: "创建代币（有税）",
  taxedHint: "买卖税 1%–5%，创建者获得 T−0.2%",
  plain: "创建代币",
  plainHint: "无买卖税，仅收 1% 池子交易费",
  close: "取消",
};
const EN = {
  taxed: "Create token (with tax)",
  taxedHint: "1%–5% buy/sell tax, creator earns T−0.2%",
  plain: "Create token",
  plainHint: "No buy/sell tax, only the 1% pool fee",
  close: "Cancel",
};

/** flap.sh-style chooser: dropdown on desktop, bottom sheet on mobile. */
export function CreateMenu({
  children,
  className,
  align = "center",
}: {
  children: ReactNode;
  className?: string;
  align?: "center" | "left";
}) {
  const [open, setOpen] = useState(false);
  const [lang] = useUiLang();
  const t = lang === "en" ? EN : ZH;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(el) && !el.closest?.("[data-create-sheet]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { href: "/create/?tax=1", label: t.taxed, hint: t.taxedHint, icon: "%" },
    { href: "/create/?tax=0", label: t.plain, hint: t.plainHint, icon: "+" },
  ];
  const list = (
    <div className="flex flex-col gap-1">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          onClick={() => {
            setOpen(false);
            window.dispatchEvent(new CustomEvent("portus-tax", { detail: it.href.endsWith("0") ? 0 : 1 }));
          }}
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-2"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 text-base font-bold text-brand">{it.icon}</span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-fg">{it.label}</span>
            <span className="block text-xs text-fg-muted">{it.hint}</span>
          </span>
        </Link>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={className}>
        {children}
      </button>
      {open ? (
        <>
          {/* desktop dropdown */}
          <div
            role="menu"
            className={cn(
              "absolute top-full z-40 mt-2 hidden w-[300px] rounded-2xl border border-line bg-bg p-2 text-left shadow-[0_18px_50px_-12px_rgba(0,0,0,0.25)] sm:block",
              align === "center" ? "left-1/2 -translate-x-1/2" : "left-0",
            )}
          >
            {list}
          </div>
          {/* mobile bottom sheet */}
          {createPortal(
          <div data-create-sheet className="fixed inset-0 z-50 sm:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div role="menu" className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-line bg-bg p-4 pb-6 text-left">
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
              {list}
              <button type="button" onClick={() => setOpen(false)} className="mt-2 w-full rounded-xl border border-line py-3 text-sm text-fg">
                {t.close}
              </button>
            </div>
          </div>,
          document.body,
          )}
        </>
      ) : null}
    </div>
  );
}
