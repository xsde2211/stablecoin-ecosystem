import {
  Injectable, BadRequestException,
  NotFoundException, Logger,
} from '@nestjs/common';
import { ethers }        from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { MintDto }       from './dto/mint.dto';
import { BurnDto }       from './dto/burn.dto';
import { TxType } from '@prisma/client';

// Full token ABI matching our INRX/EGold/ESilver contracts
const TOKEN_ABI = [
  'function mint(address to, uint256 amount, string reason)',
  'function burn(address from, uint256 amount, string reason)',
  'function totalSupply() view returns (uint256)',
  'function circulatingSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function paused() view returns (bool)',
  'function mintCap() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function isBlacklisted(address) view returns (bool)',
  'function isFrozen(address) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

// OracleManager ABI — for reading gold/silver prices
const ORACLE_ABI = [
  'function getPriceSafe(bytes32 tokenId) view returns (uint256 price, uint256 count)',
  'function getOracles(bytes32 tokenId) view returns (address[] addresses, string[] names, uint256[] prices, uint256[] updatedAts, bool[] actives, bool[] stales)',
  'function stalePriceThreshold() view returns (uint256)',
];

// ReserveVault ABI — for proof of reserve
const RESERVE_ABI = [
  'function getProofOfReserve(bytes32 tokenId) view returns (uint256 totalReserve, uint256 circulatingSupply, uint256 backingRatioBps, bool isFullyBacked, uint256 lastAuditTimestamp, string lastAuditReport)',
  'function getActiveReserves(bytes32 tokenId) view returns (tuple(bytes32 tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash, uint256 timestamp, address addedBy, bool active)[])',
];

const TOKEN_IDS: Record<string,string> = {
  INRX:  ethers.keccak256(ethers.toUtf8Bytes('INRX')),
  EGOLD: ethers.keccak256(ethers.toUtf8Bytes('EGOLD')),
  ESLVR: ethers.keccak256(ethers.toUtf8Bytes('ESLVR')),
};

const CHAINS = ['ethereum','bsc','polygon'] as const;

@Injectable()
export class StablecoinService {
  private readonly logger = new Logger(StablecoinService.name);

  constructor(
    private prisma: PrismaService,
    private redis:  RedisService,
  ) {}

  // ─── Token info for single chain ──────────────────────────────────────────

  async getTokenInfo(token: string, chain: string) {
    const address  = this.getTokenAddress(token, chain);
    const provider = this.getProvider(chain);
    const contract = new ethers.Contract(address, TOKEN_ABI, provider);

    const [supply, mintCap, paused, totalMinted, totalBurned, circulating] =
      await Promise.all([
        contract.totalSupply(),
        contract.mintCap(),
        contract.paused(),
        contract.totalMinted(),
        contract.totalBurned(),
        contract.circulatingSupply(),
      ]);

    return {
      token,
      chain,
      address,
      totalSupply:      ethers.formatUnits(supply,      6),
      circulatingSupply:ethers.formatUnits(circulating, 6),
      mintCap:          ethers.formatUnits(mintCap,     6),
      totalMinted:      ethers.formatUnits(totalMinted, 6),
      totalBurned:      ethers.formatUnits(totalBurned, 6),
      paused,
      utilizationPct:   mintCap > 0n
        ? ((Number(supply) / Number(mintCap)) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  // ─── Token info across all chains ──────────────────────────────────────────

  async getTokenInfoAllChains(token: string) {
    const results = await Promise.allSettled(
      CHAINS.map(c => this.getTokenInfo(token, c))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ─── All tokens all chains supply ──────────────────────────────────────────

  async getTotalSupplyAllTokens() {
    const tokens  = ['INRX','EGOLD','ESLVR'];
    const results = await Promise.allSettled(
      tokens.flatMap(t => CHAINS.map(c => this.getTokenInfo(t, c)))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ─── Oracle prices (EGold and ESilver) ─────────────────────────────────────

  async getOraclePrice(token: string, chain: string) {
    const oracleAddr = this.getOracleAddress(chain);
    if (!oracleAddr) throw new BadRequestException(`OracleManager not configured for chain: ${chain}`);

    const provider = this.getProvider(chain);
    const oracle   = new ethers.Contract(oracleAddr, ORACLE_ABI, provider);
    const tokenId  = TOKEN_IDS[token];

    const [price, count] = await oracle.getPriceSafe(tokenId);

    return {
      token,
      chain,
      price:       price > 0n ? ethers.formatUnits(price, 6) : null,
      validOracles:count.toString(),
      unit:        'INR per gram',
      oracleAddress:oracleAddr,
    };
  }

  async getOraclePricesAllChains(token: string) {
    const results = await Promise.allSettled(
      CHAINS.map(c => this.getOraclePrice(token, c))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value);
  }

  // ─── Proof of reserve ──────────────────────────────────────────────────────

  async getProofOfReserve(token: string, chain: string) {
    const reserveAddr = this.getReserveVaultAddress(chain);
    if (!reserveAddr) throw new BadRequestException(`ReserveVault not configured for chain: ${chain}`);

    const provider = this.getProvider(chain);
    const vault    = new ethers.Contract(reserveAddr, RESERVE_ABI, provider);
    const tokenId  = TOKEN_IDS[token];

    const proof = await vault.getProofOfReserve(tokenId);

    return {
      token,
      chain,
      totalReserve:      ethers.formatUnits(proof[0], 6),
      circulatingSupply: ethers.formatUnits(proof[1], 6),
      backingRatioBps:   proof[2].toString(),
      backingRatioPct:   (Number(proof[2]) / 100).toFixed(2) + '%',
      isFullyBacked:     proof[3],
      lastAuditTimestamp:proof[4] > 0n ? new Date(Number(proof[4]) * 1000).toISOString() : null,
      lastAuditReport:   proof[5] || null,
      vaultAddress:      reserveAddr,
    };
  }

  // ─── Check if address is blacklisted or frozen ─────────────────────────────

  async checkAddress(address: string, chain: string) {
    const tokens   = ['INRX','EGOLD','ESLVR'];
    const provider = this.getProvider(chain);
    const results  = [];

    for (const token of tokens) {
      try {
        const tokenAddr = this.getTokenAddress(token, chain);
        const contract  = new ethers.Contract(tokenAddr, TOKEN_ABI, provider);
        const [bl, fr]  = await Promise.all([
          contract.isBlacklisted(address),
          contract.isFrozen(address),
        ]);
        results.push({ token, chain, address, blacklisted:bl, frozen:fr });
      } catch {}
    }
    return results;
  }

  // ─── Mint (direct — bypasses TreasuryTimelock — for testing only) ───────────

  async mintTokens(dto: MintDto, requestedBy: string) {
    this.logger.warn(`Direct mint called by ${requestedBy} — bypasses timelock!`);
    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    const minterKey = process.env.SIGNER_1_PRIVATE_KEY;
    if (!minterKey) throw new BadRequestException('SIGNER_1_PRIVATE_KEY not set — cannot mint directly');

    const signer   = new ethers.Wallet(minterKey, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const paused   = await contract.paused();
    if (paused) throw new BadRequestException(`${dto.token} is paused on ${dto.chain}`);

    const parsed  = ethers.parseUnits(dto.amount, 6);
    const tx      = await contract.mint(dto.toAddress, parsed, dto.reason);
    const receipt = await tx.wait();

    await this.recordTx(receipt.hash, dto.chain, 'MINT', dto.amount, dto.token, 'treasury', dto.toAddress, requestedBy);
    this.logger.log(`Minted ${dto.amount} ${dto.token} to ${dto.toAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // ─── Burn (direct) ─────────────────────────────────────────────────────────

  async burnTokens(dto: BurnDto, requestedBy: string) {
    const address  = this.getTokenAddress(dto.token, dto.chain);
    const provider = this.getProvider(dto.chain);

    const burnerKey = process.env.SIGNER_1_PRIVATE_KEY;
    if (!burnerKey) throw new BadRequestException('SIGNER_1_PRIVATE_KEY not set — cannot burn directly');

    const signer   = new ethers.Wallet(burnerKey, provider);
    const contract = new ethers.Contract(address, TOKEN_ABI, signer);
    const parsed   = ethers.parseUnits(dto.amount, 6);
    const tx       = await contract.burn(dto.fromAddress, parsed, dto.reason);
    const receipt  = await tx.wait();

    await this.recordTx(receipt.hash, dto.chain, 'BURN', dto.amount, dto.token, dto.fromAddress, 'treasury', requestedBy);
    this.logger.log(`Burned ${dto.amount} ${dto.token} from ${dto.fromAddress} on ${dto.chain}`);
    return { txHash:receipt.hash, status:'CONFIRMED' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async recordTx(
    txHash: string, chain: string, type: string, amount: string,
    token: string, from: string, to: string, userId: string,
  ) {
    await Promise.all([
      this.prisma.transaction.create({
        data: { walletId:'system', txHash, chain, type: type as TxType, amount, tokenSymbol: token,
                fromAddress:from, toAddress:to, status:'CONFIRMED', confirmedAt:new Date() },
      }),
      this.prisma.auditLog.create({
        data: { userId, action:`${type}_TOKENS`, entityType:'Token', entityId:txHash,
                payload:{ chain, token, amount, from, to, txHash } },
      }),
    ]);
  }

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const map: Record<string,string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    if (!map[chain]) throw new BadRequestException(`Unsupported chain: ${chain}`);
    return new ethers.JsonRpcProvider(map[chain]);
  }

  private getTokenAddress(token: string, chain: string): string {
    const map: Record<string,Record<string,string>> = {
      INRX:  { ethereum:process.env.SEPOLIA_INRX_ADDRESS!,  bsc:process.env.BSC_INRX_ADDRESS!,  polygon:process.env.POLYGONAMOY_INRX_ADDRESS! },
      EGOLD: { ethereum:process.env.SEPOLIA_EGOLD_ADDRESS!, bsc:process.env.BSC_EGOLD_ADDRESS!, polygon:process.env.POLYGONAMOY_EGOLD_ADDRESS! },
      ESLVR: { ethereum:process.env.SEPOLIA_ESLVR_ADDRESS!, bsc:process.env.BSC_ESLVR_ADDRESS!, polygon:process.env.POLYGONAMOY_ESLVR_ADDRESS! },
    };
    const addr = map[token]?.[chain];
    if (!addr) throw new BadRequestException(`No contract for ${token} on ${chain}. Check .env`);
    return addr;
  }

  private getOracleAddress(chain: string): string | undefined {
    const map: Record<string,string|undefined> = {
      ethereum: process.env.SEPOLIA_ORACLE_MANAGER_ADDRESS,
      bsc:      process.env.BSC_ORACLE_MANAGER_ADDRESS,
      polygon:  process.env.POLYGONAMOY_ORACLE_MANAGER_ADDRESS,
    };
    return map[chain];
  }

  private getReserveVaultAddress(chain: string): string | undefined {
    const map: Record<string,string|undefined> = {
      ethereum: process.env.SEPOLIA_RESERVE_VAULT_ADDRESS,
      bsc:      process.env.BSC_RESERVE_VAULT_ADDRESS,
      polygon:  process.env.POLYGONAMOY_RESERVE_VAULT_ADDRESS,
    };
    return map[chain];
  }
}
