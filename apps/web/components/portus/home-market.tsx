"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getLaunches, type Launch } from "@/lib/api";
import { CHAIN_INFO } from "@/lib/chain";
import { useUiLang } from "@/components/portus/use-ui-lang";
import { cn } from "@/lib/utils";

const ZH = {
  slogan: "Launch Social. Launch Anywhere",
  cta: "创建代币 →",
  sTotal: "代币总数",
  sLive: "进行中",
  sChain: "网络",
  trend: "热门趋势",
  hot: "热门",
  new: "最新",
  vol: "交易量",
  mc: "市值",
  search: "通过代币符号或 CA 搜索",
  cTok: "代币",
  cMc: "市值",
  cVol: "24h交易量",
  cPx: "价格",
  cHold: "持有者",
  empty: "平台上还没有代币，",
  emptyCta: "去创建第一个 →",
  noFav: "还没有收藏，点行首 ★ 收藏代币",
  noMatch: "没有匹配的代币",
  noTrend: "暂无热门代币",
  apiDown: "加载代币列表失败（API 不可用）",
  salePrice: "发行价",
  foot: "数据来自 Portus 链上索引 API；24h 交易量、持有者暂未索引，显示为 —",
  mint: "铸币",
  minting: "铸造中",
  featured: "热门铸造",
  raiseTarget: "总募集",
  raised: "已募集",
  view: "查看详情 →",
  wl: "下载 DeBox 了解更多",
  wlCta: "下载 DeBox ↗",
  noFeat: "暂无正在铸造的代币",
  latest: "最新",
};
const EN = {
  slogan: "Launch Social. Launch Anywhere",
  cta: "Create token →",
  sTotal: "Tokens",
  sLive: "Live",
  sChain: "Network",
  trend: "Trending",
  hot: "Hot",
  new: "New",
  vol: "Volume",
  mc: "Market cap",
  search: "Search by symbol or CA",
  cTok: "Token",
  cMc: "Market cap",
  cVol: "24h volume",
  cPx: "Price",
  cHold: "Holders",
  empty: "No tokens yet. ",
  emptyCta: "Create the first one →",
  noFav: "No favourites yet — tap ★ on a row.",
  noMatch: "No match.",
  noTrend: "Nothing trending yet.",
  apiDown: "Couldn't load launches (API).",
  salePrice: "sale price",
  foot: "Data: Portus indexer API. 24h volume / holders not yet indexed.",
  mint: "Mint",
  minting: "Minting",
  featured: "Hot mint",
  raiseTarget: "Raise target",
  raised: "Raised",
  view: "View details →",
  wl: "Download DeBox to learn more",
  wlCta: "Get DeBox ↗",
  noFeat: "No token is minting right now",
  latest: "Latest",
};

const FAV_KEY = "portus-favs";
const LIVE: Record<string, true> = {
  SUBSCRIBING: true,
  LIVE: true,
  TRADING: true,
  OPEN: true,
  MINTING: true,
};

type Tab = "fav" | "hot" | "new" | "vol" | "mc";

function short(a?: string | null) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
}

function num(s: string | null | undefined, d: number): number | null {
  if (s == null) return null;
  try {
    const b = BigInt(s);
    const base = 10n ** BigInt(d);
    return Number(b / base) + Number(b % base) / Number(base);
  } catch {
    return null;
  }
}

function fmt(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (a >= 1) return n.toFixed(2);
  const z = -Math.floor(Math.log10(a)) - 1;
  if (z >= 4) {
    const sig = Math.round(a * Math.pow(10, z + 4));
    return `0.0{${z}}${sig}`;
  }
  return n.toPrecision(4);
}

type Metrics = {
  price: number | null;
  src: "" | "pool" | "sale";
  mc: number | null;
  tvl: number | null;
  sym: string;
  raised: number | null;
};

function metrics(l: Launch): Metrics {
  const dq = l.quote?.decimals ?? 18;
  const sym = l.quote?.symbol ?? "";
  let price: number | null = null;
  let src: Metrics["src"] = "";
  const rq = num(l.reserveQuote, dq);
  const rt = num(l.reserveToken, 18);
  if (rq != null && rt) {
    price = rq / rt;
    src = "pool";
  } else if (l.priceNum && l.priceDen && l.phase !== "REFUNDING" && l.outcome !== "REFUNDED") {
    price = Number(l.priceNum) / Number(l.priceDen);
    src = "sale";
  }
  let supply: number | null = null;
  try {
    supply = num(
      (
        BigInt(l.qSale || 0) +
        BigInt(l.qLp || 0) +
        BigInt(l.qInc || 0) -
        BigInt(l.tokensBurned || 0)
      ).toString(),
      18,
    );
  } catch {
    supply = null;
  }
  const mc = price != null && supply != null ? price * supply : null;
  const pq = num(l.poolQuote, dq);
  const tvl = rq != null ? rq * 2 : pq != null ? pq * 2 : null;
  return { price, src, mc, tvl, sym, raised: num(l.totalCommitted, dq) };
}

