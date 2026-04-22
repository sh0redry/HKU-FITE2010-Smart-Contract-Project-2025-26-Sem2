const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsuranceVault Unit", function () {
  async function deployFixture() {
    const [owner, lp, outsider] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const InsuranceVault = await ethers.getContractFactory("InsuranceVault");

    const token = await MockUSDC.deploy(owner.address);
    await token.waitForDeployment();
    const vault = await InsuranceVault.deploy(owner.address, await token.getAddress());
    await vault.waitForDeployment();

    await token.mint(lp.address, ethers.parseUnits("10000", 6));
    await vault.setPolicyManager(owner.address);

    return { owner, lp, outsider, token, vault };
  }

  it("mints initial shares 1:1 on first deposit", async function () {
    const { lp, token, vault } = await deployFixture();
    const amount = ethers.parseUnits("1000", 6);

    await token.connect(lp).approve(await vault.getAddress(), amount);
    await vault.connect(lp).deposit(amount);

    expect(await vault.totalAssets()).to.equal(amount);
    expect(await vault.totalShares()).to.equal(amount);
    expect(await vault.shareBalance(lp.address)).to.equal(amount);
  });

  it("prevents withdrawing reserved liquidity", async function () {
    const { owner, lp, token, vault } = await deployFixture();
    const amount = ethers.parseUnits("1000", 6);

    await token.connect(lp).approve(await vault.getAddress(), amount);
    await vault.connect(lp).deposit(amount);
    await vault.connect(owner).reserveLiquidity(ethers.parseUnits("900", 6));

    await expect(vault.connect(lp).withdraw(amount)).to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
  });

  it("tracks premiums and claims consistently", async function () {
    const { owner, lp, outsider, token, vault } = await deployFixture();
    const deposit = ethers.parseUnits("1000", 6);
    const premium = ethers.parseUnits("120", 6);
    const claim = ethers.parseUnits("80", 6);

    await token.connect(lp).approve(await vault.getAddress(), deposit);
    await vault.connect(lp).deposit(deposit);
    await token.mint(outsider.address, premium);
    await token.connect(outsider).approve(await vault.getAddress(), premium);

    await vault.connect(owner).reserveLiquidity(ethers.parseUnits("200", 6));
    await vault.connect(owner).collectPremium(outsider.address, premium);
    await vault.connect(owner).payClaim(outsider.address, claim);

    expect(await vault.realizedPremiums()).to.equal(premium);
    expect(await vault.totalClaimsPaid()).to.equal(claim);
    expect(await vault.netUnderwritingResult()).to.equal(premium - claim);
  });
});
