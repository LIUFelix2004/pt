"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Shell } from "@/components/portus/shell";
import { LaunchBoot } from "../[token]/launch-boot";

function tokenFromParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value : undefined;
}

function LaunchViewerInner() {
  const searchParams = useSearchParams();
  const token = tokenFromParam(searchParams.get("token"));
  return <LaunchBoot token={token} />;
}

function Pending() {
  const tc = useTranslations("common");
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface/50 p-10 text-center text-sm text-fg-muted">
      {tc("pending")}
    </div>
  );
}

/** Static Pages-safe launch viewer: token comes from ?token=0x..., not a dynamic path segment. */
export default function LaunchViewPage() {
  return (
    <Shell className="py-10">
      <Suspense fallback={<Pending />}>
        <LaunchViewerInner />
      </Suspense>
    </Shell>
  );
}