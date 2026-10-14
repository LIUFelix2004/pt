"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { parseUnits, zeroAddress, type Address } from "viem";
import {
  MINT_DEFAULTS,
  MINT_LIMITS,
  alignMintRaise,
  mintPreview,
  mintScheduleSummary,
  type MintScheduleInput,
} from "@portus/shared/browser";
import { formatTokens, formatUnits } from "@/lib/api";

const FIELD =
  "mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none transition-colors placeholder:text-fg-muted/60 focus:border-cyan/60 focus:ring-1 focus:ring-cyan/40";
const LABEL = "block text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase";
const HINT = "mt-1 text-[12px] normal-case tracking-normal text-fg-muted";
const SECTION = "grid gap-4 border-t border-line pt-5";
const KICKER = "font-mono text-[10px] tracking-[0.16em] text-magenta";

const pctStr = (bps: number) => String(bps / 100);

/** Form state for a mint-mode launch, in human units (percent, whole tokens). */
export const MINT_FORM_DEFAULTS = {
  raise: String(MINT_DEFAULTS.raiseWhole),
  initial: "10000000",
  max: "1000000000",
  months: MINT_DEFAULTS.schedule.months.map(String),
  growthPct: MINT_DEFAULTS.schedule.growthBps.map(pctStr),
  staticPct: pctStr(MINT_DEFAULTS.staticBps),
  /** Trading fee T in percent, charged on both buy and sell (1–5%, 0.1% steps). */
  feePct: "1",
};
export type MintForm = typeof MINT_FORM_DEFAULTS;

const bps = (v: string) => Math.round(Number(v || 0) * 100);
const whole = (v: string, decimals: number): bigint | null => {
  try {
    if (!/^\d+(\.\d+)?$/.test(v.trim())) return null;
    return parseUnits(v.trim(), decimals);
  } catch {
    return null;
  }
};

/** Platform ecosystem recipient (Factory feeSplitter.ecosystem on mainnet); not user-editable. */
export const ECOSYSTEM_ADDRESS = (process.env.NEXT_PUBLIC_ECOSYSTEM_ADDRESS ||
  "0xF124778D183dd498074619Bfa895670C629867D4") as Address;
/** Ecosystem takes a fixed 0.2% of each trade; the creator gets T − 0.2%. */
export const ECOSYSTEM_FEE_BPS = 20;
export const FEE_MIN_BPS = 100;
export const FEE_MAX_BPS = 500;
export const FEE_STEP_BPS = 10;
const feeBpsOf = (v: string) => (/^\d+(\.\d+)?$/.test(v.trim()) ? Math.round(Number(v) * 100) : NaN);
export const feeValid = (v: string) => {
  const f = feeBpsOf(v);
  return Number.isFinite(f) && f >= FEE_MIN_BPS && f <= FEE_MAX_BPS && f % FEE_STEP_BPS === 0 && Math.abs(Number(v) * 100 - f) < 1e-6;
};

