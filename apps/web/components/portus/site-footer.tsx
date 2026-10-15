"use client";

import Link from "next/link";
import { useUiLang } from "@/components/portus/use-ui-lang";
import { DOCS_URL } from "@/lib/chain";

const DEBOX_URL = "https://debox.pro";
const X_URL = process.env.NEXT_PUBLIC_X_URL || "https://x.com/PortusFun";

const ZH = {
  desc: "Launch Social. Launch Anywhere —— 铸币即发射、公平分发、链上可验证的发射平台。",
  rights: "© 2026 Portus. All rights reserved.",
  docs: "白皮书 / 文档",
  tg: "Telegram（待配置）",
  x: "X（待配置）",
};
const EN = {
  desc: "Launch Social. Launch Anywhere — mint-to-launch, fair distribution, verifiable on-chain.",
  rights: "© 2026 Portus. All rights reserved.",
  docs: "Docs (whitepaper)",
  tg: "Telegram (not configured)",
  x: "X (not configured)",
};

/** Theme-aware footer: dark surfaces in dark theme, light in light theme. */
export function SiteFooter({ note }: { note?: string }) {
  const [lang] = useUiLang();
  const t = lang === "en" ? EN : ZH;
  return (
    <footer className="portus-footer mt-auto">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-10 sm:px-7 sm:py-12 md:grid-cols-[1.4fr_1fr]">
        <div>
          <Link href="/" className="portus-footer-brand inline-flex items-center gap-2 text-xl font-extrabold">
            <span
              aria-hidden
              className="inline-grid h-[30px] w-[30px] place-items-center rounded-full bg-gradient-to-br from-[#4f6fd8] to-[#f0a35e] text-base text-white"
            >
              ⚓
            </span>
            Portus.fun
          </Link>
          <p className="portus-footer-desc mt-3 max-w-md text-sm">{t.desc}</p>
        </div>
        <div className="flex flex-col gap-4 md:items-end">
          <div className="flex items-center gap-4">
            <a href={X_URL} target="_blank" rel="noopener noreferrer" title="X" aria-label="X" className="opacity-80 hover:opacity-100">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <span className="cursor-not-allowed opacity-35" title={t.tg}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M2 11l19-8-3 18-6-5-3 4v-6l9-8-11 7z" />
              </svg>
            </span>
            <a href={DEBOX_URL} target="_blank" rel="noreferrer" title="DeBox" className="opacity-90 hover:opacity-100">
              <img src="/debox-logo.png" alt="DeBox" width={20} height={20} className="h-5 w-5 rounded-full" />
            </a>
          </div>
          {DOCS_URL ? (
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="portus-footer-link text-sm">
              {t.docs}
            </a>
          ) : null}
        </div>
      </div>
      <div className="portus-footer-bar">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-1 px-5 py-4 text-xs sm:flex-row sm:justify-between sm:px-7">
          <span>{t.rights}</span>
          {note ? <span className="break-all font-mono text-[11px]">{note}</span> : null}
        </div>
      </div>
    </footer>
  );
}
