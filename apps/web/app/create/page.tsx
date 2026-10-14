import { getTranslations } from "next-intl/server";
import { CreateLaunchForm } from "./create-launch-form";
import { Shell } from "@/components/portus/shell";

export default async function CreatePage() {
  const t = await getTranslations("create");

  return (
    <Shell className="py-10">
      <div className="relative overflow-hidden rounded-lg border border-line bg-surface p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_140%_at_100%_0%,rgba(255,122,217,0.12),transparent_60%)]"
        />
        <div className="relative">
          <span className="font-mono text-[10px] tracking-[0.18em] text-magenta">{t("kicker")}</span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{t("title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">{t("intro")}</p>
        </div>
      </div>
      <div className="mt-5">
        <CreateLaunchForm />
      </div>
    </Shell>
  );
}
