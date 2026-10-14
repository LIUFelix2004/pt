// Regenerates packages/shared/src/abi.ts from Hardhat artifacts.
// Run after any contract change: npm run export-abi -w @portus/contracts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = resolve(HERE, "..");
const OUT = resolve(HERE, "../../packages/shared/src/abi.ts");

const targets = [
  ["portusFactoryAbi", "PortusFactory"],
  ["portusSaleAbi", "PortusSale"],
  ["portusPoolAbi", "PortusPool"],
  ["portusLockerAbi", "PortusLocker"],
  ["portusFeeSplitterAbi", "PortusFeeSplitter"],
  ["portusTreasuryAbi", "PortusTreasury"],
  ["portusDistributorAbi", "PortusDistributor"],
  ["portusFlywheelAbi", "PortusFlywheel"],
  ["launchTokenAbi", "LaunchToken"],
  ["portusMintTokenAbi", "PortusMintToken"],
  ["portusTaxPoolAbi", "PortusTaxPool"],
  ["portusEmissionAbi", "PortusEmission"],
];

let out = `// GENERATED FILE — do not edit by hand.
// Source: contracts/artifacts. Regenerate with \`npm run export-abi -w @portus/contracts\`.
`;

for (const [exportName, contract] of targets) {
  const path = resolve(CONTRACTS, `artifacts/contracts/${contract}.sol/${contract}.json`);
  const { abi } = JSON.parse(readFileSync(path, "utf8"));
  out += `\nexport const ${exportName} = ${JSON.stringify(abi, null, 2)} as const;\n`;
}

writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
