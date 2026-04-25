const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", hre.ethers.formatEther(balance), "OG");

  const Factory = await hre.ethers.getContractFactory("AgentNFT");
  const nft = await Factory.deploy();
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  const tx = nft.deploymentTransaction();
  console.log("AgentNFT deployed to:", address);
  console.log("Deployment tx       :", tx.hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
