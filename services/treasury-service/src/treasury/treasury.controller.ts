import { Controller, Get, Post, Body, Param, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { TreasuryService } from "./treasury.service";
import { ProposeDto } from "./dto/propose.dto";
import { SignDto } from "./dto/sign.dto";

@ApiTags("Treasury")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("treasury")
export class TreasuryController {
  constructor(private svc: TreasuryService) {}

  @Post("propose")
  @ApiOperation({ summary: "Propose a mint or burn operation (multi-sig)" })
  propose(@Body() dto: ProposeDto, @Req() req: any) { return this.svc.propose(dto, req.user.sub); }

  @Post("sign")
  @ApiOperation({ summary: "Sign a pending treasury operation" })
  sign(@Body() dto: SignDto, @Req() req: any) { return this.svc.sign(dto, req.user.sub); }

  @Post("cancel/:chain/:opId")
  @ApiOperation({ summary: "Cancel a pending operation (admin only)" })
  cancel(@Param("chain") chain: string, @Param("opId") opId: string, @Req() req: any) {
    return this.svc.cancel(chain, opId, req.user.sub);
  }

  @Get("operation/:chain/:opId")
  @ApiOperation({ summary: "Get operation details by ID" })
  operation(@Param("chain") chain: string, @Param("opId") opId: string) {
    return this.svc.getOperation(chain, opId);
  }

  @Get("required-sigs/:chain")
  @ApiOperation({ summary: "Get required signature count" })
  requiredSigs(@Param("chain") chain: string) { return this.svc.getRequiredSignatures(chain); }

  @Get("reserves")
  @ApiOperation({ summary: "Get reserve status for all tokens" })
  reserves() { return this.svc.getReserveStatus(); }
}
