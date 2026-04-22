const hre = require("hardhat");
const { deployStack } = require("./deploy-shared");

async function main() {
  const outputName = hre.network.name === "baseSepolia" ? "base-sepolia.json" : `${hre.network.name}.json`;
  const output = await deployStack(hre, {
    envLabel: "testnet",
    outputName
  });

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
