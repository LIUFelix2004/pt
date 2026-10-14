// Quote-asset admission report — the docs' three checks, run before the
// quoteAdmin multisig calls setQuoteAsset.
//
//   QUOTE_ASSET=0x… npx hardhat run scripts/check-quote-asset.ts --network <net>
//   QUOTE_ASSET=0x… HOLDER=0x… (on a fork / local node) adds live transfer tests
//
// 1. Can it be frozen?  Scans the bytecode (and an EIP-1967 implementation if
//    it is a proxy) for blacklist / freeze / pause selectors. Freezable assets
//    may be listed, but must be flagged `freezable` so the UI warns loudly.
// 2. Does the balance change by itself?  Scans for rebase / mint selectors and,
//    with HOLDER on a node that allows impersonation, moves 1 unit and checks
//    the receiver gets exactly 1 (no transfer tax), then advances a day and
//    checks the balance did not drift (no rebase). Any failure ⇒ BLOCK.
// 3. Where does its price come from?  Not discoverable on-chain: the report
//    reminds the operator to pass `priceSource` explicitly.
//
// Bytecode scans are heuristics — a clean scan is necessary, not sufficient.
// The contracts also reject fee-on-transfer / rebasing assets at runtime by
// balance-difference checks on every transfer in.
import { network } from "hardhat";
import { getAddress, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";

const FREEZE = [
  "function blacklist(address)",
  "function addToBlacklist(address)",
  "function freeze(address)",
  "function freezeAccount(address)",
  "function pause()",
  "function addBlackList(address)",
  "function setBlacklisted(address,bool)",
  "function isBlacklisted(address)",
  "function isFrozen(address)",
  "function paused()",
];
const BALANCE = [
  "function rebase(uint256,int256)",
  "function rebase(int256)",
  "function mint(address,uint256)",
  "function mint(uint256)",
  "function issue(uint256)",
  "function setFee(uint256)",
  "function setTaxRate(uint256)",
  "function _taxFee()",
  "function sharesOf(address)",
];
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const has = (code: string, sig: string) => code.includes(toFunctionSelector(sig).slice(2));

async function main() {
  const asset = process.env.QUOTE_ASSET;
  if (!asset) throw new Error("set QUOTE_ASSET");
  const { viem, provider } = await network.create();
  const client = await viem.getPublicClient();
  const address = getAddress(asset) as Address;

  let code = ((await client.getCode({ address })) ?? "0x").toLowerCase();
  if (code === "0x") throw new Error(`${address} has no code`);
  const implSlot = await client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT as Hex });
  const proxy = implSlot && BigInt(implSlot) !== 0n;
  if (proxy) {
    const impl = getAddress(`0x${implSlot!.slice(-40)}`);
    code += ((await client.getCode({ address: impl })) ?? "").toLowerCase();
  }

  const erc = parseAbi([
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
  ]);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address, abi: erc, functionName: "decimals" }),
    client.readContract({ address, abi: erc, functionName: "symbol" }).catch(() => "?"),
  ]);

  const freezeHits = FREEZE.filter((s) => has(code, s));
  const balanceHits = BALANCE.filter((s) => has(code, s));
  const problems: string[] = [];
  if (decimals > 18) problems.push(`decimals ${decimals} > 18 (factory rejects)`);
  if (balanceHits.length) problems.push(`balance-changing functions present: ${balanceHits.join(", ")}`);

  let live: Record<string, unknown> = { ran: false };
  const holder = process.env.HOLDER;
  const unit = 10n ** BigInt(decimals);
  const holderBalance = holder
    ? await client.readContract({ address, abi: erc, functionName: "balanceOf", args: [getAddress(holder) as Address] })
    : 0n;
  if (holder && holderBalance < unit) {
    live = { ran: false, reason: `HOLDER has ${holderBalance} < 1 unit; pass a holder with a balance` };
  } else if (holder) {
    const from = getAddress(holder) as Address;
    const to = "0x000000000000000000000000000000000000dEaD" as Address;
    await provider.request({ method: "hardhat_impersonateAccount", params: [from] });
    await provider.request({ method: "hardhat_setBalance", params: [from, "0xde0b6b3a7640000"] });
    const before = await client.readContract({ address, abi: erc, functionName: "balanceOf", args: [to] });
    const [wallet] = await viem.getWalletClients({ account: from } as never);
    const hash = await (wallet ?? (await viem.getWalletClient(from))).writeContract({
      address,
      abi: erc,
      functionName: "transfer",
      args: [to, 10n ** BigInt(decimals)],
      account: from,
      chain: undefined,
    } as never);
    await client.waitForTransactionReceipt({ hash });
    const after = await client.readContract({ address, abi: erc, functionName: "balanceOf", args: [to] });
    const received = after - before;
    await provider.request({ method: "evm_increaseTime", params: [86_400] });
    await provider.request({ method: "evm_mine", params: [] });
    const later = await client.readContract({ address, abi: erc, functionName: "balanceOf", args: [to] });
    live = { ran: true, sent: (10n ** BigInt(decimals)).toString(), received: received.toString(), afterOneDay: later.toString() };
    if (received !== 10n ** BigInt(decimals)) problems.push("transfer tax: receiver got a different amount than sent");
    if (later !== after) problems.push("balance drifted over one day (rebasing)");
  }

  const report = {
    asset: address,
    symbol,
    decimals,
    proxy: Boolean(proxy),
    checks: {
      "1 freezable": { freezable: freezeHits.length > 0, evidence: freezeHits },
      "2 balance changes": { blocked: problems.length > 0, evidence: balanceHits, live },
      "3 price source": "not discoverable on-chain — pass priceSource to setQuoteAsset explicitly",
    },
    verdict: problems.length ? "BLOCK" : freezeHits.length ? "LIST WITH freezable=true" : "LIST",
    problems,
  };
  console.log(JSON.stringify(report, null, 2));
  if (proxy) console.log("\nNote: upgradeable proxy — its behaviour can change after listing. Review the admin.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
