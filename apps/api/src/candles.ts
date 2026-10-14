import type { Candle } from "@portus/shared";

export const INTERVALS = { "1m": 60, "5m": 300, "1h": 3600, "1d": 86400 } as const;
export type Interval = keyof typeof INTERVALS;

export interface SwapPoint {
  ts: number;
  is_buy: number;
  amount_in: string;
  amount_out: string;
  fee_quote: string;
  reserve_quote: string;
  reserve_token: string;
}

const WAD = 10n ** 18n;

/** Post-trade marginal price in quote base units per 1e18 token base units. */
export function spotPrice(reserveQuote: bigint, reserveToken: bigint): bigint {
  return reserveToken === 0n ? 0n : (reserveQuote * WAD) / reserveToken;
}

/**
 * OHLCV buckets from swaps in chronological order. Each trade's price is the
 * pool's marginal price right after it; volume is the quote side (input on a
 * buy, gross output — paid out plus fee — on a sell).
 */
export function aggregateCandles(swaps: readonly SwapPoint[], interval: Interval): Candle[] {
  const step = INTERVALS[interval];
  const out: Array<{ t: number; o: bigint; h: bigint; l: bigint; c: bigint; v: bigint }> = [];
  for (const s of swaps) {
    const t = Math.floor(s.ts / step) * step;
    const p = spotPrice(BigInt(s.reserve_quote), BigInt(s.reserve_token));
    const vol = s.is_buy ? BigInt(s.amount_in) : BigInt(s.amount_out) + BigInt(s.fee_quote);
    const last = out[out.length - 1];
    if (last && last.t === t) {
      if (p > last.h) last.h = p;
      if (p < last.l) last.l = p;
      last.c = p;
      last.v += vol;
    } else {
      out.push({ t, o: p, h: p, l: p, c: p, v: vol });
    }
  }
  return out.map((c) => ({ t: c.t, o: c.o.toString(), h: c.h.toString(), l: c.l.toString(), c: c.c.toString(), v: c.v.toString() }));
}
