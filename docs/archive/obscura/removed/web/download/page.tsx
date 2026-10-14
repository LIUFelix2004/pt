import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Shell } from "@/components/obscura/shell";
import { Section } from "@/components/obscura/section";
import { UntrustedFence } from "@/components/obscura/untrusted";

export const dynamic = "force-dynamic";

/** Download page: what the MCP bundle is, its trust properties, and SHA-256 verification. */
export default async function DownloadPage() {
  const t = await getTranslations("download");
  const tCommon = await getTranslations("common");

  const code = (chunks: React.ReactNode) => (
    <code className="font-mono text-cyan">{chunks}</code>
  );

  let sha: string | null = null;
  let built = false;
  try {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const shaPath = resolve(process.cwd(), "../../packages/mcp-server/dist/obscura-mcp.sha256");
    sha = readFileSync(shaPath, "utf8").trim();
    built = sha.length === 64;
  } catch {
    /* not built yet */
  }

  return (
    <Shell className="py-10">
      <Link href="/" className="font-mono text-xs text-fg-muted transition-colors hover:text-cyan">
        {tCommon("allLaunches")}
      </Link>

      <div className="relative mt-5 overflow-hidden rounded-lg border border-line bg-surface p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_140%_at_0%_0%,rgba(61,220,245,0.12),transparent_60%),radial-gradient(60%_120%_at_100%_10%,rgba(255,122,217,0.10),transparent_60%)]"
        />
        <div className="relative">
          <span className="font-mono text-[10px] tracking-[0.18em] text-cyan">{t("kicker")}</span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">
            {t.rich("intro", { b: (chunks) => <strong className="text-fg">{chunks}</strong> })}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-line bg-surface p-6">
        {built ? (
          <>
            <a
              href="/download/mcp"
              download="obscura-mcp.zip"
              className="glow-cyan inline-flex items-center gap-2 rounded-md bg-cyan px-5 py-2.5 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("button")}
            </a>

            <div className="mt-5">
              <div className="font-mono text-[10px] tracking-[0.16em] text-fg-muted">
                {t("sha256")}
              </div>
              <code className="mt-1 block overflow-x-auto rounded-md border border-line bg-[#080b11] px-3 py-2 font-mono text-[12px] break-all text-lime">
                {sha}
              </code>
            </div>

            <p className="mt-4 text-[13px] leading-relaxed text-fg-muted">
              {t.rich("verifyNote", { cmd: code })}
            </p>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-fg-muted">
            {t.rich("notBuilt", { cmd: code })}
          </p>
        )}
      </div>

      <Section title={t("beforeYouRun")}>
        {/* Amber, deliberately: this is the same class of warning as untrusted
            creator copy — the reader is about to hand a program their key. */}
        <UntrustedFence label={t("trustLabel")}>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>{t("trust1")}</li>
            <li>{t.rich("trust2", { cmd: (chunks) => <code className="font-mono">{chunks}</code> })}</li>
            <li>{t("trust3")}</li>
            <li>{t("trust4")}</li>
            <li>{t("trust5")}</li>
          </ul>
        </UntrustedFence>
      </Section>
    </Shell>
  );
}