/** Derived figures and validation for a mint-mode form. Recipients default to `self`. */
export function useMintPlan(m: MintForm, decimals: number, self: Address | undefined) {
  return useMemo(() => {
    const rawR = whole(m.raise, decimals);
    const S0 = whole(m.initial, 18);
    const MAX = whole(m.max, 18);
    const schedule: MintScheduleInput = {
      months: m.months.map((x) => Math.max(0, Math.floor(Number(x || 0)))),
      growthBps: m.growthPct.map(bps),
    };
    const feeBps = feeBpsOf(m.feePct);
    const feeOk = feeValid(m.feePct);
    const creatorBps = feeOk ? feeBps - ECOSYSTEM_FEE_BPS : 0;
    // Mapping (no contract change): buy foundation / sell tech = ecosystem 0.2%,
    // buy+sell community = creator T − 0.2%; no burn; anti-dump levy disabled.
    const tax = {
      buyBurnBps: 0,
      buyCommunityBps: creatorBps,
      buyFoundationBps: ECOSYSTEM_FEE_BPS,
      sellBurnBps: 0,
      sellCommunityBps: creatorBps,
      sellTechBps: ECOSYSTEM_FEE_BPS,
      dumpThresholdBps: 0,
      dumpBurnShareBps: 0,
    };
    const me = self ?? zeroAddress;
    const recipients = { community: me, foundation: ECOSYSTEM_ADDRESS, tech: ECOSYSTEM_ADDRESS, market: me };

    const supplyOk = S0 !== null && MAX !== null && S0 >= 2n * 10n ** 18n && S0 % 2n === 0n && MAX >= S0 && MAX <= 10n ** 30n;
    let scheduleOk = true;
    let ended = false;
    let total = 0;
    schedule.months.forEach((n, i) => {
      const g = schedule.growthBps[i] ?? 0;
      if (n === 0) {
        if (g !== 0) scheduleOk = false;
        ended = true;
        return;
      }
      if (ended || g <= 0 || g > MINT_LIMITS.maxMonthlyGrowthBps) scheduleOk = false;
      total += n;
    });
    if (total === 0 || total > MINT_LIMITS.maxScheduleMonths) scheduleOk = false;
    const staticBps = bps(m.staticPct);
    if (staticBps < 0 || staticBps > 10_000) scheduleOk = false;

    const taxOk = feeOk && tax.buyCommunityBps + tax.buyFoundationBps <= MINT_LIMITS.maxSideTaxBps;
    const addressesOk = !!self;

    const R = rawR !== null && rawR > 0n ? alignMintRaise(rawR) : null;
    const preview = R !== null && supplyOk ? { R, adjusted: R !== rawR, ...mintPreview(R, S0!) } : null;
    const summary = supplyOk && scheduleOk ? mintScheduleSummary(S0!, MAX!, schedule) : null;

    const blockers = [
      !preview && "blockMintRaise",
      !supplyOk && "blockMintSupply",
      !scheduleOk && "blockMintSchedule",
      !taxOk && "blockMintTax",
      !addressesOk && "blockMintAddress",
    ].filter(Boolean) as string[];

    const params =
      preview && supplyOk
        ? {
            raiseTarget: preview.R,
            initialSupply: S0!,
            maxSupply: MAX!,
            staticBps,
            schedule: { months: schedule.months, growthBps: schedule.growthBps },
            tax: { ...tax, ...recipients },
          }
        : null;
    return { preview, summary, blockers, ok: blockers.length === 0, params, maxSupply: MAX };
  }, [m, decimals, self]);
}

type Plan = ReturnType<typeof useMintPlan>;

