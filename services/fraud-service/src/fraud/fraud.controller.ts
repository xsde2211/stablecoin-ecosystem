import {
  Controller, Get, Post, Body, Param, Req,
  UseGuards, Query, DefaultValuePipe, ParseIntPipe,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { FraudService } from "./fraud.service";
import { ScoreTransactionDto } from "./dto/score-transaction.dto";
import { IsString, IsIn, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

class ResolveDto {
  @ApiProperty({ enum: ["CLEARED","REPORTED"] }) @IsIn(["CLEARED","REPORTED"]) resolution: "CLEARED" | "REPORTED";
}
class BlacklistDto {
  @ApiProperty() @IsString() @IsNotEmpty() address: string;
}

@ApiTags("Fraud Detection")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("fraud")
export class FraudController {
  constructor(private svc: FraudService) {}

  @Post("score")
  @ApiOperation({ summary: "Score a transaction for fraud risk" })
  score(@Body() dto: ScoreTransactionDto) { return this.svc.scoreTransaction(dto); }

  @Get("flags")
  @ApiOperation({ summary: "List AML flags" })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "page",   required: false })
  @ApiQuery({ name: "limit",  required: false })
  flags(
    @Query("status") status?: string,
    @Query("page",  new DefaultValuePipe(1),  ParseIntPipe) page:  number = 1,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
  ) { return this.svc.getFlags(status, page, limit); }

  @Post("flags/:id/resolve")
  @ApiOperation({ summary: "Resolve an AML flag" })
  resolve(@Param("id") id: string, @Body() dto: ResolveDto, @Req() req: any) {
    return this.svc.resolveFlag(id, dto.resolution, req.user.sub);
  }

  @Post("blacklist")
  @ApiOperation({ summary: "Blacklist a wallet address" })
  blacklist(@Body() dto: BlacklistDto, @Req() req: any) {
    return this.svc.blacklistAddress(dto.address, req.user.sub);
  }

  @Get("stats")
  @ApiOperation({ summary: "AML flag statistics" })
  stats() { return this.svc.getFlagStats(); }
}
