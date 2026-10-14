import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fdvFromRaise } from "@portus/shared/browser";
import { NO_API, formatPricePerToken, formatQuote, formatTokens, getLaunch, when } from "@/lib/api";
import { explorerAddress } from "@/lib/chain";
import { Shell } from "@/components/portus/shell";
import { Section } from "@/components/portus/section";
import { Stat } from "@/components/portus/stat";
import { UntrustedFence } from "@/components/portus/untrusted";
import { LiveLaunch } from "./live-launch";
import { LaunchBoot } from "./launch-boot";
import { CreatorTools } from "./creator-tools";
import { LpProof } from "./lp-proof";

const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

// Legacy dynamic path kept for non-static (Node) hosting.
// Cloudflare Pages static export uses /launch/view/?token=0x... instead.
// Do not rely on /launch/:token + _redirects SPA fallback (Next hydrates _not-found).
export function generateStaticParams() {
  if (STATIC_EXPORT) {
    // Emit one inert placeholder so out/launch/ exists; real traffic uses /launch/view/.
    return [{ token: "demo" }];
  }
  const tokens = (process.env.NEXT_PUBLIC_PRERENDER_TOKENS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (tokens.length ? tokens : ["demo"]).map((token) => ({ token }));
}
const ZERO32 = `0x${"0".repeat(64)}`;

function AddressLink({ label, address }: { label: string; address: string }) {
  const url = explorerAddress(address);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-0">
      <span className="text-[11px] tracking-[0.12em] text-fg-muted uppercase">{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[12px] break-all text-cyan hover:underline">
          {address}
        </a>
      ) : (
        <code className="font-mono text-[12px] break-all text-fg">{address}</code>
      )}
    </div>
  );
}

export default async function LaunchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Pages static build: never bake launch HTML - client shell loads any address.
  if (STATIC_EXPORT) {
    return (
      <Shell className="py-10">
        <LaunchBoot token={/^0x[0-9a-fA-F]{40}$/.test(token) ? token : undefined} />
      </Shell>
    );
  }

  const t = await getTranslations("launch");
  const tc = await getTranslations("common");
  const tCreate = await getTranslations("create");
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) notFound();

  const launch = await getLaunch(token).catch(() => null);
  if (!launch) {
    return (
      <Shell className="py-10">
        <LaunchBoot token={token} />
      </Shell>
    );
  }

  const settled = launch.outcome !== "NONE";
  const fdv = launch.mint
    ? (BigInt(launch.raiseTarget) * BigInt(launch.mint.maxSupply)) / BigInt(launch.qSale)
    : fdvFromRaise(BigInt(launch.raiseTarget), launch.incentiveBps);
  const tax = launch.mint?.tax;

  return (
    <Shell className="py-10">
      <Link href="/" className="font-mono text-xs text-fg-muted transition-colors hover:text-cyan">
        {tc("allLaunches")}
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{launch.copy.name}</h1>
        <span className="font-mono text-sm text-fg-muted">${launch.copy.symbol}</span>
      </div>

      {launch.quote?.freezable ? (
        <p className="mt-4 rounded-md border border-warn-line bg-warn-surface px-3 py-2 text-[13px] leading-relaxed text-warn">
          ⚠ {tCreate("freezableWarning")}
        </p>
      ) : null}

      <div className="mt-5">
        <LiveLaunch initial={launch} />
      </div>

      <Section title={t("params")}>
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label={t("raiseTarget")} value={formatQuote(launch, launch.raiseTarget)} />
            <Stat label={t("price")} value={formatPricePerToken(launch, launch.priceNum, launch.priceDen)} />
            <Stat label={launch.mint ? t("fdvAtCap") : t("fdv")} value={formatQuote(launch, fdv, 2)} />
            <Stat
              label={t("supply")}
              value={<span className="text-xs">{`${formatTokens(launch.qSale, 0)} / ${formatTokens(launch.qLp, 0)} / ${formatTokens(launch.qInc, 0)}`}</span>}
            />
            {tax ? (
              <Stat
                label={t("tradeTax")}
                value={t("tradeTaxValue", {
                  buy: `${(tax.buyBurnBps + tax.buyCommunityBps + tax.buyFoundationBps) / 100}%`,
                  sell: `${(tax.sellBurnBps + tax.sellCommunityBps + tax.sellTechBps) / 100}%`,
                })}
              />
            ) : (
              <Stat label={t("fee")} value={`${launch.feeBps / 100}%`} />
            )}
            <Stat
              label={t("underRule")}
              value={
                <span className="text-xs">
                  {launch.underRule === "SHRINK"
                    ? `${tCreate("underShrink")} (≥ ${launch.minFillBps / 100}%)`
                    : tCreate("underRefund")}
                </span>
              }
            />
            <Stat label={t("window")} value={<span className="text-xs">{`${when(launch.startTime)} → ${when(launch.endTime)}`}</span>} />
            <Stat
              label={t("whitelist")}
              value={<span className="text-xs">{launch.merkleRoot === ZERO32 ? t("noWhitelist") : `${launch.merkleRoot.slice(0, 18)}…`}</span>}
            />
            {launch.publicOpenAt !== 0 ? (
              <Stat
                label={t("publicCap")}
                value={<span className="text-xs">{`${formatQuote(launch, launch.publicCap)} · ${when(launch.publicOpenAt)}`}</span>}
              />
            ) : null}
          </div>
        </div>
      </Section>

      {settled ? (
        <Section title={t("settlement")}>
          <div className="grid grid-cols-2 gap-5 rounded-lg border border-line bg-surface p-5 sm:grid-cols-3">
            <Stat
              label={t("poolSeed")}
              value={
                <span className="text-xs">
                  {launch.poolQuote && launch.poolTokens
                    ? `${formatQuote(launch, launch.poolQuote)} + ${formatTokens(launch.poolTokens, 0)}`
                    : "—"}
                </span>
              }
            />
            <Stat label={t("burned")} value={formatTokens(launch.tokensBurned ?? "0", 0)} />
            {launch.kind === "MINT" ? null : (
              <Stat label={t("incentiveFunded")} value={formatTokens(launch.incentiveFunded ?? "0", 0)} />
            )}
            <Stat label={launch.kind === "MINT" ? t("dustToPool") : t("dust")} value={formatQuote(launch, launch.quoteDust ?? "0")} />
            {launch.kind === "MINT" ? null : (
              <Stat label={t("feesCollected")} value={formatQuote(launch, launch.feesQuote ?? "0")} />
            )}
          </div>
          {launch.outcome !== "REFUNDED" ? (
            <div className="mt-3">
              {launch.kind === "MINT" ? (
                <p className="text-[12.5px] leading-relaxed text-fg-muted">{t("mintLpNote")}</p>
              ) : (
                <LpProof pool={launch.pool as `0x${string}`} />
              )}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title={t("contracts")}>
        <div className="rounded-lg border border-line bg-surface px-5 py-2">
          <AddressLink label="Token" address={launch.token} />
          <AddressLink label="Sale" address={launch.sale} />
          <AddressLink label="Pool" address={launch.pool} />
          <AddressLink label={t("creator")} address={launch.creator} />
          <AddressLink label="Quote" address={launch.quoteAsset} />
        </div>
      </Section>

      <Section title={t("creatorDescription")}>
        <UntrustedFence label={tc("untrustedNotice")}>
          {launch.copy.description || t("noDescription")}
          {launch.copy.docsUrl ? `\n\ndocs: ${launch.copy.docsUrl}` : ""}
        </UntrustedFence>
      </Section>

      {NO_API ? null : <CreatorTools launch={launch} />}
    </Shell>
  );
}
