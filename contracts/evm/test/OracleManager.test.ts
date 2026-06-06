import { expect }   from "chai";
import { ethers }   from "hardhat";
import { time }     from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("OracleManager — Price Feed Management", function () {

  let oracle:   any;
  let admin:    SignerWithAddress;
  let oracle1:  SignerWithAddress;
  let oracle2:  SignerWithAddress;
  let oracle3:  SignerWithAddress;
  let user1:    SignerWithAddress;

  const TOKEN_EGOLD = ethers.keccak256(ethers.toUtf8Bytes("EGOLD"));
  const TOKEN_ESLVR = ethers.keccak256(ethers.toUtf8Bytes("ESLVR"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

  // ₹5,900/gram gold price with 6 decimals
  const GOLD_PRICE_1 = ethers.parseUnits("5900", 6);
  const GOLD_PRICE_2 = ethers.parseUnits("5950", 6);
  const GOLD_PRICE_3 = ethers.parseUnits("5920", 6);

  beforeEach(async function () {
    [admin, oracle1, oracle2, oracle3, user1] = await ethers.getSigners();

    const OracleM = await ethers.getContractFactory("OracleManager");
    oracle = await OracleM.deploy(admin.address);
    await oracle.waitForDeployment();

    // Register oracles for EGOLD
    await oracle.connect(admin).registerOracle(TOKEN_EGOLD, oracle1.address, "Primary Oracle");
    await oracle.connect(admin).registerOracle(TOKEN_EGOLD, oracle2.address, "Secondary Oracle");
    await oracle.connect(admin).registerOracle(TOKEN_EGOLD, oracle3.address, "Tertiary Oracle");
  });

  describe("Deployment", function () {
    it("sets stale threshold to 24 hours", async function () {
      expect(await oracle.stalePriceThreshold()).to.equal(24 * 3600);
    });

    it("sets minOracles to 1 by default", async function () {
      expect(await oracle.minOracles()).to.equal(1);
    });
  });

  describe("Oracle registration", function () {
    it("registers oracles correctly", async function () {
      expect(await oracle.isRegistered(TOKEN_EGOLD, oracle1.address)).to.be.true;
      expect(await oracle.hasRole(ORACLE_ROLE, oracle1.address)).to.be.true;
    });

    it("cannot register same oracle twice", async function () {
      await expect(
        oracle.connect(admin).registerOracle(TOKEN_EGOLD, oracle1.address, "Duplicate")
      ).to.be.revertedWith("Oracle: already registered");
    });

    it("deactivate and reactivate oracle", async function () {
      await oracle.connect(admin).deactivateOracle(TOKEN_EGOLD, oracle1.address);
      await oracle.connect(admin).reactivateOracle(TOKEN_EGOLD, oracle1.address);
      // After reactivation, oracle can update price again
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      const data = await oracle.oracleData(TOKEN_EGOLD, oracle1.address);
      expect(data.price).to.equal(GOLD_PRICE_1);
    });
  });

  describe("Price updates", function () {
    it("oracle can update price", async function () {
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      const data = await oracle.oracleData(TOKEN_EGOLD, oracle1.address);
      expect(data.price).to.equal(GOLD_PRICE_1);
    });

    it("emits PriceUpdated event", async function () {
      const tx = await oracle.connect(oracle1)
      .updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);

      await expect(tx)
      .to.emit(oracle, "PriceUpdated");
    });

    it("non-oracle cannot update price", async function () {
      await expect(
        oracle.connect(user1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1)
      ).to.be.reverted;
    });

    it("deactivated oracle cannot update price", async function () {
      await oracle.connect(admin).deactivateOracle(TOKEN_EGOLD, oracle1.address);
      await expect(
        oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1)
      ).to.be.revertedWith("Oracle: deactivated");
    });

    it("rejects zero price", async function () {
      await expect(
        oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, 0)
      ).to.be.revertedWith("Oracle: zero price");
    });

    it("admin can set manual price", async function () {
      await oracle.connect(admin).setManualPrice(TOKEN_EGOLD, oracle1.address, GOLD_PRICE_1);
      const data = await oracle.oracleData(TOKEN_EGOLD, oracle1.address);
      expect(data.price).to.equal(GOLD_PRICE_1);
    });
  });

  describe("Median price aggregation", function () {
    it("returns single oracle price correctly", async function () {
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      const [price, count] = await oracle.getPrice(TOKEN_EGOLD);
      expect(price).to.equal(GOLD_PRICE_1);
      expect(count).to.equal(1);
    });

    it("returns median of 3 prices (odd count)", async function () {
      // prices: 5900, 5920, 5950 → sorted: [5900, 5920, 5950] → median: 5920
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1); // 5900
      await oracle.connect(oracle2).updatePrice(TOKEN_EGOLD, GOLD_PRICE_2); // 5950
      await oracle.connect(oracle3).updatePrice(TOKEN_EGOLD, GOLD_PRICE_3); // 5920

      const [price, count] = await oracle.getPrice(TOKEN_EGOLD);
      expect(count).to.equal(3);
      expect(price).to.equal(GOLD_PRICE_3); // median is 5920
    });

    it("returns average of 2 prices for even count median", async function () {
      // prices: 5900, 5950 → median: (5900+5950)/2 = 5925
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1); // 5900
      await oracle.connect(oracle2).updatePrice(TOKEN_EGOLD, GOLD_PRICE_2); // 5950

      const [price, count] = await oracle.getPrice(TOKEN_EGOLD);
      expect(count).to.equal(2);
      const expected = (GOLD_PRICE_1 + GOLD_PRICE_2) / 2n;
      expect(price).to.equal(expected);
    });

    it("excludes stale prices from aggregation", async function () {
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      await oracle.connect(oracle2).updatePrice(TOKEN_EGOLD, GOLD_PRICE_2);

      // Fast-forward 25 hours — oracle1 and oracle2 prices become stale
      await time.increase(25 * 3600);

      // oracle3 updates fresh price
      await oracle.connect(oracle3).updatePrice(TOKEN_EGOLD, GOLD_PRICE_3);

      const [price, count] = await oracle.getPrice(TOKEN_EGOLD);
      expect(count).to.equal(1);  // only oracle3 is fresh
      expect(price).to.equal(GOLD_PRICE_3);
    });

    it("reverts if no valid prices available", async function () {
      // No prices set yet
      await expect(oracle.getPrice(TOKEN_EGOLD))
        .to.be.revertedWith("Oracle: insufficient valid prices");
    });

    it("getPriceSafe returns (0,0) if no valid prices", async function () {
      const [price, count] = await oracle.getPriceSafe(TOKEN_EGOLD);
      expect(price).to.equal(0);
      expect(count).to.equal(0);
    });

    it("respects minOracles requirement", async function () {
      await oracle.connect(admin).setMinOracles(2);
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      // Only 1 valid price, but minOracles = 2
      await expect(oracle.getPrice(TOKEN_EGOLD))
        .to.be.revertedWith("Oracle: insufficient valid prices");
    });
  });

  describe("getOracles view", function () {
    it("returns correct oracle info", async function () {
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);

      const { addresses, names, prices, actives } =
        await oracle.getOracles(TOKEN_EGOLD);

      expect(addresses.length).to.equal(3);
      expect(names[0]).to.equal("Primary Oracle");
      expect(prices[0]).to.equal(GOLD_PRICE_1);
      expect(actives[0]).to.be.true;
    });

    it("marks deactivated oracle correctly", async function () {
      await oracle.connect(admin).deactivateOracle(TOKEN_EGOLD, oracle1.address);
      const { actives } = await oracle.getOracles(TOKEN_EGOLD);
      expect(actives[0]).to.be.false;
    });
  });

  describe("isStale", function () {
    it("returns false for fresh price", async function () {
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      expect(await oracle.isStale(TOKEN_EGOLD, oracle1.address)).to.be.false;
    });

    it("returns true for stale price", async function () {
      await oracle.connect(oracle1).updatePrice(TOKEN_EGOLD, GOLD_PRICE_1);
      await time.increase(25 * 3600);
      expect(await oracle.isStale(TOKEN_EGOLD, oracle1.address)).to.be.true;
    });

    it("returns true for never-updated oracle", async function () {
      expect(await oracle.isStale(TOKEN_EGOLD, oracle2.address)).to.be.true;
    });
  });
});
