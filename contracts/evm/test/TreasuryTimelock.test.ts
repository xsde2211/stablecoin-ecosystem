import { expect }   from "chai";
import { ethers }   from "hardhat";
import { time }     from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("TreasuryTimelock", function () {

  let treasury:  any;
  let mockToken: any;
  let admin:     SignerWithAddress;
  let signer1:   SignerWithAddress;
  let signer2:   SignerWithAddress;
  let signer3:   SignerWithAddress;
  let guardian:  SignerWithAddress;
  let user1:     SignerWithAddress;

  const TOKEN_INRX    = ethers.keccak256(ethers.toUtf8Bytes("INRX"));
  const TIMELOCK_DELAY = 12 * 3600; // 12 hours
  const REQUIRED_SIGS  = 2;

  beforeEach(async function () {
    [admin, signer1, signer2, signer3, guardian, user1] = await ethers.getSigners();

    // Deploy a simple mock token for testing
    const Mock = await ethers.getContractFactory("MockMintableToken");
    mockToken = await Mock.deploy();
    await mockToken.waitForDeployment();

    // Deploy TreasuryTimelock
    const T = await ethers.getContractFactory("TreasuryTimelock");
    treasury = await T.deploy(
      [signer1.address, signer2.address, signer3.address],
      REQUIRED_SIGS,
      TIMELOCK_DELAY,
      guardian.address
    );
    await treasury.waitForDeployment();

    // Register token
    await treasury.connect(admin).registerToken(TOKEN_INRX, await mockToken.getAddress());

    // Grant treasury the minter role on mock token
    await mockToken.grantMinter(await treasury.getAddress());
  });

  describe("Deployment", function () {
    it("sets required signatures correctly", async function () {
      expect(await treasury.requiredSignatures()).to.equal(REQUIRED_SIGS);
    });

    it("sets timelock delay correctly", async function () {
      expect(await treasury.timelockDelay()).to.equal(TIMELOCK_DELAY);
    });

    it("grants SIGNER_ROLE to all signers", async function () {
      const SIGNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SIGNER_ROLE"));
      expect(await treasury.hasRole(SIGNER_ROLE, signer1.address)).to.be.true;
      expect(await treasury.hasRole(SIGNER_ROLE, signer2.address)).to.be.true;
      expect(await treasury.hasRole(SIGNER_ROLE, signer3.address)).to.be.true;
    });

    it("grants GUARDIAN_ROLE to guardian", async function () {
      const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
      expect(await treasury.hasRole(GUARDIAN_ROLE, guardian.address)).to.be.true;
    });
  });

  describe("Propose", function () {
    it("signer can propose a mint operation", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await expect(
        treasury.connect(signer1).propose(
          TOKEN_INRX, 0 /* MINT */, user1.address, amount, "KYC approved mint"
        )
      ).to.emit(treasury, "OperationProposed");
    });

    it("proposer auto-signs — approvals start at 1", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await treasury.connect(signer1).propose(TOKEN_INRX, 0, user1.address, amount, "test");
      const op = await treasury.getOperation(0);
      expect(op.approvals).to.equal(1);
    });

    it("non-signer cannot propose", async function () {
      await expect(
        treasury.connect(user1).propose(TOKEN_INRX, 0, user1.address, 100n, "test")
      ).to.be.reverted;
    });

    it("reverts for unregistered token", async function () {
      const FAKE_TOKEN = ethers.keccak256(ethers.toUtf8Bytes("FAKE"));
      await expect(
        treasury.connect(signer1).propose(FAKE_TOKEN, 0, user1.address, 100n, "test")
      ).to.be.revertedWith("Timelock: token not registered");
    });
  });

  describe("Sign & Queue", function () {
    let opId: bigint;

    beforeEach(async function () {
      const amount = ethers.parseUnits("1000", 6);
      const tx = await treasury.connect(signer1).propose(
        TOKEN_INRX, 0, user1.address, amount, "test"
      );
      opId = 0n;
    });

    it("second signer triggers queuing (2-of-3 threshold)", async function () {
      await expect(treasury.connect(signer2).sign(opId))
        .to.emit(treasury, "OperationQueued");

      const op = await treasury.getOperation(opId);
      expect(op.status).to.equal(2); // QUEUED
    });

    it("signer cannot sign twice", async function () {
      await expect(treasury.connect(signer1).sign(opId))
        .to.be.revertedWith("Timelock: already signed");
    });

    it("non-signer cannot sign", async function () {
      await expect(treasury.connect(user1).sign(opId)).to.be.reverted;
    });

    it("hasSigned returns correct values", async function () {
      expect(await treasury.hasSigned(opId, signer1.address)).to.be.true;
      expect(await treasury.hasSigned(opId, signer2.address)).to.be.false;
    });
  });

  describe("Execute after timelock", function () {
    let opId: bigint;
    const mintAmount = ethers.parseUnits("1000", 6);

    beforeEach(async function () {
      await treasury.connect(signer1).propose(TOKEN_INRX, 0, user1.address, mintAmount, "test");
      opId = 0n;
      await treasury.connect(signer2).sign(opId); // reaches threshold → QUEUED
    });

    it("cannot execute before delay passes", async function () {
      await expect(treasury.execute(opId))
        .to.be.revertedWith("Timelock: delay not passed");
    });

    it("anyone can execute after delay passes", async function () {
      await time.increase(TIMELOCK_DELAY + 1);
      await expect(treasury.connect(user1).execute(opId))
        .to.emit(treasury, "OperationExecuted");
      expect(await mockToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("getRemainingDelay returns correct value", async function () {
      const remaining = await treasury.getRemainingDelay(opId);
      expect(remaining).to.be.gt(0);
      expect(remaining).to.be.lte(TIMELOCK_DELAY);
    });

    it("getRemainingDelay returns 0 after delay passes", async function () {
      await time.increase(TIMELOCK_DELAY + 1);
      expect(await treasury.getRemainingDelay(opId)).to.equal(0);
    });
  });

  describe("Cancel (Guardian)", function () {
    let opId: bigint;

    beforeEach(async function () {
      await treasury.connect(signer1).propose(
        TOKEN_INRX, 0, user1.address, ethers.parseUnits("1000", 6), "test"
      );
      opId = 0n;
    });

    it("guardian can cancel pending operation", async function () {
      await expect(treasury.connect(guardian).cancel(opId, "suspicious"))
        .to.emit(treasury, "OperationCancelled");

      const op = await treasury.getOperation(opId);
      expect(op.status).to.equal(4); // CANCELLED
    });

    it("guardian can cancel queued operation within timelock window", async function () {
      await treasury.connect(signer2).sign(opId); // queue it
      await expect(treasury.connect(guardian).cancel(opId, "malicious"))
        .to.emit(treasury, "OperationCancelled");
    });

    it("cancelled operation cannot be executed", async function () {
      await treasury.connect(signer2).sign(opId);
      await treasury.connect(guardian).cancel(opId, "cancelled");
      await time.increase(TIMELOCK_DELAY + 1);
      await expect(treasury.execute(opId))
        .to.be.revertedWith("Timelock: not queued");
    });

    it("non-guardian cannot cancel", async function () {
      await expect(treasury.connect(user1).cancel(opId, "test"))
        .to.be.reverted;
    });
  });

  describe("Daily Mint Limits", function () {
    it("enforces daily mint limit", async function () {

    const now = await time.latest();
    const nextDayStart = Math.floor(now / 86400 + 1) * 86400;
    await time.increaseTo(nextDayStart + 3600); 

    const DAILY_LIMIT = ethers.parseUnits("1000", 6);
    await treasury.connect(admin).setDailyMintLimit(TOKEN_INRX, DAILY_LIMIT);

    const amount1 = ethers.parseUnits("600", 6);
    const amount2 = ethers.parseUnits("600", 6);

    await treasury.connect(signer1).propose(
    TOKEN_INRX, 0, user1.address, amount1, "first"
    );
    await treasury.connect(signer2).sign(0n);

    await time.increase(3600);

    await treasury.connect(signer1).propose(
    TOKEN_INRX, 0, user1.address, amount2, "second"
    );
    await treasury.connect(signer2).sign(1n);

    await time.increase(11 * 3600 + 1);
    await treasury.execute(0n);

    await time.increase(3600);

    await expect(
    treasury.execute(1n)
    ).to.be.revertedWith("Timelock: daily mint limit exceeded");
    });
  });
});
