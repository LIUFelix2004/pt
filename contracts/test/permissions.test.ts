import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress, type Abi, type AbiFunction } from "viem";
import {
  portusDistributorAbi,
  portusFeeSplitterAbi,
  portusFlywheelAbi,
  portusTreasuryAbi,
  launchTokenAbi,
  portusFactoryAbi,
  portusLockerAbi,
  portusPoolAbi,
  portusSaleAbi,
} from "@portus/shared";
import { deployPortus, expectCustom } from "./helpers/fixture.js";

const ALL: Record<string, Abi> = {
  PortusFactory: portusFactoryAbi,
  PortusSale: portusSaleAbi,
  PortusPool: portusPoolAbi,
  PortusLocker: portusLockerAbi,
  PortusFeeSplitter: portusFeeSplitterAbi,
  PortusTreasury: portusTreasuryAbi,
  PortusDistributor: portusDistributorAbi,
  PortusFlywheel: portusFlywheelAbi,
  LaunchToken: launchTokenAbi,
};

const fns = (abi: Abi) => abi.filter((x): x is AbiFunction => x.type === "function");

describe("permission surface", () => {
  it("A-01 none of the removed privileged paths exist anywhere", () => {
    const forbidden = [
      /^withdrawProceeds$/,
      /^reclaimUnsold$/,
      /^sweepForfeited$/,
      /^transferOwnership$/,
      /^owner$/,
      /^pause$/,
      /^upgradeTo/,
      /^mint$/,
      /^setFee/,
      /^withdraw/,
      /^execute$/,
    ];
    for (const [name, abi] of Object.entries(ALL)) {
      for (const fn of fns(abi)) {
        for (const re of forbidden) assert.ok(!re.test(fn.name), `${name}.${fn.name} must not exist`);
      }
    }
  });

  it("A-03 the fund-holding modules expose only their documented entry points", () => {
    const writes = (abi: Abi) =>
      fns(abi)
        .filter((f) => f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name)
        .sort();
    // No admin, no sweep, no arbitrary transfer anywhere: only these.
    assert.deepEqual(writes(portusFeeSplitterAbi), ["claim", "claimFor", "onFee", "registerPool"]);
    assert.deepEqual(writes(portusTreasuryAbi), ["executeBuyback", "fundRewards", "startObservation"]);
    assert.deepEqual(writes(portusDistributorAbi), [
      "bindReferrer",
      "claim",
      "claimFor",
      "fundTreasury",
      "notifyIncentive",
      "publishRoot",
      "registerLaunch",
    ]);
    assert.deepEqual(writes(portusFlywheelAbi), ["checkpoint", "executeRound", "nominate", "startRound"]);
    assert.deepEqual(writes(portusLockerAbi), ["notifyLocked", "registerPool"]);
  });

  it("A-02 every restricted function rejects outsiders", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    const o = { account: f.outsider.account };
    const x = f.outsider.account.address;
    await expectCustom(f.viem, f.factory.write.setQuoteAsset([x, true, false, 1n, 2n, zeroAddress, 0n], o), f.factory, "NotQuoteAdmin");
    await expectCustom(f.viem, l.pool.write.bindSale([x], o), l.pool, "NotFactory");
    await expectCustom(f.viem, l.pool.write.initialize([1n, 1n], o), l.pool, "NotSale");
    await expectCustom(f.viem, f.locker.write.registerPool([x, x], o), f.locker, "NotFactory");
    await expectCustom(f.viem, f.locker.write.notifyLocked([1n], o), f.locker, "UnknownPool");
    await expectCustom(f.viem, f.splitter.write.registerPool([x, x, x, x, 0, x], o), f.splitter, "NotFactory");
    await expectCustom(f.viem, f.splitter.write.onFee([1n], o), f.splitter, "UnknownPool");
    await expectCustom(f.viem, f.distributor.write.registerLaunch([x, x, x, 0, 0], o), f.distributor, "NotFactory");
    await expectCustom(f.viem, f.distributor.write.notifyIncentive([1n], o), f.distributor, "NotSale");
    await expectCustom(f.viem, f.distributor.write.fundTreasury([l.token.address, x, 1n], o), f.distributor, "NotTreasury");
    await expectCustom(f.viem, f.distributor.write.publishRoot([l.token.address, l.token.address, `0x${"00".repeat(32)}`, 0n, ""], o), f.distributor, "NotPublisher");
    await expectCustom(f.viem, l.treasury.write.fundRewards(o), l.treasury, "WrongMode");
  });
});
