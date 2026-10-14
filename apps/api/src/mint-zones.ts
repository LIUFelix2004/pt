/**
 * Mint-mode zone / referral-power maths for the invite UI.
 * Mirrors apps/keeper/src/rewards/calc.ts (referralPower + icbrt) so the
 * dashboard numbers match what the daily publisher would count — except the
 * UI uses live balances as a proxy; the publisher uses 24h TWAB.
 */

export const MINT_ZONE_STEP = 10_000n * 10n ** 18n;
export const MINT_ZONE_MULTIPLIER = 10n;

/** floor(cbrt(n)) for n ≥ 0. */
export function icbrt(n: bigint): bigint {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 3));
  for (;;) {
    const y = (2n * x + n / (x * x)) / 3n;
    if (y >= x) break;
    x = y;
  }
  while (x * x * x > n) x -= 1n;
  while ((x + 1n) ** 3n <= n) x += 1n;
  return x;
}

/** Referral power of one referrer from its direct invitees' holdings (base units). */
export function referralPower(zones: readonly bigint[]): bigint {
  const live = zones.filter((z) => z > 0n).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (live.length === 0) return 0n;
  let power = icbrt(live[0]! * 10n ** 36n);
  for (const h of live.slice(1)) {
    power += h > MINT_ZONE_STEP ? MINT_ZONE_STEP * MINT_ZONE_MULTIPLIER + (h - MINT_ZONE_STEP) : h * MINT_ZONE_MULTIPLIER;
  }
  return power;
}

export interface ZoneRow {
  account: string;
  holding: string;
  isMajor: boolean;
  boundAt: number | null;
  txHash: string | null;
}

/** Sort zones by holding desc; mark the largest as 大区. */
export function buildZones(
  invitees: Array<{ account: string; boundAt: number | null; txHash: string | null }>,
  holdingOf: ReadonlyMap<string, bigint>,
): { zones: ZoneRow[]; referralPower: string; directCount: number } {
  const rows = invitees.map((inv) => ({
    account: inv.account,
    holding: (holdingOf.get(inv.account.toLowerCase()) ?? 0n).toString(),
    boundAt: inv.boundAt,
    txHash: inv.txHash,
  }));
  rows.sort((a, b) => {
    const ha = BigInt(a.holding);
    const hb = BigInt(b.holding);
    if (ha === hb) return a.account < b.account ? -1 : 1;
    return ha > hb ? -1 : 1;
  });
  const zones: ZoneRow[] = rows.map((r, i) => ({
    ...r,
    isMajor: i === 0 && BigInt(r.holding) > 0n,
  }));
  const power = referralPower(zones.map((z) => BigInt(z.holding)));
  return { zones, referralPower: power.toString(), directCount: zones.length };
}
