"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const BTN = "rounded border border-cyan/50 px-3 py-1.5 font-mono text-xs text-cyan hover:bg-cyan/10 disabled:opacity-40";

/** Copy an invite URL; falls back to selecting the code if clipboard is blocked. */
export function InviteLinkButton({ url, className }: { url: string; className?: string }) {
  const t = useTranslations("me");
  const [ok, setOk] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch {
      try {
        const el = document.createElement("textarea");
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setOk(true);
        setTimeout(() => setOk(false), 2000);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <button type="button" className={className ?? BTN} onClick={() => void copy()}>
      {ok ? t("copied") : t("copyInvite")}
    </button>
  );
}
