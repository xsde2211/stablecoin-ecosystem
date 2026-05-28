import { Controller, Get, Post, Body, Param, Req, UseGuards, Query, DefaultValuePipe, ParseIntPipe } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { KycService } from "./kyc.service";
import { SubmitKycDto } from "./dto/submit-kyc.dto";

@ApiTags("KYC")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("kyc")
export class KycController {
  constructor(private svc: KycService) {}

  @Post("submit")
  @ApiOperation({ summary: "Submit KYC documents" })
  submit(@Req() req: any, @Body() dto: SubmitKycDto) { return this.svc.submit(req.user.sub, dto); }

  @Get("status")
  @ApiOperation({ summary: "Get current user KYC status" })
  status(@Req() req: any) { return this.svc.getStatus(req.user.sub); }

  @Get("applications")
  @ApiOperation({ summary: "List all KYC applications (admin)" })
  all(
    @Query("page",  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("status") status?: string,
  ) { return this.svc.getAll(page, limit, status); }

  @Post("approve/:id")
  @ApiOperation({ summary: "Approve a KYC application (admin)" })
  approve(@Param("id") id: string, @Req() req: any) { return this.svc.approve(id, req.user.sub); }

  @Post("reject/:id")
  @ApiOperation({ summary: "Reject a KYC application (admin)" })
  reject(@Param("id") id: string, @Body("reason") reason: string, @Req() req: any) {
    return this.svc.reject(id, reason, req.user.sub);
  }
}
