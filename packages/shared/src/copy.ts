/**
 * Creator-signed off-chain data: launch copy and whitelist uploads.
 *
 * Both are EIP-712 messages bound to the factory and chain, signed by the
 * launch's on-chain `creator`. The API stores nothing a creator did not sign,
 * and the front end computes `metadataHash` with the same function at
 * createLaunch, so copy can be pinned on-chain before it is ever uploaded.
 */
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";

export interface LaunchCopyContent {
  name: string;
  symbol: string;
  description: string;
  docsUrl?: string | null;
  imageUrl?: string | null;
}

export function hashLaunchCopy(copy: LaunchCopyContent): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string,string,string,string,string"), [
      copy.name,
      copy.symbol,
      copy.description,
      copy.docsUrl ?? "",
      copy.imageUrl ?? "",
    ]),
  );
}

export function portusSigningDomain(chainId: number, factory: Address) {
  return {
    name: "Portus Launch Copy",
    version: "1",
    chainId,
    verifyingContract: factory,
  } as const;
}

export const COPY_AUTH_TYPES = {
  LaunchCopyAuthorization: [
    { name: "token", type: "address" },
    { name: "copyHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const WHITELIST_AUTH_TYPES = {
  WhitelistAuthorization: [
    { name: "token", type: "address" },
    { name: "root", type: "bytes32" },
    { name: "listHash", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
