"use client";

import { useCallback, useEffect, useState } from "react";

export type UiLang = "zh" | "en";
const KEY = "portus-ui-lang";
const EVT = "portus-ui-lang";

export function readUiLang(): UiLang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return "zh";
}

export function writeUiLang(lang: UiLang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  try {
    document.cookie = `PORTUS_LOCALE=${lang}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: lang }));
}

/** Client language for chrome/home on static export (next-intl locale is fixed). */
export function useUiLang(): [UiLang, (l: UiLang) => void] {
  const [lang, setLang] = useState<UiLang>("zh");
  useEffect(() => {
    setLang(readUiLang());
    const on = (e: Event) => setLang((e as CustomEvent<UiLang>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  const set = useCallback((l: UiLang) => {
    writeUiLang(l);
    setLang(l);
  }, []);
  return [lang, set];
}
