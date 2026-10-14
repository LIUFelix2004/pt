import { getTranslations } from "next-intl/server";
import { Shell } from "@/components/portus/shell";
import { MeClient } from "./me-client";

export default async function MePage() {
  const t = await getTranslations("me");
  return (
    <Shell className="py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <div className="mt-6">
        <MeClient />
      </div>
    </Shell>
  );
}
