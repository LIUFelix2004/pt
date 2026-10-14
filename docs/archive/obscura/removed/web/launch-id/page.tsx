import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getLaunch, formatEth, formatTokens, subscriptionRatio } from "@/lib/api";
import { LiveLaunch } from "./live-launch";
import { Shell } from "@/components/obscura/shell";
import { Section } from "@/components/obscura/section";
import { Stat } from "@/components/obscura/stat";
import { PhaseBadge, type Phase } from "@/components/obscura/phase-badge";
import { UntrustedFence } from "@/components/obscura/untrusted";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function when(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

const MCP_SNIPPET = `{
  "mcpServers": {
    "obscura": {
      "command": "node",
      "args": ["./obscura-mcp.mjs"]
    }
  }
}`;

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("launch");
  const tPhase = await getTranslations("phaseHint");
  const tCommon = await getTranslations("common");
  const { id } = await params;
  const auctionId = Number(id);
  if (!Number.isInteger(auctionId) || auctionId < 0) notFound();

  const launch = await getLaunch(auctionId).catch(() => null);
  if (!launch) notFound();

  const ratio = subscriptionRatio(launch);
  const pct = Math.min(ratio, 100);
  const oversubscribed = ratio > 100;
  const atRisk = launch.unrevealedCount > 0;

  return (
    <Shell className="py-10">
      <Link href="/" className="font-mono text-xs text-fg-muted transition-colors hover:text-cyan">
        {tCommon("allLaunches")}
      </Link>

      <div className="mt-4">
        <LiveLaunch
          id={auctionId}
          initial={{
            phase: launch.phase,
            clearingPrice: launch.clearingPrice,
            totalRevealedDemand: launch.totalRevealedDemand,
            bidCount: launch.bidCount,
            indexedAtBlock: launch.indexedAtBlock,
            unrevealedCount: launch.unrevealedCount,
            unrevealedDepositWei: launch.unrevealedDepositWei,
            commitEnd: launch.commitEnd,
            revealEnd: launch.revealEnd,
            supplyForSale: launch.supplyForSale,
          }}
        />
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{launch.copy.name}</h1>
        <span className="font-mono text-sm text-fg-muted">${launch.copy.symbol}</span>
        <PhaseBadge phase={launch.phase as Phase} />
      </div>
      <p className="mt-2 text-sm text-fg-muted">{tPhase(launch.phase)}</p>

      <Section title={t("onChainState")}>
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label={t("supplyForSale")} value={formatTokens(launch.supplyForSale)} />
            <Stat label={t("floorPrice")} value={`${formatEth(launch.floorPrice)} ETH`} />
            <Stat
              label={t("revealedDemand")}
              value={
                <span className={oversubscribed ? "text-magenta" : undefined}>
                  {formatTokens(launch.totalRevealedDemand)}
                </span>
              }
            />
            <Stat label={t("revealedBids")} value={launch.bidCount} />
            <Stat label={t("commitCloses")} value={<span className="text-xs">{when(launch.commitEnd)}</span>} />
            <Stat label={t("revealCloses")} value={<span className="text-xs">{when(launch.revealEnd)}</span>} />
            <Stat
              label={t("clearingPrice")}
              value={
                launch.clearingPrice ? (
                  <span className="text-lime">{formatEth(launch.clearingPrice)} ETH</span>
                ) : (
                  tCommon("notSettled")
                )
              }
            />
            <Stat label={t("token")} value={<span className="text-[11px]">{launch.token}</span>} />
          </div>

          <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-cyan to-magenta"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-fg-muted">
            {oversubscribed ? t("oversubscribedNote") : t("undersubscribedNote")}
          </p>
        </div>
      </Section>

      <Section title={t("unrevealedCollateral")}>
        {/* Amber only when collateral is genuinely at risk — the reserved hue
            loses its meaning if it is on screen when nothing is wrong. */}
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-6 rounded-lg border p-5",
            atRisk ? "border-warn-line bg-warn-surface" : "border-line bg-surface",
          )}
        >
          <div className="min-w-0 flex-1">
            <span
              className={cn(
                "font-mono text-[10px] tracking-[0.16em]",
                atRisk ? "text-warn" : "text-fg-muted",
              )}
            >
              {t("riskLedger")}
            </span>
            <strong className="mt-1.5 block text-base font-semibold text-fg">
              {t("neverOpened", { count: launch.unrevealedCount })}
            </strong>
            <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-fg-muted">
              {atRisk ? t("atRiskNote") : t("allClearNote")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-muted">
              {t("collateralAtRisk")}
            </span>
            <b
              className={cn(
                "mt-1 block font-mono text-xl",
                atRisk ? "text-warn" : "text-fg",
              )}
            >
              {formatEth(launch.unrevealedDepositWei)} ETH
            </b>
            <small className="font-mono text-[10px] text-fg-muted">
              {t("indexedThrough", { block: launch.indexedAtBlock })}
            </small>
          </div>
        </div>
      </Section>

      <Section title={t("creatorDescription")}>
        <UntrustedFence label={t("untrustedLabel")}>
          {launch.copy.description}
          {launch.copy.docsUrl ? `\n\ndocs: ${launch.copy.docsUrl}` : ""}
        </UntrustedFence>
      </Section>

      <Section title={t("howToBid")}>
        <p className="text-sm leading-relaxed text-fg-muted">
          {t.rich("howToBidBody", {
            link: (chunks) => (
              <Link href="/download" className="text-cyan underline-offset-4 hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-[#080b11] p-4 font-mono text-[12.5px] leading-relaxed text-[#cdd6e0]">
          {MCP_SNIPPET}
        </pre>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          {t.rich("configNote", {
            id: auctionId,
            cmd: (chunks) => <code className="font-mono text-cyan">{chunks}</code>,
          })}
        </p>
        {/* Amber: an unrevealed bid loses real money, which is what the reserved hue marks. */}
        <p className="mt-3 rounded-md border border-warn-line bg-warn-surface px-3 py-2 text-[13px] leading-relaxed text-warn">
          {t.rich("revealWarning", {
            cmd: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        </p>
      </Section>
    </Shell>
  );
}
