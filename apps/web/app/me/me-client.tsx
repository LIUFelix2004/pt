"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { portusDistributorAbi, portusFactoryAbi, portusFeeSplitterAbi } from "@portus/shared/browser";
import {
  formatUnits,
  getInvitees,
  getLaunches,
  getOwedFees,
  getQuoteAssets,
  shortAddress,
  when,
  whenCst,
  type InviteesView,
  type Launch,
  type QuoteAsset,
} from "@/lib/api";
import { FACTORY } from "@/lib/chain";
import { useTx } from "@/lib/use-tx";
import { useOnRightChain, WalletBar } from "@/components/portus/wallet-bar";
import { REF_KEY } from "@/components/portus/ref-capture";
import { InviteLinkButton } from "@/components/portus/invite-link-button";
import { ZonesPanel } from "@/components/portus/zones-panel";

const BTN = "rounded border border-cyan/50 px-3 py-1.5 font-mono text-xs text-cyan hover:bg-cyan/10 disabled:opacity-40";

export function MeClient() {
  const t = useTranslations("me");
  const { address } = useAccount();
  const rightChain = useOnRightChain();
  const { writeContractAsync } = useWriteContract();
  const [owed, setOwed] = useState<Array<{ asset: Address; owed: string }>>([]);
  const [assets, setAssets] = useState<QuoteAsset[]>([]);
  const [stored, setStored] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [invitees, setInvitees] = useState<InviteesView | null>(null);
  const [mintLaunches, setMintLaunches] = useState<Launch[]>([]);
  const [zoneToken, setZoneToken] = useState<string>("");

  const { data: splitter } = useReadContract({ address: FACTORY, abi: portusFactoryAbi, functionName: "feeSplitter" });
  const { data: distributor } = useReadContract({ address: FACTORY, abi: portusFactoryAbi, functionName: "distributor" });
  const { data: referrer, refetch: refetchRef } = useReadContract({
    address: distributor as Address,
    abi: portusDistributorAbi,
    functionName: "referrerOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!distributor },
  });

  const load = () => {
    if (!address) return;
    getOwedFees(address).then((r) => setOwed(r.owed)).catch(() => setOwed([]));
    getInvitees(address)
      .then(setInvitees)
      .catch(() => setInvitees({ referrer: null, boundAt: null, invitees: [], directCount: 0 }));
  };
  const tx = useTx(() => {
    load();
    void refetchRef();
  });

  useEffect(load, [address]);
  useEffect(() => {
    getQuoteAssets().then(setAssets).catch(() => setAssets([]));
    setOrigin(window.location.origin);
    try {
      setStored(localStorage.getItem(REF_KEY));
    } catch {
      setStored(null);
    }
    getLaunches({ includeHidden: true })
      .then((ls) => {
        const mint = ls.filter((l) => l.kind === "MINT");
        setMintLaunches(mint);
        if (mint[0] && !zoneToken) setZoneToken(mint[0].token);
      })
      .catch(() => setMintLaunches([]));
  }, []);

  if (!address) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-fg-muted">{t("connectFirst")}</p>
        <WalletBar />
      </div>
    );
  }

  const asset = (a: string) => assets.find((x) => x.address.toLowerCase() === a.toLowerCase());
  const bound = referrer && referrer !== zeroAddress ? referrer : null;
  const candidate = stored && stored.toLowerCase() !== address.toLowerCase() ? (stored as Address) : null;
  const inviteUrl = `${origin}/?ref=${address}`;
  const zoneLaunch = mintLaunches.find((l) => l.token.toLowerCase() === zoneToken.toLowerCase()) ?? mintLaunches[0];

  return (
    <div className="grid gap-8">
      <WalletBar />

      <section>
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-fg-muted uppercase">{t("fees")}</h2>
        <div className="rule-neon mt-2 mb-4 h-px w-full opacity-70" />
        {owed.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("feesEmpty")}</p>
        ) : (
          <div className="grid gap-2">
            {owed.map((o) => {
              const a = asset(o.asset);
              return (
                <div key={o.asset} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-4 py-3 font-mono text-sm">
                  <span className="text-fg">
                    {formatUnits(o.owed, a?.decimals ?? 18, 8)} {a?.symbol ?? shortAddress(o.asset)}
                  </span>
                  <button
                    className={BTN}
                    disabled={!rightChain || tx.busy || !splitter}
                    onClick={() =>
                      void tx.run([
                        () => writeContractAsync({ address: splitter as Address, abi: portusFeeSplitterAbi, functionName: "claim", args: [o.asset] }),
                      ])
                    }
                  >
                    {t("claimFee")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-fg-muted uppercase">{t("referral")}</h2>
        <div className="rule-neon mt-2 mb-4 h-px w-full opacity-70" />
        <p className="text-[13px] leading-relaxed text-fg-muted">{t("referralBody")}</p>
        <div className="mt-3 grid gap-3 font-mono text-[12.5px]">
          <div>
            <span className="text-fg-muted">{t("yourReferrer")}: </span>
            <span className="text-fg">{bound ? shortAddress(bound) : t("noReferrer")}</span>
          </div>
          {!bound && candidate ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-fg-muted">
                {t("referrerFromLink")}: <span className="text-fg">{shortAddress(candidate)}</span>
              </span>
              <button
                className={BTN}
                disabled={!rightChain || tx.busy || !distributor}
                onClick={() =>
                  void tx.run([
                    () =>
                      writeContractAsync({
                        address: distributor as Address,
                        abi: portusDistributorAbi,
                        functionName: "bindReferrer",
                        args: [candidate],
                      }),
                  ])
                }
              >
                {t("bindReferrer")}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-start gap-3 rounded-md border border-line bg-surface px-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-fg-muted">{t("inviteLink")}</div>
              <code className="mt-1 block break-all text-cyan">{inviteUrl}</code>
            </div>
            <InviteLinkButton url={inviteUrl} className={`${BTN} shrink-0`} />
          </div>
          {zoneLaunch ? (
            <div className="flex flex-wrap items-start gap-3 rounded-md border border-line bg-surface px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-fg-muted">{t("inviteLinkLaunch")}</div>
                <code className="mt-1 block break-all text-cyan">
                  {`${origin}/launch/view/?token=${zoneLaunch.token}&ref=${address}`}
                </code>
              </div>
              <InviteLinkButton className={`${BTN} shrink-0`} url={`${origin}/launch/view/?token=${zoneLaunch.token}&ref=${address}`} />
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-fg-muted uppercase">{t("team")}</h2>
        <div className="rule-neon mt-2 mb-4 h-px w-full opacity-70" />
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-line bg-surface px-3 py-2">
            <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{t("directCount")}</div>
            <div className="mt-1 font-mono text-sm text-fg">{invitees?.directCount ?? "—"}</div>
          </div>
        </div>
        {!invitees || invitees.invitees.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("inviteesEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full whitespace-nowrap font-mono text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-fg-muted">
                  <th className="px-3 py-2 font-medium">{t("zoneInvitee")}</th>
                  <th className="px-3 py-2 font-medium">{t("zoneBoundAt")}</th>
                </tr>
              </thead>
              <tbody>
                {invitees.invitees.map((inv) => (
                  <tr key={inv.account} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-fg">{shortAddress(inv.account)}</td>
                    <td className="px-3 py-2 text-fg-muted">{whenCst(inv.boundAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-fg-muted uppercase">{t("zones")}</h2>
        <div className="rule-neon mt-2 mb-4 h-px w-full opacity-70" />
        {mintLaunches.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("zonesNoMint")}</p>
        ) : (
          <div className="grid gap-3">
            <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
              <span>{t("zonesPickLaunch")}</span>
              <select
                className="max-w-full min-w-0 rounded border border-line bg-surface px-2 py-1 font-mono text-fg"
                value={zoneLaunch?.token ?? ""}
                onChange={(e) => setZoneToken(e.target.value)}
              >
                {mintLaunches.map((l) => (
                  <option key={l.token} value={l.token}>
                    {l.copy.symbol} · {shortAddress(l.token)}
                  </option>
                ))}
              </select>
              {zoneLaunch ? (
                <Link href={`/launch/view/?token=${zoneLaunch.token}`} className="text-cyan hover:underline">
                  {t("zonesOpenLaunch")}
                </Link>
              ) : null}
            </label>
            {zoneLaunch ? <ZonesPanel token={zoneLaunch.token} symbol={zoneLaunch.copy.symbol} /> : null}
          </div>
        )}
      </section>

      {tx.message ? <p className="font-mono text-xs break-all text-fg-muted">{tx.message}</p> : null}
    </div>
  );
}
