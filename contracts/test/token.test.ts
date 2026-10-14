import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toFunctionSelector, type Abi, type AbiFunction } from "viem";
import { launchTokenAbi } from "@portus/shared";
import { deployPortus, S } from "./helpers/fixture.js";

describe("LaunchToken", () => {
  it("T-01 fixed supply, 18 decimals, held entirely by the sale", async () => {
    const f = await deployPortus();
    const l = await f.launch({ name: "Harbor", symbol: "HBR" });
    assert.equal(await l.token.read.name(), "Harbor");
    assert.equal(await l.token.read.symbol(), "HBR");
    assert.equal(await l.token.read.decimals(), 18);
    assert.equal(await l.token.read.totalSupply(), S);
    assert.equal(await l.token.read.balanceOf([l.sale.address]), S);
  });

  it("T-02 exposes no owner, mint, pause or blacklist entry point", () => {
    const abi = launchTokenAbi as Abi;
    const names = new Set(
      abi.filter((x): x is AbiFunction => x.type === "function").map((x) => x.name),
    );
    for (const forbidden of ["owner", "mint", "pause", "unpause", "transferOwnership", "blacklist", "setFee"]) {
      assert.equal(names.has(forbidden), false, `${forbidden} must not exist`);
    }
    const selectors = abi
      .filter((x): x is AbiFunction => x.type === "function")
      .map((x) => toFunctionSelector(x));
    assert.equal(selectors.includes(toFunctionSelector("function mint(address,uint256)")), false);
  });

  it("T-03 burn lowers totalSupply", async () => {
    const f = await deployPortus();
    const token = await f.viem.deployContract("LaunchToken", ["B", "B", 1000n, f.a.account.address]);
    await token.write.burn([400n], { account: f.a.account });
    assert.equal(await token.read.totalSupply(), 600n);
  });
});
