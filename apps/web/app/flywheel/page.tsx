import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Shell } from "@/components/portus/shell";
import { formatUnits, getFlywheel, getQuoteAssets, when } from "@/lib/api";


export default async function FlywheelPage() {
  const t = await getTranslations("flywheel");
  const assets = (await getQuoteAssets().catch(() => [])).filter((a) => a.allowed);
  const rounds = await Promise.all(assets.map(async (a) => ({ asset: a, fw: await getFlywheel(a.address).catch(() => null) })));

  return (
    <Shell className="py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-muted">{t("intro")}</p>

      <div className="mt-6 grid gap-4">
        {rounds.map(({ asset, fw }) => (
          <section key={asset.address} className="rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-mono text-base text-fg">{asset.symbol ?? asset.address}</h2>
              {fw ? (
                <span className="font-mono text-xs text-fg-muted">
                  {fw.round > 0 ? t("round", { round: fw.round }) : ""} · {fw.active ? t("active") : t("idle")}
                  {fw.start ? ` · ${when(fw.start)}` : ""}
                </span>
              ) : null}
            </div>
            {fw ? (
              <>
                <p className="mt-2 font-mono text-[12.5px] text-fg-muted">
                  {t("budget")}: <span className="text-fg">{formatUnits(fw.budget, asset.decimals, 6)} {asset.symbol}</span>
                </p>
                <div className="mt-3">
                  <div className="text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">{t("nominated")}</div>
                  {fw.nominated.length === 0 ? (
                    <p className="mt-2 text-sm text-fg-muted">{t("none")}</p>
                  ) : (
                    <ul className="mt-2 grid gap-1 font-mono text-[12.5px]">
                      {[...fw.nominated]
                        .sort((a, b) => (BigInt(b.marketCap) > BigInt(a.marketCap) ? 1 : -1))
                        .map((n, i) => (
                          <li key={n.pool} className="flex justify-between gap-3 border-b border-line py-1 last:border-0">
                            <span>
                              {i + 1}.{" "}
                              {n.token ? (
                                <Link href={`/launch/view/?token=${n.token}`} className="text-cyan hover:underline">
                                  {n.name ?? n.token} {n.symbol ? `$${n.symbol}` : ""}
                                </Link>
                              ) : (
                                n.pool
                              )}
                            </span>
                            <span className="text-fg-muted">
                              {t("marketCap")}: {formatUnits(n.marketCap, asset.decimals, 4)} {asset.symbol}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">—</p>
            )}
          </section>
        ))}
      </div>
    </Shell>
  );
}
