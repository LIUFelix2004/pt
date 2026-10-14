"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALES, LOCALE_COOKIE, LOCALE_LABEL, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Locale switch.
 *
 * Writes the choice to a cookie and refreshes so the server re-renders with the
 * new messages. One year of persistence — a reader who picks a language should
 * not have to pick it again.
 */
export function LanguageSwitcher({ label }: { label: string }) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-line",
        pending && "opacity-60",
      )}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => choose(locale)}
          aria-pressed={locale === active}
          className={cn(
            "px-2.5 py-1.5 font-mono text-xs transition-colors",
            locale === active
              ? "bg-cyan/15 text-cyan"
              : "bg-surface text-fg-muted hover:text-fg",
          )}
        >
          {LOCALE_LABEL[locale]}
        </button>
      ))}
    </div>
  );
}
