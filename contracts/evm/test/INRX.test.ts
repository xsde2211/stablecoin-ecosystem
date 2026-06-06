import { expect }          from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { INRX }             from "../typechain-types";

describe("INRX — e-Rupee Stablecoin", function () {

  let inrx:      INRX;
  let admin:     SignerWithAddress;
  let minter:    SignerWithAddress;
  let burner:    SignerWithAddress;
  let treasury:  SignerWithAddress;
  let user1:     SignerWithAddress;
  let user2:     SignerWithAddress;
  let blacklisted: SignerWithAddress;

  const MINTER_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const FREEZER_ROLE     = ethers.keccak256(ethers.toUtf8Bytes("FREEZER_ROLE"));
  const BLACKLISTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BLACKLISTER_ROLE"));
  const TREASURY_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("TREASURY_ROLE"));
  const UPGRADER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE"));

  const MINT_CAP = ethers.parseUnits("1000000000", 6); // 1B INRX

  beforeEach(async function () {
    [admin, minter, burner, treasury, user1, user2, blacklisted] = await ethers.getSigners();

    const INRX_F = await ethers.getContractFactory("INRX");
    inrx = await upgrades.deployProxy(
      INRX_F,
      [admin.address, minter.address, treasury.address, MINT_CAP],
      { initializer: "initialize", kind: "uups" }
    ) as unknown as INRX;
    await inrx.waitForDeployment();

    // Grant burner role
    await inrx.connect(admin).grantRole(BURNER_ROLE, burner.address);
    await inrx.connect(admin).grantRole(BLACKLISTER_ROLE, admin.address);
    await inrx.connect(admin).grantRole(FREEZER_ROLE, admin.address);
  });

  // ─── Deployment ─────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should have correct name and symbol", async function () {
      expect(await inrx.name()).to.equal("e-Rupee Stablecoin");
      expect(await inrx.symbol()).to.equal("INRX");
    });

    it("should have 6 decimals", async function () {
      expect(await inrx.decimals()).to.equal(6);
    });

    it("should set correct mint cap", async function () {
      expect(await inrx.mintCap()).to.equal(MINT_CAP);
    });

    it("should assign roles correctly", async function () {
      expect(await inrx.hasRole(MINTER_ROLE,  minter.address)).to.be.true;
      expect(await inrx.hasRole(TREASURY_ROLE, treasury.address)).to.be.true;
      expect(await inrx.hasRole(UPGRADER_ROLE, admin.address)).to.be.true;
    });

    it("should start with zero supply", async function () {
      expect(await inrx.totalSupply()).to.equal(0);
    });
  });

  // ─── Minting ────────────────────────────────────────────────────────────

  describe("Minting", function () {
    it("should mint tokens correctly", async function () {
      const amount = ethers.parseUnits("1000", 6); // 1000 INRX
      await inrx.connect(minter).mint(user1.address, amount, "KYC approved");
      expect(await inrx.balanceOf(user1.address)).to.equal(amount);
      expect(await inrx.totalSupply()).to.equal(amount);
    });

    it("should track totalMinted", async function () {
      const amount = ethers.parseUnits("500", 6);
      await inrx.connect(minter).mint(user1.address, amount, "test");
      expect(await inrx.totalMinted()).to.equal(amount);
    });

    it("should revert if exceeds mint cap", async function () {
      const overCap = MINT_CAP + 1n;
      await expect(
        inrx.connect(minter).mint(user1.address, overCap, "test")
      ).to.be.revertedWith("INRX: mint cap exceeded");
    });

    it("should revert if minting to blacklisted address", async function () {
      await inrx.connect(admin).blacklist(blacklisted.address, true);
      await expect(
        inrx.connect(minter).mint(blacklisted.address, ethers.parseUnits("100", 6), "test")
      ).to.be.revertedWith("INRX: recipient blacklisted");
    });

    it("should revert if minting to frozen address", async function () {
      await inrx.connect(admin).freeze(user1.address, true);
      await expect(
        inrx.connect(minter).mint(user1.address, ethers.parseUnits("100", 6), "test")
      ).to.be.revertedWith("INRX: recipient frozen");
    });

    it("should revert if caller lacks MINTER_ROLE", async function () {
      await expect(
        inrx.connect(user1).mint(user2.address, ethers.parseUnits("100", 6), "test")
      ).to.be.reverted;
    });
  });

  // ─── Burning ────────────────────────────────────────────────────────────

  describe("Burning", function () {
    beforeEach(async function () {
      await inrx.connect(minter).mint(user1.address, ethers.parseUnits("1000", 6), "setup");
    });

    it("should burn tokens correctly", async function () {
      const burnAmt = ethers.parseUnits("300", 6);
      await inrx.connect(burner).burn(user1.address, burnAmt, "redemption");
      expect(await inrx.balanceOf(user1.address)).to.equal(ethers.parseUnits("700", 6));
    });

    it("should track totalBurned", async function () {
      const burnAmt = ethers.parseUnits("200", 6);
      await inrx.connect(burner).burn(user1.address, burnAmt, "test");
      expect(await inrx.totalBurned()).to.equal(burnAmt);
    });

    it("should calculate circulatingSupply correctly", async function () {
      const burnAmt = ethers.parseUnits("100", 6);
      await inrx.connect(burner).burn(user1.address, burnAmt, "test");
      expect(await inrx.circulatingSupply()).to.equal(ethers.parseUnits("900", 6));
    });

    it("should allow self-burn via burnFrom", async function () {
      const burnAmt = ethers.parseUnits("100", 6);
      await inrx.connect(user1).burnFrom(burnAmt, "self-burn");
      expect(await inrx.balanceOf(user1.address)).to.equal(ethers.parseUnits("900", 6));
    });
  });

  // ─── Transfers ──────────────────────────────────────────────────────────

  describe("Transfers", function () {
    const amount = ethers.parseUnits("1000", 6);

    beforeEach(async function () {
      await inrx.connect(minter).mint(user1.address, amount, "setup");
    });

    it("should transfer tokens correctly", async function () {
      const send = ethers.parseUnits("300", 6);
      await inrx.connect(user1).transfer(user2.address, send);
      expect(await inrx.balanceOf(user2.address)).to.equal(send);
      expect(await inrx.balanceOf(user1.address)).to.equal(ethers.parseUnits("700", 6));
    });

    it("should block transfer FROM blacklisted address", async function () {
      await inrx.connect(admin).blacklist(user1.address, true);
      await expect(
        inrx.connect(user1).transfer(user2.address, ethers.parseUnits("100", 6))
      ).to.be.revertedWith("INRX: sender blacklisted");
    });

    it("should block transfer TO blacklisted address", async function () {
      await inrx.connect(admin).blacklist(user2.address, true);
      await expect(
        inrx.connect(user1).transfer(user2.address, ethers.parseUnits("100", 6))
      ).to.be.revertedWith("INRX: recipient blacklisted");
    });

    it("should block transfer FROM frozen address", async function () {
      await inrx.connect(admin).freeze(user1.address, true);
      await expect(
        inrx.connect(user1).transfer(user2.address, ethers.parseUnits("100", 6))
      ).to.be.revertedWith("INRX: sender frozen");
    });
  });

  // ─── Compliance controls ────────────────────────────────────────────────

  describe("Compliance — Blacklist & Freeze", function () {
    it("should blacklist and check correctly", async function () {
      expect(await inrx.isBlacklisted(user1.address)).to.be.false;
      await inrx.connect(admin).blacklist(user1.address, true);
      expect(await inrx.isBlacklisted(user1.address)).to.be.true;
      await inrx.connect(admin).blacklist(user1.address, false);
      expect(await inrx.isBlacklisted(user1.address)).to.be.false;
    });

    it("should freeze and check correctly", async function () {
      expect(await inrx.isFrozen(user1.address)).to.be.false;
      await inrx.connect(admin).freeze(user1.address, true);
      expect(await inrx.isFrozen(user1.address)).to.be.true;
    });

    it("should revert blacklist if caller lacks BLACKLISTER_ROLE", async function () {
      await expect(
        inrx.connect(user1).blacklist(user2.address, true)
      ).to.be.reverted;
    });
  });

  // ─── Pause ──────────────────────────────────────────────────────────────

  describe("Pause", function () {
    beforeEach(async function () {
      await inrx.connect(minter).mint(user1.address, ethers.parseUnits("1000", 6), "setup");
    });

    it("should pause and unpause", async function () {
      await inrx.connect(admin).pause();
      expect(await inrx.paused()).to.be.true;

      await expect(
        inrx.connect(user1).transfer(user2.address, ethers.parseUnits("100", 6))
      ).to.be.reverted;

      await inrx.connect(admin).unpause();
      expect(await inrx.paused()).to.be.false;
    });

    it("should block minting when paused", async function () {
      await inrx.connect(admin).pause();
      await expect(
        inrx.connect(minter).mint(user2.address, ethers.parseUnits("100", 6), "test")
      ).to.be.reverted;
    });

    it("should revert pause if caller is not admin", async function () {
      await expect(inrx.connect(user1).pause()).to.be.reverted;
    });
  });

  // ─── Mint cap management ────────────────────────────────────────────────

  describe("Mint Cap", function () {
    it("should update mint cap via treasury role", async function () {
      const newCap = ethers.parseUnits("500000000", 6); // 500M
      await inrx.connect(treasury).setMintCap(newCap);
      expect(await inrx.mintCap()).to.equal(newCap);
    });

    it("should revert setMintCap if caller lacks TREASURY_ROLE", async function () {
      await expect(
        inrx.connect(user1).setMintCap(ethers.parseUnits("100", 6))
      ).to.be.reverted;
    });
  });

  // ─── Events ─────────────────────────────────────────────────────────────

  describe("Events", function () {
    it("should emit Mint event", async function () {
      const amount = ethers.parseUnits("100", 6);
      await expect(inrx.connect(minter).mint(user1.address, amount, "test"))
        .to.emit(inrx, "Mint")
        .withArgs(user1.address, amount, "test");
    });

    it("should emit Burn event", async function () {
      const amount = ethers.parseUnits("100", 6);
      await inrx.connect(minter).mint(user1.address, amount, "setup");
      await expect(inrx.connect(burner).burn(user1.address, amount, "redeem"))
        .to.emit(inrx, "Burn")
        .withArgs(user1.address, amount, "redeem");
    });

    it("should emit Blacklisted event", async function () {
      await expect(inrx.connect(admin).blacklist(user1.address, true))
        .to.emit(inrx, "Blacklisted")
        .withArgs(user1.address, true);
    });

    it("should emit MintCapUpdated event", async function () {
      const newCap = ethers.parseUnits("500000000", 6);
      await expect(inrx.connect(treasury).setMintCap(newCap))
        .to.emit(inrx, "MintCapUpdated")
        .withArgs(newCap);
    });
  });
});
