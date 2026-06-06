import { expect }   from "chai";
import { ethers }   from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ReserveVault — Proof of Reserve", function () {

  let vault:     any;
  let mockToken: any;
  let admin:     SignerWithAddress;
  let custodian: SignerWithAddress;
  let auditor:   SignerWithAddress;
  let user1:     SignerWithAddress;

  const TOKEN_INRX  = ethers.keccak256(ethers.toUtf8Bytes("INRX"));
  const TOKEN_EGOLD = ethers.keccak256(ethers.toUtf8Bytes("EGOLD"));

  const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
  const AUDITOR_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("AUDITOR_ROLE"));

  const AssetType = { INR_BANK: 0, GOLD_VAULT: 1, SILVER_VAULT: 2, GOVT_SEC: 3, USDT: 4 };

  beforeEach(async function () {
    [admin, custodian, auditor, user1] = await ethers.getSigners();

    const Mock  = await ethers.getContractFactory("MockMintableToken");
    mockToken   = await Mock.deploy();
    await mockToken.waitForDeployment();

    const Vault = await ethers.getContractFactory("ReserveVault");
    vault = await Vault.deploy(admin.address);
    await vault.waitForDeployment();

    // Grant roles
    await vault.connect(admin).grantRole(CUSTODIAN_ROLE, custodian.address);
    await vault.connect(admin).grantRole(AUDITOR_ROLE,   auditor.address);

    // Register token contract
    await vault.connect(admin).setTokenContract(TOKEN_INRX, await mockToken.getAddress());
  });

  describe("Deployment", function () {
    it("grants roles to admin", async function () {
      expect(await vault.hasRole(CUSTODIAN_ROLE, admin.address)).to.be.true;
      expect(await vault.hasRole(AUDITOR_ROLE,   admin.address)).to.be.true;
    });
  });

  describe("Reserve management", function () {
    it("custodian can add a reserve entry", async function () {
      const amount = ethers.parseUnits("1000000", 6); // 1M INR
      await expect(
        vault.connect(custodian).addReserve(
          TOKEN_INRX,
          AssetType.INR_BANK,
          amount,
          "HDFC Bank Mumbai",
          "QmXyz123abc..."
        )
      ).to.emit(vault, "ReserveAdded");
    });

    it("non-custodian cannot add reserve", async function () {
      await expect(
        vault.connect(user1).addReserve(
          TOKEN_INRX, AssetType.INR_BANK, 100n, "Fake", "hash"
        )
      ).to.be.reverted;
    });

    it("getTotalReserve sums all active entries", async function () {
      const a1 = ethers.parseUnits("1000000", 6);
      const a2 = ethers.parseUnits("500000",  6);

      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, a1, "HDFC", "hash1"
      );
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.GOVT_SEC, a2, "RBI Bonds", "hash2"
      );

      const total = await vault.getTotalReserve(TOKEN_INRX);
      expect(total).to.equal(a1 + a2);
    });

    it("deactivated entry is excluded from total", async function () {
      const amount = ethers.parseUnits("1000000", 6);
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, amount, "HDFC", "hash1"
      );
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, amount, "SBI", "hash2"
      );

      await vault.connect(custodian).deactivateReserve(0, "Funds moved");

      const total = await vault.getTotalReserve(TOKEN_INRX);
      expect(total).to.equal(amount); // only second entry counts
    });

    it("cannot deactivate already inactive entry", async function () {
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, 100n, "HDFC", "hash"
      );
      await vault.connect(custodian).deactivateReserve(0, "reason");
      await expect(
        vault.connect(custodian).deactivateReserve(0, "again")
      ).to.be.revertedWith("ReserveVault: already inactive");
    });
  });

  describe("Proof of Reserve calculation", function () {
    it("returns correct backing ratio when fully backed (100% = 10000 bps)", async function () {
      const supply = ethers.parseUnits("1000000", 6);  // 1M INRX minted
      const reserve = ethers.parseUnits("1000000", 6); // 1M INR in vault

      await mockToken.mint(user1.address, supply);
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, reserve, "HDFC", "hash"
      );

      const ratio = await vault.getBackingRatio(TOKEN_INRX);
      expect(ratio).to.equal(10000n); // exactly 100.00%
    });

    it("returns > 10000 when over-collateralized", async function () {
      const supply  = ethers.parseUnits("1000000", 6);
      const reserve = ethers.parseUnits("1050000", 6); // 105% backed

      await mockToken.mint(user1.address, supply);
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, reserve, "HDFC", "hash"
      );

      const ratio = await vault.getBackingRatio(TOKEN_INRX);
      expect(ratio).to.equal(10500n); // 105.00%
    });

    it("getProofOfReserve returns isFullyBacked=true when >= 100%", async function () {
      const amount = ethers.parseUnits("500000", 6);
      await mockToken.mint(user1.address, amount);
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, amount, "HDFC", "hash"
      );

      const proof = await vault.getProofOfReserve(TOKEN_INRX);
      expect(proof.isFullyBacked).to.be.true;
      expect(proof.totalReserve).to.equal(amount);
      expect(proof.circulatingSupply).to.equal(amount);
    });

    it("getProofOfReserve returns isFullyBacked=false when under-collateralized", async function () {
      const supply  = ethers.parseUnits("1000000", 6);
      const reserve = ethers.parseUnits("900000",  6); // only 90% backed

      await mockToken.mint(user1.address, supply);
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, reserve, "HDFC", "hash"
      );

      const proof = await vault.getProofOfReserve(TOKEN_INRX);
      expect(proof.isFullyBacked).to.be.false;
      expect(proof.backingRatioBps).to.equal(9000n); // 90%
    });

    it("returns max uint256 ratio when nothing is minted", async function () {
      // No minting done — supply is 0
      const reserve = ethers.parseUnits("1000000", 6);
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, reserve, "HDFC", "hash"
      );
      const ratio = await vault.getBackingRatio(TOKEN_INRX);
      expect(ratio).to.equal(ethers.MaxUint256);
    });
  });

  describe("Audit records", function () {
    it("auditor can record an audit", async function () {
      const reserveAmt = ethers.parseUnits("1000000", 6);
      const supplyAmt  = ethers.parseUnits("1000000", 6);

      await expect(
        vault.connect(auditor).recordAudit(
          TOKEN_INRX,
          reserveAmt,
          supplyAmt,
          "Deloitte India",
          "QmAudit123...",
          "Full reserve audit passed"
        )
      ).to.emit(vault, "AuditRecorded");
    });

    it("getAuditHistory returns audit records for token", async function () {
      await vault.connect(auditor).recordAudit(
        TOKEN_INRX, 1000000n, 1000000n, "Deloitte", "hash1", "Q1 audit"
      );
      await vault.connect(auditor).recordAudit(
        TOKEN_INRX, 2000000n, 2000000n, "Deloitte", "hash2", "Q2 audit"
      );
      // Different token — should NOT appear in INRX history
      await vault.connect(auditor).recordAudit(
        TOKEN_EGOLD, 500000n, 500000n, "KPMG", "hash3", "Gold audit"
      );

      const history = await vault.getAuditHistory(TOKEN_INRX);
      expect(history.length).to.equal(2);
      expect(history[0].auditorName).to.equal("Deloitte");
    });

    it("non-auditor cannot record audit", async function () {
      await expect(
        vault.connect(user1).recordAudit(
          TOKEN_INRX, 1000000n, 1000000n, "Fake Auditor", "hash", "notes"
        )
      ).to.be.reverted;
    });

    it("proof shows last audit timestamp and report hash", async function () {
      await vault.connect(auditor).recordAudit(
        TOKEN_INRX, 1000000n, 1000000n, "Deloitte", "QmReport123", "Annual audit"
      );

      const proof = await vault.getProofOfReserve(TOKEN_INRX);
      expect(proof.lastAuditTimestamp).to.be.gt(0);
      expect(proof.lastAuditReport).to.equal("QmReport123");
    });
  });

  describe("Active reserves listing", function () {
    it("getActiveReserves returns only active entries", async function () {
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, 1000000n, "HDFC", "h1"
      );
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.GOVT_SEC, 500000n, "RBI", "h2"
      );
      await vault.connect(custodian).addReserve(
        TOKEN_INRX, AssetType.INR_BANK, 200000n, "ICICI", "h3"
      );

      // Deactivate middle entry
      await vault.connect(custodian).deactivateReserve(1, "bond matured");

      const active = await vault.getActiveReserves(TOKEN_INRX);
      expect(active.length).to.equal(2);
      expect(active[0].custodian).to.equal("HDFC");
      expect(active[1].custodian).to.equal("ICICI");
    });
  });
});
