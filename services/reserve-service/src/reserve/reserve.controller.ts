import { Controller, Get, Post, Body, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { ReserveService } from "./reserve.service";
import { AddReserveDto } from "./dto/add-reserve.dto";

@ApiTags("Reserve")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("reserve")
export class ReserveController {
  constructor(private svc: ReserveService) {}

  @Post("entry")
  @ApiOperation({ summary: "Add a reserve entry (proof of reserves)" })
  addEntry(@Body() dto: AddReserveDto, @Req() req: any) { return this.svc.addEntry(dto, req.user.sub); }

  @Get("proof/:token")
  @ApiOperation({ summary: "Get proof of reserve for a token" })
  proof(@Param("token") token: string) { return this.svc.getProofOfReserve(token); }

  @Get("health")
  @ApiOperation({ summary: "Check collateralization status for all tokens" })
  health() { return this.svc.checkAllCollateralization(); }
}
