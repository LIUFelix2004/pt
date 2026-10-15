"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  useAccount,
  useDisconnect,
  usePublicClient,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { parseEventLogs, parseUnits, toHex, zeroAddress, zeroHash, type Hex } from "viem";
import {
  COPY_AUTH_TYPES,
  DEFAULT_DURATION_SECONDS,
  FEE_TIERS,
  WHITELIST_AUTH_TYPES,
  alignRaiseTarget,
  buildWhitelist,
  hashLaunchCopy,
  parseWhitelistCsv,
  portusFactoryAbi,
  portusSigningDomain,
  previewPrice,
  raiseFromFdv,
  whitelistListHash,
  type WhitelistEntry,
} from "@portus/shared/browser";
import { API_URL, NO_API, formatTokens, formatUnits, getQuoteAssets, roundTripCost, type QuoteAsset } from "@/lib/api";
import { ACTIVE_CHAIN, CHAIN_ID, CHAIN_INFO, FACTORY } from "@/lib/chain";
import { errorKey } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ConnectButtons } from "@/components/portus/connect-buttons";
import { MINT_FORM_DEFAULTS, MintRaiseFields, MintScheduleFields, MintTaxFields, MintNoTaxFields, useMintPlan, type MintForm } from "./mint-fields";

const FIELD =
  "mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none transition-colors placeholder:text-fg-muted/60 focus:border-cyan/60 focus:ring-1 focus:ring-cyan/40";
const LABEL = "block text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase";
const HINT = "mt-1 text-[12px] normal-case tracking-normal text-fg-muted";
const SECTION = "grid gap-4 border-t border-line pt-5";

function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse a decimal string in whole units into base units; null when invalid. */
function units(value: string, decimals: number): bigint | null {
  try {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
    return parseUnits(value.trim(), decimals);
  } catch {
    return null;
  }
}

/** Quote assets requested for listing; shown disabled until quoteAdmin registers them on the Factory (then they arrive via /quote-assets). */
const PENDING_QUOTES = [
  { address: "0x32b77729cd87f1ef2bea4c650c16f89f08472c69", symbol: "BOX", decimals: 18 },
  { address: "0xa1fa7777974312f7d801a8880714a218f76233f8", symbol: "USDx", decimals: 18 },
] as const;

