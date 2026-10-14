import type { Launch } from "@/lib/api";

/**
 * Display-only demo launches for the homepage. NOT real contracts: the token
 * field is a deliberately invalid hex string, nothing here is ever sent to the
 * chain or the API. To remove: set NEXT_PUBLIC_SHOW_DEMO_TOKEN=0 at build time,
 * or empty DEMO_LAUNCHES.
 */
export const SHOW_DEMO_TOKEN = process.env.NEXT_PUBLIC_SHOW_DEMO_TOKEN !== "0";

const E18 = "000000000000000000";
export const DEMO_LAUNCHES: Launch[] = [
  {
    token: "0x0000000000000000000000000000000000RADR",
    kind: "MINT",
    phase: "OPEN",
    copy: { name: "RADR", symbol: "RADR" },
    quote: { symbol: "WETH", decimals: 18 },
    raiseTarget: "10" + E18,
    totalCommitted: "68" + E18.slice(1),
    subscriberCount: 42,
    qSale: "5000000" + E18,
    qLp: "5000000" + E18,
    qInc: "0",
    tokensBurned: "0",
    priceNum: "2",
    priceDen: "1000000",
    startTime: 0,
    launchId: 0,
  } as unknown as Launch,
];

export const isDemoLaunch = (l: Pick<Launch, "token">) => DEMO_LAUNCHES.some((d) => d.token === l.token);
export const demoLaunches = (): Launch[] => (SHOW_DEMO_TOKEN ? DEMO_LAUNCHES : []);
