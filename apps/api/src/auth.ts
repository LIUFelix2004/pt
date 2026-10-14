import { verifyTypedData, type Address, type Hex } from "viem";
import {
  COPY_AUTH_TYPES,
  WHITELIST_AUTH_TYPES,
  hashLaunchCopy,
  portusSigningDomain,
  type LaunchCopyContent,
} from "@portus/shared";

export { hashLaunchCopy };
export type { LaunchCopyContent };

interface Bound {
  /** The launch's on-chain creator; the only accepted signer. */
  creator: Address;
  token: Address;
  nonce: Hex;
  signature: Hex;
  chainId: number;
  factory: Address;
}

export async function verifyCopyAuthorization(input: Bound & { copy: LaunchCopyContent }): Promise<boolean> {
  return verifyTypedData({
    address: input.creator,
    domain: portusSigningDomain(input.chainId, input.factory),
    types: COPY_AUTH_TYPES,
    primaryType: "LaunchCopyAuthorization",
    message: { token: input.token, copyHash: hashLaunchCopy(input.copy), nonce: input.nonce },
    signature: input.signature,
  });
}

export async function verifyWhitelistAuthorization(input: Bound & { root: Hex; listHash: Hex }): Promise<boolean> {
  return verifyTypedData({
    address: input.creator,
    domain: portusSigningDomain(input.chainId, input.factory),
    types: WHITELIST_AUTH_TYPES,
    primaryType: "WhitelistAuthorization",
    message: { token: input.token, root: input.root, listHash: input.listHash, nonce: input.nonce },
    signature: input.signature,
  });
}