export function MintRaiseFields({
  m,
  setM,
  plan,
  decimals,
  symbol,
}: {
  m: MintForm;
  setM: <K extends keyof MintForm>(k: K, v: MintForm[K]) => void;
  plan: Plan;
  decimals: number;
  symbol: string;
}) {
  const t = useTranslations("create");
  const p = plan.preview;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={LABEL}>
          {t("mintRaise")} ({symbol})
          <input value={m.raise} onChange={(e) => setM("raise", e.target.value)} inputMode="decimal" className={FIELD} />
        </label>
        <label className={LABEL}>
          {t("mintInitialSupply")}
          <input value={m.initial} onChange={(e) => setM("initial", e.target.value)} inputMode="numeric" className={FIELD} />
          <span className={HINT}>{t("mintInitialHint")}</span>
        </label>
        <label className={LABEL}>
          {t("mintMaxSupply")}
          <input value={m.max} onChange={(e) => setM("max", e.target.value)} inputMode="numeric" className={FIELD} />
          <span className={HINT}>{t("mintMaxHint")}</span>
        </label>
      </div>
      {p ? (
        <div className="grid gap-3 rounded-md border border-line bg-surface-2/60 p-4 font-mono text-[12.5px] sm:grid-cols-2">
          <div>
            <div className="text-fg-muted">{t("raiseTarget")}</div>
            <div className="text-fg">
              {formatUnits(p.R, decimals, 8)} {symbol}
            </div>
            {p.adjusted ? <div className="mt-1 text-[11px] text-fg-muted">{t("granularityAdjusted")}</div> : null}
          </div>
          <div>
            <div className="text-fg-muted">{t("mintPrice")}</div>
            <div className="text-fg">
              {formatUnits((p.r * 10n ** 18n * 10n ** 12n) / p.s, decimals + 12, 12)} {symbol}
            </div>
          </div>
          <div>
            <div className="text-fg-muted">{t("supplySplit")}</div>
            <div className="text-fg">{t("mintSplit", { sale: formatTokens(p.qSale, 0), lp: formatTokens(p.qLp, 0) })}</div>
            <div className="text-[11px] text-fg-muted">{t("mintSplitNote")}</div>
          </div>
          <div>
            <div className="text-fg-muted">{t("mintFdv")}</div>
            <div className="text-fg">
              {plan.maxSupply ? formatUnits((p.R * plan.maxSupply) / p.qSale, decimals, 2) : "—"} {symbol}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MintScheduleFields({
  m,
  setM,
  plan,
}: {
  m: MintForm;
  setM: <K extends keyof MintForm>(k: K, v: MintForm[K]) => void;
  plan: Plan;
}) {
  const t = useTranslations("create");
  const setPhase = (key: "months" | "growthPct", i: number, v: string) => {
    const next = [...m[key]];
    next[i] = v;
    setM(key, next);
  };
  return (
    <div className={SECTION}>
      <div className={KICKER}>{t("sectionMintSchedule")}</div>
      <p className={HINT}>{t("mintScheduleHint")}</p>
      <div className="grid gap-3">
        {[0, 1, 2, 3].map((i) => {
          const end = plan.summary?.phases[i]?.endSupply;
          return (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[6rem_1fr_1fr_1.4fr]">
              <div className="pb-2 font-mono text-xs text-fg-muted">{t("mintPhase", { n: i + 1 })}</div>
              <label className={LABEL}>
                {t("mintMonths")}
                <input value={m.months[i]} onChange={(e) => setPhase("months", i, e.target.value)} inputMode="numeric" className={FIELD} />
              </label>
              <label className={LABEL}>
                {t("mintGrowth")}
                <input value={m.growthPct[i]} onChange={(e) => setPhase("growthPct", i, e.target.value)} inputMode="decimal" className={FIELD} />
              </label>
              <div className="pb-2 font-mono text-[12px] text-fg-muted">
                {end !== undefined ? t("mintPhaseEnd", { supply: formatTokens(end, 0) }) : "—"}
              </div>
            </div>
          );
        })}
      </div>
      {plan.summary ? (
        <p className="font-mono text-[12px] text-fg">
          {plan.summary.capMonth !== null
            ? t("mintCapAt", { month: plan.summary.capMonth, years: (plan.summary.capMonth / 12).toFixed(1) })
            : t("mintCapNever", { months: plan.summary.totalMonths })}
        </p>
      ) : null}
      <label className={LABEL}>
        {t("mintStatic")}
        <input value={m.staticPct} onChange={(e) => setM("staticPct", e.target.value)} inputMode="decimal" className={FIELD} />
        <span className={HINT}>{t("mintStaticHint", { dynamic: String(100 - Number(m.staticPct || 0)) })}</span>
      </label>
      <p className="rounded-md border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">
        {t("mintRewardsNote")}
      </p>
    </div>
  );
}

export function MintTaxFields({ m, setM }: { m: MintForm; setM: <K extends keyof MintForm>(k: K, v: MintForm[K]) => void }) {
  const t = useTranslations("create");
  const ok = feeValid(m.feePct);
  const T = Number(m.feePct || 0);
  const creator = ok ? (Math.round(T * 100) - ECOSYSTEM_FEE_BPS) / 100 : null;
  return (
    <div className={SECTION}>
      <div className={KICKER}>{t("sectionMintTax")}</div>
      <p className={HINT}>{t("mintFeeHint")}</p>
      <label className={LABEL}>
        {t("mintFee")}
        <input
          value={m.feePct}
          onChange={(e) => setM("feePct", e.target.value.trim())}
          type="number"
          min={1}
          max={5}
          step={0.1}
          inputMode="decimal"
          className={FIELD}
        />
        <span className={HINT}>{ok ? t("mintFeeRange") : t("mintFeeInvalid")}</span>
      </label>
      <div className="grid gap-3 rounded-md border border-line bg-surface-2/60 p-4 font-mono text-[12.5px] sm:grid-cols-3">
        <div>
          <div className="text-fg-muted">{t("mintFeeTotal")}</div>
          <div className="text-fg">{ok ? `${T.toFixed(1)}%` : "—"}</div>
        </div>
        <div>
          <div className="text-fg-muted">{t("mintFeeEcosystem")}</div>
          <div className="text-fg">0.2%</div>
        </div>
        <div>
          <div className="text-fg-muted">{t("mintFeeCreator")}</div>
          <div className="text-fg">{creator !== null ? `${creator.toFixed(1)}%` : "—"}</div>
        </div>
      </div>
      <p className={HINT}>{t("mintFeeNote", { eco: `${ECOSYSTEM_ADDRESS.slice(0, 6)}…${ECOSYSTEM_ADDRESS.slice(-4)}` })}</p>
    </div>
  );
}
