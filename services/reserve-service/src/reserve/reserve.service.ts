import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AddReserveDto } from "./dto/add-reserve.dto";

@Injectable()
export class ReserveService {
  private readonly logger = new Logger(ReserveService.name);
  constructor(private prisma: PrismaService) {}

  async addEntry(dto: AddReserveDto, addedBy: string) {
    let treasury = await this.prisma.treasury.findUnique({ where: { token: dto.token } });
    if (!treasury) {
      treasury = await this.prisma.treasury.create({
        data: { token: dto.token, totalSupply: "0", reserveAmount: "0", collateralRatio: "0" },
      });
    }

    const entry = await this.prisma.reserveEntry.create({
      data: {
        treasuryId: treasury.id,
        assetType:  dto.assetType,
        amount:     dto.amount,
        custodian:  dto.custodian,
        proofUrl:   dto.proofUrl,
        verifiedAt: new Date(),
      },
    });

    await this.recalculateRatio(dto.token);

    await this.prisma.auditLog.create({
      data: {
        userId: addedBy,
        action: "ADD_RESERVE_ENTRY",
        entityType: "Reserve",
        entityId: entry.id,
        payload: { token: dto.token, assetType: dto.assetType, amount: dto.amount, custodian: dto.custodian },
      },
    });

    this.logger.log(`Reserve entry added for ${dto.token}: ${dto.amount} by ${addedBy}`);
    return entry;
  }

  async getProofOfReserve(token: string) {
    const treasury = await this.prisma.treasury.findUnique({
      where: { token },
      include: { reserveEntries: { orderBy: { verifiedAt: "desc" } } },
    });
    if (!treasury) throw new NotFoundException(`No treasury found for ${token}`);
    return {
      token,
      totalSupply:     treasury.totalSupply.toString(),
      reserveAmount:   treasury.reserveAmount.toString(),
      collateralRatio: treasury.collateralRatio.toString(),
      isHealthy:       parseFloat(treasury.collateralRatio.toString()) >= 1.0,
      entries:         treasury.reserveEntries,
      checkedAt:       new Date().toISOString(),
    };
  }

  async checkAllCollateralization() {
    const treasuries = await this.prisma.treasury.findMany();
    return treasuries.map((t) => ({
      token:           t.token,
      totalSupply:     t.totalSupply.toString(),
      reserveAmount:   t.reserveAmount.toString(),
      collateralRatio: t.collateralRatio.toString(),
      isHealthy:       parseFloat(t.collateralRatio.toString()) >= 1.0,
      status:          parseFloat(t.collateralRatio.toString()) >= 1.0 ? "HEALTHY" : "UNDERCOLLATERALIZED",
    }));
  }

  async updateTotalSupply(token: string, totalSupply: string) {
    await this.prisma.treasury.update({ where: { token }, data: { totalSupply } });
    await this.recalculateRatio(token);
  }

  private async recalculateRatio(token: string) {
    const treasury = await this.prisma.treasury.findUnique({
      where: { token },
      include: { reserveEntries: true },
    });
    if (!treasury) return;

    const totalReserve = treasury.reserveEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount.toString()), 0
    );
    const supply = parseFloat(treasury.totalSupply.toString());
    const ratio = supply > 0 ? totalReserve / supply : 0;

    await this.prisma.treasury.update({
      where: { token },
      data: { reserveAmount: totalReserve.toString(), collateralRatio: ratio.toString() },
    });
  }
}
