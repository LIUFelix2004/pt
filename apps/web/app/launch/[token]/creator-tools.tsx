"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useSignTypedData } from "wagmi";
import { parseUnits, toHex, zeroHash, type Address } from "viem";
import {
  COPY_AUTH_TYPES,
  WHITELIST_AUTH_TYPES,
  buildWhitelist,
  hashLaunchCopy,
  parseWhitelistCsv,
  portusSigningDomain,
  whitelistListHash,
} from "@portus/shared/browser";
import { API_URL, quoteDecimals, type Launch } from "@/lib/api";
import { CHAIN_ID, FACTORY } from "@/lib/chain";
import { errorKey } from "@/lib/errors";
import { Section } from "@/components/portus/section";

const FIELD =
  "mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-cyan/60";
const BTN =
  "rounded-md border border-cyan/50 px-4 py-2 font-mono text-xs text-cyan transition-colors hover:bg-cyan/10 disabled:opacity-40";

/** Shown only to the launch's creator: (re)upload the whitelist and copy. */
export function CreatorTools({ launch }: { launch: Launch }) {
  const t = useTranslations("launch");
  const tCreate = useTranslations("create");
  const te = useTranslations("errors");
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [csv, setCsv] = useState("");
  const [copy, setCopy] = useState({ name: launch.copy.name, symbol: launch.copy.symbol, description: "", docsUrl: "" });
  const [msg, setMsg] = useState<string | null>(null);

  if (!address || address.toLowerCase() !== launch.creator.toLowerCase()) return null;
  const domain = portusSigningDomain(CHAIN_ID, FACTORY);
  const token = launch.token as Address;

  async function uploadWhitelist() {
    try {
      const decimals = quoteDecimals(launch);
      const entries = parseWhitelistCsv(
        csv
          .split(/\r?\n/)
          .map((line) => {
            const [a, c] = line.split(/[,;\t]/).map((s) => s?.trim());
            return a && /^0x[0-9a-fA-F]{40}$/.test(a) && c ? `${a},${parseUnits(c, decimals)}` : line;
          })
          .join("\n"),
      );
      const root = buildWhitelist(entries).root;
      if (root.toLowerCase() !== launch.merkleRoot.toLowerCase()) throw new Error("list does not match the on-chain merkleRoot");
      const listHash = whitelistListHash(entries);
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const signature = await signTypedDataAsync({
        domain,
        types: WHITELIST_AUTH_TYPES,
        primaryType: "WhitelistAuthorization",
        message: { token, root, listHash, nonce },
      });
      const res = await fetch(`${API_URL}/launches/${token}/whitelist`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: entries.map((e) => ({ account: e.account, cap: e.cap.toString() })), root, listHash, nonce, signature }),
      });
      setMsg(res.ok ? "✓" : `${res.status} ${await res.text()}`);
    } catch (error) {
      const { key, message } = errorKey(error);
      setMsg(te(key, { message: message ?? "" }));
    }
  }

  async function uploadCopy() {
    try {
      const content = { ...copy, docsUrl: copy.docsUrl || null, imageUrl: null };
      const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const signature = await signTypedDataAsync({
        domain,
        types: COPY_AUTH_TYPES,
        primaryType: "LaunchCopyAuthorization",
        message: { token, copyHash: hashLaunchCopy(content), nonce },
      });
      const res = await fetch(`${API_URL}/launches/${token}/copy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...content, nonce, signature }),
      });
      setMsg(res.ok ? "✓" : `${res.status} ${await res.text()}`);
    } catch (error) {
      const { key, message } = errorKey(error);
      setMsg(te(key, { message: message ?? "" }));
    }
  }

  return (
    <Section title={t("creatorTools")}>
      <div className="grid gap-4 rounded-lg border border-magenta/30 bg-surface p-5">
        <p className="text-[13px] leading-relaxed text-fg-muted">{t("creatorToolsBody")}</p>
        {launch.merkleRoot !== zeroHash ? (
          <div className="grid gap-2">
            <label className="text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">
              {tCreate("whitelistUpload")}
              <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} className={FIELD} />
            </label>
            <button className={BTN} disabled={!csv.trim()} onClick={() => void uploadWhitelist()}>
              {tCreate("signWhitelist")}
            </button>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={copy.name} onChange={(e) => setCopy({ ...copy, name: e.target.value })} placeholder={tCreate("name")} className={FIELD} />
          <input value={copy.symbol} onChange={(e) => setCopy({ ...copy, symbol: e.target.value })} placeholder={tCreate("symbol")} className={FIELD} />
          <textarea
            value={copy.description}
            onChange={(e) => setCopy({ ...copy, description: e.target.value })}
            rows={3}
            placeholder={tCreate("description")}
            className={`${FIELD} sm:col-span-2`}
          />
          <input value={copy.docsUrl} onChange={(e) => setCopy({ ...copy, docsUrl: e.target.value })} placeholder={tCreate("docsUrl")} className={`${FIELD} sm:col-span-2`} />
        </div>
        <button className={BTN} onClick={() => void uploadCopy()}>
          {tCreate("signCopy")}
        </button>
        {msg ? <p className="font-mono text-xs break-all text-fg-muted">{msg}</p> : null}
      </div>
    </Section>
  );
}
