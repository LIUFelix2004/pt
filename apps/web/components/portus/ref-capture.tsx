"use client";

import { useEffect } from "react";

export const REF_KEY = "portus-ref";

/**
 * Remember an invite link's `?ref=0x…` (or RADR-style `?referral=`) so the
 * "Me" page / bind prompt can offer to bind it. Binding itself is an explicit
 * on-chain action by the invitee; nothing here signs anything.
 */
export function RefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref") ?? params.get("referral");
      if (ref && /^0x[0-9a-fA-F]{40}$/.test(ref)) localStorage.setItem(REF_KEY, ref);
    } catch {
      /* storage unavailable: nothing to remember */
    }
  }, []);
  return null;
}
