"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useWriteContract } from "wagmi";
import { parseAbi, parseUnits, type Address } from "viem";
import { CHAIN_INFO, RPC_URL } from "@/lib/chain";
import { useTx } from "@/lib/use-tx";
import type { Launch } from "@/lib/api";

const MOCK_MINT = parseAbi(["function mint(address to, uint256 amount)"]);

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL ?? "http://127.0.0.1:8545", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
}

/**
 * LOCAL CHAIN ONLY — demo helpers that do not exist on a real network:
 * mint test quote tokens (the local MockWETH / MockUSD have a public mint) and
 * move the chain clock to the next phase boundary instead of waiting for it.
 */
export function LocalDevTools({ launch, onChange }: { launch: Launch; onChange: () => void }) {
  const t = useTranslations("devTools");
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx(onChange);
  const [msg, setMsg] = useState<string | null>(null);

  if (!CHAIN_INFO.isLocal) return null;

  async function jump(to: number) {
    try {
      await rpc("evm_setNextBlockTimestamp", [to]);
      await rpc("evm_mine", []);
      setMsg(t("jumped", { time: new Date(to * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" }));
      onChange();
    } catch (error) {
      setMsg((error as Error).message);
    }
  }

  /** Relative fast-forward: mine one block to read the real "now" first. */
  async function advance(seconds: number) {
    try {
      await rpc("evm_increaseTime", [seconds]);
      await rpc("evm_mine", []);
      setMsg(t("jumped", { time: `+${seconds / 3600}h` }));
      onChange();
    } catch (error) {
      setMsg((error as Error).message);
    }
  }

  const symbol = launch.quote?.symbol ?? "QUOTE";
  const decimals = launch.quote?.decimals ?? 18;
  const btn =
    "rounded-md border border-magenta/50 px-3 py-1.5 font-mono text-xs text-magenta transition-colors hover:bg-magenta/10 disabled:opacity-40";

  return (
    <div className="rounded-lg border border-dashed border-magenta/40 bg-magenta/[0.04] p-4">
      <div className="font-mono text-[10px] tracking-[0.16em] text-magenta">{t("title")}</div>
      <p className="mt-1 text-[12px] text-fg-muted">{t("body")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={btn}
          disabled={!address || tx.busy}
          onClick={() => {
            setMsg(null);
            void tx.run([
              () =>
                writeContractAsync({
                  address: launch.quoteAsset as Address,
                  abi: MOCK_MINT,
                  functionName: "mint",
                  args: [address!, parseUnits("100", decimals)],
                }),
            ]);
          }}
        >
          {t("faucet", { symbol })}
        </button>
        <button className={btn} onClick={() => void advance(3600)}>
          {t("plusHour")}
        </button>
        <button className={btn} onClick={() => void advance(86_400)}>
          {t("plusDay")}
        </button>
        {launch.phase === "PENDING" ? (
          <button className={btn} onClick={() => void jump(launch.startTime)}>
            {t("toStart")}
          </button>
        ) : null}
        {launch.phase === "OPEN" && launch.publicOpenAt > launch.startTime ? (
          <button className={btn} onClick={() => void jump(launch.publicOpenAt)}>
            {t("toPublic")}
          </button>
        ) : null}
        {launch.phase === "OPEN" ? (
          <button className={btn} onClick={() => void jump(launch.endTime)}>
            {t("toEnd")}
          </button>
        ) : null}
      </div>
      {msg || tx.message ? <p className="mt-2 font-mono text-xs break-all text-fg-muted">{msg ?? tx.message}</p> : null}
    </div>
  );
}
