"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getLaunch, type Launch } from "@/lib/api";
import { LiveLaunch } from "./live-launch";

const TOKEN_RE = /\/launch\/(0x[0-9a-fA-F]{40})(?:\/|$)/i;

function isToken(value: string | null | undefined): value is string {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Prefer ?token= (static /launch/view/), then path, then prop. */
function tokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search).get("token");
  if (isToken(fromQuery)) return fromQuery;
  const m = window.location.pathname.match(TOKEN_RE);
  return m ? m[1] : null;
}

/**
 * Client recoverer for static Pages:
 * - /launch/view/?token=0x... (preferred; no dynamic SSG)
 * - legacy /launch/<token>/ path when a shell HTML is served
 */
export function LaunchBoot({ token: propToken }: { token?: string }) {
  const tc = useTranslations("common");
  const [token, setToken] = useState<string | null>(() =>
    isToken(propToken) ? propToken : null,
  );
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fromLoc = tokenFromLocation();
    if (isToken(fromLoc)) {
      setToken(fromLoc);
      return;
    }
    if (isToken(propToken)) setToken(propToken);
  }, [propToken]);

  useEffect(() => {
    if (!isToken(token)) return;
    let stopped = false;
    const tick = async () => {
      try {
        const fresh = await getLaunch(token);
        if (stopped) return;
        if (fresh) {
          setLaunch(fresh);
          setError(false);
          setGone(false);
        } else {
          setLaunch(null);
          setGone(true);
        }
      } catch {
        if (!stopped) setError(true);
      }
    };
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [token]);

  if (launch) {
    return (
      <>
        <Link href="/" className="font-mono text-xs text-fg-muted transition-colors hover:text-cyan">
          {tc("allLaunches")}
        </Link>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{launch.copy.name}</h1>
          <span className="font-mono text-sm text-fg-muted">${launch.copy.symbol}</span>
        </div>
        <div className="mt-5">
          <LiveLaunch initial={launch} />
        </div>
      </>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-line bg-surface/50 p-10 text-center text-sm text-fg-muted">
      {!isToken(token)
        ? tc("pending")
        : gone
          ? tc("none")
          : error
            ? tc("apiDown")
            : tc("pending")}
      <div className="mt-4">
        <Link href="/" className="font-mono text-xs text-cyan hover:underline">
          {tc("allLaunches")}
        </Link>
      </div>
    </div>
  );
}