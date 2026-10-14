import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

/**
 * Locale is carried in a cookie, not a URL prefix.
 *
 * This site is a handful of pages. Prefixing every route would make shared links longer
 * and give the same launch two addresses, for no discoverability gain.
 */
async function resolveLocale(): Promise<Locale> {
  // Static export has no request: use a fixed locale.
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === "1") {
    const fixed = process.env.NEXT_PUBLIC_STATIC_LOCALE;
    return isLocale(fixed) ? fixed : "zh";
  }
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  // No explicit choice yet — follow the browser, then fall back to English.
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().includes("zh") ? "zh" : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