export function CreateLaunchForm() {
  const t = useTranslations("create");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  // The wallet's actual chain: useChainId() reports the app's configured chain,
  // which hides a wallet sitting on another network.
  const { address, isConnected, chainId: walletChain } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [assets, setAssets] = useState<QuoteAsset[] | null>(null);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    description: "",
    docsUrl: "",
    quote: "",
    fdv: "100",
    incentivePct: "30",
    feeBps: 100,
    creatorSharePct: "0",
    treasuryMode: 0,
    creatorRecipient: "",
    releaseMode: 0,
    releaseRatePct: "0.3",
    ackFreezable: false,
    start: localInput(new Date(Date.now() + 15 * 60_000)),
    durationHours: String(DEFAULT_DURATION_SECONDS / 3600),
    whitelistCsv: "",
    publicPhase: true,
    publicOpensAfterHours: "0",
    publicCap: "10",
    underRule: "REFUND" as "REFUND" | "SHRINK",
    minFillPct: "50",
    ackImmutable: false,
    ackNoWithdraw: false,
  });
  // Product decision 2026-10-12: create UI is mint-only. On-chain createLaunch (STANDARD) remains deployed but is not offered here.
  const kind = "MINT" as const;
  const [mint, setMint] = useState<MintForm>(MINT_FORM_DEFAULTS);
  const setM = <K extends keyof MintForm>(key: K, value: MintForm[K]) => setMint((m) => ({ ...m, [key]: value }));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    getQuoteAssets()
      .then((list) => {
        const allowed = list.filter((a) => a.allowed);
        setAssets(allowed);
        if (allowed[0]) setForm((f) => (f.quote ? f : { ...f, quote: allowed[0]!.address }));
      })
      .catch(() => setAssets([]));
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const asset = assets?.find((a) => a.address === form.quote) ?? null;
  const decimals = asset?.decimals ?? 18;
  const symbol = asset?.symbol ?? "QUOTE";
  const incentiveBps = Math.round(Number(form.incentivePct || 0) * 100);
  const [noTax, setNoTax] = useState(false);
  useEffect(() => {
    const read = () => setNoTax(new URLSearchParams(window.location.search).get("tax") === "0");
    read();
    const onPick = (e: Event) => setNoTax((e as CustomEvent<number>).detail === 0);
    window.addEventListener("popstate", read);
    window.addEventListener("portus-tax", onPick);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("portus-tax", onPick);
    };
  }, []);
  const chooseTax = (v: boolean) => {
    setNoTax(!v);
    window.history.replaceState(null, "", `/create/?tax=${v ? 1 : 0}`);
  };
  const mintPlan = useMintPlan(mint, decimals, address, noTax);
  const isMint = kind === "MINT";

  // Live preview: FDV -> R (snapped to granularity) -> price and supply split.
  const preview = useMemo(() => {
    const fdv = units(form.fdv, decimals);
    if (fdv === null || fdv === 0n || incentiveBps < 0 || incentiveBps > 3000) return null;
    const raw = raiseFromFdv(fdv, incentiveBps);
    const R = alignRaiseTarget(raw === 0n ? 1n : raw, incentiveBps);
    const p = previewPrice(R, incentiveBps);
    return { R, adjusted: R !== raw, ...p };
  }, [form.fdv, decimals, incentiveBps]);

  // Whitelist: caps typed in whole quote units, converted to base units.
  const whitelist = useMemo(() => {
    if (!form.whitelistCsv.trim()) return { entries: null as WhitelistEntry[] | null, root: null as Hex | null, error: null as string | null };
    try {
      const rows = parseWhitelistCsv(
        form.whitelistCsv
          .split(/\r?\n/)
          .map((line) => {
            const [a, c] = line.split(/[,;\t]/).map((s) => s?.trim());
            if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a) || !c) return line;
            const base = units(c, decimals);
            if (base === null) throw new Error(`bad cap: ${line}`);
            return `${a},${base}`;
          })
          .join("\n"),
      );
      return { entries: rows, root: buildWhitelist(rows).root, error: null };
    } catch (error) {
      return { entries: null, root: null, error: (error as Error).message };
    }
  }, [form.whitelistCsv, decimals]);

  const wrongNetwork = isConnected && walletChain !== CHAIN_ID;
  const canSubmit =
    !busy &&
    (isMint ? mintPlan.ok : !!preview) &&
    !!asset &&
    !!FACTORY &&
    form.name.length > 0 &&
    form.symbol.length > 0 &&
    form.ackImmutable &&
    form.ackNoWithdraw &&
    (!asset?.freezable || form.ackFreezable) &&
    (form.creatorRecipient === "" || /^0x[0-9a-fA-F]{40}$/.test(form.creatorRecipient)) &&
    !whitelist.error &&
    (whitelist.root !== null || form.publicPhase);

  // Why the submit button is disabled, in form order, so nobody has to guess.
  const blockers = [
    !FACTORY && "blockNoFactory",
    wrongNetwork && "blockWrongNetwork",
    !asset && "blockNoQuote",
    form.name.length === 0 && "blockName",
    form.symbol.length === 0 && "blockSymbol",
    !isMint && !preview && "blockFdv",
    ...(isMint ? mintPlan.blockers : []),
    !(form.creatorRecipient === "" || /^0x[0-9a-fA-F]{40}$/.test(form.creatorRecipient)) && "blockRecipient",
    whitelist.error && "blockWhitelist",
    !whitelist.error && whitelist.root === null && !form.publicPhase && "blockNoPhase",
    !form.ackImmutable && "blockAckImmutable",
    !form.ackNoWithdraw && "blockAckNoWithdraw",
    asset?.freezable && !form.ackFreezable && "blockAckFreezable",
  ].filter(Boolean) as string[];

  async function submit() {
    if (!canSubmit || !asset || (isMint ? !mintPlan.params : !preview)) return;
    if (!address || !publicClient) {
      setStatus(t("blockNoClient"));
      return;
    }
    if (wrongNetwork) {
      setStatus(t("blockWrongNetwork"));
      return;
    }
    setBusy(true);
    try {
      // Anchor to chain time: block timestamps drift from wall-clock time. An
      // idle local chain's latest block can be stale (and the demo may have
      // fast-forwarded the clock), so mine one first to read the real "now".
      if (CHAIN_INFO.isLocal) await publicClient.request({ method: "evm_mine" as never, params: [] as never });
      const chainNow = Number((await publicClient.getBlock()).timestamp);
      let startTime = Math.floor(new Date(form.start).getTime() / 1000);
      if (startTime < chainNow + 120) startTime = chainNow + 120;
      const duration = Math.round(Number(form.durationHours) * 3600);
      const merkleRoot = whitelist.root ?? zeroHash;
      const publicOpenAt = form.publicPhase ? startTime + Math.round(Number(form.publicOpensAfterHours || 0) * 3600) : 0;
      const publicCap = form.publicPhase ? (units(form.publicCap, decimals) ?? 0n) : 0n;
      const copy = {
        name: form.name,
        symbol: form.symbol,
        description: form.description,
        docsUrl: form.docsUrl || null,
        imageUrl: null,
      };
      // Pin the copy on-chain so the API accepts exactly this text and nothing else.
      const metadataHash = form.description ? hashLaunchCopy(copy) : zeroHash;

      setStatus(t("step1"));
      const mp = mintPlan.params;
      const hash = isMint && mp
        ? await writeContractAsync({
            address: FACTORY,
            abi: portusFactoryAbi,
            functionName: "createMintLaunch",
            chainId: CHAIN_ID,
            args: [
              {
                name: form.name,
                symbol: form.symbol,
                quoteAsset: asset.address,
                raiseTarget: mp.raiseTarget,
                initialSupply: mp.initialSupply,
                maxSupply: mp.maxSupply,
                startTime: BigInt(startTime),
                duration: BigInt(duration),
                merkleRoot,
                publicOpenAt: BigInt(publicOpenAt),
                publicCap,
                underRule: form.underRule === "SHRINK" ? 1 : 0,
                minFillBps: form.underRule === "SHRINK" ? Math.round(Number(form.minFillPct || 0) * 100) : 0,
                metadataHash,
                staticBps: mp.staticBps,
                schedule: {
                  months: mp.schedule.months as unknown as readonly [number, number, number, number],
                  growthBps: mp.schedule.growthBps as unknown as readonly [number, number, number, number],
                },
                tax: mp.tax,
              },
            ],
          })
        : await writeContractAsync({
        address: FACTORY,
        abi: portusFactoryAbi,
        functionName: "createLaunch",
        chainId: CHAIN_ID,
        args: [
          {
            name: form.name,
            symbol: form.symbol,
            quoteAsset: asset.address,
            raiseTarget: preview!.R,
            feeBps: form.feeBps,
            creatorShareBps: Math.round(Number(form.creatorSharePct || 0) * 100),
            incentiveBps,
            startTime: BigInt(startTime),
            duration: BigInt(duration),
            merkleRoot,
            publicOpenAt: BigInt(publicOpenAt),
            publicCap,
            underRule: form.underRule === "SHRINK" ? 1 : 0,
            minFillBps: form.underRule === "SHRINK" ? Math.round(Number(form.minFillPct || 0) * 100) : 0,
            treasuryMode: form.treasuryMode,
            metadataHash,
            creatorRecipient: (form.creatorRecipient || zeroAddress) as `0x${string}`,
            releaseMode: form.releaseMode,
            releaseRateBps: incentiveBps > 0 ? Math.round(Number(form.releaseRatePct || 0) * 100) : 0,
          },
        ],
      });
      setStatus(tc("txSent"));
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("createLaunch reverted");
      const ev = parseEventLogs({ abi: portusFactoryAbi, logs: receipt.logs, eventName: "LaunchCreated" })[0];
      if (!ev) throw new Error("LaunchCreated event not found");
      const token = ev.args.token;

      // The API indexes on request; give it the block before uploading.
      const domain = portusSigningDomain(CHAIN_ID, FACTORY);
      // No public API (static Pages build): the launch is already on-chain; skip the
      // off-chain uploads. The root and metadataHash stay pinned for a later upload.
      if (!NO_API && whitelist.entries && whitelist.root) {
        setStatus(t("step2"));
        const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
        const listHash = whitelistListHash(whitelist.entries);
        const signature = await signTypedDataAsync({
          domain,
          types: WHITELIST_AUTH_TYPES,
          primaryType: "WhitelistAuthorization",
          message: { token, root: whitelist.root, listHash, nonce },
        });
        const res = await fetch(`${API_URL}/launches/${token}/whitelist`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entries: whitelist.entries.map((e) => ({ account: e.account, cap: e.cap.toString() })),
            root: whitelist.root,
            listHash,
            nonce,
            signature,
          }),
        });
        if (!res.ok) throw new Error(`whitelist upload: ${res.status} ${await res.text()}`);
      }

      if (!NO_API && form.description) {
        setStatus(t("step3"));
        const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
        const signature = await signTypedDataAsync({
          domain,
          types: COPY_AUTH_TYPES,
          primaryType: "LaunchCopyAuthorization",
          message: { token, copyHash: hashLaunchCopy(copy), nonce },
        });
        const res = await fetch(`${API_URL}/launches/${token}/copy`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...copy, nonce, signature }),
        });
        if (!res.ok) throw new Error(`copy upload: ${res.status} ${await res.text()}`);
      }

      setCreated(token);
      setStatus(null);
    } catch (error) {
      const { key, message } = errorKey(error);
      setStatus(te(key, { message: message ?? "" }));
    } finally {
      setBusy(false);
    }
  }

  if (!FACTORY) {
    return <p className="rounded-lg border border-line bg-surface p-6 text-sm text-fg-muted">{t("notConfigured")}</p>;
  }

  if (!isConnected) {
    return (
      <section className="rounded-lg border border-line bg-surface p-6 sm:p-8">
        <span className="font-mono text-[10px] tracking-[0.18em] text-magenta">{t("walletBoundary")}</span>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-fg">{t("connectTitle")}</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">{t("connectBody")}</p>
        <ConnectButtons className="mt-5" />
      </section>
    );
  }

  if (created) {
    return (
      <section className="rounded-lg border border-lime/40 bg-surface p-6">
        <p className="text-sm text-fg">{t("done")}</p>
        <a href={`/launch/view/?token=${created}`} className="mt-2 block font-mono text-sm break-all text-cyan hover:underline">
          /launch/view/?token={created}
        </a>
        {NO_API ? <p className="mt-3 text-[13px] leading-relaxed text-warn">{t("noApiCreated")}</p> : null}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <code className="font-mono text-xs break-all text-cyan">{address}</code>
        <button onClick={() => disconnect()} className="font-mono text-xs text-fg-muted transition-colors hover:text-rose">
          {tc("disconnect")}
        </button>
      </div>

      {wrongNetwork ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
          {tc("wrongNetwork", { chain: ACTIVE_CHAIN.name })}
          <button onClick={() => switchChain({ chainId: CHAIN_ID })} className="font-mono text-xs underline">
            {tc("switchNetwork", { chain: ACTIVE_CHAIN.name })}
          </button>
        </div>
      ) : null}

      <form
        className="mt-5 grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* template — mint only (STANDARD hidden from create UI) */}
        <fieldset className="grid gap-2">
          <legend className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("templateTitle")}</legend>
          <div className="rounded-md border border-cyan/60 bg-cyan/5 px-3 py-2.5 text-sm text-fg">
            <span className="block font-medium">{t("templateMint")}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-fg-muted">{t("templateMintHint")}</span>
            <span className="mt-1.5 block text-[12px] leading-relaxed text-fg-muted">{t("templateOnlyMintNote")}</span>
          </div>
        </fieldset>

        {/* token */}
        <div className="grid gap-4">
          <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("sectionToken")}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>
              {t("name")}
              <input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={32} className={FIELD} />
            </label>
            <label className={LABEL}>
              {t("symbol")}
              <input value={form.symbol} onChange={(e) => set("symbol", e.target.value)} required maxLength={11} className={FIELD} />
            </label>
          </div>
          <label className={LABEL}>
            {t("description")}
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={8000} rows={4} className={FIELD} />
          </label>
          <label className={LABEL}>
            {t("docsUrl")}
            <input value={form.docsUrl} onChange={(e) => set("docsUrl", e.target.value)} type="url" className={FIELD} />
          </label>
        </div>

        {/* raise */}
        <div className={SECTION}>
          <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("sectionRaise")}</div>
          {assets && assets.length === 0 ? <p className="text-sm text-fg-muted">{t("noQuoteAssets")}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>
              {t("quoteAsset")}
              <select value={form.quote} onChange={(e) => set("quote", e.target.value)} className={FIELD}>
                {(assets ?? []).map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.symbol ?? a.address} ({a.decimals}dp)
                  </option>
                ))}
                {PENDING_QUOTES.filter((p) => !(assets ?? []).some((a) => a.address.toLowerCase() === p.address.toLowerCase())).map((p) => (
                  <option key={p.address} value={p.address} disabled>
                    {p.symbol} ({p.decimals}dp) · {t("quotePending")}
                  </option>
                ))}
              </select>
            </label>
            {isMint ? null : (
              <label className={LABEL}>
                {t("targetFdv")} ({symbol})
                <input value={form.fdv} onChange={(e) => set("fdv", e.target.value)} inputMode="decimal" className={FIELD} />
              </label>
            )}
          </div>
          {asset?.freezable ? (
            <p className="rounded-md border border-warn-line bg-warn-surface px-3 py-2 text-[13px] leading-relaxed text-warn">
              ⚠ {t("freezableWarning")}
            </p>
          ) : null}
          {isMint ? <MintRaiseFields m={mint} setM={setM} plan={mintPlan} decimals={decimals} symbol={symbol} /> : null}
          {isMint ? null : (
          <label className={LABEL}>
            {t("incentive")}
            <input value={form.incentivePct} onChange={(e) => set("incentivePct", e.target.value)} inputMode="decimal" className={FIELD} />
            <span className={HINT}>{t("incentiveHint")}</span>
          </label>
          )}
          {!isMint && preview ? (
            <div className="grid gap-3 rounded-md border border-line bg-surface-2/60 p-4 font-mono text-[12.5px] sm:grid-cols-2">
              <div>
                <div className="text-fg-muted">{t("raiseTarget")}</div>
                <div className="text-fg">
                  {formatUnits(preview.R, decimals, 8)} {symbol}
                </div>
                {preview.adjusted ? <div className="mt-1 text-[11px] text-fg-muted">{t("granularityAdjusted")}</div> : null}
              </div>
              <div>
                <div className="text-fg-muted">{t("subscriptionPrice")}</div>
                <div className="text-fg">
                  {formatUnits((preview.r * 10n ** 18n * 10n ** 12n) / preview.s, decimals + 12, 12)} {symbol}
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-fg-muted">{t("supplySplit")}</div>
                <div className="text-fg">
                  {t("splitSale")} {formatTokens(preview.qSale, 0)} · {t("splitLp")} {formatTokens(preview.qLp, 0)} ·{" "}
                  {t("splitInc")} {formatTokens(preview.qInc, 0)}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {isMint ? (
          <div className="flex gap-2 rounded-xl border border-line bg-surface-2/60 p-1 text-sm">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => chooseTax(v)}
                className={cn("flex-1 rounded-lg px-3 py-2 font-semibold", noTax === !v ? "bg-bg text-brand shadow-sm" : "text-fg-muted")}
              >
                {v ? t("modeTaxed") : t("modePlain")}
              </button>
            ))}
          </div>
        ) : null}
        {isMint ? (noTax ? <MintNoTaxFields /> : <MintTaxFields m={mint} setM={setM} />) : null}
        {isMint ? <MintScheduleFields m={mint} setM={setM} plan={mintPlan} /> : null}

        {/* trading */}
        {isMint ? null : (
        <div className={SECTION}>
          <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("sectionTrading")}</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={LABEL}>
              {t("feeTier")}
              <select value={form.feeBps} onChange={(e) => set("feeBps", Number(e.target.value))} className={FIELD}>
                {FEE_TIERS.map((f) => (
                  <option key={f} value={f}>
                    {f / 100}%
                  </option>
                ))}
              </select>
              <span className={HINT}>{t("roundTripCost", { cost: `${(roundTripCost(form.feeBps) * 100).toFixed(2)}%` })}</span>
            </label>
            <label className={LABEL}>
              {t("creatorShare")}
              <input value={form.creatorSharePct} onChange={(e) => set("creatorSharePct", e.target.value)} inputMode="decimal" className={FIELD} />
              <span className={HINT}>{t("creatorShareHint")}</span>
            </label>
            <label className={LABEL}>
              {t("creatorRecipient")}
              <input
                value={form.creatorRecipient}
                onChange={(e) => set("creatorRecipient", e.target.value.trim())}
                placeholder="0x…"
                className={FIELD}
              />
              <span className={HINT}>{t("creatorRecipientHint")}</span>
            </label>
          </div>
        </div>

        )}

        {/* economy */}
        {isMint ? null : (
        <div className={SECTION}>
          <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("sectionEconomy")}</div>
          <div className="grid gap-2 rounded-md border border-line bg-surface-2/60 p-4 font-mono text-[12.5px] sm:grid-cols-4">
            {(() => {
              const c = Math.min(40, Math.max(0, Number(form.creatorSharePct || 0)));
              const rows: Array<[string, number]> = [
                [t("splitEcosystem"), 20],
                [t("splitFlywheel"), 20],
                [t("splitCreator"), c],
                [t("splitTreasury"), 60 - c],
              ];
              return rows.map(([label, v]) => (
                <div key={label}>
                  <div className="text-fg-muted">{label}</div>
                  <div className="text-fg">{v}%</div>
                </div>
              ));
            })()}
          </div>
          <p className={HINT}>{t("feeSplit")}</p>
          <fieldset className="grid gap-2">
            <legend className={LABEL}>{t("treasuryMode")}</legend>
            {[0, 1].map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-fg">
                <input type="radio" name="treasuryMode" checked={form.treasuryMode === m} onChange={() => set("treasuryMode", m)} />
                {m === 0 ? t("treasuryModeBuyback") : t("treasuryModeRewards")}
              </label>
            ))}
            <span className={HINT}>{t("treasuryModeHint")}</span>
          </fieldset>
          {incentiveBps > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="grid gap-2">
                <legend className={LABEL}>{t("releaseMode")}</legend>
                {[0, 1].map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm text-fg">
                    <input type="radio" name="releaseMode" checked={form.releaseMode === m} onChange={() => set("releaseMode", m)} />
                    {m === 0 ? t("releaseLinear") : t("releaseDecaying")}
                  </label>
                ))}
              </fieldset>
              <label className={LABEL}>
                {t("releaseRate")}
                <input value={form.releaseRatePct} onChange={(e) => set("releaseRatePct", e.target.value)} inputMode="decimal" className={FIELD} />
                <span className={HINT}>
                  {t("releaseRateHint", {
                    days: Number(form.releaseRatePct) > 0 ? Math.round(incentiveBps / 100 / Number(form.releaseRatePct)) : "—",
                  })}
                </span>
              </label>
            </div>
          ) : null}
        </div>
        )}

        {/* window */}
        <div className={SECTION}>
          <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("sectionWindow")}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL}>
              {t("startTime")}
              <input value={form.start} onChange={(e) => set("start", e.target.value)} type="datetime-local" className={FIELD} />
            </label>
            <label className={LABEL}>
              {t("duration")}
              <input value={form.durationHours} onChange={(e) => set("durationHours", e.target.value)} inputMode="decimal" className={FIELD} />
              <span className={HINT}>{t("durationHint")}</span>
            </label>
          </div>
          <label className={LABEL}>
            {t("whitelistUpload")}
            <textarea
              value={form.whitelistCsv}
              onChange={(e) => set("whitelistCsv", e.target.value)}
              rows={4}
              placeholder={"address,cap\n0x…,5"}
              className={FIELD}
            />
            <span className={HINT}>{t("whitelistHint")}</span>
          </label>
          {whitelist.error ? <p className="text-[12px] text-rose">{whitelist.error}</p> : null}
          {NO_API && whitelist.root ? <p className="text-[12px] text-warn">{t("noApiWhitelist")}</p> : null}
          {whitelist.root ? (
            <p className="font-mono text-[11.5px] break-all text-fg-muted">
              {t("whitelistRoot")}: <span className="text-fg">{whitelist.root}</span> · {t("whitelistCount", { count: whitelist.entries!.length })}
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={form.publicPhase} onChange={(e) => set("publicPhase", e.target.checked)} />
            {t("publicPhase")}
          </label>
          {form.publicPhase ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={LABEL}>
                {t("publicOpensAfter")}
                <input
                  value={form.publicOpensAfterHours}
                  onChange={(e) => set("publicOpensAfterHours", e.target.value)}
                  inputMode="decimal"
                  className={FIELD}
                />
              </label>
              <label className={LABEL}>
                {t("publicCap")} ({symbol})
                <input value={form.publicCap} onChange={(e) => set("publicCap", e.target.value)} inputMode="decimal" className={FIELD} />
              </label>
            </div>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className={LABEL}>{t("underRule")}</legend>
            {(["REFUND", "SHRINK"] as const).map((rule) => (
              <label key={rule} className="flex items-center gap-2 text-sm text-fg">
                <input type="radio" name="underRule" checked={form.underRule === rule} onChange={() => set("underRule", rule)} />
                {rule === "REFUND" ? t("underRefund") : t("underShrink")}
              </label>
            ))}
          </fieldset>
          {form.underRule === "SHRINK" ? (
            <label className={LABEL}>
              {t("minFill")}
              <input value={form.minFillPct} onChange={(e) => set("minFillPct", e.target.value)} inputMode="decimal" className={FIELD} />
            </label>
          ) : null}
        </div>

        {/* confirm */}
        <div className={SECTION}>
          <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("sectionConfirm")}</div>
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-1" checked={form.ackImmutable} onChange={(e) => set("ackImmutable", e.target.checked)} />
            {t("immutableAck")}
          </label>
          {asset?.freezable ? (
            <label className="flex items-start gap-2 rounded-md border border-warn-line bg-warn-surface px-3 py-2 text-sm text-warn">
              <input type="checkbox" className="mt-1" checked={form.ackFreezable} onChange={(e) => set("ackFreezable", e.target.checked)} />
              {t("freezableAck")}
            </label>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-1" checked={form.ackNoWithdraw} onChange={(e) => set("ackNoWithdraw", e.target.checked)} />
            {t("noWithdrawAck")}
          </label>
          <button
            type="submit"
            disabled={!canSubmit || wrongNetwork}
            className={cn(
              "glow-cyan w-full rounded-md bg-cyan px-4 py-2.5 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90",
              (!canSubmit || wrongNetwork) && "cursor-not-allowed opacity-40",
            )}
          >
            {busy ? tc("pending") : t("submit")}
          </button>
          {!busy && blockers.length > 0 ? (
            <div className="rounded-md border border-line px-3 py-2 text-[12px] text-fg-muted">
              <div className="font-medium text-fg">{t("blockersTitle")}</div>
              <ul className="mt-1 list-disc pl-5">
                {blockers.map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </form>

      <output className="mt-5 block rounded-md border border-line bg-bg px-3 py-2.5 font-mono text-xs break-all text-fg-muted">
        {status ?? t("statusAwaiting")}
      </output>
    </section>
  );
}
