import { expect }   from "chai";
import { ethers }   from "hardhat";
import { time }     from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("StablecoinBridgeV2", function () {

  let bridge:     any;
  let mockToken:  any;
  let admin:      SignerWithAddress;
  let relayer:    SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let validator3: SignerWithAddress;
  let user1:      SignerWithAddress;
  let user2:      SignerWithAddress;

  const TOKEN_INRX  = ethers.keccak256(ethers.toUtf8Bytes("INRX"));
  const CHAIN_ID    = 11155111n; // Sepolia
  const DST_CHAIN   = 137n;      // Polygon
  const REQUIRED_V  = 2;

  async function signBridgeRequest(
    req: any,
    signers: SignerWithAddress[]
  ): Promise<string[]> {
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","address","address","uint256","uint256","uint256","uint256","uint256"],
      [req.tokenId, req.from, req.to, req.amount,
       req.srcChainId, req.dstChainId, req.nonce, req.deadline]
    ));
    const sigs: string[] = [];
    for (const s of signers) {
      sigs.push(await s.signMessage(ethers.getBytes(hash)));
    }
    return sigs;
  }

  beforeEach(async function () {
    [admin, relayer, validator1, validator2, validator3, user1, user2] =
      await ethers.getSigners();

    // Deploy mock mintable/burnable token
    const Mock = await ethers.getContractFactory("MockMintableToken");
    mockToken  = await Mock.deploy();
    await mockToken.waitForDeployment();

    // Deploy bridge
    const Bridge = await ethers.getContractFactory("StablecoinBridgeV2");
    bridge = await Bridge.deploy(
      [validator1.address, validator2.address, validator3.address],
      REQUIRED_V,
      CHAIN_ID,
      admin.address
    );
    await bridge.waitForDeployment();

    // Register token
    await bridge.connect(admin).registerToken(TOKEN_INRX, await mockToken.getAddress());

    // Add relayer
    await bridge.connect(admin).addRelayer(relayer.address);

    // Grant bridge minter+burner on token
    await mockToken.grantMinter(await bridge.getAddress());
    await mockToken.grantBurner(await bridge.getAddress());

    // Give user1 some tokens and approve bridge
    await mockToken.mint(user1.address, ethers.parseUnits("10000", 6));
    await mockToken.connect(user1).approve(
      await bridge.getAddress(),
      ethers.parseUnits("10000", 6)
    );
  });

  describe("Deployment", function () {
    it("sets chain ID correctly", async function () {
      expect(await bridge.chainId()).to.equal(CHAIN_ID);
    });

    it("sets required validators correctly", async function () {
      expect(await bridge.requiredValidators()).to.equal(REQUIRED_V);
    });

    it("registers validators correctly", async function () {
      expect(await bridge.isActiveValidator(validator1.address)).to.be.true;
      expect(await bridge.isActiveValidator(validator2.address)).to.be.true;
      expect(await bridge.isActiveValidator(validator3.address)).to.be.true;
    });
  });

  describe("Lock tokens (source chain)", function () {
    it("locks tokens correctly", async function () {
      const amount   = ethers.parseUnits("100", 6);
      const nonce    = Date.now();
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        bridge.connect(user1).lock(
          TOKEN_INRX, amount, DST_CHAIN, user2.address, nonce, deadline
        )
      ).to.emit(bridge, "TokensLocked")
        .withArgs(TOKEN_INRX, user1.address, amount, DST_CHAIN, user2.address, nonce, deadline);
    });

    it("transfers tokens from user to bridge on lock", async function () {
      const amount   = ethers.parseUnits("100", 6);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const balBefore = await mockToken.balanceOf(user1.address);

      await bridge.connect(user1).lock(
        TOKEN_INRX, amount, DST_CHAIN, user2.address, Date.now(), deadline
      );

      expect(await mockToken.balanceOf(user1.address)).to.equal(balBefore - amount);
      expect(await mockToken.balanceOf(await bridge.getAddress())).to.equal(amount);
    });

    it("reverts if deadline passed", async function () {
      const expiredDeadline = Math.floor(Date.now() / 1000) - 1;
      await expect(
        bridge.connect(user1).lock(
          TOKEN_INRX, ethers.parseUnits("100", 6), DST_CHAIN,
          user2.address, 1, expiredDeadline
        )
      ).to.be.revertedWith("Bridge: deadline passed");
    });

    it("reverts if token not registered", async function () {
      const FAKE = ethers.keccak256(ethers.toUtf8Bytes("FAKE"));
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await expect(
        bridge.connect(user1).lock(FAKE, 100n, DST_CHAIN, user2.address, 1, deadline)
      ).to.be.revertedWith("Bridge: token not registered");
    });

    it("reverts when paused", async function () {
      await bridge.connect(admin).pause();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await expect(
        bridge.connect(user1).lock(
          TOKEN_INRX, ethers.parseUnits("100", 6), DST_CHAIN,
          user2.address, 1, deadline
        )
      ).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Mint tokens (destination chain)", function () {
    it("mints tokens with valid validator signatures", async function () {
      const amount   = ethers.parseUnits("100", 6);
      const nonce    = BigInt(Date.now());
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const req = {
        tokenId:    TOKEN_INRX,
        from:       user1.address,
        to:         user2.address,
        amount,
        srcChainId: DST_CHAIN,
        dstChainId: CHAIN_ID,
        nonce,
        deadline,
      };

      const sigs = await signBridgeRequest(req, [validator1, validator2]);

      await expect(bridge.connect(relayer).mint(req, sigs))
        .to.emit(bridge, "TokensMinted");

      expect(await mockToken.balanceOf(user2.address)).to.equal(amount);
    });

    it("reverts if wrong chain ID in request", async function () {
      const req = {
        tokenId: TOKEN_INRX, from: user1.address, to: user2.address,
        amount: 100n, srcChainId: DST_CHAIN, dstChainId: 999n,
        nonce: 1n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sigs = await signBridgeRequest(req, [validator1, validator2]);
      await expect(bridge.connect(relayer).mint(req, sigs))
        .to.be.revertedWith("Bridge: wrong chain");
    });

    it("reverts replay attack — same nonce twice", async function () {
      const req = {
        tokenId: TOKEN_INRX, from: user1.address, to: user2.address,
        amount: ethers.parseUnits("100", 6), srcChainId: DST_CHAIN,
        dstChainId: CHAIN_ID, nonce: 42n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sigs = await signBridgeRequest(req, [validator1, validator2]);
      await bridge.connect(relayer).mint(req, sigs);

      // Second call with same nonce must revert
      const sigs2 = await signBridgeRequest(req, [validator1, validator2]);
      await expect(bridge.connect(relayer).mint(req, sigs2))
        .to.be.revertedWith("Bridge: already processed");
    });

    it("reverts with insufficient signatures", async function () {
      const req = {
        tokenId: TOKEN_INRX, from: user1.address, to: user2.address,
        amount: 100n, srcChainId: DST_CHAIN, dstChainId: CHAIN_ID,
        nonce: 99n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sigs = await signBridgeRequest(req, [validator1]); // only 1 sig, need 2
      await expect(bridge.connect(relayer).mint(req, sigs))
        .to.be.revertedWith("Bridge: insufficient sigs");
    });

    it("reverts with duplicate validator signatures", async function () {
      const req = {
        tokenId: TOKEN_INRX, from: user1.address, to: user2.address,
        amount: 100n, srcChainId: DST_CHAIN, dstChainId: CHAIN_ID,
        nonce: 100n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sigs = await signBridgeRequest(req, [validator1, validator1]); // same sig twice
      await expect(bridge.connect(relayer).mint(req, sigs))
        .to.be.revertedWith("Bridge: duplicate signer");
    });

    it("reverts if non-relayer calls mint", async function () {
      const req = {
        tokenId: TOKEN_INRX, from: user1.address, to: user2.address,
        amount: 100n, srcChainId: DST_CHAIN, dstChainId: CHAIN_ID,
        nonce: 200n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sigs = await signBridgeRequest(req, [validator1, validator2]);
      await expect(bridge.connect(user1).mint(req, sigs)).to.be.reverted;
    });
  });

  describe("Burn tokens (return path from destination)", function () {
    it("burns tokens and emits TokensBurned event", async function () {
      const amount   = ethers.parseUnits("100", 6);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        bridge.connect(user1).burn(
          TOKEN_INRX, amount, DST_CHAIN, user2.address, Date.now(), deadline
        )
      ).to.emit(bridge, "TokensBurned");
    });
  });

  describe("Unlock tokens (return to source)", function () {
    beforeEach(async function () {
      // Lock some tokens first so bridge has balance to unlock
      const lockAmount = ethers.parseUnits("500", 6);
      const deadline   = Math.floor(Date.now() / 1000) + 3600;
      await bridge.connect(user1).lock(
        TOKEN_INRX, lockAmount, DST_CHAIN, user2.address, 1, deadline
      );
    });

    it("unlocks tokens with valid signatures", async function () {
      const amount = ethers.parseUnits("100", 6);
      const req    = {
        tokenId:    TOKEN_INRX,
        from:       user1.address,
        to:         user2.address,
        amount,
        srcChainId: CHAIN_ID,
        dstChainId: DST_CHAIN,
        nonce:      300n,
        deadline:   BigInt(Math.floor(Date.now() / 1000) + 3600),
      };
      const sigs = await signBridgeRequest(req, [validator1, validator2]);
      const balBefore = await mockToken.balanceOf(user2.address);

      await expect(bridge.connect(relayer).unlock(req, sigs))
        .to.emit(bridge, "TokensUnlocked");

      expect(await mockToken.balanceOf(user2.address)).to.equal(balBefore + amount);
    });
  });

  describe("Validator management", function () {
    it("admin can add a new validator", async function () {
      await expect(bridge.connect(admin).addValidator(user1.address))
        .to.emit(bridge, "ValidatorAdded")
        .withArgs(user1.address);
      expect(await bridge.isActiveValidator(user1.address)).to.be.true;
    });

    it("admin can remove a validator", async function () {
      // 3 validators, need 2 — can remove 1
      await expect(bridge.connect(admin).removeValidator(validator3.address))
        .to.emit(bridge, "ValidatorRemoved")
        .withArgs(validator3.address);
      expect(await bridge.isActiveValidator(validator3.address)).to.be.false;
    });

    it("cannot remove validator if it would break threshold", async function () {
      // Remove down to 2 (exactly at threshold)
      await bridge.connect(admin).removeValidator(validator3.address);
      // Removing one more would leave 1, below threshold of 2
      await expect(bridge.connect(admin).removeValidator(validator2.address))
        .to.be.revertedWith("Bridge: would break threshold");
    });

    it("admin can update required validators", async function () {
      await bridge.connect(admin).addValidator(user2.address); // now 4 validators
      await expect(bridge.connect(admin).updateRequiredValidators(3))
        .to.emit(bridge, "RequiredValidatorsUpdated")
        .withArgs(REQUIRED_V, 3);
    });

    it("getValidators returns only active validators", async function () {
      await bridge.connect(admin).removeValidator(validator3.address);
      const active = await bridge.getValidators();
      expect(active.length).to.equal(2);
      expect(active).to.include(validator1.address);
      expect(active).to.include(validator2.address);
      expect(active).to.not.include(validator3.address);
    });
  });

  describe("Emergency pause", function () {
    it("pauser can pause and unpause", async function () {
      await bridge.connect(admin).pause();
      expect(await bridge.paused()).to.be.true;
      await bridge.connect(admin).unpause();
      expect(await bridge.paused()).to.be.false;
    });

    it("admin can withdraw stuck tokens when paused", async function () {
      // Lock some tokens first
      const lockAmount = ethers.parseUnits("200", 6);
      const deadline   = Math.floor(Date.now() / 1000) + 3600;
      await bridge.connect(user1).lock(
        TOKEN_INRX, lockAmount, DST_CHAIN, user2.address, 999, deadline
      );

      await bridge.connect(admin).pause();
      const adminBalBefore = await mockToken.balanceOf(admin.address);

      await bridge.connect(admin).emergencyWithdraw(
        TOKEN_INRX, admin.address, lockAmount
      );

      expect(await mockToken.balanceOf(admin.address))
        .to.equal(adminBalBefore + lockAmount);
    });

    it("emergencyWithdraw reverts if not paused", async function () {
      await expect(
        bridge.connect(admin).emergencyWithdraw(TOKEN_INRX, admin.address, 100n)
      ).to.be.revertedWith("Pausable: not paused");
    });
  });
});
