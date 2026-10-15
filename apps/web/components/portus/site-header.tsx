"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/portus/theme-toggle";
import { LanguageSwitcher } from "@/components/portus/language-switcher";
import { useUiLang } from "@/components/portus/use-ui-lang";
import { DOCS_URL } from "@/lib/chain";
import { cn } from "@/lib/utils";
import { CreateMenu } from "@/components/portus/create-menu";

export const DEBOX_URL = "https://debox.pro";
export const X_URL = process.env.NEXT_PUBLIC_X_URL || "https://x.com/ARCISALL";

const ZH = {
  home: "首页",
  create: "创建",
  me: "个人主页",
  rewards: "奖励",
  docs: "文档",
  language: "语言",
  telegramPending: "Telegram（待配置）",
  xPending: "X（待配置）",
  debox: "DeBox",
};
const EN = {
  home: "Home",
  create: "Create",
  me: "Profile",
  rewards: "Rewards",
  docs: "Docs",
  language: "Language",
  telegramPending: "Telegram (not configured)",
  xPending: "X (not configured)",
  debox: "DeBox",
};

const LINKS = [
  { href: "/", key: "home" as const, match: (p: string) => p === "/" },
  { href: "/create", key: "create" as const, match: (p: string) => p.startsWith("/create") },
  { href: "/me", key: "me" as const, match: (p: string) => p.startsWith("/me") },
  { href: "/flywheel", key: "rewards" as const, match: (p: string) => p.startsWith("/flywheel") },
];

function DocsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 3v5h5" fill="var(--bg)" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2 11l19-8-3 18-6-5-3 4v-6l9-8-11 7z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Shared top chrome: Portus.fun + 首页/创建/个人主页/奖励 + docs/TG/X + language. */
export function SiteHeader() {
  const pathname = usePathname() || "/";
  const [lang] = useUiLang();
  const t = lang === "en" ? EN : ZH;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-3 sm:gap-5 sm:px-7">
        <Link href="/" className="inline-flex shrink-0 items-center gap-2 text-lg font-extrabold sm:text-xl text-brand">
          <span
            aria-hidden
            className="inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-gradient-to-br from-[#4f6fd8] to-[#f0a35e] text-base text-white"
          >
            ⚓
          </span>
          Portus.fun
        </Link>

        <nav className="hidden items-center gap-5 text-base sm:flex">
          {LINKS.map((l) => {
            const on = l.match(pathname);
            if (l.key === "create")
              return (
                <CreateMenu
                  key={l.href}
                  align="left"
                  className={cn("rounded-lg px-2.5 py-1.5 text-fg transition-colors hover:text-fg", on && "bg-surface-2 text-brand")}
                >
                  {t[l.key]}
                </CreateMenu>
              );
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-fg transition-colors hover:text-fg",
                  on && "bg-surface-2 text-brand",
                )}
              >
                {t[l.key]}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-2.5 text-fg sm:gap-4">
          {DOCS_URL ? (
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              title={t.docs}
              className="opacity-80 transition-opacity hover:opacity-100"
            >
              <DocsIcon />
            </a>
          ) : null}
          <span className="hidden cursor-not-allowed opacity-30 sm:inline" title={t.telegramPending}>
            <TelegramIcon />
          </span>
          <a href={X_URL} target="_blank" rel="noopener noreferrer" title="X" aria-label="X" className="opacity-80 transition-opacity hover:opacity-100">
            <XIcon />
          </a>
          <a
            href={DEBOX_URL}
            target="_blank"
            rel="noreferrer"
            title={t.debox}
            className="opacity-90 transition-opacity hover:opacity-100"
          >
            {/* Official DeBox mark, from app.debox.pro/_next/static/media/logo.*.svg */}
            <img src="/debox-logo.png" alt="DeBox" width={22} height={22} className="h-[22px] w-[22px] rounded-full" />
          </a>
          <ThemeToggle />
          <LanguageSwitcher label={t.language} compact />
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-2 sm:hidden">
        {LINKS.map((l) => {
          const on = l.match(pathname);
          if (l.key === "create")
            return (
              <CreateMenu key={l.href} align="left" className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm text-fg", on && "bg-surface-2 text-brand")}>
                {t[l.key]}
              </CreateMenu>
            );
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-sm text-fg",
                on && "bg-surface-2 text-brand",
              )}
            >
              {t[l.key]}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
