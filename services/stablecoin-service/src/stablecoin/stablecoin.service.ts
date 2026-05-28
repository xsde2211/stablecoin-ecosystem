import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { PrismaService } from "../prisma/prisma.service";
import { MintDto } from "./dto/mint.dto";
import { BurnDto } from "./dto/burn.dto";

const TOKEN_ABI = [
  "function mint(address to, uint256 amount, string reason)",
  "function burn(address from, uint256 amount, string reason)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function mintCap() view returns (uint256)",
];

@Injectable()
export class StablecoinService {
  private readonly logger = new Logger(StablecoinService.name);

  constructor(private prisma: PrismaService) {}

  async getTokenInfo(token: string, chain: string) {
    const address = this.getContractAddress(token, chain);
    const provider = this.getProvider(chain);
    const contract = new ethers.Contract(address, TOKEN_ABI, provider);

    const [supply, mintCap, paused] = await Promise.all([
      contract.totalSupply(),
      contract.mintCap(),
      contract.paused(),
    ]);

    return {
      token,
      chain,
      address,
      totalSupply: ethers.formatUnits(supply, 6),
      mintCap: ethers.formatUnits(mintCap, 6),
      paused,
    };
  }

  async getTokenInfoAllChains(token: string) {
    const chains = ["ethereum", "bsc", "polygon"];
    const results = await Promise.allSettled(
      chains.map((c) => this.getTokenInfo(token, c))
    );
    return results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);
  }

  async mintTokens(dto: MintDto, requestedBy: string) {
    const address = this.getContractAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);
    const signer = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY!, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);

    const parsed = ethers.parseUnits(dto.amount, 6);

    const isPaused = await contract.paused();
    if (isPaused) throw new BadRequestException(`${dto.token} contract is paused on ${dto.chain}`);

    const tx = await contract.mint(dto.toAddress, parsed, dto.reason);
    const receipt = await tx.wait();

    await this.prisma.transaction.create({
      data: {
        walletId: "system",
        txHash: receipt.hash,
        chain: dto.chain,
        type: "MINT",
        amount: dto.amount,
        tokenSymbol: dto.token,
        fromAddress: "treasury",
        toAddress: dto.toAddress,
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: requestedBy,
        action: "MINT_TOKENS",
        entityType: "Token",
        entityId: address,
        payload: { token: dto.token, chain: dto.chain, amount: dto.amount, reason: dto.reason, txHash: receipt.hash },
      },
    });

    this.logger.log(`Minted ${dto.amount} ${dto.token} to ${dto.toAddress} on ${dto.chain}: ${receipt.hash}`);
    return { txHash: receipt.hash, status: "CONFIRMED" };
  }

  async burnTokens(dto: BurnDto, requestedBy: string) {
    const address = this.getContractAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);
    const signer = new ethers.Wallet(process.env.BURNER_PRIVATE_KEY!, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);

    const parsed = ethers.parseUnits(dto.amount, 6);
    const tx = await contract.burn(dto.fromAddress, parsed, dto.reason);
    const receipt = await tx.wait();

    await this.prisma.transaction.create({
      data: {
        walletId: "system",
        txHash: receipt.hash,
        chain: dto.chain,
        type: "BURN",
        amount: dto.amount,
        tokenSymbol: dto.token,
        fromAddress: dto.fromAddress,
        toAddress: "treasury",
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: requestedBy,
        action: "BURN_TOKENS",
        entityType: "Token",
        entityId: address,
        payload: { token: dto.token, chain: dto.chain, amount: dto.amount, reason: dto.reason, txHash: receipt.hash },
      },
    });

    this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}: ${receipt.hash}`);
    return { txHash: receipt.hash, status: "CONFIRMED" };
  }

  async getTotalSupplyAllTokens() {
    const tokens = ["INRX", "EGOLD", "ESLVR"];
    const chains = ["ethereum", "bsc", "polygon"];
    const results: any[] = [];

    for (const token of tokens) {
      for (const chain of chains) {
        try {
          const info = await this.getTokenInfo(token, chain);
          results.push(info);
        } catch {
          // skip if contract not deployed on this chain
        }
      }
    }
    return results;
  }

  private getProvider(chain: string) {
    const urls: Record<string, string> = {
      ethereum: process.env.ETH_RPC!,
      bsc: process.env.BSC_RPC!,
      polygon: process.env.POLYGON_RPC!,
    };
    if (!urls[chain]) throw new BadRequestException(`Unsupported chain: ${chain}`);
    return new ethers.JsonRpcProvider(urls[chain]);
  }

  private getContractAddress(token: string, chain: string): string {
    const key = `${chain.toUpperCase()}_${token}_ADDRESS`;
    const val = process.env[key];
    if (!val) throw new BadRequestException(`No contract address for ${token} on ${chain}. Set ${key} in .env`);
    return val;
  }
}