function unit(v: number | null, sym: string) {
  return v == null ? "—" : `${fmt(v)}${sym ? ` ${sym}` : ""}`;
}

function tokenName(l: Launch) {
  return l.copy?.name || l.copy?.symbol || short(l.token);
}

function phaseLabel(l: Launch, mintLabel: string) {
  if (l.kind === "MINT") return mintLabel;
  return l.phase || "";
}

function TokenIcon({ l }: { l: Launch }) {
  const im = l.copy?.imageUrl;
  const letter = tokenName(l).slice(0, 1).toUpperCase();
  if (im && /^https?:\/\//.test(im)) {
    return (
      // Creator-supplied image — untrusted; never used for trust decisions.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={im} alt="" className="h-full w-full object-cover" />
    );
  }
  return <span className="text-xl font-extrabold">{letter}</span>;
}

function FeaturedCard({ l: f, t, apiErr }: { l: { l: Launch; live: boolean } | null; t: typeof ZH; apiErr: boolean }) {
  if (!f) {
    return (
      <div className="rounded-3xl border border-line bg-bg p-8 text-center text-fg-muted">
        {apiErr ? t.apiDown : t.noFeat}
        <WlLine t={t} />
      </div>
    );
  }
  const l = f.l;
  const dq = l.quote?.decimals ?? 18;
  const sym = l.quote?.symbol === "WETH" ? "ETH" : l.quote?.symbol ?? "";
  const target = num(l.raiseTarget, dq);
  const raised = num(l.totalCommitted, dq);
  const pct = target && raised != null ? Math.min(100, (raised / target) * 100) : 0;
  return (
    <div className="mx-auto w-full max-w-[480px] rounded-3xl border border-line bg-bg p-5 shadow-[0_20px_50px_-30px_rgba(15,20,40,0.35)] sm:p-6">
      <div className="mb-4 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-brand">
          {f.live ? <span className="h-2 w-2 animate-pulse rounded-full bg-[#22c55e]" /> : null}
          {f.live ? `${t.minting} · ${t.featured}` : t.latest}
        </span>
        <span className="text-xs text-fg-muted">{phaseLabel(l, t.mint)}</span>
      </div>
      <Link href={`/launch/view/?token=${encodeURIComponent(l.token)}`} className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2">
          <TokenIcon l={l} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold text-fg">{tokenName(l)}</div>
          <div className="text-sm text-fg-muted">${l.copy?.symbol || "—"} · {short(l.token)}</div>
        </div>
      </Link>
      <div className="mt-6 flex justify-between text-sm">
        <span className="text-fg-muted">{t.raiseTarget} <b className="text-fg">{unit(target, sym)}</b></span>
        <span className="text-fg-muted">{t.raised} <b className="text-brand">{unit(raised, sym)}</b></span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-gradient-to-r from-[#6d28d9] via-[#0e7490] to-[#22c55e]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-right text-xs text-fg-muted">{pct.toFixed(pct > 0 && pct < 1 ? 2 : 0)}%</div>
      <Link href={`/launch/view/?token=${encodeURIComponent(l.token)}`} className="mt-4 block rounded-xl bg-brand py-3 text-center font-semibold text-white hover:opacity-90">
        {t.view}
      </Link>
      <WlLine t={t} />
    </div>
  );
}

function WlLine({ t }: { t: typeof ZH }) {
  return (
    <a href="https://debox.pro" target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-fg hover:border-brand">
      <img src="/debox-logo.png" alt="" width={18} height={18} className="h-[18px] w-[18px] rounded-full" />
      {t.wl}
    </a>
  );
}

/** Homepage market: clean hero + trending + searchable token table. */
export function HomeMarket({ initial }: { initial: Launch[] }) {
  const [lang] = useUiLang();
  const t = lang === "en" ? EN : ZH;
  const [all, setAll] = useState(initial);
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  const [apiErr, setApiErr] = useState(false);
  const [chainLabel, setChainLabel] = useState(CHAIN_INFO.displayName || "—");

  useEffect(() => {
    try {
      setFavs(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
    } catch {
      setFavs([]);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const list = await getLaunches();
        if (!stopped) {
          setAll(list);
          setApiErr(false);
        }
      } catch {
        if (!stopped) setApiErr(true);
      }
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok) {
          const h = (await r.json()) as { chainName?: string };
          if (!stopped && h.chainName) setChainLabel(h.chainName);
        }
      } catch {
        /* keep CHAIN_INFO */
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  const toggleFav = useCallback((token: string) => {
    setFavs((prev) => {
      const next = prev.includes(token) ? prev.filter((x) => x !== token) : [...prev, token];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const liveCount = useMemo(() => all.filter((l) => LIVE[l.phase]).length, [all]);

  const list = useMemo(() => {
    let rows = all.slice();
    if (q) {
      const k = q.toLowerCase();
      rows = rows.filter(
        (l) =>
          l.token.toLowerCase().includes(k) ||
          (l.copy?.symbol || "").toLowerCase().includes(k) ||
          (l.copy?.name || "").toLowerCase().includes(k),
      );
    }
    if (tab === "fav") rows = rows.filter((l) => favs.includes(l.token));
    const sortTab = tab === "fav" ? "new" : tab;
    const key = {
      new: (l: Launch) => l.startTime || l.launchId || 0,
      hot: (l: Launch) => (l.subscriberCount || 0) * 1e6 + (metrics(l).raised || 0),
      vol: (l: Launch) => metrics(l).raised || 0,
      mc: (l: Launch) => metrics(l).mc || 0,
    }[sortTab];
    rows.sort((a, b) => key(b) - key(a));
    return rows;
  }, [all, q, tab, favs]);

  const trending = useMemo(() => {
    return all
      .slice()
      .sort(
        (a, b) =>
          (b.subscriberCount || 0) - (a.subscriberCount || 0) ||
          (metrics(b).raised || 0) - (metrics(a).raised || 0) ||
          (b.startTime || 0) - (a.startTime || 0),
      )
      .slice(0, 10);
  }, [all]);

  const featured = useMemo(() => {
    const live = all.filter((l) => LIVE[l.phase]);
    if (live.length) return { l: live.slice().sort((a, b) => (metrics(b).raised || 0) - (metrics(a).raised || 0))[0], live: true };
    const latest = all.slice().sort((a, b) => (b.startTime || b.launchId || 0) - (a.startTime || a.launchId || 0))[0];
    return latest ? { l: latest, live: false } : null;
  }, [all]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "fav", label: "★" },
    { id: "hot", label: t.hot },
    { id: "new", label: t.new },
    { id: "vol", label: t.vol },
    { id: "mc", label: t.mc },
  ];

  return (
    <div className="relative text-fg">
      <section className="relative px-4 sm:px-7">
        <div className="relative mx-auto flex min-h-[420px] max-w-[1240px] flex-col items-center justify-center pb-10 pt-[56px] text-center sm:pt-[72px]">
          <h1 className="relative m-0 mb-4 text-[clamp(32px,5vw,64px)] font-semibold leading-[1.08] tracking-tight text-fg">
            <span className="block">{t.slogan.split(". ")[0]}</span>
            <span className="block">{t.slogan.split(". ")[1]}</span>
          </h1>
          <Link
            href="/create"
            className="relative mt-4 inline-block rounded-[20px] bg-brand px-14 py-4 text-[20px] font-semibold text-white shadow-[0_10px_30px_-8px_var(--brand)] transition hover:brightness-110"
          >
            {t.cta}
          </Link>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3 text-sm text-fg-muted">
            {[
              [all.length, t.sTotal],
              [liveCount, t.sLive],
              [chainLabel, t.sChain],
            ].map(([v, k]) => (
              <div key={String(k)} className="rounded-2xl border border-line bg-surface/70 px-5 py-3 backdrop-blur">
                <b className="block text-[20px] text-fg">{v}</b>
                <span>{k}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-2 w-full max-w-[400px] min-[1400px]:absolute min-[1400px]:right-6 min-[1400px]:top-[64px] min-[1400px]:mt-0 min-[1400px]:w-[340px]">
          <FeaturedCard l={featured} t={t} apiErr={apiErr} />
        </div>
      </section>

      <main className="mx-auto max-w-[1240px] px-4 sm:px-5">
        <h2 className="mb-3 mt-6 text-lg">
          🔥 {t.trend}
        </h2>
        <div className="mb-2.5 flex gap-3.5 overflow-x-auto pb-2.5 [scroll-snap-type:x_mandatory]">
          {trending.length === 0 ? (
            <div className="flex-1 py-10 text-center text-fg-muted">{apiErr ? t.apiDown : t.noTrend}</div>
          ) : (
            trending.map((l) => {
              const m = metrics(l);
              return (
                <Link
                  key={l.token}
                  href={`/launch/view/?token=${encodeURIComponent(l.token)}`}
                  className="flex w-[min(270px,80vw)] shrink-0 snap-start gap-3 rounded-2xl border border-line bg-surface/80 p-3 backdrop-blur hover:border-brand"
                >
                  <div className="grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-surface-2">
                    <TokenIcon l={l} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-1.5">
                      <span className="truncate font-bold">{tokenName(l)}</span>
                      <span className="shrink-0 text-[13px] text-brand">MC: {unit(m.mc, m.sym)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-fg-muted">CA: {short(l.token)}</div>
                    <div className="mt-0.5 text-[13px]">{unit(m.price, m.sym)}</div>
                  </div>
                </Link>
              );
            })
          )}
        </div>

        <div className="mb-3.5 mt-6 flex flex-wrap items-center gap-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.trimStart())}
            placeholder={t.search}
            className="w-full min-w-0 flex-1 basis-full sm:max-w-[380px] sm:basis-[320px] rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-sm text-fg outline-none focus:border-brand"
          />
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={cn(
                "cursor-pointer rounded-[10px] border-0 bg-surface-2 px-3 py-2 sm:min-w-24 sm:px-4 sm:py-2.5 text-sm text-fg",
                tab === tb.id && "bg-brand text-white",
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="mb-10 overflow-x-auto rounded-[20px] border border-line bg-surface/80 backdrop-blur">
          <table className="w-full min-w-[640px] sm:min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-surface px-2.5 py-3.5 pl-14 text-left text-xs font-normal text-fg-muted">{t.cTok}</th>
                <th className="px-2.5 py-3.5 text-center text-xs font-normal text-fg-muted">{t.cMc}</th>
                <th className="px-2.5 py-3.5 text-center text-xs font-normal text-fg-muted">{t.cVol}</th>
                <th className="px-2.5 py-3.5 text-center text-xs font-normal text-fg-muted">{t.cPx}</th>
                <th className="px-2.5 py-3.5 text-center text-xs font-normal text-fg-muted">{t.cHold}</th>
                <th className="px-2.5 py-3.5 text-center text-xs font-normal text-fg-muted">TVL</th>
              </tr>
            </thead>
            <tbody>
              {apiErr && all.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-fg-muted">
                    {t.apiDown}
                  </td>
                </tr>
              ) : all.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-fg-muted">
                    {t.empty}{" "}
                    <Link href="/create" className="text-brand">
                      {t.emptyCta}
                    </Link>
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-fg-muted">
                    {tab === "fav" ? t.noFav : t.noMatch}
                  </td>
                </tr>
              ) : (
                list.map((l) => {
                  const m = metrics(l);
                  const f = favs.includes(l.token);
                  return (
                    <tr
                      key={l.token}
                      className="cursor-pointer hover:bg-surface"
                      onClick={() => {
                        window.location.href = `/launch/view/?token=${encodeURIComponent(l.token)}`;
                      }}
                    >
                      <td className="sticky left-0 z-[1] border-t border-line bg-surface px-2.5 py-3 text-left text-sm">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className={cn("border-0 bg-transparent px-1 text-lg", f ? "text-[#f5c44a]" : "text-fg-muted")}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFav(l.token);
                            }}
                            aria-label="favorite"
                          >
                            ★
                          </button>
                          <div className="grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-surface-2">
                            <TokenIcon l={l} />
                          </div>
                          <div>
                            <div>
                              <b>{tokenName(l)}</b>
                              <span className="ml-1.5 inline-block rounded bg-surface-2 px-1.5 py-px text-[11px] text-fg-muted">
                                {phaseLabel(l, t.mint)}
                              </span>
                            </div>
                            <div className="text-xs text-fg-muted">CA: {short(l.token)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="border-t border-line px-2.5 py-3 text-center text-sm text-brand">
                        {unit(m.mc, m.sym)}
                      </td>
                      <td className="border-t border-line px-2.5 py-3 text-center text-sm">—</td>
                      <td className="border-t border-line px-2.5 py-3 text-center text-sm">
                        {unit(m.price, m.sym)}
                        {m.src === "sale" ? (
                          <div className="text-xs text-fg-muted">{t.salePrice}</div>
                        ) : null}
                      </td>
                      <td className="border-t border-line px-2.5 py-3 text-center text-sm">—</td>
                      <td className="border-t border-line px-2.5 py-3 text-center text-sm">{unit(m.tvl, m.sym)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="pb-8 text-center text-xs text-fg-muted">{t.foot}</p>

      </main>
    </div>
  );
}
