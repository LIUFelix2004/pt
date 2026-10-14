import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cloudflare Pages: `NEXT_PUBLIC_STATIC_EXPORT=1 next build` emits a static site in out/.
  ...(process.env.NEXT_PUBLIC_STATIC_EXPORT === "1" ? { output: "export" as const, trailingSlash: true } : {}),
};

export default withNextIntl(nextConfig);
