import { getLaunches } from "@/lib/api";
import { HomeMarket } from "@/components/portus/home-market";

export default async function Home() {
  // Static export: never bake the apiDown shell into HTML. If the API is
  // unreachable at build time, ship an empty list + client refresh.
  let launches: Awaited<ReturnType<typeof getLaunches>> = [];
  try {
    launches = await getLaunches();
  } catch {
    launches = [];
  }

  return <HomeMarket initial={launches} />;
}
