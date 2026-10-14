import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const KNOWN = new Set([
  "InvalidProof",
  "CapExceeded",
  "NotOpen",
  "PublicNotOpen",
  "ZeroAmount",
  "UnsupportedQuoteToken",
  "NotAwaitingFinalize",
  "NotSettled",
  "NothingToClaim",
  "AlreadyClaimed",
  "SlippageExceeded",
  "Expired",
  "InsufficientOutput",
  "NotInitialized",
  "InvalidFeeTier",
  "PriceNotGranular",
  "FdvOutOfBounds",
  "InvalidSchedule",
  "NoSubscriptionPath",
  "InvalidPublicPhase",
  "InvalidUnderfill",
  "InvalidMetadata",
  "QuoteAssetNotAllowed",
]);

/**
 * Map a wallet / contract error to a message key under `errors.*`, so every
 * custom error the contracts can raise reaches the user in plain language.
 */
export function errorKey(error: unknown): { key: string; message?: string } {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return { key: "userRejected" };
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && KNOWN.has(name)) return { key: name };
      return { key: "unknown", message: name ?? revert.shortMessage };
    }
    return { key: "unknown", message: error.shortMessage };
  }
  return { key: "unknown", message: error instanceof Error ? error.message : String(error) };
}
