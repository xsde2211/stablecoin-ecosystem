import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { ethers } from "ethers";
import { PrismaService } from "../prisma/prisma.service";
import { ProposeDto } from "./dto/propose.dto";
import { SignDto } from "./dto/sign.dto";

const TREASURY_ABI = [
  "function propose(uint8 opType, address target, uint256 amount, string reason) returns (uint256)",
  "function sign(uint256 opId)",
  "function cancel(uint256 opId)",
  "function operations(uint256 opId) view returns (uint8 opType, address target, uint256 amount, string reason, uint256 approvals, uint8 status, uint256 createdAt)",
  "function requiredSignatures() view returns (uint256)",
  "event OperationCreated(uint256 indexed opId, uint8 opType, address target, uint256 amount)",
  "event OperationSigned(uint256 indexed opId, address signer, uint256 approvals)",
  "event OperationExecuted(uint256 indexed opId)",
];

@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(private prisma: PrismaService) {}

  async propose(dto: ProposeDto, proposedBy: string) {
    const contract = this.getContract(dto.chain);
    const opTypeNum = dto.opType === "MINT" ? 0 : 1;
    const parsed = ethers.parseUnits(dto.amount, 6);

    const tx = await contract.propose(opTypeNum, dto.targetAddress, parsed, dto.reason);
    const receipt = await tx.wait();

    const iface = new ethers.Interface(["event OperationCreated(uint256 indexed opId, uint8 opType, address target, uint256 amount)"]);
    let opId = "0";
    for (const log of receipt.logs) {
      try {
        const parsed2 = iface.parseLog(log);
        if (parsed2) { opId = parsed2.args.opId.toString(); break; }
      } catch {}
    }

    await this.prisma.auditLog.create({
      data: {
        userId: proposedBy,
        action: "TREASURY_PROPOSE",
        entityType: "Treasury",
        entityId: opId,
        payload: { chain: dto.chain, token: dto.token, opType: dto.opType, amount: dto.amount, reason: dto.reason, txHash: receipt.hash },
      },
    });

    this.logger.log(`Treasury op proposed: opId=${opId} by ${proposedBy}`);
    return { opId, txHash: receipt.hash };
  }

  async sign(dto: SignDto, signedBy: string) {
    const contract = this.getContract(dto.chain);
    const tx = await contract.sign(BigInt(dto.opId));
    await tx.wait();

    await this.prisma.auditLog.create({
      data: {
        userId: signedBy,
        action: "TREASURY_SIGN",
        entityType: "Treasury",
        entityId: dto.opId,
        payload: { chain: dto.chain, opId: dto.opId, txHash: tx.hash },
      },
    });

    this.logger.log(`Treasury op ${dto.opId} signed by ${signedBy}`);
    return { txHash: tx.hash, message: "Signed successfully" };
  }

  async cancel(chain: string, opId: string, cancelledBy: string) {
    const contract = this.getContract(chain);
    const tx = await contract.cancel(BigInt(opId));
    await tx.wait();

    await this.prisma.auditLog.create({
      data: {
        userId: cancelledBy,
        action: "TREASURY_CANCEL",
        entityType: "Treasury",
        entityId: opId,
        payload: { chain, opId, txHash: tx.hash },
      },
    });

    return { txHash: tx.hash, message: "Operation cancelled" };
  }

  async getOperation(chain: string, opId: string) {
    const contract = this.getContract(chain);
    const op = await contract.operations(BigInt(opId));
    const statusMap = ["PENDING", "EXECUTED", "CANCELLED"];
    const opTypeMap = ["MINT", "BURN"];
    return {
      opId,
      chain,
      opType:    opTypeMap[Number(op[0])] ?? "UNKNOWN",
      target:    op[1],
      amount:    ethers.formatUnits(op[2], 6),
      reason:    op[3],
      approvals: op[4].toString(),
      status:    statusMap[Number(op[5])] ?? "UNKNOWN",
      createdAt: new Date(Number(op[6]) * 1000).toISOString(),
    };
  }

  async getRequiredSignatures(chain: string) {
    const contract = this.getContract(chain);
    const required = await contract.requiredSignatures();
    return { chain, required: required.toString() };
  }

  async getReserveStatus() {
    return this.prisma.treasury.findMany({
      include: { reserveEntries: { orderBy: { verifiedAt: "desc" }, take: 5 } },
    });
  }

  private getContract(chain: string) {
    const addresses: Record<string, string> = {
      ethereum: process.env.ETH_TREASURY_ADDRESS!,
      bsc:      process.env.BSC_TREASURY_ADDRESS!,
      polygon:  process.env.POLYGON_TREASURY_ADDRESS!,
    };
    const rpcs: Record<string, string> = {
      ethereum: process.env.ETH_RPC!,
      bsc:      process.env.BSC_RPC!,
      polygon:  process.env.POLYGON_RPC!,
    };
    if (!addresses[chain]) throw new BadRequestException(`Treasury not configured for chain: ${chain}`);
    const provider = new ethers.JsonRpcProvider(rpcs[chain]);
    const signer = new ethers.Wallet(process.env.TREASURY_SIGNER_KEY!, provider);
    return new ethers.Contract(addresses[chain], TREASURY_ABI, signer);
  }
}
