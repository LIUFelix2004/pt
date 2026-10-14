"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LOCALES, LOCALE_COOKIE, LOCALE_LABEL, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useUiLang, type UiLang } from "@/components/portus/use-ui-lang";

/**
 * Locale switch.
 *
 * SSR/dev: cookie + refresh for next-intl.
 * Static export Pages: chrome/home use client ui-lang (next-intl locale is fixed).
 */
export function LanguageSwitcher({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uiLang, setUiLang] = useUiLang();

  const chooseSsr = (locale: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  if (compact) {
    const shown: UiLang = uiLang;
    return (
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        onClick={() => {
          const next: UiLang = shown === "zh" ? "en" : "zh";
          setUiLang(next);
          // Also try SSR path when not static-export baked.
          if (process.env.NEXT_PUBLIC_STATIC_EXPORT !== "1") {
            chooseSsr(next);
          }
        }}
        className={cn(
          "rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg",
          pending && "opacity-60",
        )}
      >
        {shown === "zh" ? "简体中文" : "English"}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex overflow-hidden rounded-md border border-line", pending && "opacity-60")}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          onClick={() => chooseSsr(locale)}
          aria-pressed={locale === active}
          className={cn(
            "px-2.5 py-1.5 font-mono text-xs transition-colors",
            locale === active ? "bg-cyan/15 text-cyan" : "bg-surface text-fg-muted hover:text-fg",
          )}
        >
          {LOCALE_LABEL[locale]}
        </button>
      ))}
    </div>
  );
}
