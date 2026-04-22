const hre = require("hardhat");
const { deployStack } = require("./deploy-shared");

async function main() {
  const output = await deployStack(hre, {
    envLabel: "local",
    outputName: "localhost.json"
  });

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
