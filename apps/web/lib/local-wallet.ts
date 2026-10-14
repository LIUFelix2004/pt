import { createConnector, type CreateConnectorFn } from "wagmi";
import { mock } from "wagmi/connectors";
import type { Address } from "viem";

/**
 * LOCAL CHAIN ONLY — demo wallets.
 *
 * A Hardhat node keeps its default accounts unlocked, so wagmi's mock connector
 * can forward eth_sendTransaction / eth_signTypedData_v4 straight to the node and
 * the whole flow (create, subscribe, finalize, claim, trade) works without a
 * browser extension. These keys are public; on any other chain these connectors
 * are never registered (see providers.tsx).
 */
export const LOCAL_ACCOUNTS: ReadonlyArray<{ index: number; address: Address }> = [
  { index: 0, address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  { index: 1, address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  { index: 2, address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  { index: 3, address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
  { index: 4, address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" },
];

/** One connector per account, each with its own id so they can coexist. */
export function localWalletConnectors(): CreateConnectorFn[] {
  return LOCAL_ACCOUNTS.map(({ index, address }) =>
    createConnector((config) => ({
      ...mock({ accounts: [address], features: { reconnect: true } })(config),
      id: `local-${index}`,
      name: `Hardhat #${index}`,
    })),
  );
}
