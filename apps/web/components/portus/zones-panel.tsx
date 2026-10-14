"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount } from "wagmi";
import { formatTokens, getZones, shortAddress, when, whenCst, type ZoneView } from "@/lib/api";

/** Direct-invite zones for one mint launch: holdings, 大区 mark, referral power. */
export function ZonesPanel({ token, symbol }: { token: string; symbol: string }) {
  const t = useTranslations("me");
  const { address } = useAccount();
  const [data, setData] = useState<ZoneView | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }
    let cancelled = false;
    getZones(token, address)
      .then((z) => {
        if (!cancelled) {
          setData(z);
          setErr(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setErr(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, address]);

  if (!address) return <p className="text-sm text-fg-muted">{t("connectFirst")}</p>;
  if (err) return <p className="text-sm text-fg-muted">{t("zonesUnavailable")}</p>;
  if (!data) return <p className="text-sm text-fg-muted">{t("zonesLoading")}</p>;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t("directCount")} value={String(data.directCount)} />
        <Stat label={t("referralPower")} value={formatTokens(data.referralPower, 2)} />
        <Stat label={t("holdingBasis")} value={t("holdingBasisLive")} />
      </div>
      <p className="text-[12px] leading-relaxed text-fg-muted">{t("zonesNote")}</p>
      {data.zones.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("zonesEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full whitespace-nowrap font-mono text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-fg-muted">
                <th className="px-3 py-2 font-medium">{t("zoneInvitee")}</th>
                <th className="px-3 py-2 font-medium">{t("zoneHolding")}</th>
                <th className="px-3 py-2 font-medium">{t("zoneKind")}</th>
                <th className="px-3 py-2 font-medium">{t("zoneBoundAt")}</th>
              </tr>
            </thead>
            <tbody>
              {data.zones.map((z) => (
                <tr key={z.account} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-fg">{shortAddress(z.account)}</td>
                  <td className="px-3 py-2 text-fg">
                    {formatTokens(z.holding, 2)} {symbol}
                  </td>
                  <td className="px-3 py-2">
                    {z.isMajor ? (
                      <span className="rounded bg-cyan/15 px-1.5 py-0.5 text-cyan">{t("zoneMajor")}</span>
                    ) : BigInt(z.holding) > 0n ? (
                      <span className="text-fg-muted">{t("zoneMinor")}</span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{whenCst(z.boundAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">{label}</div>
      <div className="mt-1 truncate font-mono text-sm text-fg">{value}</div>
    </div>
  );
}
