import type { Metadata } from "next";
import { Geist, Geist_Mono, Silkscreen } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Providers } from "./providers";
import { RefCapture } from "@/components/portus/ref-capture";
import { BindReferrerPrompt } from "@/components/portus/bind-referrer-prompt";
import { SiteHeader } from "@/components/portus/site-header";
import { SiteFooter } from "@/components/portus/site-footer";
import { FloatingBubbles } from "@/components/ui/floating-bubbles";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const pixel = Silkscreen({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-pixel" });

export const metadata: Metadata = {
  title: "Portus.fun",
  description: "Launch Social. Launch Anywhere",
  openGraph: { title: "Portus.fun", description: "Launch Social. Launch Anywhere", siteName: "Portus.fun", type: "website" },
  twitter: { card: "summary", title: "Portus.fun", description: "Launch Social. Launch Anywhere" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("nav");

  return (
    // Wallet extensions (TokenPocket, MetaMask, …) inject attributes onto
    // <html>/<body> before React hydrates. Suppress only these two elements'
    // own attribute diffs; mismatches deeper in the tree still surface.
    <html lang={locale} className={cn(geist.variable, geistMono.variable, pixel.variable)} suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint (default light). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("portus.theme");if(t==="dark"){document.documentElement.classList.add("dark")}else{document.documentElement.classList.add("light")}}catch(e){document.documentElement.classList.add("light")}`,
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col font-sans" suppressHydrationWarning>
        <NextIntlClientProvider>
          {/* Site-wide backdrop. Fixed and non-interactive, so it never enters
              the layout or intercepts a click. */}
          <FloatingBubbles />

          <SiteHeader />

          <Providers>
            <RefCapture />
            <BindReferrerPrompt />
            <div className="flex-1 min-w-0">{children}</div>
          </Providers>

          <SiteFooter note={t("footer")} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
