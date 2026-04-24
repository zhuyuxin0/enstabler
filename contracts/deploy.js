const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", hre.ethers.formatEther(balance), "OG");

  const Oracle = await hre.ethers.getContractFactory("FlowRiskOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();

  const address = await oracle.getAddress();
  const tx = oracle.deploymentTransaction();
  console.log("FlowRiskOracle deployed to:", address);
  console.log("Deployment tx            :", tx.hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
