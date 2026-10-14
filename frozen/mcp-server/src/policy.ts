import type { Address } from "@obscura/shared";
import { loadConfig } from "./config.js";

/**
 * The security boundary of this MCP server.
 *
 * Every state-changing call funnels through `assertAllowed` before a signature
 * is produced. Three independent constraints must hold:
 *
 *   1. DESTINATION — `to` must be a contract address resolved from the frozen
 *      deployment config. Tool arguments cannot supply a destination, and
 *      nothing read off the network can introduce one.
 *   2. METHOD — the function must appear in ALLOWED below. This is an
 *      allowlist, so a newly added contract method is unreachable until
 *      someone edits this file deliberately.
 *   3. VALUE — attached wei must not exceed the configured hard cap. No tool
 *      argument, agent instruction, or launch description can raise it.
 *
 * Anything an agent might be talked into doing has to fit through all three.
 */
const ALLOWED = {
  agentRegistry: new Set(["register", "requestExit", "withdrawStake"]),
  launchpadAuction: new Set(["commit", "reveal", "claim"]),
} as const;

export type ContractKey = keyof typeof ALLOWED;

export interface CallRequest {
  contract: ContractKey;
  functionName: string;
  valueWei?: bigint;
}

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(`policy violation: ${message}`);
    this.name = "PolicyViolation";
  }
}

/** Resolves the destination address for a contract key. Never accepts an address. */
export function resolveTarget(contract: ContractKey): Address {
  const { deployment } = loadConfig();
  switch (contract) {
    case "agentRegistry":
      return deployment.agentRegistry;
    case "launchpadAuction":
      return deployment.launchpadAuction;
    default: {
      const exhaustive: never = contract;
      throw new PolicyViolation(`unknown contract ${String(exhaustive)}`);
    }
  }
}

export function assertAllowed(req: CallRequest): Address {
  const methods: ReadonlySet<string> = ALLOWED[req.contract];
  if (!methods) throw new PolicyViolation(`contract ${req.contract} is not allowlisted`);
  if (!methods.has(req.functionName)) {
    throw new PolicyViolation(
      `${req.contract}.${req.functionName} is not allowlisted. ` +
        `Permitted: ${[...methods].join(", ")}`,
    );
  }

  const value = req.valueWei ?? 0n;
  if (value < 0n) throw new PolicyViolation("negative value");

  const { maxSpendWei } = loadConfig();
  if (value > maxSpendWei) {
    throw new PolicyViolation(
      `attaching ${value} wei exceeds the hard cap of ${maxSpendWei} wei. ` +
        "Raise OBSCURA_MAX_SPEND_WEI in your own .env if this is intended — " +
        "it cannot be raised from inside a conversation.",
    );
  }

  return resolveTarget(req.contract);
}
