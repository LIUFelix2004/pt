import type { LocalCommitRecord } from "@obscura/shared";

export interface AuctionWindow { phase: string; revealEnd: bigint; revealed?: boolean; claimed?: boolean }

export interface PendingAction {
  auctionId: number;
  action: "reveal" | "claim" | "unknown";
  deadline: number | null;
  urgency: number;
  message: string;
}

/** Build prominent warnings for locally stored bids that still need revealing. */
export async function unrevealedWarnings(
  commits: LocalCommitRecord[],
  readWindow: (auctionId: number) => Promise<AuctionWindow>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string[]> {
  const warnings: string[] = [];
  for (const commit of commits) {
    let window: AuctionWindow;
    try { window = await readWindow(commit.auctionId); }
    catch { warnings.push(`⚠ STATUS UNKNOWN: could not verify auction #${commit.auctionId}; check RPC before its reveal deadline.`); continue; }
    if (window.revealed ?? Boolean(commit.revealTxHash)) continue;
    if (window.phase !== "REVEAL") continue;
    const remaining = Number(window.revealEnd) - nowSeconds;
    const urgency = remaining <= 900 ? "CRITICAL" : remaining <= 3600 ? "URGENT" : "ACTION REQUIRED";
    warnings.push(`⚠ ${urgency}: reveal auction #${commit.auctionId} within ${Math.max(0, remaining)}s or forfeit ${commit.depositWei} wei collateral.`);
  }
  return warnings;
}

export async function pendingActions(
  commits: LocalCommitRecord[],
  readState: (auctionId: number) => Promise<AuctionWindow & { claimable: boolean }>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<PendingAction[]> {
  const actions: PendingAction[] = [];
  for (const commit of commits) {
    let state: AuctionWindow & { claimable: boolean };
    try { state = await readState(commit.auctionId); }
    catch {
      actions.push({ auctionId: commit.auctionId, action: "unknown", deadline: null, urgency: 0, message: `STATUS UNKNOWN: could not verify auction #${commit.auctionId}; inspect the chain before taking action.` });
      continue;
    }
    if (!(state.revealed ?? Boolean(commit.revealTxHash)) && state.phase === "REVEAL") {
      const remaining = Number(state.revealEnd) - nowSeconds;
      actions.push({ auctionId: commit.auctionId, action: "reveal", deadline: Number(state.revealEnd), urgency: Math.max(0, remaining), message: `Reveal auction #${commit.auctionId} within ${Math.max(0, remaining)}s or forfeit ${commit.depositWei} wei.` });
    } else if ((state.revealed ?? Boolean(commit.revealTxHash)) && state.claimable) {
      actions.push({ auctionId: commit.auctionId, action: "claim", deadline: null, urgency: Number.MAX_SAFE_INTEGER, message: `Claim allocation/refund for settled auction #${commit.auctionId}.` });
    }
  }
  return actions.sort((a, b) => a.urgency - b.urgency || a.auctionId - b.auctionId);
}
