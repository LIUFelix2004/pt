export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie name for the reader's choice. */
export const LOCALE_COOKIE = "portus-locale";

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
};

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "zh";
}
